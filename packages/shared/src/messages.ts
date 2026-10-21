import type { Look } from './cosmetics.ts';
import type { MovementKey } from './movement.ts';
import type { RoomSettings } from './settings.ts';
import type { GamePhaseId } from './types.ts';

/** Messages de contrôle serveur → client (JSON). */

/** Un joueur dans le salon. */
export interface PlayerInfo {
  slot: number;
  name: string;
  /** `look.color` est la couleur attribuée (unique dans le salon), pas forcément celle demandée. */
  look: Look;
  ready: boolean;
  /** Équipe (0 à 3) ; -1 en chacun pour soi. */
  team: number;
  /** Faux pendant la reconnexion (20 s). */
  connected: boolean;
  /** Latence mesurée par le serveur (ms), 0 si inconnue. */
  ping: number;
}

export interface SpectatorInfo {
  id: number;
  name: string;
}

export interface LobbyView {
  code: string;
  /** Emplacement de l'hôte, -1 si aucun. */
  host: number;
  settings: RoomSettings;
  players: PlayerInfo[];
  spectators: SpectatorInfo[];
  phase: GamePhaseId;
  /** Millisecondes avant le lancement automatique (salon public), -1 sinon. */
  autostartMs: number;
  /** Manche courante (0 en attente) et manches gagnées par équipe ou emplacement. */
  round: number;
  scores: number[];
}

/** Début d'une manche, ou état de la manche en cours pour quelqu'un qui arrive. */
export interface RoundInfo {
  arena: string;
  seed: number;
  mode: number;
  round: number;
  /** Terrain courant (destructions comprises) ; null = celui de l'arène. */
  rows: string[] | null;
  /** Équipe de chaque emplacement (8 valeurs, -1 si absent). */
  teams: number[];
  /** Ticks de manche avant la mort subite ; 0 = pas de mort subite. */
  suddenAfterTicks: number;
  ghosts: boolean;
  weapons: boolean;
  friendlyFire: boolean;
  /** Arme commune du mode « même arme pour tous » (0 sinon). */
  commonWeapon: number;
}

export const SillyDeath = { NONE: 0, FALL: 1, FRIENDLY: 2, SELF: 3 } as const;

export interface PlayerStats {
  slot: number;
  kos: number;
  deaths: number;
  damage: number;
  /** Plus long enchaînement de coups sans en recevoir. */
  bestCombo: number;
  /** « Mort la plus bête » de la partie (`SillyDeath`). */
  silly: number;
}

export type ErrorCode =
  | 'version'
  | 'bad_request'
  | 'bad_name'
  | 'not_found'
  | 'full'
  | 'server_full'
  | 'rate_limited'
  | 'already_joined'
  | 'not_joined'
  | 'forbidden'
  | 'not_host'
  | 'not_enough_players'
  | 'not_ready'
  | 'in_game'
  | 'bad_token';

export type ServerMessage =
  | {
      t: 'joined';
      v: number;
      /** Emplacement de joueur ; -1 pour un spectateur. */
      slot: number;
      /** Identifiant de connexion (spectateur : repère dans la liste). */
      id: number;
      /** Jeton de reconnexion (à garder en local). */
      token: string;
      code: string;
      tickHz: number;
      snapshotHz: number;
      /** Tick serveur au moment de l'entrée dans le salon. */
      tick: number;
      /** Dernier identifiant d'événement fiable déjà émis dans ce salon. */
      ev: number;
      devTools: boolean;
      lobby: LobbyView;
      /** Manche en cours, ou arène d'entraînement du salon d'attente. */
      round: RoundInfo;
    }
  | { t: 'lobby'; lobby: LobbyView }
  | { t: 'round'; round: RoundInfo }
  | {
      t: 'scores';
      round: number;
      /** Équipe ou emplacement gagnant la manche, -1 si personne. */
      winner: number;
      scores: number[];
      final: boolean;
    }
  | {
      t: 'results';
      winner: number;
      /** Équipes ou emplacements, du premier au dernier. */
      podium: number[];
      scores: number[];
      teams: number[];
      stats: PlayerStats[];
    }
  | { t: 'error'; code: ErrorCode; msg?: string }
  | { t: 'tune'; k: MovementKey; val: number }
  | { t: 'left'; reason: 'left' | 'kicked' | 'closed' | 'idle' };

/** Salon public dans `GET /api/rooms`. */
export interface PublicRoom {
  code: string;
  players: number;
  maxPlayers: number;
  spectators: number;
  mode: 'ffa' | 'teams';
  phase: 'lobby' | 'playing';
  host: string;
}
