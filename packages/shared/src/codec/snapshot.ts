import { MAX_OBJECTS, MAX_PLAYERS, MAX_PROJECTILES, POS_SCALE } from '../constants.ts';
import { GamePhase, ObjType, ProjType } from '../types.ts';
import { BinType } from './messages.ts';
import { clamp, DecodeError, Reader, Writer } from './io.ts';

/**
 * Snapshot serveur → client (un par client : l'en-tête, le bloc « own » et les événements lui sont
 * propres ; les mines adverses armées sont absentes de la liste d'objets).
 *
 *   0  u8   type = SNAPSHOT
 *   1  u32  tick           tick serveur simulé
 *   5  i8   margin         avance minimale (en ticks) des entrées reçues depuis le dernier snapshot
 *   6  u8   flags          bit 0 : bloc « own » présent
 *   7  u8   playerCount    0..8
 *   8  u8   eventCount     0..MAX_SNAPSHOT_EVENTS
 *   9  u8   objectCount    0..32
 *   10 u8   projCount      0..64
 *   11 u8   phase          GamePhase
 *   12 u16  phaseTick      ticks depuis le début de la phase (plafonné)
 *   14 u8   round          numéro de manche
 *   15 u8   mode           mode de la manche en cours (ModeId)
 *   16 u8   modeCount      0..MAX_MODE_DATA
 *   17 PLAYER_BYTES × playerCount, OBJ_BYTES × objectCount, PROJ_BYTES × projCount,
 *      u16 × modeCount, OWN_BYTES si flags & 1, événements fiables
 *
 * Joueur (18 octets) : u8 slot, u16 flags, i16 x, y, vx, vy (1/8 d'unité), u8 aim, hp, weapon,
 * ammo, anim (état), animProg (ticks dans l'état, plafonné), variant.
 * Objet (13 octets) : u16 uid, u8 type, i16 x, y, vx, vy, u8 a, u8 b.
 * Projectile (13 octets) : u16 uid, u8 type, i16 x, y, vx, vy, u8 owner, u8 a.
 */
export const SNAPSHOT_HEADER_BYTES = 17;
export const PLAYER_BYTES = 18;
export const OBJ_BYTES = 13;
export const PROJ_BYTES = 13;
export const MAX_SNAPSHOT_EVENTS = 24;
export const MAX_EVENT_PAYLOAD = 16;
export const MAX_MODE_DATA = 8;

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
  variant: number;
}

export interface ObjSnap {
  uid: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Arme (objet arme) ou points de vie (caisse, ballon) ; état (mine : 1 si armée). */
  a: number;
  /** Munitions (arme) ; équipe du propriétaire (mine). */
  b: number;
}

export interface ProjSnap {
  uid: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  /** Arme d'origine. */
  a: number;
}

/**
 * État de prédiction exact du joueur destinataire : tout ce qui influence l'évolution future de sa
 * simulation. Les noms sont ceux des champs de `Player` (sauf `flags`, `wallDir`, `status`).
 */
export interface OwnState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grappleX: number;
  grappleY: number;
  ghostX: number;
  ghostY: number;
  flags: number;
  coyote: number;
  jumpBuffer: number;
  wallLock: number;
  wallCoyote: number;
  dropTimer: number;
  wallDir: number;
  groundMover: number;
  hp: number;
  weapon: number;
  ammo: number;
  stun: number;
  hitLock: number;
  invuln: number;
  atkPhase: number;
  atkKind: number;
  atkTicks: number;
  combo: number;
  comboWindow: number;
  chargeTicks: number;
  attackHeld: number;
  blockTicks: number;
  blockCd: number;
  atkBuffer: number;
  pickupCd: number;
  aim: number;
  grappleTicks: number;
  status: number;
  stunImmune: number;
  dashTicks: number;
  dashCd: number;
  prevInput: number;
  respawns: number;
  respawnTimer: number;
  ghostCd: number;
  glueTicks: number;
  dashX: number;
  dashY: number;
}

export type OwnKey = keyof OwnState;
type FieldType = 'f32' | 'u8' | 'i8' | 'u16';

/** Ordre et type des champs du bloc « own » sur le fil. */
export const OWN_FIELDS: readonly { key: OwnKey; t: FieldType }[] = [
  { key: 'x', t: 'f32' },
  { key: 'y', t: 'f32' },
  { key: 'vx', t: 'f32' },
  { key: 'vy', t: 'f32' },
  { key: 'grappleX', t: 'f32' },
  { key: 'grappleY', t: 'f32' },
  { key: 'ghostX', t: 'f32' },
  { key: 'ghostY', t: 'f32' },
  { key: 'flags', t: 'u8' },
  { key: 'coyote', t: 'u8' },
  { key: 'jumpBuffer', t: 'u8' },
  { key: 'wallLock', t: 'u8' },
  { key: 'wallCoyote', t: 'u8' },
  { key: 'dropTimer', t: 'u8' },
  { key: 'wallDir', t: 'i8' },
  { key: 'groundMover', t: 'i8' },
  { key: 'hp', t: 'u8' },
  { key: 'weapon', t: 'u8' },
  { key: 'ammo', t: 'u8' },
  { key: 'stun', t: 'u8' },
  { key: 'hitLock', t: 'u8' },
  { key: 'invuln', t: 'u8' },
  { key: 'atkPhase', t: 'u8' },
  { key: 'atkKind', t: 'u8' },
  { key: 'atkTicks', t: 'u8' },
  { key: 'combo', t: 'u8' },
  { key: 'comboWindow', t: 'u8' },
  { key: 'chargeTicks', t: 'u8' },
  { key: 'attackHeld', t: 'u8' },
  { key: 'blockTicks', t: 'u8' },
  { key: 'blockCd', t: 'u8' },
  { key: 'atkBuffer', t: 'u8' },
  { key: 'pickupCd', t: 'u8' },
  { key: 'aim', t: 'u8' },
  { key: 'grappleTicks', t: 'u8' },
  { key: 'status', t: 'u8' },
  { key: 'stunImmune', t: 'u8' },
  { key: 'dashTicks', t: 'u8' },
  { key: 'dashCd', t: 'u8' },
  { key: 'glueTicks', t: 'u8' },
  { key: 'dashX', t: 'i8' },
  { key: 'dashY', t: 'i8' },
  { key: 'prevInput', t: 'u16' },
  { key: 'respawns', t: 'u16' },
  { key: 'respawnTimer', t: 'u16' },
  { key: 'ghostCd', t: 'u16' },
];

const TYPE_BYTES: Record<FieldType, number> = { f32: 4, u8: 1, i8: 1, u16: 2 };
export const OWN_BYTES = OWN_FIELDS.reduce((n, f) => n + TYPE_BYTES[f.t], 0);

export interface ReliableEventSnap {
  id: number;
  type: number;
  len: number;
  data: Uint8Array;
}

export interface GameSnap {
  phase: number;
  phaseTick: number;
  round: number;
  mode: number;
  modeCount: number;
  modeData: Uint16Array;
}

export interface Snapshot {
  tick: number;
  margin: number;
  hasOwn: boolean;
  own: OwnState;
  game: GameSnap;
  playerCount: number;
  players: PlayerSnap[];
  objectCount: number;
  objects: ObjSnap[];
  projCount: number;
  projectiles: ProjSnap[];
  eventCount: number;
  events: ReliableEventSnap[];
}

export const SNAPSHOT_MAX_BYTES =
  SNAPSHOT_HEADER_BYTES +
  MAX_PLAYERS * PLAYER_BYTES +
  MAX_OBJECTS * OBJ_BYTES +
  MAX_PROJECTILES * PROJ_BYTES +
  MAX_MODE_DATA * 2 +
  OWN_BYTES +
  MAX_SNAPSHOT_EVENTS * (4 + MAX_EVENT_PAYLOAD);

export function createOwnState(): OwnState {
  const o = {} as Record<string, number>;
  for (const f of OWN_FIELDS) o[f.key] = 0;
  o.groundMover = -1;
  return o as unknown as OwnState;
}

export function createGameSnap(): GameSnap {
  return {
    phase: GamePhase.LOBBY,
    phaseTick: 0,
    round: 0,
    mode: 0,
    modeCount: 0,
    modeData: new Uint16Array(MAX_MODE_DATA),
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
      variant: 0,
    });
  }
  const objects: ObjSnap[] = [];
  for (let i = 0; i < MAX_OBJECTS; i++) {
    objects.push({ uid: 0, type: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, b: 0 });
  }
  const projectiles: ProjSnap[] = [];
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    projectiles.push({ uid: 0, type: 0, x: 0, y: 0, vx: 0, vy: 0, owner: 0, a: 0 });
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
    game: createGameSnap(),
    playerCount: 0,
    players,
    objectCount: 0,
    objects,
    projCount: 0,
    projectiles,
    eventCount: 0,
    events,
  };
}

export function copyOwnState(dst: OwnState, src: OwnState): void {
  const d = dst as unknown as Record<string, number>;
  const s = src as unknown as Record<string, number>;
  for (const f of OWN_FIELDS) d[f.key] = s[f.key]!;
}

/** Tolérance de comparaison des flottants du bloc « own » (arrondi 32 bits côté serveur). */
export const OWN_POS_TOL = 0.02;
export const OWN_VEL_TOL = 0.05;

export function ownEquals(a: OwnState, b: OwnState): boolean {
  const x = a as unknown as Record<string, number>;
  const y = b as unknown as Record<string, number>;
  for (const f of OWN_FIELDS) {
    const va = x[f.key];
    const vb = y[f.key];
    if (f.t === 'f32') {
      const tol = f.key === 'vx' || f.key === 'vy' ? OWN_VEL_TOL : OWN_POS_TOL;
      if (Math.abs(va - vb) > tol) return false;
    } else if (va !== vb) return false;
  }
  return true;
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
  w.u8(s.objectCount);
  w.u8(s.projCount);
  const g = s.game;
  w.u8(g.phase);
  w.u16(Math.min(65535, g.phaseTick));
  w.u8(g.round & 255);
  w.u8(g.mode);
  w.u8(g.modeCount);
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
    w.u8(p.variant);
  }
  for (let i = 0; i < s.objectCount; i++) {
    const o = s.objects[i];
    w.u16(o.uid & 0xffff);
    w.u8(o.type);
    w.i16(q(o.x));
    w.i16(q(o.y));
    w.i16(q(o.vx));
    w.i16(q(o.vy));
    w.u8(o.a);
    w.u8(o.b);
  }
  for (let i = 0; i < s.projCount; i++) {
    const p = s.projectiles[i];
    w.u16(p.uid & 0xffff);
    w.u8(p.type);
    w.i16(q(p.x));
    w.i16(q(p.y));
    w.i16(q(p.vx));
    w.i16(q(p.vy));
    w.u8(p.owner);
    w.u8(p.a);
  }
  for (let i = 0; i < g.modeCount; i++) w.u16(g.modeData[i]);
  if (s.hasOwn) {
    const o = s.own as unknown as Record<string, number>;
    for (const f of OWN_FIELDS) {
      const v = o[f.key];
      switch (f.t) {
        case 'f32':
          // Un NaN ou un infini ferait rejeter tous les snapshots par le client (décodage) : 0 vaut mieux.
          w.f32(Number.isFinite(v) ? v : 0);
          break;
        case 'u8':
          w.u8(v);
          break;
        case 'i8':
          w.i8(v);
          break;
        case 'u16':
          w.u16(v);
          break;
      }
    }
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

/** Tick d'un snapshot lu dans son en-tête, sans le décoder. Lève `DecodeError` si trop court. */
export function peekSnapshotTick(buf: Uint8Array): number {
  const r = new Reader(buf);
  if (r.u8() !== BinType.SNAPSHOT) throw new DecodeError('not a snapshot');
  return r.u32();
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
  const objectCount = r.u8();
  if (objectCount > MAX_OBJECTS) throw new DecodeError('too many objects');
  const projCount = r.u8();
  if (projCount > MAX_PROJECTILES) throw new DecodeError('too many projectiles');
  const g = out.game;
  g.phase = r.u8();
  if (g.phase > GamePhase.MATCH_END) throw new DecodeError('bad phase');
  g.phaseTick = r.u16();
  g.round = r.u8();
  g.mode = r.u8();
  g.modeCount = r.u8();
  if (g.modeCount > MAX_MODE_DATA) throw new DecodeError('too much mode data');
  out.playerCount = playerCount;
  out.objectCount = 0;
  out.projCount = 0;
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
    if (p.aim > 15) throw new DecodeError('bad aim');
    p.hp = r.u8();
    p.weapon = r.u8();
    p.ammo = r.u8();
    p.anim = r.u8();
    p.animProg = r.u8();
    p.variant = r.u8();
  }
  for (let i = 0; i < objectCount; i++) {
    const o = out.objects[i];
    o.uid = r.u16();
    o.type = r.u8();
    if (o.type < ObjType.WEAPON || o.type > ObjType.COVER) throw new DecodeError('bad object type');
    o.x = r.i16() / POS_SCALE;
    o.y = r.i16() / POS_SCALE;
    o.vx = r.i16() / POS_SCALE;
    o.vy = r.i16() / POS_SCALE;
    o.a = r.u8();
    o.b = r.u8();
  }
  for (let i = 0; i < projCount; i++) {
    const p = out.projectiles[i];
    p.uid = r.u16();
    p.type = r.u8();
    if (p.type < ProjType.PELLET || p.type > ProjType.HOOK) {
      throw new DecodeError('bad projectile type');
    }
    p.x = r.i16() / POS_SCALE;
    p.y = r.i16() / POS_SCALE;
    p.vx = r.i16() / POS_SCALE;
    p.vy = r.i16() / POS_SCALE;
    p.owner = r.u8();
    p.a = r.u8();
  }
  for (let i = 0; i < g.modeCount; i++) g.modeData[i] = r.u16();
  if (out.hasOwn) {
    const o = out.own as unknown as Record<string, number>;
    for (const f of OWN_FIELDS) {
      switch (f.t) {
        case 'f32':
          o[f.key] = r.f32();
          break;
        case 'u8':
          o[f.key] = r.u8();
          break;
        case 'i8':
          o[f.key] = r.i8();
          break;
        case 'u16':
          o[f.key] = r.u16();
          break;
      }
    }
  }
  for (let i = 0; i < eventCount; i++) {
    const e = out.events[i];
    e.id = r.u16();
    e.type = r.u8();
    e.len = r.u8();
    if (e.len > MAX_EVENT_PAYLOAD) throw new DecodeError('event payload too long');
    for (let j = 0; j < e.len; j++) e.data[j] = r.u8();
  }
  out.objectCount = objectCount;
  out.projCount = projCount;
  out.eventCount = eventCount;
  if (r.remaining !== 0) throw new DecodeError('trailing bytes');
}

/** Compare deux identifiants d'événements fiables (u16 avec retour à zéro). */
export function eventIdDiff(a: number, b: number): number {
  return ((a - b + 0x8000) & 0xffff) - 0x8000;
}
