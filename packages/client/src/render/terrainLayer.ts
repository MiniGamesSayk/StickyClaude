import { Cell, CELL, GRID_H, GRID_W } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { Container, Sprite, Texture } from 'pixi.js';
import {
  addOutlines,
  blend,
  canvas2d,
  hatch,
  resample,
  strokeHandDrawn,
  wobblePoint,
} from './art.ts';
import type { Wobble } from './art.ts';
import { contours, fillContours, isPaperCell, isSolidCell, simplify } from './contour.ts';
import type { Polyline } from './contour.ts';
import { rand2, seedOf, srand2 } from './noise.ts';
import { css, INK, themeOf } from './palette.ts';

/**
 * Terrain « à l'encre », mis en cache dans des morceaux (analyse §2.7). Les contours sont calculés
 * par marching squares sur toute la grille, déformés à main levée, remplis de hachures ; chaque
 * morceau de 16 × 12 cellules est rastérisé dans un canvas (en 1 à 3 variantes de tremblé, pour le
 * line boiling à 12 i/s). Une destruction ne redessine que les morceaux touchés.
 *
 * Les encres sont **opaques** (mélangées au papier) : deux morceaux qui se recouvrent sur
 * quelques pixels de marge ne laissent aucune couture.
 */

export const CHUNK_CELLS_X = 16;
export const CHUNK_CELLS_Y = 12;
const NCX = GRID_W / CHUNK_CELLS_X;
const NCY = GRID_H / CHUNK_CELLS_Y;
/** Marge (unités) autour de chaque morceau, qui recouvre ses voisins. */
const PAD = 4;
/** Amplitudes du tracé à main levée et du tremblé (unités de monde). */
const LOW = 1.1;
const BOIL = 0.7;

interface Chunk {
  x0: number;
  y0: number;
  canvases: HTMLCanvasElement[];
  textures: Texture[];
  sprites: Sprite[];
  ready: boolean[];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(line: Polyline): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < line.pts.length; i += 2) {
    x0 = Math.min(x0, line.pts[i]);
    x1 = Math.max(x1, line.pts[i]);
    y0 = Math.min(y0, line.pts[i + 1]);
    y1 = Math.max(y1, line.pts[i + 1]);
  }
  return { x0: x0 * CELL, y0: y0 * CELL, x1: x1 * CELL, y1: y1 * CELL };
}

export class TerrainLayer {
  readonly container = new Container();
  private chunks: Chunk[] = [];
  private res = 1;
  private variants = 1;
  private current = 0;
  private theme = themeOf('graph-paper');
  private seed = 1;
  private solid: { line: Polyline; box: Box }[] = [];
  private paper: { line: Polyline; box: Box }[] = [];
  /** Contours fermés (page prolongée) qui découpent les remplissages, coins arrondis comme le trait. */
  private solidFill: { line: Polyline; box: Box }[] = [];
  private paperFill: { line: Polyline; box: Box }[] = [];
  private masked = new Uint8Array(GRID_W * GRID_H);
  private prev = new Uint8Array(GRID_W * GRID_H);
  private version = -1;
  private queue: number[] = [];
  private queued = new Set<number>();

  /** Contours pleins courants (cellules), pour l'animation de dessin de l'arène. */
  get outlines(): readonly Polyline[] {
    return this.solid.map((s) => s.line);
  }

  /** Réserve les morceaux pour une résolution et un nombre de variantes. */
  configure(res: number, variants: number): void {
    const r = Math.max(0.5, Math.round(res * 4) / 4);
    const v = Math.max(1, Math.min(3, variants));
    if (r === this.res && v === this.variants && this.chunks.length > 0) return;
    this.res = r;
    this.variants = v;
    this.rebuildChunks();
    this.invalidateAll();
  }

  private rebuildChunks(): void {
    for (const c of this.chunks) {
      for (const s of c.sprites) s.destroy();
      for (const t of c.textures) t.destroy(true);
    }
    this.chunks = [];
    this.container.removeChildren();
    const w = Math.round((CHUNK_CELLS_X * CELL + 2 * PAD) * this.res);
    const h = Math.round((CHUNK_CELLS_Y * CELL + 2 * PAD) * this.res);
    for (let cy = 0; cy < NCY; cy++) {
      for (let cx = 0; cx < NCX; cx++) {
        const chunk: Chunk = {
          x0: cx * CHUNK_CELLS_X * CELL,
          y0: cy * CHUNK_CELLS_Y * CELL,
          canvases: [],
          textures: [],
          sprites: [],
          ready: [],
        };
        for (let v = 0; v < this.variants; v++) {
          const [c] = canvas2d(w, h);
          const t = Texture.from(c);
          const s = new Sprite(t);
          s.position.set(chunk.x0 - PAD, chunk.y0 - PAD);
          s.width = w / this.res;
          s.height = h / this.res;
          s.visible = v === 0;
          this.container.addChild(s);
          chunk.canvases.push(c);
          chunk.textures.push(t);
          chunk.sprites.push(s);
          chunk.ready.push(false);
        }
        this.chunks.push(chunk);
      }
    }
    this.current = 0;
  }

  /** Nouvelle arène : tout le terrain est à redessiner. */
  setArena(arena: ArenaData): void {
    this.theme = themeOf(arena.theme);
    this.seed = seedOf(arena.id);
    this.version = -1;
    this.invalidateAll();
  }

  private invalidateAll(): void {
    for (const c of this.chunks) c.ready.fill(false);
    this.queue = [];
    this.queued.clear();
    this.version = -1;
    this.prev.fill(255);
  }

  /** Variante affichée (0 à variants − 1) : appelée 12 fois par seconde. */
  setVariant(v: number): void {
    const want = Math.min(v, this.variants - 1);
    this.current = want;
    for (const c of this.chunks) {
      const show = c.ready[want] ? want : 0;
      for (let i = 0; i < c.sprites.length; i++) c.sprites[i].visible = i === show;
    }
  }

  /**
   * Synchronise avec le monde : si le terrain a changé, recalcule les contours et marque les
   * morceaux touchés ; puis dessine au plus `budget` morceaux (la variante affichée d'abord).
   */
  update(cells: Uint8Array, version: number, activeMarks: readonly number[], budget: number): void {
    if (this.chunks.length === 0) return;
    if (version !== this.version) {
      this.version = version;
      this.masked.set(cells);
      for (const i of activeMarks) if (i >= 0) this.masked[i] = Cell.EMPTY;
      this.solid = contours(this.masked, isSolidCell).map((l) => {
        const s = simplify(l);
        return { line: s, box: boxOf(s) };
      });
      this.paper = contours(this.masked, isPaperCell).map((l) => {
        const s = simplify(l);
        return { line: s, box: boxOf(s) };
      });
      const closedOf = (filter: typeof isSolidCell): { line: Polyline; box: Box }[] =>
        fillContours(this.masked, filter).map((l) => {
          const s = simplify(l);
          return { line: s, box: boxOf(s) };
        });
      this.solidFill = closedOf(isSolidCell);
      this.paperFill = closedOf(isPaperCell);
      // morceaux dont au moins une cellule (± 1) a changé
      const all = this.prev[0] === 255;
      if (!all) {
        const dirty = new Uint8Array(this.chunks.length);
        for (let y = 0; y < GRID_H; y++) {
          for (let x = 0; x < GRID_W; x++) {
            const i = y * GRID_W + x;
            if (this.masked[i] === this.prev[i]) continue;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const cx = Math.floor((x + dx) / CHUNK_CELLS_X);
                const cy = Math.floor((y + dy) / CHUNK_CELLS_Y);
                if (cx >= 0 && cx < NCX && cy >= 0 && cy < NCY) dirty[cy * NCX + cx] = 1;
              }
            }
          }
        }
        for (let c = 0; c < dirty.length; c++) if (dirty[c]) this.markDirty(c);
      } else {
        for (let c = 0; c < this.chunks.length; c++) this.markDirty(c);
      }
      this.prev.set(this.masked);
    }
    let n = 0;
    while (this.queue.length > 0 && n < budget) {
      const job = this.queue.shift() as number;
      this.queued.delete(job);
      const chunk = Math.floor(job / 4);
      const variant = job % 4;
      if (variant < this.variants) {
        this.drawChunk(chunk, variant);
        n++;
      }
    }
    if (n > 0) this.setVariant(this.current);
  }

  private markDirty(chunk: number): void {
    const c = this.chunks[chunk];
    c.ready.fill(false);
    // la variante affichée d'abord, puis les autres
    const order = [this.current];
    for (let v = 0; v < this.variants; v++) if (v !== this.current) order.push(v);
    for (const v of order) {
      const job = chunk * 4 + v;
      if (!this.queued.has(job)) {
        this.queued.add(job);
        this.queue.push(job);
      }
    }
  }

  /** Nombre de morceaux encore à dessiner. */
  get pending(): number {
    return this.queue.length;
  }

  /** Tout le terrain de l'arène courante est dessiné (aucun morceau de l'arène précédente à l'écran). */
  get settled(): boolean {
    return this.chunks.length > 0 && this.version !== -1 && this.queue.length === 0;
  }

  private drawChunk(index: number, variant: number): void {
    const chunk = this.chunks[index];
    const canvas = chunk.canvases[variant];
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const res = this.res;
    const th = this.theme;
    const x0 = chunk.x0 - PAD;
    const y0 = chunk.y0 - PAD;
    const x1 = chunk.x0 + CHUNK_CELLS_X * CELL + PAD;
    const y1 = chunk.y0 + CHUNK_CELLS_Y * CELL + PAD;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
    chunk.ready[variant] = true;

    const ink = INK.night;
    const hatchInk = blend(ink, th.paper, 0.5);
    const hatchInk2 = blend(ink, th.paper, 0.28);
    const wb: Wobble = { low: LOW, boil: this.variants > 1 ? BOIL : 0, variant, seed: this.seed };

    // fenêtre en cellules
    const cx0 = Math.max(0, Math.floor(x0 / CELL) - 1);
    const cx1 = Math.min(GRID_W - 1, Math.ceil(x1 / CELL) + 1);
    const cy0 = Math.max(0, Math.floor(y0 / CELL) - 1);
    const cy1 = Math.min(GRID_H - 1, Math.ceil(y1 / CELL) + 1);
    const cell = (x: number, y: number): number =>
      x < 0 || x >= GRID_W || y < 0 || y >= GRID_H ? Cell.SOLID : this.masked[y * GRID_W + x];

    // --- Blocs pleins : fond opaque, hachures, contour ------------------------------------
    // Le remplissage est découpé selon le contour tracé (et non selon les cases) : sinon les coins
    // carrés des cases dépassent du trait aux angles arrondis.
    ctx.save();
    ctx.beginPath();
    addOutlines(ctx, this.solidFill, wb, x0, y0, x1, y1);
    ctx.clip('evenodd');
    ctx.fillStyle = css(blend(th.paper, ink, 0.07));
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    hatch(ctx, x0, y0, x1, y1, 7, 1, hatchInk2, 1.0, this.seed, variant, wb.boil);
    ctx.restore();
    // bande de bord : hachures croisées plus denses (dans la même forme)
    ctx.save();
    ctx.beginPath();
    addOutlines(ctx, this.solidFill, wb, x0, y0, x1, y1);
    ctx.clip('evenodd');
    ctx.beginPath();
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        if (cell(x, y) !== Cell.SOLID) continue;
        const edge =
          cell(x - 1, y) !== Cell.SOLID ||
          cell(x + 1, y) !== Cell.SOLID ||
          cell(x, y - 1) !== Cell.SOLID ||
          cell(x, y + 1) !== Cell.SOLID;
        if (edge) ctx.rect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    ctx.clip();
    hatch(ctx, x0, y0, x1, y1, 4.6, -1, hatchInk, 1.1, this.seed + 5, variant, wb.boil);
    ctx.restore();
    for (const s of this.solid) {
      if (s.box.x1 < x0 || s.box.x0 > x1 || s.box.y1 < y0 || s.box.y0 > y1) continue;
      strokeHandDrawn(ctx, s.line, ink, 2.6, wb);
    }

    // --- Blocs de papier : papier froissé, contour au crayon -------------------------------
    ctx.save();
    ctx.beginPath();
    addOutlines(ctx, this.paperFill, wb, x0, y0, x1, y1);
    ctx.clip('evenodd');
    ctx.fillStyle = css(INK.paperBlock);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    ctx.strokeStyle = css(INK.paperBlockFold);
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        if (cell(x, y) !== Cell.PAPER) continue;
        const px = x * CELL;
        const py = y * CELL;
        const r1 = rand2(x, y, this.seed);
        const r2 = rand2(x, y, this.seed + 1);
        // pli en diagonale + petit pli perpendiculaire + lignes de texte
        ctx.moveTo(px + 2 + r1 * 3, py + 14 - r2 * 3);
        ctx.lineTo(px + 14 - r2 * 3, py + 2 + r1 * 3);
        ctx.moveTo(px + 3, py + 4 + r2 * 3);
        ctx.lineTo(px + 8 + r1 * 3, py + 5 + r1 * 2);
        ctx.moveTo(px + 6 + r1 * 3, py + 11);
        ctx.lineTo(px + 13, py + 12 - r2 * 2);
      }
    }
    ctx.stroke();
    for (const s of this.paper) {
      if (s.box.x1 < x0 || s.box.x0 > x1 || s.box.y1 < y0 || s.box.y0 > y1) continue;
      strokeHandDrawn(ctx, s.line, INK.paperBlockEdge, 1.8, { ...wb, low: LOW * 0.8 }, false);
    }

    // --- Plateformes à sens unique : double trait bleu, petits barreaux ----------------------
    ctx.strokeStyle = css(blend(INK.blue, th.paper, 0.08));
    ctx.lineCap = 'round';
    for (let y = cy0; y <= cy1; y++) {
      let x = cx0;
      while (x <= cx1) {
        if (cell(x, y) !== Cell.ONEWAY) {
          x++;
          continue;
        }
        let xe = x;
        while (xe + 1 <= GRID_W - 1 && cell(xe + 1, y) === Cell.ONEWAY) xe++;
        this.drawOneWay(ctx, x * CELL, (xe + 1) * CELL, y * CELL, wb, variant);
        x = xe + 1;
      }
    }

    // --- Dangers : pointes de stylo rouges ---------------------------------------------------
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const t = cell(x, y);
        if (t === Cell.HAZARD) this.drawSpikes(ctx, x, y, wb, th.paper);
        else if (t === Cell.LAVA) this.drawLava(ctx, x, y, wb, cell(x, y - 1) === Cell.LAVA);
        else if (t === Cell.SAW) this.drawSaw(ctx, x, y, wb, variant, th.paper);
        else if (t === Cell.TRAMPOLINE) this.drawTrampoline(ctx, x, y, wb);
      }
    }
    chunk.textures[variant].source.update();
  }

  private drawOneWay(
    ctx: CanvasRenderingContext2D,
    xa: number,
    xb: number,
    y: number,
    wb: Wobble,
    variant: number,
  ): void {
    const p = { x: 0, y: 0 };
    const rows = [y + 1.4, y + 4.8];
    for (let r = 0; r < 2; r++) {
      ctx.lineWidth = r === 0 ? 2.2 : 1.6;
      ctx.beginPath();
      for (let x = xa; x <= xb + 0.01; x += 4) {
        wobblePoint(x, rows[r], { ...wb, seed: wb.seed + r * 17 }, p);
        if (x === xa) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = xa + 4; x < xb; x += 8) {
      wobblePoint(x, y + 1.4, wb, p);
      ctx.moveTo(p.x, p.y);
      wobblePoint(x + 0.5 * srand2(Math.round(x), variant, 3), y + 4.8, wb, p);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  private drawSpikes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    wb: Wobble,
    paper: number,
  ): void {
    const px = cx * CELL;
    const py = cy * CELL;
    const p = { x: 0, y: 0 };
    const r = (k: number): number => rand2(cx * 7 + k, cy, wb.seed + 21);
    const top = [3.2 + r(1) * 3, 1 + r(2) * 3, 2 + r(3) * 4];
    const xs = [px, px + 2.6, px + 5.3, px + 8, px + 10.7, px + 13.3, px + 16];
    const ys = [py + 16, py + top[0], py + 16, py + top[1], py + 16, py + top[2], py + 16];
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      wobblePoint(xs[i], ys[i], wb, p);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.fillStyle = css(blend(INK.red, paper, 0.6));
    ctx.fill();
    ctx.strokeStyle = css(INK.red);
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  /** Lave : fond orange, surface jaune qui ondule, quelques bulles. */
  private drawLava(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    wb: Wobble,
    covered: boolean,
  ): void {
    const px = cx * CELL;
    const py = cy * CELL;
    const p = { x: 0, y: 0 };
    ctx.fillStyle = css(0xf0643c);
    ctx.fillRect(px - 0.3, py - (covered ? 0.3 : 0), CELL + 0.6, CELL + 0.6);
    // veines plus sombres
    const r = (k: number): number => rand2(cx * 11 + k, cy, wb.seed + 31);
    ctx.strokeStyle = css(0xc2331d);
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px + 2 + r(1) * 3, py + 6 + r(2) * 4);
    ctx.lineTo(px + 8 + r(3) * 3, py + 9 + r(4) * 3);
    ctx.lineTo(px + 13, py + 5 + r(5) * 4);
    ctx.stroke();
    // bulles
    ctx.fillStyle = css(0xffc65a);
    ctx.beginPath();
    ctx.arc(px + 4 + r(6) * 8, py + 10 + r(7) * 4, 1.3 + r(8), 0, Math.PI * 2);
    ctx.fill();
    if (!covered) {
      // surface : bande claire ondulée
      ctx.strokeStyle = css(0xffd24a);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        wobblePoint(px + i * 4, py + 1.6 + Math.sin((cx * 4 + i) * 1.7) * 1.2, wb, p);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  /** Scie circulaire : disque à dents, moyeu ; l'angle des dents change avec la variante (elle tourne). */
  private drawSaw(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    wb: Wobble,
    variant: number,
    paper: number,
  ): void {
    const mx = cx * CELL + CELL / 2;
    const my = cy * CELL + CELL / 2;
    const p = { x: 0, y: 0 };
    const teeth = 10;
    const spin = (variant % 4) * 0.28 + (cx % 2) * 0.3;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = spin + (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 8 : 5.6;
      wobblePoint(mx + Math.cos(a) * r, my + Math.sin(a) * r, wb, p);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = css(blend(0x9aa3b2, paper, 0.25));
    ctx.fill();
    ctx.strokeStyle = css(INK.night);
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = css(INK.red);
    ctx.fill();
    ctx.stroke();
  }

  /** Trampoline : une gomme rose dans sa manche bleue, avec un ressort tracé au-dessus. */
  private drawTrampoline(ctx: CanvasRenderingContext2D, cx: number, cy: number, wb: Wobble): void {
    const px = cx * CELL;
    const py = cy * CELL;
    const p = { x: 0, y: 0 };
    const pts: [number, number][] = [
      [px + 0.8, py + 1.4],
      [px + 15.2, py + 1.4],
      [px + 15.2, py + 15.2],
      [px + 0.8, py + 15.2],
    ];
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      wobblePoint(x, y, wb, p);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = css(0xf29ab8);
    ctx.fill();
    ctx.strokeStyle = css(INK.night);
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // manche bleue
    ctx.fillStyle = css(INK.blue);
    ctx.fillRect(px + 1.2, py + 10.2, CELL - 2.4, 4.4);
    // ressort : zigzag au-dessus de la gomme
    ctx.strokeStyle = css(INK.night);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      wobblePoint(px + 1 + i * 2.33, py + (i % 2 === 0 ? 1.4 : 0.2), wb, p);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  /** Dessine tout de suite tout ce qui est en attente (changement de manche, tests). */
  flush(): void {
    this.update(this.masked, this.version, [], 1000);
  }

  /** Nombre de morceaux. */
  get chunkCount(): number {
    return this.chunks.length;
  }

  destroy(): void {
    for (const c of this.chunks) {
      for (const s of c.sprites) s.destroy();
      for (const t of c.textures) t.destroy(true);
    }
    this.chunks = [];
  }
}

// `resample` est ré-exporté pour l'animation de dessin de l'arène.
export { resample };
