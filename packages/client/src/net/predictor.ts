import {
  CELL,
  copyOwnState,
  createOwnState,
  GamePhase,
  MAX_PLAYERS,
  ownEquals,
  PREDICTION_HISTORY,
  SimEvent,
  StatusFlag,
} from '@stickyclaude/shared';
import type { GameSnap, OwnState } from '@stickyclaude/shared';
import {
  applyModeParams,
  exportOwn,
  importOwn,
  setTick,
  step,
  stepMarks,
  stepPuddles,
  syncSuddenGeometry,
} from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';

interface HistoryEntry {
  tick: number;
  mask: number;
  own: OwnState;
  phase: number;
  phaseTick: number;
}

/** Écart visuel maximal lissé ; au-delà, le surplus est appliqué d'un coup (téléportation). */
const SMOOTH_MAX = 4 * CELL;
/**
 * Lissage visuel des corrections : constante de temps de 40 ms pour un petit écart (disparaît en
 * ≈ 100 ms), allongée de 2 ms par unité d'écart pour qu'une grosse correction (blocage réseau)
 * se résorbe en glissant plutôt qu'en sautant.
 */
const SMOOTH_TAU_MS = 40;
const SMOOTH_TAU_PER_UNIT_MS = 2;
/** Une correction est « visible » quand elle déplace le joueur de plus que cela (unités). */
const VISIBLE_ERROR = 0.5;

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

/** Événement local (son, effet) émis par la prédiction de son propre joueur. */
export interface LocalEvent {
  type: number;
  x: number;
  y: number;
  arg: number;
}

const LOCAL_EVENTS: ReadonlySet<number> = new Set([
  SimEvent.JUMP,
  SimEvent.DOUBLE_JUMP,
  SimEvent.WALL_JUMP,
  SimEvent.LAND,
  SimEvent.DROP_THROUGH,
  SimEvent.SWING,
  SimEvent.DASH,
  SimEvent.DODGE,
]);

/**
 * Deux états « own » concordent. Un joueur mort n'évolue plus côté client : seuls son statut, ses
 * drapeaux et son compteur de réapparitions comptent (les minuteries de réapparition sont celles
 * de la partie, pas de la prédiction).
 */
function sameOwn(a: OwnState, b: OwnState): boolean {
  if ((a.status & StatusFlag.DEAD) !== 0 && (b.status & StatusFlag.DEAD) !== 0) {
    return a.status === b.status && a.respawns === b.respawns;
  }
  return ownEquals(a, b);
}

/**
 * Prédiction locale de son propre joueur : même `step` que le serveur (passe 1 seulement : le
 * monde n'est pas autoritaire), historique des états prédits par tick, et réconciliation
 * (restauration depuis le snapshot + rejeu des entrées).
 *
 * Le monde appartient à l'appelant (terrain, plateformes, règles de la manche) ; le prédicteur
 * n'y fait vivre que son joueur et l'avancement de la phase de partie.
 */
export class Predictor {
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
  /** Restaurations suivies d'un rejeu (toute divergence : position, PV, munitions, état…). */
  corrections = 0;
  /** Dont celles qui ont déplacé le joueur de façon visible. */
  visibleCorrections = 0;
  resyncs = 0;
  /** Écart (unités) mesuré lors de la dernière correction. */
  lastError = 0;
  /** Événements locaux du dernier `stepTick` (son et effets du joueur). */
  readonly localEvents: LocalEvent[] = [];
  private readonly hist: HistoryEntry[] = [];
  private readonly inputs = new Uint16Array(MAX_PLAYERS);
  private readonly scratch = createOwnState();
  private live = false;

  constructor(
    readonly world: World,
    slot: number,
  ) {
    this.slot = slot;
    for (let i = 0; i < PREDICTION_HISTORY; i++) {
      this.hist.push({ tick: -1, mask: 0, own: createOwnState(), phase: 0, phaseTick: 0 });
    }
  }

  /** Dernier état prédit du joueur. */
  get player(): World['players'][number] {
    return this.world.players[this.slot];
  }

  /** Oublie l'historique (changement d'arène) : le prochain snapshot redémarre la prédiction. */
  reset(): void {
    this.started = false;
    for (const h of this.hist) h.tick = -1;
    this.smoothX = 0;
    this.smoothY = 0;
    this.localEvents.length = 0;
  }

  /** Reporte l'état de partie d'un snapshot dans le monde (phase, compteurs, mode). */
  private applyGame(g: GameSnap): void {
    const w = this.world;
    const gs = w.game;
    gs.phase = g.phase;
    gs.phaseTick = g.phaseTick;
    gs.roundTick = g.phase === GamePhase.PLAYING ? g.phaseTick : 0;
    gs.round = g.round;
    if (gs.mode !== g.mode) {
      gs.mode = g.mode;
      applyModeParams(w, g.mode);
    }
    syncSuddenGeometry(w);
  }

  /** Démarre depuis un snapshot serveur (premier snapshot, ou serveur en avance). */
  start(tick: number, own: OwnState, game: GameSnap): void {
    setTick(this.world, tick);
    importOwn(this.world, this.slot, own);
    this.applyGame(game);
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
    this.live = true;
    this.localEvents.length = 0;
    this.simulate(mask);
    this.live = false;
  }

  private simulate(mask: number): void {
    const w = this.world;
    this.inputs[this.slot] = mask;
    step(w, this.inputs);
    // Hors de la passe d'autorité : l'expiration des traits et des flaques est une fonction du tick.
    stepMarks(w);
    stepPuddles(w);
    if (this.live) this.collectEvents();
    this.tick = w.tick;
    const h = this.hist[this.tick & (PREDICTION_HISTORY - 1)];
    h.tick = this.tick;
    h.mask = mask;
    h.phase = w.game.phase;
    h.phaseTick = w.game.phaseTick;
    exportOwn(w, this.slot, h.own);
  }

  private collectEvents(): void {
    const ev = this.world.events;
    for (let i = 0; i < ev.count; i++) {
      const type = ev.type[i];
      if (!LOCAL_EVENTS.has(type) || ev.slot[i] !== this.slot) continue;
      const o = i * 6;
      this.localEvents.push({ type, x: ev.v[o], y: ev.v[o + 1], arg: ev.v[o + 2] });
    }
  }

  /** Saute directement à un tick sans simuler (reprise après une longue interruption). */
  jumpTo(tick: number): void {
    setTick(this.world, tick);
    this.tick = tick;
  }

  /** Compare le snapshot (état du tick `tick`) à l'historique et corrige si besoin. */
  reconcile(tick: number, own: OwnState, game: GameSnap): ReconcileResultId {
    if (!this.started) return ReconcileResult.Skipped;
    if (tick > this.tick) {
      // Le serveur a déjà simulé plus loin que nous : on repart de son état.
      const p = this.player;
      const bx = p.x;
      const by = p.y;
      this.start(tick, own, game);
      this.addSmooth(bx - p.x, by - p.y);
      this.resyncs++;
      return ReconcileResult.Resynced;
    }
    if (tick <= this.tick - PREDICTION_HISTORY + 1) return ReconcileResult.Skipped;
    const h = this.hist[tick & (PREDICTION_HISTORY - 1)];
    if (h.tick !== tick) return ReconcileResult.Skipped;
    if (sameOwn(h.own, own) && h.phase === game.phase && h.phaseTick === game.phaseTick) {
      return ReconcileResult.Match;
    }

    const p = this.player;
    const bx = p.x;
    const by = p.y;
    this.lastError = Math.hypot(h.own.x - own.x, h.own.y - own.y);
    const last = this.tick;
    setTick(this.world, tick);
    importOwn(this.world, this.slot, own);
    this.applyGame(game);
    copyOwnState(h.own, own);
    h.phase = game.phase;
    h.phaseTick = game.phaseTick;
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
    if (Math.hypot(bx - p.x, by - p.y) > VISIBLE_ERROR) this.visibleCorrections++;
    return ReconcileResult.Corrected;
  }

  private addSmooth(dx: number, dy: number): void {
    this.smoothX = Math.max(-SMOOTH_MAX, Math.min(SMOOTH_MAX, this.smoothX + dx));
    this.smoothY = Math.max(-SMOOTH_MAX, Math.min(SMOOTH_MAX, this.smoothY + dy));
  }

  /** Fait décroître le décalage visuel (à appeler à chaque image). */
  decaySmoothing(dtMs: number): void {
    const tau = SMOOTH_TAU_MS + SMOOTH_TAU_PER_UNIT_MS * Math.hypot(this.smoothX, this.smoothY);
    const k = Math.exp(-dtMs / tau);
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
    copyOwnState(this.scratch, h.own);
    return this.scratch;
  }
}
