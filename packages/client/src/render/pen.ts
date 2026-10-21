import { Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import type { Container } from 'pixi.js';
import { rand2 } from './noise.ts';
import { PEN_WIDTH, PenStyle } from './penStyle.ts';

/**
 * Le stylo : tout ce qui se dessine à chaque image (stickmen, armes, effets) est fait de
 * particules Pixi réutilisées, toutes prises dans **un seul atlas** généré au démarrage sur un
 * canvas (aucun fichier image) : un `ParticleContainer` = un appel de dessin, sans hiérarchie de
 * scène. Un segment = une particule « corps » étirée entre deux points + des particules « bout »
 * arrondies aux jointures. Les textures sont blanches : la couleur vient de la teinte.
 *
 * Aucune allocation en régime établi : `begin()` vide la liste dessinée, chaque appel reprend la
 * particule suivante du pool, la teinte est écrite directement (pas de `Color` intermédiaire).
 */

export { PEN_WIDTH, PenStyle } from './penStyle.ts';

export interface PenTextures {
  /** Corps de trait par style (long et fin, u le long du trait, v en travers). */
  body: Texture[];
  /** Bout arrondi par style. */
  cap: Texture[];
  /** Anneau de tête par style : l'épaisseur du trait est celle du style (pour un rayon de 4,4). */
  headRing: Texture[];
  /** Anneau (cercle tracé), disque plein, éclat de papier. */
  ring: Texture;
  disc: Texture;
  scrap: Texture;
  /** Tache d'encre : disque irrégulier, plusieurs variantes. */
  blot: Texture[];
  /** Dégradé radial doux (flash, ombres). */
  glow: Texture;
  /** Aplat blanc (rectangles). */
  white: Texture;
}

/** Rayon de la tête du stickman (unités) : voir `skeleton.ts`. */
const HEAD_R = 4.4;

type Canvas2 = [HTMLCanvasElement, CanvasRenderingContext2D];

function canvas(w: number, h: number): Canvas2 {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  return [c, ctx];
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
        a = profile(v, 0.35) * (0.9 + 0.1 * Math.sin(u * 9 + 1.3));
      } else if (style === PenStyle.MARKER) {
        a = profile(v, 0.12) * 0.95;
      } else if (style === PenStyle.PENCIL) {
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

/** Anneau d'épaisseur `th` (fraction du diamètre). */
function makeRing(size: number, th: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = size * th;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - ctx.lineWidth / 2 - 0.5, 0, Math.PI * 2);
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
  for (let k = 0; k < 9; k++) {
    const a = rand2(k, variant, 6) * Math.PI * 2;
    const d = S * (0.26 + 0.2 * rand2(k, variant, 7));
    const r = S * (0.012 + 0.04 * rand2(k, variant, 8));
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
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

function makeWhite(): HTMLCanvasElement {
  const [c, ctx] = canvas(8, 8);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 8, 8);
  return c;
}

const PAD = 2;
const ATLAS_W = 1024;

let cached: PenTextures | null = null;

/** Textures du stylo : un seul atlas (une source), créé une fois (demande un DOM). */
export function penTextures(): PenTextures {
  if (cached) return cached;
  const items: HTMLCanvasElement[] = [];
  const add = (c: HTMLCanvasElement): number => items.push(c) - 1;
  const body = [0, 1, 2, 3].map((s) => add(makeBody(s)));
  const cap = [0, 1, 2, 3].map((s) => add(makeCap(s)));
  const headRing = [0, 1, 2, 3].map((s) => {
    const w = PEN_WIDTH[s];
    return add(makeRing(64, w / (2 * HEAD_R + w)));
  });
  const ring = add(makeRing(128, 0.075));
  const disc = add(makeDisc());
  const scrap = add(makeScrap());
  const blot = [0, 1, 2, 3].map((v) => add(makeBlot(v)));
  const glow = add(makeGlow());
  const white = add(makeWhite());

  // rangement en étagères
  const pos: { x: number; y: number }[] = [];
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  for (const c of items) {
    if (x + c.width + PAD > ATLAS_W) {
      x = PAD;
      y += shelf + PAD;
      shelf = 0;
    }
    pos.push({ x, y });
    x += c.width + PAD;
    shelf = Math.max(shelf, c.height + PAD);
  }
  const height = y + shelf + PAD;
  const [atlas, ctx] = canvas(ATLAS_W, height);
  items.forEach((c, i) => {
    ctx.drawImage(c, pos[i].x, pos[i].y);
    if (i === white) {
      // l'aplat étiré ne doit pas laisser transparaître la marge : on la remplit aussi
      ctx.fillStyle = '#fff';
      ctx.fillRect(pos[i].x - 1, pos[i].y - 1, c.width + 2, c.height + 2);
    }
  });
  const base = Texture.from(atlas);
  base.source.scaleMode = 'linear';
  const frame = (i: number): Texture =>
    new Texture({
      source: base.source,
      frame: new Rectangle(pos[i].x, pos[i].y, items[i].width, items[i].height),
    });
  cached = {
    body: body.map(frame),
    cap: cap.map(frame),
    headRing: headRing.map(frame),
    ring: frame(ring),
    disc: frame(disc),
    scrap: frame(scrap),
    blot: blot.map(frame),
    glow: frame(glow),
    white: frame(white),
  };
  return cached;
}

/** Couleur de particule : teinte BGR + opacité sur 8 bits (formule de Pixi, sans `Color`). */
function packColor(rgb: number, alpha: number): number {
  const bgr = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255) | 0;
  return bgr + (a << 24);
}

/** Stylo : segments, points, anneaux et disques, tous teintés et sans allocation. */
export class Pen {
  private readonly pool: Particle[] = [];
  private readonly container: ParticleContainer;
  private readonly tx = penTextures();
  /** Particules utilisées à cette image et à la précédente (les autres sont rendues transparentes). */
  private used = 0;
  private prevUsed = 0;

  constructor(parent: Container) {
    this.container = new ParticleContainer({
      dynamicProperties: { vertex: true, position: true, rotation: true, uvs: true, color: true },
    });
    parent.addChild(this.container);
  }

  begin(): void {
    this.used = 0;
  }

  /**
   * Les particules d'une image précédente qui ne servent plus deviennent transparentes. (On ne
   * raccourcit jamais le tableau du conteneur : `length = 0` libère son stockage et le réalloue
   * à chaque image.)
   */
  end(): void {
    for (let i = this.used; i < this.prevUsed; i++) this.pool[i].color = 0;
    this.prevUsed = this.used;
  }

  /** Nombre de particules dessinées à cette image (mesures). */
  get sprites(): number {
    return this.used;
  }

  private next(tex: Texture): Particle {
    const i = this.used++;
    let p = this.pool[i];
    if (!p) {
      p = new Particle(tex);
      this.pool.push(p);
      this.container.addParticle(p);
    } else if (p.texture !== tex) {
      p.texture = tex;
    }
    return p;
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
      const tex = this.tx.body[style];
      const p = this.next(tex);
      p.anchorX = 0;
      p.anchorY = 0.5;
      p.x = x0;
      p.y = y0;
      p.rotation = Math.atan2(dy, dx);
      p.scaleX = len / tex.orig.width;
      p.scaleY = w / tex.orig.height;
      p.color = packColor(color, alpha);
    }
    if (caps) {
      this.cap(x0, y0, w, color, alpha, style);
      this.cap(x1, y1, w, color, alpha, style);
    }
  }

  /**
   * Segment (sans bouts) entre les points `a` et `b` d'un tableau de coordonnées (x, y, x, y…).
   * Les coordonnées sont lues ici : les passer en arguments à `seg` ferait allouer à V8 une boîte
   * par nombre calculé à chaque appel non inliné (le squelette en dessine des dizaines par image).
   */
  segAt(
    pts: ArrayLike<number>,
    a: number,
    b: number,
    w: number,
    color: number,
    alpha: number,
    style: number,
  ): void {
    const x0 = pts[a * 2];
    const y0 = pts[a * 2 + 1];
    const dx = pts[b * 2] - x0;
    const dy = pts[b * 2 + 1] - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0.05) return;
    const tex = this.tx.body[style];
    const p = this.next(tex);
    p.anchorX = 0;
    p.anchorY = 0.5;
    p.x = x0;
    p.y = y0;
    p.rotation = Math.atan2(dy, dx);
    p.scaleX = len / tex.orig.width;
    p.scaleY = w / tex.orig.height;
    p.color = packColor(color, alpha);
  }

  /** Bout arrondi au point `a` d'un tableau de coordonnées (voir `segAt`). */
  capAt(
    pts: ArrayLike<number>,
    a: number,
    w: number,
    color: number,
    alpha: number,
    style: number,
  ): void {
    const tex = this.tx.cap[style];
    const p = this.next(tex);
    p.anchorX = 0.5;
    p.anchorY = 0.5;
    p.x = pts[a * 2];
    p.y = pts[a * 2 + 1];
    p.rotation = 0;
    p.scaleX = w / tex.orig.width;
    p.scaleY = w / tex.orig.height;
    p.color = packColor(color, alpha);
  }

  cap(x: number, y: number, w: number, color: number, alpha: number, style: number): void {
    this.sprite(this.tx.cap[style], x, y, w, w, 0, color, alpha);
  }

  /** Particule centrée en x, y, de taille w × h (unités de monde). */
  private sprite(
    tex: Texture,
    x: number,
    y: number,
    w: number,
    h: number,
    rotation: number,
    color: number,
    alpha: number,
  ): void {
    const p = this.next(tex);
    p.anchorX = 0.5;
    p.anchorY = 0.5;
    p.x = x;
    p.y = y;
    p.rotation = rotation;
    p.scaleX = w / tex.orig.width;
    p.scaleY = h / tex.orig.height;
    p.color = packColor(color, alpha);
  }

  /**
   * Chaîne de segments sur `n` points `pts[0..2n)`, éventuellement fermée. C'est le chemin le plus
   * chaud (armes, objets, décor) : segments et bouts sont écrits ici, sans appeler `seg` ni `cap`
   * avec des nombres calculés (V8 en alloue une boîte par argument quand l'appel n'est pas inliné).
   */
  poly(
    pts: ArrayLike<number>,
    n: number,
    closed: boolean,
    w: number,
    color: number,
    alpha: number,
    style: number,
  ): void {
    if (n <= 0) return;
    const col = packColor(color, alpha);
    const body = this.tx.body[style];
    const capTex = this.tx.cap[style];
    const bodyW = body.orig.width;
    const bodyH = body.orig.height;
    const capSx = w / capTex.orig.width;
    const capSy = w / capTex.orig.height;
    const segs = closed && n > 2 ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const x0 = pts[i * 2];
      const y0 = pts[i * 2 + 1];
      const x1 = pts[j * 2];
      const y1 = pts[j * 2 + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.05) {
        const p = this.next(body);
        p.anchorX = 0;
        p.anchorY = 0.5;
        p.x = x0;
        p.y = y0;
        p.rotation = Math.atan2(dy, dx);
        p.scaleX = len / bodyW;
        p.scaleY = w / bodyH;
        p.color = col;
      }
      if (j !== 0) {
        const c = this.next(capTex);
        c.anchorX = 0.5;
        c.anchorY = 0.5;
        c.x = x1;
        c.y = y1;
        c.rotation = 0;
        c.scaleX = capSx;
        c.scaleY = capSy;
        c.color = col;
      }
    }
    const c0 = this.next(capTex);
    c0.anchorX = 0.5;
    c0.anchorY = 0.5;
    c0.x = pts[0];
    c0.y = pts[1];
    c0.rotation = 0;
    c0.scaleX = capSx;
    c0.scaleY = capSy;
    c0.color = col;
  }

  /** Tête du stickman : un anneau dont l'épaisseur est celle du style de trait. */
  headRing(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    color: number,
    alpha: number,
    style: number,
  ): void {
    const d = 2 * HEAD_R + PEN_WIDTH[style];
    this.sprite(this.tx.headRing[style], x, y, d * rx, d * ry, rotation, color, alpha);
  }

  /** Cercle tracé de rayons rx, ry (l'épaisseur vient de la texture). */
  ring(
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: number,
    alpha: number,
    rotation = 0,
  ): void {
    this.sprite(this.tx.ring, x, y, rx * 2, ry * 2, rotation, color, alpha);
  }

  /** Disque plein. */
  disc(x: number, y: number, rx: number, ry: number, color: number, alpha: number): void {
    this.sprite(this.tx.disc, x, y, rx * 2, ry * 2, 0, color, alpha);
  }

  /** Éclat de papier. */
  scrap(x: number, y: number, size: number, rotation: number, color: number, alpha: number): void {
    this.sprite(this.tx.scrap, x, y, size, size * 0.8, rotation, color, alpha);
  }

  /** Rectangle plein, de coin haut-gauche x, y. */
  rect(x: number, y: number, w: number, h: number, color: number, alpha: number): void {
    this.sprite(this.tx.white, x + w / 2, y + h / 2, w, h, 0, color, alpha);
  }

  /** Lueur radiale (flash). */
  glow(x: number, y: number, r: number, color: number, alpha: number): void {
    this.sprite(this.tx.glow, x, y, r * 2, r * 2, 0, color, alpha);
  }
}
