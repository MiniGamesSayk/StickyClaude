/** Styles de trait (champ `stroke` de l'apparence) : stylo bille, feutre, crayon, pinceau. */
export const PenStyle = { BALLPOINT: 0, MARKER: 1, PENCIL: 2, BRUSH: 3 } as const;

/** Épaisseur de base (unités de monde) de chaque style, voir `docs/DIRECTION_ARTISTIQUE.md` §3. */
export const PEN_WIDTH = [2.2, 3.8, 2.6, 3.2] as const;
