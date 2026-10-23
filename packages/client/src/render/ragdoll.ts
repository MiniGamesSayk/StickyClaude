import { Cell, CELL, GRID_H, GRID_W, WORLD_H, WORLD_W } from '@stickyclaude/shared';
import { drawShape } from './draw.ts';
import type { Boil } from './draw.ts';
import { rand2 } from './noise.ts';
import { PEN_WIDTH, PenStyle } from './penStyle.ts';
import type { Pen } from './pen.ts';
import { HAT_SHAPES } from './shapes.ts';
import { BODY, J, JOINT_COUNT } from './skeleton.ts';

/**
 * Ragdoll de Verlet, purement visuel (analyse §2.7) : 13 points reliés par des contraintes de
 * distance (les os) et de flexion (renforts entre points non adjacents), collisions contre la
 * grille, impulsion initiale donnée par l'événement KO. Au bout de 1,2 s, le corps est raturé (un
 * gribouillis par-dessus), puis il s'efface. 8 au plus en même temps.
 */

export const MAX_RAGDOLLS = 8;
const GRAVITY = 1250;
const STEP = 1 / 60;
const DAMP = 0.992;
const ITER = 5;
/** Délais (s) : début de la rature, durée de la rature, début et fin de l'effacement. */
export const SCRIBBLE_AT = 1.2;
export const SCRIBBLE_DUR = 0.4;
export const FADE_AT = 2.8;
export const FADE_END = 3.5;

interface Bone {
  a: number;
  b: number;
  len: number;
  stiff: number;
}

const BONES: Bone[] = [
  { a: J.HEAD, b: J.NECK, len: 5.4, stiff: 1 },
  { a: J.NECK, b: J.SHL, len: 2.0, stiff: 1 },
  { a: J.NECK, b: J.SHR, len: 1.9, stiff: 1 },
  { a: J.NECK, b: J.PEL, len: 7.8, stiff: 1 },
  { a: J.SHL, b: J.ELL, len: BODY.upper, stiff: 1 },
  { a: J.ELL, b: J.HNL, len: BODY.fore, stiff: 1 },
  { a: J.SHR, b: J.ELR, len: BODY.upper, stiff: 1 },
  { a: J.ELR, b: J.HNR, len: BODY.fore, stiff: 1 },
  { a: J.PEL, b: J.KNL, len: BODY.thigh, stiff: 1 },
  { a: J.KNL, b: J.FTL, len: BODY.shin, stiff: 1 },
  { a: J.PEL, b: J.KNR, len: BODY.thigh, stiff: 1 },
  { a: J.KNR, b: J.FTR, len: BODY.shin, stiff: 1 },
  // renforts : le tronc ne se replie pas sur lui-même
  { a: J.SHL, b: J.SHR, len: 3.0, stiff: 0.8 },
  { a: J.SHL, b: J.PEL, len: 6.75, stiff: 0.7 },
  { a: J.SHR, b: J.PEL, len: 6.8, stiff: 0.7 },
  { a: J.HEAD, b: J.PEL, len: 13.0, stiff: 0.25 },
  { a: J.KNL, b: J.KNR, len: 3.0, stiff: 0.05 },
];

function isFree(cells: Uint8Array, gx: number, gy: number): boolean {
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return false;
  const t = cells[gy * GRID_W + gx];
  return t !== Cell.SOLID && t !== Cell.PAPER && t !== Cell.TRAMPOLINE;
}

function segP(
  pen: Pen,
  p: Float32Array,
  i: number,
  j: number,
  ww: number,
  color: number,
  al: number,
  style: number,
): void {
  pen.seg(p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], ww, color, al, style);
}

/** Un ragdoll : positions courantes et précédentes (x, y de chacun des 13 points). */
export class Ragdoll {
  active = false;
  readonly pos = new Float32Array(JOINT_COUNT * 2);
  readonly prev = new Float32Array(JOINT_COUNT * 2);
  age = 0;
  color = 0;
  style = 0;
  hat = 0;
  slot = 0;
  facing = 1;
  seed = 0;
  private acc = 0;

  spawn(
    joints: ArrayLike<number>,
    vx: number,
    vy: number,
    color: number,
    style: number,
    hat: number,
    slot: number,
    facing: number,
    seed: number,
  ): void {
    this.active = true;
    this.age = 0;
    this.acc = 0;
    this.color = color;
    this.style = style;
    this.hat = hat;
    this.slot = slot;
    this.facing = facing;
    this.seed = seed;
    for (let i = 0; i < JOINT_COUNT * 2; i++) {
      this.pos[i] = joints[i];
      // vitesse initiale = impulsion ; la tête et les mains partent un peu plus vite
      const k = i >> 1 === J.HEAD ? 1.25 : i >> 1 === J.HNL || i >> 1 === J.HNR ? 1.1 : 1;
      this.prev[i] = joints[i] - (i % 2 === 0 ? vx : vy) * STEP * k * 0.9;
    }
    // la mort fait toujours un peu tourner : léger couple sur le haut du corps
    const spin = (rand2(slot, seed, 4) - 0.5) * 2.2;
    this.prev[J.HEAD * 2] -= spin;
    this.prev[J.HNR * 2] += spin * 0.6;
  }

  /** Avance de `dtS` secondes (pas fixes de 1/60 s). */
  step(dtS: number, cells: Uint8Array): void {
    this.acc += Math.min(0.1, dtS);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.age += STEP;
      this.verlet(cells);
    }
  }

  private verlet(cells: Uint8Array): void {
    const p = this.pos;
    const q = this.prev;
    for (let i = 0; i < JOINT_COUNT * 2; i += 2) {
      const vx = (p[i] - q[i]) * DAMP;
      const vy = (p[i + 1] - q[i + 1]) * DAMP;
      q[i] = p[i];
      q[i + 1] = p[i + 1];
      p[i] += vx;
      p[i + 1] += vy + GRAVITY * STEP * STEP;
    }
    for (let it = 0; it < ITER; it++) {
      for (let k = 0; k < BONES.length; k++) {
        const b = BONES[k];
        const ia = b.a * 2;
        const ib = b.b * 2;
        const dx = p[ib] - p[ia];
        const dy = p[ib + 1] - p[ia + 1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
        const f = ((d - b.len) / d) * 0.5 * b.stiff;
        p[ia] += dx * f;
        p[ia + 1] += dy * f;
        p[ib] -= dx * f;
        p[ib + 1] -= dy * f;
      }
      this.collide(cells);
    }
  }

  private collide(cells: Uint8Array): void {
    const p = this.pos;
    const q = this.prev;
    for (let i = 0; i < JOINT_COUNT * 2; i += 2) {
      let x = p[i];
      let y = p[i + 1];
      if (x < 3) x = 3;
      if (x > WORLD_W - 3) x = WORLD_W - 3;
      if (y > WORLD_H + 80) y = WORLD_H + 80;
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      if (cx >= 0 && cx < GRID_W && cy >= 0 && cy < GRID_H) {
        const c = cells[cy * GRID_W + cx];
        const solid = c === Cell.SOLID || c === Cell.PAPER || c === Cell.TRAMPOLINE;
        if (solid) {
          // sort par le côté le plus proche qui est libre
          const left = x - cx * CELL;
          const right = (cx + 1) * CELL - x;
          const up = y - cy * CELL;
          const down = (cy + 1) * CELL - y;
          let best = Infinity;
          let dir = 0;
          if (isFree(cells, cx, cy - 1) && up < best) {
            best = up;
            dir = 0;
          }
          if (isFree(cells, cx - 1, cy) && left < best) {
            best = left;
            dir = 1;
          }
          if (isFree(cells, cx + 1, cy) && right < best) {
            best = right;
            dir = 2;
          }
          if (isFree(cells, cx, cy + 1) && down < best) {
            best = down;
            dir = 3;
          }
          if (best < Infinity) {
            if (dir === 0) {
              y = cy * CELL - 0.05;
              q[i + 1] = y + (q[i + 1] - y) * -0.15;
              q[i] += (x - q[i]) * 0.35; // frottement au sol
            } else if (dir === 1) x = cx * CELL - 0.05;
            else if (dir === 2) x = (cx + 1) * CELL + 0.05;
            else y = (cy + 1) * CELL + 0.05;
          }
        } else if (c === Cell.ONEWAY && q[i + 1] < cy * CELL + 1 && y >= cy * CELL) {
          // on tombe sur une plateforme à sens unique : on s'y pose
          y = cy * CELL - 0.05;
          q[i + 1] = y;
          q[i] += (x - q[i]) * 0.35;
        }
      }
      p[i] = x;
      p[i + 1] = y;
    }
  }

  /** Opacité du corps : 1, puis effacement. */
  get alpha(): number {
    if (this.age < FADE_AT) return 1;
    return Math.max(0, 1 - (this.age - FADE_AT) / (FADE_END - FADE_AT));
  }

  get done(): boolean {
    return this.age >= FADE_END;
  }
}

const HEAD_PTS = 9;
const headScratch = new Float32Array(HEAD_PTS * 2);
const scribbleScratch = new Float32Array(48);

/** Réserve de ragdolls. */
export class RagdollPool {
  readonly items: Ragdoll[] = Array.from({ length: MAX_RAGDOLLS }, () => new Ragdoll());

  /** Le plus ancien ragdoll, ou un libre. */
  acquire(): Ragdoll {
    let oldest = this.items[0];
    for (const r of this.items) {
      if (!r.active) return r;
      if (r.age > oldest.age) oldest = r;
    }
    return oldest;
  }

  clear(): void {
    for (const r of this.items) r.active = false;
  }

  get count(): number {
    let n = 0;
    for (const r of this.items) if (r.active) n++;
    return n;
  }

  step(dtS: number, cells: Uint8Array): void {
    for (const r of this.items) {
      if (!r.active) continue;
      r.step(dtS, cells);
      if (r.done) r.active = false;
    }
  }

  draw(pen: Pen, boil: Boil): void {
    for (const r of this.items) if (r.active) drawRagdoll(pen, r, boil);
  }
}

/** Dessine un ragdoll : os, tête à yeux en croix, accessoire, puis rature. */
export function drawRagdoll(pen: Pen, r: Ragdoll, boil: Boil): void {
  const a = r.alpha;
  if (a <= 0) return;
  const p = r.pos;
  const style = r.style;
  const w = PEN_WIDTH[style];
  segP(pen, p, J.SHL, J.ELL, w * 0.9, r.color, a * 0.88, style);
  segP(pen, p, J.ELL, J.HNL, w * 0.9, r.color, a * 0.88, style);
  segP(pen, p, J.PEL, J.KNL, w * 0.9, r.color, a * 0.88, style);
  segP(pen, p, J.KNL, J.FTL, w * 0.9, r.color, a * 0.88, style);
  segP(pen, p, J.NECK, J.PEL, w * 1.12, r.color, a, style);
  segP(pen, p, J.NECK, J.SHL, w, r.color, a, style);
  segP(pen, p, J.NECK, J.SHR, w, r.color, a, style);
  segP(pen, p, J.PEL, J.KNR, w, r.color, a, style);
  segP(pen, p, J.KNR, J.FTR, w, r.color, a, style);
  segP(pen, p, J.SHR, J.ELR, w, r.color, a, style);
  segP(pen, p, J.ELR, J.HNR, w, r.color, a, style);
  // tête
  const hx = p[J.HEAD * 2];
  const hy = p[J.HEAD * 2 + 1];
  const tilt = Math.atan2(hy - p[J.NECK * 2 + 1], hx - p[J.NECK * 2]) + Math.PI / 2;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  for (let i = 0; i < HEAD_PTS; i++) {
    const ang = (i / HEAD_PTS) * Math.PI * 2 + 0.4;
    const px = Math.cos(ang) * BODY.headR;
    const py = Math.sin(ang) * BODY.headR;
    headScratch[i * 2] = hx + px * ct - py * st;
    headScratch[i * 2 + 1] = hy + px * st + py * ct;
  }
  pen.poly(headScratch, HEAD_PTS, true, w, r.color, a, style);
  // yeux en croix
  for (let e = -1; e <= 1; e += 2) {
    const ex = hx + (e * 1.6 * ct + 0.8 * st);
    const ey = hy + (e * 1.6 * st - 0.8 * ct);
    pen.seg(ex - 0.8, ey - 0.8, ex + 0.8, ey + 0.8, 0.6, r.color, a, PenStyle.BALLPOINT, false);
    pen.seg(ex + 0.8, ey - 0.8, ex - 0.8, ey + 0.8, 0.6, r.color, a, PenStyle.BALLPOINT, false);
  }
  const hat = HAT_SHAPES[r.hat];
  if (hat) {
    drawShape(pen, hat, hx, hy, r.facing, 0, 0, tilt, 1, w * 0.8, r.color, a, style, boil);
  }
  // rature : un gribouillis en zigzag par-dessus le corps, qui se trace en SCRIBBLE_DUR
  if (r.age >= SCRIBBLE_AT) {
    const t = Math.min(1, (r.age - SCRIBBLE_AT) / SCRIBBLE_DUR);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < JOINT_COUNT; i++) {
      x0 = Math.min(x0, p[i * 2]);
      x1 = Math.max(x1, p[i * 2]);
      y0 = Math.min(y0, p[i * 2 + 1]);
      y1 = Math.max(y1, p[i * 2 + 1]);
    }
    x0 -= 4;
    x1 += 4;
    y0 -= 5;
    y1 += 3;
    const zig = 11;
    const upTo = Math.max(2, Math.floor(zig * t));
    for (let k = 0; k < upTo; k++) {
      const u = k / (zig - 1);
      const x = x0 + (x1 - x0) * (k % 2 === 0 ? 0.05 : 0.95) + (rand2(k, r.seed, 9) - 0.5) * 3;
      const y = y0 + (y1 - y0) * u + (rand2(k, r.seed, 10) - 0.5) * 2;
      scribbleScratch[k * 2] = x;
      scribbleScratch[k * 2 + 1] = y;
    }
    pen.poly(scribbleScratch, upTo, false, 2.4, r.color, a * 0.9, PenStyle.MARKER);
  }
}
