import {
  CELL,
  cloneMovement,
  COMBAT,
  GamePhase,
  GRID_H,
  GRID_W,
  HISTORY_TICKS,
  MAX_GHOST_MARKS,
  MAX_MOVERS,
  MAX_OBJECTS,
  MAX_PLAYERS,
  MAX_PROJECTILES,
  MAX_PUDDLES,
  parseGrid,
  PlayerState,
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

  // --- Combat : ces champs font partie de l'état exact envoyé à son propriétaire (OwnState) ---
  hp: number;
  weapon: number;
  ammo: number;
  stun: number;
  stunImmune: number;
  hitLock: number;
  invuln: number;
  /** Phase de l'attaque en cours (`AtkPhase`) et sa variante (`AttackKind`). */
  atkPhase: number;
  atkKind: number;
  atkTicks: number;
  /** Coups déjà enchaînés (0 à 3) et temps restant pour enchaîner. */
  combo: number;
  comboWindow: number;
  /** Appui d'attaque mémorisé (ticks restants). */
  atkBuffer: number;
  chargeTicks: number;
  attackHeld: number;
  /** Ticks depuis l'appui de parade (0 = ne pare pas), et recharge. */
  blockTicks: number;
  blockCd: number;
  pickupCd: number;
  /** Direction de visée (0 à 7, voir `AIM_DX`). */
  aim: number;
  grappleTicks: number;
  grappleX: number;
  grappleY: number;
  /** Fantôme, mort, porteur de bombe, coup de pied en cours. */
  ghost: boolean;
  dead: boolean;
  hasBomb: boolean;
  kicking: boolean;
  respawnTimer: number;
  ghostX: number;
  ghostY: number;
  ghostCd: number;

  // --- Côté serveur seulement ---
  /** Joueurs déjà touchés par l'attaque en cours (un bit par emplacement). */
  hitMask: number;
  /** Actions demandées ce tick, résolues par la passe d'autorité. */
  wantFire: boolean;
  wantThrow: boolean;
  wantPickup: boolean;
  wantDrop: boolean;
  /** Arme lancée ce tick (identifiant et munitions), résolue par la passe d'autorité. */
  throwW: number;
  throwA: number;
  /** Retard de compensation de latence (ticks) lu dans l'entrée. */
  rewind: number;
  lastAttacker: number;
  lastAttackTick: number;
  /** Tick de la dernière touche reçue / du dernier coup porté (pour les enchaînements). */
  lastHitTick: number;
  combos: number;
  hazardCd: number;
  tackCd: number;
  bombFuse: number;
  bombPassCd: number;
  /** Multiplicateur de vitesse de déplacement du tick (actions, bouclier). */
  moveMul: number;
  ctrlLocked: boolean;
  jumpLocked: boolean;
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

/** Objet dynamique : arme au sol, caisse, ballon, punaise, mine, boule. `x` centre, `y` bas. */
export interface Obj {
  active: boolean;
  uid: number;
  type: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  grounded: boolean;
  /** Arme (objet arme) ou points de vie (caisse, ballon). */
  a: number;
  /** Munitions (arme) ; mine : 1 si armée. */
  b: number;
  owner: number;
  team: number;
  /** Ticks restants avant disparition (0 = permanent). */
  life: number;
  /** Compteur libre : armement d'une mine, remise en jeu de la boule… */
  timer: number;
}

export interface Proj {
  active: boolean;
  uid: number;
  type: number;
  /** Centre. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  weapon: number;
  ammo: number;
  /** Ticks écoulés depuis le tir. */
  age: number;
  life: number;
  bounces: number;
  /** Joueurs déjà touchés (un bit par emplacement), pour les projectiles qui rebondissent. */
  hitMask: number;
}

export interface Puddle {
  active: boolean;
  x0: number;
  x1: number;
  y: number;
  expire: number;
}

/** Trait ou goutte posé par un fantôme ; restitue les cellules d'origine à l'expiration. */
export interface Mark {
  active: boolean;
  kind: number;
  expire: number;
  /** Cellules modifiées : jusqu'à 3 (indices dans la grille, -1 = inutilisée). */
  c0: number;
  c1: number;
  c2: number;
  owner: number;
}

export interface WeaponSpawn {
  active: boolean;
  uid: number;
  x: number;
  y: number;
  weapon: number;
  at: number;
}

export const MAX_SIM_EVENTS = 128;
export const EVENT_STRIDE = 6;

export interface EventBuffer {
  count: number;
  type: Uint8Array;
  slot: Uint8Array;
  /** `EVENT_STRIDE` arguments par événement. */
  v: Float64Array;
}

/** Réglages de partie lus par la simulation (copie des réglages de l'hôte). */
export interface Rules {
  friendlyFire: boolean;
  weapons: boolean;
  ghosts: boolean;
  /** Ticks de manche avant la mort subite ; 0 = jamais (la limite absolue reste en vigueur). */
  suddenAfterTicks: number;
  roundsToWin: number;
  teamsMode: boolean;
  teamCount: number;
  bonusModes: number[];
  bonusEvery: number;
}

export interface GameState {
  phase: number;
  /** Ticks depuis le début de la phase. */
  phaseTick: number;
  /** Numéro de la manche (0 = salon d'attente). */
  round: number;
  mode: number;
  /** Ticks depuis le début du combat de la manche. */
  roundTick: number;
  /** Manches gagnées, par équipe (en chacun pour soi : par emplacement). */
  scores: Int16Array;
  /** Gagnant de la dernière manche (équipe) ou -1. */
  roundWinner: number;
  matchWinner: number;
  suddenStarted: boolean;
  /** Niveau de l'encre (y, unités) : WORLD_H tant que rien ne monte. */
  inkY: number;
  /** Largeur déchirée de chaque bord (unités). */
  tear: number;
  weaponTimer: number;
  /** Données propres au mode (voir `modes.ts`). */
  modeData: Int32Array;
  commonWeapon: number;
  /** Arène précédente (indice dans le pool) pour éviter de la rejouer deux fois de suite. */
  lastArena: number;
  nextUid: number;
}

export interface PendingHit {
  victim: number;
  attacker: number;
  damage: number;
  kbx: number;
  kby: number;
  stun: number;
  cause: number;
  /** Traverse la parade normale. */
  pierce: boolean;
  /** Coup à distance (balle, projectile) : le bouclier le bloque. */
  ranged: boolean;
  /** Fort (affichage). */
  heavy: boolean;
  /** Point d'impact, pour l'événement. */
  x: number;
  y: number;
  /** Le coup ignore la parade (explosion, décor). */
  unblockable: boolean;
}

export interface Stats {
  kos: Int32Array;
  deaths: Int32Array;
  damage: Int32Array;
  bestCombo: Int32Array;
  silly: Int32Array;
}

export interface World {
  tick: number;
  arena: ArenaData;
  cells: Uint8Array;
  /** Incrémenté à chaque modification du terrain (le rendu redessine). */
  terrainVersion: number;
  params: MovementParams;
  /** Constantes de mouvement de base (réglées en développement) ; `params` en dérive par mode. */
  baseParams: MovementParams;
  players: Player[];
  movers: Mover[];
  moverCount: number;
  /** Points d'apparition en unités (pieds au milieu de la cellule). */
  spawnX: Float64Array;
  spawnY: Float64Array;
  spawnCount: number;
  weaponSpawnX: Float64Array;
  weaponSpawnY: Float64Array;
  weaponSpawnCount: number;
  rng: Rng;
  events: EventBuffer;
  /** Vrai sur le serveur et en jeu hors ligne ; faux dans le monde de prédiction du client. */
  auth: boolean;
  rules: Rules;
  game: GameState;
  /** Arènes tirables au sort pour les manches. */
  arenaPool: ArenaData[];
  /** Joueurs qui participent à la partie (les autres sont absents ou spectateurs). */
  inMatch: Uint8Array;
  /** Équipe de chaque emplacement (en chacun pour soi : l'emplacement lui-même). */
  team: Int8Array;
  /** Camp (0 ou 1) de chaque emplacement à la boulette-ball. */
  side: Int8Array;
  objects: Obj[];
  projectiles: Proj[];
  puddles: Puddle[];
  marks: Mark[];
  spawns: WeaponSpawn[];
  hits: PendingHit[];
  hitCount: number;
  /** Positions des joueurs sur les derniers ticks (x, y, hauteur), pour la compensation de latence. */
  history: Float32Array;
  stats: Stats;
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
    hp: COMBAT.maxHp,
    weapon: 0,
    ammo: 0,
    stun: 0,
    stunImmune: 0,
    hitLock: 0,
    invuln: 0,
    atkPhase: 0,
    atkKind: 0,
    atkTicks: 0,
    combo: 0,
    comboWindow: 0,
    atkBuffer: 0,
    chargeTicks: 0,
    attackHeld: 0,
    blockTicks: 0,
    blockCd: 0,
    pickupCd: 0,
    aim: 0,
    grappleTicks: 0,
    grappleX: 0,
    grappleY: 0,
    ghost: false,
    dead: false,
    hasBomb: false,
    kicking: false,
    respawnTimer: 0,
    ghostX: 0,
    ghostY: 0,
    ghostCd: 0,
    hitMask: 0,
    wantFire: false,
    wantThrow: false,
    wantPickup: false,
    wantDrop: false,
    throwW: 0,
    throwA: 0,
    rewind: 0,
    lastAttacker: -1,
    lastAttackTick: -1000,
    lastHitTick: -1000,
    combos: 0,
    hazardCd: 0,
    tackCd: 0,
    bombFuse: 0,
    bombPassCd: 0,
    moveMul: 1,
    ctrlLocked: false,
    jumpLocked: false,
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

function createObj(): Obj {
  return {
    active: false,
    uid: 0,
    type: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    w: 0,
    h: 0,
    grounded: false,
    a: 0,
    b: 0,
    owner: -1,
    team: -1,
    life: 0,
    timer: 0,
  };
}

function createProj(): Proj {
  return {
    active: false,
    uid: 0,
    type: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    owner: -1,
    weapon: 0,
    ammo: 0,
    age: 0,
    life: 0,
    bounces: 0,
    hitMask: 0,
  };
}

function createGame(): GameState {
  return {
    phase: GamePhase.LOBBY,
    phaseTick: 0,
    round: 0,
    mode: 0,
    roundTick: 0,
    scores: new Int16Array(MAX_PLAYERS),
    roundWinner: -1,
    matchWinner: -1,
    suddenStarted: false,
    inkY: GRID_H * CELL,
    tear: 0,
    weaponTimer: 0,
    modeData: new Int32Array(8),
    commonWeapon: 0,
    lastArena: -1,
    nextUid: 1,
  };
}

export function defaultRules(): Rules {
  return {
    friendlyFire: false,
    weapons: true,
    ghosts: true,
    suddenAfterTicks: 75 * TICK_HZ,
    roundsToWin: 5,
    teamsMode: false,
    teamCount: 2,
    bonusModes: [],
    bonusEvery: 0,
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
  out.x = m.pathX[i]! + (m.pathX[i + 1]! - m.pathX[i]!) * f;
  out.y = m.pathY[i]! + (m.pathY[i + 1]! - m.pathY[i]!) * f;
}

const scratchPos = { x: 0, y: 0 };

/** Place les plateformes mobiles à leur position du tick courant (sans déplacement). */
export function syncMovers(world: World): void {
  for (let i = 0; i < world.moverCount; i++) {
    const m = world.movers[i]!;
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

/** Charge une arène dans un monde existant : terrain, plateformes, points d'apparition. */
export function loadArena(world: World, arena: ArenaData): void {
  world.arena = arena;
  world.cells = parseGrid(arena.grid);
  world.terrainVersion++;
  for (const m of world.movers) m.n = 0;
  const n = Math.min(arena.movers.length, MAX_MOVERS);
  for (let i = 0; i < n; i++) {
    const d = arena.movers[i]!;
    const m = world.movers[i]!;
    m.w = d.rect[2] * CELL;
    m.h = d.rect[3] * CELL;
    m.n = d.path.length;
    for (let j = 0; j < d.path.length; j++) {
      m.pathX[j] = d.path[j]![0] * CELL;
      m.pathY[j] = d.path[j]![1] * CELL;
    }
    m.periodTicks = Math.max(2, Math.round(d.period * TICK_HZ));
  }
  world.moverCount = n;

  const spawnCount = arena.spawns.players.length;
  world.spawnX = new Float64Array(spawnCount);
  world.spawnY = new Float64Array(spawnCount);
  for (let i = 0; i < spawnCount; i++) {
    const s = arena.spawns.players[i]!;
    world.spawnX[i] = (s[0] + 0.5) * CELL;
    world.spawnY[i] = (s[1] + 1) * CELL;
  }
  world.spawnCount = spawnCount;

  const wc = arena.spawns.weapons.length;
  world.weaponSpawnX = new Float64Array(wc);
  world.weaponSpawnY = new Float64Array(wc);
  for (let i = 0; i < wc; i++) {
    const s = arena.spawns.weapons[i]!;
    world.weaponSpawnX[i] = (s[0] + 0.5) * CELL;
    world.weaponSpawnY[i] = (s[1] + 1) * CELL;
  }
  world.weaponSpawnCount = wc;

  for (const o of world.objects) o.active = false;
  for (const p of world.projectiles) p.active = false;
  for (const p of world.puddles) p.active = false;
  for (const m of world.marks) m.active = false;
  for (const s of world.spawns) s.active = false;
  syncMovers(world);
}

export function createWorld(arena: ArenaData, seed: number): World {
  const players: Player[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) players.push(createPlayer());

  const movers: Mover[] = [];
  for (let i = 0; i < MAX_MOVERS; i++) movers.push(createMover());

  const objects: Obj[] = [];
  for (let i = 0; i < MAX_OBJECTS; i++) objects.push(createObj());
  const projectiles: Proj[] = [];
  for (let i = 0; i < MAX_PROJECTILES; i++) projectiles.push(createProj());
  const puddles: Puddle[] = [];
  for (let i = 0; i < MAX_PUDDLES; i++) puddles.push({ active: false, x0: 0, x1: 0, y: 0, expire: 0 });
  const marks: Mark[] = [];
  for (let i = 0; i < MAX_GHOST_MARKS; i++) {
    marks.push({ active: false, kind: 0, expire: 0, c0: -1, c1: -1, c2: -1, owner: -1 });
  }
  const spawns: WeaponSpawn[] = [];
  for (let i = 0; i < 4; i++) spawns.push({ active: false, uid: 0, x: 0, y: 0, weapon: 0, at: 0 });
  const hits: PendingHit[] = [];
  for (let i = 0; i < 64; i++) {
    hits.push({
      victim: 0,
      attacker: -1,
      damage: 0,
      kbx: 0,
      kby: 0,
      stun: 0,
      cause: 0,
      pierce: false,
      ranged: false,
      heavy: false,
      x: 0,
      y: 0,
      unblockable: false,
    });
  }

  const team = new Int8Array(MAX_PLAYERS);
  for (let i = 0; i < MAX_PLAYERS; i++) team[i] = i;

  const baseParams = cloneMovement();
  const world: World = {
    tick: 0,
    arena,
    cells: new Uint8Array(GRID_W * GRID_H),
    terrainVersion: 0,
    params: { ...baseParams },
    baseParams,
    players,
    movers,
    moverCount: 0,
    spawnX: new Float64Array(0),
    spawnY: new Float64Array(0),
    spawnCount: 0,
    weaponSpawnX: new Float64Array(0),
    weaponSpawnY: new Float64Array(0),
    weaponSpawnCount: 0,
    rng: new Rng(seed),
    events: {
      count: 0,
      type: new Uint8Array(MAX_SIM_EVENTS),
      slot: new Uint8Array(MAX_SIM_EVENTS),
      v: new Float64Array(MAX_SIM_EVENTS * EVENT_STRIDE),
    },
    auth: true,
    rules: defaultRules(),
    game: createGame(),
    arenaPool: [],
    inMatch: new Uint8Array(MAX_PLAYERS),
    team,
    side: new Int8Array(MAX_PLAYERS),
    objects,
    projectiles,
    puddles,
    marks,
    spawns,
    hits,
    hitCount: 0,
    history: new Float32Array(HISTORY_TICKS * MAX_PLAYERS * 3),
    stats: {
      kos: new Int32Array(MAX_PLAYERS),
      deaths: new Int32Array(MAX_PLAYERS),
      damage: new Int32Array(MAX_PLAYERS),
      bestCombo: new Int32Array(MAX_PLAYERS),
      silly: new Int32Array(MAX_PLAYERS),
    },
  };
  loadArena(world, arena);
  return world;
}

export function emit(
  world: World,
  type: number,
  slot: number,
  a = 0,
  b = 0,
  c = 0,
  d = 0,
  e = 0,
  f = 0,
): void {
  const ev = world.events;
  if (ev.count >= MAX_SIM_EVENTS) return;
  const i = ev.count++;
  ev.type[i] = type;
  ev.slot[i] = slot;
  const o = i * EVENT_STRIDE;
  ev.v[o] = a;
  ev.v[o + 1] = b;
  ev.v[o + 2] = c;
  ev.v[o + 3] = d;
  ev.v[o + 4] = e;
  ev.v[o + 5] = f;
}

/** Argument `k` (0 à 5) de l'événement `i`. */
export function eventArg(world: World, i: number, k: number): number {
  return world.events.v[i * EVENT_STRIDE + k]!;
}

export function newUid(world: World): number {
  const u = world.game.nextUid;
  world.game.nextUid = (u + 1) & 0xffff || 1;
  return u;
}

export const WORLD_CELLS = GRID_W * GRID_H;
