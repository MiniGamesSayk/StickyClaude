import {
  BinType,
  decodePong,
  decodeSnapshot,
  encodeInput,
  encodePing,
  eventIdDiff,
  getArena,
  INPUT_REDUNDANCY,
  isMovementKey,
  MARGIN_MAX,
  MARGIN_MIN,
  MARGIN_TARGET,
  MAX_PLAYERS,
  PlayerFlag,
  PROTOCOL_VERSION,
  readSlotPosPayload,
  TICK_MS,
  DecodeError,
} from '@stickyclaude/shared';
import type { ErrorCode, RosterEntry, ServerMessage } from '@stickyclaude/shared';
import { ClockSync } from './clock.ts';
import { createRemoteView, SnapshotBuffer } from './interpolation.ts';
import type { RemoteView } from './interpolation.ts';
import { Predictor, ReconcileResult } from './predictor.ts';
import type { Transport } from './transport.ts';

/** Au plus ce nombre de ticks simulés d'un coup ; au-delà, on saute (onglet resté en arrière-plan). */
const MAX_CATCHUP_TICKS = 10;
const MAX_INITIAL_CATCHUP_TICKS = 120;
/** Paquets d'entrées envoyés au plus par image (rattrapage après une image très longue). */
const MAX_PACKETS_PER_UPDATE = 3;
/** Avance supplémentaire maximale due à des images rares (en ticks). */
const MAX_FRAME_LEAD_TICKS = 8;
/** Vitesse maximale de variation de la latence utilisée (ms de latence par ms réelle). */
const OWD_SLEW = 0.05;
/** Plage du retard d'interpolation adaptatif (ms). */
const INTERP_MIN_MS = 100;
const INTERP_MAX_MS = 300;
const PING_FAST_MS = 80;
const PING_FAST_COUNT = 6;
const PING_SLOW_MS = 2000;
const LEAD_MIN = 1;
const LEAD_MAX = 30;
/** Lissage d'affichage des autres joueurs : zone morte, constante de temps, distance de saut. */
const REMOTE_DEAD_UNITS = 4;
const REMOTE_TAU_MS = 40;
const REMOTE_SNAP_UNITS = 96;

export type ClientState = 'connecting' | 'open' | 'joined' | 'closed';

export interface OwnView {
  visible: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  state: number;
  grounded: boolean;
  crouching: boolean;
}

export interface RenderView {
  own: OwnView;
  remotes: RemoteView[];
  remoteCount: number;
  /** Tick (flottant) auquel dessiner les plateformes : celui de notre prédiction. */
  moverTick: number;
  /** Tick (flottant) auquel les autres joueurs sont dessinés. */
  remoteTick: number;
  /** Dernier état confirmé par le serveur pour soi (fantôme de débogage). */
  ghostX: number;
  ghostY: number;
  ghostVisible: boolean;
}

export interface NetStats {
  rttMs: number;
  jitterMs: number;
  /** Retard d'interpolation courant (ms). */
  interpMs: number;
  /** Avance de la prédiction sur la marge visée, en ticks (adaptative). */
  leadTicks: number;
  /** Dernière marge d'entrée signalée par le serveur (ticks, 127 = aucune). */
  margin: number;
  /** Tick prédit et tick serveur estimé. */
  predTick: number;
  serverTick: number;
  /** Octets reçus et envoyés depuis le début, et snapshots reçus. */
  bytesIn: number;
  bytesOut: number;
  snapshots: number;
  corrections: number;
  resyncs: number;
  lastErrorUnits: number;
  /** Durée couverte par le tampon d'interpolation (ms). */
  bufferMs: number;
  lateSnapshots: number;
}

export interface GameClientHooks {
  onJoined?: (m: Extract<ServerMessage, { t: 'joined' }>) => void;
  onRoster?: (players: RosterEntry[], host: number) => void;
  onError?: (code: ErrorCode, msg?: string) => void;
  onClosed?: (code: number) => void;
  onLeft?: () => void;
  /** Événement fiable (livré une seule fois, dans l'ordre). */
  onReliable?: (type: number, slot: number, x: number, y: number) => void;
}

/**
 * Cœur réseau du client : connexion, synchronisation d'horloge, prédiction et réconciliation de
 * son joueur, interpolation des autres. Sans DOM ni `Math.random` : pilotable par un temps virtuel.
 */
export class GameClient {
  state: ClientState = 'connecting';
  slot = -1;
  code = '';
  host = -1;
  devTools = false;
  roster: RosterEntry[] = [];
  readonly clock = new ClockSync();
  readonly stats: NetStats = {
    rttMs: 0,
    jitterMs: 0,
    interpMs: INTERP_MIN_MS,
    leadTicks: MARGIN_TARGET,
    margin: 127,
    predTick: 0,
    serverTick: 0,
    bytesIn: 0,
    bytesOut: 0,
    snapshots: 0,
    corrections: 0,
    resyncs: 0,
    lastErrorUnits: 0,
    bufferMs: 0,
    lateSnapshots: 0,
  };
  readonly view: RenderView = {
    own: {
      visible: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facing: 1,
      state: 0,
      grounded: false,
      crouching: false,
    },
    remotes: Array.from({ length: MAX_PLAYERS }, createRemoteView),
    remoteCount: 0,
    moverTick: 0,
    remoteTick: 0,
    ghostX: 0,
    ghostY: 0,
    ghostVisible: false,
  };
  predictor: Predictor | null = null;

  private snapshotHz = 30;
  private seed = 0;
  private arenaId = '';
  private readonly buffer = new SnapshotBuffer();
  private leadTicks = MARGIN_TARGET;
  private interpMs = INTERP_MIN_MS;
  private jitterArrivalMs = 0;
  private lastArrival = Number.NaN;
  private lastSnapTick = -1;
  private lastEventId = 0;
  private nextPing = 0;
  private pingsSent = 0;
  private lastLeadDecrease = Number.NEGATIVE_INFINITY;
  private lastUpdate = Number.NaN;
  private lastDesired = 0;
  private readonly sendBuf = new Uint8Array(64);
  private readonly pingBuf = new Uint8Array(8);
  private readonly masks = new Uint16Array(INPUT_REDUNDANCY);
  private readonly pong = { clientTime: 0, tick: 0, frac: 0 };
  private readonly presence = new Uint8Array(MAX_PLAYERS);
  private readonly shownX = new Float64Array(MAX_PLAYERS);
  private readonly shownY = new Float64Array(MAX_PLAYERS);
  private readonly keptValid = new Uint8Array(MAX_PLAYERS);
  private lastViewAt = Number.NaN;
  private frameMs = 0;
  /** Latence aller utilisée pour viser le tick d'entrée : l'estimation brute, mais lissée. */
  private owdUsed = 0;
  private caughtUp = false;
  private readonly queued: string[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly hooks: GameClientHooks = {},
    private readonly now: () => number = () => performance.now(),
  ) {
    transport.onOpen = (): void => {
      this.state = 'open';
      for (const text of this.queued.splice(0)) this.transport.send(text);
    };
    transport.onMessage = (data): void => this.onMessage(data);
    transport.onClose = (code): void => {
      this.state = 'closed';
      this.hooks.onClosed?.(code);
    };
  }

  // --- Salon ----------------------------------------------------------------------------------

  create(name: string, arena?: string): void {
    this.sendJson({ t: 'create', v: PROTOCOL_VERSION, name, arena });
  }

  join(name: string, code: string): void {
    this.sendJson({ t: 'join', v: PROTOCOL_VERSION, name, code });
  }

  leave(): void {
    this.sendJson({ t: 'leave' });
  }

  tune(k: string, val: number): void {
    this.sendJson({ t: 'tune', k, val });
  }

  close(): void {
    this.transport.close();
  }

  private sendJson(m: unknown): void {
    const text = JSON.stringify(m);
    this.stats.bytesOut += text.length;
    // Messages demandés avant l'ouverture de la connexion : envoyés dès qu'elle s'ouvre.
    if (this.state === 'connecting') this.queued.push(text);
    else this.transport.send(text);
  }

  // --- Réception ------------------------------------------------------------------------------

  private onMessage(data: Uint8Array | string): void {
    if (typeof data === 'string') {
      this.stats.bytesIn += data.length;
      this.onControl(JSON.parse(data) as ServerMessage);
      return;
    }
    this.stats.bytesIn += data.byteLength;
    if (this.state !== 'joined') return;
    try {
      if (data[0] === BinType.SNAPSHOT) this.onSnapshot(data);
      else if (data[0] === BinType.PONG) this.onPong(data);
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e;
    }
  }

  private onControl(m: ServerMessage): void {
    switch (m.t) {
      case 'joined': {
        const arena = getArena(m.arena);
        if (!arena) {
          this.hooks.onError?.('bad_request', `arène inconnue : ${m.arena}`);
          return;
        }
        this.state = 'joined';
        this.slot = m.slot;
        this.code = m.code;
        this.host = m.host;
        this.devTools = m.devTools;
        this.roster = m.players;
        this.snapshotHz = m.snapshotHz;
        this.seed = m.seed;
        this.arenaId = m.arena;
        this.lastEventId = m.ev;
        this.predictor = new Predictor(arena, this.seed, this.slot);
        this.caughtUp = false;
        this.buffer.clear();
        this.lastSnapTick = -1;
        this.nextPing = this.now();
        this.pingsSent = 0;
        this.hooks.onJoined?.(m);
        break;
      }
      case 'roster':
        this.roster = m.players;
        this.host = m.host;
        this.hooks.onRoster?.(m.players, m.host);
        break;
      case 'error':
        this.hooks.onError?.(m.code, m.msg);
        break;
      case 'tune':
        if (this.predictor && isMovementKey(m.k)) this.predictor.world.params[m.k] = m.val;
        break;
      case 'left':
        this.state = 'open';
        this.predictor = null;
        this.slot = -1;
        this.code = '';
        this.view.own.visible = false;
        this.view.remoteCount = 0;
        this.hooks.onLeft?.();
        break;
    }
  }

  private onPong(data: Uint8Array): void {
    decodePong(data, this.pong);
    const now = this.now();
    const rtt = ((Math.floor(now) >>> 0) - this.pong.clientTime) >>> 0;
    this.clock.onPong(now, rtt, this.pong.tick + this.pong.frac);
    this.stats.rttMs = this.clock.rttMs;
    this.stats.jitterMs = this.clock.jitterMs;
  }

  private onSnapshot(data: Uint8Array): void {
    const now = this.now();
    const snap = this.buffer.next();
    decodeSnapshot(data, snap);
    if (!this.buffer.commit()) {
      this.stats.lateSnapshots++;
      return;
    }
    this.stats.snapshots++;

    // Gigue d'arrivée : écart à l'intervalle attendu entre deux snapshots.
    if (!Number.isNaN(this.lastArrival) && this.lastSnapTick >= 0) {
      const expected = (snap.tick - this.lastSnapTick) * TICK_MS;
      const dev = Math.abs(now - this.lastArrival - expected);
      this.jitterArrivalMs += (dev - this.jitterArrivalMs) * 0.1;
    }
    this.lastArrival = now;
    this.lastSnapTick = snap.tick;
    const snapMs = 1000 / this.snapshotHz;
    const target = Math.min(
      INTERP_MAX_MS,
      Math.max(INTERP_MIN_MS, 2 * snapMs + 3 * this.jitterArrivalMs),
    );
    // Le retard d'interpolation glisse lentement vers sa cible (pas de saut d'affichage).
    this.interpMs += Math.max(-0.5, Math.min(2, target - this.interpMs));

    // Marge d'avance des entrées signalée par le serveur → ajuste l'avance de la prédiction.
    this.stats.margin = snap.margin;
    if (snap.margin < 100) {
      if (snap.margin < MARGIN_MIN) {
        // Hausse plafonnée : une rafale d'entrées en retard (blocage TCP) ne doit pas faire
        // exploser l'avance, qui retarde l'effet de nos actions sur le serveur.
        this.leadTicks = Math.min(
          LEAD_MAX,
          this.leadTicks + Math.min(1, MARGIN_TARGET - snap.margin),
        );
      } else if (snap.margin > MARGIN_MAX && now - this.lastLeadDecrease > 100) {
        this.leadTicks = Math.max(LEAD_MIN, this.leadTicks - 0.25);
        this.lastLeadDecrease = now;
      }
    }

    // Événements fiables, une seule fois et dans l'ordre.
    for (let i = 0; i < snap.eventCount; i++) {
      const e = snap.events[i];
      if (eventIdDiff(e.id, this.lastEventId) !== 1) continue;
      this.lastEventId = e.id;
      if (e.len === 5) {
        const p = readSlotPosPayload(e.data, e.len);
        this.hooks.onReliable?.(e.type, p.slot, p.x, p.y);
      }
    }

    // Réconciliation de son propre joueur.
    const pred = this.predictor;
    if (pred && snap.hasOwn) {
      if (!pred.started || !this.caughtUp) {
        // Avant la synchronisation d'horloge on ne simule pas encore : on suit le serveur.
        pred.start(snap.tick, snap.own);
      } else {
        const r = pred.reconcile(snap.tick, snap.own);
        if (r === ReconcileResult.Corrected) this.stats.lastErrorUnits = pred.lastError;
      }
      this.stats.corrections = pred.corrections;
      this.stats.resyncs = pred.resyncs;
      this.view.ghostX = snap.own.x;
      this.view.ghostY = snap.own.y;
      this.view.ghostVisible = true;
    }
  }

  // --- Boucle de rendu ------------------------------------------------------------------------

  /**
   * À appeler à chaque image avec l'état des touches. Simule les ticks dus (calés sur l'horloge
   * serveur estimée + l'avance), envoie les entrées, puis calcule la vue à dessiner.
   */
  update(input: number): void {
    const now = this.now();
    const dtMs = Number.isNaN(this.lastUpdate) ? 0 : Math.min(100, now - this.lastUpdate);
    if (!Number.isNaN(this.lastUpdate)) {
      this.frameMs += (Math.min(250, now - this.lastUpdate) - this.frameMs) * 0.1;
    }
    this.lastUpdate = now;
    if (this.state !== 'joined') return;

    this.pingIfDue(now);
    const pred = this.predictor;
    if (pred?.started && this.clock.synced) {
      // Tick dont l'entrée, envoyée maintenant, arrivera au serveur juste avant son exécution.
      // Avec peu d'images par seconde, plusieurs ticks sont simulés d'un coup : le plus ancien
      // doit lui aussi arriver à temps, d'où une avance de plus d'une durée d'image.
      const frameLead = Math.min(MAX_FRAME_LEAD_TICKS, Math.max(0, this.frameMs / TICK_MS - 1));
      // La latence estimée peut bouger d'un coup (pong retardé par un blocage TCP) : on la suit
      // lentement pour que l'horloge de prédiction n'accélère pas brutalement. Si elle est trop
      // basse, la marge renvoyée par le serveur augmente l'avance plus vite que cela.
      const owd = this.clock.owdMs;
      if (!this.caughtUp) this.owdUsed = owd;
      else
        this.owdUsed += Math.max(-OWD_SLEW * dtMs, Math.min(OWD_SLEW * dtMs, owd - this.owdUsed));
      const desired =
        this.clock.serverTick(now) + this.owdUsed / TICK_MS + this.leadTicks + frameLead;
      this.lastDesired = desired;
      let target = Math.floor(desired);
      // Premier rattrapage : on simule tout l'écart. Ensuite, après une longue interruption
      // (onglet masqué), on saute au lieu de rejouer des secondes d'entrées.
      const maxCatchup = this.caughtUp ? MAX_CATCHUP_TICKS : MAX_INITIAL_CATCHUP_TICKS;
      if (target - pred.tick > maxCatchup) {
        pred.jumpTo(target - 1);
        target = target - 1 + 1;
      }
      let stepped = 0;
      while (pred.tick < target) {
        pred.stepTick(input);
        stepped++;
      }
      if (stepped > 0) {
        this.sendInput(pred, stepped);
        this.caughtUp = true;
      }
      pred.decaySmoothing(dtMs);
      this.stats.predTick = pred.tick;
    }
    this.stats.serverTick = this.clock.synced ? this.clock.serverTick(now) : 0;
    this.stats.interpMs = this.interpMs;
    this.stats.leadTicks = this.leadTicks;
    this.stats.bufferMs = this.buffer.spanMs();
    this.computeView(now);
  }

  private pingIfDue(now: number): void {
    if (now < this.nextPing) return;
    const n = encodePing(this.pingBuf, Math.floor(now) >>> 0);
    this.stats.bytesOut += n;
    this.transport.send(this.pingBuf.slice(0, n));
    this.pingsSent++;
    this.nextPing = now + (this.pingsSent < PING_FAST_COUNT ? PING_FAST_MS : PING_SLOW_MS);
  }

  /**
   * Envoie les entrées des `stepped` derniers ticks. Chaque paquet porte l'entrée la plus récente
   * et ses 3 précédentes (redondance) ; si plusieurs ticks ont été simulés d'un coup (images
   * rares), on envoie les paquets nécessaires pour qu'aucune étiquette ne manque au serveur.
   */
  private sendInput(pred: Predictor, stepped: number): void {
    const oldest = pred.tick - stepped + 1;
    let newest = pred.tick;
    for (let packets = 0; packets < MAX_PACKETS_PER_UPDATE; packets++) {
      let count = 0;
      for (let k = 0; k < INPUT_REDUNDANCY; k++) {
        const m = pred.maskAt(newest - k);
        if (m < 0) break;
        this.masks[k] = m;
        count++;
      }
      if (count === 0) return;
      const n = encodeInput(
        this.sendBuf,
        newest,
        this.lastEventId,
        Math.round(this.interpMs / 4),
        this.masks,
        count,
      );
      this.stats.bytesOut += n;
      this.transport.send(this.sendBuf.slice(0, n));
      newest -= INPUT_REDUNDANCY;
      if (newest < oldest) return;
    }
  }

  private computeView(now: number): void {
    const v = this.view;
    const pred = this.predictor;
    v.moverTick = pred?.started ? this.lastDesired - 1 : this.clock.serverTick(now);
    if (pred?.started) {
      const p = pred.player;
      const alpha = Math.min(1, Math.max(0, this.lastDesired - pred.tick));
      v.own.visible = true;
      v.own.x = pred.prevX + (p.x - pred.prevX) * alpha + pred.smoothX;
      v.own.y = pred.prevY + (p.y - pred.prevY) * alpha + pred.smoothY;
      v.own.vx = p.vx;
      v.own.vy = p.vy;
      v.own.facing = p.facing;
      v.own.state = p.state;
      v.own.grounded = p.grounded;
      v.own.crouching = p.crouching;
    }
    // Autres joueurs : dans le passé de (latence + retard d'interpolation).
    const viewDt = Number.isNaN(this.lastViewAt) ? 0 : Math.min(100, now - this.lastViewAt);
    this.lastViewAt = now;
    let n = 0;
    if (this.clock.synced && this.buffer.size > 0) {
      const renderTick = this.clock.serverTick(now) - (this.clock.owdMs + this.interpMs) / TICK_MS;
      v.remoteTick = renderTick;
      const count = this.buffer.presentSlots(this.presence);
      for (let i = 0; i < count; i++) {
        const slot = this.presence[i];
        if (slot === this.slot) continue;
        const r = v.remotes[n];
        if (this.buffer.sample(renderTick, slot, r)) {
          this.smoothRemote(r, viewDt);
          n++;
        }
      }
    }
    v.remoteCount = n;
  }

  /**
   * Après un blocage réseau, l'interpolation « rattrape » d'un coup : on étale ce rattrapage sur
   * quelques images au lieu de téléporter le joueur. Sans écart notable, l'affichage reste exact.
   */
  private smoothRemote(r: RemoteView, dtMs: number): void {
    const s = r.slot;
    if (this.keptValid[s] === 0) {
      this.shownX[s] = r.x;
      this.shownY[s] = r.y;
    } else {
      const ex = r.x - this.shownX[s];
      const ey = r.y - this.shownY[s];
      const dist = Math.hypot(ex, ey);
      if (dist > REMOTE_SNAP_UNITS || dist <= REMOTE_DEAD_UNITS) {
        this.shownX[s] = r.x;
        this.shownY[s] = r.y;
      } else {
        const k = 1 - Math.exp(-dtMs / REMOTE_TAU_MS);
        this.shownX[s] = this.shownX[s] + ex * k;
        this.shownY[s] = this.shownY[s] + ey * k;
      }
    }
    this.keptValid[s] = 1;
    r.x = this.shownX[s]!;
    r.y = this.shownY[s]!;
  }

  get arena(): string {
    return this.arenaId;
  }
}

export { PlayerFlag };
