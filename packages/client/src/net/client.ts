import {
  BinType,
  createDecodedEvent,
  DecodeError,
  decodeEventPayload,
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
  MAX_OBJECTS,
  MAX_PLAYERS,
  MAX_PROJECTILES,
  parseGrid,
  PlayerFlag,
  PlayerState,
  PROTOCOL_VERSION,
  SimEvent,
  TICK_MS,
  MOVER_MASK,
  MOVER_SHIFT,
  createGameSnap,
} from '@stickyclaude/shared';
import type {
  ArenaData,
  ErrorCode,
  GameSnap,
  LobbyView,
  Look,
  RoomSettings,
  RoundInfo,
  ServerMessage,
} from '@stickyclaude/shared';
import {
  addPuddle,
  applyModeParams,
  createWorld,
  destroyCircle,
  loadArena,
  placeMark,
} from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';
import { ClockSync } from './clock.ts';
import {
  createObjView,
  createProjView,
  createRemoteView,
  SnapshotBuffer,
} from './interpolation.ts';
import type { ObjView, ProjView, RemoteView } from './interpolation.ts';
import { Predictor, ReconcileResult } from './predictor.ts';
import type { LocalEvent } from './predictor.ts';
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
/** Un spectateur n'envoie pas d'entrées : il accuse les événements fiables à ce rythme. */
const SPECTATOR_ACK_MS = 100;
/** Événements d'effets en attente d'affichage (au plus). */
const MAX_PENDING_FX = 128;

export type ClientState = 'connecting' | 'open' | 'joined' | 'closed';

export type JoinedMessage = Extract<ServerMessage, { t: 'joined' }>;
export type ScoresMessage = Extract<ServerMessage, { t: 'scores' }>;
export type ResultsMessage = Extract<ServerMessage, { t: 'results' }>;
export type LeftReason = Extract<ServerMessage, { t: 'left' }>['reason'];

/** Événement de simulation décodé, à jouer à l'écran (effets, sons, messages). */
export interface GameEvent {
  /** Tick du snapshot qui l'a apporté. */
  tick: number;
  type: number;
  slot: number;
  /** Arguments décodés (positions en unités de monde), voir `EVENT_SPECS`. */
  a: number[];
}

export interface OwnView {
  /** Vivant ou fantôme : il y a quelque chose à dessiner. */
  visible: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  /** `PlayerState` d'animation. */
  state: number;
  animProg: number;
  variant: number;
  /** Drapeaux au format `PlayerFlag`. */
  flags: number;
  grounded: boolean;
  crouching: boolean;
  hp: number;
  weapon: number;
  ammo: number;
  aim: number;
  ghost: boolean;
  dead: boolean;
  /** Curseur du fantôme-crayon. */
  cursorX: number;
  cursorY: number;
  /** Délai restant avant la prochaine pose du fantôme (ticks). */
  ghostCd: number;
}

export interface RenderView {
  own: OwnView;
  remotes: RemoteView[];
  remoteCount: number;
  objects: ObjView[];
  objectCount: number;
  projectiles: ProjView[];
  projCount: number;
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
  /** Restaurations suivies d'un rejeu, dont celles qui ont déplacé le joueur de façon visible. */
  corrections: number;
  visibleCorrections: number;
  resyncs: number;
  lastErrorUnits: number;
  /** Durée couverte par le tampon d'interpolation (ms). */
  bufferMs: number;
  lateSnapshots: number;
  /** Compensation de latence annoncée au serveur (ms). */
  rewindMs: number;
}

export interface GameClientHooks {
  /** Le client est entré (ou revenu) dans un salon. */
  onJoined?: (m: JoinedMessage) => void;
  /** L'état du salon a changé (joueurs, réglages, scores, phase). */
  onLobby?: (lobby: LobbyView) => void;
  /** Nouvelle manche (ou retour à l'arène d'entraînement). */
  onRound?: (round: RoundInfo, arena: ArenaData) => void;
  onScores?: (m: ScoresMessage) => void;
  onResults?: (m: ResultsMessage) => void;
  onError?: (code: ErrorCode, msg?: string) => void;
  onClosed?: (code: number) => void;
  onLeft?: (reason: LeftReason) => void;
  /** Événement fiable à jouer maintenant (livré une seule fois, dans l'ordre). */
  onEvent?: (e: GameEvent) => void;
  /** Événement local de son propre joueur (saut, atterrissage, début de coup). */
  onLocalEvent?: (e: LocalEvent) => void;
  /** Le terrain a changé (destruction, trait de fantôme). */
  onTerrain?: () => void;
}

/** Drapeaux `PlayerFlag` d'un joueur du monde de prédiction. */
function ownFlags(p: World['players'][number]): number {
  return (
    (!p.dead && !p.ghost ? PlayerFlag.ALIVE : 0) |
    (p.facing > 0 ? PlayerFlag.FACING_RIGHT : 0) |
    (p.grounded ? PlayerFlag.GROUNDED : 0) |
    (p.crouching ? PlayerFlag.CROUCHING : 0) |
    (p.state === PlayerState.WALL_SLIDE ? PlayerFlag.WALL_SLIDING : 0) |
    (p.doubleAvailable ? 0 : PlayerFlag.DOUBLE_JUMP_USED) |
    (p.vy < 0 ? PlayerFlag.RISING : 0) |
    (p.groundMover >= 0 ? PlayerFlag.ON_MOVER | ((p.groundMover & MOVER_MASK) << MOVER_SHIFT) : 0) |
    (p.hitLock > 0 ? PlayerFlag.HIT_FLASH : 0) |
    (p.invuln > 0 ? PlayerFlag.INVULN : 0) |
    (p.hasBomb ? PlayerFlag.HAS_BOMB : 0)
  );
}

/**
 * Cœur réseau du client : connexion, synchronisation d'horloge, prédiction et réconciliation de
 * son joueur, interpolation des autres joueurs, des objets et des projectiles. Sans DOM ni
 * `Math.random` : pilotable par un temps virtuel.
 */
export class GameClient {
  state: ClientState = 'connecting';
  /** Emplacement de joueur ; -1 pour un spectateur. */
  slot = -1;
  code = '';
  /** Jeton de reconnexion, à garder en local. */
  token = '';
  devTools = false;
  lobby: LobbyView | null = null;
  round: RoundInfo | null = null;
  /** Dernier état de partie reçu (phase, manche, mode, données du mode). */
  readonly game: GameSnap = createGameSnap();
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
    visibleCorrections: 0,
    resyncs: 0,
    lastErrorUnits: 0,
    bufferMs: 0,
    lateSnapshots: 0,
    rewindMs: 0,
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
      animProg: 0,
      variant: 0,
      flags: 0,
      grounded: false,
      crouching: false,
      hp: 0,
      weapon: 0,
      ammo: 0,
      aim: 0,
      ghost: false,
      dead: false,
      cursorX: 0,
      cursorY: 0,
      ghostCd: 0,
    },
    remotes: Array.from({ length: MAX_PLAYERS }, createRemoteView),
    remoteCount: 0,
    objects: Array.from({ length: MAX_OBJECTS }, createObjView),
    objectCount: 0,
    projectiles: Array.from({ length: MAX_PROJECTILES }, createProjView),
    projCount: 0,
    moverTick: 0,
    remoteTick: 0,
    ghostX: 0,
    ghostY: 0,
    ghostVisible: false,
  };
  /** Monde de rendu et de prédiction (terrain, plateformes, règles) ; non autoritaire. */
  world: World | null = null;
  predictor: Predictor | null = null;

  private snapshotHz = 30;
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
  private lastSpectatorAck = Number.NEGATIVE_INFINITY;
  private readonly sendBuf = new Uint8Array(64);
  private readonly pingBuf = new Uint8Array(8);
  private readonly masks = new Uint16Array(INPUT_REDUNDANCY);
  private readonly pong = { clientTime: 0, tick: 0, frac: 0 };
  private readonly presence = new Uint8Array(MAX_PLAYERS);
  private readonly shownX = new Float64Array(MAX_PLAYERS);
  private readonly shownY = new Float64Array(MAX_PLAYERS);
  private readonly keptValid = new Uint8Array(MAX_PLAYERS);
  private readonly decoded = createDecodedEvent();
  private readonly pendingFx: GameEvent[] = [];
  private lastViewAt = Number.NaN;
  private frameMs = 0;
  private frameLead = 0;
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

  // --- Messages vers le serveur ---------------------------------------------------------------

  create(name: string, opts: { arena?: string; isPublic?: boolean; look?: Look } = {}): void {
    this.sendJson({
      t: 'create',
      v: PROTOCOL_VERSION,
      name,
      look: opts.look,
      arena: opts.arena,
      isPublic: opts.isPublic,
    });
  }

  join(name: string, code: string, look?: Look): void {
    this.sendJson({ t: 'join', v: PROTOCOL_VERSION, name, code, look });
  }

  /** Partie rapide : le salon public le plus rempli, sinon un nouveau. */
  quick(name: string, look?: Look): void {
    this.sendJson({ t: 'quick', v: PROTOCOL_VERSION, name, look });
  }

  /** Reconnexion avec le jeton gardé de la connexion précédente. */
  resume(token: string, code: string): void {
    this.sendJson({ t: 'resume', v: PROTOCOL_VERSION, token, code });
  }

  leave(): void {
    this.sendJson({ t: 'leave' });
  }

  ready(ready: boolean): void {
    this.sendJson({ t: 'ready', ready });
  }

  start(): void {
    this.sendJson({ t: 'start' });
  }

  settings(patch: Partial<RoomSettings>): void {
    this.sendJson({ t: 'settings', settings: patch });
  }

  teams(opts: { assign?: number[]; shuffle?: boolean }): void {
    this.sendJson({ t: 'teams', ...opts });
  }

  kick(slot: number): void {
    this.sendJson({ t: 'kick', slot });
  }

  setLook(look: Partial<Look>): void {
    this.sendJson({ t: 'look', look });
  }

  emote(id: number): void {
    this.sendJson({ t: 'emote', id });
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
        if (!this.applyRound(m.round, true)) {
          this.hooks.onError?.('bad_request', `arène inconnue : ${m.round.arena}`);
          return;
        }
        this.state = 'joined';
        this.slot = m.slot;
        this.code = m.code;
        this.token = m.token;
        this.devTools = m.devTools;
        this.lobby = m.lobby;
        this.snapshotHz = m.snapshotHz;
        this.lastEventId = m.ev;
        this.caughtUp = false;
        this.buffer.clear();
        this.pendingFx.length = 0;
        this.keptValid.fill(0);
        this.lastSnapTick = -1;
        this.nextPing = this.now();
        this.pingsSent = 0;
        const w = this.world!;
        this.predictor = m.slot >= 0 ? new Predictor(w, m.slot) : null;
        this.view.own.visible = false;
        this.hooks.onJoined?.(m);
        break;
      }
      case 'lobby':
        this.lobby = m.lobby;
        this.hooks.onLobby?.(m.lobby);
        break;
      case 'round': {
        this.lastEventId = m.ev;
        this.buffer.clear();
        this.pendingFx.length = 0;
        this.keptValid.fill(0);
        this.lastSnapTick = -1;
        if (this.applyRound(m.round, false)) {
          this.predictor?.reset();
          this.caughtUp = false;
        }
        break;
      }
      case 'scores':
        this.hooks.onScores?.(m);
        break;
      case 'results':
        this.hooks.onResults?.(m);
        break;
      case 'error':
        this.hooks.onError?.(m.code, m.msg);
        break;
      case 'tune':
        if (this.world && isMovementKey(m.k)) {
          this.world.params[m.k] = m.val;
          this.world.baseParams[m.k] = m.val;
        }
        break;
      case 'left':
        this.state = 'open';
        this.predictor = null;
        this.world = null;
        this.slot = -1;
        this.code = '';
        this.token = '';
        this.lobby = null;
        this.round = null;
        this.view.own.visible = false;
        this.view.remoteCount = 0;
        this.view.objectCount = 0;
        this.view.projCount = 0;
        this.hooks.onLeft?.(m.reason);
        break;
    }
  }

  /** Charge l'arène d'une manche dans le monde de rendu. Retourne faux si elle est inconnue. */
  private applyRound(r: RoundInfo, fresh: boolean): boolean {
    const arena = getArena(r.arena);
    if (!arena) return false;
    let w = this.world;
    if (!w || fresh) {
      w = createWorld(arena, r.seed);
      w.auth = false;
      this.world = w;
    } else {
      loadArena(w, arena);
    }
    if (r.rows) {
      w.cells.set(parseGrid(r.rows));
      w.terrainVersion++;
    }
    const rules = w.rules;
    rules.suddenAfterTicks = r.suddenAfterTicks;
    rules.ghosts = r.ghosts;
    rules.weapons = r.weapons;
    rules.friendlyFire = r.friendlyFire;
    w.game.mode = r.mode;
    w.game.round = r.round;
    w.game.commonWeapon = r.commonWeapon;
    applyModeParams(w, r.mode);
    this.round = r;
    this.hooks.onRound?.(r, arena);
    return true;
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

    // État de partie.
    const g = this.game;
    g.phase = snap.game.phase;
    g.phaseTick = snap.game.phaseTick;
    g.round = snap.game.round;
    g.mode = snap.game.mode;
    g.modeCount = snap.game.modeCount;
    for (let i = 0; i < snap.game.modeCount; i++) g.modeData[i] = snap.game.modeData[i];

    this.applyReliableEvents(snap.eventCount, snap);

    // Réconciliation de son propre joueur.
    const pred = this.predictor;
    if (pred && snap.hasOwn) {
      if (!pred.started || !this.caughtUp) {
        // Avant la synchronisation d'horloge on ne simule pas encore : on suit le serveur.
        pred.start(snap.tick, snap.own, snap.game);
      } else {
        const r = pred.reconcile(snap.tick, snap.own, snap.game);
        if (r === ReconcileResult.Corrected) this.stats.lastErrorUnits = pred.lastError;
      }
      this.stats.corrections = pred.corrections;
      this.stats.visibleCorrections = pred.visibleCorrections;
      this.stats.resyncs = pred.resyncs;
      this.view.ghostX = snap.own.x;
      this.view.ghostY = snap.own.y;
      this.view.ghostVisible = true;
    }
  }

  /** Événements fiables : une seule fois et dans l'ordre. */
  private applyReliableEvents(
    count: number,
    snap: { tick: number; events: { id: number; type: number; len: number; data: Uint8Array }[] },
  ): void {
    let terrain = false;
    for (let i = 0; i < count; i++) {
      const e = snap.events[i];
      if (eventIdDiff(e.id, this.lastEventId) !== 1) continue;
      this.lastEventId = e.id;
      try {
        decodeEventPayload(e.type, e.data, e.len, this.decoded);
      } catch (err) {
        if (err instanceof DecodeError) continue;
        throw err;
      }
      const d = this.decoded;
      const a = Array.from(d.a.subarray(0, d.n));
      if (this.world && this.applyEventToWorld(d.type, d.slot, a)) terrain = true;
      if (this.pendingFx.length < MAX_PENDING_FX) {
        this.pendingFx.push({ tick: snap.tick, type: d.type, slot: d.slot, a });
      }
    }
    if (terrain) this.hooks.onTerrain?.();
  }

  /** Reporte les modifications de terrain dans le monde de prédiction. Vrai si le terrain a changé. */
  private applyEventToWorld(type: number, slot: number, a: number[]): boolean {
    const w = this.world!;
    switch (type) {
      case SimEvent.TERRAIN:
        return destroyCircle(w, a[0], a[1], a[2]) > 0;
      case SimEvent.GHOST_DRAW:
        // sorte · cellule x y · tick de pose (poids faible, fort)
        return placeMark(w, a[0], a[1], a[2], slot, (a[3] & 0xffff) | ((a[4] & 0xffff) << 16));
      case SimEvent.PUDDLE:
        addPuddle(w, a[0], a[1], a[2], (a[3] & 0xffff) | ((a[4] & 0xffff) << 16));
        return false;
      default:
        return false;
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
    this.frameLead = Math.min(MAX_FRAME_LEAD_TICKS, Math.max(0, this.frameMs / TICK_MS - 1));
    this.stats.rewindMs = Math.min(
      1020,
      this.clock.rttMs + (this.leadTicks + this.frameLead) * TICK_MS + this.interpMs,
    );
    if (pred?.started && this.clock.synced) {
      // Tick dont l'entrée, envoyée maintenant, arrivera au serveur juste avant son exécution.
      // Avec peu d'images par seconde, plusieurs ticks sont simulés d'un coup : le plus ancien
      // doit lui aussi arriver à temps, d'où une avance de plus d'une durée d'image.
      // La latence estimée peut bouger d'un coup (pong retardé par un blocage TCP) : on la suit
      // lentement pour que l'horloge de prédiction n'accélère pas brutalement. Si elle est trop
      // basse, la marge renvoyée par le serveur augmente l'avance plus vite que cela.
      const owd = this.clock.owdMs;
      if (!this.caughtUp) this.owdUsed = owd;
      else
        this.owdUsed += Math.max(-OWD_SLEW * dtMs, Math.min(OWD_SLEW * dtMs, owd - this.owdUsed));
      const desired =
        this.clock.serverTick(now) + this.owdUsed / TICK_MS + this.leadTicks + this.frameLead;
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
        for (const e of pred.localEvents) this.hooks.onLocalEvent?.(e);
      }
      if (stepped > 0) {
        this.sendInput(pred, stepped);
        this.caughtUp = true;
      }
      pred.decaySmoothing(dtMs);
      this.stats.predTick = pred.tick;
    } else if (!pred && this.clock.synced && now - this.lastSpectatorAck >= SPECTATOR_ACK_MS) {
      this.lastSpectatorAck = now;
      this.sendSpectatorAck(now);
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

  /** Un spectateur ne joue pas, mais accuse les événements fiables (sans quoi le serveur coupe). */
  private sendSpectatorAck(now: number): void {
    this.masks[0] = 0;
    const n = encodeInput(
      this.sendBuf,
      Math.floor(this.clock.serverTick(now)),
      this.lastEventId,
      0,
      this.masks,
      1,
    );
    this.stats.bytesOut += n;
    this.transport.send(this.sendBuf.slice(0, n));
  }

  /**
   * Envoie les entrées des `stepped` derniers ticks. Chaque paquet porte l'entrée la plus récente
   * et ses 3 précédentes (redondance) ; si plusieurs ticks ont été simulés d'un coup (images
   * rares), on envoie les paquets nécessaires pour qu'aucune étiquette ne manque au serveur.
   */
  private sendInput(pred: Predictor, stepped: number): void {
    const oldest = pred.tick - stepped + 1;
    let newest = pred.tick;
    const rewind = Math.round(this.stats.rewindMs / 4);
    for (let packets = 0; packets < MAX_PACKETS_PER_UPDATE; packets++) {
      let count = 0;
      for (let k = 0; k < INPUT_REDUNDANCY; k++) {
        const m = pred.maskAt(newest - k);
        if (m < 0) break;
        this.masks[k] = m;
        count++;
      }
      if (count === 0) return;
      const n = encodeInput(this.sendBuf, newest, this.lastEventId, rewind, this.masks, count);
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
      const o = v.own;
      o.visible = p.active && !p.dead;
      o.ghost = p.ghost;
      o.dead = p.dead;
      o.x = pred.prevX + (p.x - pred.prevX) * alpha + pred.smoothX;
      o.y = pred.prevY + (p.y - pred.prevY) * alpha + pred.smoothY;
      o.vx = p.vx;
      o.vy = p.vy;
      o.facing = p.facing;
      o.state = p.ghost ? PlayerState.GHOST : p.state;
      o.grounded = p.grounded;
      o.crouching = p.crouching;
      o.hp = p.hp;
      o.weapon = p.weapon;
      o.ammo = p.ammo;
      o.aim = p.aim;
      o.flags = ownFlags(p);
      o.cursorX = p.ghostX;
      o.cursorY = p.ghostY;
      o.ghostCd = p.ghostCd;
      if (p.state === PlayerState.ATTACK) {
        o.variant = (p.atkKind & 15) | (p.atkPhase << 4);
        o.animProg = Math.min(255, p.atkTicks);
      } else if (p.state === PlayerState.CHARGE) {
        o.variant = p.chargeTicks;
        o.animProg = Math.min(255, p.stateTicks);
      } else {
        o.variant = 0;
        o.animProg = Math.min(255, p.state === PlayerState.BLOCK ? p.blockTicks : p.stateTicks);
      }
    } else {
      v.own.visible = false;
    }
    // Autres joueurs, objets, projectiles : dans le passé de (latence + retard d'interpolation).
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
      v.objectCount = this.buffer.sampleObjects(renderTick, v.objects);
      v.projCount = this.buffer.sampleProjectiles(renderTick, v.projectiles);
      this.releaseFx(renderTick);
    } else {
      v.objectCount = 0;
      v.projCount = 0;
      if (this.pendingFx.length > 0 && !this.clock.synced) this.releaseFx(Infinity);
    }
    v.remoteCount = n;
  }

  /** Joue les événements dont l'instant est venu (le monde, lui, les a appliqués dès réception). */
  private releaseFx(renderTick: number): void {
    const q = this.pendingFx;
    let i = 0;
    while (i < q.length && q[i].tick <= renderTick) {
      this.hooks.onEvent?.(q[i]);
      i++;
    }
    if (i > 0) q.splice(0, i);
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

  /** Identifiant de l'arène courante. */
  get arena(): string {
    return this.round?.arena ?? '';
  }

  /** Vrai si on est l'hôte du salon. */
  get isHost(): boolean {
    return this.lobby !== null && this.slot >= 0 && this.lobby.host === this.slot;
  }

  /** Phase de partie courante (celle du dernier snapshot). */
  get phase(): number {
    return this.game.phase;
  }
}
