import {
  CELL,
  cloneMovement,
  GRID_H,
  GRID_W,
  MAX_MOVERS,
  MAX_PLAYERS,
  PlayerState,
  parseGrid,
  Rng,
  TICK_HZ,
} from '@stickyclaude/shared';
import type { ArenaData, MovementParams } from '@stickyclaude/shared';

export interface Player {
  active: boolean;
  /** Centre horizontal. */
  x: number;
  /** Pieds (bas de la boîte). L'axe y pointe vers le bas. */
  y: number;
  vx: number;
  vy: number;
  facing: number;
  state: number;
  stateTicks: number;
  crouching: boolean;
  grounded: boolean;
  /** Indice de la plateforme mobile qui porte le joueur, -1 sinon. */
  groundMover: number;
  doubleAvailable: boolean;
  jumping: boolean;
  coyote: number;
  jumpBuffer: number;
  wallLock: number;
  wallCoyote: number;
  dropTimer: number;
  /** Dernier côté de mur touché (-1, 0, 1), pour le saut mural tardif. */
  wallSide: number;
  prevInput: number;
  respawns: number;
  hp: number;
  weapon: number;
  ammo: number;
  aim: number;
}

export interface Mover {
  /** Taille en unités. */
  w: number;
  h: number;
  /** Position courante (coin haut-gauche) en unités : fonction pure du tick du monde. */
  x: number;
  y: number;
  /** Déplacement du dernier pas. */
  dx: number;
  dy: number;
  n: number;
  pathX: Float64Array;
  pathY: Float64Array;
  periodTicks: number;
}

export const MAX_SIM_EVENTS = 64;

export interface EventBuffer {
  count: number;
  type: Uint8Array;
  slot: Uint8Array;
  a: Float64Array;
  b: Float64Array;
}

export interface World {
  tick: number;
  arena: ArenaData;
  cells: Uint8Array;
  params: MovementParams;
  players: Player[];
  movers: Mover[];
  moverCount: number;
  /** Points d'apparition en unités (pieds au milieu de la cellule). */
  spawnX: Float64Array;
  spawnY: Float64Array;
  spawnCount: number;
  rng: Rng;
  events: EventBuffer;
}

export function createPlayer(): Player {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    state: PlayerState.IDLE,
    stateTicks: 0,
    crouching: false,
    grounded: false,
    groundMover: -1,
    doubleAvailable: true,
    jumping: false,
    coyote: 0,
    jumpBuffer: 0,
    wallLock: 0,
    wallCoyote: 0,
    dropTimer: 0,
    wallSide: 0,
    prevInput: 0,
    respawns: 0,
    hp: 100,
    weapon: 0,
    ammo: 0,
    aim: 0,
  };
}

function createMover(): Mover {
  return {
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    n: 0,
    pathX: new Float64Array(16),
    pathY: new Float64Array(16),
    periodTicks: 2,
  };
}

/** Position d'une plateforme mobile à un tick donné (fonction pure du tick). */
export function moverPosition(m: Mover, tick: number, out: { x: number; y: number }): void {
  const u = (tick % m.periodTicks) / m.periodTicks;
  const t = u < 0.5 ? u * 2 : 2 - u * 2;
  const seg = t * (m.n - 1);
  let i = Math.floor(seg);
  if (i > m.n - 2) i = m.n - 2;
  let f = seg - i;
  f = f * f * (3 - 2 * f);
  out.x = m.pathX[i] + (m.pathX[i + 1] - m.pathX[i]) * f;
  out.y = m.pathY[i] + (m.pathY[i + 1] - m.pathY[i]) * f;
}

const scratchPos = { x: 0, y: 0 };

/** Place les plateformes mobiles à leur position du tick courant (sans déplacement). */
export function syncMovers(world: World): void {
  for (let i = 0; i < world.moverCount; i++) {
    const m = world.movers[i];
    moverPosition(m, world.tick, scratchPos);
    m.x = scratchPos.x;
    m.y = scratchPos.y;
    m.dx = 0;
    m.dy = 0;
  }
}

/** Change le tick du monde (restauration de prédiction) et replace les plateformes. */
export function setTick(world: World, tick: number): void {
  world.tick = tick;
  syncMovers(world);
}

export function createWorld(arena: ArenaData, seed: number): World {
  const players: Player[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) players.push(createPlayer());

  const movers: Mover[] = [];
  for (let i = 0; i < MAX_MOVERS; i++) movers.push(createMover());
  const n = Math.min(arena.movers.length, MAX_MOVERS);
  for (let i = 0; i < n; i++) {
    const d = arena.movers[i];
    const m = movers[i];
    m.w = d.rect[2] * CELL;
    m.h = d.rect[3] * CELL;
    m.n = d.path.length;
    for (let j = 0; j < d.path.length; j++) {
      m.pathX[j] = d.path[j][0] * CELL;
      m.pathY[j] = d.path[j][1] * CELL;
    }
    m.periodTicks = Math.max(2, Math.round(d.period * TICK_HZ));
  }

  const spawnCount = arena.spawns.players.length;
  const spawnX = new Float64Array(spawnCount);
  const spawnY = new Float64Array(spawnCount);
  for (let i = 0; i < spawnCount; i++) {
    const s = arena.spawns.players[i];
    spawnX[i] = (s[0] + 0.5) * CELL;
    spawnY[i] = (s[1] + 1) * CELL;
  }

  const world: World = {
    tick: 0,
    arena,
    cells: parseGrid(arena.grid),
    params: cloneMovement(),
    players,
    movers,
    moverCount: n,
    spawnX,
    spawnY,
    spawnCount,
    rng: new Rng(seed),
    events: {
      count: 0,
      type: new Uint8Array(MAX_SIM_EVENTS),
      slot: new Uint8Array(MAX_SIM_EVENTS),
      a: new Float64Array(MAX_SIM_EVENTS),
      b: new Float64Array(MAX_SIM_EVENTS),
    },
  };
  syncMovers(world);
  return world;
}

export function emit(world: World, type: number, slot: number, a: number, b: number): void {
  const e = world.events;
  if (e.count >= MAX_SIM_EVENTS) return;
  const i = e.count++;
  e.type[i] = type;
  e.slot[i] = slot;
  e.a[i] = a;
  e.b[i] = b;
}

export const WORLD_CELLS = GRID_W * GRID_H;
