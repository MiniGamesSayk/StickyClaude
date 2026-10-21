import { describe, expect, it } from 'vitest';
import {
  ARENAS,
  Cell,
  CELL,
  getArena,
  GRID_H,
  GRID_W,
  gridToRows,
  MAX_PLAYERS,
  parseGrid,
} from '../src/index.ts';
import { arenaSchema, parseArena } from '../src/schemas.ts';

describe('arènes', () => {
  it('au moins deux arènes de test sont embarquées', () => {
    expect(Object.keys(ARENAS).length).toBeGreaterThanOrEqual(2);
    expect(getArena('nope')).toBeUndefined();
    expect(getArena('__proto__')).toBeUndefined();
  });

  for (const [id, arena] of Object.entries(ARENAS)) {
    describe(id, () => {
      it('respecte le schéma', () => {
        expect(() => parseArena(arena)).not.toThrow();
        expect(arena.id).toBe(id);
      });

      it('a une grille cohérente (aller-retour)', () => {
        const cells = parseGrid(arena.grid);
        expect(cells.length).toBe(GRID_W * GRID_H);
        expect(gridToRows(cells)).toEqual(arena.grid);
      });

      it('a au moins 8 points d apparition libres, au-dessus d un appui', () => {
        const cells = parseGrid(arena.grid);
        expect(arena.spawns.players.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
        const set = new Set<string>();
        for (const [x, y] of arena.spawns.players) {
          set.add(`${x},${y}`);
          // cellule d'apparition et celle du dessus libres (joueur de 1,8 cellule)
          expect(cells[y * GRID_W + x]).toBe(Cell.EMPTY);
          expect(cells[(y - 1) * GRID_W + x]).toBe(Cell.EMPTY);
          // un appui plein ou à sens unique sous les pieds
          const below = cells[(y + 1) * GRID_W + x];
          expect([Cell.SOLID, Cell.PAPER, Cell.ONEWAY]).toContain(below);
        }
        expect(set.size).toBe(arena.spawns.players.length);
      });

      it('place les armes dans des cellules libres', () => {
        const cells = parseGrid(arena.grid);
        for (const [x, y] of arena.spawns.weapons) {
          expect(cells[y * GRID_W + x]).toBe(Cell.EMPTY);
        }
      });

      it('garde les plateformes mobiles dans la page', () => {
        for (const m of arena.movers) {
          for (const [x, y] of m.path) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(x + m.rect[2]).toBeLessThanOrEqual(GRID_W);
            expect(y + m.rect[3]).toBeLessThanOrEqual(GRID_H);
          }
          expect(m.rect[2] * CELL).toBeGreaterThan(0);
        }
      });
    });
  }

  it('le schéma rejette une grille mal dimensionnée ou des caractères inconnus', () => {
    const base = structuredClone(ARENAS['test-flat']);
    expect(arenaSchema.safeParse({ ...base, grid: base.grid.slice(1) }).success).toBe(false);
    const bad = base.grid.slice();
    bad[3] = bad[3].slice(1) + 'X';
    expect(arenaSchema.safeParse({ ...base, grid: bad }).success).toBe(false);
    expect(
      arenaSchema.safeParse({ ...base, spawns: { ...base.spawns, players: [[1, 1]] } }).success,
    ).toBe(false);
    expect(arenaSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(
      arenaSchema.safeParse({
        ...base,
        movers: [
          {
            rect: [1, 1, 2, 1],
            path: [
              [5, 5],
              [6, 6],
            ],
            period: 2,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
