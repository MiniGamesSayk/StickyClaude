import type { ArenaData } from './arena.ts';
import brouillon from '../arenas/brouillon.json';
import bdCases from '../arenas/bd-cases.json';
import carteTresor from '../arenas/carte-tresor.json';
import dictionnaire from '../arenas/dictionnaire.json';
import doublePage from '../arenas/double-page.json';
import entrainement from '../arenas/entrainement.json';
import margeGribouillis from '../arenas/marge-gribouillis.json';
import mathsQuadrille from '../arenas/maths-quadrille.json';
import millimetre from '../arenas/millimetre.json';
import pageDeGarde from '../arenas/page-de-garde.json';
import partition from '../arenas/partition.json';
import testFlat from '../arenas/test-flat.json';
import testTower from '../arenas/test-tower.json';

/**
 * Arènes embarquées. Validées par zod au démarrage du serveur et dans les tests ; le client les
 * embarque telles quelles (pas de zod côté client).
 */
export const ARENAS: Readonly<Record<string, ArenaData>> = {
  'maths-quadrille': mathsQuadrille as unknown as ArenaData,
  partition: partition as unknown as ArenaData,
  brouillon: brouillon as unknown as ArenaData,
  'carte-tresor': carteTresor as unknown as ArenaData,
  'bd-cases': bdCases as unknown as ArenaData,
  'page-de-garde': pageDeGarde as unknown as ArenaData,
  millimetre: millimetre as unknown as ArenaData,
  dictionnaire: dictionnaire as unknown as ArenaData,
  'marge-gribouillis': margeGribouillis as unknown as ArenaData,
  'double-page': doublePage as unknown as ArenaData,
  entrainement: entrainement as unknown as ArenaData,
  // arènes de test (mouvement et réseau) : jamais tirées au sort
  'test-flat': testFlat as unknown as ArenaData,
  'test-tower': testTower as unknown as ArenaData,
};

/** Arène d'entraînement du salon d'attente. */
export const LOBBY_ARENA_ID = 'entrainement';
/** Les 10 arènes tirées au sort pour les manches (l'hôte peut en retenir une partie). */
export const ROTATION_ARENA_IDS: readonly string[] = [
  'maths-quadrille',
  'partition',
  'brouillon',
  'carte-tresor',
  'bd-cases',
  'page-de-garde',
  'millimetre',
  'dictionnaire',
  'marge-gribouillis',
  'double-page',
];
export const DEFAULT_ARENA_ID = LOBBY_ARENA_ID;

/**
 * Niveaux de joueurs reçus du salon (côté client seulement : le serveur garde les siens par
 * salon). Les identifiants commencent par `custom-` : ils ne peuvent pas masquer une arène du jeu.
 */
const EXTRA = new Map<string, ArenaData>();

export const CUSTOM_ARENA_PREFIX = 'custom-';

export function registerExtraArena(a: ArenaData): void {
  if (a.id.startsWith(CUSTOM_ARENA_PREFIX)) EXTRA.set(a.id, a);
}

export function unregisterExtraArena(id: string): void {
  EXTRA.delete(id);
}

export function clearExtraArenas(): void {
  EXTRA.clear();
}

export function getArena(id: string): ArenaData | undefined {
  if (Object.prototype.hasOwnProperty.call(ARENAS, id)) return ARENAS[id];
  return EXTRA.get(id);
}
