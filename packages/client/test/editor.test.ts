import { ARENAS, Cell, GRID_W } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { arenaSchema } from '@stickyclaude/shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  applyRect,
  applyTool,
  emptyState,
  fromArena,
  Tool,
  toArena,
  validate,
} from '../src/editor/model.ts';

const parse = (a: ArenaData): { ok: boolean; issues: string[] } => {
  const r = arenaSchema.safeParse(a);
  return { ok: r.success, issues: r.success ? [] : r.error.issues.map((i) => i.message) };
};

describe('éditeur d’arènes (modèle)', () => {
  it('importer puis exporter une arène existante ne change rien', () => {
    for (const [id, arena] of Object.entries(ARENAS)) {
      expect(toArena(fromArena(arena)), id).toEqual(arena);
    }
  });

  it('une arène neuve est valide et jouable (schéma + accessibilité par simulation)', () => {
    const v = validate(emptyState(), parse);
    expect(v.schema).toEqual([]);
    expect(v.analysis).toEqual([]);
    expect(v.reachable).toBe(v.standing);
  });

  it('peint les cases et pose ou retire les marqueurs d’un clic', () => {
    const s = emptyState();
    applyTool(s, Tool.PAPER, 10, 10);
    expect(s.cells[10 * GRID_W + 10]).toBe(Cell.PAPER);
    applyTool(s, Tool.ONEWAY, 11, 10);
    expect(s.cells[10 * GRID_W + 11]).toBe(Cell.ONEWAY);
    const n = s.spawns.length;
    applyTool(s, Tool.SPAWN, 20, 20);
    expect(s.spawns).toHaveLength(n + 1);
    applyTool(s, Tool.SPAWN, 20, 20);
    expect(s.spawns).toHaveLength(n);
    applyTool(s, Tool.CRATE, 5, 5);
    applyTool(s, Tool.BALLOON, 5, 5);
    expect(s.props).toEqual([{ type: 'balloon', at: [5, 5] }]);
    applyTool(s, Tool.ERASE, 5, 5);
    expect(s.props).toEqual([]);
    applyTool(s, Tool.SOLID, -3, 4);
    applyTool(s, Tool.SOLID, 4, 999);
  });

  it('une zone se définit en glissant, dans n’importe quel sens, bornée à la page', () => {
    const s = emptyState();
    applyRect(s, Tool.KOTH, 12, 8, 5, 3);
    expect(s.koth).toEqual([5, 3, 8, 6]);
    applyRect(s, Tool.GOAL_A, 62, 30, 70, 40);
    expect(s.goalA).toEqual([62, 30, 2, 6]);
  });

  it('la validation signale ce qui rendrait l’arène injouable', () => {
    const s = emptyState();
    for (let x = 0; x < GRID_W; x++) applyTool(s, Tool.SOLID, x, 34); // sol surélevé : apparitions emmurées
    const v = validate(s, parse);
    expect(v.analysis.length).toBeGreaterThan(0);
    const bad = emptyState();
    bad.id = 'Pas valide !';
    expect(validate(bad, parse).schema.length).toBeGreaterThan(0);
  });
});
