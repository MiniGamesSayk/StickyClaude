import { CELL, getArena, Input, MAX_PLAYERS, SimEvent } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { addPlayer, bodyHeight, createWorld, rectBlocked, step } from '../src/index.ts';
import type { Player, World } from '../src/index.ts';

export const { LEFT, RIGHT, DOWN, JUMP } = Input;

export function arena(id = 'test-flat'): ArenaData {
  const a = getArena(id);
  if (!a) throw new Error(`unknown arena ${id}`);
  return a;
}

/** Variante d'une arène avec une grille modifiée par `edit(rows)`. */
export function customArena(edit: (rows: string[][]) => void, base = 'test-flat'): ArenaData {
  const a = structuredClone(arena(base));
  const rows = a.grid.map((r) => r.split(''));
  edit(rows);
  a.grid = rows.map((r) => r.join(''));
  a.movers = [];
  return a;
}

/** Boîte vide : murs, plafond et sol seulement. */
export function boxArena(): ArenaData {
  return customArena((r) => {
    for (let y = 2; y < 33; y++) for (let x = 2; x < 62; x++) r[y][x] = '.';
    for (let y = 33; y < 36; y++) for (let x = 0; x < 64; x++) r[y][x] = '#';
  });
}

export function fill(
  rows: string[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ch: string,
): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rows[y][x] = ch;
}

/** Monde avec un joueur actif dans l'emplacement 0, posé au sol. */
export function worldWithPlayer(a: ArenaData = arena(), seed = 1): World {
  const w = createWorld(a, seed);
  addPlayer(w, 0);
  settle(w);
  return w;
}

export const inputs = new Uint16Array(MAX_PLAYERS);

export function run(w: World, ticks: number, mask = 0, slot = 0): void {
  inputs.fill(0);
  inputs[slot] = mask;
  for (let i = 0; i < ticks; i++) step(w, inputs);
}

/** Laisse tomber le joueur 0 jusqu'au sol. */
export function settle(w: World): void {
  run(w, 90, 0);
}

export function put(w: World, x: number, y: number, slot = 0): Player {
  const p = w.players[slot];
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  return p;
}

export function eventTypes(w: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.events.count; i++) out.push(w.events.type[i]);
  return out;
}

/** Exécute `ticks` pas en cumulant les types d'événements émis. */
export function runCollect(w: World, ticks: number, maskAt: (i: number) => number): Set<number> {
  const seen = new Set<number>();
  for (let i = 0; i < ticks; i++) {
    inputs.fill(0);
    inputs[0] = maskAt(i);
    step(w, inputs);
    for (const t of eventTypes(w)) seen.add(t);
  }
  return seen;
}

export function overlapsSolid(w: World, p: Player): boolean {
  const hw = w.params.width / 2;
  return rectBlocked(w, p.x - hw, p.y - bodyHeight(w, p), p.x + hw, p.y);
}

export const FLOOR_Y = 33 * CELL;
export { SimEvent };
