/** Masque d'entrées (16 bits). Les bits 8 à 15 sont réservés (emotes, fantôme…). */
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

export const INPUT_MASK_USED = 0xff;
