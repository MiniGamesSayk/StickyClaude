/** Cadence maximale des traînées de projectiles : une particule par projectile et par 1/60 s. */
export const TRAIL_STEP_S = 1 / 60;

/**
 * Limite l'émission des traînées à 60 par seconde quel que soit le nombre d'images : à 144 FPS elles
 * remplissaient le pool de particules et écrasaient les étincelles d'impact (anneau circulaire).
 * `advance` est appelé une fois par image, `open` dit si les traînées de la prochaine image partent.
 */
export class TrailGate {
  private acc = 0;
  open = true;

  advance(dtS: number): void {
    this.acc += dtS;
    this.open = this.acc >= TRAIL_STEP_S;
    // les images plus longues qu'un pas n'en rattrapent pas plusieurs d'un coup
    if (this.open) this.acc %= TRAIL_STEP_S;
  }
}
