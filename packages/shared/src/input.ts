import { LAG_COMP_TICKS } from './constants.ts';

/**
 * Masque d'entrées. Le client en envoie 15 bits (un u16 sur le fil) ; la simulation en lit 21.
 *
 * Bits 0 à 7 : boutons. Bits 8 à 11 : secteur de visée (0 à 15), bit 12 : visée explicite (souris,
 * joystick), bit 13 : dash, bit 14 : attaque spéciale (clic droit). `BLOCK` (bit 6) est tenu tant
 * que le joueur garde la parade (bouton maintenu). Bits 16 à
 * 20 : retard de compensation de latence (par pas de `REWIND_STEP` ticks), ajouté par le
 * **serveur** avant d'appeler `step` (jamais lu depuis le réseau : le masque reçu est filtré par
 * `INPUT_MASK_USED`). Les tampons d'entrées de la simulation sont donc des `Uint32Array`.
 */
export const Input = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  UP: 1 << 2,
  DOWN: 1 << 3,
  JUMP: 1 << 4,
  ATTACK: 1 << 5,
  BLOCK: 1 << 6,
  PICKUP: 1 << 7,
  DASH: 1 << 13,
  SPECIAL: 1 << 14,
} as const;

/** Seuls ces bits sont acceptés d'un client. */
export const INPUT_MASK_USED = 0x7fff;

/** Visée explicite : secteur dans les bits 8 à 11, drapeau dans le bit 12. */
export const AIM_SHIFT = 8;
export const AIM_SET = 1 << 12;

/**
 * Position du retard de compensation de latence dans le masque : 5 bits (16 à 20), au tick près.
 * Les tampons de la simulation sont des `Uint32Array` : la place ne manque plus.
 */
export const REWIND_SHIFT = 16;
export const REWIND_MASK = 31;
export const REWIND_STEP = 1;

/** Retard en ticks (0 à `LAG_COMP_TICKS`) rangé dans les bits 16 à 20. */
export function withRewind(mask: number, rewindTicks: number): number {
  const q = Math.round(rewindTicks / REWIND_STEP);
  const max = Math.floor(LAG_COMP_TICKS / REWIND_STEP);
  const r = q < 0 ? 0 : q > max ? max : q;
  return (mask & INPUT_MASK_USED) | (r << REWIND_SHIFT);
}

/** Retard de compensation de latence, en ticks. */
export function rewindOf(mask: number): number {
  return ((mask >> REWIND_SHIFT) & REWIND_MASK) * REWIND_STEP;
}

/** Range un secteur de visée (0 à 15) dans un masque de boutons. */
export function withAim(mask: number, sector: number): number {
  return (mask & ~(AIM_SET | (15 << AIM_SHIFT))) | AIM_SET | ((sector & 15) << AIM_SHIFT);
}

/**
 * Seize secteurs de visée de 22,5°, dans le sens horaire depuis la droite (l'axe y pointe vers le
 * bas). Vecteurs unitaires écrits en dur : pas de `Math.cos`, qui peut différer d'un moteur à l'autre.
 */
export const AIM_DIRS = 16;
export const AIM_DX = [
  1.0, 0.92388, 0.707107, 0.382683, 0, -0.382683, -0.707107, -0.92388, -1.0, -0.92388, -0.707107,
  -0.382683, 0, 0.382683, 0.707107, 0.92388,
] as const;
export const AIM_DY = [
  0, 0.382683, 0.707107, 0.92388, 1.0, 0.92388, 0.707107, 0.382683, 0, -0.382683, -0.707107,
  -0.92388, -1.0, -0.92388, -0.707107, -0.382683,
] as const;

/** Secteur de visée (0 à 15) d'un angle en radians (0 = droite, sens horaire, y vers le bas). */
export function aimSectorOfAngle(angle: number): number {
  const s = Math.round(angle / (Math.PI / 8));
  return ((s % 16) + 16) % 16;
}

/** Direction de visée d'un masque de directions (secteurs pairs), ou -1 si aucune n'est tenue. */
export function aimFromInput(mask: number): number {
  const dx = ((mask & Input.RIGHT) !== 0 ? 1 : 0) - ((mask & Input.LEFT) !== 0 ? 1 : 0);
  const dy = ((mask & Input.DOWN) !== 0 ? 1 : 0) - ((mask & Input.UP) !== 0 ? 1 : 0);
  if (dx === 0 && dy === 0) return -1;
  if (dy === 0) return dx > 0 ? 0 : 8;
  if (dx === 0) return dy > 0 ? 4 : 12;
  if (dx > 0) return dy > 0 ? 2 : 14;
  return dy > 0 ? 6 : 10;
}

/** Secteur de visée d'un masque : la visée explicite si elle est posée, sinon les directions. */
export function aimOfInput(mask: number): number {
  if ((mask & AIM_SET) !== 0) return (mask >> AIM_SHIFT) & 15;
  return aimFromInput(mask);
}
