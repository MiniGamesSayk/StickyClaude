import { Cell, GRID_H, GRID_W } from '@stickyclaude/shared';
import { arenaSchema } from '@stickyclaude/shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  addMover,
  checkLevel,
  eraseAt,
  fillRect,
  finalizeLevel,
  floodFill,
  mirrorCells,
  mirrorRects,
  newLevel,
  placeSpawns,
  sameLevel,
  toggleSpawnAt,
} from '../src/creator/model.ts';
import { applyTool, Tool } from '../src/editor/model.ts';

describe('créateur de niveau', () => {
  it('un niveau neuf est valide : accepté par le schéma du serveur et par l’analyse', () => {
    const s = newLevel('Mon niveau');
    const check = checkLevel(s);
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(s.spawns.length).toBeGreaterThanOrEqual(8);
    const arena = finalizeLevel(s, 'niveau-test');
    expect(arenaSchema.safeParse(arena).success).toBe(true);
    expect(arena.name.fr).toBe('Mon niveau');
    expect(arena.decor).toEqual([]);
  });

  it('les apparitions automatiques suivent le terrain dessiné', () => {
    const s = newLevel('x');
    // on mure tout le sol sauf une plateforme haute : plus rien d'atteignable depuis le bas
    for (let x = 2; x < GRID_W - 2; x++) {
      s.cells[34 * GRID_W + x] = Cell.SOLID;
      s.cells[33 * GRID_W + x] = Cell.SOLID;
    }
    const n = placeSpawns(s);
    expect(n).toBeGreaterThanOrEqual(8);
    for (const [, y] of s.spawns) expect(y).toBeLessThan(33);
    expect(checkLevel(s).ok).toBe(true);
  });

  it('un terrain où personne ne peut se tenir est refusé', () => {
    const s = newLevel('x');
    s.cells.fill(Cell.SOLID);
    s.spawns = [];
    const n = placeSpawns(s);
    expect(n).toBe(0);
    expect(checkLevel(s).ok).toBe(false);
  });

  it('les pièges et objets posés restent valides', () => {
    const s = newLevel('x');
    applyTool(s, Tool.HAZARD, 30, 34);
    applyTool(s, Tool.TACK, 20, 33);
    applyTool(s, Tool.BALLOON, 25, 30);
    s.suddenDeath = 'tear-edges';
    s.theme = 'treasure-map';
    const arena = finalizeLevel(s, 'niveau-pieges');
    expect(arenaSchema.safeParse(arena).success).toBe(true);
    expect(arena.suddenDeath).toBe('tear-edges');
    expect(arena.theme).toBe('treasure-map');
    expect(arena.props.map((p) => p.type).sort()).toEqual(['balloon', 'tack']);
  });

  it('plateforme mobile : aller-retour entre deux cases, bornée à la page', () => {
    const s = newLevel('x');
    expect(addMover(s, [10, 20, 4, 1], 20, 20)).toBe(true);
    expect(addMover(s, [10, 20, 4, 1], 10, 20)).toBe(false);
    expect(addMover(s, [60, 20, 8, 1], 20, 20)).toBe(false);
    expect(s.movers).toHaveLength(1);
    expect(s.movers[0].path).toEqual([
      [10, 20],
      [20, 20],
    ]);
    const arena = finalizeLevel(s, 'niveau-mobile');
    expect(arenaSchema.safeParse(arena).success).toBe(true);
    expect(checkLevel(s).ok).toBe(true);
  });

  it('seau : remplit une zone fermée sans déborder, et ne fait rien si la case est déjà du bon type', () => {
    const s = newLevel('x');
    // une boîte fermée de 5 × 3 cases vides
    fillRect(s, 20, 10, 26, 14, Cell.SOLID);
    fillRect(s, 21, 11, 25, 13, Cell.EMPTY, true);
    const n = floodFill(s, 22, 12, Cell.PAPER);
    expect(n).toBe(5 * 3);
    expect(s.cells[12 * GRID_W + 22]).toBe(Cell.PAPER);
    expect(s.cells[10 * GRID_W + 22]).toBe(Cell.SOLID);
    expect(floodFill(s, 22, 12, Cell.PAPER)).toBe(0);
    // gomme au seau : la zone redevient vide
    expect(floodFill(s, 22, 12, Cell.EMPTY, true)).toBe(15);
  });

  it('rectangle : remplit ou vide, retire les marqueurs sous une case pleine ou gommée', () => {
    const s = newLevel('x');
    const before = s.spawns.length;
    const [sx, sy] = s.spawns[0];
    fillRect(s, sx, sy, sx, sy, Cell.SOLID);
    expect(s.spawns.length).toBe(before - 1);
    // un trou dans le sol : le vide
    fillRect(s, 30, 34, 33, 35, Cell.EMPTY, true);
    expect(s.cells[35 * GRID_W + 31]).toBe(Cell.EMPTY);
  });

  it('la gomme retire la colline, les cages et les plateformes mobiles qu’elle touche', () => {
    const s = newLevel('x');
    s.koth = [28, 20, 8, 4];
    s.goalA = [3, 28, 3, 4];
    s.goalB = [58, 28, 3, 4];
    addMover(s, [10, 12, 4, 1], 20, 12);
    eraseAt(s, 30, 21);
    expect(s.koth).toBeNull();
    expect(s.goalA).not.toBeNull();
    eraseAt(s, 4, 29);
    eraseAt(s, 59, 30);
    expect(s.goalA).toBeNull();
    expect(s.goalB).toBeNull();
    eraseAt(s, 11, 12);
    expect(s.movers).toHaveLength(0);
  });

  it('une apparition fait 2 cases de haut : la tête se clique comme les pieds', () => {
    const s = newLevel('x');
    const [x, y] = s.spawns[0];
    const n = s.spawns.length;
    eraseAt(s, x, y - 1);
    expect(s.spawns).toHaveLength(n - 1);
    toggleSpawnAt(s, x, y); // repose
    expect(s.spawns).toHaveLength(n);
    toggleSpawnAt(s, x, y - 1); // retire en cliquant la tête
    expect(s.spawns).toHaveLength(n - 1);
  });

  it('gommer du vide ne change rien : rien à inscrire à l’historique', () => {
    const s = newLevel('x');
    const before = structuredClone(s);
    eraseAt(s, 30, 10);
    expect(sameLevel(before, s)).toBe(true);
    eraseAt(s, 0, 0); // le cadre : là, il y a un vrai changement
    expect(sameLevel(before, s)).toBe(false);
  });

  it('symétrie : reflets gauche ↔ droite, haut ↕ bas, ou les deux, sans doublon', () => {
    expect(mirrorCells(10, 5, 'none')).toEqual([[10, 5]]);
    expect(mirrorCells(10, 5, 'h')).toEqual([
      [10, 5],
      [GRID_W - 11, 5],
    ]);
    expect(mirrorCells(10, 5, 'v')).toEqual([
      [10, 5],
      [10, GRID_H - 6],
    ]);
    expect(mirrorCells(10, 5, 'hv')).toHaveLength(4);
    // sur l'axe : pas de doublon
    expect(mirrorCells(GRID_W - 1 - 10, 5, 'h').length).toBe(2);
    expect(mirrorCells(31, 5, 'h')).toEqual([
      [31, 5],
      [32, 5],
    ]);
    // les objets et apparitions ne se retournent pas la tête en bas
    expect(mirrorCells(10, 5, 'hv', true)).toHaveLength(2);
    expect(mirrorCells(10, 5, 'v', true)).toEqual([[10, 5]]);
  });

  it('symétrie : un rectangle posé d’un côté est reproduit de l’autre', () => {
    const s = newLevel('x');
    for (const [x0, y0, x1, y1] of mirrorRects([5, 10, 8, 12], 'h')) {
      fillRect(s, x0, y0, x1, y1, Cell.SOLID);
    }
    for (let y = 10; y <= 12; y++) {
      for (let x = 5; x <= 8; x++) {
        expect(s.cells[y * GRID_W + x]).toBe(Cell.SOLID);
        expect(s.cells[y * GRID_W + (GRID_W - 1 - x)]).toBe(Cell.SOLID);
      }
    }
    expect(mirrorRects([5, 10, 8, 12], 'hv')).toHaveLength(4);
  });
});
