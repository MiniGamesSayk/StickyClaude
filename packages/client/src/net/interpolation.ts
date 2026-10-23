import {
  createSnapshot,
  MAX_OBJECTS,
  MAX_PLAYERS,
  MAX_PROJECTILES,
  PlayerFlag,
  TICK_MS,
} from '@stickyclaude/shared';
import type { ObjSnap, PlayerSnap, ProjSnap, Snapshot } from '@stickyclaude/shared';

const RING = 32;
/** Extrapolation maximale quand le snapshot suivant manque (≈ 100 ms). */
const MAX_EXTRAPOLATE_TICKS = 6;
/** Au-delà de cet écart entre deux snapshots, c'est une téléportation : on n'interpole pas. */
const TELEPORT_DIST = 64;

export interface RemoteView {
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  anim: number;
  animProg: number;
  variant: number;
  hp: number;
  weapon: number;
  ammo: number;
  aim: number;
  extrapolating: boolean;
}

/** Objet dynamique (arme au sol, caisse, ballon, punaise, mine, boule) à dessiner. */
export interface ObjView {
  uid: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  b: number;
}

/** Projectile à dessiner. */
export interface ProjView {
  uid: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  a: number;
}

export function createObjView(): ObjView {
  return { uid: 0, type: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, b: 0 };
}

export function createProjView(): ProjView {
  return { uid: 0, type: 0, x: 0, y: 0, vx: 0, vy: 0, owner: 0, a: 0 };
}

export function createRemoteView(): RemoteView {
  return {
    slot: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    flags: 0,
    anim: 0,
    animProg: 0,
    variant: 0,
    hp: 0,
    weapon: 0,
    ammo: 0,
    aim: 0,
    extrapolating: false,
  };
}

/**
 * Tampon d'interpolation des autres joueurs : anneau de snapshots (réutilisés, sans allocation) et
 * échantillonnage à un tick de rendu donné.
 */
export class SnapshotBuffer {
  private readonly ring: Snapshot[] = [];
  private count = 0;
  private head = 0;

  constructor() {
    for (let i = 0; i < RING; i++) this.ring.push(createSnapshot());
  }

  /** Vrai si un snapshot de ce tick serait accepté (plus récent que le dernier). */
  accepts(tick: number): boolean {
    return this.count === 0 || tick > this.newest().tick;
  }

  /**
   * Snapshot libre dans lequel décoder le prochain message. L'anneau plein, c'est le plus ancien
   * qui est écrasé : l'appelant vérifie `accepts(tick)` avant de réserver.
   */
  next(): Snapshot {
    return this.ring[this.head];
  }

  /** Valide le snapshot rempli via `next()`. Retourne faux s'il est plus ancien que le dernier. */
  commit(): boolean {
    const s = this.ring[this.head];
    if (this.count > 0 && s.tick <= this.newest().tick) return false;
    this.head = (this.head + 1) % RING;
    if (this.count < RING) this.count++;
    return true;
  }

  get size(): number {
    return this.count;
  }

  /** i-ème plus ancien snapshot (0 = le plus ancien). */
  at(i: number): Snapshot {
    return this.ring[(this.head - this.count + i + RING) % RING];
  }

  newest(): Snapshot {
    return this.at(this.count - 1);
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  private static find(s: Snapshot, slot: number): PlayerSnap | null {
    for (let i = 0; i < s.playerCount; i++) if (s.players[i].slot === slot) return s.players[i];
    return null;
  }

  /** Durée (ms) couverte par le tampon, de l'ancien au récent. */
  spanMs(): number {
    return this.count < 2 ? 0 : (this.newest().tick - this.at(0).tick) * TICK_MS;
  }

  /**
   * Position interpolée d'un joueur au tick de rendu `renderTick` (flottant). Retourne faux s'il
   * n'est pas visible à cet instant.
   */
  sample(renderTick: number, slot: number, out: RemoteView): boolean {
    if (this.count === 0) return false;
    // Cherche b = premier snapshot dont le tick >= renderTick.
    let bi = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.at(i).tick >= renderTick) {
        bi = i;
        break;
      }
    }
    out.extrapolating = false;
    if (bi < 0) {
      // Plus récent que tout : extrapolation limitée à partir du dernier snapshot.
      const a = this.newest();
      const pa = SnapshotBuffer.find(a, slot);
      if (!pa) return false;
      copy(pa, out);
      const dt = Math.min(renderTick - a.tick, MAX_EXTRAPOLATE_TICKS);
      if (dt > 0) {
        out.x = pa.x + (pa.vx * dt * TICK_MS) / 1000;
        out.y = pa.y + (pa.vy * dt * TICK_MS) / 1000;
        out.extrapolating = true;
      }
      return true;
    }
    const b = this.at(bi);
    const pb = SnapshotBuffer.find(b, slot);
    if (bi === 0) {
      if (!pb) return false;
      copy(pb, out);
      return true;
    }
    const a = this.at(bi - 1);
    const pa = SnapshotBuffer.find(a, slot);
    if (!pb) return false;
    if (!pa) {
      copy(pb, out);
      return true;
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTick - a.tick) / span)) : 1;
    if (Math.abs(pb.x - pa.x) > TELEPORT_DIST || Math.abs(pb.y - pa.y) > TELEPORT_DIST) {
      copy(t < 0.5 ? pa : pb, out);
      return true;
    }
    copy(t < 0.5 ? pa : pb, out);
    out.x = pa.x + (pb.x - pa.x) * t;
    out.y = pa.y + (pb.y - pa.y) * t;
    out.vx = pa.vx + (pb.vx - pa.vx) * t;
    out.vy = pa.vy + (pb.vy - pa.vy) * t;
    return true;
  }

  /**
   * Encadre `renderTick` : retourne l'indice du snapshot suivant (ou -1 s'il n'y en a pas) et la
   * fraction écoulée entre le précédent et lui.
   */
  private bracket(renderTick: number): { bi: number; t: number } {
    this.br.bi = -1;
    this.br.t = 1;
    for (let i = 0; i < this.count; i++) {
      if (this.at(i).tick >= renderTick) {
        this.br.bi = i;
        break;
      }
    }
    if (this.br.bi > 0) {
      const a = this.at(this.br.bi - 1);
      const b = this.at(this.br.bi);
      const span = b.tick - a.tick;
      this.br.t = span > 0 ? Math.min(1, Math.max(0, (renderTick - a.tick) / span)) : 1;
    }
    return this.br;
  }

  private readonly br = { bi: -1, t: 1 };

  /** Objets dynamiques au tick de rendu, interpolés par identifiant. Retourne leur nombre. */
  sampleObjects(renderTick: number, out: ObjView[]): number {
    if (this.count === 0) return 0;
    const { bi, t } = this.bracket(renderTick);
    let n = 0;
    if (bi < 0) {
      const a = this.newest();
      const dt = Math.min(Math.max(0, renderTick - a.tick), MAX_EXTRAPOLATE_TICKS);
      for (let i = 0; i < a.objectCount && n < MAX_OBJECTS; i++) {
        const o = a.objects[i];
        const v = out[n++];
        copyObj(o, v);
        v.x = o.x + (o.vx * dt * TICK_MS) / 1000;
        v.y = o.y + (o.vy * dt * TICK_MS) / 1000;
      }
      return n;
    }
    const b = this.at(bi);
    const a = bi > 0 ? this.at(bi - 1) : null;
    for (let i = 0; i < b.objectCount && n < MAX_OBJECTS; i++) {
      const ob = b.objects[i];
      const v = out[n++];
      copyObj(ob, v);
      const oa = a ? findUid(a.objects, a.objectCount, ob.uid) : null;
      if (oa && Math.abs(ob.x - oa.x) < TELEPORT_DIST && Math.abs(ob.y - oa.y) < TELEPORT_DIST) {
        v.x = oa.x + (ob.x - oa.x) * t;
        v.y = oa.y + (ob.y - oa.y) * t;
      }
    }
    // Disparus entre les deux snapshots : encore visibles dans la première moitié.
    if (a && t < 0.5) {
      for (let i = 0; i < a.objectCount && n < MAX_OBJECTS; i++) {
        const oa = a.objects[i];
        if (findUid(b.objects, b.objectCount, oa.uid)) continue;
        copyObj(oa, out[n++]);
      }
    }
    return n;
  }

  /** Projectiles au tick de rendu, interpolés par identifiant. Retourne leur nombre. */
  sampleProjectiles(renderTick: number, out: ProjView[]): number {
    if (this.count === 0) return 0;
    const { bi, t } = this.bracket(renderTick);
    let n = 0;
    if (bi < 0) {
      const a = this.newest();
      const dt = Math.min(Math.max(0, renderTick - a.tick), MAX_EXTRAPOLATE_TICKS);
      for (let i = 0; i < a.projCount && n < MAX_PROJECTILES; i++) {
        const o = a.projectiles[i];
        const v = out[n++];
        copyProj(o, v);
        v.x = o.x + (o.vx * dt * TICK_MS) / 1000;
        v.y = o.y + (o.vy * dt * TICK_MS) / 1000;
      }
      return n;
    }
    const b = this.at(bi);
    const a = bi > 0 ? this.at(bi - 1) : null;
    for (let i = 0; i < b.projCount && n < MAX_PROJECTILES; i++) {
      const pb = b.projectiles[i];
      const pa = a ? findUid(a.projectiles, a.projCount, pb.uid) : null;
      const v = out[n++];
      copyProj(pb, v);
      if (pa) {
        v.x = pa.x + (pb.x - pa.x) * t;
        v.y = pa.y + (pb.y - pa.y) * t;
      } else if (t < 1) {
        // Apparu entre les deux snapshots : on le remonte le long de sa vitesse jusqu'à son tir.
        const back = (1 - t) * (b.tick - (a ? a.tick : b.tick)) * (TICK_MS / 1000);
        v.x = pb.x - pb.vx * back;
        v.y = pb.y - pb.vy * back;
      }
    }
    return n;
  }

  /** Emplacements présents dans le dernier snapshot reçu. */
  presentSlots(out: Uint8Array): number {
    if (this.count === 0) return 0;
    const s = this.newest();
    let n = 0;
    for (let i = 0; i < s.playerCount && n < MAX_PLAYERS; i++) out[n++] = s.players[i].slot;
    return n;
  }
}

function copy(p: PlayerSnap, out: RemoteView): void {
  out.slot = p.slot;
  out.x = p.x;
  out.y = p.y;
  out.vx = p.vx;
  out.vy = p.vy;
  out.flags = p.flags;
  out.anim = p.anim;
  out.animProg = p.animProg;
  out.variant = p.variant;
  out.hp = p.hp;
  out.weapon = p.weapon;
  out.ammo = p.ammo;
  out.aim = p.aim;
}

export const FLAG_ALIVE = PlayerFlag.ALIVE;

function findUid<T extends { uid: number }>(list: T[], count: number, uid: number): T | null {
  for (let i = 0; i < count; i++) if (list[i].uid === uid) return list[i];
  return null;
}

function copyObj(o: ObjSnap, v: ObjView): void {
  v.uid = o.uid;
  v.type = o.type;
  v.x = o.x;
  v.y = o.y;
  v.vx = o.vx;
  v.vy = o.vy;
  v.a = o.a;
  v.b = o.b;
}

function copyProj(o: ProjSnap, v: ProjView): void {
  v.uid = o.uid;
  v.type = o.type;
  v.x = o.x;
  v.y = o.y;
  v.vx = o.vx;
  v.vy = o.vy;
  v.owner = o.owner;
  v.a = o.a;
}
