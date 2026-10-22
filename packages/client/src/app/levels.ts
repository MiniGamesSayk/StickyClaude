import { GRID_H, GRID_W } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';

/** Niveaux créés par le joueur : gardés dans le navigateur, au plus `MAX_LEVELS`. */
const KEY = 'stickyclaude.levels';
export const MAX_LEVELS = 12;

function plausible(a: unknown): a is ArenaData {
  const l = a as Partial<ArenaData> | null;
  return (
    typeof l === 'object' &&
    l !== null &&
    typeof l.id === 'string' &&
    Array.isArray(l.grid) &&
    l.grid.length === GRID_H &&
    l.grid.every((r) => typeof r === 'string' && r.length === GRID_W) &&
    typeof l.name?.fr === 'string' &&
    typeof l.name?.en === 'string' &&
    Array.isArray(l.spawns?.players)
  );
}

export function loadLevels(): ArenaData[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter(plausible).slice(0, MAX_LEVELS) : [];
  } catch {
    return [];
  }
}

export function saveLevels(list: readonly ArenaData[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_LEVELS)));
  } catch {
    /* stockage indisponible */
  }
}

/** Nouvel identifiant de niveau local (le serveur en attribue un autre au salon). */
export function newLevelId(): string {
  return `niveau-${Date.now().toString(36)}`;
}
