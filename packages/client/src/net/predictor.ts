import { CELL, createOwnState, MAX_PLAYERS, PREDICTION_HISTORY } from '@stickyclaude/shared';
import type { ArenaData, OwnState } from '@stickyclaude/shared';
import { createWorld, exportOwn, importOwn, setTick, step } from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';

interface HistoryEntry {
  tick: number;
  mask: number;
  own: OwnState;
}

/** Tolérances de comparaison : les flottants du serveur sont arrondis en 32 bits. */
const POS_TOL = 0.02;
const VEL_TOL = 0.05;
/** Écart visuel maximal lissé ; au-delà, le surplus est appliqué d'un coup (téléportation). */
const SMOOTH_MAX = 4 * CELL;
/** Constante de temps du lissage visuel des corrections (≈ 100 ms pour disparaître). */
const SMOOTH_TAU_MS = 40;

export const ReconcileResult = {
  /** Snapshot trop ancien, ou pas d'entrée d'historique correspondante. */
  Skipped: 0,
  /** La prédiction concorde avec le serveur. */
  Match: 1,
  /** Divergence : état restauré depuis le serveur et entrées rejouées. */
  Corrected: 2,
  /** Le serveur est en avance sur le client : état restauré tel quel. */
  Resynced: 3,
} as const;
export type ReconcileResultId = (typeof ReconcileResult)[keyof typeof ReconcileResult];

function ownMatches(a: OwnState, b: OwnState): boolean {
  return (
    Math.abs(a.x - b.x) <= POS_TOL &&
    Math.abs(a.y - b.y) <= POS_TOL &&
    Math.abs(a.vx - b.vx) <= VEL_TOL &&
    Math.abs(a.vy - b.vy) <= VEL_TOL &&
    a.flags === b.flags &&
    a.coyote === b.coyote &&
    a.jumpBuffer === b.jumpBuffer &&
    a.wallLock === b.wallLock &&
    a.wallCoyote === b.wallCoyote &&
    a.dropTimer === b.dropTimer &&
    a.wallDir === b.wallDir &&
    a.groundMover === b.groundMover &&
    a.prevInput === b.prevInput &&
    a.respawns === b.respawns
  );
}

/**
 * Prédiction locale de son propre joueur : même `step` que le serveur, historique des états
 * prédits par tick, et réconciliation (restauration depuis le snapshot + rejeu des entrées).
 */
export class Predictor {
  readonly world: World;
  readonly slot: number;
  /** Étiquette de la dernière entrée simulée (= world.tick). */
  tick = 0;
  started = false;
  // Position avant le dernier tick, pour l'interpolation visuelle entre deux ticks.
  prevX = 0;
  prevY = 0;
  // Décalage visuel résiduel des corrections récentes (décroît exponentiellement).
  smoothX = 0;
  smoothY = 0;
  corrections = 0;
  resyncs = 0;
  /** Écart (unités) mesuré lors de la dernière correction. */
  lastError = 0;
  private readonly hist: HistoryEntry[] = [];
  private readonly inputs = new Uint16Array(MAX_PLAYERS);
  private readonly scratch = createOwnState();

  constructor(arena: ArenaData, seed: number, slot: number) {
    this.world = createWorld(arena, seed);
    this.slot = slot;
    for (let i = 0; i < PREDICTION_HISTORY; i++) {
      this.hist.push({ tick: -1, mask: 0, own: createOwnState() });
    }
  }

  /** Dernier état prédit du joueur. */
  get player(): World['players'][number] {
    return this.world.players[this.slot];
  }

  /** Démarre depuis un snapshot serveur (premier snapshot, ou serveur en avance). */
  start(tick: number, own: OwnState): void {
    setTick(this.world, tick);
    importOwn(this.world, this.slot, own);
    this.tick = tick;
    this.started = true;
    this.prevX = own.x;
    this.prevY = own.y;
    this.smoothX = 0;
    this.smoothY = 0;
  }

  /** Simule le tick suivant avec l'entrée `mask` et l'inscrit dans l'historique. */
  stepTick(mask: number): void {
    const p = this.player;
    this.prevX = p.x;
    this.prevY = p.y;
    this.simulate(mask);
  }

  private simulate(mask: number): void {
    this.inputs[this.slot] = mask;
    step(this.world, this.inputs);
    this.tick = this.world.tick;
    const h = this.hist[this.tick & (PREDICTION_HISTORY - 1)];
    h.tick = this.tick;
    h.mask = mask;
    exportOwn(this.world, this.slot, h.own);
  }

  /** Saute directement à un tick sans simuler (reprise après une longue interruption). */
  jumpTo(tick: number): void {
    setTick(this.world, tick);
    this.tick = tick;
  }

  /** Compare le snapshot (état du tick `tick`) à l'historique et corrige si besoin. */
  reconcile(tick: number, own: OwnState): ReconcileResultId {
    if (!this.started) return ReconcileResult.Skipped;
    if (tick > this.tick) {
      // Le serveur a déjà simulé plus loin que nous : on repart de son état.
      const p = this.player;
      const bx = p.x;
      const by = p.y;
      this.start(tick, own);
      this.addSmooth(bx - p.x, by - p.y);
      this.resyncs++;
      return ReconcileResult.Resynced;
    }
    if (tick <= this.tick - PREDICTION_HISTORY + 1) return ReconcileResult.Skipped;
    const h = this.hist[tick & (PREDICTION_HISTORY - 1)];
    if (h.tick !== tick) return ReconcileResult.Skipped;
    if (ownMatches(h.own, own)) return ReconcileResult.Match;

    const p = this.player;
    const bx = p.x;
    const by = p.y;
    this.lastError = Math.hypot(h.own.x - own.x, h.own.y - own.y);
    const last = this.tick;
    setTick(this.world, tick);
    importOwn(this.world, this.slot, own);
    Object.assign(h.own, own);
    this.prevX = p.x;
    this.prevY = p.y;
    for (let t = tick + 1; t <= last; t++) {
      const e = this.hist[t & (PREDICTION_HISTORY - 1)];
      this.prevX = p.x;
      this.prevY = p.y;
      this.simulate(e.mask);
    }
    this.addSmooth(bx - p.x, by - p.y);
    this.corrections++;
    return ReconcileResult.Corrected;
  }

  private addSmooth(dx: number, dy: number): void {
    this.smoothX = Math.max(-SMOOTH_MAX, Math.min(SMOOTH_MAX, this.smoothX + dx));
    this.smoothY = Math.max(-SMOOTH_MAX, Math.min(SMOOTH_MAX, this.smoothY + dy));
  }

  /** Fait décroître le décalage visuel (à appeler à chaque image). */
  decaySmoothing(dtMs: number): void {
    const k = Math.exp(-dtMs / SMOOTH_TAU_MS);
    this.smoothX *= k;
    this.smoothY *= k;
    if (Math.abs(this.smoothX) < 0.01) this.smoothX = 0;
    if (Math.abs(this.smoothY) < 0.01) this.smoothY = 0;
  }

  /** Masque simulé pour un tick de l'historique (-1 si absent). */
  maskAt(tick: number): number {
    const h = this.hist[tick & (PREDICTION_HISTORY - 1)];
    return h.tick === tick ? h.mask : -1;
  }

  /** État exporté d'un tick de l'historique (pour les tests). */
  ownAt(tick: number): OwnState | null {
    const h = this.hist[tick & (PREDICTION_HISTORY - 1)];
    if (h.tick !== tick) return null;
    Object.assign(this.scratch, h.own);
    return this.scratch;
  }
}
