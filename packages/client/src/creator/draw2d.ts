import { Cell, CELL, WeaponId } from '@stickyclaude/shared';
import { OBJECT_SHAPES, WEAPON_INK, WEAPON_SHAPES } from '../render/shapes.ts';
import type { Shape } from '../render/shapes.ts';
import { ObjType } from '@stickyclaude/shared';
import { css } from '../render/palette.ts';

/** Dessin Canvas2D des éléments du créateur, avec les mêmes formes que le jeu. */

/** Trace une forme du jeu : ses points sont relatifs à `(x, y)` (pied de l'objet), `scale` l'agrandit. */
export function strokeShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  x: number,
  y: number,
  color: number,
  width = 1.8,
  scale = 1,
  dx = 0,
  dy = 0,
): void {
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let s = 0; s < shape.strokes.length; s++) {
    const pts = shape.strokes[s];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const px = x + (pts[i] - dx) * scale;
      const py = y + (pts[i + 1] - dy) * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (shape.closed[s]) ctx.closePath();
    ctx.stroke();
  }
}

/** Objet posé dans la case `(cx, cy)` : caisse, ballon ou punaise, comme dans le jeu. */
export function drawProp(
  ctx: CanvasRenderingContext2D,
  type: string,
  cx: number,
  cy: number,
): void {
  const t = type === 'crate' ? ObjType.CRATE : type === 'balloon' ? ObjType.BALLOON : ObjType.TACK;
  const shape = OBJECT_SHAPES[t];
  if (!shape) return;
  const x = (cx + 0.5) * CELL;
  const y = (cy + 1) * CELL;
  if (t === ObjType.CRATE) {
    ctx.fillStyle = 'rgba(185,138,90,0.5)';
    ctx.fillRect(x - 7.4, y - 15.4, 14.8, 14.8);
  }
  strokeShape(
    ctx,
    shape,
    x,
    y,
    t === ObjType.CRATE ? 0x7a4a2b : t === ObjType.BALLOON ? 0xe5579a : 0x6b7280,
    2,
  );
  if (t === ObjType.BALLOON) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(x - 2.2, y - 18, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Point d'apparition d'une arme : le pistolet du jeu, sur une pastille orange. */
export function drawWeaponSpawn(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  landRow = cy,
): void {
  // posé trop haut : l'arme apparaîtra au sol (trait pointillé), ou nulle part s'il n'y en a pas
  if (landRow !== cy) {
    const x0 = (cx + 0.5) * CELL;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = landRow < 0 ? 'rgba(214,50,46,0.8)' : 'rgba(232,128,26,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, (cy + 1) * CELL - 6);
    ctx.lineTo(x0, (landRow < 0 ? cy + 2 : landRow + 1) * CELL - 6);
    ctx.stroke();
    ctx.restore();
    if (landRow < 0) return;
    cy = landRow;
  }
  const shape = WEAPON_SHAPES[WeaponId.PISTOL];
  const x = (cx + 0.5) * CELL;
  const y = (cy + 1) * CELL;
  ctx.fillStyle = 'rgba(232,128,26,0.28)';
  ctx.beginPath();
  ctx.arc(x, y - 6, 9, 0, Math.PI * 2);
  ctx.fill();
  if (shape) {
    strokeShape(
      ctx,
      shape,
      x,
      y - 6,
      WEAPON_INK[WeaponId.PISTOL] ?? 0x22262e,
      1.6,
      0.8,
      shape.cx,
      shape.cy,
    );
  }
}

/** Point d'apparition d'un joueur : un petit stickman debout, numéroté. */
export function drawPlayerSpawn(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  n: number,
): void {
  const x = (cx + 0.5) * CELL;
  const y = (cy + 1) * CELL;
  ctx.strokeStyle = '#1f9d55';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - 24.4, 4.4, 0, Math.PI * 2);
  ctx.moveTo(x, y - 20);
  ctx.lineTo(x, y - 11);
  ctx.moveTo(x, y - 11);
  ctx.lineTo(x - 3.2, y);
  ctx.moveTo(x, y - 11);
  ctx.lineTo(x + 3.2, y);
  ctx.moveTo(x - 4.4, y - 8.6);
  ctx.lineTo(x, y - 16);
  ctx.lineTo(x + 4.4, y - 8.6);
  ctx.stroke();
  ctx.fillStyle = '#1f9d55';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(n), x, y - 31);
}

/** Cellule de danger : trois pointes d'encre rouge, comme dans le jeu. */
export function drawHazard(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = x * CELL;
  const py = y * CELL;
  ctx.fillStyle = 'rgba(214,50,46,0.22)';
  ctx.strokeStyle = '#d6322e';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const xs = [0, 2.6, 5.3, 8, 10.7, 13.3, 16];
  const ys = [16, 3.4, 16, 1.6, 16, 3.8, 16];
  for (let i = 0; i < xs.length; i++) {
    if (i === 0) ctx.moveTo(px + xs[i], py + ys[i]);
    else ctx.lineTo(px + xs[i], py + ys[i]);
  }
  ctx.fill();
  ctx.stroke();
}

/** Lave, scie et trampoline dans le créateur : mêmes couleurs que dans le jeu. */
export function drawSpecialCell(
  ctx: CanvasRenderingContext2D,
  cell: number,
  cx: number,
  cy: number,
): void {
  const px = cx * CELL;
  const py = cy * CELL;
  if (cell === Cell.LAVA) {
    ctx.fillStyle = '#f0643c';
    ctx.fillRect(px, py, CELL, CELL);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = py + 1.6 + Math.sin((cx * 4 + i) * 1.7) * 1.2;
      if (i === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px + i * 4, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffc65a';
    ctx.beginPath();
    ctx.arc(px + 5 + (cx % 3) * 3, py + 11, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (cell === Cell.SAW) {
    const mx = px + CELL / 2;
    const my = py + CELL / 2;
    ctx.beginPath();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = i % 2 === 0 ? 8 : 5.6;
      if (i === 0) ctx.moveTo(mx + Math.cos(a) * r, my + Math.sin(a) * r);
      else ctx.lineTo(mx + Math.cos(a) * r, my + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#aab2c0';
    ctx.fill();
    ctx.strokeStyle = '#22262e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#d6322e';
    ctx.beginPath();
    ctx.arc(mx, my, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (cell === Cell.TRAMPOLINE) {
    ctx.fillStyle = '#f29ab8';
    ctx.fillRect(px + 0.8, py + 1.4, CELL - 1.6, CELL - 2.2);
    ctx.strokeStyle = '#22262e';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.8, py + 1.4, CELL - 1.6, CELL - 2.2);
    ctx.fillStyle = '#1f4fd1';
    ctx.fillRect(px + 1.2, py + 10.2, CELL - 2.4, 4.4);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const y = py + (i % 2 === 0 ? 1.4 : 0.2);
      if (i === 0) ctx.moveTo(px + 1, y);
      else ctx.lineTo(px + 1 + i * 2.33, y);
    }
    ctx.stroke();
  }
}
