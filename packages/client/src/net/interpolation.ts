import { createSnapshot, MAX_PLAYERS, PlayerFlag, TICK_MS } from '@stickyclaude/shared';
import type { PlayerSnap, Snapshot } from '@stickyclaude/shared';

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
  hp: number;
  weapon: number;
  ammo: number;
  aim: number;
  extrapolating: boolean;
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

  /** Snapshot libre dans lequel décoder le prochain message. */
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
  out.hp = p.hp;
  out.weapon = p.weapon;
  out.ammo = p.ammo;
  out.aim = p.aim;
}

export const FLAG_ALIVE = PlayerFlag.ALIVE;
