import type { Container } from 'pixi.js';
import { Sprite, Texture } from 'pixi.js';
import { rand2 } from './noise.ts';

/**
 * Le stylo : tout ce qui se dessine à chaque image (stickmen, armes, effets) est fait de sprites
 * réutilisés. Un segment = un sprite « corps » étiré entre deux points + un sprite « bout »
 * arrondi à chaque extrémité. Les textures sont générées au démarrage sur un canvas (aucun
 * fichier image), blanches : la couleur vient de la teinte du sprite.
 *
 * Aucune allocation en régime établi : `begin()` remet le compteur à zéro, chaque appel prend
 * le sprite suivant du pool, `end()` masque ceux qui n'ont pas servi.
 */

export { PEN_WIDTH, PenStyle } from './penStyle.ts';
import { PenStyle } from './penStyle.ts';

export interface PenTextures {
  /** Corps de trait par style (long et fin, u le long du trait, v en travers). */
  body: Texture[];
  /** Bout arrondi par style. */
  cap: Texture[];
  /** Anneau (cercle tracé), disque plein, éclat de papier, étoile à 4 branches. */
  ring: Texture;
  disc: Texture;
  scrap: Texture;
  /** Tache d'encre : disque irrégulier, plusieurs variantes. */
  blot: Texture[];
  /** Dégradé radial doux (flash, ombres). */
  glow: Texture;
  /** Rectangle plein (aplats). */
  white: Texture;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  return [c, ctx];
}

function tex(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = 'linear';
  return t;
}

/** Profil d'opacité en travers du trait : plein au centre, bord adouci. */
function profile(v: number, soft: number): number {
  const d = Math.abs(v * 2 - 1);
  if (d >= 1) return 0;
  const edge = 1 - soft;
  return d < edge ? 1 : 1 - (d - edge) / soft;
}

function makeBody(style: number): HTMLCanvasElement {
  const W = 64;
  const H = 16;
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      let a: number;
      if (style === PenStyle.BALLPOINT) {
        // pression légère qui varie le long du trait
        a = profile(v, 0.35) * (0.9 + 0.1 * Math.sin(u * 9 + 1.3));
      } else if (style === PenStyle.MARKER) {
        a = profile(v, 0.12) * 0.95;
      } else if (style === PenStyle.PENCIL) {
        // grain : tirets de graphite orientés dans le sens du trait
        const grain = 0.55 + 0.45 * rand2(Math.floor(x / 2), y, 11);
        a = profile(v, 0.5) * grain;
      } else {
        // pinceau : effilé de 1 (u = 0) à 0,45 (u = 1)
        const half = 1 - 0.55 * u;
        const d = Math.abs(v * 2 - 1) / half;
        a = d >= 1 ? 0 : d < 0.75 ? 1 : 1 - (d - 0.75) / 0.25;
      }
      const i = (y * W + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeCap(style: number): HTMLCanvasElement {
  const S = 32;
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5;
      const dy = (y + 0.5) / S - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      let a: number;
      if (d >= 1) a = 0;
      else if (style === PenStyle.BALLPOINT) a = d < 0.65 ? 1 : 1 - (d - 0.65) / 0.35;
      else if (style === PenStyle.MARKER) a = (d < 0.88 ? 1 : 1 - (d - 0.88) / 0.12) * 0.95;
      else if (style === PenStyle.PENCIL) {
        a = (d < 0.5 ? 1 : 1 - (d - 0.5) / 0.5) * (0.55 + 0.45 * rand2(x >> 1, y, 11));
      } else a = d < 0.75 ? 1 : 1 - (d - 0.75) / 0.25;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeRing(): HTMLCanvasElement {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = S * 0.075;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - ctx.lineWidth, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

function makeDisc(): HTMLCanvasElement {
  const S = 64;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 1.5, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function makeScrap(): HTMLCanvasElement {
  const S = 16;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.lineTo(13, 1);
  ctx.lineTo(15, 11);
  ctx.lineTo(4, 15);
  ctx.closePath();
  ctx.fill();
  return c;
}

function makeBlot(variant: number): HTMLCanvasElement {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#fff';
  // corps : disque irrégulier
  ctx.beginPath();
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = S * (0.2 + 0.07 * rand2(i % n, variant, 5) + 0.04 * Math.sin(a * 3 + variant));
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.fill();
  // gouttes autour
  for (let k = 0; k < 9; k++) {
    const a = rand2(k, variant, 6) * Math.PI * 2;
    const d = S * (0.26 + 0.2 * rand2(k, variant, 7));
    const r = S * (0.012 + 0.04 * rand2(k, variant, 8));
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
    // traînée vers le centre
    ctx.lineWidth = r * 1.2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * S * 0.2, S / 2 + Math.sin(a) * S * 0.2);
    ctx.lineTo(S / 2 + Math.cos(a) * (d - r), S / 2 + Math.sin(a) * (d - r));
    ctx.stroke();
  }
  return c;
}

function makeGlow(): HTMLCanvasElement {
  const S = 64;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

let cached: PenTextures | null = null;

/** Textures du stylo, créées une seule fois (demande un DOM). */
export function penTextures(): PenTextures {
  if (cached) return cached;
  cached = {
    body: [0, 1, 2, 3].map((s) => tex(makeBody(s))),
    cap: [0, 1, 2, 3].map((s) => tex(makeCap(s))),
    ring: tex(makeRing()),
    disc: tex(makeDisc()),
    scrap: tex(makeScrap()),
    blot: [0, 1, 2, 3].map((v) => tex(makeBlot(v))),
    glow: tex(makeGlow()),
    white: Texture.WHITE,
  };
  return cached;
}

/** Réserve de sprites réutilisés d'une image à l'autre. */
export class SpritePool {
  private readonly items: Sprite[] = [];
  private used = 0;

  constructor(readonly parent: Container) {}

  begin(): void {
    this.used = 0;
  }

  next(texture: Texture): Sprite {
    let s = this.items[this.used];
    if (!s) {
      s = new Sprite(texture);
      this.parent.addChild(s);
      this.items.push(s);
    } else if (s.texture !== texture) {
      s.texture = texture;
    }
    this.used++;
    s.visible = true;
    return s;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }

  /** Nombre de sprites réservés (mesures). */
  get capacity(): number {
    return this.items.length;
  }

  get inUse(): number {
    return this.used;
  }

  clear(): void {
    this.used = 0;
    for (const s of this.items) s.visible = false;
  }
}

/** Stylo : segments, points, anneaux et disques, tous teintés et sans allocation. */
export class Pen {
  private readonly pool: SpritePool;
  private readonly tx = penTextures();

  constructor(parent: Container) {
    this.pool = new SpritePool(parent);
  }

  begin(): void {
    this.pool.begin();
  }

  end(): void {
    this.pool.end();
  }

  get sprites(): number {
    return this.pool.inUse;
  }

  /** Segment de x0,y0 à x1,y1, d'épaisseur `w`, avec bouts arrondis. */
  seg(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w: number,
    color: number,
    alpha: number,
    style: number,
    caps = true,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.05) {
      const s = this.pool.next(this.tx.body[style]);
      s.anchor.set(0, 0.5);
      s.position.set(x0, y0);
      s.rotation = Math.atan2(dy, dx);
      s.width = len;
      s.height = w;
      s.tint = color;
      s.alpha = alpha;
    }
    if (caps) {
      this.cap(x0, y0, w, color, alpha, style);
      this.cap(x1, y1, w, color, alpha, style);
    }
  }

  cap(x: number, y: number, w: number, color: number, alpha: number, style: number): void {
    const s = this.pool.next(this.tx.cap[style]);
    s.anchor.set(0.5, 0.5);
    s.position.set(x, y);
    s.rotation = 0;
    s.width = w;
    s.height = w;
    s.tint = color;
    s.alpha = alpha;
  }

  /** Chaîne de segments sur `n` points `pts[0..2n)`, éventuellement fermée. */
  poly(
    pts: ArrayLike<number>,
    n: number,
    closed: boolean,
    w: number,
    color: number,
    alpha: number,
    style: number,
  ): void {
    for (let i = 0; i < n - 1; i++) {
      this.seg(
        pts[i * 2],
        pts[i * 2 + 1],
        pts[i * 2 + 2],
        pts[i * 2 + 3],
        w,
        color,
        alpha,
        style,
        false,
      );
      this.cap(pts[i * 2 + 2], pts[i * 2 + 3], w, color, alpha, style);
    }
    if (n > 0) this.cap(pts[0], pts[1], w, color, alpha, style);
    if (closed && n > 2) {
      this.seg(pts[n * 2 - 2], pts[n * 2 - 1], pts[0], pts[1], w, color, alpha, style, false);
    }
  }

  /** Cercle tracé de centre x,y et de rayon `r` (l'épaisseur vient de la texture). */
  ring(
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: number,
    alpha: number,
    rotation = 0,
  ): void {
    const s = this.pool.next(this.tx.ring);
    s.anchor.set(0.5, 0.5);
    s.position.set(x, y);
    s.rotation = rotation;
    s.width = rx * 2;
    s.height = ry * 2;
    s.tint = color;
    s.alpha = alpha;
  }

  /** Disque plein. */
  disc(x: number, y: number, rx: number, ry: number, color: number, alpha: number): void {
    const s = this.pool.next(this.tx.disc);
    s.anchor.set(0.5, 0.5);
    s.position.set(x, y);
    s.rotation = 0;
    s.width = rx * 2;
    s.height = ry * 2;
    s.tint = color;
    s.alpha = alpha;
  }

  /** Éclat de papier. */
  scrap(x: number, y: number, size: number, rotation: number, color: number, alpha: number): void {
    const s = this.pool.next(this.tx.scrap);
    s.anchor.set(0.5, 0.5);
    s.position.set(x, y);
    s.rotation = rotation;
    s.width = size;
    s.height = size * 0.8;
    s.tint = color;
    s.alpha = alpha;
  }

  /** Rectangle plein, de coin haut-gauche x, y. */
  rect(x: number, y: number, w: number, h: number, color: number, alpha: number): void {
    const s = this.pool.next(this.tx.white);
    s.anchor.set(0, 0);
    s.position.set(x, y);
    s.rotation = 0;
    s.width = w;
    s.height = h;
    s.tint = color;
    s.alpha = alpha;
  }

  /** Lueur radiale (flash). */
  glow(x: number, y: number, r: number, color: number, alpha: number): void {
    const s = this.pool.next(this.tx.glow);
    s.anchor.set(0.5, 0.5);
    s.position.set(x, y);
    s.rotation = 0;
    s.width = r * 2;
    s.height = r * 2;
    s.tint = color;
    s.alpha = alpha;
  }
}
