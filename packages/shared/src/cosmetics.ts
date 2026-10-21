import { INK_COLORS } from './constants.ts';

/** Personnalisation locale (analyse §1.8) : indices dans des tables connues, validés par le serveur. */
export interface Look {
  /** Couleur d'encre (0 à 11), unique dans un salon. */
  color: number;
  /** 0 stylo bille, 1 feutre, 2 crayon, 3 pinceau. */
  stroke: number;
  /** Couvre-chef (0 = aucun, 1 à 11). */
  hat: number;
  /** Emote de victoire (0 à 3). */
  victory: number;
}

export const COLOR_COUNT = INK_COLORS.length;
export const STROKE_COUNT = 4;
export const HAT_COUNT = 12;
export const VICTORY_COUNT = 4;

export const STROKE_NAMES = [
  { fr: 'Stylo bille', en: 'Ballpoint' },
  { fr: 'Feutre', en: 'Marker' },
  { fr: 'Crayon', en: 'Pencil' },
  { fr: 'Pinceau', en: 'Brush' },
] as const;

export const HAT_NAMES = [
  { fr: 'Aucun', en: 'None' },
  { fr: 'Casquette', en: 'Cap' },
  { fr: 'Haut-de-forme', en: 'Top hat' },
  { fr: 'Bandeau de ninja', en: 'Ninja headband' },
  { fr: 'Couronne en papier', en: 'Paper crown' },
  { fr: 'Chapeau de sorcier', en: 'Wizard hat' },
  { fr: 'Antennes', en: 'Antennae' },
  { fr: 'Lunettes', en: 'Glasses' },
  { fr: 'Nœud', en: 'Bow' },
  { fr: 'Casque de chantier', en: 'Hard hat' },
  { fr: 'Cornet de glace', en: 'Ice-cream cone' },
  { fr: 'Auréole', en: 'Halo' },
] as const;

export const VICTORY_NAMES = [
  { fr: 'Poings levés', en: 'Fists up' },
  { fr: 'Saut périlleux', en: 'Backflip' },
  { fr: 'Salut', en: 'Bow' },
  { fr: 'Danse', en: 'Dance' },
] as const;

export const DEFAULT_LOOK: Readonly<Look> = { color: 0, stroke: 0, hat: 0, victory: 0 };

function idx(v: unknown, count: number, def: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= count) return def;
  return v;
}

/** Valide chaque champ contre sa liste blanche ; tout le reste est ignoré. */
export function sanitizeLook(raw: unknown, base: Readonly<Look> = DEFAULT_LOOK): Look {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    color: idx(r.color, COLOR_COUNT, base.color),
    stroke: idx(r.stroke, STROKE_COUNT, base.stroke),
    hat: idx(r.hat, HAT_COUNT, base.hat),
    victory: idx(r.victory, VICTORY_COUNT, base.victory),
  };
}

function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/**
 * Couleur libre la plus proche de `requested` (distance dans l'espace RVB). Si tout est pris,
 * retourne `requested`.
 */
export function closestFreeColor(requested: number, used: ReadonlySet<number>): number {
  const want = idx(requested, COLOR_COUNT, 0);
  if (!used.has(want)) return want;
  const [r0, g0, b0] = rgb(INK_COLORS[want]);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < COLOR_COUNT; i++) {
    if (used.has(i)) continue;
    const [r, g, b] = rgb(INK_COLORS[i]);
    const d = (r - r0) ** 2 + (g - g0) ** 2 + (b - b0) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? want : best;
}

/** Motif de tête pour les daltoniens : un par couleur d'encre (0 à 11). */
export const PATTERN_COUNT = 12;
