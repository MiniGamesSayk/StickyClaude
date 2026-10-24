/**
 * TOUTES les constantes de mouvement du stickman sont ici, et seulement ici.
 *
 * Unités : unités de monde (1 cellule = 16 unités), secondes, ou ticks (1 tick = 1/60 s).
 * La simulation lit ces valeurs dans `world.params` (copie modifiable en développement via le
 * panneau de réglage), jamais directement depuis ce fichier.
 */

export interface MovementParams {
  // Corps
  width: number;
  height: number;
  crouchHeight: number;
  // Course
  runSpeed: number;
  crouchSpeed: number;
  groundAccel: number;
  groundTurnAccel: number;
  groundDecel: number;
  airAccel: number;
  airDecel: number;
  // Verticalité
  gravity: number;
  maxFallSpeed: number;
  /** Gravité multipliée par ce facteur dans la descente : le saut monte comme avant, retombe plus sec. */
  fallGravityMul: number;
  fastFallGravityMul: number;
  fastFallSpeed: number;
  jumpSpeed: number;
  doubleJumpSpeed: number;
  /** Facteur appliqué à la vitesse verticale quand on relâche le saut en montant. */
  jumpCut: number;
  coyoteTicks: number;
  jumpBufferTicks: number;
  // Murs
  wallSlideSpeed: number;
  wallJumpSpeedX: number;
  wallJumpSpeedY: number;
  wallLockTicks: number;
  wallCoyoteTicks: number;
  // Plateformes à sens unique
  dropThroughTicks: number;
  // Dash
  dashSpeed: number;
  dashTicks: number;
  dashCooldownTicks: number;
  // Esquive (dash sans direction)
  dodgeTicks: number;
  dodgeCooldownTicks: number;
  // Événements
  /** Vitesse de chute minimale pour émettre l'événement d'atterrissage (son, poussière). */
  landEventSpeed: number;
}

export const DEFAULT_MOVEMENT: Readonly<MovementParams> = {
  width: 9, // boîte au plus près du dessin (tête ±4,4) : ≈ 0,56 cellule
  height: 28.8, // 1,8 cellule
  crouchHeight: 17.6, // 1,1 cellule

  runSpeed: 190,
  crouchSpeed: 70,
  groundAccel: 1900,
  groundTurnAccel: 3400,
  groundDecel: 2600,
  airAccel: 1100,
  airDecel: 900, // lâcher la direction en l'air arrête la dérive en ≈ 0,2 s

  gravity: 1250,
  maxFallSpeed: 620,
  fallGravityMul: 1.4,
  fastFallGravityMul: 1.8,
  fastFallSpeed: 820,
  jumpSpeed: 395, // ≈ 3,9 cellules de haut
  doubleJumpSpeed: 395, // comme le premier saut : ≈ 3,9 cellules de haut
  jumpCut: 0.45,
  coyoteTicks: 6, // 100 ms
  jumpBufferTicks: 6, // 100 ms

  wallSlideSpeed: 90,
  wallJumpSpeedX: 120,
  wallJumpSpeedY: 400, // compense la gravité en descente : le puits de 4 cases se monte comme avant
  wallLockTicks: 5,
  wallCoyoteTicks: 5,

  dropThroughTicks: 14,

  dashSpeed: 420, // ≈ 2,2 × la course
  dashTicks: 9, // 150 ms, ≈ 3,9 cellules parcourues
  dashCooldownTicks: 45, // 750 ms, compté depuis le début du dash

  dodgeTicks: 20, // 330 ms d'invulnérabilité sur place
  dodgeCooldownTicks: 75, // 1,25 s, compté depuis le début de l'esquive

  landEventSpeed: 200,
};

export type MovementKey = keyof MovementParams;

export interface TuningMeta {
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Métadonnées pour le panneau de réglage en direct (développement seulement). */
export const MOVEMENT_TUNING: Readonly<Record<MovementKey, TuningMeta>> = {
  width: { label: 'Largeur du corps', min: 6, max: 24, step: 0.1 },
  height: { label: 'Hauteur debout', min: 16, max: 48, step: 0.1 },
  crouchHeight: { label: 'Hauteur accroupi', min: 8, max: 32, step: 0.1 },
  runSpeed: { label: 'Vitesse de course', min: 60, max: 400, step: 1 },
  crouchSpeed: { label: 'Vitesse accroupi', min: 10, max: 200, step: 1 },
  groundAccel: { label: 'Accélération sol', min: 200, max: 6000, step: 10 },
  groundTurnAccel: { label: 'Demi-tour sol', min: 200, max: 8000, step: 10 },
  groundDecel: { label: 'Décélération sol', min: 200, max: 8000, step: 10 },
  airAccel: { label: 'Accélération air', min: 100, max: 4000, step: 10 },
  airDecel: { label: 'Décélération air', min: 0, max: 3000, step: 10 },
  gravity: { label: 'Gravité', min: 300, max: 4000, step: 10 },
  maxFallSpeed: { label: 'Vitesse de chute max', min: 200, max: 1200, step: 5 },
  fallGravityMul: { label: 'Gravité en descente (×)', min: 1, max: 3, step: 0.05 },
  fastFallGravityMul: { label: 'Chute rapide (×gravité)', min: 1, max: 4, step: 0.05 },
  fastFallSpeed: { label: 'Chute rapide max', min: 300, max: 1500, step: 5 },
  jumpSpeed: { label: 'Saut', min: 150, max: 700, step: 1 },
  doubleJumpSpeed: { label: 'Double saut', min: 100, max: 700, step: 1 },
  jumpCut: { label: 'Coupure du saut', min: 0, max: 1, step: 0.01 },
  coyoteTicks: { label: 'Coyote (ticks)', min: 0, max: 20, step: 1 },
  jumpBufferTicks: { label: 'Mémoire du saut (ticks)', min: 0, max: 20, step: 1 },
  wallSlideSpeed: { label: 'Glissade mur', min: 20, max: 400, step: 1 },
  wallJumpSpeedX: { label: 'Saut mur (horizontal)', min: 50, max: 500, step: 1 },
  wallJumpSpeedY: { label: 'Saut mur (vertical)', min: 150, max: 700, step: 1 },
  wallLockTicks: { label: 'Blocage après saut mur', min: 0, max: 30, step: 1 },
  wallCoyoteTicks: { label: 'Coyote mur (ticks)', min: 0, max: 20, step: 1 },
  dropThroughTicks: { label: 'Traversée sens unique', min: 4, max: 40, step: 1 },
  dashSpeed: { label: 'Vitesse du dash', min: 100, max: 900, step: 5 },
  dashTicks: { label: 'Durée du dash (ticks)', min: 2, max: 30, step: 1 },
  dashCooldownTicks: { label: 'Recharge du dash (ticks)', min: 0, max: 180, step: 1 },
  dodgeTicks: { label: 'Durée de l’esquive (ticks)', min: 2, max: 60, step: 1 },
  dodgeCooldownTicks: { label: 'Recharge de l’esquive (ticks)', min: 0, max: 240, step: 1 },
  landEventSpeed: { label: 'Seuil d’atterrissage (événement)', min: 0, max: 800, step: 5 },
};

export const MOVEMENT_KEYS = Object.keys(DEFAULT_MOVEMENT) as MovementKey[];

export function isMovementKey(k: string): k is MovementKey {
  return Object.prototype.hasOwnProperty.call(DEFAULT_MOVEMENT, k);
}

export function cloneMovement(): MovementParams {
  return { ...DEFAULT_MOVEMENT };
}
