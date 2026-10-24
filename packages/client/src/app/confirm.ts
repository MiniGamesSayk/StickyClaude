import { MAX_PLAYERS } from '@stickyclaude/shared';

/** Un coup confirmé localement attend son événement `HIT` du serveur au plus ce délai (ms). */
export const CONFIRM_WINDOW_MS = 900;

/**
 * Coups de mêlée confirmés à l'écran avant le serveur (`onHitConfirm`) : quand l'événement `HIT`
 * correspondant arrive, son étincelle, son gel et son son ont déjà été joués ; on ne les rejoue pas.
 */
export class HitConfirms {
  private readonly at = new Float64Array(MAX_PLAYERS).fill(Number.NEGATIVE_INFINITY);

  /** Son coup vient de toucher `victim` à l'écran. */
  mark(victim: number, nowMs: number): void {
    if (victim >= 0 && victim < MAX_PLAYERS) this.at[victim] = nowMs;
  }

  /**
   * L'événement `HIT` de `attacker` sur `victim` a-t-il déjà été joué localement ? Si oui, la
   * confirmation est consommée (un coup du serveur pour une confirmation).
   */
  take(attacker: number, victim: number, self: number, nowMs: number): boolean {
    if (attacker !== self || self < 0 || victim < 0 || victim >= MAX_PLAYERS) return false;
    if (nowMs - this.at[victim] > CONFIRM_WINDOW_MS) return false;
    this.at[victim] = Number.NEGATIVE_INFINITY;
    return true;
  }

  reset(): void {
    this.at.fill(Number.NEGATIVE_INFINITY);
  }
}
