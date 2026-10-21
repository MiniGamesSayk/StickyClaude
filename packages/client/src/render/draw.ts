import { boilX, boilY } from './noise.ts';
import type { Pen } from './pen.ts';
import type { Shape } from './shapes.ts';

/**
 * Dessin des formes avec le stylo : placement, rotation, retournement horizontal et tremblé
 * (line boiling). Aucune allocation : les points transformés passent par un tampon partagé.
 */

const scratch = new Float32Array(512);

/** Tremblé appliqué à chaque sommet : variante courante, amplitude (0 = coupé) et décalage de graine. */
export interface Boil {
  variant: number;
  amp: number;
  seed: number;
}

/**
 * Trace `s` : chaque point est mis à l'échelle, tourné de `ang`, placé en (lx, ly) du repère local
 * du joueur, puis converti en monde (x = ox + facing × x local). `facing` vaut ±1.
 */
export function drawShape(
  pen: Pen,
  s: Shape,
  ox: number,
  oy: number,
  facing: number,
  lx: number,
  ly: number,
  ang: number,
  scale: number,
  w: number,
  color: number,
  alpha: number,
  style: number,
  boil: Boil,
): void {
  const c = Math.cos(ang) * scale;
  const sn = Math.sin(ang) * scale;
  for (let k = 0; k < s.strokes.length; k++) {
    const pts = s.strokes[k];
    const n = Math.min(pts.length >> 1, 255);
    for (let i = 0; i < n; i++) {
      const px = pts[i * 2];
      const py = pts[i * 2 + 1];
      const id = boil.seed + k * 31 + i;
      const x = lx + px * c - py * sn + (boil.amp > 0 ? boilX(id, boil.variant) * boil.amp : 0);
      const y = ly + px * sn + py * c + (boil.amp > 0 ? boilY(id, boil.variant) * boil.amp : 0);
      scratch[i * 2] = ox + facing * x;
      scratch[i * 2 + 1] = oy + y;
    }
    pen.poly(scratch, n, s.closed[k], w, color, alpha, style);
  }
}

/**
 * Comme `drawShape`, mais en repère monde (pas de retournement) : objets, projectiles, décor.
 */
export function drawShapeWorld(
  pen: Pen,
  s: Shape,
  x: number,
  y: number,
  ang: number,
  scale: number,
  w: number,
  color: number,
  alpha: number,
  style: number,
  boil: Boil,
): void {
  drawShape(pen, s, x, y, 1, 0, 0, ang, scale, w, color, alpha, style, boil);
}
