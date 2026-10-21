/**
 * Les 12 armes du jeu, dans un seul fichier de données (analyse §1.3). La logique de la simulation
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
  def({ id: WeaponId.NONE, key: 'fists', name: { fr: 'Poings', en: 'Fists' }, kind: WeaponKind.FISTS, weight: 0 }),
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
  }),
  def({
    id: WeaponId.SHOTGUN,
    key: 'shotgun',
    name: { fr: 'Fusil à pompe gribouillé', en: 'Scribbled shotgun' },
    kind: WeaponKind.HITSCAN,
    ammo: 4,
    startup: 3,
    active: 1,
    recovery: 34,
    damage: 7,
    kbx: 110,
    kby: -70,
    reach: 170,
    pellets: 5,
    spread: 0.3,
    recoil: 260,
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
  }),
  def({
    id: WeaponId.GRAPPLE,
    key: 'paperclip-grapple',
    name: { fr: 'Trombone-grappin', en: 'Paperclip grapple' },
    kind: WeaponKind.GRAPPLE,
    ammo: 3,
    startup: 4,
    active: 1,
    recovery: 25,
    damage: 4,
    kbx: 60,
    kby: -40,
    reach: 176,
    pullSpeed: 420,
    pullTicks: 50,
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
];

/** Identifiants des 12 armes qui apparaissent dans l'arène (hors poings et caisse). */
export const SPAWNABLE_WEAPONS: readonly number[] = WEAPONS.filter((w) => w.weight > 0).map(
  (w) => w.id,
);

export function weaponDef(id: number): WeaponDef {
  return id >= 0 && id < WEAPONS.length ? WEAPONS[id]! : WEAPONS[0]!;
}

/** Durée d'une utilisation complète (ticks). */
export function weaponCooldown(w: WeaponDef): number {
  return w.startup + w.active + w.recovery;
}

/** Armes de la liste v1 : exactement douze. */
export const WEAPON_COUNT = 12;
