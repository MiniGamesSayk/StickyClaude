import {
  AtkPhase,
  AttackKind,
  COMBAT,
  CROUCH_PUNCH,
  FIST,
  PlayerState,
  UPPER,
  WeaponKind,
} from '@stickyclaude/shared';

/**
 * Squelette du stickman : 13 points, poses-clés par état, mélange, IK à deux os pour les pieds et
 * les mains. Pur (aucune dépendance au rendu), sans allocation après la construction.
 *
 * Repère local : l'origine est le milieu des pieds au sol, x vers l'avant (le joueur regarde vers
 * +x), y vers le bas. Le rendu retourne l'axe x selon l'orientation du joueur.
 * Voir `docs/DIRECTION_ARTISTIQUE.md` §5 et §6.1.
 */

/** Indices des points du squelette. « L » = côté éloigné (dessiné derrière), « R » = côté proche. */
export const J = {
  HEAD: 0,
  NECK: 1,
  SHL: 2,
  SHR: 3,
  ELL: 4,
  ELR: 5,
  HNL: 6,
  HNR: 7,
  PEL: 8,
  KNL: 9,
  KNR: 10,
  FTL: 11,
  FTR: 12,
} as const;
export const JOINT_COUNT = 13;

/** Dimensions (unités de monde) : 4,4 + 1,0 + 7,4 + 11,6 = 28,8 = hauteur du corps debout. */
export const BODY = {
  headR: 4.4,
  thigh: 5.8,
  shin: 5.8,
  upper: 5.0,
  fore: 5.0,
  /** Facteur maximal d'allongement des bras et des jambes (style « tuyau de caoutchouc »). */
  maxStretch: 2.6,
} as const;

// Indices du vecteur de cibles de pose.
const T_HEAD = 0;
const T_NECK = 2;
const T_SHL = 4;
const T_SHR = 6;
const T_PEL = 8;
const T_HNL = 10;
const T_HNR = 12;
const T_FTL = 14;
const T_FTR = 16;
const T_LEAN = 18;
const T_TILT = 19;
const T_HOP = 20;
const T_SPIN = 21;
const T_WANG = 22;
const T_WHOLD = 23;
const T_JIT = 24;
const NT = 25;

/** Ce que le squelette lit de l'état d'un joueur à chaque image. */
export interface PoseInput {
  /** `PlayerState`. */
  state: number;
  /** Ticks dans l'état (attaque : dans la phase ; parade : depuis l'appui). */
  animProg: number;
  /** Attaque : `AttackKind` (bits 0 à 3) et `AtkPhase` (bits 4 et 5) ; charge : ticks de charge. */
  variant: number;
  vx: number;
  vy: number;
  grounded: boolean;
  crouching: boolean;
  /** Arme tenue (`WeaponId`) et sa famille (`WeaponKind`). */
  weapon: number;
  weaponKind: number;
  /** Visée dans le repère local : composante avant et composante vers le bas (norme 1). */
  aimX: number;
  aimY: number;
  /** Emote en cours : 0 aucune, 1 salut, 2 danse, 3 rire ; et secondes écoulées. */
  emote: number;
  emoteT: number;
  /** Emote de victoire en cours : 0 aucune, 1 poings levés, 2 saut périlleux, 3 salut, 4 danse. */
  victory: number;
  victoryT: number;
  /** Horloge en secondes et durée de l'image. */
  timeS: number;
  dtS: number;
  /** Décalage vertical du sol sous chaque pied (0 : au niveau ; > 0 : le sol est plus bas). */
  groundL: number;
  groundR: number;
  /** Vitesse de course de référence (pour la cadence de la course). */
  runSpeed: number;
}

export function createPoseInput(): PoseInput {
  return {
    state: PlayerState.IDLE,
    animProg: 0,
    variant: 0,
    vx: 0,
    vy: 0,
    grounded: true,
    crouching: false,
    weapon: 0,
    weaponKind: WeaponKind.FISTS,
    aimX: 1,
    aimY: 0,
    emote: 0,
    emoteT: 0,
    victory: 0,
    victoryT: 0,
    timeS: 0,
    dtS: 1 / 60,
    groundL: 0,
    groundR: 0,
    runSpeed: 190,
  };
}

/** Durée d'une phase d'attaque, en ticks (même table que `phaseTicks` de la simulation). */
export function attackPhaseTicks(
  kind: number,
  phase: number,
  weapon: number,
  w: WeaponTimes,
): number {
  switch (kind) {
    case AttackKind.FIST1:
    case AttackKind.FIST2:
    case AttackKind.FIST3: {
      const a = FIST[kind - AttackKind.FIST1];
      return phase === AtkPhase.STARTUP
        ? a.startup
        : phase === AtkPhase.ACTIVE
          ? a.active
          : a.recovery;
    }
    case AttackKind.CHARGED: {
      const c = COMBAT.charged;
      return phase === AtkPhase.STARTUP
        ? c.startup
        : phase === AtkPhase.ACTIVE
          ? c.active
          : c.recovery;
    }
    case AttackKind.UPPER:
    case AttackKind.CROUCH: {
      const a = kind === AttackKind.UPPER ? UPPER : CROUCH_PUNCH;
      return phase === AtkPhase.STARTUP
        ? a.startup
        : phase === AtkPhase.ACTIVE
          ? a.active
          : a.recovery;
    }
    case AttackKind.KICK:
      return phase === AtkPhase.RECOVERY ? COMBAT.kick.recovery : 0;
    case AttackKind.THROW:
      return phase === AtkPhase.STARTUP ? 3 : phase === AtkPhase.ACTIVE ? 1 : 8;
    default:
      return w(weapon, phase);
  }
}

/** Durée d'une phase pour une arme (fournie par l'appelant : `weaponDef`). */
export type WeaponTimes = (weapon: number, phase: number) => number;

/** Portée visuelle d'un coup à mains nues (allonge au-delà du corps). */
export function fistReach(kind: number): number {
  if (kind >= AttackKind.FIST1 && kind <= AttackKind.FIST3)
    return FIST[kind - AttackKind.FIST1].reach;
  if (kind === AttackKind.CHARGED) return COMBAT.charged.reach;
  if (kind === AttackKind.CROUCH) return CROUCH_PUNCH.reach;
  if (kind === AttackKind.UPPER) return UPPER.reach;
  return 20;
}

// --- Mathématiques ---------------------------------------------------------------------------

function ease(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Résultat de `ik2` : position du coude (ou genou) et du bout du membre. */
export interface Ik2 {
  jx: number;
  jy: number;
  ex: number;
  ey: number;
}

/**
 * Cinématique inverse à deux os : de la racine (rx, ry) vers la cible (tx, ty), os de longueurs
 * `a` puis `b`. Si la cible est trop loin, les os s'allongent (jusqu'à `maxStretch`), puis le
 * membre se tend. `px`, `py` : direction préférée du coude (le genou va vers l'avant).
 */
export function ik2(
  out: Ik2,
  rx: number,
  ry: number,
  tx: number,
  ty: number,
  a: number,
  b: number,
  px: number,
  py: number,
  maxStretch: number,
): void {
  const dx = tx - rx;
  const dy = ty - ry;
  let d = Math.sqrt(dx * dx + dy * dy);
  let aa = a;
  let bb = b;
  if (d > a + b) {
    const s = Math.min(maxStretch, d / (a + b));
    aa = a * s;
    bb = b * s;
  }
  const maxD = aa + bb - 1e-3;
  const minD = Math.abs(aa - bb) + 1e-3;
  if (d > maxD) d = maxD;
  if (d < minD) d = minD;
  const ux = dx === 0 && dy === 0 ? 1 : dx / Math.sqrt(dx * dx + dy * dy);
  const uy = dx === 0 && dy === 0 ? 0 : dy / Math.sqrt(dx * dx + dy * dy);
  const cosA = Math.max(-1, Math.min(1, (aa * aa + d * d - bb * bb) / (2 * aa * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // deux coudes possibles : rotation de ±A autour de la direction racine → cible
  const c1x = rx + (ux * cosA - uy * sinA) * aa;
  const c1y = ry + (uy * cosA + ux * sinA) * aa;
  const c2x = rx + (ux * cosA + uy * sinA) * aa;
  const c2y = ry + (uy * cosA - ux * sinA) * aa;
  const s1 = (c1x - rx) * px + (c1y - ry) * py;
  const s2 = (c2x - rx) * px + (c2y - ry) * py;
  if (s1 >= s2) {
    out.jx = c1x;
    out.jy = c1y;
  } else {
    out.jx = c2x;
    out.jy = c2y;
  }
  out.ex = rx + ux * d;
  out.ey = ry + uy * d;
}

const tmpIk: Ik2 = { jx: 0, jy: 0, ex: 0, ey: 0 };

/** Place le point `i` : la cible (x, y) tournée de `lean` autour du bassin de la pose, ramenée au bassin résolu. */
function rotate(
  j: Float32Array,
  i: number,
  x: number,
  y: number,
  base: Float32Array,
  pelX: number,
  pelY: number,
  cl: number,
  sl: number,
): void {
  const dx = x - base[T_PEL];
  const dy = y - base[T_PEL + 1];
  j[i * 2] = pelX + dx * cl - dy * sl;
  j[i * 2 + 1] = pelY + dx * sl + dy * cl;
}

// --- Poses -----------------------------------------------------------------------------------

function set(o: Float32Array, i: number, x: number, y: number): void {
  o[i] = x;
  o[i + 1] = y;
}

/** Posture debout de repos. */
function stand(o: Float32Array): void {
  set(o, T_HEAD, 0.5, -24.4);
  set(o, T_NECK, 0.2, -19.0);
  set(o, T_SHL, -1.4, -17.8);
  set(o, T_SHR, 1.6, -17.8);
  set(o, T_PEL, 0, -11.2);
  set(o, T_HNL, -1.8, -8.6);
  set(o, T_HNR, 2.6, -8.4);
  set(o, T_FTL, -3.2, 0);
  set(o, T_FTR, 3.0, 0);
  o[T_LEAN] = 0;
  o[T_TILT] = 0;
  o[T_HOP] = 0;
  o[T_SPIN] = 0;
  o[T_WANG] = 0;
  o[T_WHOLD] = 0;
  o[T_JIT] = 0;
}

/** Cadence de la course (cycles par seconde) selon la fraction de vitesse maximale. */
function runRate(f: number): number {
  return 2.2 + 3.4 * Math.min(1.3, f);
}

const WEAPON_REST_MELEE = -0.85;

/**
 * Le squelette d'un joueur : état de pose lissé, cycle de course et points résolus.
 * `update` ne fait aucune allocation.
 */
export class Rig {
  /** Points résolus dans le repère local : x, y de chacun des 13 points. */
  readonly joints = new Float32Array(JOINT_COUNT * 2);
  /** Arme : angle (0 vers l'avant, positif vers le bas), poignée, tenue ou non. */
  weaponAngle = 0;
  gripX = 0;
  gripY = 0;
  holding = false;
  /** Inclinaison de la tête (rad) et pas de course. */
  headTilt = 0;
  runPhase = 0;
  /** Saut en hauteur (unités) du saut périlleux et des danses : les pieds quittent le sol. */
  hop = 0;
  private readonly base = new Float32Array(NT);
  private readonly raw = new Float32Array(NT);
  private runW = 0;
  private ready = false;

  /** Remet la pose à zéro (changement de manche). */
  reset(): void {
    this.ready = false;
    this.runPhase = 0;
    this.runW = 0;
  }

  update(p: PoseInput, times: WeaponTimes): void {
    const raw = this.raw;
    stand(raw);
    const f = Math.min(1.3, Math.abs(p.vx) / p.runSpeed);
    let snappy = false;
    let runTarget = 0;
    const kind = p.variant & 15;
    const phase = (p.variant >> 4) & 3;

    const armed = p.weapon !== 0;
    const gun =
      p.weaponKind === WeaponKind.HITSCAN ||
      p.weaponKind === WeaponKind.PROJECTILE ||
      p.weaponKind === WeaponKind.GRAPPLE;
    const melee = p.weaponKind === WeaponKind.MELEE || p.weaponKind === WeaponKind.SHIELD;
    let hold = 0; // 1 : une main tient l'arme, 2 : les deux mains
    let weaponAng = 0;
    if (armed) {
      hold = p.weaponKind === WeaponKind.CRATE || p.weaponKind === WeaponKind.MINE ? 3 : 2;
      weaponAng = gun ? Math.atan2(p.aimY, p.aimX) : melee ? WEAPON_REST_MELEE : 0.3;
      if (p.weaponKind === WeaponKind.SHIELD) weaponAng = 0;
    }

    switch (p.state) {
      case PlayerState.RUN:
        runTarget = 1;
        raw[T_LEAN] = 0.1 + 0.16 * f;
        set(raw, T_PEL, 0, -10.4);
        set(raw, T_HNL, -1.5, -11.5);
        set(raw, T_HNR, 2.4, -11.8);
        break;
      case PlayerState.JUMP:
        raw[T_LEAN] = 0.08;
        set(raw, T_PEL, 0, -11.4);
        set(raw, T_FTL, -2.0, -3.0);
        set(raw, T_FTR, 3.8, -6.2);
        set(raw, T_HNR, 4.2, -23.0);
        set(raw, T_HNL, -3.0, -21.0);
        raw[T_TILT] = -0.12;
        break;
      case PlayerState.FALL:
        raw[T_LEAN] = -0.05;
        set(raw, T_PEL, 0, -11.6);
        set(raw, T_FTL, -4.5, -1.5);
        set(raw, T_FTR, 4.8, -2.2);
        set(raw, T_HNR, 8.5, -18.0);
        set(raw, T_HNL, -6.8, -17.0);
        raw[T_TILT] = 0.1;
        break;
      case PlayerState.WALL_SLIDE:
        raw[T_LEAN] = 0.12;
        set(raw, T_PEL, 0.4, -11.0);
        set(raw, T_FTL, 1.8, -0.5);
        set(raw, T_FTR, 3.6, -1.5);
        set(raw, T_HNR, 7.6, -26.0);
        set(raw, T_HNL, 7.0, -22.0);
        set(raw, T_HEAD, -0.6, -24.4);
        break;
      case PlayerState.CROUCH:
        set(raw, T_PEL, -1.0, -5.6);
        set(raw, T_HEAD, 3.0, -13.4);
        set(raw, T_NECK, 1.6, -8.7);
        set(raw, T_SHL, 0.4, -8.2);
        set(raw, T_SHR, 3.0, -8.0);
        set(raw, T_FTL, -4.0, 0);
        set(raw, T_FTR, 4.5, 0);
        set(raw, T_HNL, 5.0, -4.5);
        set(raw, T_HNR, 7.6, -5.2);
        runTarget = 0.35 * Math.min(1, f * 2.5);
        break;
      case PlayerState.DASH:
        // Penché en avant, bras tirés en arrière, jambes tendues : une flèche.
        raw[T_LEAN] = 0.32;
        set(raw, T_PEL, 1.0, -9.6);
        set(raw, T_FTL, -6.5, -1.5);
        set(raw, T_FTR, 6.0, -3.0);
        set(raw, T_HNR, -7.0, -17.0);
        set(raw, T_HNL, -5.0, -15.0);
        raw[T_TILT] = 0.2;
        break;
      case PlayerState.CHARGE: {
        const k = clamp01(p.variant / COMBAT.chargeMaxTicks);
        raw[T_LEAN] = 0.2 + 0.1 * k;
        set(raw, T_PEL, -1.0, -8.8);
        set(raw, T_FTL, -4.5, 0);
        set(raw, T_FTR, 4.5, 0);
        set(raw, T_HNR, -5.5, -15.5);
        set(raw, T_HNL, 2.0, -16.0);
        raw[T_JIT] = 0.3 + 1.1 * k;
        break;
      }
      case PlayerState.BLOCK:
        raw[T_LEAN] = -0.06;
        set(raw, T_PEL, 0, -10.6);
        set(raw, T_FTL, -4.2, 0);
        set(raw, T_FTR, 4.8, 0);
        set(raw, T_HNR, 5.2, -24.0);
        set(raw, T_HNL, 4.0, -17.8);
        break;
      case PlayerState.STUN:
        raw[T_LEAN] = 0.2;
        set(raw, T_PEL, 0, -10.8);
        set(raw, T_HEAD, 3.4, -22.4);
        set(raw, T_NECK, 1.6, -18.2);
        set(raw, T_FTL, -1.8, 0);
        set(raw, T_FTR, 2.0, 0);
        set(raw, T_HNR, 3.0 + Math.sin(p.timeS * 6) * 1.6, -5.5);
        set(raw, T_HNL, 0.0 - Math.sin(p.timeS * 6) * 1.6, -5.5);
        raw[T_TILT] = 0.5;
        break;
      case PlayerState.ATTACK:
        snappy = true;
        this.attackPose(raw, p, kind, phase, times);
        if (kind !== AttackKind.SHOOT && kind !== AttackKind.THROW) {
          // les armes de mêlée suivent le geste
          if (armed && (kind === AttackKind.WEAPON || kind === AttackKind.BASH)) hold = 2;
        }
        weaponAng = this.weaponAngle;
        break;
      default: {
        // repos : respiration
        const b = Math.sin(p.timeS * 2.4) * 0.35;
        raw[T_HEAD + 1] += b;
        raw[T_NECK + 1] += b * 0.6;
        raw[T_SHL + 1] += b * 0.5;
        raw[T_SHR + 1] += b * 0.5;
        raw[T_HNL] += Math.sin(p.timeS * 1.9) * 0.3;
        raw[T_HNR] += Math.sin(p.timeS * 1.9 + 1) * 0.3;
        if (p.crouching) {
          set(raw, T_PEL, -1.0, -5.6);
          set(raw, T_HEAD, 3.0, -13.4);
          set(raw, T_NECK, 1.6, -8.7);
        }
      }
    }

    // Emotes (seulement quand rien d'autre ne se passe)
    const calm = p.state === PlayerState.IDLE || p.state === PlayerState.CROUCH;
    if (p.victory > 0) this.victoryPose(raw, p);
    else if (p.emote > 0 && calm) this.emotePose(raw, p);

    // Mélange (exponentiel) vers la pose cible : 80 à 120 ms, plus sec pendant un coup.
    const tau = snappy ? 0.018 : 0.04;
    const k = this.ready ? 1 - Math.exp(-p.dtS / tau) : 1;
    const base = this.base;
    for (let i = 0; i < NT; i++) base[i] += (raw[i] - base[i]) * k;
    this.ready = true;
    this.runW += (runTarget - this.runW) * (1 - Math.exp(-p.dtS / 0.06));
    this.runPhase += p.dtS * Math.PI * 2 * runRate(f) * (runTarget > 0 ? 1 : 0);

    this.solve(p, hold, weaponAng);
  }

  private attackPose(
    o: Float32Array,
    p: PoseInput,
    kind: number,
    phase: number,
    times: WeaponTimes,
  ): void {
    const dur = attackPhaseTicks(kind, phase, p.weapon, times);
    const t = dur > 0 ? clamp01(p.animProg / dur) : 1;
    const reach = fistReach(kind);
    this.weaponAngle = 0;
    switch (kind) {
      case AttackKind.FIST1: {
        const k =
          phase === AtkPhase.STARTUP
            ? 0
            : phase === AtkPhase.ACTIVE
              ? 0.3 + 0.7 * ease(t)
              : 1 - ease(t);
        const pull = phase === AtkPhase.STARTUP ? 1 : 0;
        set(o, T_HNR, lerp(1.2, 6.4 + reach * 0.85, k), -17.4 + pull * 0.6);
        set(o, T_HNL, 2.0, -16.0);
        o[T_LEAN] = 0.1 + 0.12 * k;
        break;
      }
      case AttackKind.FIST2: {
        const k =
          phase === AtkPhase.STARTUP
            ? 0
            : phase === AtkPhase.ACTIVE
              ? 0.3 + 0.7 * ease(t)
              : 1 - ease(t);
        set(o, T_HNL, lerp(1.0, 6.4 + reach * 0.85, k), -17.8);
        set(o, T_HNR, 2.4, -16.2);
        set(o, T_SHL, lerp(-1.4, 2.8, k), -17.8);
        set(o, T_SHR, lerp(1.6, -1.2, k), -17.8);
        o[T_LEAN] = 0.14 + 0.1 * k;
        break;
      }
      case AttackKind.FIST3:
      case AttackKind.CHARGED: {
        const big = kind === AttackKind.CHARGED;
        if (phase === AtkPhase.STARTUP) {
          set(o, T_PEL, -1.0, -9.4);
          set(o, T_HNR, lerp(2, -5.0, ease(t)), lerp(-14, -9.5, ease(t)));
          set(o, T_HNL, 1.4, -13.5);
          o[T_LEAN] = -0.18;
          set(o, T_FTL, -4.5, 0);
          set(o, T_FTR, 4.5, 0);
        } else if (phase === AtkPhase.ACTIVE) {
          const e = ease(t);
          set(o, T_PEL, 1.0, -10.6);
          set(o, T_HNR, lerp(-2, 6.4 + reach * 0.8, e), lerp(-10, big ? -15 : -23.5, e));
          set(o, T_HNL, 0.5, -14.5);
          o[T_LEAN] = big ? 0.55 : 0.42;
          set(o, T_FTL, -5.5, -1.5);
          set(o, T_FTR, 5.0, 0);
        } else {
          const e = 1 - ease(t);
          set(o, T_PEL, 0.5, -10.0 + (big ? 0.8 : 0));
          set(o, T_HNR, lerp(3.0, 6.4 + reach * 0.5, e), lerp(-10, big ? -13 : -19, e));
          set(o, T_HNL, 0.0, -11.0);
          o[T_LEAN] = (big ? 0.5 : 0.3) * e + 0.12;
        }
        break;
      }
      case AttackKind.CROUCH: {
        // accroupi, le poing part du sol vers l'avant et monte (long bras, projette vers le haut)
        const k =
          phase === AtkPhase.STARTUP
            ? 0
            : phase === AtkPhase.ACTIVE
              ? 0.3 + 0.7 * ease(t)
              : 1 - ease(t);
        set(o, T_PEL, -1.0, -5.6);
        set(o, T_HEAD, 3.0, -13.4);
        set(o, T_NECK, 1.6, -8.7);
        set(o, T_SHL, 0.4, -8.2);
        set(o, T_SHR, 3.0, -8.0);
        set(o, T_FTL, -4.0, 0);
        set(o, T_FTR, 4.5, 0);
        set(o, T_HNR, lerp(0.6, 6.4 + reach * 0.85, k), lerp(-2.0, -10.5, k));
        set(o, T_HNL, 5.0, -4.5);
        o[T_LEAN] = 0.1 + 0.12 * k;
        break;
      }
      case AttackKind.UPPER: {
        // coup vers le haut : le poing monte au-dessus de la tête, le corps se cambre
        const k =
          phase === AtkPhase.STARTUP
            ? 0
            : phase === AtkPhase.ACTIVE
              ? 0.3 + 0.7 * ease(t)
              : 1 - ease(t);
        set(o, T_PEL, 0.2, -10.6 - 0.8 * k);
        set(o, T_HNR, lerp(2.4, 4.6, k), lerp(-12.0, -35.0, k));
        set(o, T_HNL, 1.0, -13.5);
        set(o, T_FTL, -4.4, 0);
        set(o, T_FTR, 4.6, 0);
        o[T_LEAN] = -0.1 - 0.12 * k;
        break;
      }
      case AttackKind.KICK:
        set(o, T_PEL, -1.0, -13.0);
        set(o, T_FTR, 9.0, 2.5);
        set(o, T_FTL, -1.5, -7.0);
        set(o, T_HNR, -5.0, -20.5);
        set(o, T_HNL, -6.5, -17.0);
        o[T_LEAN] = 0.5;
        break;
      case AttackKind.SHOOT: {
        // bras tendus dans la direction de visée, recul qui se résorbe
        const recoil = phase === AtkPhase.RECOVERY ? (1 - t) * 2.2 : 2.2;
        set(o, T_PEL, -recoil * 0.4, -11.0);
        o[T_LEAN] = -0.06 * recoil;
        this.weaponAngle = Math.atan2(p.aimY, p.aimX);
        set(o, T_FTL, -4.0, 0);
        set(o, T_FTR, 4.4, 0);
        break;
      }
      case AttackKind.THROW: {
        const k = phase === AtkPhase.STARTUP ? ease(t) : 1;
        if (phase === AtkPhase.STARTUP) {
          set(o, T_HNR, lerp(2.6, -5.5, k), lerp(-8.4, -24.0, k));
          o[T_LEAN] = -0.25 * k;
        } else {
          const e = phase === AtkPhase.ACTIVE ? ease(t) : 1;
          set(o, T_HNR, lerp(-5.5, 12.5, e), lerp(-24, -17, e));
          o[T_LEAN] = lerp(-0.25, 0.35, e);
        }
        set(o, T_HNL, 1.6, -13.0);
        break;
      }
      case AttackKind.BASH: {
        const e =
          phase === AtkPhase.ACTIVE ? ease(t) : phase === AtkPhase.STARTUP ? 0 : 1 - ease(t);
        o[T_LEAN] = 0.1 + 0.3 * e;
        set(o, T_PEL, e * 1.5, -10.8);
        this.weaponAngle = 0;
        break;
      }
      default: {
        // arme de mêlée : on lève, on balaie, on relâche
        let ang: number;
        if (phase === AtkPhase.STARTUP) ang = lerp(WEAPON_REST_MELEE, -2.3, ease(t));
        else if (phase === AtkPhase.ACTIVE) ang = lerp(-2.3, 0.55, ease(t));
        else ang = lerp(0.55, WEAPON_REST_MELEE, ease(t));
        this.weaponAngle = ang;
        o[T_LEAN] = phase === AtkPhase.ACTIVE ? 0.32 : phase === AtkPhase.STARTUP ? -0.12 : 0.16;
        set(o, T_FTL, -4.4, 0);
        set(o, T_FTR, 4.6, 0);
      }
    }
  }

  private emotePose(o: Float32Array, p: PoseInput): void {
    const t = p.emoteT;
    if (p.emote === 1) {
      // salut : la main proche en l'air, qui s'agite
      set(o, T_HNR, 5.0 + Math.sin(t * 11) * 2.6, -27.0);
      o[T_TILT] = -0.12;
    } else if (p.emote === 2) {
      this.dance(o, t);
    } else if (p.emote === 3) {
      // rire : épaules qui sautent, tête en arrière, main sur le ventre
      o[T_JIT] = 1.0;
      o[T_TILT] = -0.3;
      o[T_LEAN] = -0.1;
      set(o, T_HNR, 2.4, -12.0);
      set(o, T_HNL, -0.6, -13.0);
      o[T_HEAD + 1] += Math.abs(Math.sin(t * 13)) * -0.9;
    }
  }

  private dance(o: Float32Array, t: number): void {
    const s = Math.sin(t * 7);
    const c = Math.cos(t * 7);
    o[T_PEL] += s * 2.0;
    o[T_HEAD] += s * 1.4;
    set(o, T_HNR, 4.0 + c * 2.0, s > 0 ? -26.0 : -12.0);
    set(o, T_HNL, -3.0 - c * 2.0, s > 0 ? -12.0 : -26.0);
    o[T_FTL + 1] -= Math.max(0, s) * 2.2;
    o[T_FTR + 1] -= Math.max(0, -s) * 2.2;
    o[T_TILT] = s * 0.16;
  }

  private victoryPose(o: Float32Array, p: PoseInput): void {
    const t = p.victoryT;
    switch (p.victory) {
      case 1: {
        // poings levés, petits sauts
        const hop = Math.abs(Math.sin(t * 7.5)) * 3.6;
        o[T_HOP] = hop;
        set(o, T_HNR, 4.0, -29.0);
        set(o, T_HNL, -2.0, -29.0);
        o[T_LEAN] = -0.08;
        o[T_TILT] = -0.15;
        break;
      }
      case 2: {
        // saut périlleux en boucle (1,4 s), pause entre deux
        const c = (t % 1.9) / 0.85;
        const k = clamp01(c);
        o[T_HOP] = Math.sin(Math.PI * k) * 15;
        o[T_SPIN] = -ease(k) * Math.PI * 2;
        if (k > 0.05 && k < 0.95) {
          set(o, T_FTL, -1.5, -5.0);
          set(o, T_FTR, 1.5, -5.5);
          set(o, T_HNR, 2.5, -12);
          set(o, T_HNL, 0.5, -11);
        } else {
          set(o, T_HNR, 4.0, -28.0);
          set(o, T_HNL, -2.0, -28.0);
        }
        break;
      }
      case 3: {
        // salut : on s'incline, on tient, on se redresse
        const c = t % 2.2;
        const k = c < 0.4 ? ease(c / 0.4) : c < 1.3 ? 1 : 1 - ease((c - 1.3) / 0.5);
        o[T_LEAN] = 1.0 * clamp01(k);
        o[T_HEAD + 1] += k * 0.5;
        set(o, T_HNR, lerp(2.6, 5.0, k), lerp(-8.4, -12, k));
        break;
      }
      default:
        this.dance(o, t);
    }
  }

  /** Résout la pose : lean, cycle de course, IK des pieds et des mains. */
  private solve(p: PoseInput, hold: number, weaponAng: number): void {
    const b = this.base;
    const j = this.joints;
    // 1. Copie des cibles (avec le cycle de course)
    const pelX = b[T_PEL];
    let pelY = b[T_PEL + 1];
    let flX = b[T_FTL];
    let flY = b[T_FTL + 1];
    let frX = b[T_FTR];
    let frY = b[T_FTR + 1];
    let hlX = b[T_HNL];
    let hlY = b[T_HNL + 1];
    let hrX = b[T_HNR];
    let hrY = b[T_HNR + 1];
    const rw = this.runW;
    if (rw > 0.01) {
      const s = Math.sin(this.runPhase);
      const c = Math.cos(this.runPhase);
      const stride = 6.0 * rw;
      const lift = 3.4 * rw;
      frX += s * stride;
      frY -= Math.max(0, c) * lift;
      flX -= s * stride;
      flY -= Math.max(0, -c) * lift;
      hrX -= s * 5.0 * rw;
      hrY += c * 1.4 * rw;
      hlX += s * 5.0 * rw;
      hlY -= c * 1.4 * rw;
      pelY += -Math.abs(Math.sin(this.runPhase * 2)) * 0.7 * rw;
    }
    // sol sous chaque pied
    flY += p.groundL;
    frY += p.groundR;
    // saut périlleux et danses : les pieds quittent le sol
    const hop = b[T_HOP];
    this.hop = hop;
    pelY -= hop;
    flY -= hop;
    frY -= hop;

    // 2. Haut du corps : rotation (lean) autour du bassin, tremblement de charge/rire
    const lean = b[T_LEAN];
    const cl = Math.cos(lean);
    const sl = Math.sin(lean);
    const jit = b[T_JIT];
    const jx = jit > 0 ? Math.sin(p.timeS * 61) * jit * 0.5 : 0;
    const jy = jit > 0 ? Math.cos(p.timeS * 53) * jit * 0.5 : 0;
    rotate(j, J.HEAD, b[T_HEAD], b[T_HEAD + 1], b, pelX, pelY, cl, sl);
    j[J.HEAD * 2] += jx;
    j[J.HEAD * 2 + 1] += jy;
    rotate(j, J.NECK, b[T_NECK], b[T_NECK + 1], b, pelX, pelY, cl, sl);
    rotate(j, J.SHL, b[T_SHL], b[T_SHL + 1], b, pelX, pelY, cl, sl);
    rotate(j, J.SHR, b[T_SHR], b[T_SHR + 1], b, pelX, pelY, cl, sl);
    j[J.PEL * 2] = pelX;
    j[J.PEL * 2 + 1] = pelY;

    // 3. Mains : on les pose sur l'arme quand on en tient une
    this.holding = hold > 0;
    if (hold > 0) {
      const dx = Math.cos(weaponAng);
      const dy = Math.sin(weaponAng);
      let gx: number;
      let gy: number;
      if (hold === 3) {
        // caisse ou mine portée contre le torse
        gx = j[J.SHR * 2] + 5.0;
        gy = j[J.SHR * 2 + 1] + 4.5;
        hrX = gx;
        hrY = gy;
        hlX = gx - 3.0;
        hlY = gy + 0.5;
        this.weaponAngle = 0;
      } else {
        const ext = this.weaponExtension(p);
        gx = j[J.SHR * 2] + dx * ext;
        gy = j[J.SHR * 2 + 1] + dy * ext;
        hrX = gx;
        hrY = gy;
        hlX = gx - dx * 3.4;
        hlY = gy - dy * 3.4;
        this.weaponAngle = weaponAng;
      }
      this.gripX = gx;
      this.gripY = gy;
    }

    // 4. IK : pieds (genou vers l'avant), mains (coude vers le bas et l'arrière)
    ik2(tmpIk, pelX, pelY, flX, flY, BODY.thigh, BODY.shin, 1, 0.1, 1.5);
    j[J.KNL * 2] = tmpIk.jx;
    j[J.KNL * 2 + 1] = tmpIk.jy;
    j[J.FTL * 2] = tmpIk.ex;
    j[J.FTL * 2 + 1] = tmpIk.ey;
    ik2(tmpIk, pelX, pelY, frX, frY, BODY.thigh, BODY.shin, 1, 0.1, 1.5);
    j[J.KNR * 2] = tmpIk.jx;
    j[J.KNR * 2 + 1] = tmpIk.jy;
    j[J.FTR * 2] = tmpIk.ex;
    j[J.FTR * 2 + 1] = tmpIk.ey;
    ik2(
      tmpIk,
      j[J.SHL * 2],
      j[J.SHL * 2 + 1],
      hlX,
      hlY,
      BODY.upper,
      BODY.fore,
      -0.35,
      1,
      BODY.maxStretch,
    );
    j[J.ELL * 2] = tmpIk.jx;
    j[J.ELL * 2 + 1] = tmpIk.jy;
    j[J.HNL * 2] = tmpIk.ex;
    j[J.HNL * 2 + 1] = tmpIk.ey;
    ik2(
      tmpIk,
      j[J.SHR * 2],
      j[J.SHR * 2 + 1],
      hrX,
      hrY,
      BODY.upper,
      BODY.fore,
      -0.35,
      1,
      BODY.maxStretch,
    );
    j[J.ELR * 2] = tmpIk.jx;
    j[J.ELR * 2 + 1] = tmpIk.jy;
    j[J.HNR * 2] = tmpIk.ex;
    j[J.HNR * 2 + 1] = tmpIk.ey;

    // 5. Rotation globale (saut périlleux) autour du centre du corps
    const spin = b[T_SPIN];
    if (spin !== 0) {
      const cx = pelX;
      const cy = pelY - 4;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      for (let i = 0; i < JOINT_COUNT; i++) {
        const x = j[i * 2] - cx;
        const y = j[i * 2 + 1] - cy;
        j[i * 2] = cx + x * cs - y * sn;
        j[i * 2 + 1] = cy + x * sn + y * cs;
      }
    }
    this.headTilt = b[T_TILT] + spin;
  }

  /** Distance épaule → poignée : bras presque tendus pour une arme à feu, repliés au repos. */
  private weaponExtension(p: PoseInput): number {
    if (p.state === PlayerState.ATTACK) {
      const kind = p.variant & 15;
      if (kind === AttackKind.SHOOT) return 8.2;
      if (kind === AttackKind.WEAPON) return 6.0;
    }
    const gun =
      p.weaponKind === WeaponKind.HITSCAN ||
      p.weaponKind === WeaponKind.PROJECTILE ||
      p.weaponKind === WeaponKind.GRAPPLE;
    return gun ? 7.2 : 5.0;
  }
}
