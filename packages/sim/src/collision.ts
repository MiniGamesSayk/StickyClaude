import { Cell, CELL, GRID_H, GRID_W } from '@stickyclaude/shared';
import type { Player, World } from './world.ts';

/**
 * Collisions boîte/grille et boîte/plateformes mobiles. Aucune allocation.
 *
 * Convention : un joueur est une boîte [x - w/2, x + w/2] × [y - h, y], l'axe y pointe vers le bas.
 * Les déplacements sont des balayages exacts par axe : pas d'effet tunnel, quelle que soit la
 * vitesse. EPS absorbe les erreurs d'arrondi quand une arête tombe pile sur une frontière.
 */

export const EPS = 1e-3;
/** Distance de sonde sous les pieds pour savoir si l'on est posé. */
export const PROBE = 0.05;

export function cellAt(world: World, cx: number, cy: number): number {
  if (cx < 0 || cx >= GRID_W) return Cell.SOLID;
  if (cy < 0 || cy >= GRID_H) return Cell.EMPTY;
  return world.cells[cy * GRID_W + cx];
}

export function isBlocking(t: number): boolean {
  return t === Cell.SOLID || t === Cell.PAPER;
}

export function bodyHeight(world: World, p: Player): number {
  return p.crouching ? world.params.crouchHeight : world.params.height;
}

/** Vrai si une cellule pleine chevauche le rectangle [l, r) × [t, b). */
export function rectBlocked(world: World, l: number, t: number, r: number, b: number): boolean {
  const c0 = Math.floor((l + EPS) / CELL);
  const c1 = Math.floor((r - EPS) / CELL);
  const r0 = Math.floor((t + EPS) / CELL);
  const r1 = Math.floor((b - EPS) / CELL);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (isBlocking(cellAt(world, cx, cy))) return true;
    }
  }
  return false;
}

/** Peut-on se tenir debout ici ? (utilisé pour se relever après s'être accroupi) */
export function hasHeadroom(world: World, p: Player): boolean {
  const hw = world.params.width * 0.5;
  return !rectBlocked(
    world,
    p.x - hw,
    p.y - world.params.height,
    p.x + hw,
    p.y - world.params.crouchHeight,
  );
}

/** Contact avec un mur à gauche (-1) ou à droite (+1) dans l'air ; 0 sinon. `pref` départage. */
export function wallContact(world: World, p: Player, pref: number): number {
  const hw = world.params.width * 0.5;
  const t = p.y - bodyHeight(world, p);
  const left = rectBlocked(world, p.x - hw - 0.5, t, p.x - hw, p.y);
  const right = rectBlocked(world, p.x + hw, t, p.x + hw + 0.5, p.y);
  if (left && right) return pref;
  return left ? -1 : right ? 1 : 0;
}

export const GROUND_SOLID = 1;
export const GROUND_ONEWAY = 2;

/**
 * Sonde sous les pieds dans la grille. Retourne un masque (GROUND_SOLID | GROUND_ONEWAY).
 * Les plateformes à sens unique sont ignorées pendant la traversée (`dropTimer`).
 */
export function probeGround(world: World, p: Player): number {
  const hw = world.params.width * 0.5;
  const b = p.y;
  const cl = Math.floor((p.x - hw + EPS) / CELL);
  const cr = Math.floor((p.x + hw - EPS) / CELL);
  const row = Math.floor((b + PROBE) / CELL);
  let mask = 0;
  for (let cx = cl; cx <= cr; cx++) {
    const t = cellAt(world, cx, row);
    if (isBlocking(t)) mask |= GROUND_SOLID;
    else if (t === Cell.ONEWAY && b <= row * CELL + PROBE && p.dropTimer === 0) {
      mask |= GROUND_ONEWAY;
    }
  }
  return mask;
}

/** Indice de la plateforme mobile sur laquelle le joueur est posé, -1 sinon. */
export function probeMover(world: World, p: Player): number {
  if (p.dropTimer > 0) return -1;
  const hw = world.params.width * 0.5;
  const l = p.x - hw;
  const r = p.x + hw;
  for (let i = 0; i < world.moverCount; i++) {
    const m = world.movers[i];
    if (l < m.x + m.w - EPS && r > m.x + EPS && Math.abs(p.y - m.y) <= 0.1) return i;
  }
  return -1;
}

/** Déplace en x. Retourne vrai si un mur a arrêté le mouvement. */
export function moveX(world: World, p: Player, dx: number): boolean {
  if (dx === 0) return false;
  const hw = world.params.width * 0.5;
  const top = p.y - bodyHeight(world, p);
  const r0 = Math.floor((top + EPS) / CELL);
  const r1 = Math.floor((p.y - EPS) / CELL);
  if (dx > 0) {
    const edge = p.x + hw;
    const c0 = Math.floor((edge - EPS) / CELL) + 1;
    const c1 = Math.floor((edge + dx - EPS) / CELL);
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        if (isBlocking(cellAt(world, c, r))) {
          p.x = c * CELL - hw;
          return true;
        }
      }
    }
  } else {
    const edge = p.x - hw;
    const c0 = Math.floor((edge + EPS) / CELL) - 1;
    const c1 = Math.floor((edge + dx + EPS) / CELL);
    for (let c = c0; c >= c1; c--) {
      for (let r = r0; r <= r1; r++) {
        if (isBlocking(cellAt(world, c, r))) {
          p.x = (c + 1) * CELL + hw;
          return true;
        }
      }
    }
  }
  p.x += dx;
  return false;
}

/**
 * Déplace en y. Retourne 1 si le joueur a atterri (mouvement vers le bas arrêté), -1 s'il s'est
 * cogné la tête, 0 sinon. Les plateformes à sens unique n'arrêtent que les chutes venant du haut.
 */
export function moveY(world: World, p: Player, dy: number): number {
  if (dy === 0) return 0;
  const hw = world.params.width * 0.5;
  const cl = Math.floor((p.x - hw + EPS) / CELL);
  const cr = Math.floor((p.x + hw - EPS) / CELL);
  if (dy > 0) {
    const b = p.y;
    const r0 = Math.floor((b - EPS) / CELL) + 1;
    const r1 = Math.floor((b + dy - EPS) / CELL);
    let land = Infinity;
    for (let r = r0; r <= r1 && land === Infinity; r++) {
      const canLandOneWay = p.dropTimer === 0 && b <= r * CELL + EPS;
      for (let c = cl; c <= cr; c++) {
        const t = cellAt(world, c, r);
        if (isBlocking(t) || (t === Cell.ONEWAY && canLandOneWay)) {
          land = r * CELL;
          break;
        }
      }
    }
    if (p.dropTimer === 0) {
      const l = p.x - hw;
      const rr = p.x + hw;
      for (let i = 0; i < world.moverCount; i++) {
        const m = world.movers[i];
        if (l < m.x + m.w - EPS && rr > m.x + EPS) {
          const tol = EPS + (m.dy < 0 ? -m.dy : 0);
          if (b <= m.y + tol && b + dy >= m.y && m.y < land) land = m.y;
        }
      }
    }
    if (land !== Infinity) {
      p.y = land;
      return 1;
    }
    p.y = b + dy;
    return 0;
  }
  const top = p.y - bodyHeight(world, p);
  const h = bodyHeight(world, p);
  const r0 = Math.floor((top + EPS) / CELL) - 1;
  const r1 = Math.floor((top + dy + EPS) / CELL);
  for (let r = r0; r >= r1; r--) {
    for (let c = cl; c <= cr; c++) {
      if (isBlocking(cellAt(world, c, r))) {
        p.y = (r + 1) * CELL + h;
        return -1;
      }
    }
  }
  p.y += dy;
  return 0;
}
