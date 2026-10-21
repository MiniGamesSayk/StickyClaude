import { Cell, CELL, GRID_H, GRID_W, SimEvent } from '@stickyclaude/shared';
import { emit } from './world.ts';
import type { World } from './world.ts';

/** Durées de vie des traits et gouttes posés par les fantômes (ticks). */
export const GHOST_LINE_TICKS = 240;
export const GHOST_DROP_TICKS = 300;
export const GhostMark = { LINE: 0, DROP: 1 } as const;

/**
 * Détruit les blocs de papier dont le centre est à moins de `r10 / 10` cellules de (cx, cy).
 * `r10 = 0` ne détruit que la cellule (cx, cy). Calcul entier : serveur et clients obtiennent le
 * même résultat à partir des mêmes entiers (événement TERRAIN). Retourne le nombre de blocs détruits.
 */
export function destroyCircle(world: World, cx: number, cy: number, r10: number): number {
  const rc = Math.ceil(r10 / 10);
  let n = 0;
  for (let y = cy - rc; y <= cy + rc; y++) {
    if (y < 0 || y >= GRID_H) continue;
    for (let x = cx - rc; x <= cx + rc; x++) {
      if (x < 0 || x >= GRID_W) continue;
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx + dy * dy) * 100 > r10 * r10) continue;
      const i = y * GRID_W + x;
      if (world.cells[i] === Cell.PAPER) {
        world.cells[i] = Cell.EMPTY;
        n++;
      }
    }
  }
  if (n > 0) world.terrainVersion++;
  return n;
}

/** Détruit le papier autour d'un point du monde et émet l'événement TERRAIN (autorité). */
export function explodeTerrain(world: World, x: number, y: number, radius: number): number {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  const r10 = Math.round((radius / CELL) * 10);
  const n = destroyCircle(world, cx, cy, r10);
  if (n > 0) emit(world, SimEvent.TERRAIN, 0, cx, cy, r10);
  return n;
}

/** Détruit la seule cellule de papier contenant le point (gomme). */
export function eraseCell(world: World, x: number, y: number): boolean {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  if (destroyCircle(world, cx, cy, 0) > 0) {
    emit(world, SimEvent.TERRAIN, 0, cx, cy, 0);
    return true;
  }
  return false;
}

/**
 * Pose un trait (3 cellules à sens unique) ou une goutte (1 cellule de danger) dans les cellules
 * vides autour de (cx, cy). L'expiration est `placeTick + durée` : le client, qui reçoit
 * l'événement avec du retard, retrouve ainsi exactement le même instant de disparition.
 */
export function placeMark(
  world: World,
  kind: number,
  cx: number,
  cy: number,
  owner: number,
  placeTick: number,
): boolean {
  let slot = -1;
  for (let i = 0; i < world.marks.length; i++) {
    if (!world.marks[i]!.active) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return false;
  const m = world.marks[slot]!;
  m.c0 = -1;
  m.c1 = -1;
  m.c2 = -1;
  const type = kind === GhostMark.LINE ? Cell.ONEWAY : Cell.HAZARD;
  const x0 = kind === GhostMark.LINE ? cx - 1 : cx;
  const x1 = kind === GhostMark.LINE ? cx + 1 : cx;
  let k = 0;
  for (let x = x0; x <= x1; x++) {
    if (x < 0 || x >= GRID_W || cy < 0 || cy >= GRID_H) continue;
    const i = cy * GRID_W + x;
    if (world.cells[i] !== Cell.EMPTY) continue;
    world.cells[i] = type;
    if (k === 0) m.c0 = i;
    else if (k === 1) m.c1 = i;
    else m.c2 = i;
    k++;
  }
  if (k === 0) return false;
  m.active = true;
  m.kind = kind;
  m.owner = owner;
  m.expire = placeTick + (kind === GhostMark.LINE ? GHOST_LINE_TICKS : GHOST_DROP_TICKS);
  world.terrainVersion++;
  return true;
}

function restore(world: World, i: number, type: number): void {
  if (i >= 0 && world.cells[i] === type) world.cells[i] = Cell.EMPTY;
}

/** Retire les traits et gouttes arrivés à expiration. */
export function stepMarks(world: World): void {
  for (let i = 0; i < world.marks.length; i++) {
    const m = world.marks[i]!;
    if (!m.active || world.tick < m.expire) continue;
    const type = m.kind === GhostMark.LINE ? Cell.ONEWAY : Cell.HAZARD;
    restore(world, m.c0, type);
    restore(world, m.c1, type);
    restore(world, m.c2, type);
    m.active = false;
    world.terrainVersion++;
  }
}

/** Pose une flaque d'encre glissante au sol. */
export function addPuddle(world: World, x: number, y: number, width: number, placeTick: number): void {
  let slot = 0;
  let oldest = Infinity;
  for (let i = 0; i < world.puddles.length; i++) {
    const p = world.puddles[i]!;
    if (!p.active) {
      slot = i;
      oldest = -1;
      break;
    }
    if (p.expire < oldest) {
      oldest = p.expire;
      slot = i;
    }
  }
  const p = world.puddles[slot]!;
  p.active = true;
  p.x0 = x - width / 2;
  p.x1 = x + width / 2;
  p.y = y;
  p.expire = placeTick + PUDDLE_TICKS;
}

export const PUDDLE_TICKS = 8 * 60;
/** Facteur appliqué aux accélérations au sol dans une flaque. */
export const PUDDLE_GRIP = 0.22;

export function stepPuddles(world: World): void {
  for (let i = 0; i < world.puddles.length; i++) {
    const p = world.puddles[i]!;
    if (p.active && world.tick >= p.expire) p.active = false;
  }
}

/** Vrai si le point (x, y) — les pieds d'un joueur au sol — est dans une flaque. */
export function inPuddle(world: World, x: number, y: number): boolean {
  for (let i = 0; i < world.puddles.length; i++) {
    const p = world.puddles[i]!;
    if (p.active && x >= p.x0 && x <= p.x1 && Math.abs(y - p.y) <= 3) return true;
  }
  return false;
}
