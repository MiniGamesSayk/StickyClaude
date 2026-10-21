/** Machine à états du joueur (une valeur par joueur et par tick, dérivée de la physique et du combat). */
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
  /** A reçu un coup à l'instant (clignotement). */
  HIT_FLASH: 1 << 11,
  /** Protégé après une apparition. */
  INVULN: 1 << 12,
  /** Porte la bombe (patate d'encre). */
  HAS_BOMB: 1 << 13,
  /** Tient un bouclier levé. */
  SHIELD_UP: 1 << 14,
  /** Vient de réussir une parade parfaite. */
  PARRY_FLASH: 1 << 15,
} as const;

export const MOVER_SHIFT = 8;
export const MOVER_MASK = 7;

/** Variante d'attaque (champ `variant` des joueurs dans les snapshots, état ATTACK). */
export const AttackKind = {
  NONE: 0,
  FIST1: 1,
  FIST2: 2,
  FIST3: 3,
  CHARGED: 4,
  KICK: 5,
  /** Coup d'une arme de mêlée. */
  WEAPON: 6,
  /** Tir : posture de recul. */
  SHOOT: 7,
  /** Lancer d'une arme ou d'un objet. */
  THROW: 8,
  /** Coup de bouclier. */
  BASH: 9,
} as const;
export type AttackKindId = (typeof AttackKind)[keyof typeof AttackKind];

/** Phase d'une attaque. */
export const AtkPhase = { NONE: 0, STARTUP: 1, ACTIVE: 2, RECOVERY: 3 } as const;

/** Causes de mort (événement KO, statistiques). */
export const Cause = {
  NONE: 0,
  MELEE: 1,
  KICK: 2,
  WEAPON_MELEE: 3,
  BULLET: 4,
  PROJECTILE: 5,
  EXPLOSION: 6,
  THROWN: 7,
  HAZARD: 8,
  FALL: 9,
  INK: 10,
  MINE: 11,
  POTATO: 12,
  BALLOON: 13,
  GHOST: 14,
  TACK: 15,
} as const;
export type CauseId = (typeof Cause)[keyof typeof Cause];

/** Phases d'une partie dans un salon. */
export const GamePhase = {
  /** Salon d'attente : arène d'entraînement, les dégâts ne comptent pas. */
  LOBBY: 0,
  COUNTDOWN: 1,
  PLAYING: 2,
  ROUND_END: 3,
  MATCH_END: 4,
} as const;
export type GamePhaseId = (typeof GamePhase)[keyof typeof GamePhase];

/** Types d'objets dynamiques (instantané : `ObjSnap.type`). */
export const ObjType = {
  WEAPON: 1,
  CRATE: 2,
  BALLOON: 3,
  TACK: 4,
  MINE: 5,
  BALL: 6,
} as const;
export type ObjTypeId = (typeof ObjType)[keyof typeof ObjType];

/** Types de projectiles. */
export const ProjType = {
  PELLET: 1,
  PLANE: 2,
  ROCKET: 3,
  ERASER: 4,
  /** Arme ou caisse lancée. */
  THROWN: 5,
} as const;
export type ProjTypeId = (typeof ProjType)[keyof typeof ProjType];

/** Drapeaux de statut dans le bloc « own » (u8). */
export const StatusFlag = {
  GHOST: 1 << 0,
  DEAD: 1 << 1,
  HAS_BOMB: 1 << 2,
  KICKING: 1 << 3,
} as const;

/**
 * Événements de simulation. Les événements « réseau » sont aussi les événements fiables : leur
 * charge utile est `u8 slot` puis un entier de 16 bits par argument (voir `EVENT_SPECS`).
 * Les autres (mouvement) restent locaux : le client les recalcule pour son propre joueur.
 */
export const SimEvent = {
  JUMP: 1,
  DOUBLE_JUMP: 2,
  WALL_JUMP: 3,
  LAND: 4,
  SPAWN: 5,
  DROP_THROUGH: 7,
  HIT: 8,
  KO: 9,
  BLOCKED: 10,
  SHOT: 13,
  PICKUP: 14,
  THROW: 15,
  WEAPON_SPAWN: 16,
  EXPLOSION: 18,
  TERRAIN: 19,
  EMOTE: 20,
  GHOST_DRAW: 21,
  PUDDLE: 22,
  STAMP: 23,
  GRAPPLE: 24,
  CRATE_BREAK: 25,
  GOAL: 28,
  SUDDEN_DEATH: 29,
  /** Début d'une attaque (son, effet) : uniquement local au client pour son propre joueur. */
  SWING: 30,
  /** Événements de déroulement de partie : consommés par le salon (messages JSON), jamais binaires. */
  ROUND_START: 40,
  ROUND_END: 41,
  MATCH_END: 42,
} as const;
export type SimEventId = (typeof SimEvent)[keyof typeof SimEvent];

/**
 * Format des événements réseau : un caractère par argument.
 * `p` position (i16, 1/8 d'unité) · `i` entier signé 16 bits · `u` entier non signé 16 bits.
 * Absent de la table = événement local, jamais transmis.
 */
export const EVENT_SPECS: Readonly<Record<number, string>> = {
  [SimEvent.SPAWN]: 'pp',
  /** victime (slot) · x y · attaquant (255 aucun) · dégâts · drapeaux (1 fort, 2 paré, 4 mortel) */
  [SimEvent.HIT]: 'ppiii',
  /** victime (slot) · x y · tueur (255 aucun) · cause · impulsion vx vy */
  [SimEvent.KO]: 'ppiipp',
  /** parant (slot) · x y · attaquant · parfaite (0/1) */
  [SimEvent.BLOCKED]: 'ppii',
  /** tireur (slot) · bouche x y · fin x y · arme */
  [SimEvent.SHOT]: 'ppppi',
  /** joueur · arme · munitions · uid de l'objet */
  [SimEvent.PICKUP]: 'iiu',
  /** joueur · arme · 1 si lâchée */
  [SimEvent.THROW]: 'ii',
  /** x y · arme · uid */
  [SimEvent.WEAPON_SPAWN]: 'ppiu',
  /** x y · rayon · sorte (0 roquette, 1 mine, 2 ballon, 3 patate, 4 caisse) */
  [SimEvent.EXPLOSION]: 'ppii',
  /** cellule x y · rayon en dixièmes de cellule */
  [SimEvent.TERRAIN]: 'iii',
  /** joueur · numéro d'emote */
  [SimEvent.EMOTE]: 'i',
  /** joueur · sorte (0 trait, 1 goutte) · cellule x y · tick de pose (poids faible, fort) */
  [SimEvent.GHOST_DRAW]: 'iiiuu',
  /** x y largeur · tick de pose (poids faible, fort) */
  [SimEvent.PUDDLE]: 'pppuu',
  [SimEvent.STAMP]: 'pp',
  /** joueur · point d'ancrage x y · joueur attiré (255 aucun) */
  [SimEvent.GRAPPLE]: 'ppi',
  [SimEvent.CRATE_BREAK]: 'pp',
  /** équipe · x y */
  [SimEvent.GOAL]: 'ipp',
  /** sorte (0 encre, 1 déchirure) */
  [SimEvent.SUDDEN_DEATH]: 'i',
};

/** Nombre maximal d'arguments d'un événement (charge utile : 1 + 2 × 6 = 13 octets). */
export const EVENT_MAX_ARGS = 6;

/** Emplacement « aucun » dans les événements (attaquant, tueur…). */
export const NO_SLOT = 255;
