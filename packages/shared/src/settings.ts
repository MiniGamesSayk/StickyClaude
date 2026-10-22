import { BONUS_MODE_IDS } from './modes.ts';

/** Réglages d'une partie, choisis par l'hôte (analyse §1.5 et §1.7). */
export interface RoomSettings {
  mode: 'ffa' | 'teams';
  /** Nombre d'équipes (2 à 4) en mode équipes. */
  teams: number;
  friendlyFire: boolean;
  /** Manches à gagner : 3, 5 ou 7. */
  roundsToWin: number;
  /** Arènes tirées au sort ; liste vide = toutes. */
  arenas: string[];
  weapons: boolean;
  suddenDeath: boolean;
  /** Délai avant la mort subite, en secondes. */
  suddenDeathSec: number;
  /** Modes bonus activés (identifiants de `ModeId`). */
  bonusModes: number[];
  /** Une manche sur N est un mode bonus ; 0 = jamais. */
  bonusEvery: number;
  /** « Les morts dessinent » : les éliminés deviennent des fantômes-crayons. */
  ghosts: boolean;
  /** Vote de la carte avant chaque manche (parmi celles retenues, niveaux des joueurs compris). */
  voteMaps: boolean;
  isPublic: boolean;
}

export const ROUNDS_TO_WIN_CHOICES = [3, 5, 7] as const;
export const TEAMS_MIN = 2;
export const TEAMS_MAX = 4;
export const SUDDEN_MIN_SEC = 20;
export const SUDDEN_MAX_SEC = 180;
export const BONUS_EVERY_MAX = 6;

export const DEFAULT_SETTINGS: Readonly<RoomSettings> = {
  mode: 'ffa',
  teams: 2,
  friendlyFire: false,
  roundsToWin: 5,
  arenas: [],
  weapons: true,
  suddenDeath: true,
  suddenDeathSec: 75,
  bonusModes: [...BONUS_MODE_IDS],
  bonusEvery: 3,
  ghosts: true,
  voteMaps: true,
  isPublic: false,
};

export function cloneSettings(s: Readonly<RoomSettings> = DEFAULT_SETTINGS): RoomSettings {
  return { ...s, arenas: [...s.arenas], bonusModes: [...s.bonusModes] };
}

function clampInt(v: unknown, lo: number, hi: number, def: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/**
 * Ramène des réglages quelconques à des valeurs valides : toute valeur hors liste blanche est
 * remplacée par celle de `base`. `knownArenas` filtre les identifiants d'arènes.
 */
export function normalizeSettings(
  raw: Partial<RoomSettings>,
  base: Readonly<RoomSettings>,
  knownArenas: ReadonlySet<string>,
): RoomSettings {
  const out = cloneSettings(base);
  if (raw.mode === 'ffa' || raw.mode === 'teams') out.mode = raw.mode;
  if (raw.teams !== undefined) out.teams = clampInt(raw.teams, TEAMS_MIN, TEAMS_MAX, out.teams);
  if (typeof raw.friendlyFire === 'boolean') out.friendlyFire = raw.friendlyFire;
  if (raw.roundsToWin !== undefined) {
    const r = clampInt(raw.roundsToWin, 3, 7, out.roundsToWin);
    out.roundsToWin = (ROUNDS_TO_WIN_CHOICES as readonly number[]).includes(r)
      ? r
      : out.roundsToWin;
  }
  if (Array.isArray(raw.arenas)) {
    const seen = new Set<string>();
    for (const id of raw.arenas) if (typeof id === 'string' && knownArenas.has(id)) seen.add(id);
    out.arenas = [...seen];
  }
  if (typeof raw.weapons === 'boolean') out.weapons = raw.weapons;
  if (typeof raw.suddenDeath === 'boolean') out.suddenDeath = raw.suddenDeath;
  if (raw.suddenDeathSec !== undefined) {
    out.suddenDeathSec = clampInt(
      raw.suddenDeathSec,
      SUDDEN_MIN_SEC,
      SUDDEN_MAX_SEC,
      out.suddenDeathSec,
    );
  }
  if (Array.isArray(raw.bonusModes)) {
    const seen = new Set<number>();
    for (const m of raw.bonusModes) if (BONUS_MODE_IDS.includes(m)) seen.add(m);
    out.bonusModes = [...seen].sort((a, b) => a - b);
  }
  if (raw.bonusEvery !== undefined) {
    out.bonusEvery = clampInt(raw.bonusEvery, 0, BONUS_EVERY_MAX, out.bonusEvery);
  }
  if (typeof raw.ghosts === 'boolean') out.ghosts = raw.ghosts;
  if (typeof raw.voteMaps === 'boolean') out.voteMaps = raw.voteMaps;
  if (typeof raw.isPublic === 'boolean') out.isPublic = raw.isPublic;
  return out;
}

/** Règles lues par la simulation (dérivées des réglages de l'hôte, voir `rulesFromSettings`). */
export interface SimRules {
  friendlyFire: boolean;
  weapons: boolean;
  ghosts: boolean;
  /** Ticks de manche avant la mort subite ; 0 = jamais (la limite absolue reste en vigueur). */
  suddenAfterTicks: number;
  roundsToWin: number;
  teamsMode: boolean;
  teamCount: number;
  bonusModes: number[];
  bonusEvery: number;
  /** La manche suivante attend le vote du salon (voir `resolveVote`). */
  vote?: boolean;
}
