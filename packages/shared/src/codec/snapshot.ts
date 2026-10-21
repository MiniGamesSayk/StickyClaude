import { MAX_PLAYERS, POS_SCALE } from '../constants.ts';
import { BinType } from './messages.ts';
import { clamp, DecodeError, Reader, Writer } from './io.ts';

/**
 * Snapshot serveur → client (un par client : l'en-tête et le bloc « own » lui sont propres).
 *
 *   0  u8   type = SNAPSHOT
 *   1  u32  tick           tick serveur simulé
 *   5  i8   margin         avance minimale (en ticks) des entrées reçues depuis le dernier snapshot
 *   6  u8   flags          bit 0 : bloc « own » présent
 *   7  u8   playerCount    0..8
 *   8  u8   eventCount     0..MAX_SNAPSHOT_EVENTS
 *   9  PLAYER_BYTES × playerCount
 *   .. OWN_BYTES si flags & 1
 *   .. événements fiables : u16 id, u8 type, u8 len, len octets
 *
 * Joueur (17 octets) : u8 slot, u16 flags, i16 x, i16 y, i16 vx, i16 vy (1/8 d'unité),
 * u8 aim, u8 hp, u8 weapon, u8 ammo, u8 anim (état), u8 animProg (ticks dans l'état, plafonné).
 *
 * Bloc « own » (28 octets) : état exact de prédiction du joueur destinataire.
 */
export const SNAPSHOT_HEADER_BYTES = 9;
export const PLAYER_BYTES = 17;
export const OWN_BYTES = 28;
export const MAX_SNAPSHOT_EVENTS = 24;
export const MAX_EVENT_PAYLOAD = 16;
export const SNAPSHOT_MAX_BYTES =
  SNAPSHOT_HEADER_BYTES +
  MAX_PLAYERS * PLAYER_BYTES +
  OWN_BYTES +
  MAX_SNAPSHOT_EVENTS * (4 + MAX_EVENT_PAYLOAD);

export const SnapFlag = { HAS_OWN: 1 } as const;

/** Drapeaux du bloc « own ». */
export const OwnFlag = {
  GROUNDED: 1 << 0,
  CROUCHING: 1 << 1,
  DOUBLE_AVAILABLE: 1 << 2,
  JUMPING: 1 << 3,
  FACING_RIGHT: 1 << 4,
} as const;

export interface PlayerSnap {
  slot: number;
  flags: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  hp: number;
  weapon: number;
  ammo: number;
  anim: number;
  animProg: number;
}

/** État de prédiction exact du joueur destinataire (positions en flottants 32 bits). */
export interface OwnState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  coyote: number;
  jumpBuffer: number;
  wallLock: number;
  wallCoyote: number;
  dropTimer: number;
  wallDir: number;
  groundMover: number;
  prevInput: number;
  respawns: number;
}

export interface ReliableEventSnap {
  id: number;
  type: number;
  len: number;
  data: Uint8Array;
}

export interface Snapshot {
  tick: number;
  margin: number;
  hasOwn: boolean;
  own: OwnState;
  playerCount: number;
  players: PlayerSnap[];
  eventCount: number;
  events: ReliableEventSnap[];
}

export function createOwnState(): OwnState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    flags: 0,
    coyote: 0,
    jumpBuffer: 0,
    wallLock: 0,
    wallCoyote: 0,
    dropTimer: 0,
    wallDir: 0,
    groundMover: -1,
    prevInput: 0,
    respawns: 0,
  };
}

export function createSnapshot(): Snapshot {
  const players: PlayerSnap[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    players.push({
      slot: 0,
      flags: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      aim: 0,
      hp: 0,
      weapon: 0,
      ammo: 0,
      anim: 0,
      animProg: 0,
    });
  }
  const events: ReliableEventSnap[] = [];
  for (let i = 0; i < MAX_SNAPSHOT_EVENTS; i++) {
    events.push({ id: 0, type: 0, len: 0, data: new Uint8Array(MAX_EVENT_PAYLOAD) });
  }
  return {
    tick: 0,
    margin: 0,
    hasOwn: false,
    own: createOwnState(),
    playerCount: 0,
    players,
    eventCount: 0,
    events,
  };
}

export function copyOwnState(dst: OwnState, src: OwnState): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.flags = src.flags;
  dst.coyote = src.coyote;
  dst.jumpBuffer = src.jumpBuffer;
  dst.wallLock = src.wallLock;
  dst.wallCoyote = src.wallCoyote;
  dst.dropTimer = src.dropTimer;
  dst.wallDir = src.wallDir;
  dst.groundMover = src.groundMover;
  dst.prevInput = src.prevInput;
  dst.respawns = src.respawns;
}

function q(v: number): number {
  return clamp(Math.round(v * POS_SCALE), -32768, 32767);
}

/** Encode `s` dans `out` (au moins SNAPSHOT_MAX_BYTES). Retourne le nombre d'octets écrits. */
export function encodeSnapshot(out: Uint8Array, s: Snapshot): number {
  const w = new Writer(out);
  w.u8(BinType.SNAPSHOT);
  w.u32(s.tick >>> 0);
  w.i8(clamp(Math.round(s.margin), -128, 127));
  w.u8(s.hasOwn ? SnapFlag.HAS_OWN : 0);
  w.u8(s.playerCount);
  w.u8(s.eventCount);
  for (let i = 0; i < s.playerCount; i++) {
    const p = s.players[i];
    w.u8(p.slot);
    w.u16(p.flags);
    w.i16(q(p.x));
    w.i16(q(p.y));
    w.i16(q(p.vx));
    w.i16(q(p.vy));
    w.u8(p.aim);
    w.u8(p.hp);
    w.u8(p.weapon);
    w.u8(p.ammo);
    w.u8(p.anim);
    w.u8(Math.min(255, p.animProg));
  }
  if (s.hasOwn) {
    const o = s.own;
    w.f32(o.x);
    w.f32(o.y);
    w.f32(o.vx);
    w.f32(o.vy);
    w.u8(o.flags);
    w.u8(o.coyote);
    w.u8(o.jumpBuffer);
    w.u8(o.wallLock);
    w.u8(o.wallCoyote);
    w.u8(o.dropTimer);
    w.i8(o.wallDir);
    w.i8(o.groundMover);
    w.u16(o.prevInput);
    w.u16(o.respawns);
  }
  for (let i = 0; i < s.eventCount; i++) {
    const e = s.events[i];
    w.u16(e.id & 0xffff);
    w.u8(e.type);
    w.u8(e.len);
    for (let j = 0; j < e.len; j++) w.u8(e.data[j]);
  }
  return w.pos;
}

/** Décode dans `out` (réutilisable, sans allocation). Lève `DecodeError` si invalide. */
export function decodeSnapshot(buf: Uint8Array, out: Snapshot): void {
  const r = new Reader(buf);
  if (r.u8() !== BinType.SNAPSHOT) throw new DecodeError('not a snapshot');
  out.tick = r.u32();
  out.margin = r.i8();
  const flags = r.u8();
  if ((flags & ~SnapFlag.HAS_OWN) !== 0) throw new DecodeError('unknown snapshot flags');
  out.hasOwn = (flags & SnapFlag.HAS_OWN) !== 0;
  const playerCount = r.u8();
  if (playerCount > MAX_PLAYERS) throw new DecodeError('too many players');
  const eventCount = r.u8();
  if (eventCount > MAX_SNAPSHOT_EVENTS) throw new DecodeError('too many events');
  out.playerCount = playerCount;
  out.eventCount = 0;
  for (let i = 0; i < playerCount; i++) {
    const p = out.players[i];
    p.slot = r.u8();
    if (p.slot >= MAX_PLAYERS) throw new DecodeError('bad slot');
    p.flags = r.u16();
    p.x = r.i16() / POS_SCALE;
    p.y = r.i16() / POS_SCALE;
    p.vx = r.i16() / POS_SCALE;
    p.vy = r.i16() / POS_SCALE;
    p.aim = r.u8();
    p.hp = r.u8();
    p.weapon = r.u8();
    p.ammo = r.u8();
    p.anim = r.u8();
    p.animProg = r.u8();
  }
  if (out.hasOwn) {
    const o = out.own;
    o.x = r.f32();
    o.y = r.f32();
    o.vx = r.f32();
    o.vy = r.f32();
    o.flags = r.u8();
    o.coyote = r.u8();
    o.jumpBuffer = r.u8();
    o.wallLock = r.u8();
    o.wallCoyote = r.u8();
    o.dropTimer = r.u8();
    o.wallDir = r.i8();
    o.groundMover = r.i8();
    o.prevInput = r.u16();
    o.respawns = r.u16();
  }
  for (let i = 0; i < eventCount; i++) {
    const e = out.events[i];
    e.id = r.u16();
    e.type = r.u8();
    e.len = r.u8();
    if (e.len > MAX_EVENT_PAYLOAD) throw new DecodeError('event payload too long');
    for (let j = 0; j < e.len; j++) e.data[j] = r.u8();
  }
  out.eventCount = eventCount;
  if (r.remaining !== 0) throw new DecodeError('trailing bytes');
}

/** Compare deux identifiants d'événements fiables (u16 avec retour à zéro). */
export function eventIdDiff(a: number, b: number): number {
  return ((a - b + 0x8000) & 0xffff) - 0x8000;
}

/** Charge utile d'un événement SPAWN/FELL : u8 slot, i16 x, i16 y (1/8 d'unité). */
export function writeSlotPosPayload(dst: Uint8Array, slot: number, x: number, y: number): number {
  const dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
  dst[0] = slot;
  dv.setInt16(1, q(x), true);
  dv.setInt16(3, q(y), true);
  return 5;
}

export function readSlotPosPayload(
  src: Uint8Array,
  len: number,
): { slot: number; x: number; y: number } {
  if (len !== 5) throw new DecodeError('bad slot/pos payload');
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return {
    slot: src[0],
    x: dv.getInt16(1, true) / POS_SCALE,
    y: dv.getInt16(3, true) / POS_SCALE,
  };
}
