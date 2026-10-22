import { CELL, SimEvent, WORLD_H } from '@stickyclaude/shared';
import type { Container } from 'pixi.js';
import { Sprite, Texture } from 'pixi.js';
import { canvas2d } from './art.ts';
import { drawShape } from './draw.ts';
import { FlashLimiter } from './limiter.ts';
import type { Boil } from './draw.ts';
import { rand2 } from './noise.ts';
import type { GameEvent } from '../net/client.ts';
import { FONT_DISPLAY } from './page.ts';
import { INK } from './palette.ts';
import { PenStyle } from './penStyle.ts';
import type { Pen, PenTextures } from './pen.ts';
import { burst, PENCIL, WEAPON_SHAPES } from './shapes.ts';
import type { TextPool } from './textpool.ts';

/**
 * Effets et sensations : taches d'encre persistantes, onomatopoeias, éclats de papier, étincelles,
 * traînées, anneaux, flash de parade parfaite, apparition des armes dessinées en direct, bulles
 * d'emote. Tout vient de pools de taille fixe et se dessine avec le stylo : aucune allocation par
 * image. Voir `docs/DIRECTION_ARTISTIQUE.md` §6.4.
 */

export const MAX_PARTICLES = 360;
const MAX_RINGS = 32;
const MAX_LINES = 40;
const MAX_ONO = 8;
const MAX_BLOTS = 48;
const MAX_BUBBLES = 8;
const MAX_DRAWINS = 6;
const MAX_ROPES = 6;

/** Mots des onomatopées : graphismes communs au français et à l'anglais. */
export const Ono = { BAM: 0, POW: 1, CRAC: 2, ZIP: 3, SPLAT: 4 } as const;
const ONO_WORDS = ['BAM', 'POW', 'CRAC', 'ZIP', 'SPLAT'];
const ONO_STYLE: { burst: number; text: number }[] = [
  { burst: 0xf2c94c, text: 0xd6322e },
  { burst: 0xf2994a, text: 0x22262e },
  { burst: 0xe7d6a4, text: 0x7a4a2b },
  { burst: 0xa9dcf2, text: 0x1f4fd1 },
  { burst: 0xd4bff2, text: 0x5a2d94 },
];

const PK = { SCRAP: 0, DROP: 1, SPARK: 2, DOT: 3, STREAK: 4 } as const;

export interface FxHooks {
  shake(amp: number): void;
  /** Fige le slot (hit-stop visuel). */
  freeze(slot: number, ms: number): void;
  /** Un joueur est éliminé : le rendu crée le ragdoll. */
  ko(slot: number, x: number, y: number, vx: number, vy: number): void;
  emote(slot: number, id: number): void;
}

export interface FxEnv {
  nowMs: number;
  /** Position (pieds) d'un joueur à l'écran, ou null. */
  playerPos(slot: number): { x: number; y: number } | null;
  /** Point au-dessus du pseudo (centre) ; `right` : le joueur porte une flèche, la bulle va à sa droite. */
  overheadPos(slot: number): { x: number; y: number; right: boolean } | null;
  colorOf(slot: number): number;
  reducedMotion: boolean;
  /** Densité des particules : 1 (haute), 0,5 (basse). */
  density: number;
}

let onoTex: Texture[] | null = null;

/** Textures des onomatopoeias (bulle dentelée + mot en Bangers), créées une fois la police prête. */
export function onoTextures(): Texture[] {
  if (onoTex) return onoTex;
  onoTex = ONO_WORDS.map((word, i) => {
    const [c, ctx] = canvas2d(224, 150);
    const st = ONO_STYLE[i];
    ctx.translate(112, 75);
    ctx.beginPath();
    const pts = burst(11 + (i % 3), 0.7, i + 2);
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k] * 104;
      const y = pts[k + 1] * 66;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `#${st.burst.toString(16).padStart(6, '0')}`;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#22262e';
    ctx.stroke();
    ctx.font = `${word.length > 4 ? 50 : 62}px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(word, 0, 4);
    ctx.fillStyle = `#${st.text.toString(16).padStart(6, '0')}`;
    ctx.fillText(word, 0, 4);
    const t = Texture.from(c);
    t.source.scaleMode = 'linear';
    return t;
  });
  return onoTex;
}

/** Système d'effets. */
export class FxSystem {
  // particules (tableaux de structures)
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pvx = new Float32Array(MAX_PARTICLES);
  private readonly pvy = new Float32Array(MAX_PARTICLES);
  private readonly prot = new Float32Array(MAX_PARTICLES);
  private readonly pvr = new Float32Array(MAX_PARTICLES);
  private readonly psize = new Float32Array(MAX_PARTICLES);
  private readonly plife = new Float32Array(MAX_PARTICLES);
  private readonly pmax = new Float32Array(MAX_PARTICLES);
  private readonly pcolor = new Uint32Array(MAX_PARTICLES);
  private readonly pkind = new Uint8Array(MAX_PARTICLES);
  private pnext = 0;
  // anneaux
  private readonly rx = new Float32Array(MAX_RINGS);
  private readonly ry = new Float32Array(MAX_RINGS);
  private readonly rr0 = new Float32Array(MAX_RINGS);
  private readonly rr1 = new Float32Array(MAX_RINGS);
  private readonly rlife = new Float32Array(MAX_RINGS);
  private readonly rmax = new Float32Array(MAX_RINGS);
  private readonly rcolor = new Uint32Array(MAX_RINGS);
  private readonly rglow = new Uint8Array(MAX_RINGS);
  private rnext = 0;
  // traits (balles)
  private readonly lx1 = new Float32Array(MAX_LINES);
  private readonly ly1 = new Float32Array(MAX_LINES);
  private readonly lx2 = new Float32Array(MAX_LINES);
  private readonly ly2 = new Float32Array(MAX_LINES);
  private readonly llife = new Float32Array(MAX_LINES);
  private readonly lmax = new Float32Array(MAX_LINES);
  private readonly lcolor = new Uint32Array(MAX_LINES);
  private readonly lwidth = new Float32Array(MAX_LINES);
  private lnext = 0;
  // onomatopées
  private readonly onoSprites: Sprite[] = [];
  private readonly ox = new Float32Array(MAX_ONO);
  private readonly oy = new Float32Array(MAX_ONO);
  private readonly oword = new Uint8Array(MAX_ONO);
  private readonly orot = new Float32Array(MAX_ONO);
  private readonly oscale = new Float32Array(MAX_ONO);
  private readonly olife = new Float32Array(MAX_ONO);
  private readonly omax = new Float32Array(MAX_ONO);
  private onext = 0;
  private readonly lastOnoAt = new Float64Array(5);
  // taches persistantes
  private readonly blotSprites: Sprite[] = [];
  private bnext = 0;
  private blotCount = 0;
  // bulles d'emote
  private readonly bslot = new Int8Array(MAX_BUBBLES).fill(-1);
  private readonly bemote = new Uint8Array(MAX_BUBBLES);
  private readonly blife = new Float32Array(MAX_BUBBLES);
  // armes dessinées en direct
  private readonly dx = new Float32Array(MAX_DRAWINS);
  private readonly dy = new Float32Array(MAX_DRAWINS);
  private readonly dweapon = new Uint8Array(MAX_DRAWINS);
  private readonly dage = new Float32Array(MAX_DRAWINS);
  private readonly dactive = new Uint8Array(MAX_DRAWINS);
  // cordes de grappin
  private readonly cslot = new Int8Array(MAX_ROPES).fill(-1);
  private readonly cax = new Float32Array(MAX_ROPES);
  private readonly cay = new Float32Array(MAX_ROPES);
  private readonly clife = new Float32Array(MAX_ROPES);
  private readonly flashes = new FlashLimiter();
  private readonly tx: PenTextures;
  private readonly scratch = new Float32Array(160);

  constructor(
    private readonly hooks: FxHooks,
    blotParent: Container,
    onoParent: Container,
    tx: PenTextures,
  ) {
    this.tx = tx;
    for (let i = 0; i < MAX_BLOTS; i++) {
      const s = new Sprite(tx.blot[i % tx.blot.length]);
      s.anchor.set(0.5);
      s.visible = false;
      blotParent.addChild(s);
      this.blotSprites.push(s);
    }
    const textures = onoTextures();
    for (let i = 0; i < MAX_ONO; i++) {
      const s = new Sprite(textures[0]);
      s.anchor.set(0.5);
      s.visible = false;
      onoParent.addChild(s);
      this.onoSprites.push(s);
    }
  }

  /** Vide tous les effets (changement de manche). Les taches persistantes sont effacées aussi. */
  clear(): void {
    this.plife.fill(0);
    this.rlife.fill(0);
    this.llife.fill(0);
    this.olife.fill(0);
    this.blife.fill(0);
    this.bslot.fill(-1);
    this.dactive.fill(0);
    this.clife.fill(0);
    this.cslot.fill(-1);
    for (const s of this.blotSprites) s.visible = false;
    for (const s of this.onoSprites) s.visible = false;
    this.blotCount = 0;
    this.bnext = 0;
  }

  /** Nombre de particules actives (mesures). */
  get activeParticles(): number {
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) if (this.plife[i] > 0) n++;
    return n;
  }

  get blots(): number {
    return this.blotCount;
  }

  // --- Création ------------------------------------------------------------------------------

  private particle(
    kind: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    life: number,
    color: number,
  ): void {
    const i = this.pnext;
    this.pnext = (this.pnext + 1) % MAX_PARTICLES;
    this.pkind[i] = kind;
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.prot[i] = rand2(i, Math.floor(x), 77) * 6.28;
    this.pvr[i] = (rand2(i, Math.floor(y), 78) - 0.5) * 14;
    this.psize[i] = size;
    this.plife[i] = life;
    this.pmax[i] = life;
    this.pcolor[i] = color;
  }

  /** `n` particules lancées en gerbe autour de (x, y), dans la direction (dirX, dirY) si non nulle. */
  private spray(
    kind: number,
    n: number,
    x: number,
    y: number,
    speed: number,
    size: number,
    life: number,
    color: number,
    env: FxEnv,
    dirX = 0,
    dirY = 0,
    spread = Math.PI * 2,
  ): void {
    const count = Math.max(1, Math.round(n * env.density));
    const base = dirX === 0 && dirY === 0 ? 0 : Math.atan2(dirY, dirX);
    for (let k = 0; k < count; k++) {
      const r = rand2(k, Math.floor(x * 3 + y), this.pnext);
      const a =
        dirX === 0 && dirY === 0 ? (k / count) * Math.PI * 2 + r : base + (r - 0.5) * spread;
      const v = speed * (0.45 + 0.75 * rand2(k, Math.floor(y), this.pnext + 5));
      this.particle(
        kind,
        x,
        y,
        Math.cos(a) * v,
        Math.sin(a) * v,
        size * (0.7 + 0.6 * r),
        life * (0.7 + 0.5 * r),
        color,
      );
    }
  }

  private ring(
    x: number,
    y: number,
    r0: number,
    r1: number,
    life: number,
    color: number,
    glow: boolean,
  ): void {
    const i = this.rnext;
    this.rnext = (this.rnext + 1) % MAX_RINGS;
    this.rx[i] = x;
    this.ry[i] = y;
    this.rr0[i] = r0;
    this.rr1[i] = r1;
    this.rlife[i] = life;
    this.rmax[i] = life;
    this.rcolor[i] = color;
    this.rglow[i] = glow ? 1 : 0;
  }

  private line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: number,
    life: number,
    color: number,
  ): void {
    const i = this.lnext;
    this.lnext = (this.lnext + 1) % MAX_LINES;
    this.lx1[i] = x1;
    this.ly1[i] = y1;
    this.lx2[i] = x2;
    this.ly2[i] = y2;
    this.lwidth[i] = w;
    this.llife[i] = life;
    this.lmax[i] = life;
    this.lcolor[i] = color;
  }

  /** Onomatopée : au plus une par mot toutes les 180 ms, sinon ignorée. */
  private ono(word: number, x: number, y: number, scale: number, env: FxEnv): void {
    if (env.nowMs - this.lastOnoAt[word] < 180) return;
    this.lastOnoAt[word] = env.nowMs;
    const i = this.onext;
    this.onext = (this.onext + 1) % MAX_ONO;
    this.ox[i] = x;
    this.oy[i] = y;
    this.oword[i] = word;
    this.orot[i] = (rand2(Math.floor(x), Math.floor(y), 31) - 0.5) * 0.5;
    this.oscale[i] = scale;
    this.olife[i] = 0.55;
    this.omax[i] = 0.55;
    this.onoSprites[i].texture = onoTextures()[word];
  }

  /** Tache d'encre persistante (au plus 48 par manche : la plus ancienne est recyclée). */
  blot(x: number, y: number, color: number, scale: number, alpha = 0.9): void {
    const s = this.blotSprites[this.bnext];
    const v = Math.floor(rand2(Math.floor(x), Math.floor(y), this.bnext) * this.tx.blot.length);
    s.texture = this.tx.blot[v];
    s.position.set(x, y);
    s.rotation = rand2(Math.floor(y), Math.floor(x), 3) * 6.28;
    const size = 38 * scale;
    s.width = size;
    s.height = size * (0.8 + 0.3 * rand2(Math.floor(x), 1, 5));
    s.tint = color;
    s.alpha = alpha;
    s.visible = true;
    this.bnext = (this.bnext + 1) % MAX_BLOTS;
    this.blotCount = Math.min(MAX_BLOTS, this.blotCount + 1);
  }

  /** Éclat doré de parade parfaite, au plus 3 par seconde. */
  private flash(x: number, y: number, env: FxEnv): void {
    if (!this.flashes.allow(env.nowMs)) return;
    this.ring(x, y, 4, 34, 0.26, INK.gold, true);
  }

  /**
   * Impact d'un coup qui porte : trois traits dans l'axe attaquant → victime, dans la couleur de
   * l'attaquant (on lit qui frappe et dans quel sens), et des gouttes d'encre de la victime
   * projetées dans le même sens. Sobre : quelques traits, une seule teinte par joueur.
   */
  private impact(
    x: number,
    y: number,
    attacker: number,
    victim: number,
    dmg: number,
    big: boolean,
    victimColor: number,
    env: FxEnv,
  ): void {
    const from = attacker !== 255 && attacker !== victim ? env.playerPos(attacker) : null;
    const to = env.playerPos(victim);
    let dx = 0;
    let dy = -1;
    if (from && to) {
      dx = to.x - from.x;
      dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      } else {
        dx = 0;
        dy = -1;
      }
    }
    const col = attacker !== 255 ? env.colorOf(attacker) : INK.black;
    const reach = big ? 30 : dmg >= 8 ? 22 : 16;
    const base = Math.atan2(dy, dx);
    for (let k = -1; k <= 1; k++) {
      const a = base + k * 0.38;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = 6 + (k === 0 ? 0 : 2);
      const r1 = reach * (k === 0 ? 1 : 0.7);
      this.line(x + c * r0, y + s * r0, x + c * r1, y + s * r1, big ? 3 : 2.2, 0.16, col);
    }
    if (dmg >= 5 && !env.reducedMotion) {
      this.spray(PK.DROP, big ? 5 : 3, x, y, 110, 2.2, 0.45, victimColor, env, dx, dy, 1.0);
    }
    if (big) this.flash(x, y, env);
  }

  // --- Événements -----------------------------------------------------------------------------

  /** Transforme un événement de la simulation en effets, hit-stop, secousse, ragdoll. */
  add(e: GameEvent, env: FxEnv): void {
    const a = e.a;
    switch (e.type) {
      case SimEvent.HIT: {
        const x = a[0];
        const y = a[1];
        const attacker = a[2] ?? 255;
        const dmg = a[3] ?? 0;
        const flags = a[4] ?? 0;
        const heavy = (flags & 1) !== 0;
        const blocked = (flags & 2) !== 0;
        const lethal = (flags & 4) !== 0;
        const color = env.colorOf(e.slot);
        this.ring(x, y, 3, heavy ? 22 : 13, 0.22, INK.black, false);
        this.spray(PK.SPARK, heavy ? 8 : 5, x, y, 130, 5, 0.22, INK.black, env);
        if (blocked) break;
        this.impact(x, y, attacker, e.slot, dmg, heavy || lethal, color, env);
        let ms = 0;
        if (lethal || heavy || dmg >= 12) ms = 90;
        else if (dmg >= 8) ms = 60;
        else if (dmg >= 5) ms = 40;
        if (ms >= 50 && !env.reducedMotion) {
          this.hooks.freeze(e.slot, ms);
          if (attacker !== 255) this.hooks.freeze(attacker, ms);
        }
        if (heavy || lethal) {
          this.hooks.shake(lethal ? 4.6 : 3.2);
          this.blot(x, y, color, 0.8, 0.85);
          this.ono(
            rand2(Math.floor(x), Math.floor(y), 2) < 0.5 ? Ono.BAM : Ono.POW,
            x,
            y - 20,
            lethal ? 1.15 : 0.95,
            env,
          );
          this.spray(PK.SCRAP, 4, x, y, 90, 3.4, 0.7, 0xffffff, env);
        } else if (dmg >= 8) {
          this.hooks.shake(1.3);
        }
        break;
      }
      case SimEvent.KO: {
        const x = a[0];
        const y = a[1];
        const color = env.colorOf(e.slot);
        this.ring(x, y, 6, 36, 0.35, color, false);
        this.spray(PK.SPARK, 10, x, y, 170, 6, 0.3, color, env);
        this.spray(PK.DROP, 8, x, y, 150, 2.4, 0.6, color, env);
        this.blot(x, Math.min(y + 6, WORLD_H - 6), color, 1.35, 0.9);
        const cause = a[3] ?? 0;
        if (cause !== 9 && cause !== 10) {
          this.ono(cause === 6 || cause === 11 ? Ono.SPLAT : Ono.POW, x, y - 26, 1.2, env);
        }
        if (!env.reducedMotion) {
          this.hooks.freeze(e.slot, 90);
          const killer = a[2] ?? 255;
          if (killer !== 255 && killer !== e.slot) this.hooks.freeze(killer, 90);
        }
        this.hooks.shake(5);
        this.hooks.ko(e.slot, x, y, a[4] ?? 0, a[5] ?? 0);
        break;
      }
      case SimEvent.BLOCKED: {
        const x = a[0];
        const y = a[1];
        const perfect = (a[3] ?? 0) === 1;
        if (perfect) {
          this.flash(x, y, env);
          this.ring(x, y, 5, 24, 0.3, INK.gold, false);
          this.spray(PK.SPARK, 8, x, y, 190, 6, 0.3, INK.gold, env);
          if (!env.reducedMotion) {
            this.hooks.freeze(e.slot, 80);
            const att = a[2] ?? 255;
            if (att !== 255) this.hooks.freeze(att, 80);
          }
          this.hooks.shake(2.2);
        } else {
          this.ring(x, y, 4, 14, 0.2, INK.blue, false);
          this.spray(PK.SPARK, 4, x, y, 110, 4, 0.18, INK.blue, env);
        }
        break;
      }
      case SimEvent.SHOT: {
        const wid = a[4] ?? 0;
        const x1 = a[0];
        const y1 = a[1];
        const x2 = a[2];
        const y2 = a[3];
        if (Math.hypot(x2 - x1, y2 - y1) > 12) {
          this.line(x1, y1, x2, y2, wid === 5 ? 1.2 : 1.8, wid === 5 ? 0.09 : 0.13, INK.black);
        }
        this.spray(PK.SPARK, 4, x1, y1, 150, 5, 0.13, 0xe8801a, env, x2 - x1, y2 - y1, 0.7);
        this.spray(PK.DOT, 2, x1, y1, 30, 3, 0.4, 0x9ca3af, env, x2 - x1, y2 - y1, 1.6);
        if (wid === 5) this.hooks.shake(1.4);
        break;
      }
      case SimEvent.EXPLOSION: {
        const x = a[0];
        const y = a[1];
        const radius = a[2] ?? 30;
        const kind = a[3] ?? 0;
        if (kind === 2) {
          // ballon : éclats roses
          this.ring(x, y, 4, 22, 0.2, 0xe5579a, false);
          this.spray(PK.SCRAP, 8, x, y, 120, 4, 0.7, 0xe5579a, env);
        } else if (kind === 4) {
          this.spray(PK.SCRAP, 10, x, y, 130, 4, 0.8, 0xb98a5a, env);
          this.ono(Ono.CRAC, x, y - 20, 0.9, env);
        } else {
          this.ring(x, y, 6, Math.max(20, radius), 0.4, kind === 3 ? 0x7b3fb5 : INK.night, true);
          this.spray(PK.DROP, 14, x, y, 220, 3, 0.7, INK.night, env);
          this.blot(x, y, kind === 3 ? 0x7b3fb5 : INK.night, radius / 38 + 0.6, 0.85);
          this.ono(Ono.SPLAT, x, y - radius * 0.5, 1.3, env);
        }
        this.hooks.shake(Math.max(1.5, radius / 14));
        break;
      }
      case SimEvent.TERRAIN: {
        const x = (a[0] + 0.5) * CELL;
        const y = (a[1] + 0.5) * CELL;
        const r = ((a[2] ?? 0) / 10) * CELL;
        this.spray(PK.SCRAP, 6 + Math.round(r / 6), x, y, 100, 4, 0.9, 0xe7d6a4, env);
        this.ring(x, y, 3, Math.max(10, r + 6), 0.25, INK.paperBlockEdge, false);
        this.ono(Ono.CRAC, x, y - 14, 0.85, env);
        break;
      }
      case SimEvent.WEAPON_SPAWN: {
        const i = this.dactive.indexOf(0);
        const k = i < 0 ? 0 : i;
        this.dx[k] = a[0];
        this.dy[k] = a[1];
        this.dweapon[k] = a[2] ?? 1;
        this.dage[k] = 0;
        this.dactive[k] = 1;
        break;
      }
      case SimEvent.SPAWN: {
        const x = a[0];
        const y = a[1] - 14;
        const color = env.colorOf(e.slot);
        this.ring(x, y, 4, 22, 0.3, color, false);
        this.spray(PK.SPARK, 6, x, y, 80, 4, 0.3, color, env);
        break;
      }
      case SimEvent.HEAL: {
        const x = a[0] ?? 0;
        const y = a[1] ?? 0;
        this.ring(x, y, 4, 24, 0.35, INK.red, false);
        this.spray(PK.SPARK, 8, x, y, 70, 5, 0.5, 0xff8fa3, env, 0, -1, 1.2);
        break;
      }
      case SimEvent.PICKUP: {
        const p = env.playerPos(a[0] ?? 0);
        if (p) this.ring(p.x, p.y - 16, 3, 14, 0.2, INK.blue, false);
        break;
      }
      case SimEvent.THROW: {
        const p = env.playerPos(a[0] ?? 0);
        if (p) this.spray(PK.SPARK, 3, p.x, p.y - 16, 70, 4, 0.15, INK.black, env);
        break;
      }
      case SimEvent.EMOTE: {
        const id = a[0] ?? 0;
        if (id < 6) {
          const i = this.bslot.indexOf(-1);
          const k = i < 0 ? 0 : i;
          this.bslot[k] = e.slot;
          this.bemote[k] = id;
          this.blife[k] = 2.0;
        }
        this.hooks.emote(e.slot, id);
        break;
      }
      case SimEvent.GHOST_DRAW: {
        const x = ((a[1] ?? 0) + 0.5) * CELL;
        const y = ((a[2] ?? 0) + 0.5) * CELL;
        this.spray(PK.SCRAP, 4, x, y, 60, 3, 0.5, 0x6b7280, env);
        this.ring(x, y, 2, 12, 0.2, 0x6b7280, false);
        break;
      }
      case SimEvent.PUDDLE: {
        this.spray(PK.DROP, 6, a[0], a[1], 90, 2.2, 0.5, INK.night, env, 0, -1, 2.5);
        break;
      }
      case SimEvent.STAMP: {
        this.blot(a[0], a[1] - 2, INK.night, 1.1, 0.9);
        this.ring(a[0], a[1], 4, 26, 0.3, INK.night, false);
        this.ono(Ono.BAM, a[0], a[1] - 24, 1.1, env);
        this.hooks.shake(2.4);
        break;
      }
      case SimEvent.GRAPPLE: {
        const i = this.cslot.indexOf(-1);
        const k = i < 0 ? 0 : i;
        this.cslot[k] = e.slot;
        this.cax[k] = a[0];
        this.cay[k] = a[1];
        this.clife[k] = 0.4;
        this.ono(Ono.ZIP, a[0], a[1] - 12, 0.7, env);
        break;
      }
      case SimEvent.CRATE_BREAK: {
        this.spray(PK.SCRAP, 9, a[0], a[1] - 8, 120, 4, 0.8, 0xb98a5a, env);
        this.ring(a[0], a[1] - 8, 4, 18, 0.2, 0x7a4a2b, false);
        this.ono(Ono.CRAC, a[0], a[1] - 28, 0.85, env);
        break;
      }
      case SimEvent.GOAL: {
        const x = a[1];
        const y = a[2];
        const colors = [0xf2c94c, 0xe5579a, 0x1f4fd1, 0x1f9d55];
        for (let k = 0; k < 4; k++) {
          this.spray(PK.SCRAP, 6, x, y, 200, 5, 1.3, colors[k], env, 0, -1, 2.6);
        }
        this.hooks.shake(2.5);
        break;
      }
      case SimEvent.SUDDEN_DEATH:
        this.hooks.shake(3);
        break;
      default:
        break;
    }
  }

  /** Traînée d'un projectile : un point qui s'estompe, à appeler à chaque image. */
  trail(x: number, y: number, color: number, size: number, env: FxEnv): void {
    if (env.density < 1 && (this.pnext & 1) === 0) return;
    this.particle(PK.DOT, x, y, 0, 0, size, 0.3, color);
  }

  // --- Dessin ---------------------------------------------------------------------------------

  /** Avance les effets de `dtS` secondes et les dessine avec `pen` (couche d'effets). */
  draw(pen: Pen, labels: TextPool, dtS: number, env: FxEnv, boil: Boil): void {
    // particules
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.plife[i] <= 0) continue;
      this.plife[i] -= dtS;
      if (this.plife[i] <= 0) continue;
      const k = this.plife[i] / this.pmax[i];
      const kind = this.pkind[i];
      if (kind === PK.SCRAP || kind === PK.DROP)
        this.pvy[i] += (kind === PK.SCRAP ? 520 : 760) * dtS;
      const drag = Math.exp(-dtS * (kind === PK.SPARK ? 4.5 : 2.2));
      this.pvx[i] *= drag;
      this.pvy[i] =
        kind === PK.SPARK || kind === PK.DOT
          ? this.pvy[i] * drag
          : this.pvy[i] * Math.exp(-dtS * 0.8);
      this.px[i] += this.pvx[i] * dtS;
      this.py[i] += this.pvy[i] * dtS;
      this.prot[i] += this.pvr[i] * dtS;
      const c = this.pcolor[i];
      const s = this.psize[i];
      switch (kind) {
        case PK.SCRAP:
          pen.scrap(this.px[i], this.py[i], s, this.prot[i], c, Math.min(1, k * 1.8));
          break;
        case PK.DROP:
          pen.disc(
            this.px[i],
            this.py[i],
            s * (0.6 + 0.4 * k),
            s * (0.6 + 0.4 * k),
            c,
            Math.min(1, k * 2),
          );
          break;
        case PK.SPARK: {
          const vx = this.pvx[i];
          const vy = this.pvy[i];
          const sp = Math.hypot(vx, vy) || 1;
          const len = Math.min(s * 2.4, 3 + sp * 0.05) * k + 1;
          pen.seg(
            this.px[i],
            this.py[i],
            this.px[i] - (vx / sp) * len,
            this.py[i] - (vy / sp) * len,
            1.6,
            c,
            Math.min(1, k * 2),
            PenStyle.BALLPOINT,
          );
          break;
        }
        case PK.DOT:
          pen.disc(this.px[i], this.py[i], s * k + 0.4, s * k + 0.4, c, 0.5 * k);
          break;
        default:
          break;
      }
    }
    // traits de balle
    for (let i = 0; i < MAX_LINES; i++) {
      if (this.llife[i] <= 0) continue;
      this.llife[i] -= dtS;
      if (this.llife[i] <= 0) continue;
      const k = this.llife[i] / this.lmax[i];
      pen.seg(
        this.lx1[i],
        this.ly1[i],
        this.lx2[i],
        this.ly2[i],
        this.lwidth[i],
        this.lcolor[i],
        k,
        PenStyle.BALLPOINT,
        false,
      );
    }
    // anneaux
    for (let i = 0; i < MAX_RINGS; i++) {
      if (this.rlife[i] <= 0) continue;
      this.rlife[i] -= dtS;
      if (this.rlife[i] <= 0) continue;
      const t = 1 - this.rlife[i] / this.rmax[i];
      const r = this.rr0[i] + (this.rr1[i] - this.rr0[i]) * (1 - (1 - t) * (1 - t));
      pen.ring(this.rx[i], this.ry[i], r, r, this.rcolor[i], 1 - t);
      if (this.rglow[i] !== 0)
        pen.glow(this.rx[i], this.ry[i], r * 1.15, this.rcolor[i], 0.5 * (1 - t));
    }
    // cordes de grappin
    for (let i = 0; i < MAX_ROPES; i++) {
      if (this.cslot[i] < 0) continue;
      this.clife[i] -= dtS;
      if (this.clife[i] <= 0) {
        this.cslot[i] = -1;
        continue;
      }
      const p = env.playerPos(this.cslot[i]);
      if (p)
        pen.seg(
          p.x,
          p.y - 16,
          this.cax[i],
          this.cay[i],
          1.6,
          INK.graphite,
          Math.min(1, this.clife[i] * 4),
          PenStyle.PENCIL,
        );
    }
    // armes dessinées en direct : un crayon trace la forme en 0,8 s
    for (let i = 0; i < MAX_DRAWINS; i++) {
      if (this.dactive[i] === 0) continue;
      this.dage[i] += dtS;
      const t = this.dage[i] / 0.8;
      if (t >= 1) {
        this.dactive[i] = 0;
        continue;
      }
      this.drawIn(pen, i, t, boil);
    }
    // bulles d'emote
    for (let i = 0; i < MAX_BUBBLES; i++) {
      if (this.bslot[i] < 0) continue;
      this.blife[i] -= dtS;
      if (this.blife[i] <= 0) {
        this.bslot[i] = -1;
        continue;
      }
      const p = env.overheadPos(this.bslot[i]);
      if (!p) continue;
      this.bubble(
        pen,
        labels,
        p.x,
        p.y,
        p.right,
        this.bemote[i],
        Math.min(1, this.blife[i] * 4, (2 - this.blife[i]) * 8),
      );
    }
    // onomatopées : pop-in avec dépassement, puis fondu
    for (let i = 0; i < MAX_ONO; i++) {
      const s = this.onoSprites[i];
      if (this.olife[i] <= 0) {
        s.visible = false;
        continue;
      }
      this.olife[i] -= dtS;
      if (this.olife[i] <= 0) {
        s.visible = false;
        continue;
      }
      const age = this.omax[i] - this.olife[i];
      const pop =
        age < 0.12
          ? 0.3 + 0.82 * (age / 0.12)
          : age < 0.2
            ? 1.12 - 0.12 * ((age - 0.12) / 0.08)
            : 1;
      const base = 0.2 * this.oscale[i] * pop;
      s.visible = true;
      s.position.set(this.ox[i], this.oy[i] - age * 10);
      s.rotation = this.orot[i];
      s.scale.set(base);
      s.alpha = Math.min(1, this.olife[i] / 0.15);
    }
  }

  private drawIn(pen: Pen, i: number, t: number, boil: Boil): void {
    const shape = WEAPON_SHAPES[this.dweapon[i]];
    if (!shape) return;
    const rot = 0;
    let remaining = Math.max(2, Math.floor(shape.points * t));
    let tipX = this.dx[i];
    let tipY = this.dy[i];
    for (let k = 0; k < shape.strokes.length && remaining > 0; k++) {
      const pts = shape.strokes[k];
      const n = Math.min(pts.length >> 1, remaining, 78);
      remaining -= pts.length >> 1;
      for (let q = 0; q < n; q++) {
        this.scratch[q * 2] = this.dx[i] + (pts[q * 2] - shape.cx);
        this.scratch[q * 2 + 1] = this.dy[i] - 4 + (pts[q * 2 + 1] - shape.cy);
      }
      pen.poly(this.scratch, n, false, 2, 0x6b7280, 0.85, PenStyle.PENCIL);
      tipX = this.scratch[(n - 1) * 2];
      tipY = this.scratch[(n - 1) * 2 + 1];
    }
    // le crayon qui trace
    drawShape(
      pen,
      PENCIL,
      tipX,
      tipY,
      1,
      0,
      0,
      rot,
      0.9,
      1.6,
      0x6b7280,
      0.9,
      PenStyle.PENCIL,
      boil,
    );
  }

  private bubble(
    pen: Pen,
    labels: TextPool,
    ax: number,
    y: number,
    right: boolean,
    emote: number,
    alpha: number,
  ): void {
    const text = EMOTE_TEXT[emote] ?? '?';
    const t = labels.get(text, 13, 0x22262e, false);
    const w = Math.max(26, t.width + 12);
    const h = 19;
    // à droite de la flèche du joueur local, sinon centrée au-dessus de son pseudo
    const x = right ? ax + 11 + w / 2 : ax;
    const tail = right ? -w / 2 + 6 : 0;
    t.position.set(x, y);
    t.alpha = alpha;
    const pts = this.scratch;
    // bulle : rectangle arrondi (8 points) et queue vers le bas
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const y0 = y - h / 2;
    const y1 = y + h / 2;
    pts[0] = x0 + 4;
    pts[1] = y0;
    pts[2] = x1 - 4;
    pts[3] = y0;
    pts[4] = x1;
    pts[5] = y0 + 4;
    pts[6] = x1;
    pts[7] = y1 - 4;
    pts[8] = x1 - 4;
    pts[9] = y1;
    pts[10] = x + tail + 6;
    pts[11] = y1;
    pts[12] = x + tail + 1;
    pts[13] = y1 + 8;
    pts[14] = x + tail - 2;
    pts[15] = y1;
    pts[16] = x0 + 4;
    pts[17] = y1;
    pts[18] = x0;
    pts[19] = y1 - 4;
    pts[20] = x0;
    pts[21] = y0 + 4;
    pen.disc(x, y, w / 2 + 1, h / 2 + 1, 0xffffff, 0.92 * alpha);
    pen.poly(pts, 11, true, 1.5, 0x22262e, alpha, PenStyle.BALLPOINT);
  }
}

/** Texte des 6 emotes de bulle (le français ; les autres langues passent par `setEmoteTexts`). */
export const EMOTE_TEXT: string[] = ['Bien joué !', 'Oups', 'Revanche !', 'Hé hé', 'Aïe', 'GG'];
