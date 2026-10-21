import { Cell, CELL, GRID_H, GRID_W } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { MAX_RAGDOLLS, Ragdoll, RagdollPool } from '../src/render/ragdoll.ts';
import { J, JOINT_COUNT, Rig, createPoseInput } from '../src/render/skeleton.ts';

const FLOOR_ROW = 30;

function level(): Uint8Array {
  const cells = new Uint8Array(GRID_W * GRID_H);
  for (let x = 0; x < GRID_W; x++) {
    for (let y = FLOOR_ROW; y < GRID_H; y++) cells[y * GRID_W + x] = Cell.SOLID;
  }
  // deux murs
  for (let y = 0; y < GRID_H; y++) {
    cells[y * GRID_W] = Cell.SOLID;
    cells[y * GRID_W + GRID_W - 1] = Cell.SOLID;
  }
  return cells;
}

/** Points du squelette debout au monde, posé à (x, y). */
function standing(x: number, y: number): Float32Array {
  const rig = new Rig();
  const p = createPoseInput();
  for (let i = 0; i < 20; i++) rig.update(p, () => 3);
  const out = new Float32Array(JOINT_COUNT * 2);
  for (let i = 0; i < JOINT_COUNT; i++) {
    out[i * 2] = x + rig.joints[i * 2];
    out[i * 2 + 1] = y + rig.joints[i * 2 + 1];
  }
  return out;
}

function dist(r: Ragdoll, a: number, b: number): number {
  return Math.hypot(r.pos[a * 2] - r.pos[b * 2], r.pos[a * 2 + 1] - r.pos[b * 2 + 1]);
}

function spawn(vx: number, vy: number, x = 500): Ragdoll {
  const r = new Ragdoll();
  r.spawn(standing(x, FLOOR_ROW * CELL), vx, vy, 0x1f4fd1, 0, 0, 1, 1, 7);
  return r;
}

describe('Ragdoll', () => {
  it('reste fini, dans la page et sans pénétrer le sol, avec des os de longueur stable', () => {
    const cells = level();
    const r = spawn(260, -300);
    for (let i = 0; i < 4 * 60; i++) {
      r.step(1 / 60, cells);
      for (let k = 0; k < JOINT_COUNT * 2; k++) expect(Number.isFinite(r.pos[k])).toBe(true);
    }
    for (let k = 0; k < JOINT_COUNT; k++) {
      expect(r.pos[k * 2 + 1]).toBeLessThanOrEqual(FLOOR_ROW * CELL + 1);
      expect(r.pos[k * 2]).toBeGreaterThan(CELL - 1);
    }
    expect(dist(r, J.PEL, J.KNR)).toBeGreaterThan(5.8 * 0.75);
    expect(dist(r, J.PEL, J.KNR)).toBeLessThan(5.8 * 1.25);
    expect(dist(r, J.SHR, J.ELR)).toBeGreaterThan(5 * 0.75);
    expect(dist(r, J.SHR, J.ELR)).toBeLessThan(5 * 1.25);
  });

  it('l’impulsion du KO pousse le corps dans son sens', () => {
    const cells = level();
    const right = spawn(300, -100, 400);
    const left = spawn(-300, -100, 400);
    for (let i = 0; i < 30; i++) {
      right.step(1 / 60, cells);
      left.step(1 / 60, cells);
    }
    expect(right.pos[J.PEL * 2]).toBeGreaterThan(420);
    expect(left.pos[J.PEL * 2]).toBeLessThan(380);
  });

  it('finit par se poser (vitesse presque nulle)', () => {
    const cells = level();
    const r = spawn(150, -200);
    for (let i = 0; i < 6 * 60; i++) r.step(1 / 60, cells);
    let v = 0;
    for (let k = 0; k < JOINT_COUNT * 2; k++) v = Math.max(v, Math.abs(r.pos[k] - r.prev[k]));
    expect(v).toBeLessThan(0.35);
  });

  it('une plateforme à sens unique le retient quand il tombe dessus', () => {
    const cells = level();
    for (let x = 20; x < 40; x++) cells[20 * GRID_W + x] = Cell.ONEWAY;
    const r = new Ragdoll();
    r.spawn(standing(480, 17 * CELL), 0, 0, 0x1f4fd1, 0, 0, 1, 1, 7);
    for (let i = 0; i < 3 * 60; i++) r.step(1 / 60, cells);
    expect(r.pos[J.FTR * 2 + 1]).toBeLessThan(20 * CELL + 2);
  });

  it('rature à 1,2 s puis s’efface et se libère', () => {
    const cells = level();
    const r = spawn(0, 0);
    expect(r.alpha).toBe(1);
    for (let i = 0; i < 3 * 60; i++) r.step(1 / 60, cells);
    expect(r.alpha).toBeLessThan(1);
    expect(r.done).toBe(false);
    for (let i = 0; i < 1.5 * 60; i++) r.step(1 / 60, cells);
    expect(r.done).toBe(true);
  });

  it('tombe hors de la page sans boucler à l’infini', () => {
    const cells = new Uint8Array(GRID_W * GRID_H);
    const r = spawn(0, 0);
    for (let i = 0; i < 5 * 60; i++) r.step(1 / 60, cells);
    for (let k = 0; k < JOINT_COUNT; k++) expect(r.pos[k * 2 + 1]).toBeLessThanOrEqual(576 + 81);
  });

  it('la réserve recycle le plus ancien au-delà de 8', () => {
    const pool = new RagdollPool();
    const cells = level();
    const first = pool.acquire();
    first.spawn(standing(300, FLOOR_ROW * CELL), 0, 0, 1, 0, 0, 0, 1, 1);
    pool.step(1, cells);
    for (let i = 1; i < MAX_RAGDOLLS; i++) {
      const r = pool.acquire();
      r.spawn(standing(300 + i * 20, FLOOR_ROW * CELL), 0, 0, 1, 0, 0, i, 1, 1);
    }
    expect(pool.count).toBe(MAX_RAGDOLLS);
    expect(pool.acquire()).toBe(first);
  });
});
