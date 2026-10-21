import {
  BinType,
  createSnapshot,
  decodePong,
  decodeSnapshot,
  encodeInput,
  encodePing,
  PROTOCOL_VERSION,
  TICK_MS,
} from '@stickyclaude/shared';
import type { ServerMessage, Snapshot } from '@stickyclaude/shared';
import { GameServer, loadConfig } from '../src/index.ts';
import type { Connection, ServerConfig } from '../src/index.ts';

export class FakeConn implements Connection {
  readonly sent: (Uint8Array | string)[] = [];
  bufferedAmount = 0;
  closed: { code: number; reason: string } | null = null;
  constructor(
    readonly id: number,
    readonly ip = '10.0.0.1',
  ) {}
  send(data: Uint8Array | string): void {
    this.sent.push(data);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  messages(): ServerMessage[] {
    return this.sent
      .filter((m): m is string => typeof m === 'string')
      .map((m) => JSON.parse(m) as ServerMessage);
  }
  lastOf<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    const all = this.messages().filter((m) => m.t === t);
    return all[all.length - 1] as Extract<ServerMessage, { t: T }> | undefined;
  }
  snapshots(): Snapshot[] {
    const out: Snapshot[] = [];
    for (const m of this.sent) {
      if (typeof m !== 'string' && m[0] === BinType.SNAPSHOT) {
        const s = createSnapshot();
        decodeSnapshot(m, s);
        out.push(s);
      }
    }
    return out;
  }
  pongs(): { clientTime: number; tick: number; frac: number }[] {
    const out = [];
    for (const m of this.sent) {
      if (typeof m !== 'string' && m[0] === BinType.PONG) {
        const p = { clientTime: 0, tick: 0, frac: 0 };
        decodePong(m, p);
        out.push(p);
      }
    }
    return out;
  }
  clear(): void {
    this.sent.length = 0;
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
  create(conn: FakeConn, name?: string): string;
  join(conn: FakeConn, code: string, name?: string): void;
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
    create(conn, name = 'Alice') {
      h.send(conn, { t: 'create', v: PROTOCOL_VERSION, name });
      const j = conn.lastOf('joined');
      if (!j) throw new Error('no joined message: ' + JSON.stringify(conn.messages()));
      return j.code;
    },
    join(conn, code, name = 'Bob') {
      h.send(conn, { t: 'join', v: PROTOCOL_VERSION, name, code });
    },
  };
  let nextId = 0;
  h.server = new GameServer(config, { now: () => h.time });
  return h;
}
