/**
 * TOUTES les constantes de combat sont ici (dégâts, délais, knockback). Les armes sont dans
 * `weapons.ts`. Unités : unités de monde, ticks (1 tick = 1/60 s), unités/s pour les vitesses.
 */

export interface MeleeAttack {
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  /** Projection horizontale (vers l'extérieur) et verticale (négative = vers le haut). */
  kbx: number;
  kby: number;
  /** Étourdissement infligé (ticks), 0 si aucun. */
  stun: number;
  /** Allonge au-delà du corps (unités). */
  reach: number;
  /** Poussée vers l'avant de l'attaquant au départ du coup. */
  lunge: number;
}

export const COMBAT = {
  maxHp: 100,
  /** Protection après une apparition (ticks). */
  spawnInvulnTicks: 90,
  /** Le knockback est multiplié par 1 + bonus × (1 − PV/PVmax) : plus fort quand on a peu de PV. */
  lowHpKnockbackBonus: 0.5,
  /** Un étourdissement ne peut pas être reçu de nouveau pendant ce délai après sa fin. */
  stunImmuneTicks: 45,
  stunMaxTicks: 36,
  /** Fenêtre pour enchaîner le coup suivant, après la fin des images actives. */
  comboWindowTicks: 18,
  /** Bouton d'attaque tenu aussi longtemps : le coup en cours est suivi d'une charge. */
  chargeHoldTicks: 16,
  chargeMaxTicks: 54,
  /** Parade : part des dégâts subis de face, et des projections. */
  blockDamageTaken: 0.3,
  blockKnockbackMul: 0.4,
  /**
   * Parade : elle n'encaisse qu'un seul coup (puis elle retombe), l'attaquant dont le coup de
   * mêlée est paré est étourdi 0,4 s, et il faut attendre 0,5 s avant de parer de nouveau.
   * Parade parfaite : fenêtre après l'appui, pendant laquelle le coup n'inflige rien.
   */
  perfectParryTicks: 6,
  parryStunTicks: 24,
  parryCooldownTicks: 30,
  /** Recharge après avoir relâché la parade sans avoir été touché. */
  blockCooldownTicks: 30,
  /** Vitesse de déplacement pendant les actions (multiplicateur de la vitesse de course). */
  blockSpeedMul: 0.45,
  attackSpeedMul: 0.7,
  chargeSpeedMul: 0.35,
  /** Durée pendant laquelle la projection prive de contrôle horizontal : min + force / diviseur. */
  hitLockMin: 6,
  hitLockMax: 26,
  hitLockPerKb: 1 / 40,
  /** Les projectiles plus lents que cela sont renvoyés par une parade parfaite. */
  reflectMaxSpeed: 260,
  /** Le dernier agresseur reste crédité d'une mort accidentelle pendant ce délai. */
  killCreditTicks: 300,
  /** Dégâts du décor. */
  hazardDamage: 12,
  hazardIntervalTicks: 30,
  hazardBounce: 280,
  tackDamage: 8,
  tackBounce: 220,
  tackCooldownTicks: 60,
  /** Mort subite : l'encre / la déchirure avance de cette vitesse (unités/s) ; létale au contact. */
  suddenSpeed: 14,
  /** Dégâts par tick dans l'encre ou la déchirure (mortel en une demi-seconde). */
  inkDamagePerTick: 3,
  /** Sortie de la page : mort quand le joueur dépasse ces marges. */
  outTop: 4 * 16,
  outSides: 2 * 16,
  /** Coup de pied sauté (vers le bas). */
  kick: {
    damage: 10,
    kbx: 90,
    kby: 380,
    diveSpeed: 430,
    bounce: 260,
    reachX: 11,
    reachDown: 14,
    stun: 0,
    recovery: 10,
  },
  /** Coup chargé : les valeurs vont du minimum (charge courte) au maximum (charge pleine). */
  charged: {
    startup: 4,
    active: 4,
    recovery: 20,
    damageMin: 14,
    damageMax: 32,
    kbxMin: 260,
    kbxMax: 520,
    kbyMin: -200,
    kbyMax: -340,
    stunFrom: 0.5,
    stun: 24,
    reach: 28,
    lunge: 90,
  },
  /** Jet d'une arme ou d'une caisse. */
  throwSpeed: 330,
  throwUp: 120,
  throwDamage: 8,
  throwKb: 220,
  emptyThrowDamage: 5,
  crateThrowDamage: 15,
  pickupReach: 14,
  /** Cœurs de soin : points rendus, durée de vie au sol (ticks). */
  healAmount: 35,
  heartLifeTicks: 25 * 60,
  pickupCooldownTicks: 18,
} as const;

/**
 * Coup vers le haut (haut + attaquer) : `reach` est l'allonge au-dessus de la tête. Il projette
 * presque à la verticale.
 */
export const UPPER: MeleeAttack = {
  startup: 4,
  active: 3,
  recovery: 13,
  damage: 8,
  kbx: 50,
  kby: -330,
  stun: 0,
  reach: 18,
  lunge: 0,
};

/**
 * Coup accroupi (bas + attaquer au sol) : plus long que les poings debout (20 à 26) et il projette
 * vers le haut.
 */
export const CROUCH_PUNCH: MeleeAttack = {
  startup: 4,
  active: 3,
  recovery: 14,
  damage: 8,
  kbx: 70,
  kby: -320,
  stun: 0,
  reach: 36,
  lunge: 30,
};

/** Coups à mains nues : jab, crochet, final (projette). */
export const FIST: readonly MeleeAttack[] = [
  {
    startup: 3,
    active: 2,
    recovery: 8,
    damage: 5,
    kbx: 110,
    kby: -70,
    stun: 0,
    reach: 20,
    lunge: 40,
  },
  {
    startup: 3,
    active: 2,
    recovery: 9,
    damage: 7,
    kbx: 150,
    kby: -90,
    stun: 0,
    reach: 22,
    lunge: 50,
  },
  {
    startup: 6,
    active: 3,
    recovery: 16,
    damage: 12,
    kbx: 340,
    kby: -230,
    stun: 24,
    reach: 26,
    lunge: 70,
  },
];
