/**
 * Palette « encre et carnet » : la référence est `docs/DIRECTION_ARTISTIQUE.md` §2. Les couleurs
 * sont des entiers 0xRRGGBB (Pixi) ; `css()` les convertit pour Canvas2D et le DOM.
 */

export function css(color: number, alpha = 1): string {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Encres de jeu (hors encres de joueur, qui sont `INK_COLORS` dans `shared`). */
export const INK = {
  /** Contour du terrain, hachures, décor : le bleu nuit. */
  night: 0x1b2a5e,
  /** Bleu Bic : plateformes, boutons. */
  blue: 0x1f4fd1,
  /** Rouge correcteur : danger. */
  red: 0xd6322e,
  /** Or : parade parfaite, colline, victoire. */
  gold: 0xc9a227,
  graphite: 0x6b7280,
  black: 0x22262e,
  green: 0x1f9d55,
  white: 0xffffff,
  /** Blocs de papier : remplissage, contour au crayon, pli. */
  paperBlock: 0xe7d6a4,
  paperBlockEdge: 0x8a6a2b,
  paperBlockFold: 0xc9b27a,
} as const;

/** Encre de décor : bleu nuit à 55 %. */
export const DECOR_ALPHA = 0.55;
export const HATCH_ALPHA = 0.55;

/** Couleurs des équipes (indices 0 à 3). */
export const TEAM_COLORS: readonly number[] = [0x1f4fd1, 0xd6322e, 0x1f9d55, 0xc9a227];

/** Fond autour de la page (bandes d'un écran qui n'est pas en 16:9). */
export const TABLE = 0xe7dfc8;

export type Ruling =
  | 'grid'
  | 'seyes'
  | 'big-grid'
  | 'staff'
  | 'scratch'
  | 'parchment'
  | 'dots'
  | 'plain'
  | 'mm'
  | 'columns';

export interface PaperTheme {
  paper: number;
  /** Ombre du papier (bords, vignettage, reliure). */
  shade: number;
  ruling: Ruling;
  /** Couleur de la réglure (carreaux, lignes). */
  line: number;
  /** Seconde couleur de réglure (traits forts du millimétré, lignes principales). */
  line2: number;
  /** Marge rouge : 0 = aucune, sinon sa position en cellules depuis la gauche. */
  margin: number;
  /** Largeur de la marge rouge (nombre de lignes doublées) : 1 simple, 2 très large. */
  marginKind: 'none' | 'single' | 'wide';
  /** Reliure au centre de la page (double page). */
  binding: boolean;
  /** Bords brûlés (carte au trésor). */
  burnt: boolean;
  /** Papier froissé (brouillon). */
  crumpled: boolean;
}

const BASE: PaperTheme = {
  paper: 0xf8f4e6,
  shade: 0xe6dcc0,
  ruling: 'grid',
  line: 0xcfdcf1,
  line2: 0xb4c6e6,
  margin: 0,
  marginKind: 'none',
  binding: false,
  burnt: false,
  crumpled: false,
};

function theme(over: Partial<PaperTheme>): PaperTheme {
  return { ...BASE, ...over };
}

/** Un papier par thème d'arène (voir `docs/ARENES.md`, colonne « Thème »). */
export const THEMES: Readonly<Record<string, PaperTheme>> = {
  'graph-paper': theme({ ruling: 'grid', margin: 3, marginKind: 'single' }),
  'ruled-paper': theme({
    ruling: 'seyes',
    line: 0xbccdea,
    line2: 0xa0b6df,
    margin: 3,
    marginKind: 'single',
  }),
  practice: theme({ paper: 0xfaf7ec, shade: 0xe8e0c6, ruling: 'big-grid', line: 0xd4dff2 }),
  'staff-paper': theme({
    paper: 0xf9f5e8,
    shade: 0xe5dbbd,
    ruling: 'staff',
    line: 0x6b6f86,
    line2: 0x6b6f86,
  }),
  'scratch-paper': theme({
    paper: 0xf2eee2,
    shade: 0xddd5bb,
    ruling: 'scratch',
    line: 0xd9d9d6,
    line2: 0xc9c9c4,
    crumpled: true,
  }),
  'treasure-map': theme({
    paper: 0xefdcae,
    shade: 0xcfb67a,
    ruling: 'parchment',
    line: 0xcdb98b,
    line2: 0xbca673,
    burnt: true,
  }),
  'comic-page': theme({ paper: 0xfbf8ee, shade: 0xe9e2cc, ruling: 'dots', line: 0xe1d8bd }),
  'cover-page': theme({ paper: 0xe6edf3, shade: 0xcbd6e0, ruling: 'plain', line: 0xd5dde6 }),
  'millimeter-paper': theme({
    paper: 0xf6f0d8,
    shade: 0xe2d8b0,
    ruling: 'mm',
    line: 0xf3d3b2,
    line2: 0xe9a974,
  }),
  'dictionary-page': theme({
    paper: 0xf2e8c6,
    shade: 0xd9c995,
    ruling: 'columns',
    line: 0xd8c99a,
    line2: 0xc9b77f,
  }),
  'doodle-margin': theme({
    ruling: 'seyes',
    line: 0xbccdea,
    line2: 0xa0b6df,
    margin: 14,
    marginKind: 'wide',
  }),
  spread: theme({ ruling: 'grid', binding: true }),
};

export function themeOf(id: string): PaperTheme {
  return Object.prototype.hasOwnProperty.call(THEMES, id) ? THEMES[id] : BASE;
}

/** Jetons de l'interface (copie des variables CSS de `style.css`, pour les tests de contraste). */
export const UI = {
  paper: 0xfbf7ea,
  paper2: 0xf1ead3,
  ink: 0x1b2a5e,
  inkSoft: 0x44507f,
  accent: 0x1f4fd1,
  onAccent: 0xffffff,
  danger: 0xb82a26,
  ok: 0x17734a,
  gold: 0x8a6a00,
} as const;

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur 0xRRGGBB. */
export function luminance(color: number): number {
  return (
    0.2126 * lin((color >> 16) & 255) + 0.7152 * lin((color >> 8) & 255) + 0.0722 * lin(color & 255)
  );
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21). */
export function contrast(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Assombrit `color` jusqu'à atteindre le contraste `min` sur `bg` (l'or et le rose sont trop
 * pâles sur du papier crème). L'identité de couleur est conservée (même teinte, plus sombre).
 */
export function legibleInk(color: number, bg: number, min = 3): number {
  if (contrast(color, bg) >= min) return color;
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  for (let k = 0.95; k > 0; k -= 0.025) {
    const c = (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
    if (contrast(c, bg) >= min) return c;
  }
  return 0;
}
