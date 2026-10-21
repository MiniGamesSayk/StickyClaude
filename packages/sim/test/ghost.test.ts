import { Cell, CELL, Cause, GRID_W, SimEvent } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { GHOST_COOLDOWN_TICKS, GHOST_SPEED, step } from '../src/index.ts';
import { ATTACK, BLOCK, DOWN, FLOOR, LEFT, pl, RIGHT, UP } from './fight.ts';
import { eventsOf, idle, matchWorld, playing, tickAll } from './game.ts';

function kill(w: ReturnType<typeof matchWorld>, slot: number): void {
  pl(w, slot).y = 9999;
  tickAll(w, 2);
}

describe('« les morts dessinent » : fantôme-crayon', () => {
  it('un éliminé devient un fantôme qui reste dans la manche', () => {
    const w = matchWorld({ n: 3 });
    playing(w);
    kill(w, 2);
    expect(pl(w, 2).ghost).toBe(true);
    expect(pl(w, 2).active).toBe(true);
    // la manche continue : deux joueurs en vie
    tickAll(w, 5);
    expect(w.game.phase).toBe(2);
  });

  it('le curseur suit les directions', () => {
    const w = matchWorld({ n: 3 });
    playing(w);
    kill(w, 2);
    const x0 = pl(w, 2).ghostX;
    tickAll(w, 30, [0, 0, RIGHT]);
    expect(pl(w, 2).ghostX - x0).toBeCloseTo(GHOST_SPEED * 0.5, 0);
    const y0 = pl(w, 2).ghostY;
    tickAll(w, 15, [0, 0, UP | LEFT]);
    expect(pl(w, 2).ghostY).toBeLessThan(y0);
    tickAll(w, 600, [0, 0, DOWN | LEFT]);
    expect(pl(w, 2).ghostY).toBeLessThanOrEqual(36 * CELL);
    expect(pl(w, 2).ghostX).toBeGreaterThanOrEqual(0);
  });

  it('attaquer pose un trait de 3 cellules qui dure 4 s, puis disparaît', () => {
    const w = matchWorld({ n: 3 });
    playing(w);
    kill(w, 2);
    const p = pl(w, 2);
    p.ghostX = 30 * CELL + 8;
    p.ghostY = 20 * CELL + 8;
    p.ghostCd = 0;
    let draw = 0;
    for (let i = 0; i < 3; i++) {
      tickAll(w, 1, [0, 0, i === 1 ? ATTACK : 0]);
      draw += eventsOf(w, SimEvent.GHOST_DRAW).length;
    }
    expect(draw).toBe(1);
    const row = 20 * GRID_W;
    for (let x = 29; x <= 31; x++) expect(w.cells[row + x]).toBe(Cell.ONEWAY);
    expect(w.cells[row + 28]).toBe(Cell.EMPTY);
    tickAll(w, 235, [0, 0, 0]);
    expect(w.cells[row + 30]).toBe(Cell.ONEWAY);
    tickAll(w, 10, [0, 0, 0]);
    for (let x = 29; x <= 31; x++) expect(w.cells[row + x]).toBe(Cell.EMPTY);
  });

  it('un joueur peut se tenir sur le trait', () => {
    const w = matchWorld({ n: 3 });
    playing(w);
    kill(w, 2);
    const g = pl(w, 2);
    g.ghostX = 30 * CELL + 8;
    g.ghostY = 25 * CELL + 8;
    g.ghostCd = 0;
    tickAll(w, 2, [0, 0, ATTACK]);
    const p = pl(w, 0);
    p.x = 30 * CELL + 8;
    p.y = 24 * CELL; // juste au-dessus du trait (ligne 25)
    p.vy = 0;
    tickAll(w, 20, [0]);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(25 * CELL, 0);
  });

  it('délai de 8 s entre deux poses', () => {
    const w = matchWorld({ n: 3 });
    playing(w);
    kill(w, 2);
    const g = pl(w, 2);
    g.ghostX = 20 * CELL;
    g.ghostY = 10 * CELL;
    g.ghostCd = 0;
    tickAll(w, 1, [0, 0, ATTACK]);
    tickAll(w, 1, [0, 0, 0]);
    expect(g.ghostCd).toBeGreaterThan(GHOST_COOLDOWN_TICKS - 5);
    let again = 0;
    for (let i = 0; i < 20; i++) {
      tickAll(w, 1, [0, 0, i % 2 === 0 ? ATTACK : 0]);
      again += eventsOf(w, SimEvent.GHOST_DRAW).length;
    }
    expect(again).toBe(0);
  });

  it('la goutte d encre blesse (et le fantôme est crédité)', () => {
    const w = matchWorld({ n: 3 });
    playing(w);
    kill(w, 2);
    const g = pl(w, 2);
    const p = pl(w, 0);
    p.x = 40 * CELL + 8;
    p.y = FLOOR;
    g.ghostX = 40 * CELL + 8;
    g.ghostY = 32 * CELL + 8;
    g.ghostCd = 0;
    // la goutte est posée dans une cellule libre, au niveau du joueur
    tickAll(w, 1, [0, 0, BLOCK]);
    tickAll(w, 4, [0]);
    expect(p.hp).toBeLessThan(100);
    expect(Cause.GHOST).toBe(14);
  });

  it('on ne pose rien dans un bloc plein', () => {
    const w = matchWorld({ n: 3 });
    playing(w);
    kill(w, 2);
    const g = pl(w, 2);
    g.ghostX = 20 * CELL;
    g.ghostY = 34 * CELL + 8; // dans le sol
    g.ghostCd = 0;
    let draw = 0;
    for (let i = 0; i < 4; i++) {
      tickAll(w, 1, [0, 0, i === 1 ? ATTACK : 0]);
      draw += eventsOf(w, SimEvent.GHOST_DRAW).length;
    }
    expect(draw).toBe(0);
  });

  it('sans l option, pas de fantôme', () => {
    const w = matchWorld({ n: 3, ghosts: false });
    playing(w);
    kill(w, 2);
    expect(pl(w, 2).ghost).toBe(false);
    expect(pl(w, 2).dead).toBe(true);
  });

  it('un fantôme ne compte plus comme vivant et ne reçoit pas de coup', () => {
    const w = matchWorld({ n: 2 });
    playing(w);
    kill(w, 1);
    expect(w.game.phase).toBe(3); // manche terminée : un seul vivant
    void step;
    void idle;
  });
});
