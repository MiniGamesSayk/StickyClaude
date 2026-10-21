import { CELL, WORLD_H, WORLD_W } from '@stickyclaude/shared';
import type { ArenaData, DecorData } from '@stickyclaude/shared';
import { blend, canvas2d, grainPattern } from './art.ts';
import { rand2, seedOf, srand2, valueNoise } from './noise.ts';
import { css, DECOR_ALPHA, INK, themeOf } from './palette.ts';
import type { PaperTheme } from './palette.ts';
import {
  ARROW,
  AXES,
  BURST,
  CLEF,
  COMPASS_ROSE,
  CROSS,
  HEART,
  NOTE_BEAMED,
  NOTE_QUAVER,
  RULER_DECOR,
  SCRIBBLE,
  SMILEY,
  SPIRAL,
  STAR,
  WAVE,
} from './shapes.ts';
import type { Shape } from './shapes.ts';

/**
 * Le papier de la page et son décor (analyse §2.7) : réglure du thème, marge rouge, grain,
 * vignettage, puis les dessins de l'arène. Rendu **une seule fois** par arène dans un canvas.
 */

export const FONT_BODY = '"Patrick Hand", "Comic Sans MS", "Segoe Print", cursive';
export const FONT_DISPLAY = '"Bangers", "Impact", "Comic Sans MS", cursive';

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
}

function ruling(ctx: CanvasRenderingContext2D, th: PaperTheme, seed: number): void {
  const W = WORLD_W;
  const H = WORLD_H;
  ctx.lineCap = 'butt';
  switch (th.ruling) {
    case 'grid': {
      ctx.strokeStyle = css(th.line);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 8) line(ctx, 0, y, W, y);
      ctx.stroke();
      ctx.strokeStyle = css(th.line2);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 32) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 32) line(ctx, 0, y, W, y);
      ctx.stroke();
      break;
    }
    case 'seyes': {
      ctx.strokeStyle = css(th.line);
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      for (let y = 0; y <= H; y += 4) if (y % 16 !== 0) line(ctx, 0, y, W, y);
      ctx.stroke();
      ctx.strokeStyle = css(th.line2);
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      for (let y = 0; y <= H; y += 16) line(ctx, 0, y, W, y);
      for (let x = 0; x <= W; x += 64) line(ctx, x, 0, x, H);
      ctx.stroke();
      break;
    }
    case 'big-grid': {
      ctx.strokeStyle = css(th.line);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 16) line(ctx, 0, y, W, y);
      ctx.stroke();
      break;
    }
    case 'staff': {
      ctx.strokeStyle = css(th.line, 0.85);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let top = 24; top + 16 < H - 8; top += 64) {
        for (let k = 0; k < 5; k++) line(ctx, 24, top + k * 4 + 8, W - 24, top + k * 4 + 8);
        line(ctx, 24, top + 8, 24, top + 24);
        line(ctx, W - 24, top + 8, W - 24, top + 24);
      }
      ctx.stroke();
      break;
    }
    case 'scratch': {
      ctx.strokeStyle = css(th.line);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 8) line(ctx, 0, y, W, y);
      ctx.stroke();
      // plis froissés : lignes brisées claires et sombres
      for (let i = 0; i < 9; i++) {
        let x = rand2(i, 1, seed) * W;
        let y = rand2(i, 2, seed) * H;
        const a = rand2(i, 3, seed) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += Math.cos(a + srand2(i, k, seed) * 0.6) * (40 + rand2(i, k + 9, seed) * 60);
          y += Math.sin(a + srand2(i, k, seed) * 0.6) * (40 + rand2(i, k + 9, seed) * 60);
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = css(0xffffff, 0.55);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.strokeStyle = css(th.shade, 0.7);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      break;
    }
    case 'parchment': {
      ctx.strokeStyle = css(th.line, 0.6);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 16) line(ctx, 0, y, W, y);
      ctx.stroke();
      // taches de vieillissement
      for (let i = 0; i < 14; i++) {
        const x = rand2(i, 5, seed) * W;
        const y = rand2(i, 6, seed) * H;
        const r = 30 + rand2(i, 7, seed) * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css(th.shade, 0.35));
        g.addColorStop(1, css(th.shade, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    }
    case 'dots': {
      ctx.fillStyle = css(th.line, 0.9);
      for (let y = 3; y < H; y += 6) {
        for (let x = 3 + ((y / 6) % 2) * 3; x < W; x += 6) {
          ctx.beginPath();
          ctx.arc(x, y, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'mm': {
      ctx.strokeStyle = css(th.line, 0.8);
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 3.2) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 3.2) line(ctx, 0, y, W, y);
      ctx.stroke();
      ctx.strokeStyle = css(th.line2, 0.75);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 16) line(ctx, 0, y, W, y);
      ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 80) line(ctx, x, 0, x, H);
      for (let y = 0; y <= H; y += 80) line(ctx, 0, y, W, y);
      ctx.stroke();
      break;
    }
    case 'columns': {
      // deux pages de dictionnaire : colonnes de filets fins imitant du texte
      ctx.strokeStyle = css(th.line, 0.9);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      line(ctx, W / 2, 0, W / 2, H);
      line(ctx, 20, 0, 20, H);
      line(ctx, W - 20, 0, W - 20, H);
      for (let col = 0; col < 4; col++) {
        const x0 = 28 + col * 245;
        for (let y = 20; y < H - 16; y += 7) {
          let x = x0;
          const end = x0 + 218;
          while (x < end) {
            const len = 14 + rand2(col, y * 31 + Math.floor(x), seed) * 44;
            line(ctx, x, y, Math.min(end, x + len), y);
            x += len + 3.5;
          }
        }
      }
      ctx.stroke();
      break;
    }
    case 'plain':
    default:
      break;
  }
}

function margin(ctx: CanvasRenderingContext2D, th: PaperTheme): void {
  if (th.marginKind === 'none') return;
  const x = th.margin * CELL;
  ctx.strokeStyle = css(0xe58b8b, 0.7);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  line(ctx, x, 0, x, WORLD_H);
  if (th.marginKind === 'wide') {
    line(ctx, x - 5, 0, x - 5, WORLD_H);
    ctx.stroke();
    ctx.fillStyle = css(0xe58b8b, 0.1);
    ctx.fillRect(0, 0, x - 5, WORLD_H);
  } else {
    line(ctx, x + 3, 0, x + 3, WORLD_H);
    ctx.stroke();
  }
}

function binding(ctx: CanvasRenderingContext2D, th: PaperTheme): void {
  const cx = WORLD_W / 2;
  const g = ctx.createLinearGradient(cx - 46, 0, cx + 46, 0);
  g.addColorStop(0, css(th.shade, 0));
  g.addColorStop(0.45, css(th.shade, 0.75));
  g.addColorStop(0.5, css(blend(th.shade, 0x000000, 0.25), 0.9));
  g.addColorStop(0.55, css(th.shade, 0.75));
  g.addColorStop(1, css(th.shade, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - 46, 0, 92, WORLD_H);
}

/** Papier, réglure, marge, grain et vignettage. */
function paintPaper(ctx: CanvasRenderingContext2D, th: PaperTheme, seed: number): void {
  ctx.fillStyle = css(th.paper);
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ruling(ctx, th, seed);
  margin(ctx, th);
  if (th.binding) binding(ctx, th);
  ctx.fillStyle = grainPattern(ctx, 0x8b7f5c, 0.05);
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // vignettage : ombre vers les bords
  const r = Math.hypot(WORLD_W, WORLD_H) / 2;
  const g = ctx.createRadialGradient(
    WORLD_W / 2,
    WORLD_H / 2,
    r * 0.62,
    WORLD_W / 2,
    WORLD_H / 2,
    r,
  );
  g.addColorStop(0, css(th.shade, 0));
  g.addColorStop(1, css(th.shade, th.burnt ? 0.95 : 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  if (th.burnt) {
    // bords brûlés : bande brune irrégulière
    ctx.strokeStyle = css(0x7a5522, 0.45);
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const n = 90;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const wob = 3 + valueNoise(t * 24, 1, seed) * 3;
      const x = t * WORLD_W;
      if (i === 0) ctx.moveTo(x, wob);
      else ctx.lineTo(x, wob);
    }
    ctx.stroke();
  }
}

// --- Décor ----------------------------------------------------------------------------------

interface DecorStyle {
  ink: number;
  red: number;
}

function decorStyle(th: PaperTheme, themeId: string): DecorStyle {
  if (themeId === 'treasure-map') return { ink: 0x6e4a1e, red: 0xa83a22 };
  if (themeId === 'comic-page') return { ink: 0x22262e, red: INK.red };
  if (themeId === 'dictionary-page') return { ink: 0x4a3b1f, red: 0x9c3a22 };
  void th;
  return { ink: INK.night, red: INK.red };
}

function strokeShape(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  x: number,
  y: number,
  scale: number,
  rot: number,
  width: number,
  color: number,
  alpha: number,
  seed: number,
): void {
  const c = Math.cos(rot) * scale;
  const sn = Math.sin(rot) * scale;
  ctx.strokeStyle = css(color, alpha);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let k = 0; k < s.strokes.length; k++) {
    const p = s.strokes[k];
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) {
      const jx = srand2(i, k, seed) * 0.5;
      const jy = srand2(i, k + 7, seed) * 0.5;
      const px = x + p[i] * c - p[i + 1] * sn + jx;
      const py = y + p[i] * sn + p[i + 1] * c + jy;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (s.closed[k]) ctx.closePath();
    ctx.stroke();
  }
}

function fillShape(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  x: number,
  y: number,
  scale: number,
  rot: number,
  color: number,
  alpha: number,
): void {
  const c = Math.cos(rot) * scale;
  const sn = Math.sin(rot) * scale;
  ctx.fillStyle = css(color, alpha);
  const p = s.strokes[0];
  ctx.beginPath();
  for (let i = 0; i < p.length; i += 2) {
    const px = x + p[i] * c - p[i + 1] * sn;
    const py = y + p[i] * sn + p[i + 1] * c;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  color: number,
  alpha: number,
  rot: number,
  font = FONT_BODY,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = css(color, alpha);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

function wavyUnderline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  color: number,
  alpha: number,
): void {
  ctx.strokeStyle = css(color, alpha);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = 0; i <= w; i += 4) {
    const yy = y + Math.sin(i * 0.4) * 1.1;
    if (i === 0) ctx.moveTo(x + i, yy);
    else ctx.lineTo(x + i, yy);
  }
  ctx.stroke();
}

const MUSIC = new Set(['♪', '♫', '♩']);

function drawDecor(
  ctx: CanvasRenderingContext2D,
  d: DecorData,
  st: DecorStyle,
  seed: number,
): void {
  const x = d.at[0] * CELL;
  const y = d.at[1] * CELL;
  const s = seed + seedOf(d.type + d.at.join(','));
  const rot = srand2(d.at[0], d.at[1], s) * 0.07;
  const a = DECOR_ALPHA;
  const txt = d.text ?? '';
  switch (d.type) {
    case 'equation': {
      text(ctx, txt, x, y + 14, 22, st.ink, a, rot);
      ctx.font = `22px ${FONT_BODY}`;
      wavyUnderline(ctx, x, y + 20, ctx.measureText(txt).width, st.ink, a * 0.8);
      break;
    }
    case 'note': {
      if ([...txt].some((c) => MUSIC.has(c))) {
        let nx = x + 8;
        for (const c of txt) {
          if (c === '♫') strokeShape(ctx, NOTE_BEAMED, nx, y + 20, 11, 0, 1.4, st.ink, a, s);
          else if (MUSIC.has(c))
            strokeShape(ctx, NOTE_QUAVER, nx, y + 20, 11, 0, 1.4, st.ink, a, s);
          nx += c === '♫' ? 30 : 16;
        }
        break;
      }
      const loud = txt.includes('!');
      const color = loud ? st.red : st.ink;
      text(ctx, txt, x, y + 14, loud ? 19 : 18, color, loud ? 0.8 : a, rot * 1.5);
      ctx.font = `${loud ? 19 : 18}px ${FONT_BODY}`;
      wavyUnderline(ctx, x, y + 20, ctx.measureText(txt).width, color, loud ? 0.7 : a * 0.8);
      break;
    }
    case 'cross': {
      strokeShape(ctx, CROSS, x + 8, y + 8, 9, rot, 3, st.red, 0.75, s);
      break;
    }
    case 'sticker': {
      const cx = x + 10;
      const cy = y + 10;
      // autocollant : bord blanc épais, remplissage au feutre, contour d'encre
      ctx.fillStyle = css(0x22262e, 0.1);
      ctx.beginPath();
      ctx.arc(cx + 1.5, cy + 2, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(0xffffff, 0.92);
      ctx.beginPath();
      ctx.arc(cx, cy, 14.5, 0, Math.PI * 2);
      ctx.fill();
      const shape = txt === '★' ? STAR : txt === '♥' ? HEART : SMILEY;
      const fill = txt === '★' ? 0xf2c94c : txt === '♥' ? 0xe5579a : 0xf2994a;
      const size = shape === HEART ? 9 : 10;
      const dy = shape === HEART ? 1 : 0;
      fillShape(ctx, shape, cx, cy + dy, size, rot * 3, fill, 0.9);
      strokeShape(ctx, shape, cx, cy + dy, size, rot * 3, 1.5, st.ink, 0.8, s);
      break;
    }
    case 'onomatopoeia': {
      const w = txt.length * 14 + 20;
      ctx.save();
      ctx.translate(x + w / 2, y + 16);
      ctx.rotate(-0.16 + rot);
      ctx.scale(w / 2 + 6, 24);
      ctx.beginPath();
      const p = BURST.strokes[0];
      for (let i = 0; i < p.length; i += 2) {
        if (i === 0) ctx.moveTo(p[i], p[i + 1]);
        else ctx.lineTo(p[i], p[i + 1]);
      }
      ctx.closePath();
      ctx.fillStyle = css(0xf2c94c, 0.45);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(x + w / 2, y + 16);
      ctx.rotate(-0.16 + rot);
      ctx.strokeStyle = css(st.ink, a);
      ctx.lineWidth = 1.6;
      ctx.scale(w / 2 + 6, 24);
      ctx.lineWidth = 1.6 / 24;
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        if (i === 0) ctx.moveTo(p[i], p[i + 1]);
        else ctx.lineTo(p[i], p[i + 1]);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(x + w / 2, y + 16);
      ctx.rotate(-0.16 + rot);
      ctx.font = `26px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = css(st.red, 0.75);
      ctx.fillText(txt, 0, 1);
      ctx.restore();
      break;
    }
    case 'scribble': {
      strokeShape(ctx, SCRIBBLE, x + 20, y + 14, 22, rot, 1.4, st.ink, a * 0.9, s);
      strokeShape(ctx, SCRIBBLE, x + 22, y + 22, 20, rot + 0.3, 1.2, st.ink, a * 0.7, s + 3);
      break;
    }
    case 'wave': {
      for (let r = 0; r < 3; r++) {
        strokeShape(
          ctx,
          WAVE,
          x + 30 + r * 6,
          y + 6 + r * 9,
          38,
          0,
          1.6,
          0x4f78b8,
          0.5 - r * 0.1,
          s + r,
        );
      }
      break;
    }
    case 'spiral': {
      strokeShape(ctx, SPIRAL, x + 16, y + 16, 22, rot, 1.4, st.ink, a, s);
      break;
    }
    case 'axes': {
      strokeShape(ctx, AXES, x + 20, y + 20, 22, 0, 1.5, st.ink, a, s);
      text(ctx, 'x', x + 44, y + 44, 14, st.ink, a, 0);
      text(ctx, 'y', x - 2, y - 2, 14, st.ink, a, 0);
      break;
    }
    case 'bubble': {
      ctx.strokeStyle = css(st.ink, a + 0.1);
      ctx.fillStyle = css(0xffffff, 0.7);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(x + 32, y + 18, 34, 18, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 18, y + 33);
      ctx.lineTo(x + 8, y + 46);
      ctx.lineTo(x + 30, y + 35);
      ctx.fill();
      ctx.stroke();
      text(ctx, txt === '' ? '…' : txt, x + 22, y + 24, 20, st.ink, a + 0.1, 0);
      break;
    }
    case 'compass': {
      strokeShape(ctx, COMPASS_ROSE, x + 24, y + 24, 22, rot, 1.5, st.ink, a, s);
      text(ctx, 'N', x + 20, y - 8, 15, st.ink, a, 0);
      break;
    }
    case 'binding': {
      // reliure : anneaux de spirale ou coutures tout le long de la page
      const bx = x + CELL / 2;
      ctx.strokeStyle = css(st.ink, 0.5);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      line(ctx, bx - 5, 0, bx - 5, WORLD_H);
      line(ctx, bx + 5, 0, bx + 5, WORLD_H);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'arrow': {
      strokeShape(ctx, ARROW, x, y + 8, 9, 0.5 + rot, 2.2, st.red, 0.7, s);
      break;
    }
    case 'ruler': {
      strokeShape(ctx, RULER_DECOR, x + 60, y + 10, 62, rot, 1.3, st.ink, a, s);
      break;
    }
    case 'clef': {
      strokeShape(ctx, CLEF, x + 8, y + 30, 11, 0, 1.8, st.ink, a + 0.1, s);
      break;
    }
    default:
      if (txt) text(ctx, txt, x, y + 14, 18, st.ink, a, rot);
  }
}

/** Dessine le papier et le décor d'une arène dans un canvas à `res` pixels par unité. */
export function renderPage(arena: ArenaData, res: number): HTMLCanvasElement {
  const [canvas, ctx] = canvas2d(WORLD_W * res, WORLD_H * res);
  ctx.setTransform(res, 0, 0, res, 0, 0);
  const th = themeOf(arena.theme);
  const seed = seedOf(arena.id);
  paintPaper(ctx, th, seed);
  const st = decorStyle(th, arena.theme);
  for (const d of arena.decor) drawDecor(ctx, d, st, seed);
  return canvas;
}
