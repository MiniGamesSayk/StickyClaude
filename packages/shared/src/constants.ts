/** Constantes globales du jeu. Les constantes de mouvement sont dans `movement.ts`. */

export const PROTOCOL_VERSION = 5;

/** Simulation à pas de temps fixe. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;

/**
 * Fréquence d'envoi des snapshots par défaut (réglable de 10 à 60 côté serveur). 60 réduirait
 * l'interpolation à ≈ 50 ms, mais dépasse le budget de débit en combat à 8 (voir D79).
 */
export const SNAPSHOT_HZ_DEFAULT = 30;

/** Grille de terrain : 64 × 36 cellules de 16 unités (ratio 16:9). */
export const GRID_W = 64;
export const GRID_H = 36;
export const CELL = 16;
export const WORLD_W = GRID_W * CELL;
export const WORLD_H = GRID_H * CELL;

export const MAX_PLAYERS = 8;
export const MAX_SPECTATORS = 4;
export const MAX_MOVERS = 8;
/** Objets dynamiques (armes au sol, caisses, ballons, boule…) et projectiles : réservés à l'avance. */
export const MAX_OBJECTS = 32;
export const MAX_PROJECTILES = 64;
/** Flaques d'encre glissantes simultanées. */
export const MAX_PUDDLES = 8;
/** Traits et gouttes posés par les fantômes, simultanés. */
export const MAX_GHOST_MARKS = 16;

/** Au-delà de cette profondeur sous la page, un joueur est considéré comme tombé. */
export const FALL_MARGIN = 3 * CELL;

/** Réseau. */
export const MAX_CLIENT_MESSAGE_BYTES = 1024;
/** Seul le message d'envoi d'un niveau (`arena`) peut dépasser `MAX_CLIENT_MESSAGE_BYTES`. */
export const MAX_ARENA_MESSAGE_BYTES = 8192;

/** Vote de carte avant chaque manche : nombre de cartes proposées et durée par défaut. */
export const VOTE_OPTIONS = 4;
export const VOTE_MS_DEFAULT = 12_000;
/** Niveaux créés par les joueurs, par salon. */
export const MAX_CUSTOM_ARENAS = 6;
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
/**
 * Compensation de latence : historique des positions conservé côté serveur. L'analyse prévoit
 * 200 ms ; les entrées étant étiquetées dans le futur (voir DECISIONS.md), la durée à remonter est
 * 2 × latence aller + avance + interpolation. Le retard voyage sur 5 bits du masque, au tick
 * près : au plus 18 ticks, soit 300 ms (un aller-retour de 200 ms avec 50 ms d'interpolation).
 */
export const LAG_COMP_MS = 300;
export const LAG_COMP_TICKS = 18;
/** Taille de l'anneau d'historique (puissance de 2 > LAG_COMP_TICKS). */
export const HISTORY_TICKS = 32;

/** Reconnexion : un joueur déconnecté garde sa place pendant ce délai. */
export const RECONNECT_GRACE_MS = 20_000;
/** Inactivité : sans aucune entrée pendant une manche → spectateur ; en attente → déconnexion. */
export const IDLE_PLAYING_MS = 60_000;
export const IDLE_LOBBY_MS = 10 * 60_000;
/** Un salon public en attente se lance seul après ce délai, dès que 2 joueurs sont prêts. */
export const AUTOSTART_MS = 20_000;
/** Emotes : au plus une toutes les 3 s par joueur (anti-spam). */
export const EMOTE_COOLDOWN_MS = 3000;

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
