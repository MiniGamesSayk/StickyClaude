/**
 * TOUTES les constantes de combat sont ici (dégâts, délais, knockback). Les armes sont dans
 * `weapons.ts`. Unités : unités de monde, ticks (1 tick = 1/60 s), unités/s pour les vitesses.
 */

import { AtkPhase, AttackKind } from './types.ts';

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
  /** Charge de l'attaque spéciale (clic droit tenu) : durée de la charge pleine. */
  chargeMaxTicks: 54,
  /** Parade : part des dégâts subis de face, et des projections. */
  blockDamageTaken: 0.3,
  blockKnockbackMul: 0.4,
  /**
   * Parade : elle n'encaisse qu'un seul coup (puis elle retombe), l'attaquant dont le coup de
   * mêlée est paré est étourdi 0,4 s, et il faut attendre 0,5 s avant de parer de nouveau.
   * Parade parfaite : fenêtre après l'appui, pendant laquelle le coup n'inflige rien. Une garde
   * relevée sans nouvel appui (bouton resté tenu après une recharge, ou pendant un coup) n'y a pas
   * droit.
   */
  perfectParryTicks: 6,
  parryStunTicks: 24,
  parryCooldownTicks: 30,
  /** Recharge après avoir relâché la parade sans avoir été touché : aucune, seule une parade qui encaisse un coup recharge. */
  blockCooldownTicks: 0,
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
  /** Lave : gros dégâts, souvent. Scie : dégâts moyens et recul latéral. */
  lavaDamage: 40,
  lavaIntervalTicks: 24,
  lavaBounce: 380,
  sawDamage: 20,
  sawIntervalTicks: 20,
  sawKnock: 300,
  /** Trampoline : vitesse de rebond minimale, rendement de la chute, plafond. */
  trampolineMin: 620,
  trampolineGain: 0.95,
  trampolineMax: 820,
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
  /**
   * Attaque spéciale au sol, côté ou haut (clic droit, chargeable) : les valeurs vont du minimum
   * (appui bref) au maximum (charge pleine). Le poing s'allonge de `extend` pendant les images
   * actives, puis une longue récupération (non annulable) suit.
   */
  charged: {
    startup: 5,
    active: 4,
    recovery: 24,
    damageMin: 14,
    damageMax: 32,
    kbxMin: 260,
    kbxMax: 520,
    kbyMin: -200,
    kbyMax: -340,
    stunFrom: 0.5,
    stun: 24,
    reach: 26,
    extend: 14,
    lunge: 90,
  },
  /** Attaque spéciale accroupie : frappe de chaque côté. */
  specialDown: {
    startup: 4,
    active: 4,
    recovery: 20,
    damageMin: 10,
    damageMax: 22,
    kbxMin: 200,
    kbxMax: 400,
    kbyMin: -140,
    kbyMax: -220,
    stunFrom: 0.6,
    stun: 18,
    reach: 26,
  },
  /** Coup vers le bas en l'air : le frappeur rebondit s'il touche, et projette fort vers le bas. */
  airDown: {
    startup: 3,
    active: 3,
    recovery: 11,
    damage: 9,
    kbx: 40,
    kby: 420,
    stun: 0,
    reach: 18,
    bounce: 210,
  },
  /** Coup en l'air sans direction : autour du personnage, faible portée. */
  airNeutral: {
    startup: 2,
    active: 4,
    recovery: 10,
    damage: 5,
    kbx: 120,
    kby: -110,
    stun: 0,
    reach: 12,
  },
  /** Coup de côté en l'air : balayage large devant soi. */
  airSide: {
    startup: 3,
    active: 4,
    recovery: 12,
    damage: 8,
    kbx: 210,
    kby: -120,
    stun: 0,
    reach: 24,
  },
  /** Petit balayage vers le haut en l'air. */
  airUp: {
    startup: 3,
    active: 4,
    recovery: 11,
    damage: 7,
    kbx: 40,
    kby: -290,
    stun: 0,
    reach: 22,
  },
  /**
   * Attaque spéciale en l'air (clic droit) : sans direction, l'esquive sur place ; avec une
   * direction, une ruée plus longue que le dash, invulnérable sauf pendant ses derniers ticks.
   */
  airSpecial: {
    extraTicks: 3,
    vulnerableTicks: 4,
    extraCooldownTicks: 20,
  },
  /** Lancer chargé : durée de charge maximale et seuil sous lequel un appui reste un simple geste. */
  throwChargeMax: 36,
  throwHoldTicks: 8,
  /** Jet d'une arme ou d'une caisse (charge pleine : vitesse ×2,1, dégâts ×2,5, projection ×2). */
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
  /** Colle : multiplicateur de vitesse de déplacement tant qu'on est englué. */
  glueSpeedMul: 0.45,
} as const;

/**
 * Coup vers le haut (haut + attaquer) : `reach` est l'allonge au-dessus de la tête. Il projette
 * vers le haut, sans lancer l'adversaire.
 */
export const UPPER: MeleeAttack = {
  startup: 4,
  active: 3,
  recovery: 13,
  damage: 8,
  kbx: 50,
  kby: -270,
  stun: 0,
  reach: 22,
  lunge: 0,
};

/**
 * Balayage accroupi (bas + attaquer au sol) : sur place, un peu plus long que les poings debout
 * (20 à 26) ; l'adversaire est repoussé légèrement et tombe (étourdissement).
 */
export const CROUCH_SWEEP: MeleeAttack = {
  startup: 4,
  active: 3,
  recovery: 12,
  damage: 6,
  kbx: 70,
  kby: -90,
  stun: 20,
  reach: 28,
  lunge: 0,
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

/**
 * Durée (ticks) d'une phase d'un coup à mains nues (la simulation et le dessin lisent la même
 * table) ; -1 si `kind` n'en est pas un (arme, lancer : durées propres).
 */
export function fistPhaseTicks(kind: number, phase: number): number {
  const pick = (a: { startup: number; active: number; recovery: number }): number =>
    phase === AtkPhase.STARTUP ? a.startup : phase === AtkPhase.ACTIVE ? a.active : a.recovery;
  switch (kind) {
    case AttackKind.FIST1:
    case AttackKind.FIST2:
    case AttackKind.FIST3:
      return pick(FIST[kind - AttackKind.FIST1]);
    case AttackKind.CHARGED:
      return pick(COMBAT.charged);
    case AttackKind.SPECIAL_DOWN:
      return pick(COMBAT.specialDown);
    case AttackKind.UPPER:
      return pick(UPPER);
    case AttackKind.CROUCH:
      return pick(CROUCH_SWEEP);
    case AttackKind.AIR_NEUTRAL:
      return pick(COMBAT.airNeutral);
    case AttackKind.AIR_SIDE:
      return pick(COMBAT.airSide);
    case AttackKind.AIR_UP:
      return pick(COMBAT.airUp);
    case AttackKind.AIR_DOWN:
      return pick(COMBAT.airDown);
    default:
      return -1;
  }
}
