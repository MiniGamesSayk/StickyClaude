import { GRID_H, GRID_W } from './constants.ts';

/** Types de cellules de la grille de terrain (un octet par cellule). */
export const Cell = {
  EMPTY: 0,
  SOLID: 1,
  /** Bloc de papier destructible : plein pour les collisions. */
  PAPER: 2,
  /** Plateforme à sens unique : on atterrit dessus par le haut seulement. */
  ONEWAY: 3,
  /** Danger (encre, punaises…) : traversable, effets en phase 2. */
  HAZARD: 4,
} as const;
export type CellId = (typeof Cell)[keyof typeof Cell];

/** Un caractère par cellule dans le JSON des arènes. */
export const CELL_CHARS = '.#p-^';

export interface MoverData {
  /** [x, y, largeur, hauteur] en cellules ; (x, y) = path[0]. */
  rect: [number, number, number, number];
  /** Positions successives du coin haut-gauche, en cellules. Aller-retour. */
  path: [number, number][];
  /** Durée d'un aller-retour complet, en secondes. */
  period: number;
}

export interface PropData {
  type: string;
  at: [number, number];
}

export interface DecorData {
  type: string;
  at: [number, number];
  text?: string;
}

export interface ArenaData {
  id: string;
  name: { fr: string; en: string };
  theme: string;
  size: [number, number];
  /** 36 chaînes de 64 caractères parmi `.#p-^`. */
  grid: string[];
  spawns: { players: [number, number][]; weapons: [number, number][] };
  movers: MoverData[];
  props: PropData[];
  modes?: {
    koth?: { zone: [number, number, number, number] };
    ball?: {
      goals: [[number, number, number, number], [number, number, number, number]];
      /** Cellule d'apparition de la boule (par défaut : entre les deux cages). */
      spawn?: [number, number];
    };
  };
  decor: DecorData[];
  suddenDeath: 'ink-rise' | 'tear-edges';
  /** Armes qui peuvent apparaître (`WeaponId`) ; absent : toutes. */
  weapons?: number[];
}

/** Convertit les lignes de caractères en tableau d'octets (GRID_W × GRID_H). */
export function parseGrid(rows: readonly string[]): Uint8Array {
  const out = new Uint8Array(GRID_W * GRID_H);
  for (let y = 0; y < GRID_H; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < GRID_W; x++) {
      const i = CELL_CHARS.indexOf(row.charAt(x));
      out[y * GRID_W + x] = i < 0 ? Cell.EMPTY : i;
    }
  }
  return out;
}

/** Inverse de `parseGrid`. */
export function gridToRows(cells: Uint8Array): string[] {
  const rows: string[] = [];
  for (let y = 0; y < GRID_H; y++) {
    let r = '';
    for (let x = 0; x < GRID_W; x++) r += CELL_CHARS.charAt(cells[y * GRID_W + x]);
    rows.push(r);
  }
  return rows;
}
