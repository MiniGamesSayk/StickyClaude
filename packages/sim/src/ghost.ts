import { CELL, GRID_H, GRID_W, Input, SimEvent } from '@stickyclaude/shared';
import { GhostMark, placeMark } from './terrain.ts';
import { emit } from './world.ts';
import type { Player, World } from './world.ts';

/** Vitesse du curseur du fantôme-crayon (unités/s) et délai entre deux poses (8 s). */
export const GHOST_SPEED = 240;
export const GHOST_COOLDOWN_TICKS = 8 * 60;

/**
 * Fantôme-crayon : le curseur suit les directions ; attaquer pose un trait (plateforme de 3
 * cellules, 4 s), parer pose une goutte d'encre (petit danger). Le curseur et le délai sont dans
 * l'état exact du joueur ; la pose elle-même est une décision du serveur (événement GHOST_DRAW).
 */
export function stepGhost(world: World, p: Player, slot: number, input: number): void {
  const pressed = input & ~p.prevInput;
  p.prevInput = input;
  const dx = ((input & Input.RIGHT) !== 0 ? 1 : 0) - ((input & Input.LEFT) !== 0 ? 1 : 0);
  const dy = ((input & Input.DOWN) !== 0 ? 1 : 0) - ((input & Input.UP) !== 0 ? 1 : 0);
  const n = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  const step = (GHOST_SPEED / 60) * n;
  p.ghostX = Math.max(0, Math.min(GRID_W * CELL - 1, p.ghostX + dx * step));
  p.ghostY = Math.max(0, Math.min(GRID_H * CELL - 1, p.ghostY + dy * step));
  if (p.ghostCd > 0) {
    p.ghostCd--;
    return;
  }
  if (!world.auth) return;
  const kind =
    (pressed & Input.ATTACK) !== 0 ? GhostMark.LINE : (pressed & Input.BLOCK) !== 0 ? GhostMark.DROP : -1;
  if (kind < 0) return;
  const cx = Math.floor(p.ghostX / CELL);
  const cy = Math.floor(p.ghostY / CELL);
  if (placeMark(world, kind, cx, cy, slot, world.tick)) {
    p.ghostCd = GHOST_COOLDOWN_TICKS;
    emit(world, SimEvent.GHOST_DRAW, slot, kind, cx, cy, world.tick & 0xffff, world.tick >>> 16);
  }
}
