import type { ArenaData } from './arena.ts';
import testFlat from '../arenas/test-flat.json';
import testTower from '../arenas/test-tower.json';

/**
 * Arènes embarquées. Validées par zod au démarrage du serveur et dans les tests ; le client les
 * embarque telles quelles (pas de zod côté client).
 */
export const ARENAS: Readonly<Record<string, ArenaData>> = {
  'test-flat': testFlat as unknown as ArenaData,
  'test-tower': testTower as unknown as ArenaData,
};

export const DEFAULT_ARENA_ID = 'test-flat';

export function getArena(id: string): ArenaData | undefined {
  return Object.prototype.hasOwnProperty.call(ARENAS, id) ? ARENAS[id] : undefined;
}
