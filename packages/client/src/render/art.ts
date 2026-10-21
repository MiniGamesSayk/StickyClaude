import { CELL } from '@stickyclaude/shared';
import { boilX, boilY, hash2, rand2, srand2, valueNoise } from './noise.ts';
import { css } from './palette.ts';
import type { Polyline } from './contour.ts';

/**
 * Aides de dessin Canvas2D pour le papier, le terrain et le décor : tracé à main levée (sommets
 * déformés par un bruit de valeur, tremblé par variante), hachures, tuile de grain. Tout est une
 * fonction pure de la géométrie : un morceau redessiné redonne exactement le même trait.
 */

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  return [c, ctx];
}

/** Paramètres de tremblé d'un tracé. */
export interface Wobble {
  /** Amplitude de la déformation lente « à main levée » (unités de monde). */
  low: number;
  /** Amplitude du tremblé (line boiling) et sa variante (0 à 2). */
  boil: number;
  variant: number;
  seed: number;
}

/** Rééchantillonne une polyligne (en cellules) tous les `step` cellules. Retourne x, y en cellules. */
export function resample(line: Polyline, step = 0.7): number[] {
  const p = line.pts;
  const out: number[] = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const x0 = p[i - 2];
    const y0 = p[i - 1];
    const dx = p[i] - x0;
    const dy = p[i + 1] - y0;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) out.push(x0 + (dx * k) / n, y0 + (dy * k) / n);
  }
  return out;
}

/** Déforme un point (unités de monde) : bruit lent + tremblé indexé par la position. */
export function wobblePoint(x: number, y: number, wb: Wobble, out: { x: number; y: number }): void {
  const nx = valueNoise(x * 0.045, y * 0.045, wb.seed) * wb.low;
  const ny = valueNoise(x * 0.045 + 31.7, y * 0.045 + 17.3, wb.seed + 1) * wb.low;
  let bx = 0;
  let by = 0;
  if (wb.boil > 0) {
    const id = hash2(Math.round(x * 4), Math.round(y * 4), wb.seed) & 255;
    bx = boilX(id, wb.variant) * wb.boil;
    by = boilY(id, wb.variant) * wb.boil;
  }
  out.x = x + nx + bx;
  out.y = y + ny + by;
}

const tmp = { x: 0, y: 0 };

/** Chemin lissé (quadratique par les milieux) sur des points en cellules, déformés. */
export function pathCells(
  ctx: CanvasRenderingContext2D,
  cells: number[],
  closed: boolean,
  wb: Wobble,
): void {
  const n = cells.length / 2;
  if (n < 2) return;
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < n; i++) {
    wobblePoint(cells[i * 2] * CELL, cells[i * 2 + 1] * CELL, wb, tmp);
    px.push(tmp.x);
    py.push(tmp.y);
  }
  ctx.beginPath();
  if (closed && n > 2) {
    const last = n - 1; // le dernier point répète le premier
    ctx.moveTo((px[last - 1] + px[0]) / 2, (py[last - 1] + py[0]) / 2);
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % last;
      ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[j]) / 2, (py[i] + py[j]) / 2);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(px[0], py[0]);
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[i + 1]) / 2, (py[i] + py[i + 1]) / 2);
    }
    ctx.lineTo(px[n - 1], py[n - 1]);
  }
}

/** Trace une polyligne (en cellules) à main levée : deux passes, la seconde plus fine et décalée. */
export function strokeHandDrawn(
  ctx: CanvasRenderingContext2D,
  line: Polyline,
  color: number,
  width: number,
  wb: Wobble,
  retrace = true,
): void {
  const cells = resample(line);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  pathCells(ctx, cells, line.closed, wb);
  ctx.stroke();
  if (retrace) {
    ctx.lineWidth = width * 0.45;
    pathCells(ctx, cells, line.closed, { ...wb, seed: wb.seed + 977, low: wb.low * 1.2 });
    ctx.stroke();
  }
}

/** Tuile de grain du papier (bruit léger, répétée sur toute la page). */
let grainTile: HTMLCanvasElement | null = null;
export function grainPattern(
  ctx: CanvasRenderingContext2D,
  color: number,
  alpha: number,
): CanvasPattern {
  if (!grainTile) {
    const [c, g] = canvas2d(256, 256);
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const a = rand2(x, y, 3) * 0.7 + valueNoise(x * 0.07, y * 0.07, 9) * 0.3;
        const i = (y * 256 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    g.putImageData(img, 0, 0);
    grainTile = c;
  }
  // teinte et opacité : on recolorie une copie
  const [c2, g2] = canvas2d(256, 256);
  g2.fillStyle = css(color, alpha);
  g2.fillRect(0, 0, 256, 256);
  g2.globalCompositeOperation = 'destination-in';
  g2.drawImage(grainTile, 0, 0);
  const p = ctx.createPattern(c2, 'repeat');
  if (!p) throw new Error('motif de grain indisponible');
  return p;
}

/**
 * Hachures à 45° dans la fenêtre [x0, x1) × [y0, y1) (unités de monde), en traits discontinus :
 * `dir` = 1 pour « \ », −1 pour « / ». À appeler après avoir défini la zone par `ctx.clip()`.
 */
export function hatch(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing: number,
  dir: 1 | -1,
  color: number,
  width: number,
  seed: number,
  variant: number,
  boil: number,
): void {
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  // lignes x - dir·y = c (diagonales) : c varie sur toute la fenêtre
  const cMin = Math.floor((dir === 1 ? x0 - y1 : x0 + y0) / spacing) - 1;
  const cMax = Math.ceil((dir === 1 ? x1 - y0 : x1 + y1) / spacing) + 1;
  ctx.beginPath();
  for (let k = cMin; k <= cMax; k++) {
    const c = k * spacing;
    // la ligne traverse la fenêtre : on la découpe en tirets irréguliers
    const tMin = y0 - 6;
    const tMax = y1 + 6;
    let t = tMin + rand2(k, seed, 1) * 14;
    while (t < tMax) {
      const len = 10 + rand2(k, Math.floor(t), seed) * 30;
      const t2 = Math.min(tMax, t + len);
      const ax = dir === 1 ? c + t : c - t;
      const bx = dir === 1 ? c + t2 : c - t2;
      const jx = boil > 0 ? boilX(((k * 7 + Math.floor(t)) & 255) >>> 0, variant) * boil : 0;
      const jy = boil > 0 ? boilY(((k * 5 + Math.floor(t)) & 255) >>> 0, variant) * boil : 0;
      ctx.moveTo(ax + jx + srand2(k, Math.floor(t), seed + 2) * 0.35, t + jy);
      ctx.lineTo(bx + jx + srand2(k, Math.floor(t2), seed + 3) * 0.35, t2 + jy);
      t = t2 + 2 + rand2(k, Math.floor(t2), seed + 4) * 7;
    }
  }
  ctx.stroke();
}

/** Mélange deux couleurs 0xRRGGBB. */
export function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * t);
  const bl = Math.round(ab + ((b & 255) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
