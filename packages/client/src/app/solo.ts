import {
  AttackKind,
  EVENT_SPECS,
  getArena,
  Input,
  MAX_PLAYERS,
  PlayerState,
  SimEvent,
  TICK_MS,
  createSnapshot,
  LOBBY_ARENA_ID,
  GamePhase,
} from '@stickyclaude/shared';
import type { ArenaData, Look } from '@stickyclaude/shared';
import {
  addPlayer,
  createWorld,
  fillObjects,
  fillPlayerSnap,
  fillProjectiles,
  step,
} from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';
import type { Scene } from '../render/types.ts';
import type { GameEvent } from '../net/client.ts';
import { copyObj, copyProj } from './online.ts';
import { createScene } from './scene.ts';
import { nullAudio } from './source.ts';
import type { AudioSink, RenderSource } from './source.ts';
import type { Objective } from './store.ts';

/**
 * Entraînement solo (analyse §1.9) : la même simulation que le serveur tourne **en local**, dans
 * le navigateur, sur l'arène d'entraînement. Des mannequins (immobiles, qui oscillent, ou qui
 * balancent un coup à intervalle fixe, sans jamais viser le joueur) servent de cibles, et une
 * liste d'objectifs apprend les mouvements. Aucun serveur, aucun réseau.
 */

/** Mannequins : `static` ne bouge pas, `patrol` oscille, `boxer` frappe toutes les 2,5 s. */
export type MannequinKind = 'static' | 'patrol' | 'boxer';
export const MANNEQUINS: readonly MannequinKind[] = ['static', 'patrol', 'boxer'];

export interface ObjectiveDef {
  id: string;
  goal: number;
}

/** Les objectifs du carnet, dans l'ordre où on les apprend. */
export const TRAINING_OBJECTIVES: readonly ObjectiveDef[] = [
  { id: 'run', goal: 1 },
  { id: 'jump', goal: 1 },
  { id: 'double', goal: 1 },
  { id: 'wall', goal: 1 },
  { id: 'drop', goal: 1 },
  { id: 'crouch', goal: 1 },
  { id: 'punch', goal: 3 },
  { id: 'combo', goal: 1 },
  { id: 'charged', goal: 1 },
  { id: 'kick', goal: 1 },
  { id: 'block', goal: 1 },
  { id: 'parry', goal: 1 },
  { id: 'pickup', goal: 1 },
  { id: 'shoot', goal: 3 },
  { id: 'throw', goal: 1 },
  { id: 'emote', goal: 1 },
];

const KEY = 'stickyclaude.training';
/** Résultat « rien d'accompli » : un seul tableau, jamais d'allocation par tick. */
const NONE: string[] = [];
const RUN_GOAL_UNITS = 700;
const CROUCH_GOAL_TICKS = 30;

/** Entrée d'un mannequin au tick `tick` : fonction pure du tick, jamais du joueur. */
export function mannequinInput(kind: MannequinKind, tick: number, slot: number): number {
  const t = tick + slot * 37;
  if (kind === 'patrol') {
    // 1,5 s à droite, 1,5 s à gauche
    return Math.floor(t / 90) % 2 === 0 ? Input.RIGHT : Input.LEFT;
  }
  if (kind === 'boxer') {
    const period = 150;
    const p = t % period;
    // toutes les 6 s il se retourne (une impulsion), et il frappe devant lui à chaque cycle
    const turn = Math.floor(t / (period * 3)) % 2 === 0 ? Input.RIGHT : Input.LEFT;
    if (p < 2 && t % (period * 3) < 2) return turn;
    if (p >= 70 && p < 72) return Input.ATTACK;
    return 0;
  }
  return 0;
}

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    /* illisible */
  }
  return new Set();
}

function saveDone(done: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    /* stockage indisponible */
  }
}

/** Suit l'avancement des objectifs d'après les événements de la simulation. Pur et testable. */
export class TrainingTracker {
  readonly done: Set<string>;
  private readonly count = new Map<string, number>();
  private runUnits = 0;
  private crouchTicks = 0;
  private lastX = Number.NaN;
  /** Ticks où le joueur a lancé un coup (pour reconnaître le coup chargé ou le coup de pied). */
  private lastAttackKind = 0;

  constructor(done: Iterable<string> = []) {
    this.done = new Set(done);
  }

  progress(id: string): number {
    return this.count.get(id) ?? 0;
  }

  /** Marque l'objectif progressé ; retourne vrai s'il vient d'être accompli. */
  private bump(id: string, by = 1): boolean {
    if (this.done.has(id)) return false;
    const def = TRAINING_OBJECTIVES.find((o) => o.id === id);
    if (!def) return false;
    const n = (this.count.get(id) ?? 0) + by;
    this.count.set(id, Math.min(def.goal, n));
    if (n >= def.goal) {
      this.done.add(id);
      return true;
    }
    return false;
  }

  /** À appeler à chaque tick avec l'état du joueur 0. */
  tick(state: number, grounded: boolean, x: number, atkKind: number, combos: number): string[] {
    let out = NONE;
    this.lastAttackKind = atkKind;
    if (!Number.isNaN(this.lastX) && grounded && state === PlayerState.RUN) {
      this.runUnits += Math.abs(x - this.lastX);
      if (this.runUnits >= RUN_GOAL_UNITS && this.bump('run')) out = ['run'];
    }
    this.lastX = x;
    if (state === PlayerState.CROUCH) {
      this.crouchTicks++;
      if (this.crouchTicks >= CROUCH_GOAL_TICKS && this.bump('crouch')) out = ['crouch'];
    } else this.crouchTicks = 0;
    if (combos >= 3 && this.bump('combo')) out = out === NONE ? ['combo'] : [...out, 'combo'];
    return out;
  }

  /** Événement de la simulation (même format que `world.events`). Retourne les objectifs accomplis. */
  event(type: number, slot: number, a: readonly number[]): string[] {
    const out: string[] = [];
    const add = (id: string): void => {
      if (this.bump(id)) out.push(id);
    };
    switch (type) {
      case SimEvent.JUMP:
        if (slot === 0) add('jump');
        break;
      case SimEvent.DOUBLE_JUMP:
        if (slot === 0) add('double');
        break;
      case SimEvent.WALL_JUMP:
        if (slot === 0) add('wall');
        break;
      case SimEvent.DROP_THROUGH:
        if (slot === 0) add('drop');
        break;
      case SimEvent.HIT: {
        // victime = slot ; attaquant = a[2]
        if ((a[2] ?? 255) === 0 && slot !== 0) {
          add('punch');
          if (this.lastAttackKind === AttackKind.CHARGED) add('charged');
          if (this.lastAttackKind === AttackKind.KICK) add('kick');
        }
        break;
      }
      case SimEvent.BLOCKED:
        if (slot === 0) {
          add('block');
          if ((a[3] ?? 0) === 1) add('parry');
        }
        break;
      case SimEvent.PICKUP:
        if ((a[0] ?? -1) === 0) add('pickup');
        break;
      case SimEvent.SHOT:
        if (slot === 0) add('shoot');
        break;
      case SimEvent.THROW:
        if ((a[0] ?? -1) === 0) add('throw');
        break;
      case SimEvent.EMOTE:
        if (slot === 0) add('emote');
        break;
      default:
        break;
    }
    return out;
  }

  list(): Objective[] {
    return TRAINING_OBJECTIVES.map((o) => ({
      id: o.id,
      done: this.done.has(o.id),
      progress: this.done.has(o.id) ? o.goal : (this.count.get(o.id) ?? 0),
      goal: o.goal,
    }));
  }
}

export interface SoloDeps {
  name: string;
  look: Look;
  audio?: AudioSink;
  /** Reçoit chaque événement de la simulation, à illustrer. */
  onEvent: (e: GameEvent) => void;
  /** Reçoit la liste d'objectifs à chaque changement. */
  onObjectives: (list: Objective[], justDone: string[]) => void;
  /** Gros impacts subis par le joueur (vibration). */
  onHit?: (strength: number) => void;
  /** Graine de la simulation (tests) ; par défaut tirée de l'horloge. */
  seed?: number;
}

/** Pas fixe de 60 Hz, rattrapage borné. */
const MAX_STEPS = 6;

export class SoloSource implements RenderSource {
  readonly world: World;
  readonly scene: Scene;
  readonly self = 0;
  tracker: TrainingTracker;
  paused = false;
  private acc = 0;
  private readonly inputs = new Uint16Array(MAX_PLAYERS);
  private readonly prevX = new Float64Array(MAX_PLAYERS);
  private readonly prevY = new Float64Array(MAX_PLAYERS);
  private readonly snap = createSnapshot();
  private readonly audio: AudioSink;
  private readonly kinds: (MannequinKind | null)[] = new Array<MannequinKind | null>(
    MAX_PLAYERS,
  ).fill(null);
  private readonly arena: ArenaData;
  private readonly seed: number;

  constructor(private readonly deps: SoloDeps) {
    this.audio = deps.audio ?? nullAudio;
    this.arena = getArena(LOBBY_ARENA_ID) as ArenaData;
    this.seed = deps.seed ?? (Date.now() ^ 0x5eed) >>> 0;
    this.world = createWorld(this.arena, this.seed);
    this.world.auth = true;
    this.world.rules.weapons = true;
    this.world.game.phase = GamePhase.LOBBY;
    this.scene = createScene(this.world);
    this.tracker = new TrainingTracker(loadDone());
    this.placeActors();
    this.deps.onObjectives(this.tracker.list(), []);
  }

  private placeActors(): void {
    addPlayer(this.world, 0);
    MANNEQUINS.forEach((k, i) => {
      addPlayer(this.world, i + 1);
      this.kinds[i + 1] = k;
    });
    for (let s = 0; s < MAX_PLAYERS; s++) {
      this.prevX[s] = this.world.players[s].x;
      this.prevY[s] = this.world.players[s].y;
    }
  }

  /** Efface la progression et remet les mannequins en place. */
  resetProgress(): void {
    this.tracker.done.clear();
    saveDone(this.tracker.done);
    this.deps.onObjectives(new TrainingTracker().list(), []);
    this.tracker = new TrainingTracker();
  }

  /** Emote du joueur (touches 1 à 9) : bulle ou animation, et objectif. */
  emote(id: number): void {
    const e: GameEvent = { tick: this.world.tick, type: SimEvent.EMOTE, slot: 0, a: [id] };
    this.deps.onEvent(e);
    this.audio.event(e, 0);
    this.progress(this.tracker.event(SimEvent.EMOTE, 0, [id]));
  }

  private progress(done: string[]): void {
    if (done.length === 0) return;
    saveDone(this.tracker.done);
    this.deps.onObjectives(this.tracker.list(), done);
  }

  update(input: number, _nowMs: number, dtMs: number): void {
    if (!this.paused) {
      this.acc += Math.min(100, dtMs);
      let steps = 0;
      while (this.acc >= TICK_MS && steps < MAX_STEPS) {
        this.acc -= TICK_MS;
        steps++;
        this.stepOnce(input);
      }
      if (steps === MAX_STEPS) this.acc = 0;
    }
    this.fillScene(this.acc / TICK_MS);
  }

  private stepOnce(input: number): void {
    const w = this.world;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      this.prevX[s] = w.players[s].x;
      this.prevY[s] = w.players[s].y;
    }
    this.inputs[0] = input;
    for (let s = 1; s < MAX_PLAYERS; s++) {
      const k = this.kinds[s];
      this.inputs[s] = k ? mannequinInput(k, w.tick, s) : 0;
    }
    step(w, this.inputs);
    const p0 = w.players[0];
    this.progress(this.tracker.tick(p0.state, p0.grounded, p0.x, p0.atkKind, p0.combos));
    // événements : objectifs, effets, son
    const ev = w.events;
    for (let i = 0; i < ev.count; i++) {
      const type = ev.type[i];
      const slot = ev.slot[i];
      const spec = EVENT_SPECS[type];
      const base = i * 6;
      const a: number[] = [];
      for (let k = 0; k < (spec?.length ?? 6); k++) a.push(ev.v[base + k]);
      this.progress(this.tracker.event(type, slot, a));
      if (spec !== undefined) {
        const e: GameEvent = { tick: w.tick, type, slot, a };
        this.deps.onEvent(e);
        this.audio.event(e, 0);
        if (type === SimEvent.HIT && slot === 0) this.deps.onHit?.(Math.min(1, (a[3] ?? 0) / 25));
      } else if (slot === 0 || type === SimEvent.SWING) {
        // mouvements locaux : saut, atterrissage, début de coup
        if (slot === 0) this.audio.local(type, a[0] ?? p0.x, a[1] ?? p0.y, a[2] ?? 0);
      }
    }
    if (p0.state === PlayerState.RUN && p0.grounded) this.audio.footstep(p0.x, Math.abs(p0.vx));
  }

  /** Construit la scène avec l'interpolation entre le dernier tick et le suivant. */
  private fillScene(alpha: number): void {
    const w = this.world;
    const sc = this.scene;
    let n = 0;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const p = w.players[s];
      if (!p.active) continue;
      const d = sc.players[n++];
      fillPlayerSnap(w, s, this.snap.players[0]);
      const ps = this.snap.players[0];
      d.slot = s;
      const ix = p.ghost ? ps.x : this.prevX[s] + (ps.x - this.prevX[s]) * alpha;
      const iy = p.ghost ? ps.y : this.prevY[s] + (ps.y - this.prevY[s]) * alpha;
      // une téléportation (réapparition) n'est pas interpolée
      const jump = Math.abs(ps.x - this.prevX[s]) > 60 || Math.abs(ps.y - this.prevY[s]) > 60;
      d.x = jump ? ps.x : ix;
      d.y = jump ? ps.y : iy;
      d.vx = ps.vx;
      d.vy = ps.vy;
      d.facing = p.facing;
      d.crouching = p.crouching;
      d.flags = ps.flags;
      d.state = ps.anim;
      d.animProg = ps.animProg;
      d.variant = ps.variant;
      d.hp = ps.hp;
      d.weapon = ps.weapon;
      d.ammo = ps.ammo;
      d.aim = ps.aim;
      d.self = s === 0;
      d.name = s === 0 ? this.deps.name : '';
      d.color = s === 0 ? this.deps.look.color : 9;
      d.team = -1;
      d.stroke = s === 0 ? this.deps.look.stroke : 2;
      d.hat = s === 0 ? this.deps.look.hat : 0;
      d.victory = s === 0 ? this.deps.look.victory : 0;
      d.mannequin = s !== 0;
    }
    sc.playerCount = n;
    sc.objectCount = fillObjects(w, this.snap.objects, 0);
    for (let i = 0; i < sc.objectCount; i++) copyObj(sc.objects[i], this.snap.objects[i]);
    sc.projCount = fillProjectiles(w, this.snap.projectiles);
    for (let i = 0; i < sc.projCount; i++) copyProj(sc.projectiles[i], this.snap.projectiles[i]);
    sc.moverTick = w.tick + alpha;
    sc.remoteTick = sc.moverTick;
    sc.params = w.params;
    sc.game.phase = w.game.phase;
    sc.game.mode = w.game.mode;
    sc.ghost.visible = false;
  }

  dispose(): void {
    this.paused = true;
  }
}
