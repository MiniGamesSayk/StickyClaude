/**
 * Limiteur de flashs (analyse §1.11) : jamais plus de 3 flashs par seconde, quel que soit le
 * nombre d'événements qui en demandent un (parades parfaites en rafale, explosions).
 */
export const MIN_FLASH_GAP_MS = 340;

export class FlashLimiter {
  private last = -1e9;

  /** Vrai si un flash est autorisé à l'instant `nowMs` ; l'enregistre alors. */
  allow(nowMs: number): boolean {
    if (nowMs - this.last < MIN_FLASH_GAP_MS) return false;
    this.last = nowMs;
    return true;
  }

  reset(): void {
    this.last = -1e9;
  }
}
