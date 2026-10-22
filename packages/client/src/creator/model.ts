import { Cell, GRID_H, GRID_W } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { analyzeArena, suggestSpawns } from '@stickyclaude/sim';
import type { ArenaReport, SpawnSuggestion } from '@stickyclaude/sim';
import { emptyState, fromArena, toArena } from '../editor/model.ts';
import type { EditorState, Rect } from '../editor/model.ts';

/**
 * Modèle du créateur de niveau des joueurs : l'état de l'éditeur d'arènes (`editor/model.ts`) plus
 * ce qu'il faut pour le grand public : plateformes mobiles posées à la souris, apparitions
 * placées automatiquement, vérification avant envoi. Pur et sans DOM.
 */

/** Fonds proposés (`theme` des arènes) : tous ceux que le rendu connaît. */
export const THEME_IDS = [
  'graph-paper',
  'ruled-paper',
  'practice',
  'staff-paper',
  'scratch-paper',
  'treasure-map',
  'comic-page',
  'cover-page',
  'millimeter-paper',
  'dictionary-page',
  'doodle-margin',
  'spread',
] as const;

/** Durée d'un aller-retour d'une plateforme mobile posée dans le créateur (secondes). */
export const MOVER_PERIOD = 5;
export const MAX_MOVERS = 8;

/** Un niveau neuf : cadre plein, sol, apparitions automatiques déjà valides. */
export function newLevel(name: string): EditorState {
  const s = emptyState();
  s.id = 'niveau';
  s.nameFr = name;
  s.nameEn = name;
  // petit relief de départ : deux plateformes traversables, pour ne pas partir d'une page blanche
  for (let x = 12; x < 22; x++) s.cells[26 * GRID_W + x] = Cell.ONEWAY;
  for (let x = 42; x < 52; x++) s.cells[26 * GRID_W + x] = Cell.ONEWAY;
  for (let x = 27; x < 37; x++) s.cells[20 * GRID_W + x] = Cell.ONEWAY;
  s.koth = null;
  s.goalA = null;
  s.goalB = null;
  placeSpawns(s);
  return s;
}

/**
 * Pose une plateforme mobile : le rectangle de départ `rect` (cellules) et l'arrivée `(ex, ey)`
 * (coin haut-gauche). Elle fait l'aller-retour entre les deux. Retourne faux si la limite est
 * atteinte, si le rectangle sort de la page ou si l'arrivée est le départ.
 */
export function addMover(s: EditorState, rect: Rect, ex: number, ey: number): boolean {
  const [x, y, w, h] = rect;
  if (s.movers.length >= MAX_MOVERS) return false;
  if (x < 0 || y < 0 || x + w > GRID_W || y + h > GRID_H) return false;
  const tx = Math.max(0, Math.min(GRID_W - w, ex));
  const ty = Math.max(0, Math.min(GRID_H - h, ey));
  if (tx === x && ty === y) return false;
  s.movers.push({
    rect: [x, y, w, h],
    path: [
      [x, y],
      [tx, ty],
    ],
    period: MOVER_PERIOD,
  });
  return true;
}

/** Retire la plateforme mobile dont le départ, l'arrivée ou le rectangle contient la cellule. */
export function removeMoverAt(s: EditorState, x: number, y: number): boolean {
  const i = s.movers.findIndex((m) =>
    m.path.some(([px, py]) => x >= px && x < px + m.rect[2] && y >= py && y < py + m.rect[3]),
  );
  if (i < 0) return false;
  s.movers.splice(i, 1);
  return true;
}

/**
 * Place les apparitions des joueurs et des armes automatiquement (par simulation : positions
 * atteignables dans les deux sens). Retourne le nombre d'apparitions de joueurs trouvées.
 */
export function placeSpawns(s: EditorState): number {
  return applySpawns(s, suggestSpawns(toArena(s)));
}

/** Range des apparitions proposées (`suggestSpawns`) dans le niveau ; retourne leur nombre. */
export function applySpawns(s: EditorState, sug: SpawnSuggestion): number {
  s.spawns = sug.players;
  s.weaponSpawns = sug.weapons;
  return sug.players.length;
}

export interface LevelCheck {
  ok: boolean;
  /** Problèmes lisibles (au plus quelques-uns affichés). */
  problems: string[];
  /** Positions où l'on peut se tenir debout / atteignables depuis la première apparition. */
  standing: number;
  reachable: number;
}

/** Vérifie un niveau comme le fera le serveur : analyse par simulation (apparitions, accès…). */
export function checkLevel(s: EditorState): LevelCheck {
  return levelCheck(s.nameFr, analyzeArena(toArena(s)));
}

/** Rapport d'analyse + nom du niveau → verdict (l'analyse, lourde, peut venir d'un worker). */
export function levelCheck(name: string, r: ArenaReport): LevelCheck {
  const problems: string[] = [];
  if (name.trim() === '') problems.push('nom');
  problems.push(...r.errors);
  return { ok: problems.length === 0, problems, standing: r.standing, reachable: r.reachable };
}

/** Le niveau prêt à être gardé ou envoyé : noms nettoyés, décor retiré (inutile ici). */
export function finalizeLevel(s: EditorState, id: string): ArenaData {
  const name = s.nameFr.trim().slice(0, 40);
  const copy: EditorState = { ...s, id, nameFr: name, nameEn: name, decor: [] };
  return toArena(copy);
}

export { fromArena };
export type { EditorState };
