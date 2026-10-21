/** Machine à états du joueur (une valeur par joueur et par tick, dérivée de la physique). */
export const PlayerState = {
  IDLE: 0,
  RUN: 1,
  JUMP: 2,
  FALL: 3,
  WALL_SLIDE: 4,
  CROUCH: 5,
  ATTACK: 6,
  CHARGE: 7,
  BLOCK: 8,
  STUN: 9,
  DEAD: 10,
  GHOST: 11,
} as const;
export type PlayerStateId = (typeof PlayerState)[keyof typeof PlayerState];

/** Drapeaux de joueur dans les snapshots (u16). */
export const PlayerFlag = {
  ALIVE: 1 << 0,
  FACING_RIGHT: 1 << 1,
  GROUNDED: 1 << 2,
  CROUCHING: 1 << 3,
  WALL_SLIDING: 1 << 4,
  DOUBLE_JUMP_USED: 1 << 5,
  RISING: 1 << 6,
  /** Posé sur une plateforme mobile ; son indice est dans les bits MOVER_SHIFT..+2. */
  ON_MOVER: 1 << 7,
} as const;

export const MOVER_SHIFT = 8;
export const MOVER_MASK = 7;

/** Événements de simulation (rendu, son, stats). Non fiables : recalculables côté client. */
export const SimEvent = {
  JUMP: 1,
  DOUBLE_JUMP: 2,
  WALL_JUMP: 3,
  LAND: 4,
  SPAWN: 5,
  FELL: 6,
  DROP_THROUGH: 7,
} as const;

/** Événements fiables transmis dans les snapshots jusqu'à accusé de réception. */
export const ReliableType = {
  SPAWN: 1,
  FELL: 2,
} as const;
