import {
  BinType,
  createSnapshot,
  decodePong,
  decodeSnapshot,
  encodeInput,
  encodePing,
  Input,
  PROTOCOL_VERSION,
  Rng,
  TICK_MS,
} from '@stickyclaude/shared';
import type { RoomSettings, ServerMessage, Snapshot } from '@stickyclaude/shared';
import { GameServer, loadConfig } from '../src/index.ts';
import type { Connection, Room, ServerConfig } from '../src/index.ts';

export class FakeConn implements Connection {
  /** Messages JSON reçus. */
  readonly sent: (Uint8Array | string)[] = [];
  /** Snapshots décodés à l'arrivée (les plus récents, bornés). */
  private snaps: Snapshot[] = [];
  private pongList: { clientTime: number; tick: number; frac: number }[] = [];
  bufferedAmount = 0;
  rttMs = 0;
  closed: { code: number; reason: string } | null = null;
  snapshotTotal = 0;
  constructor(
    readonly id: number,
    readonly ip = '10.0.0.1',
  ) {}
  send(data: Uint8Array | string): void {
    if (typeof data === 'string') {
      this.sent.push(data);
    } else if (data[0] === BinType.SNAPSHOT) {
      const s = createSnapshot();
      decodeSnapshot(data, s);
      this.snaps.push(s);
      this.snapshotTotal++;
      if (this.snaps.length > 4000) this.snaps.splice(0, 1000);
    } else if (data[0] === BinType.PONG) {
      const p = { clientTime: 0, tick: 0, frac: 0 };
      decodePong(data, p);
      this.pongList.push(p);
    }
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  messages(): ServerMessage[] {
    return this.sent
      .filter((m): m is string => typeof m === 'string')
      .map((m) => JSON.parse(m) as ServerMessage);
  }
  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.messages().filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  lastOf<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (typeof m === 'string' && m.startsWith(`{"t":"${t}"`)) {
        return JSON.parse(m) as Extract<ServerMessage, { t: T }>;
      }
    }
    return undefined;
  }
  snapshots(): Snapshot[] {
    return this.snaps;
  }
  lastSnapshot(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }
  pongs(): { clientTime: number; tick: number; frac: number }[] {
    return this.pongList;
  }
  clear(): void {
    this.sent.length = 0;
    this.snaps = [];
    this.pongList = [];
  }
}

export interface Harness {
  server: GameServer;
  config: ServerConfig;
  time: number;
  advance(ticks: number): void;
  connect(ip?: string): FakeConn;
  send(conn: FakeConn, msg: unknown): void;
  sendInput(conn: FakeConn, tick: number, masks: number[], ack?: number): void;
  sendPing(conn: FakeConn, clientTime: number): void;
  create(conn: FakeConn, name?: string, extra?: Record<string, unknown>): string;
  join(conn: FakeConn, code: string, name?: string): void;
  room(code: string): Room;
  slotOf(conn: FakeConn): number;
  /** Les joueurs de la liste se déclarent prêts, l'hôte lance. */
  startMatch(host: FakeConn, others: FakeConn[]): void;
  settings(conn: FakeConn, patch: Partial<RoomSettings>): void;
}

export function harness(env: Record<string, string> = {}): Harness {
  const config = loadConfig({ NODE_ENV: 'test', ...env }, '/nonexistent');
  const h: Harness = {
    config,
    time: 1000,
    server: undefined as unknown as GameServer,
    advance(ticks) {
      for (let i = 0; i < ticks; i++) {
        h.time += TICK_MS;
        h.server.tick(h.time);
      }
    },
    connect(ip = '10.0.0.1') {
      const c = new FakeConn(++nextId, ip);
      if (!h.server.onConnect(c)) c.closed = { code: 1013, reason: 'refused' };
      return c;
    },
    send(conn, msg) {
      h.server.onMessage(conn, JSON.stringify(msg), false);
    },
    sendInput(conn, tick, masks, ack = 0) {
      const buf = new Uint8Array(16);
      const n = encodeInput(buf, tick, ack, 25, masks, masks.length);
      h.server.onMessage(conn, buf.slice(0, n), true);
    },
    sendPing(conn, clientTime) {
      const buf = new Uint8Array(8);
      const n = encodePing(buf, clientTime);
      h.server.onMessage(conn, buf.slice(0, n), true);
    },
    create(conn, name = 'Alice', extra = {}) {
      h.send(conn, { t: 'create', v: PROTOCOL_VERSION, name, ...extra });
      const j = conn.lastOf('joined');
      if (!j) throw new Error('no joined message: ' + JSON.stringify(conn.messages()));
      return j.code;
    },
    join(conn, code, name = 'Bob') {
      h.send(conn, { t: 'join', v: PROTOCOL_VERSION, name, code });
    },
    room(code) {
      const r = h.server.rooms.get(code);
      if (!r) throw new Error(`no room ${code}`);
      return r;
    },
    slotOf(conn) {
      return conn.lastOf('joined')?.slot ?? -1;
    },
    startMatch(host, others) {
      for (const o of others) h.send(o, { t: 'ready', ready: true });
      h.send(host, { t: 'start' });
    },
    settings(conn, patch) {
      h.send(conn, { t: 'settings', settings: patch });
    },
  };
  let nextId = 0;
  h.server = new GameServer(config, { now: () => h.time });
  return h;
}

/** Où un joueur automatique doit aller (roi de la colline, boulette-ball) ; null : au hasard. */
export type BotGoal = (room: Room) => { x: number; y: number } | null;

/** Joueur automatique : envoie à chaque tick des entrées étiquetées juste devant le serveur. */
export class Bot {
  private hold = 0;
  private mask = 0;
  private slot = -2;
  private readonly rng: Rng;
  constructor(
    private readonly h: Harness,
    readonly conn: FakeConn,
    seed: number,
    /** Objectif poursuivi (3 fois sur 4) à la place d'entrées au hasard. */
    private readonly goal: BotGoal | null = null,
  ) {
    this.rng = new Rng(seed);
  }

  /** À appeler avant chaque tick du serveur. */
  act(code: string): void {
    const room = this.h.server.rooms.get(code);
    if (!room || this.conn.closed) return;
    if (--this.hold <= 0) {
      this.hold = 3 + this.rng.int(25);
      this.mask = this.rng.nextU32() & 0xff;
      if (this.goal) {
        if (this.slot === -2) this.slot = this.h.slotOf(this.conn);
        const p = room.world.players[this.slot];
        const g = p ? this.goal(room) : null;
        if (p && g && this.rng.float() < 0.75) {
          let m = g.x < p.x - 8 ? Input.LEFT : g.x > p.x + 8 ? Input.RIGHT : 0;
          if (g.y < p.y - 24 || this.rng.float() < 0.15) m |= Input.JUMP;
          if (this.rng.float() < 0.3) m |= Input.ATTACK;
          this.mask = m;
        }
      }
    }
    const tick = room.world.tick + 3;
    const ack = this.conn.lastSnapshot()?.events.at(-1)?.id ?? 0;
    this.h.sendInput(this.conn, tick, [this.mask], ack);
  }
}

export { Input };
