import {
  AIM_DX,
  AIM_DY,
  Cell,
  CELL,
  GRID_H,
  GRID_W,
  PlayerFlag,
  PlayerState,
  weaponDef,
  WeaponKind,
} from '@stickyclaude/shared';
import { boilX, boilY } from './noise.ts';
import { drawShape } from './draw.ts';
import type { Boil } from './draw.ts';
import { INK } from './palette.ts';
import { PEN_WIDTH, PenStyle } from './penStyle.ts';
import type { Pen } from './pen.ts';
import { HAT_SHAPES, PENCIL, WEAPON_INK, WEAPON_SHAPES } from './shapes.ts';
import { BODY, createPoseInput, J, Rig } from './skeleton.ts';
import type { PoseInput } from './skeleton.ts';
import type { DrawPlayer } from './types.ts';

/** Contexte de dessin d'une image. */
export interface PaintEnv {
  timeMs: number;
  dtS: number;
  boil: Boil;
  cells: Uint8Array;
  /** Papier de la page (pour assombrir les encres trop pâles). */
  paper: number;
  /** Les 12 encres de joueur, déjà assombries au besoin pour le papier de la page. */
  inks: readonly number[];
  /** Hit-stop et tremblé coupés. */
  reducedMotion: boolean;
}

/** Ce que le rendu garde d'un joueur d'une image à l'autre. */
export class PlayerVis {
  readonly rig = new Rig();
  readonly pose: PoseInput = createPoseInput();
  /** Position affichée (différente de la position réelle pendant un hit-stop). */
  dispX = 0;
  dispY = 0;
  hasDisp = false;
  freezeUntil = 0;
  catchUntil = 0;
  emote = 0;
  emoteAt = 0;
  victoryAt = -1;
  lastHp = 100;
  hpUntil = 0;
  /** Sommet de la tête (monde), pour le nom et la barre de vie. */
  topY = 0;
  headX = 0;
  /** Points du squelette en monde (x, y des 13 points). */
  readonly w = new Float32Array(26);
  /** Entier d'identité pour le tremblé. */
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }
}

const times = (w: number, phase: number): number => {
  const d = weaponDef(w);
  return phase === 1 ? d.startup : phase === 2 ? d.active : d.recovery;
};

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * t);
  const bl = Math.round(ab + ((b & 255) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Hauteur de sol sous un pied : 0 si on y est posé, > 0 si le pied pend dans le vide. */
function footDrop(cells: Uint8Array, wx: number, wy: number): number {
  const cx = Math.floor(wx / CELL);
  const cy = Math.floor((wy + 1) / CELL);
  if (cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H) return 0;
  const c = cells[cy * GRID_W + cx];
  return c === Cell.SOLID || c === Cell.PAPER || c === Cell.ONEWAY ? 0 : 2.6;
}

/** Segment entre deux points du squelette (indices a et b), sans bouts : ils sont posés aux jointures. */
function seg(
  pen: Pen,
  w: Float32Array,
  style: number,
  a: number,
  b: number,
  width: number,
  color: number,
  al: number,
): void {
  pen.segAt(w, a, b, width, color, al, style);
}

/** Bouts arrondis aux jointures a, b et c (−1 : aucune). */
function joints(
  pen: Pen,
  w: Float32Array,
  style: number,
  width: number,
  color: number,
  al: number,
  a: number,
  b: number,
  c: number,
): void {
  pen.capAt(w, a, width, color, al, style);
  if (b >= 0) pen.capAt(w, b, width, color, al, style);
  if (c >= 0) pen.capAt(w, c, width, color, al, style);
}

/** Tremblés réutilisés (aucune allocation par image). */
const hatBoil: Boil = { variant: 0, amp: 0, seed: 0 };
const weaponBoil: Boil = { variant: 0, amp: 0, seed: 0 };

/** Peint les stickmen : squelette → points monde → traits (+ arme, accessoire, motif, nom). */
export class StickmanPainter {
  private readonly vis = new Map<number, PlayerVis>();
  /** Valeurs de sortie du dernier `draw` (pour placer le nom). */
  headTopY = 0;
  headX = 0;

  visOf(slot: number): PlayerVis {
    let v = this.vis.get(slot);
    if (!v) {
      v = new PlayerVis(slot * 41 + 7);
      this.vis.set(slot, v);
    }
    return v;
  }

  forget(slot: number): void {
    this.vis.delete(slot);
  }

  reset(): void {
    this.vis.clear();
  }

  setEmote(slot: number, id: number, nowMs: number): void {
    const v = this.visOf(slot);
    // 0 à 5 : bulles de BD (pas d'animation) ; 6 salut, 7 danse, 8 rire
    v.emote = id >= 6 && id <= 8 ? id - 5 : 0;
    v.emoteAt = nowMs;
  }

  /** Fige les deux protagonistes d'un gros coup pendant `ms` (hit-stop visuel). */
  freeze(slot: number, nowMs: number, ms: number): void {
    const v = this.visOf(slot);
    v.freezeUntil = nowMs + ms;
    v.catchUntil = nowMs + ms + 90;
  }

  /** Marque un joueur comme gagnant de la manche (il joue son emote de victoire). */
  setVictory(slot: number, on: boolean, nowMs: number): void {
    const v = this.visOf(slot);
    if (on && v.victoryAt < 0) v.victoryAt = nowMs;
    else if (!on) v.victoryAt = -1;
  }

  /** Position affichée d'un joueur (pieds), ou null. */
  displayed(slot: number): { x: number; y: number } | null {
    const v = this.vis.get(slot);
    return v?.hasDisp ? { x: v.dispX, y: v.dispY } : null;
  }

  /** Points du squelette (monde) du dernier dessin : pour le ragdoll. */
  jointsOf(slot: number): Float32Array | null {
    return this.vis.get(slot)?.w ?? null;
  }

  draw(pen: Pen, p: DrawPlayer, env: PaintEnv): void {
    const v = this.visOf(p.slot);
    const now = env.timeMs;
    const frozen = !env.reducedMotion && now < v.freezeUntil;

    // Position affichée : figée pendant le hit-stop, puis rattrapage en ≈ 60 ms.
    if (!v.hasDisp || (!frozen && now >= v.catchUntil)) {
      v.dispX = p.x;
      v.dispY = p.y;
      v.hasDisp = true;
    } else if (!frozen) {
      const k = 1 - Math.exp(-env.dtS / 0.025);
      v.dispX += (p.x - v.dispX) * k;
      v.dispY += (p.y - v.dispY) * k;
    }
    const ox = v.dispX;
    const oy = v.dispY;
    const facing = p.facing >= 0 ? 1 : -1;

    // Entrée de pose
    const pose = v.pose;
    pose.state = p.state === PlayerState.GHOST ? PlayerState.IDLE : p.state;
    pose.animProg = p.animProg;
    pose.variant = p.variant;
    pose.vx = p.vx;
    pose.vy = p.vy;
    pose.grounded = (p.flags & PlayerFlag.GROUNDED) !== 0;
    pose.crouching = p.crouching;
    pose.weapon = p.weapon;
    pose.weaponKind = weaponDef(p.weapon).kind;
    pose.aimX = AIM_DX[p.aim & 15] * facing;
    pose.aimY = AIM_DY[p.aim & 15];
    const n = Math.hypot(pose.aimX, pose.aimY) || 1;
    pose.aimX /= n;
    pose.aimY /= n;
    pose.emote = v.emote;
    pose.emoteT = (now - v.emoteAt) / 1000;
    if (v.emote !== 0 && pose.emoteT > 1.6) v.emote = 0;
    pose.victory = v.victoryAt >= 0 ? p.victory + 1 : 0;
    pose.victoryT = v.victoryAt >= 0 ? (now - v.victoryAt) / 1000 : 0;
    pose.timeS = now / 1000;
    pose.dtS = frozen ? 0 : env.dtS;
    pose.groundL = pose.grounded ? footDrop(env.cells, ox - facing * 3.2, oy) : 0;
    pose.groundR = pose.grounded ? footDrop(env.cells, ox + facing * 3.0, oy) : 0;
    if (frozen) pose.dtS = 0;
    v.rig.update(pose, times);

    // Points en monde, avec le tremblé
    const rig = v.rig;
    const w = v.w;
    const boil = env.boil;
    const idBase = v.id;
    for (let i = 0; i < 13; i++) {
      const bx = boil.amp > 0 ? boilX(idBase + i, boil.variant) * boil.amp : 0;
      const by = boil.amp > 0 ? boilY(idBase + i, boil.variant) * boil.amp : 0;
      w[i * 2] = ox + facing * rig.joints[i * 2] + bx;
      w[i * 2 + 1] = oy + rig.joints[i * 2 + 1] + by;
    }

    // Couleur et style
    const mannequin = p.mannequin;
    let ink = mannequin ? INK.graphite : env.inks[p.color % env.inks.length];
    const style = mannequin ? PenStyle.PENCIL : p.stroke;
    const wd = PEN_WIDTH[style];
    let alpha = 1;
    if ((p.flags & PlayerFlag.INVULN) !== 0 && Math.floor(now / 90) % 2 === 0) alpha = 0.4;
    if ((p.flags & PlayerFlag.HIT_FLASH) !== 0 && Math.floor(now / 70) % 2 === 0) {
      ink = mix(ink, 0xffffff, 0.7);
    }

    // Son propre personnage : lueur de sa couleur d'encre pour le retrouver d'un coup d'œil
    // (aucune ombre au sol : elle restait sous le personnage en l'air)
    if (p.self && !mannequin) pen.glow(ox, oy - 13, 25, ink, 0.26);

    this.paintBody(pen, v, p, w, ink, alpha, style, wd, env);
    this.headTopY = w[J.HEAD * 2 + 1] - BODY.headR - 2;
    this.headX = w[J.HEAD * 2];
    v.topY = this.headTopY;
    v.headX = this.headX;

    // Barre de vie : visible 2,2 s après un changement de PV
    if (p.hp !== v.lastHp) {
      if (p.hp < v.lastHp) v.hpUntil = now + 2200;
      v.lastHp = p.hp;
    }
  }

  private paintBody(
    pen: Pen,
    v: PlayerVis,
    p: DrawPlayer,
    w: Float32Array,
    ink: number,
    alpha: number,
    style: number,
    wd: number,
    env: PaintEnv,
  ): void {
    const facing = p.facing >= 0 ? 1 : -1;
    // contour blanc de son propre stickman (+ 2,6 de chaque côté)
    if (p.self) {
      const ow = wd + 5.2;
      const white = 0xffffff;
      seg(pen, w, style, J.NECK, J.PEL, ow, white, 0.92);
      seg(pen, w, style, J.NECK, J.SHL, ow, white, 0.92);
      seg(pen, w, style, J.NECK, J.SHR, ow, white, 0.92);
      seg(pen, w, style, J.SHL, J.ELL, ow, white, 0.92);
      seg(pen, w, style, J.ELL, J.HNL, ow, white, 0.92);
      seg(pen, w, style, J.SHR, J.ELR, ow, white, 0.92);
      seg(pen, w, style, J.ELR, J.HNR, ow, white, 0.92);
      seg(pen, w, style, J.PEL, J.KNL, ow, white, 0.92);
      seg(pen, w, style, J.KNL, J.FTL, ow, white, 0.92);
      seg(pen, w, style, J.PEL, J.KNR, ow, white, 0.92);
      seg(pen, w, style, J.KNR, J.FTR, ow, white, 0.92);
      joints(pen, w, style, ow, white, 0.92, J.NECK, J.PEL, J.SHL);
      joints(pen, w, style, ow, white, 0.92, J.SHR, J.ELL, J.HNL);
      joints(pen, w, style, ow, white, 0.92, J.ELR, J.HNR, J.KNL);
      joints(pen, w, style, ow, white, 0.92, J.FTL, J.KNR, J.FTR);
      pen.disc(w[J.HEAD * 2], w[J.HEAD * 2 + 1], BODY.headR + 2.4, BODY.headR + 2.4, white, 0.92);
    }
    const far = wd * 0.9;
    const farAlpha = alpha * 0.88;
    // côté éloigné
    seg(pen, w, style, J.SHL, J.ELL, far, ink, farAlpha);
    seg(pen, w, style, J.ELL, J.HNL, far, ink, farAlpha);
    seg(pen, w, style, J.PEL, J.KNL, far, ink, farAlpha);
    seg(pen, w, style, J.KNL, J.FTL, far, ink, farAlpha);
    joints(pen, w, style, far, ink, farAlpha, J.ELL, J.HNL, J.KNL);
    joints(pen, w, style, far, ink, farAlpha, J.FTL, -1, -1);
    // tronc
    seg(pen, w, style, J.NECK, J.PEL, wd * 1.12, ink, alpha);
    seg(pen, w, style, J.NECK, J.SHL, wd, ink, alpha);
    seg(pen, w, style, J.NECK, J.SHR, wd, ink, alpha);
    joints(pen, w, style, wd, ink, alpha, J.NECK, J.PEL, J.SHL);
    joints(pen, w, style, wd, ink, alpha, J.SHR, -1, -1);
    // côté proche
    seg(pen, w, style, J.PEL, J.KNR, wd, ink, alpha);
    seg(pen, w, style, J.KNR, J.FTR, wd, ink, alpha);
    joints(pen, w, style, wd, ink, alpha, J.KNR, J.FTR, -1);
    // tête : cercle tracé, le sommet des cheveux n'existe pas (c'est un bonhomme-bâton)
    const hx = w[J.HEAD * 2];
    const hy = w[J.HEAD * 2 + 1];
    const tilt = v.rig.headTilt * facing;
    const sx = 1 + (env.boil.amp > 0 ? boilX(v.id + 90, env.boil.variant) * 0.04 : 0);
    pen.headRing(hx, hy, sx, 2 - sx, tilt, ink, alpha, style);

    // yeux (regard vers l'avant) : deux petits points
    const eyeX = hx + facing * 1.9;
    pen.disc(eyeX, hy - 0.9, 0.55, 0.55, ink, alpha);
    pen.disc(eyeX + facing * 2.0, hy - 0.9, 0.55, 0.55, ink, alpha);

    // accessoire
    const hatShape = HAT_SHAPES[p.hat];
    if (hatShape) {
      hatBoil.variant = env.boil.variant;
      hatBoil.amp = env.boil.amp * 0.6;
      hatBoil.seed = v.id + 120;
      drawShape(
        pen,
        hatShape,
        hx,
        hy,
        facing,
        0,
        0,
        v.rig.headTilt,
        1,
        wd * 0.8,
        ink,
        alpha,
        style,
        hatBoil,
      );
    }

    // arme, côté proche, devant le corps
    const weapon = WEAPON_SHAPES[p.weapon];
    if (weapon && v.rig.holding) {
      weaponBoil.variant = env.boil.variant;
      weaponBoil.amp = env.boil.amp * 0.7;
      weaponBoil.seed = v.id + 150;
      const wdef = weaponDef(p.weapon);
      const wink = WEAPON_INK[p.weapon] ?? INK.black;
      const col = wdef.kind === WeaponKind.MINE ? INK.night : wink;
      drawShape(
        pen,
        weapon,
        v.dispX,
        v.dispY,
        facing,
        v.rig.gripX,
        v.rig.gripY,
        v.rig.weaponAngle,
        1,
        2.0,
        col,
        alpha,
        PenStyle.BALLPOINT,
        weaponBoil,
      );
    }
    // bras proche
    seg(pen, w, style, J.SHR, J.ELR, wd, ink, alpha);
    seg(pen, w, style, J.ELR, J.HNR, wd, ink, alpha);
    joints(pen, w, style, wd, ink, alpha, J.ELR, J.HNR, -1);
  }

  /** Fantôme-crayon : un crayon incliné, tracé en graphite, avec une croix de visée. */
  drawGhost(pen: Pen, p: DrawPlayer, env: PaintEnv): void {
    const v = this.visOf(p.slot);
    v.dispX = p.x;
    v.dispY = p.y;
    v.hasDisp = true;
    const ink = env.inks[p.color % env.inks.length];
    const bob = Math.sin(env.timeMs / 220 + v.id) * 1.4;
    drawShape(
      pen,
      PENCIL,
      p.x,
      p.y + bob,
      1,
      0,
      0,
      0,
      1.15,
      2.0,
      INK.graphite,
      0.8,
      PenStyle.PENCIL,
      env.boil,
    );
    pen.cap(p.x, p.y + bob, 3.4, ink, 0.9, PenStyle.PENCIL);
    pen.seg(p.x - 5, p.y, p.x + 5, p.y, 1.1, ink, 0.55, PenStyle.BALLPOINT);
    pen.seg(p.x, p.y - 5, p.x, p.y + 5, 1.1, ink, 0.55, PenStyle.BALLPOINT);
    if (p.self) pen.ring(p.x, p.y, 8, 8, 0xffffff, 0.8);
    this.headTopY = p.y - 18;
    this.headX = p.x;
  }
}
