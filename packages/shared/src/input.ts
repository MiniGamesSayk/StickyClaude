/**
 * Masque d'entrées (16 bits).
 *
 * Bits 0 à 7 : boutons, envoyés par le client. Bits 12 à 15 : retard de compensation de latence en
 * ticks, ajouté par le **serveur** avant d'appeler `step` (jamais lu depuis le réseau : le masque
 * reçu est filtré par `INPUT_MASK_USED`).
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
} as const;

/** Seuls ces bits sont acceptés d'un client. */
export const INPUT_MASK_USED = 0xff;

/** Position du retard de compensation de latence (ticks, 0 à 15) dans le masque. */
export const REWIND_SHIFT = 12;
export const REWIND_MASK = 0xf;

export function withRewind(mask: number, rewindTicks: number): number {
  const r = rewindTicks < 0 ? 0 : rewindTicks > REWIND_MASK ? REWIND_MASK : rewindTicks | 0;
  return (mask & INPUT_MASK_USED) | (r << REWIND_SHIFT);
}

export function rewindOf(mask: number): number {
  return (mask >> REWIND_SHIFT) & REWIND_MASK;
}

/** Huit directions de visée, dans le sens horaire depuis la droite (l'axe y pointe vers le bas). */
export const AIM_DIRS = 8;
export const AIM_DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const AIM_DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;

/** Direction de visée (0 à 7) pour un masque de directions, ou -1 si aucune direction n'est tenue. */
export function aimFromInput(mask: number): number {
  const dx = ((mask & Input.RIGHT) !== 0 ? 1 : 0) - ((mask & Input.LEFT) !== 0 ? 1 : 0);
  const dy = ((mask & Input.DOWN) !== 0 ? 1 : 0) - ((mask & Input.UP) !== 0 ? 1 : 0);
  if (dx === 0 && dy === 0) return -1;
  if (dy === 0) return dx > 0 ? 0 : 4;
  if (dx === 0) return dy > 0 ? 2 : 6;
  if (dx > 0) return dy > 0 ? 1 : 7;
  return dy > 0 ? 3 : 5;
}
