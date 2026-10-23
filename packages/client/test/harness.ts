import { Input, Rng, TICK_MS } from '@stickyclaude/shared';
import type { ErrorCode, RoundInfo, ServerMessage } from '@stickyclaude/shared';
import { GameServer, loadConfig } from '../../server/src/index.ts';
import type { Connection } from '../../server/src/index.ts';
import { GameClient } from '../src/net/client.ts';
import type { GameEvent, JoinedMessage, ResultsMessage, ScoresMessage } from '../src/net/client.ts';
import { LagTransport } from '../src/net/transport.ts';
import type { LagOptions, Scheduler, Transport } from '../src/net/transport.ts';

/** Temps virtuel : file d'événements ordonnée, partagée par le serveur, les liens et les clients. */
export class VirtualNet implements Scheduler {
  nowMs = 0;
  private seq = 0;
  private readonly queue: { at: number; seq: number; fn: () => void }[] = [];

  now(): number {
    return this.nowMs;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    this.schedule(this.nowMs + Math.max(0, ms), fn);
    return undefined;
  }

  schedule(at: number, fn: () => void): void {
    const e = { at, seq: this.seq++, fn };
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.queue[mid];
      if (m.at < e.at || (m.at === e.at && m.seq < e.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, e);
  }

  runUntil(t: number): void {
    while (this.queue.length > 0 && this.queue[0].at <= t) {
      const e = this.queue.shift()!;
      this.nowMs = e.at;
      e.fn();
    }
    this.nowMs = t;
  }

  every(periodMs: number, fn: () => void, start = periodMs): void {
    const tick = (at: number): void => {
      this.schedule(at, () => {
        fn();
        tick(at + periodMs);
      });
    };
    tick(start);
  }
}

class ServerSide implements Connection {
  deliver: ((data: Uint8Array | string) => void) | null = null;
  bufferedAmount = 0;
  closedWith: number | null = null;
  constructor(
    readonly id: number,
    readonly ip: string,
  ) {}
  send(data: Uint8Array | string): void {
    this.deliver?.(typeof data === 'string' ? data : data.slice());
  }
  close(code: number): void {
    this.closedWith = code;
  }
}

/** Lien sans délai entre un client et le serveur (le délai est ajouté par LagTransport). */
class DirectTransport implements Transport {
  onOpen: (() => void) | null = null;
  onMessage: ((data: Uint8Array | string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  bufferedAmount = 0;
  constructor(
    private readonly server: GameServer,
    private readonly conn: ServerSide,
  ) {
    conn.deliver = (d): void => this.onMessage?.(d);
  }
  send(data: Uint8Array | string): void {
    this.server.onMessage(this.conn, data, typeof data !== 'string');
  }
  close(): void {
    this.server.onClose(this.conn);
  }
}

/** Générateur d'entrées « humaines » : appuis tenus, sauts, descentes. */
export class InputBot {
  mask = 0;
  private hold = 0;
  idle = false;
  /** Si défini, remplace les entrées aléatoires (scénarios précis). */
  forced: number | null = null;
  /** Ajoute des coups, des parades et des ramassages aléatoires. */
  fight = false;
  constructor(private readonly rng: Rng) {}
  next(): number {
    if (this.forced !== null) return (this.mask = this.forced);
    if (this.idle) return (this.mask = 0);
    if (--this.hold <= 0) {
      this.hold = 4 + this.rng.int(50);
      const r = this.rng.float();
      let m = 0;
      if (r < 0.4) m |= Input.RIGHT;
      else if (r < 0.8) m |= Input.LEFT;
      if (this.rng.float() < 0.35) m |= Input.JUMP;
      if (this.rng.float() < 0.1) m |= Input.DOWN;
      if (this.fight) {
        if (this.rng.float() < 0.6) m |= Input.ATTACK;
        else if (this.rng.float() < 0.15) m |= Input.BLOCK;
        if (this.rng.float() < 0.2) m |= Input.PICKUP;
      }
      this.mask = m;
    }
    return this.mask;
  }
}

export interface Probe {
  client: GameClient;
  /** Lien du client (pour couper ou fausser ce qu'il reçoit). */
  transport: Transport;
  bot: InputBot;
  name: string;
  /** Plus grand déplacement affiché entre deux images pour soi et pour les autres. */
  maxOwnStep: number;
  maxRemoteStep: number;
  ownSteps: number[];
  remoteSteps: number[];
  lastOwn: [number, number] | null;
  lastRemote: Map<number, [number, number]>;
  frames: number;
  recording: boolean;
  /** Ce que le client a reçu (événements, manches, scores, résultats, erreurs…). */
  events: GameEvent[];
  rounds: RoundInfo[];
  scores: ScoresMessage[];
  results: ResultsMessage[];
  errors: ErrorCode[];
  left: string[];
  closes: number;
  /** Dernier `joined` reçu, et nombres d'appels aux crochets de désynchro et de version. */
  joined: JoinedMessage | null;
  desyncs: number;
  versions: number;
}

export interface NetOptions extends LagOptions {
  frameMs?: number;
  frameJitterMs?: number;
  /** Décalage de l'horloge locale du client par rapport au temps virtuel (ms). */
  clockOffset?: number;
  /** Dérive relative de l'horloge locale (0.0001 = 100 ppm). */
  clockDrift?: number;
}

export class TestWorld {
  readonly net = new VirtualNet();
  readonly server: GameServer;
  readonly probes: Probe[] = [];
  private nextId = 1;
  readonly rng = new Rng(2024);

  constructor(env: Record<string, string> = {}) {
    const config = loadConfig(
      { NODE_ENV: 'test', ROOM_IDLE_TTL_SEC: '600', VOTE_DEFAULT: '0', ...env },
      '/none',
    );
    this.server = new GameServer(config, { now: () => this.net.nowMs });
    this.net.every(TICK_MS, () => this.server.tick(this.net.nowMs));
  }

  addClient(
    name: string,
    opts: NetOptions,
    joinCode?: string,
    arena?: string,
    entry?: (c: GameClient) => void,
  ): Probe {
    const id = this.nextId++;
    const conn = new ServerSide(id, `10.1.${id >> 8}.${id & 255}`);
    this.server.onConnect(conn);
    const direct = new DirectTransport(this.server, conn);
    const crng = new Rng(1000 + id);
    const lagged = opts.lag > 0 || opts.jitter > 0 || opts.loss > 0;
    const transport: Transport = lagged
      ? new LagTransport(direct, opts, this.net, () => crng.float())
      : direct;
    const probe: Probe = {
      client: undefined as unknown as GameClient,
      transport,
      bot: new InputBot(new Rng(500 + id)),
      name,
      maxOwnStep: 0,
      maxRemoteStep: 0,
      ownSteps: [],
      remoteSteps: [],
      lastOwn: null,
      lastRemote: new Map(),
      frames: 0,
      recording: false,
      events: [],
      rounds: [],
      scores: [],
      results: [],
      errors: [],
      left: [],
      closes: 0,
      joined: null,
      desyncs: 0,
      versions: 0,
    };
    const off = opts.clockOffset ?? 0;
    const drift = opts.clockDrift ?? 0;
    probe.client = new GameClient(
      transport,
      {
        onEvent: (e) => probe.events.push(e),
        onRound: (r) => probe.rounds.push(r),
        onScores: (m) => probe.scores.push(m),
        onResults: (m) => probe.results.push(m),
        onError: (code) => probe.errors.push(code),
        onLeft: (reason) => probe.left.push(reason),
        onClosed: () => probe.closes++,
        onJoined: (m) => (probe.joined = m),
        onDesync: () => probe.desyncs++,
        onVersion: () => probe.versions++,
      },
      () => this.net.nowMs * (1 + drift) + off,
    );
    transport.onOpen?.();
    if (entry) entry(probe.client);
    else if (joinCode) probe.client.join(name, joinCode);
    else probe.client.create(name, { arena });
    this.probes.push(probe);

    const frameMs = opts.frameMs ?? 1000 / 60;
    const jitter = opts.frameJitterMs ?? 0;
    const frame = (at: number): void => {
      this.net.schedule(at, () => {
        this.onFrame(probe);
        frame(at + frameMs + (crng.float() * 2 - 1) * jitter);
      });
    };
    frame(this.net.nowMs + frameMs + crng.float() * frameMs);
    return probe;
  }

  private onFrame(p: Probe): void {
    const c = p.client;
    c.update(p.bot.next());
    p.frames++;
    if (!p.recording) return;
    const v = c.view;
    if (v.own.visible) {
      if (p.lastOwn) {
        const d = Math.hypot(v.own.x - p.lastOwn[0], v.own.y - p.lastOwn[1]);
        p.ownSteps.push(d);
        p.maxOwnStep = Math.max(p.maxOwnStep, d);
      }
      p.lastOwn = [v.own.x, v.own.y];
    }
    for (let i = 0; i < v.remoteCount; i++) {
      const r = v.remotes[i];
      const last = p.lastRemote.get(r.slot);
      if (last) {
        const d = Math.hypot(r.x - last[0], r.y - last[1]);
        p.remoteSteps.push(d);
        p.maxRemoteStep = Math.max(p.maxRemoteStep, d);
      }
      p.lastRemote.set(r.slot, [r.x, r.y]);
    }
  }

  /** Crée un salon avec `n` clients (le premier crée, les autres rejoignent). */
  populate(n: number, opts: NetOptions, arena?: string): Probe[] {
    const first = this.addClient('P0xx', opts, undefined, arena);
    for (let i = 0; i < 100 && !first.client.code; i++) this.net.runUntil(this.net.nowMs + 100);
    const joined = first.client.code;
    if (!joined) throw new Error('le salon n a pas été créé');
    const out = [first];
    for (let i = 1; i < n; i++) out.push(this.addClient(`P${i}xx`, opts, joined));
    return out;
  }

  run(ms: number): void {
    this.net.runUntil(this.net.nowMs + ms);
  }

  startRecording(): void {
    for (const p of this.probes) {
      p.recording = true;
      p.maxOwnStep = 0;
      p.maxRemoteStep = 0;
      p.ownSteps.length = 0;
      p.remoteSteps.length = 0;
      p.lastOwn = null;
      p.lastRemote.clear();
    }
  }

  room(): NonNullable<ReturnType<GameServer['rooms']['get']>> {
    const r = [...this.server.rooms.values()][0];
    if (!r) throw new Error('aucun salon');
    return r;
  }
}

export type { ServerMessage };
