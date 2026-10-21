import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';

/** Anneau de durées (µs) pour calculer des percentiles à la demande. */
class Samples {
  private readonly buf: Float64Array;
  private n = 0;
  private i = 0;

  reset(): void {
    this.n = 0;
    this.i = 0;
  }

  constructor(size: number) {
    this.buf = new Float64Array(size);
  }

  add(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }

  stats(): { count: number; p50: number; p99: number; max: number; mean: number } {
    if (this.n === 0) return { count: 0, p50: 0, p99: 0, max: 0, mean: 0 };
    const a = this.buf.slice(0, this.n).sort();
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i];
    return {
      count: this.n,
      p50: a[Math.floor((this.n - 1) * 0.5)],
      p99: a[Math.floor((this.n - 1) * 0.99)],
      max: a[this.n - 1],
      mean: sum / this.n,
    };
  }
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/** Période de sondage de la boucle d'événements : l'histogramme la compte dans chaque mesure. */
const LOOP_RESOLUTION_MS = 10;
const loopLagMs = (ns: number): number => Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS);

export class Metrics {
  /** Durée d'un tick complet du serveur (toutes les salles), en ms. */
  readonly tickMs = new Samples(4096);
  /** Durée d'un pas de simulation d'une salle, en ms. */
  readonly roomStepMs = new Samples(8192);
  readonly startedAt = Date.now();
  bytesOut = 0;
  bytesIn = 0;
  snapshotsSent = 0;
  snapshotsSkipped = 0;
  inputPackets = 0;
  inputsLate = 0;
  inputsMissed = 0;
  inputsLimited = 0;
  invalidMessages = 0;
  tickOverruns = 0;
  private readonly loop: IntervalHistogram = monitorEventLoopDelay({
    resolution: LOOP_RESOLUTION_MS,
  });

  constructor() {
    this.loop.enable();
  }

  stop(): void {
    this.loop.disable();
  }

  /** Remet à zéro les fenêtres de mesure (début d'un test de charge). */
  resetWindow(): void {
    this.loop.reset();
    this.tickMs.reset();
    this.roomStepMs.reset();
    this.bytesOut = 0;
    this.bytesIn = 0;
    this.snapshotsSent = 0;
    this.snapshotsSkipped = 0;
    this.inputPackets = 0;
    this.inputsLate = 0;
    this.inputsMissed = 0;
    this.inputsLimited = 0;
    this.invalidMessages = 0;
    this.tickOverruns = 0;
  }

  snapshot(extra: Record<string, number>): Record<string, unknown> {
    const t = this.tickMs.stats();
    const r = this.roomStepMs.stats();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      ...extra,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      tickMs: { count: t.count, p50: round(t.p50), p99: round(t.p99), max: round(t.max) },
      roomStepMs: { count: r.count, p50: round(r.p50), p99: round(r.p99), max: round(r.max) },
      bytesOut: this.bytesOut,
      bytesIn: this.bytesIn,
      snapshotsSent: this.snapshotsSent,
      snapshotsSkipped: this.snapshotsSkipped,
      inputPackets: this.inputPackets,
      inputsLate: this.inputsLate,
      inputsMissed: this.inputsMissed,
      inputsLimited: this.inputsLimited,
      invalidMessages: this.invalidMessages,
      tickOverruns: this.tickOverruns,
      heapUsedMB: round(mem.heapUsed / 1048576),
      rssMB: round(mem.rss / 1048576),
      eventLoopDelayMs: {
        p50: round(loopLagMs(this.loop.percentile(50))),
        p99: round(loopLagMs(this.loop.percentile(99))),
        max: round(loopLagMs(this.loop.max)),
      },
      cpuUserUs: cpu.user,
      cpuSystemUs: cpu.system,
    };
  }
}
