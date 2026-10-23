import { ObjType } from './types.ts';

/**
 * Les 22 armes du jeu, dans un seul fichier de données (analyse §1.3). La logique de la simulation
 * ne contient aucun chiffre d'arme : elle lit ce tableau. Identifiant 0 = mains nues.
 */

export const WeaponKind = {
  FISTS: 0,
  MELEE: 1,
  HITSCAN: 2,
  PROJECTILE: 3,
  MINE: 4,
  SHIELD: 5,
  GRAPPLE: 6,
  /** Caisse portée : ne sert qu'à être lancée. */
  CRATE: 7,
  /** Arc : on maintient pour bander, on relâche pour tirer. */
  BOW: 8,
  /** Pose un objet devant soi (scotch, couverture). */
  TRAP: 9,
  /** Soin : un long geste, interrompu si l'on est touché. */
  HEAL: 10,
} as const;
export type WeaponKindId = (typeof WeaponKind)[keyof typeof WeaponKind];

export const WeaponId = {
  NONE: 0,
  RULER: 1,
  COMPASS: 2,
  STAMP_HAMMER: 3,
  PISTOL: 4,
  SHOTGUN: 5,
  BLOWGUN: 6,
  PLANE_LAUNCHER: 7,
  BAZOOKA: 8,
  ERASER: 9,
  GRAPPLE: 10,
  INK_MINE: 11,
  SHARPENER_SHIELD: 12,
  CRATE: 13,
  BOW: 14,
  STAPLER: 15,
  GLUE_GUN: 16,
  INK_GRENADE: 17,
  BOOMERANG: 18,
  SCISSORS: 19,
  HIGHLIGHTER: 20,
  TAPE: 21,
  COVER: 22,
  MEDKIT: 23,
} as const;
export type WeaponIdValue = (typeof WeaponId)[keyof typeof WeaponId];

export interface Explosion {
  /** Rayon en unités. */
  radius: number;
  damage: number;
  /** Projection au centre (décroît linéairement jusqu'au bord). */
  kb: number;
  /** Détruit les blocs de papier dans le rayon. */
  destroys: boolean;
  /** Laisse une flaque d'encre glissante au sol. */
  puddle: boolean;
}

export interface WeaponDef {
  id: number;
  key: string;
  name: { fr: string; en: string };
  kind: WeaponKindId;
  /** Munitions (ou solidité pour la mêlée et le bouclier). */
  ammo: number;
  /** Délais d'une utilisation (ticks). */
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  kbx: number;
  kby: number;
  stun: number;
  /** Distance (unités) de la poignée au bout du canon ou de la lame : c'est là que le tir part. */
  tip: number;
  /** Arc et mêlée : durée de charge maximale (ticks, 0 = non chargeable) ; dégâts jusqu'à ×(1 + chargeBonus). */
  chargeMax: number;
  chargeBonus: number;
  /** Projectile à éclats : fraction des dégâts conservée en fin de course (1 = aucune perte). */
  falloff: number;
  /** TRAP : type d'objet posé (`ObjType`). */
  trap: number;
  /** HEAL : points de vie rendus. */
  heal: number;
  /** Colle : durée du ralentissement (ticks). */
  statusTicks: number;
  /** Tir instantané : touche sans repousser ni interrompre (dégâts sur la durée). */
  light: boolean;
  /** Mêlée : libère un joueur accroché par un grappin et coupe les crochets en vol. */
  cuts: boolean;
  /** Mêlée : allonge au-delà du corps. Tir instantané : portée maximale. Grappin : portée. */
  reach: number;
  /** Mêlée : demi-hauteur de la zone de frappe (unités) ; 0 = toute la hauteur du corps. */
  halfHeight: number;
  /** Mêlée : traverse la parade normale. */
  pierceBlock: boolean;
  /** Mêlée : laisse un tampon d'encre au sol. */
  stamp: boolean;
  /** Tir : nombre de plombs / dispersion totale (radians) / recul du tireur (unités/s). */
  pellets: number;
  spread: number;
  recoil: number;
  /** Projectile (type `ProjType`), vitesse, gravité, durée de vie, rebonds, restitution, guidage. */
  proj: number;
  speed: number;
  gravity: number;
  life: number;
  bounces: number;
  restitution: number;
  homing: number;
  /** Rayon de déclenchement d'une mine. */
  triggerRadius: number;
  armTicks: number;
  explosion: Explosion | null;
  /** Bouclier : multiplicateur de vitesse de déplacement. */
  slowMul: number;
  /** Grappin : vitesse de traction et durée maximale (ticks). */
  pullSpeed: number;
  pullTicks: number;
  /** Probabilité relative d'apparition. */
  weight: number;
}

const BASE: WeaponDef = {
  id: 0,
  key: 'fists',
  name: { fr: 'Poings', en: 'Fists' },
  kind: WeaponKind.FISTS,
  ammo: 0,
  startup: 0,
  active: 0,
  recovery: 0,
  damage: 0,
  kbx: 0,
  kby: 0,
  stun: 0,
  tip: 0,
  chargeMax: 0,
  chargeBonus: 0,
  falloff: 1,
  trap: 0,
  heal: 0,
  statusTicks: 0,
  light: false,
  cuts: false,
  reach: 0,
  halfHeight: 0,
  pierceBlock: false,
  stamp: false,
  pellets: 1,
  spread: 0,
  recoil: 0,
  proj: 0,
  speed: 0,
  gravity: 0,
  life: 0,
  bounces: 0,
  restitution: 0,
  homing: 0,
  triggerRadius: 0,
  armTicks: 0,
  explosion: null,
  slowMul: 1,
  pullSpeed: 0,
  pullTicks: 0,
  weight: 1,
};

function def(p: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'key' | 'name' | 'kind'>): WeaponDef {
  return { ...BASE, ...p };
}

export const WEAPONS: readonly WeaponDef[] = [
  def({
    id: WeaponId.NONE,
    key: 'fists',
    name: { fr: 'Poings', en: 'Fists' },
    kind: WeaponKind.FISTS,
    weight: 0,
  }),
  def({
    id: WeaponId.RULER,
    key: 'ruler',
    name: { fr: 'Règle', en: 'Ruler' },
    kind: WeaponKind.MELEE,
    ammo: 24,
    startup: 3,
    active: 3,
    recovery: 8,
    damage: 9,
    kbx: 170,
    kby: -110,
    reach: 34,
    tip: 31,
    chargeMax: 34,
    chargeBonus: 0.9,
  }),
  def({
    id: WeaponId.COMPASS,
    key: 'compass',
    name: { fr: 'Compas', en: 'Compass' },
    kind: WeaponKind.MELEE,
    ammo: 14,
    startup: 5,
    active: 3,
    recovery: 14,
    damage: 15,
    kbx: 120,
    kby: -60,
    reach: 30,
    halfHeight: 7,
    pierceBlock: true,
    tip: 28,
    chargeMax: 38,
    chargeBonus: 0.8,
  }),
  def({
    id: WeaponId.STAMP_HAMMER,
    key: 'stamp-hammer',
    name: { fr: 'Marteau-tampon', en: 'Stamp hammer' },
    kind: WeaponKind.MELEE,
    ammo: 6,
    startup: 18,
    active: 4,
    recovery: 22,
    damage: 28,
    kbx: 520,
    kby: -380,
    stun: 36,
    reach: 28,
    stamp: true,
    tip: 28,
    chargeMax: 46,
    chargeBonus: 0.6,
    weight: 0.8,
  }),
  def({
    id: WeaponId.PISTOL,
    key: 'pistol',
    name: { fr: 'Pistolet griffonné', en: 'Scribbled pistol' },
    kind: WeaponKind.HITSCAN,
    ammo: 8,
    startup: 2,
    active: 1,
    recovery: 11,
    damage: 11,
    kbx: 150,
    kby: -60,
    reach: 520,
    recoil: 30,
    tip: 18,
  }),
  def({
    id: WeaponId.SHOTGUN,
    key: 'shotgun',
    name: { fr: 'Fusil à pompe gribouillé', en: 'Scribbled shotgun' },
    kind: WeaponKind.PROJECTILE,
    ammo: 4,
    startup: 3,
    active: 1,
    recovery: 34,
    damage: 5,
    kbx: 100,
    kby: -50,
    // Neuf éclats de mine de crayon, éventail large ; ils perdent de leur force avec la distance.
    proj: 6,
    pellets: 9,
    spread: 0.46,
    speed: 780,
    life: 15,
    falloff: 0.35,
    recoil: 260,
    tip: 27,
  }),
  def({
    id: WeaponId.BLOWGUN,
    key: 'blowgun',
    name: { fr: 'Sarbacane à boulettes', en: 'Pellet blowgun' },
    kind: WeaponKind.PROJECTILE,
    ammo: 14,
    startup: 2,
    active: 1,
    recovery: 7,
    damage: 6,
    kbx: 90,
    kby: -50,
    proj: 1,
    speed: 430,
    gravity: 300,
    life: 120,
    bounces: 3,
    restitution: 0.75,
    tip: 34,
  }),
  def({
    id: WeaponId.PLANE_LAUNCHER,
    key: 'plane-launcher',
    name: { fr: 'Lance-avions en papier', en: 'Paper plane launcher' },
    kind: WeaponKind.PROJECTILE,
    ammo: 5,
    startup: 4,
    active: 1,
    recovery: 31,
    damage: 15,
    kbx: 200,
    kby: -120,
    proj: 2,
    speed: 170,
    life: 240,
    homing: 1.6,
    tip: 24,
  }),
  def({
    id: WeaponId.BAZOOKA,
    key: 'bazooka',
    name: { fr: 'Bazooka à encre', en: 'Ink bazooka' },
    kind: WeaponKind.PROJECTILE,
    ammo: 3,
    startup: 8,
    active: 1,
    recovery: 41,
    proj: 3,
    speed: 320,
    gravity: 80,
    life: 180,
    recoil: 120,
    explosion: { radius: 56, damage: 32, kb: 460, destroys: true, puddle: true },
    tip: 27,
    weight: 0.7,
  }),
  def({
    id: WeaponId.ERASER,
    key: 'eraser',
    name: { fr: 'Gomme', en: 'Eraser' },
    kind: WeaponKind.PROJECTILE,
    ammo: 4,
    startup: 4,
    active: 1,
    recovery: 19,
    damage: 8,
    kbx: 160,
    kby: -90,
    proj: 4,
    speed: 300,
    gravity: 600,
    life: 200,
    bounces: 6,
    restitution: 0.8,
    tip: 8,
  }),
  def({
    id: WeaponId.GRAPPLE,
    key: 'paperclip-grapple',
    name: { fr: 'Trombone-grappin', en: 'Paperclip grapple' },
    kind: WeaponKind.GRAPPLE,
    ammo: 3,
    startup: 4,
    active: 1,
    recovery: 20,
    damage: 4,
    kbx: 60,
    kby: -40,
    // Portée infinie : le crochet vole jusqu'à ce qu'il touche quelque chose (ou quitte l'arène).
    reach: 4000,
    speed: 1100,
    life: 110,
    pullSpeed: 520,
    pullTicks: 120,
    tip: 22,
  }),
  def({
    id: WeaponId.INK_MINE,
    key: 'ink-mine',
    name: { fr: 'Tache d’encre (mine)', en: 'Ink blot (mine)' },
    kind: WeaponKind.MINE,
    ammo: 2,
    startup: 6,
    active: 1,
    recovery: 23,
    armTicks: 60,
    triggerRadius: 14,
    explosion: { radius: 40, damage: 30, kb: 380, destroys: false, puddle: false },
    tip: 10,
  }),
  def({
    id: WeaponId.SHARPENER_SHIELD,
    key: 'sharpener-shield',
    name: { fr: 'Taille-crayon (bouclier)', en: 'Sharpener (shield)' },
    kind: WeaponKind.SHIELD,
    ammo: 6,
    startup: 4,
    active: 3,
    recovery: 23,
    damage: 5,
    kbx: 220,
    kby: -80,
    reach: 16,
    slowMul: 0.75,
  }),
  def({
    id: WeaponId.CRATE,
    key: 'crate',
    name: { fr: 'Caisse', en: 'Crate' },
    kind: WeaponKind.CRATE,
    ammo: 1,
    weight: 0,
  }),
  def({
    id: WeaponId.BOW,
    key: 'clip-bow',
    name: { fr: 'Arc à trombones', en: 'Paperclip bow' },
    kind: WeaponKind.BOW,
    ammo: 6,
    startup: 8,
    active: 1,
    recovery: 14,
    // Dégâts, vitesse et projection croissent avec la tension de la corde (jusqu'à ×(1 + bonus)).
    damage: 9,
    kbx: 110,
    kby: -60,
    proj: 9,
    speed: 330,
    gravity: 140,
    life: 100,
    chargeMax: 38,
    chargeBonus: 1.9,
    tip: 26,
  }),
  def({
    id: WeaponId.STAPLER,
    key: 'stapler-sling',
    name: { fr: 'Lance-pierre à agrafes', en: 'Staple slingshot' },
    kind: WeaponKind.PROJECTILE,
    ammo: 10,
    startup: 3,
    active: 1,
    recovery: 14,
    damage: 4,
    kbx: 45,
    kby: -25,
    proj: 7,
    pellets: 3,
    spread: 0.2,
    speed: 560,
    life: 48,
    recoil: 40,
    tip: 20,
  }),
  def({
    id: WeaponId.GLUE_GUN,
    key: 'glue-gun',
    name: { fr: 'Pistolet à colle', en: 'Glue gun' },
    kind: WeaponKind.PROJECTILE,
    ammo: 7,
    startup: 4,
    active: 1,
    recovery: 20,
    damage: 2,
    kbx: 20,
    kby: -10,
    proj: 8,
    speed: 380,
    gravity: 260,
    life: 110,
    statusTicks: 180,
    tip: 20,
    weight: 0.9,
  }),
  def({
    id: WeaponId.INK_GRENADE,
    key: 'ink-grenade',
    name: { fr: 'Grenade d’encre', en: 'Ink grenade' },
    kind: WeaponKind.PROJECTILE,
    ammo: 2,
    startup: 6,
    active: 1,
    recovery: 24,
    proj: 10,
    speed: 340,
    gravity: 620,
    life: 105,
    bounces: 4,
    restitution: 0.45,
    explosion: { radius: 46, damage: 26, kb: 420, destroys: true, puddle: true },
    tip: 12,
    weight: 0.7,
  }),
  def({
    id: WeaponId.BOOMERANG,
    key: 'ruler-boomerang',
    name: { fr: 'Règle-boomerang', en: 'Ruler boomerang' },
    kind: WeaponKind.PROJECTILE,
    ammo: 1,
    startup: 4,
    active: 1,
    recovery: 16,
    damage: 7,
    kbx: 120,
    kby: -70,
    proj: 11,
    speed: 520,
    life: 84,
    tip: 14,
    weight: 0.9,
  }),
  def({
    id: WeaponId.SCISSORS,
    key: 'scissors',
    name: { fr: 'Ciseaux', en: 'Scissors' },
    kind: WeaponKind.MELEE,
    ammo: 16,
    startup: 4,
    active: 3,
    recovery: 12,
    damage: 11,
    kbx: 130,
    kby: -70,
    reach: 30,
    tip: 28,
    chargeMax: 32,
    chargeBonus: 0.8,
    cuts: true,
  }),
  def({
    id: WeaponId.HIGHLIGHTER,
    key: 'highlighter',
    name: { fr: 'Surligneur laser', en: 'Laser highlighter' },
    kind: WeaponKind.HITSCAN,
    ammo: 40,
    startup: 1,
    active: 1,
    recovery: 3,
    damage: 2,
    reach: 320,
    light: true,
    tip: 20,
    weight: 0.8,
  }),
  def({
    id: WeaponId.TAPE,
    key: 'tape',
    name: { fr: 'Rouleau de scotch', en: 'Tape roll' },
    kind: WeaponKind.TRAP,
    ammo: 3,
    startup: 6,
    active: 1,
    recovery: 22,
    trap: ObjType.TAPE,
    statusTicks: 45,
    weight: 0.8,
  }),
  def({
    id: WeaponId.COVER,
    key: 'notebook-cover',
    name: { fr: 'Cahier-paravent', en: 'Notebook screen' },
    kind: WeaponKind.TRAP,
    ammo: 2,
    startup: 8,
    active: 1,
    recovery: 24,
    trap: ObjType.COVER,
    weight: 0.7,
  }),
  def({
    id: WeaponId.MEDKIT,
    key: 'medkit',
    name: { fr: 'Trousse de soin', en: 'First-aid kit' },
    kind: WeaponKind.HEAL,
    ammo: 1,
    startup: 42,
    active: 1,
    recovery: 8,
    heal: 45,
    weight: 0.6,
  }),
];

/** Identifiants des 22 armes qui apparaissent dans l'arène (hors poings et caisse). */
export const SPAWNABLE_WEAPONS: readonly number[] = WEAPONS.filter((w) => w.weight > 0).map(
  (w) => w.id,
);

export function weaponDef(id: number): WeaponDef {
  return id >= 0 && id < WEAPONS.length ? WEAPONS[id] : WEAPONS[0];
}

/** Durée d'une utilisation complète (ticks). */
export function weaponCooldown(w: WeaponDef): number {
  return w.startup + w.active + w.recovery;
}

/** Nombre d'armes qui apparaissent dans l'arène (hors poings et caisse). */
export const WEAPON_COUNT = 22;

/** Charge d'une arme chargeable (0 à 1) après `ticks` ticks de maintien de l'attaque. */
export function weaponChargeLevel(w: WeaponDef, ticks: number): number {
  if (w.chargeMax <= 0) return 0;
  const from = w.startup + 4;
  if (ticks <= from) return 0;
  return Math.min(1, (ticks - from) / Math.max(1, w.chargeMax - from));
}
