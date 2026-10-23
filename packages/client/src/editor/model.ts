import { Cell, GRID_H, GRID_W, gridToRows, parseGrid } from '@stickyclaude/shared';
import type { ArenaData, DecorData, MoverData, PropData } from '@stickyclaude/shared';
import { analyzeArena } from '@stickyclaude/sim';

/**
 * Modèle de l'éditeur d'arènes (outil de développement). Pur et sans DOM : l'éditeur ne fait que
 * le dessiner et lui envoyer des clics. Le format exporté est exactement celui de
 * `packages/shared/arenas/*.json` (voir `docs/ARENES.md`).
 */

export type Rect = [number, number, number, number];
export type CellXY = [number, number];

export const Tool = {
  EMPTY: 'empty',
  SOLID: 'solid',
  PAPER: 'paper',
  ONEWAY: 'oneway',
  HAZARD: 'hazard',
  SPAWN: 'spawn',
  WEAPON: 'weapon',
  CRATE: 'crate',
  BALLOON: 'balloon',
  TACK: 'tack',
  BALL_SPAWN: 'ball-spawn',
  KOTH: 'koth',
  GOAL_A: 'goal-a',
  GOAL_B: 'goal-b',
  ERASE: 'erase',
} as const;
export type ToolId = (typeof Tool)[keyof typeof Tool];

/** Outils qui se dessinent en glissant un rectangle. */
export const RECT_TOOLS: ReadonlySet<ToolId> = new Set([Tool.KOTH, Tool.GOAL_A, Tool.GOAL_B]);

export const CELL_TOOLS: Readonly<Partial<Record<ToolId, number>>> = {
  [Tool.EMPTY]: Cell.EMPTY,
  [Tool.SOLID]: Cell.SOLID,
  [Tool.PAPER]: Cell.PAPER,
  [Tool.ONEWAY]: Cell.ONEWAY,
  [Tool.HAZARD]: Cell.HAZARD,
};

const PROP_TOOLS: Readonly<Partial<Record<ToolId, PropData['type']>>> = {
  [Tool.CRATE]: 'crate',
  [Tool.BALLOON]: 'balloon',
  [Tool.TACK]: 'tack',
};

export interface EditorState {
  id: string;
  nameFr: string;
  nameEn: string;
  theme: string;
  suddenDeath: ArenaData['suddenDeath'];
  cells: Uint8Array;
  spawns: CellXY[];
  weaponSpawns: CellXY[];
  props: PropData[];
  movers: MoverData[];
  decor: DecorData[];
  koth: Rect | null;
  goalA: Rect | null;
  goalB: Rect | null;
  ballSpawn: CellXY | null;
  /** Armes autorisées (`WeaponId`) ; null : toutes. */
  weapons: number[] | null;
}

export function emptyState(): EditorState {
  const cells = new Uint8Array(GRID_W * GRID_H);
  // Cadre plein et sol : une base utilisable tout de suite.
  for (let x = 0; x < GRID_W; x++) {
    cells[x] = Cell.SOLID;
    cells[(GRID_H - 1) * GRID_W + x] = Cell.SOLID;
  }
  for (let y = 0; y < GRID_H; y++) {
    cells[y * GRID_W] = Cell.SOLID;
    cells[y * GRID_W + GRID_W - 1] = Cell.SOLID;
  }
  const spawns: CellXY[] = [];
  for (let i = 0; i < 8; i++) spawns.push([6 + i * 7, GRID_H - 2]);
  return {
    id: 'nouvelle-arene',
    nameFr: 'Nouvelle arène',
    nameEn: 'New arena',
    theme: 'graph-paper',
    suddenDeath: 'ink-rise',
    cells,
    spawns,
    weaponSpawns: [[32, GRID_H - 2]],
    props: [],
    movers: [],
    decor: [],
    koth: [28, 28, 8, 7],
    goalA: [2, 29, 3, 6],
    goalB: [59, 29, 3, 6],
    ballSpawn: null,
    weapons: null,
  };
}

export function fromArena(a: ArenaData): EditorState {
  const ball = a.modes?.ball;
  return {
    id: a.id,
    nameFr: a.name.fr,
    nameEn: a.name.en,
    theme: a.theme,
    suddenDeath: a.suddenDeath,
    cells: parseGrid(a.grid),
    spawns: a.spawns.players.map(([x, y]): CellXY => [x, y]),
    weaponSpawns: a.spawns.weapons.map(([x, y]): CellXY => [x, y]),
    props: a.props.map((p) => ({ type: p.type, at: [p.at[0], p.at[1]] })),
    movers: structuredClone(a.movers),
    decor: structuredClone(a.decor),
    koth: a.modes?.koth ? [...a.modes.koth.zone] : null,
    goalA: ball ? [...ball.goals[0]] : null,
    goalB: ball ? [...ball.goals[1]] : null,
    ballSpawn: ball?.spawn ? [ball.spawn[0], ball.spawn[1]] : null,
    weapons: a.weapons && a.weapons.length > 0 ? [...a.weapons] : null,
  };
}

export function toArena(s: EditorState): ArenaData {
  const modes: NonNullable<ArenaData['modes']> = {};
  if (s.koth) modes.koth = { zone: [...s.koth] };
  if (s.goalA && s.goalB) {
    modes.ball = { goals: [[...s.goalA], [...s.goalB]] };
    if (s.ballSpawn) modes.ball.spawn = [...s.ballSpawn];
  }
  const arena: ArenaData = {
    id: s.id,
    name: { fr: s.nameFr, en: s.nameEn },
    theme: s.theme,
    size: [GRID_W, GRID_H],
    grid: gridToRows(s.cells),
    spawns: {
      players: s.spawns.map(([x, y]): CellXY => [x, y]),
      weapons: s.weaponSpawns.map(([x, y]): CellXY => [x, y]),
    },
    movers: structuredClone(s.movers),
    props: s.props.map((p) => ({ type: p.type, at: [p.at[0], p.at[1]] })),
    decor: structuredClone(s.decor),
    suddenDeath: s.suddenDeath,
  };
  if (Object.keys(modes).length > 0) arena.modes = modes;
  if (s.weapons && s.weapons.length > 0) arena.weapons = [...s.weapons];
  return arena;
}

export function inGrid(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

function toggle(list: CellXY[], x: number, y: number): void {
  const i = list.findIndex((c) => c[0] === x && c[1] === y);
  if (i >= 0) list.splice(i, 1);
  else list.push([x, y]);
}

function removeAt(list: CellXY[], x: number, y: number): void {
  const i = list.findIndex((c) => c[0] === x && c[1] === y);
  if (i >= 0) list.splice(i, 1);
}

/** Applique un outil « ponctuel » à une cellule (peindre, poser ou retirer un marqueur). */
export function applyTool(s: EditorState, tool: ToolId, x: number, y: number): void {
  if (!inGrid(x, y)) return;
  const cellType = CELL_TOOLS[tool];
  if (cellType !== undefined) {
    s.cells[y * GRID_W + x] = cellType;
    return;
  }
  if (tool === Tool.SPAWN) toggle(s.spawns, x, y);
  else if (tool === Tool.WEAPON) toggle(s.weaponSpawns, x, y);
  else if (tool === Tool.BALL_SPAWN) s.ballSpawn = [x, y];
  else if (tool === Tool.ERASE) {
    s.cells[y * GRID_W + x] = Cell.EMPTY;
    removeAt(s.spawns, x, y);
    removeAt(s.weaponSpawns, x, y);
    s.props = s.props.filter((p) => p.at[0] !== x || p.at[1] !== y);
    if (s.ballSpawn && s.ballSpawn[0] === x && s.ballSpawn[1] === y) s.ballSpawn = null;
  } else {
    const type = PROP_TOOLS[tool];
    if (type) {
      const had = s.props.some((p) => p.at[0] === x && p.at[1] === y && p.type === type);
      s.props = s.props.filter((p) => p.at[0] !== x || p.at[1] !== y);
      if (!had) s.props.push({ type, at: [x, y] });
    }
  }
}

/** Définit un rectangle de mode (colline ou cage) entre deux cellules, bornes comprises. */
export function applyRect(
  s: EditorState,
  tool: ToolId,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const x = Math.max(0, Math.min(x0, x1));
  const y = Math.max(0, Math.min(y0, y1));
  const w = Math.min(GRID_W, Math.max(x0, x1) + 1) - x;
  const h = Math.min(GRID_H, Math.max(y0, y1) + 1) - y;
  if (w < 1 || h < 1) return;
  const r: Rect = [x, y, w, h];
  if (tool === Tool.KOTH) s.koth = r;
  else if (tool === Tool.GOAL_A) s.goalA = r;
  else if (tool === Tool.GOAL_B) s.goalB = r;
}

export interface Validation {
  /** Erreurs de schéma (zod) : l'arène ne serait pas acceptée par le serveur. */
  schema: string[];
  /** Erreurs d'accessibilité et de cohérence relevées par la simulation. */
  analysis: string[];
  standing: number;
  reachable: number;
}

/**
 * Vérifie l'arène comme le fera le serveur : schéma, puis analyse par simulation. Le schéma est
 * passé en paramètre (zod n'est pas dans le bundle du jeu : l'éditeur l'importe lui-même).
 */
export function validate(
  s: EditorState,
  parse: (a: ArenaData) => { ok: boolean; issues: string[] },
): Validation {
  const arena = toArena(s);
  const sc = parse(arena);
  if (!sc.ok) return { schema: sc.issues, analysis: [], standing: 0, reachable: 0 };
  const r = analyzeArena(arena);
  return { schema: [], analysis: r.errors, standing: r.standing, reachable: r.reachable };
}
