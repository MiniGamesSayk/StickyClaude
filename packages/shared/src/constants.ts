/** Constantes globales du jeu. Les constantes de mouvement sont dans `movement.ts`. */

export const PROTOCOL_VERSION = 1;

/** Simulation à pas de temps fixe. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;

/** Fréquence d'envoi des snapshots par défaut (réglable entre 20 et 60 côté serveur). */
export const SNAPSHOT_HZ_DEFAULT = 30;

/** Grille de terrain : 64 × 36 cellules de 16 unités (ratio 16:9). */
export const GRID_W = 64;
export const GRID_H = 36;
export const CELL = 16;
export const WORLD_W = GRID_W * CELL;
export const WORLD_H = GRID_H * CELL;

export const MAX_PLAYERS = 8;
export const MAX_MOVERS = 8;

/** Au-delà de cette profondeur sous la page, un joueur est considéré comme tombé. */
export const FALL_MARGIN = 3 * CELL;

/** Réseau. */
export const MAX_CLIENT_MESSAGE_BYTES = 1024;
/** Entrées envoyées par paquet : l'entrée courante + 3 précédentes (redondance). */
export const INPUT_REDUNDANCY = 4;
/** Nombre de ticks d'avance maximum acceptés par le serveur pour une entrée. */
export const MAX_INPUT_AHEAD_TICKS = 24;
/** Taille de l'anneau d'entrées par joueur côté serveur (puissance de 2). */
export const INPUT_RING = 64;
/** Taille de l'historique de prédiction côté client (puissance de 2). */
export const PREDICTION_HISTORY = 128;
/** Fenêtre de marge visée côté client (ticks d'avance de l'entrée sur son exécution). */
export const MARGIN_MIN = 1;
export const MARGIN_MAX = 4;
export const MARGIN_TARGET = 2;
/** Compensation de latence (phase 2) : historique conservé côté serveur. */
export const LAG_COMP_MS = 200;

/** Quantification des positions et vitesses dans les snapshots : 1/8 d'unité. */
export const POS_SCALE = 8;

/** Salons. */
export const ROOM_CODE_LENGTH = 5;
/** Sans 0/O, 1/I/L : 31 caractères. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const NAME_MIN = 2;
export const NAME_MAX = 16;

/** Couleurs d'encre (indices 0..11), voir analyse §1.8. */
export const INK_COLORS = [
  0x1f4fd1, 0xd6322e, 0x1f9d55, 0x22262e, 0x7b3fb5, 0xe8801a, 0xe5579a, 0x7a4a2b, 0x12a6a6,
  0x6b7280, 0xc9a227, 0x1b2a5e,
] as const;
