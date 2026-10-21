import type { SimRules } from './settings.ts';

/**
 * Opération sur le monde décidée par le salon (et non par une entrée) : arrivée, départ,
 * lancement de partie, retour au salon, élimination, changement de règles. Les opérations sont
 * conservées dans l'ordre où le serveur les a exécutées.
 */
export type RecordOp =
  | { tick: number; op: 'join'; slot: number; inMatch: boolean }
  | { tick: number; op: 'leave'; slot: number }
  | {
      tick: number;
      op: 'start';
      rules: SimRules;
      /** Identifiants des arènes tirables au sort. */
      arenas: string[];
      /** Participants (1) ou non (0), par emplacement. */
      inMatch: number[];
      /** Équipe de chaque emplacement. */
      teams: number[];
    }
  | { tick: number; op: 'lobby' }
  | { tick: number; op: 'kill'; slot: number }
  | { tick: number; op: 'rules'; rules: SimRules };

/**
 * Enregistrement des entrées d'une salle, pour reproduire un bug ou vérifier le déterminisme.
 *
 * - `ops` : opérations du salon, appliquées quand `world.tick === tick` (avant le pas qui produit
 *   le tick `tick + 1`), dans l'ordre.
 * - `tunes` : à partir du tick `tick` (avant le pas suivant), la constante change de valeur.
 * - `inputs` : `[tick, slot, masque]` = à partir du pas qui produit le tick `tick`, ce joueur
 *   applique ce masque (jusqu'au changement suivant). Les bits 12 à 15 portent la compensation
 *   de latence.
 */
export interface Recording {
  version: 3;
  /** Arène du salon d'attente. */
  arenaId: string;
  seed: number;
  tickHz: number;
  /** Nombre de pas simulés. */
  ticks: number;
  ops: RecordOp[];
  inputs: [number, number, number][];
  /** Réglages de constantes de mouvement en cours de partie : `[tick, clé, valeur]` (dev). */
  tunes?: [number, string, number][];
  /** Hash d'état final (hashWorld), pour vérification. */
  finalHash?: number;
}
