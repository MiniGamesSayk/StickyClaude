import { Cell, GRID_H, GRID_W } from '@stickyclaude/shared';

/**
 * Contours du terrain par marching squares (analyse §2.7). Pur : aucune dépendance au rendu.
 *
 * La grille de cellules est sur-échantillonnée `SS` fois (chaque cellule = SS × SS échantillons de
 * même valeur) : les angles ne sont plus coupés que de 1/(2·SS) de cellule, donc le tracé reste
 * collé aux boîtes de collision. Un contour est une suite de points en **unités de cellule**,
 * fermée (premier = dernier) ou ouverte (au bord de la zone calculée).
 */

export const SS = 2;

export interface Polyline {
  /** x0, y0, x1, y1… en cellules. */
  pts: number[];
  closed: boolean;
}

/** Une cellule pleine pour les contours : bloc plein ou bloc de papier selon le filtre. */
export type CellFilter = (cell: number) => boolean;

export const isSolidCell: CellFilter = (c) => c === Cell.SOLID;
export const isPaperCell: CellFilter = (c) => c === Cell.PAPER;

/**
 * Contours des cellules retenues par `filter` dans le rectangle `[cx0, cx1) × [cy0, cy1)` (en
 * cellules). Au-delà de la grille, on prolonge la cellule du bord (une paroi pleine sur le côté
 * reste pleine en dehors de la page : pas de contour le long de la page).
 */
export function contours(
  cells: ArrayLike<number>,
  filter: CellFilter,
  cx0 = 0,
  cy0 = 0,
  cx1 = GRID_W,
  cy1 = GRID_H,
): Polyline[] {
  return contoursIn(cells, GRID_W, GRID_H, filter, cx0, cy0, cx1, cy1);
}

/** Marge (cellules) ajoutée autour de la page par `fillContours`. */
const FILL_PAD = 2;

/**
 * Contours **tous fermés** des cellules retenues, pour remplir ou découper une forme : la page est
 * prolongée de `FILL_PAD` cellules (les murs qui touchent le bord continuent), puis entourée d'une
 * rangée vide. Un contour ouvert, une fois fermé par une droite, couperait la forme en biais ;
 * ici les coins arrondis du trait correspondent exactement à ceux du remplissage.
 */
export function fillContours(cells: ArrayLike<number>, filter: CellFilter): Polyline[] {
  const pad = FILL_PAD;
  const ew = GRID_W + 2 * pad;
  const eh = GRID_H + 2 * pad;
  const ext = new Uint8Array(ew * eh);
  for (let y = 1; y < eh - 1; y++) {
    for (let x = 1; x < ew - 1; x++) {
      const gx = Math.min(GRID_W - 1, Math.max(0, x - pad));
      const gy = Math.min(GRID_H - 1, Math.max(0, y - pad));
      ext[y * ew + x] = cells[gy * GRID_W + gx];
    }
  }
  const lines = contoursIn(ext, ew, eh, filter, 0, 0, ew, eh);
  for (const l of lines) {
    for (let i = 0; i < l.pts.length; i += 2) {
      l.pts[i] -= pad;
      l.pts[i + 1] -= pad;
    }
  }
  return lines;
}

function contoursIn(
  cells: ArrayLike<number>,
  gridW: number,
  gridH: number,
  filter: CellFilter,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
): Polyline[] {
  const w = (cx1 - cx0) * SS + 1;
  const h = (cy1 - cy0) * SS + 1;
  // Échantillons aux centres des sous-cellules, avec une bordure d'un échantillon.
  const field = new Uint8Array((w + 1) * (h + 1));
  const stride = w + 1;
  for (let j = 0; j <= h; j++) {
    for (let i = 0; i <= w; i++) {
      const gx = Math.min(gridW - 1, Math.max(0, cx0 + Math.floor((i - 1) / SS)));
      const gy = Math.min(gridH - 1, Math.max(0, cy0 + Math.floor((j - 1) / SS)));
      field[j * stride + i] = filter(cells[gy * gridW + gx]) ? 1 : 0;
    }
  }
  // Segments entre points milieu des arêtes de chaque carré de 2 × 2 échantillons.
  // Les échantillons sont aux centres des sous-cellules : le carré (i, j) a son coin haut-gauche
  // au centre de la sous-cellule (i-1, j-1), en coordonnées de cellule : (i - 0.5)/SS - ... .
  type Pt = [number, number];
  const segs: [Pt, Pt][] = [];
  const toCell = (i: number, j: number): Pt => [cx0 + (i - 0.5) / SS, cy0 + (j - 0.5) / SS];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = field[j * stride + i];
      const b = field[j * stride + i + 1];
      const c = field[(j + 1) * stride + i + 1];
      const d = field[(j + 1) * stride + i];
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      // milieux : haut (a-b), droite (b-c), bas (d-c), gauche (a-d)
      const top: Pt = toCell(i + 0.5, j);
      const right: Pt = toCell(i + 1, j + 0.5);
      const bottom: Pt = toCell(i + 0.5, j + 1);
      const left: Pt = toCell(i, j + 0.5);
      switch (code) {
        case 1:
        case 14:
          segs.push([left, top]);
          break;
        case 2:
        case 13:
          segs.push([top, right]);
          break;
        case 3:
        case 12:
          segs.push([left, right]);
          break;
        case 4:
        case 11:
          segs.push([right, bottom]);
          break;
        case 6:
        case 9:
          segs.push([top, bottom]);
          break;
        case 7:
        case 8:
          segs.push([left, bottom]);
          break;
        case 5:
          segs.push([left, top], [right, bottom]);
          break;
        case 10:
          segs.push([top, right], [left, bottom]);
          break;
      }
    }
  }
  return chain(segs);
}

const key = (p: [number, number]): string => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`;

/** Relie les segments bout à bout en polylignes. */
function chain(segs: [[number, number], [number, number]][]): Polyline[] {
  const byEnd = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const l = byEnd.get(k);
      if (l) l.push(i);
      else byEnd.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: Polyline[] = [];
  const next = (from: [number, number], except: number): number => {
    const l = byEnd.get(key(from));
    if (!l) return -1;
    for (const i of l) if (i !== except && used[i] === 0) return i;
    return -1;
  };
  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const pts: [number, number][] = [segs[start][0], segs[start][1]];
    // prolonge à la fin
    for (let guard = 0; guard < segs.length; guard++) {
      const tail = pts[pts.length - 1];
      const i = next(tail, -1);
      if (i < 0) break;
      used[i] = 1;
      const s = segs[i];
      pts.push(key(s[0]) === key(tail) ? s[1] : s[0]);
    }
    // prolonge au début
    for (let guard = 0; guard < segs.length; guard++) {
      const head = pts[0];
      if (key(head) === key(pts[pts.length - 1]) && pts.length > 2) break;
      const i = next(head, -1);
      if (i < 0) break;
      used[i] = 1;
      const s = segs[i];
      pts.unshift(key(s[0]) === key(head) ? s[1] : s[0]);
    }
    const closed = pts.length > 2 && key(pts[0]) === key(pts[pts.length - 1]);
    const flat: number[] = [];
    for (const p of pts) flat.push(p[0], p[1]);
    out.push({ pts: flat, closed });
  }
  return out;
}

/** Supprime les points alignés d'une polyligne (les longs murs droits n'ont besoin que d'extrémités). */
export function simplify(line: Polyline, eps = 1e-6): Polyline {
  const p = line.pts;
  const n = p.length / 2;
  if (n < 3) return line;
  const out: number[] = [p[0], p[1]];
  for (let i = 1; i < n - 1; i++) {
    const ax = p[i * 2] - p[i * 2 - 2];
    const ay = p[i * 2 + 1] - p[i * 2 - 1];
    const bx = p[i * 2 + 2] - p[i * 2];
    const by = p[i * 2 + 3] - p[i * 2 + 1];
    if (Math.abs(ax * by - ay * bx) > eps) out.push(p[i * 2], p[i * 2 + 1]);
  }
  out.push(p[n * 2 - 2], p[n * 2 - 1]);
  return { pts: out, closed: line.closed };
}

/** Longueur totale d'une polyligne, en cellules. */
export function length(line: Polyline): number {
  let l = 0;
  for (let i = 2; i < line.pts.length; i += 2) {
    l += Math.hypot(line.pts[i] - line.pts[i - 2], line.pts[i + 1] - line.pts[i - 1]);
  }
  return l;
}
