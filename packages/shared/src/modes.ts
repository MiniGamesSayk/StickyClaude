/** Modes de jeu (analyse §1.5) et leurs constantes. */

export const ModeId = {
  FFA: 0,
  TEAMS: 1,
  KOTH: 2,
  BALL: 3,
  INK_RISE: 4,
  POTATO: 5,
  MOON: 6,
  SAME_WEAPON: 7,
} as const;
export type ModeIdValue = (typeof ModeId)[keyof typeof ModeId];

export interface ModeInfo {
  id: number;
  key: string;
  name: { fr: string; en: string };
  bonus: boolean;
  /** Les joueurs éliminés réapparaissent (pas de fantôme). */
  respawn: boolean;
  /** Nécessite une zone de l'arène (`modes.koth` / `modes.ball`). */
  needs: 'koth' | 'ball' | null;
}

export const MODES: readonly ModeInfo[] = [
  {
    id: ModeId.FFA,
    key: 'ffa',
    name: { fr: 'Chacun pour soi', en: 'Free for all' },
    bonus: false,
    respawn: false,
    needs: null,
  },
  {
    id: ModeId.TEAMS,
    key: 'teams',
    name: { fr: 'Équipes', en: 'Teams' },
    bonus: false,
    respawn: false,
    needs: null,
  },
  {
    id: ModeId.KOTH,
    key: 'koth',
    name: { fr: 'Roi de la colline', en: 'King of the hill' },
    bonus: true,
    respawn: true,
    needs: 'koth',
  },
  {
    id: ModeId.BALL,
    key: 'ball',
    name: { fr: 'Boulette-ball', en: 'Paper-ball' },
    bonus: true,
    respawn: true,
    needs: 'ball',
  },
  {
    id: ModeId.INK_RISE,
    key: 'ink-rise',
    name: { fr: 'Encre montante', en: 'Rising ink' },
    bonus: true,
    respawn: false,
    needs: null,
  },
  {
    id: ModeId.POTATO,
    key: 'potato',
    name: { fr: 'Patate d’encre', en: 'Ink potato' },
    bonus: true,
    respawn: false,
    needs: null,
  },
  {
    id: ModeId.MOON,
    key: 'moon',
    name: { fr: 'Gravité lunaire', en: 'Low gravity' },
    bonus: true,
    respawn: false,
    needs: null,
  },
  {
    id: ModeId.SAME_WEAPON,
    key: 'same-weapon',
    name: { fr: 'Même arme pour tous', en: 'Same weapon' },
    bonus: true,
    respawn: false,
    needs: null,
  },
];

export const BONUS_MODE_IDS: readonly number[] = MODES.filter((m) => m.bonus).map((m) => m.id);

export function modeInfo(id: number): ModeInfo {
  return MODES[id] ?? MODES[0];
}

export const MODE_PARAMS = {
  /** Roi de la colline : temps cumulé à tenir la zone, délai de réapparition, durée maximale. */
  kothHoldTicks: 15 * 60,
  kothRespawnTicks: 3 * 60,
  kothMaxTicks: 150 * 60,
  /** Boulette-ball : buts pour gagner, réapparition, remise en jeu de la boule, durée maximale. */
  ballGoals: 3,
  ballRespawnTicks: 2 * 60,
  ballResetTicks: 2 * 60,
  ballMaxTicks: 150 * 60,
  /** Patate d'encre : mèche, pause avant la bombe suivante, délai avant de pouvoir repasser. */
  potatoFuseTicks: 15 * 60,
  potatoNextTicks: 90,
  potatoPassCooldownTicks: 60,
  /** Gravité lunaire. */
  moonGravityMul: 0.35,
  moonFallMul: 0.6,
  /** Encre montante : l'encre monte dès le début. */
  inkRiseStartTicks: 0,
  /** Limite absolue d'une manche d'élimination, même sans mort subite (secondes). */
  hardCapSec: 300,
} as const;
