/**
 * Enregistrement des entrées d'une salle, pour reproduire un bug ou vérifier le déterminisme.
 *
 * - `joins`/`leaves` : le joueur est ajouté/retiré quand `world.tick === tick` (avant le pas
 *   qui produit le tick `tick + 1`).
 * - `inputs` : `[tick, slot, masque]` = à partir du pas qui produit le tick `tick`, ce joueur
 *   applique ce masque (jusqu'au changement suivant).
 */
export interface Recording {
  version: 1;
  arenaId: string;
  seed: number;
  tickHz: number;
  /** Nombre de pas simulés. */
  ticks: number;
  joins: { tick: number; slot: number }[];
  leaves: { tick: number; slot: number }[];
  inputs: [number, number, number][];
  /** Hash d'état final (hashWorld), pour vérification. */
  finalHash?: number;
}
