import { randomInt } from 'node:crypto';
import {
  BinType,
  createInputPacket,
  decodeInput,
  decodePing,
  DecodeError,
  encodePong,
  eventIdDiff,
  getArena,
  INPUT_MASK_USED,
  INPUT_RING,
  LOBBY_ARENA_ID,
  MAX_ARENA_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_INPUT_AHEAD_TICKS,
  MOVEMENT_TUNING,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SNAPSHOT_MAX_BYTES,
  TICK_MS,
} from '@stickyclaude/shared';
import { clientMessageSchema } from '@stickyclaude/shared/schemas';
import type { ClientMessage } from '@stickyclaude/shared/schemas';
import type { ErrorCode, PublicRoom, ServerMessage } from '@stickyclaude/shared';
import { ClientState } from './client.ts';
import type { Member } from './client.ts';
import type { ServerConfig } from './config.ts';
import type { Connection } from './connection.ts';
import { Metrics } from './metrics.ts';
import { sanitizeName } from './names.ts';
import { RateLimiter } from './rateLimit.ts';
import { RoomRecorder } from './recorder.ts';
import { Room } from './room.ts';
import type { RoomIO } from './room.ts';

const MAX_INVALID = 20;
const INPUT_PACKETS_PER_SEC = 70;
const PINGS_PER_SEC = 10;

export interface GameServerOptions {
  now?: () => number;
  /** Appelé quand un salon est supprimé (écriture de l'enregistrement, tests). */
  onRoomClosed?: (room: Room) => void;
  /** Statistiques de fin de partie d'un compte connecté (voir `account.ts`). */
  onMatchStats?: (userId: string, add: Record<string, number>, max: Record<string, number>) => void;
}

/**
 * Cœur du serveur : connexions, routage des messages vers les salons, ticks et limites.
 * Indépendant de `ws` et de l'horloge système : les tests le pilotent avec un temps virtuel
 * (`tick(now)`).
 */
export class GameServer implements RoomIO {
  readonly rooms = new Map<string, Room>();
  readonly metrics = new Metrics();
  readonly scratch = new Uint8Array(SNAPSHOT_MAX_BYTES);
  readonly snapshotInterval: number;
  private readonly clients = new Map<Connection, ClientState>();
  private readonly ipCounts = new Map<string, number>();
  private readonly createLimiter: RateLimiter;
  private readonly codeLimiter: RateLimiter;
  private readonly now: () => number;
  private readonly pong = new Uint8Array(16);
  private readonly pkt = createInputPacket();
  private lastTickAt = 0;
  private tickCount = 0;
  private draining = false;

  constructor(
    readonly config: ServerConfig,
    private readonly opts: GameServerOptions = {},
  ) {
    this.createLimiter = new RateLimiter(config.createPerMin, 60_000);
    this.codeLimiter = new RateLimiter(config.codeTriesPerMin, 60_000);
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
    const m = c.member;
    if (m) {
      c.member = null;
      m.room.onDisconnect(m, this.now());
      this.maybeCloseRoom(m.room);
    }
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
    // Le plafond est aussi fixé par `ws` (maxPayload) ; on le vérifie ici pour les autres transports.
    // Seul l'envoi d'un niveau (JSON `{"t":"arena",…}`) peut dépasser le plafond ordinaire.
    const isArena = typeof data === 'string' && data.startsWith('{"t":"arena"');
    if (size > (isArena ? MAX_ARENA_MESSAGE_BYTES : MAX_CLIENT_MESSAGE_BYTES)) {
      this.invalid(c);
      return;
    }
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
    const m = c.member;
    if (!m) {
      this.invalid(c);
      return;
    }
    const room = m.room;
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

    // Accusé de réception des événements fiables (joueurs et spectateurs).
    if (eventIdDiff(pkt.ack, m.ackedEvent) > 0 && eventIdDiff(pkt.ack, room.reliable.lastId) <= 0) {
      m.ackedEvent = pkt.ack;
    }
    if (m.slot < 0) return;

    // Reconstitue l'étiquette complète de l'entrée la plus récente (16 bits → 32 bits).
    const next = room.world.tick + 1;
    const newest = next + (((pkt.tick - next + 0x8000) & 0xffff) - 0x8000);
    const margin = newest - next;
    if (margin < m.minMargin) m.minMargin = margin;
    if (margin < 0) this.metrics.inputsLate++;

    for (let k = 0; k < pkt.count; k++) {
      const label = newest - k;
      if (label < next || label > next + MAX_INPUT_AHEAD_TICKS) continue;
      const i = label & (INPUT_RING - 1);
      if (m.ringTick[i] !== label) {
        m.ringTick[i] = label;
        // Seuls les boutons sont acceptés : les bits hauts (compensation de latence) sont à nous.
        m.ringMask[i] = pkt.masks[k] & INPUT_MASK_USED;
      }
    }
    m.rewindTicks = Room.rewindFromWire(pkt.rewind);
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
    this.sendRaw(c, this.pong.slice(0, n));
  }

  // --- Messages de contrôle (JSON) ------------------------------------------------------------

  private onControl(c: ClientState, text: string): void {
    const now = this.now();
    if (now - c.controlWindowStart >= 1000) {
      c.controlWindowStart = now;
      c.controlWindowCount = 0;
    }
    if (++c.controlWindowCount > this.config.controlPerSec) {
      this.metrics.controlLimited++;
      this.invalid(c);
      return;
    }
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
        this.onCreate(c, msg, now);
        break;
      case 'join':
        this.onJoin(c, msg, now);
        break;
      case 'quick':
        this.onQuick(c, msg, now);
        break;
      case 'resume':
        this.onResume(c, msg, now);
        break;
      case 'leave': {
        const m = c.member;
        if (m) {
          const room = m.room;
          room.removeMember(m, 'left', now);
          this.maybeCloseRoom(room);
        } else this.error(c, 'not_joined');
        break;
      }
      default: {
        const m = c.member;
        if (!m) {
          this.error(c, 'not_joined');
          return;
        }
        this.onMemberMessage(c, m, msg, now);
      }
    }
  }

  private onMemberMessage(c: ClientState, m: Member, msg: ClientMessage, now: number): void {
    const room = m.room;
    switch (msg.t) {
      case 'ready':
        if (!room.setReady(m, msg.ready, now)) this.error(c, m.slot < 0 ? 'forbidden' : 'in_game');
        break;
      case 'start': {
        const r = room.startMatch(m, now);
        if (r !== 'ok') this.error(c, r);
        break;
      }
      case 'settings': {
        const r = room.setSettings(m, msg.settings, now);
        if (r !== 'ok') this.error(c, r);
        break;
      }
      case 'teams': {
        const r = room.setTeams(m, msg.assign, msg.shuffle, now);
        if (r !== 'ok') this.error(c, r);
        break;
      }
      case 'kick': {
        const r = room.kick(m, msg.slot, now);
        if (r !== 'ok') this.error(c, r);
        break;
      }
      case 'look':
        room.setLook(m, msg.look, now);
        break;
      case 'vote':
        room.castVote(m, msg.pick, now);
        break;
      case 'arena': {
        const r = room.addCustomArena(m, msg.arena, now);
        if (r !== 'ok') this.error(c, r.code, r.msg);
        break;
      }
      case 'arena_del':
        room.removeCustomArena(m, msg.id, now);
        break;
      case 'emote':
        if (!room.emote(m, msg.id, now)) this.metrics.emotesLimited++;
        break;
      case 'tune':
        this.onTune(c, m, msg);
        break;
      default:
        this.invalid(c);
    }
  }

  private onTune(c: ClientState, m: Member, msg: Extract<ClientMessage, { t: 'tune' }>): void {
    if (!this.config.devTools) return this.error(c, 'forbidden');
    const room = m.room;
    const k = msg.k;
    const meta = MOVEMENT_TUNING[k];
    const val = Math.min(meta.max, Math.max(meta.min, msg.val));
    room.world.baseParams[k] = val;
    room.world.params[k] = val;
    room.recording?.tune(room.world.tick, k, val);
    const text = JSON.stringify({ t: 'tune', k, val } satisfies ServerMessage);
    for (const other of room.slots) if (other?.client) this.sendRaw(other.client, text);
  }

  private checkEntry(c: ClientState, v: number, rawName: string): string | null {
    if (v !== PROTOCOL_VERSION) {
      this.error(c, 'version');
      return null;
    }
    if (c.member) {
      this.error(c, 'already_joined');
      return null;
    }
    const name = sanitizeName(rawName);
    if (name === null) {
      this.error(c, 'bad_name');
      return null;
    }
    return name;
  }

  private onCreate(
    c: ClientState,
    msg: Extract<ClientMessage, { t: 'create' }>,
    now: number,
  ): void {
    const name = this.checkEntry(c, msg.v, msg.name);
    if (name === null) return;
    // Seul le mode développement choisit l'arène du salon d'attente.
    let arenaId = LOBBY_ARENA_ID;
    if (msg.arena !== undefined && this.config.devTools) {
      if (!getArena(msg.arena)) return this.error(c, 'bad_request', 'arena');
      arenaId = msg.arena;
    }
    const room = this.newRoom(c, arenaId, msg.isPublic ?? true, now);
    if (!room) return;
    room.addMember(c, name, msg.look, now);
  }

  /** Crée un salon (limites de création et de capacité) ; null si refusé (erreur envoyée). */
  private newRoom(c: ClientState, arenaId: string, isPublic: boolean, now: number): Room | null {
    if (!this.createLimiter.hit(c.conn.ip, now)) {
      this.error(c, 'rate_limited');
      return null;
    }
    if (this.draining || this.rooms.size >= this.config.maxRooms) {
      this.error(c, 'server_full');
      return null;
    }
    const code = this.newCode();
    const seed = randomInt(1, 0x7fffffff);
    const recorder =
      this.config.devTools || this.config.recordDir !== '' ? new RoomRecorder(arenaId, seed) : null;
    const room = new Room(this, code, arenaId, seed, recorder, now, isPublic);
    this.rooms.set(code, room);
    return room;
  }

  private onJoin(c: ClientState, msg: Extract<ClientMessage, { t: 'join' }>, now: number): void {
    const name = this.checkEntry(c, msg.v, msg.name);
    if (name === null) return;
    if (this.codeLimiter.blocked(c.conn.ip, now)) return this.error(c, 'rate_limited');
    const room = this.rooms.get(msg.code.toUpperCase());
    if (!room) {
      if (!this.codeLimiter.hit(c.conn.ip, now)) return this.error(c, 'rate_limited');
      return this.error(c, 'not_found');
    }
    if (!room.hasRoom() || !room.addMember(c, name, msg.look, now)) this.error(c, 'full');
  }

  /** Partie rapide : le salon public le plus rempli (de préférence en attente), sinon un nouveau. */
  private onQuick(c: ClientState, msg: Extract<ClientMessage, { t: 'quick' }>, now: number): void {
    const name = this.checkEntry(c, msg.v, msg.name);
    if (name === null) return;
    let best: Room | null = null;
    let bestScore = -1;
    for (const r of this.rooms.values()) {
      if (!r.settings.isPublic || !r.hasRoom()) continue;
      const waiting = r.phase === 0 && r.freeSlot() >= 0;
      const score = (waiting ? 100 : 0) + r.playerCount;
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (best && best.addMember(c, name, msg.look, now)) return;
    const room = this.newRoom(c, LOBBY_ARENA_ID, true, now);
    if (!room) return;
    room.addMember(c, name, msg.look, now);
  }

  /** Reconnexion avec le jeton de session, dans le délai de 20 s. */
  private onResume(
    c: ClientState,
    msg: Extract<ClientMessage, { t: 'resume' }>,
    now: number,
  ): void {
    if (msg.v !== PROTOCOL_VERSION) return this.error(c, 'version');
    if (c.member) return this.error(c, 'already_joined');
    if (this.codeLimiter.blocked(c.conn.ip, now)) return this.error(c, 'rate_limited');
    const room = this.rooms.get(msg.code.toUpperCase());
    const m = room?.findByToken(msg.token) ?? null;
    if (!room || !m || m.client || m.leaving) {
      if (!this.codeLimiter.hit(c.conn.ip, now)) return this.error(c, 'rate_limited');
      return this.error(c, 'bad_token');
    }
    this.metrics.reconnects++;
    room.resume(m, c, now);
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

  private maybeCloseRoom(room: Room): void {
    if (room.isEmpty && this.config.roomIdleTtlSec === 0) this.closeRoom(room);
  }

  private closeRoom(room: Room): void {
    this.rooms.delete(room.code);
    for (const m of room.spectators.slice()) {
      if (m.client) {
        this.sendJson(m.client, { t: 'left', reason: 'closed' });
        m.client.member = null;
        m.client = null;
      }
    }
    this.opts.onRoomClosed?.(room);
  }

  /** Salons publics, du plus rempli au moins rempli. */
  publicRooms(): PublicRoom[] {
    const out: PublicRoom[] = [];
    for (const r of this.rooms.values())
      if (r.settings.isPublic && r.hasRoom()) out.push(r.toPublic());
    return out.sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));
  }

  // --- Ticks ----------------------------------------------------------------------------------

  /** Avance toutes les salles actives d'un pas et envoie les snapshots dus. */
  tick(nowMs: number = this.now()): void {
    const t0 = performance.now();
    this.lastTickAt = nowMs;
    this.tickCount++;
    for (const room of this.rooms.values()) {
      if (room.playerCount === 0) continue;
      room.tick(nowMs);
    }
    if (this.tickCount % this.config.tickHz === 0) this.housekeeping(nowMs);
    this.metrics.tickMs.add(performance.now() - t0);
  }

  private housekeeping(now: number): void {
    this.createLimiter.sweep(now);
    this.codeLimiter.sweep(now);
    const ttl = this.config.roomIdleTtlSec * 1000;
    for (const room of this.rooms.values()) {
      if (room.playerCount === 0 && room.emptySince === null) room.emptySince = now;
      if (room.emptySince !== null && now - room.emptySince >= ttl) this.closeRoom(room);
    }
  }

  // --- Divers ---------------------------------------------------------------------------------

  /** Arrête d'accepter de nouvelles connexions et salons (arrêt propre). */
  drain(): void {
    this.draining = true;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /** Prévient tous les clients connectés que le serveur s'arrête dans `inMs` millisecondes. */
  announceShutdown(inMs: number): void {
    const text = JSON.stringify({ t: 'shutdown', inMs } satisfies ServerMessage);
    for (const c of this.clients.values()) this.sendRaw(c, text);
  }

  private invalid(c: ClientState): void {
    this.metrics.invalidMessages++;
    if (++c.invalidCount >= MAX_INVALID) c.conn.close(1008, 'too many invalid messages');
  }

  private error(c: ClientState, code: ErrorCode, msg?: string): void {
    this.sendJson(c, { t: 'error', code, msg });
  }

  sendJson(c: ClientState, msg: ServerMessage): void {
    this.sendRaw(c, JSON.stringify(msg));
  }

  sendRaw(c: ClientState, data: Uint8Array | string): void {
    this.metrics.bytesOut += typeof data === 'string' ? data.length : data.byteLength;
    c.conn.send(data);
  }

  reportStats(userId: string, add: Record<string, number>, max: Record<string, number>): void {
    this.opts.onMatchStats?.(userId, add, max);
  }

  closeConn(c: ClientState, code: number, reason: string): void {
    c.conn.close(code, reason);
  }

  stats(): { rooms: number; players: number; connections: number } {
    return { rooms: this.rooms.size, players: this.playerCount, connections: this.clients.size };
  }

  stop(): void {
    this.metrics.stop();
  }
}
