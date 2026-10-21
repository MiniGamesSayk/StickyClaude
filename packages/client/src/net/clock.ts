import { TICK_MS } from '@stickyclaude/shared';

const WINDOW = 8;
/** Nombre d'échantillons avant de considérer l'horloge synchronisée (rejette un premier RTT aberrant). */
const MIN_SAMPLES = 3;

/**
 * Synchronisation d'horloge avec le serveur par ping/pong (style NTP).
 * `serverMs = localMs + offsetMs`, où serverMs = (tick + fraction) × durée d'un tick.
 * - L'écart retenu vient de l'échantillon au RTT le plus faible de la fenêtre, et glisse
 *   doucement vers sa cible pour ne jamais faire sauter l'affichage.
 * - Le RTT est la médiane de la fenêtre : un pong très en retard (onglet gelé, blocage TCP)
 *   ne fausse pas l'estimation.
 */
export class ClockSync {
  rttMs = 0;
  jitterMs = 0;
  offsetMs = 0;
  synced = false;
  private readonly rtts = new Float64Array(WINDOW);
  private readonly offsets = new Float64Array(WINDOW);
  private readonly sorted = new Float64Array(WINDOW);
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
    const sample = serverTickFloat * TICK_MS - (localNow - rtt / 2);
    this.rtts[this.head] = rtt;
    this.offsets[this.head] = sample;
    this.head = (this.head + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;

    // Médiane du RTT et gigue (écart moyen à la médiane).
    for (let i = 0; i < this.count; i++) this.sorted[i] = this.rtts[i]!;
    const view = this.sorted.subarray(0, this.count).sort();
    const median = view[Math.floor((this.count - 1) / 2)];
    this.jitterMs += (Math.abs(rtt - median) - this.jitterMs) * 0.2;
    this.rttMs = median;

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
      if (this.count >= MIN_SAMPLES) this.synced = true;
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
