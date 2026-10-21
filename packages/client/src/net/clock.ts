import { TICK_MS } from '@stickyclaude/shared';

const WINDOW = 8;

/**
 * Synchronisation d'horloge avec le serveur par ping/pong (style NTP).
 * `serverMs = localMs + offsetMs`, où serverMs = (tick + fraction) × durée d'un tick.
 * L'écart retenu vient de l'échantillon au RTT le plus faible de la fenêtre, et glisse
 * doucement vers sa cible pour ne jamais faire sauter l'affichage.
 */
export class ClockSync {
  rttMs = 0;
  jitterMs = 0;
  offsetMs = 0;
  synced = false;
  private readonly rtts = new Float64Array(WINDOW);
  private readonly offsets = new Float64Array(WINDOW);
  private count = 0;
  private head = 0;

  get owdMs(): number {
    return this.rttMs / 2;
  }

  /**
   * @param localNow instant local de réception du pong
   * @param rtt aller-retour mesuré avec l'horloge locale
   * @param serverTickFloat tick serveur (avec fraction) au moment de l'émission du pong
   */
  onPong(localNow: number, rtt: number, serverTickFloat: number): void {
    if (!(rtt >= 0) || rtt > 10_000) return;
    if (this.count === 0) {
      this.rttMs = rtt;
    } else {
      this.jitterMs += (Math.abs(rtt - this.rttMs) - this.jitterMs) * 0.2;
      this.rttMs += (rtt - this.rttMs) * 0.25;
    }
    const sample = serverTickFloat * TICK_MS - (localNow - rtt / 2);
    this.rtts[this.head] = rtt;
    this.offsets[this.head] = sample;
    this.head = (this.head + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;

    let best = 0;
    let bestRtt = Infinity;
    for (let i = 0; i < this.count; i++) {
      if (this.rtts[i] < bestRtt) {
        bestRtt = this.rtts[i]!;
        best = i;
      }
    }
    const target = this.offsets[best];
    if (!this.synced) {
      this.offsetMs = target;
      this.synced = true;
      return;
    }
    const diff = target - this.offsetMs;
    const maxStep = Math.max(0.5, Math.abs(diff) * 0.1);
    this.offsetMs += Math.max(-maxStep, Math.min(maxStep, diff));
  }

  serverTimeMs(localNow: number): number {
    return localNow + this.offsetMs;
  }

  serverTick(localNow: number): number {
    return this.serverTimeMs(localNow) / TICK_MS;
  }
}
