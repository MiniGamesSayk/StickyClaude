import { CELL, COMBAT, SimEvent } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { analyzeArena } from '../src/index.ts';
import { DOWN, FLOOR, eventCount, fightWorld, pl, tick, ticks } from './fight.ts';
import { boxArena } from './helpers.ts';

/** Arène avec `ch` posé sur la case (cx, cy). */
function withCell(cx: number, cy: number, ch: string): ArenaData {
  const a = boxArena();
  const rows = a.grid.map((r) => r.split(''));
  rows[cy][cx] = ch;
  a.grid = rows.map((r) => r.join(''));
  return a;
}

describe('trampoline, lave, scie', () => {
  it('on rebondit sur un trampoline, plus haut qu’un saut, sauf en maintenant ↓', () => {
    const a = boxArena();
    const rows = a.grid.map((r) => r.split(''));
    for (let x = 20; x < 24; x++) rows[32][x] = 't';
    a.grid = rows.map((r) => r.join(''));
    const w = fightWorld({ arena: a, ghosts: false });
    const p = pl(w, 0);
    p.x = 22 * CELL;
    p.y = 32 * CELL - 120;
    p.vy = 0;
    let bounced = 0;
    let minVy = 0;
    for (let i = 0; i < 120; i++) {
      tick(w);
      bounced += eventCount(w, SimEvent.BOUNCE);
      minVy = Math.min(minVy, p.vy);
    }
    expect(bounced).toBeGreaterThanOrEqual(1);
    expect(minVy).toBeLessThanOrEqual(-COMBAT.trampolineMin + 5);
    // ↓ maintenu : on se pose sans rebondir
    const w2 = fightWorld({ arena: a, ghosts: false });
    const q = pl(w2, 0);
    q.x = 22 * CELL;
    q.y = 32 * CELL - 120;
    let again = 0;
    for (let i = 0; i < 120; i++) {
      tick(w2, DOWN);
      again += eventCount(w2, SimEvent.BOUNCE);
    }
    expect(again).toBe(0);
    expect(q.y).toBeCloseTo(32 * CELL, 0);
  });

  it('la lave fait de gros dégâts, la scie repousse sur le côté', () => {
    const lava = fightWorld({ arena: withCell(20, 32, 'l'), ghosts: false });
    const lp = pl(lava, 1);
    lp.x = 20 * CELL + CELL / 2;
    lp.y = FLOOR;
    const hp0 = lp.hp;
    ticks(lava, 3);
    expect(hp0 - lp.hp).toBe(COMBAT.lavaDamage);

    const saw = fightWorld({ arena: withCell(20, 32, 's'), ghosts: false });
    const sp = pl(saw, 1);
    sp.x = 20 * CELL + CELL / 2 + 4; // à droite du centre de la scie
    sp.y = FLOOR;
    const before = sp.hp;
    ticks(saw, 3);
    expect(before - sp.hp).toBe(COMBAT.sawDamage);
    expect(sp.vx).toBeGreaterThan(0);
  });

  it('l’analyse refuse un départ dans la lave ou une scie, et accepte le trampoline comme sol', () => {
    const a = boxArena();
    const ok = analyzeArena(a, { reach: false });
    const bad = analyzeArena(withCell(a.spawns.players[0][0], a.spawns.players[0][1], 'l'), {
      reach: false,
    });
    expect(bad.errors.length).toBeGreaterThan(ok.errors.length);
    const tr = analyzeArena(withCell(5, 33, 't'), { reach: false });
    expect(tr.errors).toEqual(ok.errors);
  });
});
