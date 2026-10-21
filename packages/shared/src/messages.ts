import type { MovementKey } from './movement.ts';

/** Messages de contrôle serveur → client (JSON). */

export interface RosterEntry {
  slot: number;
  name: string;
  /** Indice dans INK_COLORS. */
  color: number;
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
  | 'forbidden';

export type ServerMessage =
  | {
      t: 'joined';
      v: number;
      slot: number;
      code: string;
      host: number;
      arena: string;
      seed: number;
      tickHz: number;
      snapshotHz: number;
      /** Tick serveur au moment de l'entrée dans le salon. */
      tick: number;
      /** Dernier identifiant d'événement fiable déjà émis dans ce salon. */
      ev: number;
      players: RosterEntry[];
      devTools: boolean;
    }
  | { t: 'roster'; players: RosterEntry[]; host: number }
  | { t: 'error'; code: ErrorCode; msg?: string }
  | { t: 'tune'; k: MovementKey; val: number }
  | { t: 'left' };
