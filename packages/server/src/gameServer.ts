import { randomInt } from 'node:crypto';
import {
  BinType,
  createInputPacket,
  decodeInput,
  decodePing,
  DecodeError,
  DEFAULT_ARENA_ID,
  encodePong,
  encodeSnapshot,
  eventIdDiff,
  getArena,
  INPUT_RING,
  MAX_INPUT_AHEAD_TICKS,
  MAX_PLAYERS,
  MOVEMENT_TUNING,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SNAPSHOT_MAX_BYTES,
  TICK_MS,
} from '@stickyclaude/shared';
import { clientMessageSchema } from '@stickyclaude/shared/schemas';
import type { ClientMessage } from '@stickyclaude/shared/schemas';
import type { ErrorCode, ServerMessage } from '@stickyclaude/shared';
import { exportOwn, fillPlayerSnap } from '@stickyclaude/sim';
import { ClientState } from './client.ts';
import type { ServerConfig } from './config.ts';
import type { Connection } from './connection.ts';
import { Metrics } from './metrics.ts';
import { sanitizeName } from './names.ts';
import { RateLimiter } from './rateLimit.ts';
import { RoomRecorder } from './recorder.ts';
import { Room } from './room.ts';

const MAX_INVALID = 20;
const INPUT_PACKETS_PER_SEC = 70;
const PINGS_PER_SEC = 10;
const BACKPRESSURE_SKIP = 64 * 1024;
const BACKPRESSURE_CLOSE = 1024 * 1024;

export interface GameServerOptions {
  now?: () => number;
  /** Appelé quand un salon est supprimé (écriture de l'enregistrement, tests). */
  onRoomClosed?: (room: Room) => void;
}

/**
 * Cœur du serveur : connexions, salons, entrées, ticks et snapshots. Indépendant de `ws` et de
 * l'horloge système : les tests le pilotent avec un temps virtuel (`tick(now)`).
 */
export class GameServer {
  readonly rooms = new Map<string, Room>();
  readonly metrics = new Metrics();
  private readonly clients = new Map<Connection, ClientState>();
  private readonly ipCounts = new Map<string, number>();
  private readonly createLimiter = new RateLimiter(3, 60_000);
  private readonly codeLimiter = new RateLimiter(10, 60_000);
  private readonly now: () => number;
  private readonly snapshotInterval: number;
  private readonly scratch = new Uint8Array(SNAPSHOT_MAX_BYTES);
  private readonly pong = new Uint8Array(16);
  private readonly pkt = createInputPacket();
  private lastTickAt = 0;
  private tickCount = 0;
  private draining = false;

  constructor(
    readonly config: ServerConfig,
    private readonly opts: GameServerOptions = {},
  ) {
    this.now = opts.now ?? ((): number => performance.now());
    this.snapshotInterval = Math.max(1, Math.round(config.tickHz / config.snapshotHz));
    this.lastTickAt = this.now();
  }

  // --- Connexions -----------------------------------------------------------------------------

  get connectionCount(): number {
    return this.clients.size;
  }

  get playerCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.playerCount;
    return n;
  }

  /** Accepte ou refuse une connexion selon les plafonds. */
  onConnect(conn: Connection): boolean {
    if (this.draining) return false;
    if (this.clients.size >= this.config.maxConnections) return false;
    const perIp = this.ipCounts.get(conn.ip) ?? 0;
    if (perIp >= this.config.maxConnPerIp) return false;
    this.ipCounts.set(conn.ip, perIp + 1);
    this.clients.set(conn, new ClientState(conn));
    return true;
  }

  onClose(conn: Connection): void {
    const c = this.clients.get(conn);
    if (!c) return;
    this.leaveRoom(c);
    this.clients.delete(conn);
    const n = (this.ipCounts.get(conn.ip) ?? 1) - 1;
    if (n <= 0) this.ipCounts.delete(conn.ip);
    else this.ipCounts.set(conn.ip, n);
  }

  onMessage(conn: Connection, data: Uint8Array | string, isBinary: boolean): void {
    const c = this.clients.get(conn);
    if (!c) return;
    const size = typeof data === 'string' ? data.length : data.byteLength;
    this.metrics.bytesIn += size;
    if (isBinary && typeof data !== 'string') this.onBinary(c, data);
    else if (!isBinary && typeof data === 'string') this.onControl(c, data);
    else this.invalid(c);
  }

  // --- Messages binaires ----------------------------------------------------------------------

  private onBinary(c: ClientState, data: Uint8Array): void {
    const type = data[0];
    try {
      if (type === BinType.INPUT) this.onInput(c, data);
      else if (type === BinType.PING) this.onPing(c, data);
      else this.invalid(c);
    } catch (e) {
      if (e instanceof DecodeError) this.invalid(c);
      else throw e;
    }
  }

  private onInput(c: ClientState, data: Uint8Array): void {
    const room = c.room;
    if (!room) {
      this.invalid(c);
      return;
    }
    const now = this.now();
    if (now - c.inputWindowStart >= 1000) {
      c.inputWindowStart = now;
      c.inputWindowCount = 0;
    }
    if (++c.inputWindowCount > INPUT_PACKETS_PER_SEC) {
      this.metrics.inputsLimited++;
      return;
    }
    const pkt = this.pkt;
    decodeInput(data, pkt);
    this.metrics.inputPackets++;

    // Reconstitue l'étiquette complète de l'entrée la plus récente (16 bits → 32 bits).
    const next = room.world.tick + 1;
    const newest = next + (((pkt.tick - next + 0x8000) & 0xffff) - 0x8000);
    const margin = newest - next;
    if (margin < c.minMargin) c.minMargin = margin;
    if (margin < 0) this.metrics.inputsLate++;

    for (let k = 0; k < pkt.count; k++) {
      const label = newest - k;
      if (label < next || label > next + MAX_INPUT_AHEAD_TICKS) continue;
      const i = label & (INPUT_RING - 1);
      if (c.ringTick[i] !== label) {
        c.ringTick[i] = label;
        c.ringMask[i] = pkt.masks[k]!;
      }
    }

    if (eventIdDiff(pkt.ack, c.ackedEvent) > 0 && eventIdDiff(pkt.ack, room.reliable.lastId) <= 0) {
      c.ackedEvent = pkt.ack;
    }
    c.interpDelayMs = pkt.interp * 4;
  }

  private onPing(c: ClientState, data: Uint8Array): void {
    const now = this.now();
    if (now - c.pingWindowStart >= 1000) {
      c.pingWindowStart = now;
      c.pingWindowCount = 0;
    }
    if (++c.pingWindowCount > PINGS_PER_SEC) return;
    const clientTime = decodePing(data);
    const room = c.room;
    if (!room) return;
    const frac = Math.min(0.999, Math.max(0, (now - this.lastTickAt) / TICK_MS));
    const n = encodePong(this.pong, clientTime, room.world.tick, frac);
    this.sendRaw(c.conn, this.pong.slice(0, n));
  }

  // --- Messages de contrôle (JSON) ------------------------------------------------------------

  private onControl(c: ClientState, text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.invalid(c);
      return;
    }
    const parsed = clientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.invalid(c);
      return;
    }
    const msg: ClientMessage = parsed.data;
    switch (msg.t) {
      case 'create':
        this.onCreate(c, msg);
        break;
      case 'join':
        this.onJoin(c, msg);
        break;
      case 'leave':
        if (c.room) {
          this.leaveRoom(c);
          this.sendJson(c.conn, { t: 'left' });
        } else this.error(c, 'not_joined');
        break;
      case 'tune':
        this.onTune(c, msg);
        break;
    }
  }

  private onCreate(c: ClientState, msg: Extract<ClientMessage, { t: 'create' }>): void {
    if (msg.v !== PROTOCOL_VERSION) return this.error(c, 'version');
    if (c.room) return this.error(c, 'already_joined');
    const name = sanitizeName(msg.name);
    if (name === null) return this.error(c, 'bad_name');
    const arena = getArena(msg.arena ?? DEFAULT_ARENA_ID);
    if (!arena) return this.error(c, 'bad_request', 'arena');
    const now = this.now();
    if (!this.createLimiter.hit(c.conn.ip, now)) return this.error(c, 'rate_limited');
    if (this.draining || this.rooms.size >= this.config.maxRooms)
      return this.error(c, 'server_full');

    const code = this.newCode();
    const seed = randomInt(1, 0x7fffffff);
    const recorder =
      this.config.devTools || this.config.recordDir !== ''
        ? new RoomRecorder(arena.id, seed)
        : null;
    const room = new Room(code, arena, seed, recorder, now);
    this.rooms.set(code, room);
    this.enter(c, room, name);
  }

  private onJoin(c: ClientState, msg: Extract<ClientMessage, { t: 'join' }>): void {
    if (msg.v !== PROTOCOL_VERSION) return this.error(c, 'version');
    if (c.room) return this.error(c, 'already_joined');
    const name = sanitizeName(msg.name);
    if (name === null) return this.error(c, 'bad_name');
    const now = this.now();
    if (this.codeLimiter.blocked(c.conn.ip, now)) return this.error(c, 'rate_limited');
    const room = this.rooms.get(msg.code.toUpperCase());
    if (!room) {
      if (!this.codeLimiter.hit(c.conn.ip, now)) return this.error(c, 'rate_limited');
      return this.error(c, 'not_found');
    }
    if (room.freeSlot() < 0) return this.error(c, 'full');
    this.enter(c, room, name);
  }

  private onTune(c: ClientState, msg: Extract<ClientMessage, { t: 'tune' }>): void {
    if (!this.config.devTools) return this.error(c, 'forbidden');
    const room = c.room;
    if (!room) return this.error(c, 'not_joined');
    const k = msg.k;
    const meta = MOVEMENT_TUNING[k];
    const val = Math.min(meta.max, Math.max(meta.min, msg.val));
    room.world.params[k] = val;
    const text = JSON.stringify({ t: 'tune', k, val } satisfies ServerMessage);
    for (const other of room.slots) if (other) this.sendRaw(other.conn, text);
  }

  // --- Salons ---------------------------------------------------------------------------------

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  private enter(c: ClientState, room: Room, name: string): void {
    const slot = room.freeSlot();
    if (slot < 0) return this.error(c, 'full');
    c.name = name;
    room.addClient(c, slot);
    this.sendJson(c.conn, {
      t: 'joined',
      v: PROTOCOL_VERSION,
      slot,
      code: room.code,
      host: room.host,
      arena: room.arena.id,
      seed: room.seed,
      tickHz: this.config.tickHz,
      snapshotHz: this.config.snapshotHz,
      tick: room.world.tick,
      ev: room.reliable.lastId,
      players: room.roster(),
      devTools: this.config.devTools,
    });
    this.broadcastRoster(room, c);
  }

  private leaveRoom(c: ClientState): void {
    const room = c.room;
    if (!room) return;
    room.removeClient(c, this.now());
    this.broadcastRoster(room, null);
    if (room.playerCount === 0 && this.config.roomIdleTtlSec === 0) this.closeRoom(room);
  }

  private broadcastRoster(room: Room, except: ClientState | null): void {
    const text = JSON.stringify({
      t: 'roster',
      players: room.roster(),
      host: room.host,
    } satisfies ServerMessage);
    for (const other of room.slots) if (other && other !== except) this.sendRaw(other.conn, text);
  }

  private closeRoom(room: Room): void {
    this.rooms.delete(room.code);
    this.opts.onRoomClosed?.(room);
  }

  // --- Ticks ----------------------------------------------------------------------------------

  /** Avance toutes les salles actives d'un pas et envoie les snapshots dus. */
  tick(nowMs: number = this.now()): void {
    const t0 = performance.now();
    this.lastTickAt = nowMs;
    this.tickCount++;
    for (const room of this.rooms.values()) {
      if (room.playerCount === 0) continue;
      room.step(this.metrics);
      if (room.world.tick % this.snapshotInterval === 0) this.sendSnapshots(room);
    }
    if (this.tickCount % this.config.tickHz === 0) this.housekeeping(nowMs);
    this.metrics.tickMs.add(performance.now() - t0);
  }

  private housekeeping(now: number): void {
    this.createLimiter.sweep(now);
    this.codeLimiter.sweep(now);
    const ttl = this.config.roomIdleTtlSec * 1000;
    for (const room of this.rooms.values()) {
      if (room.emptySince !== null && now - room.emptySince >= ttl) this.closeRoom(room);
    }
  }

  private sendSnapshots(room: Room): void {
    const w = room.world;
    const snap = room.snap;
    snap.tick = w.tick;
    let n = 0;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (w.players[s].active) fillPlayerSnap(w, s, snap.players[n++]);
    }
    snap.playerCount = n;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const c = room.slots[s];
      if (!c) continue;
      const buffered = c.conn.bufferedAmount;
      if (buffered > BACKPRESSURE_CLOSE) {
        c.conn.close(1013, 'backpressure');
        continue;
      }
      if (buffered > BACKPRESSURE_SKIP) {
        this.metrics.snapshotsSkipped++;
        continue;
      }
      snap.margin = c.minMargin;
      c.minMargin = 127;
      snap.hasOwn = true;
      exportOwn(w, s, snap.own);
      const count = room.reliable.fill(snap, c.ackedEvent);
      if (count < 0) {
        c.conn.close(1008, 'desync');
        continue;
      }
      snap.eventCount = count;
      const len = encodeSnapshot(this.scratch, snap);
      this.metrics.snapshotsSent++;
      this.sendRaw(c.conn, this.scratch.slice(0, len));
    }
  }

  // --- Divers ---------------------------------------------------------------------------------

  /** Arrête d'accepter de nouvelles connexions et salons (arrêt propre, phase 4). */
  drain(): void {
    this.draining = true;
  }

  private invalid(c: ClientState): void {
    this.metrics.invalidMessages++;
    if (++c.invalidCount >= MAX_INVALID) c.conn.close(1008, 'too many invalid messages');
  }

  private error(c: ClientState, code: ErrorCode, msg?: string): void {
    this.sendJson(c.conn, { t: 'error', code, msg });
  }

  private sendJson(conn: Connection, msg: ServerMessage): void {
    this.sendRaw(conn, JSON.stringify(msg));
  }

  private sendRaw(conn: Connection, data: Uint8Array | string): void {
    this.metrics.bytesOut += typeof data === 'string' ? data.length : data.byteLength;
    conn.send(data);
  }

  stats(): { rooms: number; players: number; connections: number } {
    return { rooms: this.rooms.size, players: this.playerCount, connections: this.clients.size };
  }

  stop(): void {
    this.metrics.stop();
  }
}
