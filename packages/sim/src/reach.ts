import { Cell, CELL, GRID_H, GRID_W, Input, MAX_PLAYERS, parseGrid } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { isBlocking } from './collision.ts';
import { spawnPlayerAt } from './spawn.ts';
import { step } from './step.ts';
import { createWorld } from './world.ts';
import type { World } from './world.ts';

/**
 * Analyse d'accessibilité d'une arène (analyse §2.6), faite avec la vraie simulation : on part de
 * chaque position où l'on peut se tenir debout, on rejoue des séquences d'entrées types (course,
 * saut plein ou court, double saut à plusieurs instants, saut mural, traversée d'une plateforme à
 * sens unique) et on note où l'on retombe. Le graphe obtenu dit quelles positions sont atteignables
 * depuis quelles autres. Les plateformes mobiles sont ignorées : elles ne doivent jamais être
 * nécessaires.
 */

export interface ArenaReport {
  /** Problèmes bloquants (chaîne lisible). */
  errors: string[];
  /** Nombre de positions debout. */
  standing: number;
  /** Positions debout atteignables depuis le premier point d'apparition. */
  reachable: number;
}

interface Node {
  cx: number;
  /** Ligne de la cellule occupée par le joueur (ses pieds sont au bas de cette cellule). */
  cy: number;
}

const key = (cx: number, cy: number): number => cy * GRID_W + cx;

function cellType(cells: Uint8Array, cx: number, cy: number): number {
  if (cx < 0 || cx >= GRID_W) return Cell.SOLID;
  if (cy < 0 || cy >= GRID_H) return Cell.EMPTY;
  return cells[cy * GRID_W + cx];
}

function isSupport(t: number): boolean {
  return isBlocking(t) || t === Cell.ONEWAY;
}

/** Peut-on se tenir debout dans cette cellule (libre, tête libre, appui en dessous) ? */
export function canStand(cells: Uint8Array, cx: number, cy: number): boolean {
  if (cx < 2 || cx >= GRID_W - 2) return false;
  const here = cellType(cells, cx, cy);
  if (isBlocking(here)) return false;
  if (isBlocking(cellType(cells, cx, cy - 1))) return false;
  return isSupport(cellType(cells, cx, cy + 1));
}

/** Première cellule debout sous un point (une arme y atterrit), ou null si elle tombe dans le vide. */
export function landingBelow(cells: Uint8Array, cx: number, cy: number): Node | null {
  for (let y = cy; y < GRID_H; y++) {
    if (isBlocking(cellType(cells, cx, y))) return null;
    if (isSupport(cellType(cells, cx, y + 1))) return { cx, cy: y };
  }
  return null;
}

type Macro = {
  dir: number;
  run: number;
  hold: number;
  double: number;
  drop?: boolean;
  wall?: boolean;
};

/** Séquences d'entrées essayées depuis chaque position. */
function macros(): Macro[] {
  const out: Macro[] = [];
  for (const dir of [-1, 0, 1]) {
    for (const run of [0, 10]) {
      if (dir === 0 && run > 0) continue;
      for (const hold of [8, 60]) {
        for (const dbl of [0, 14, 28, 45]) out.push({ dir, run, hold, double: dbl });
      }
    }
  }
  out.push({ dir: -1, run: 0, hold: 0, double: 0 });
  out.push({ dir: 1, run: 0, hold: 0, double: 0 });
  out.push({ dir: 0, run: 0, hold: 0, double: 0, drop: true });
  out.push({ dir: -1, run: 0, hold: 0, double: 0, drop: true });
  out.push({ dir: 1, run: 0, hold: 0, double: 0, drop: true });
  for (const dir of [-1, 1]) out.push({ dir, run: 4, hold: 60, double: 0, wall: true });
  return out;
}

const MACROS = macros();
const inputs = new Uint16Array(MAX_PLAYERS);

/** Rejoue un macro depuis (cx, cy) ; retourne la cellule d'atterrissage, ou null. */
function simulate(world: World, from: Node, m: Macro): Node | null {
  const p = world.players[0];
  spawnPlayerAt(world, 0, (from.cx + 0.5) * CELL, (from.cy + 1) * CELL, 0);
  p.invuln = 0;
  p.grounded = true;
  p.coyote = world.params.coyoteTicks;
  p.prevInput = 0;
  p.facing = m.dir >= 0 ? 1 : -1;
  const dirBit = m.dir < 0 ? Input.LEFT : m.dir > 0 ? Input.RIGHT : 0;
  let left = false;
  let pressedJump = false;
  let dblDone = false;
  for (let t = 0; t < 240; t++) {
    let mask: number;
    if (m.drop) {
      mask = dirBit | Input.DOWN | (t === 0 ? Input.JUMP : 0);
    } else if (m.hold === 0) {
      // marche jusqu'au bord ou contre un mur
      mask = dirBit;
    } else if (t < m.run) {
      mask = dirBit;
    } else if (t === m.run) {
      mask = dirBit | Input.JUMP;
      pressedJump = true;
    } else if (t - m.run < m.hold) {
      mask = dirBit | Input.JUMP;
    } else {
      mask = dirBit;
    }
    if (pressedJump && m.double > 0 && t === m.run + m.double && !dblDone) {
      // relâche une image puis rappuie : double saut
      mask = dirBit | Input.JUMP;
      dblDone = true;
    } else if (pressedJump && m.double > 0 && t === m.run + m.double - 1) {
      mask = dirBit;
    }
    if (m.wall && t > 3 && t % 9 === 0) mask = dirBit | Input.JUMP;
    else if (m.wall && t > 3) mask = dirBit;
    inputs[0] = mask;
    step(world, inputs);
    if (!p.grounded) left = true;
    if (p.y > (GRID_H + 3) * CELL) return null;
    if (left && p.grounded && p.vy === 0) {
      return { cx: Math.floor(p.x / CELL), cy: Math.floor((p.y - 1) / CELL) };
    }
    if (!left && t > 30 && m.hold === 0) {
      // butée contre un mur : rien à gagner
      return null;
    }
  }
  return null;
}

/** Positions atteignables depuis `start`. */
export function reachableFrom(
  world: World,
  cells: Uint8Array,
  start: Node,
  cache: Map<number, Node[]>,
): Set<number> {
  const seen = new Set<number>([key(start.cx, start.cy)]);
  const queue: Node[] = [start];
  while (queue.length > 0) {
    const n = queue.pop()!;
    const k = key(n.cx, n.cy);
    let edges = cache.get(k);
    if (!edges) {
      edges = [];
      // Marcher sur la plateforme : les cellules voisines à la même hauteur.
      for (const dx of [-1, 1]) {
        if (canStand(cells, n.cx + dx, n.cy)) edges.push({ cx: n.cx + dx, cy: n.cy });
      }
      for (const m of MACROS) {
        const to = simulate(world, n, m);
        if (to && canStand(cells, to.cx, to.cy)) edges.push(to);
      }
      cache.set(k, edges);
    }
    for (const to of edges) {
      const kk = key(to.cx, to.cy);
      if (!seen.has(kk)) {
        seen.add(kk);
        queue.push(to);
      }
    }
  }
  return seen;
}

/**
 * Vérifie une arène : cellules d'apparition, accessibilité, zones de mode.
 *
 * `reach: false` saute l'accessibilité par simulation (la partie lourde : plusieurs secondes sur
 * une arène très ouverte) et ne garde que les contrôles de cases, d'apparitions, de zones et de
 * plateformes : c'est ce que fait le serveur pour un niveau de joueur, le créateur de niveau ayant
 * déjà fait l'analyse complète chez le joueur.
 */
export function analyzeArena(arena: ArenaData, opts: { reach?: boolean } = {}): ArenaReport {
  const reach = opts.reach !== false;
  const errors: string[] = [];
  const cells = parseGrid(arena.grid);
  let standing = 0;
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) if (canStand(cells, cx, cy)) standing++;
  }

  // Points d'apparition : libres, tête libre, appui dessous.
  const spawns: Node[] = [];
  for (const [x, y] of arena.spawns.players) {
    if (!canStand(cells, x, y)) {
      errors.push(`apparition joueur (${x},${y}) : pas de place pour se tenir debout`);
      continue;
    }
    spawns.push({ cx: x, cy: y });
  }
  if (arena.spawns.players.length < MAX_PLAYERS) {
    errors.push(`il faut au moins ${MAX_PLAYERS} points d'apparition`);
  }
  const seenSpawn = new Set<string>();
  for (const [x, y] of arena.spawns.players) {
    const k = `${x},${y}`;
    if (seenSpawn.has(k)) errors.push(`apparition joueur (${k}) en double`);
    seenSpawn.add(k);
  }

  // Armes : cellule libre, et l'arme doit atterrir sur un appui (pas tomber dans le vide).
  const targets: { label: string; node: Node }[] = [];
  for (const [x, y] of arena.spawns.weapons) {
    if (isBlocking(cellType(cells, x, y)) || isBlocking(cellType(cells, x, y - 1))) {
      errors.push(`apparition d'arme (${x},${y}) : dans un bloc plein`);
      continue;
    }
    const land = landingBelow(cells, x, y);
    if (!land) errors.push(`apparition d'arme (${x},${y}) : l'arme tomberait dans le vide`);
    else targets.push({ label: `arme (${x},${y})`, node: land });
  }

  // Modes.
  const koth = arena.modes?.koth;
  if (koth) {
    const [zx, zy, zw, zh] = koth.zone;
    if (zx + zw > GRID_W || zy + zh > GRID_H) errors.push('zone de la colline hors de la grille');
    let any: Node | null = null;
    for (let cy = zy; cy < zy + zh; cy++) {
      for (let cx = zx; cx < zx + zw; cx++) if (!any && canStand(cells, cx, cy)) any = { cx, cy };
    }
    if (!any) errors.push('la zone de la colline ne contient aucune position debout');
    else targets.push({ label: 'colline', node: any });
  }
  const ball = arena.modes?.ball;
  if (ball) {
    const [g0, g1] = ball.goals;
    for (const g of [g0, g1]) {
      if (g[0] + g[2] > GRID_W || g[1] + g[3] > GRID_H)
        errors.push('cage de boulette-ball hors de la grille');
    }
    const cx = ball.spawn
      ? ball.spawn[0]
      : Math.round((g0[0] + g0[2] / 2 + g1[0] + g1[2] / 2) / 2 - 0.5);
    const cy = ball.spawn ? ball.spawn[1] : Math.round((g0[1] + g0[3] + g1[1] + g1[3]) / 2 - 4);
    if (isBlocking(cellType(cells, cx, cy)) || isBlocking(cellType(cells, cx, cy - 1))) {
      errors.push(`la boule apparaîtrait dans un bloc plein (${cx},${cy})`);
    }
    for (const g of [g0, g1]) {
      let free = 0;
      for (let y = g[1]; y < g[1] + g[3]; y++) {
        for (let x = g[0]; x < g[0] + g[2]; x++) if (!isBlocking(cellType(cells, x, y))) free++;
      }
      if (free < (g[2] * g[3]) / 2) errors.push('cage de boulette-ball presque entièrement murée');
    }
  }

  // Accessibilité par simulation, sans plateformes mobiles.
  let reachable = 0;
  if (reach && spawns.length > 0) {
    const flat: ArenaData = { ...arena, movers: [] };
    const world = createWorld(flat, 1);
    world.auth = false;
    world.game.phase = 0;
    const cache = new Map<number, Node[]>();
    const first = reachableFrom(world, cells, spawns[0], cache);
    reachable = first.size;
    for (const s of spawns) {
      if (!first.has(key(s.cx, s.cy)))
        errors.push(`apparition (${s.cx},${s.cy}) inaccessible depuis la première`);
    }
    for (const t of targets) {
      if (!first.has(key(t.node.cx, t.node.cy)))
        errors.push(`${t.label} inaccessible depuis les points d'apparition`);
    }
    // Depuis chaque apparition, on doit pouvoir rejoindre toutes les autres (aucune impasse).
    for (let i = 1; i < spawns.length; i++) {
      const r = reachableFrom(world, cells, spawns[i], cache);
      if (!r.has(key(spawns[0].cx, spawns[0].cy))) {
        errors.push(
          `impasse : depuis (${spawns[i].cx},${spawns[i].cy}) on ne peut pas rejoindre la première apparition`,
        );
      }
      for (const t of targets) {
        if (!r.has(key(t.node.cx, t.node.cy))) {
          errors.push(`${t.label} inaccessible depuis (${spawns[i].cx},${spawns[i].cy})`);
        }
      }
    }
  }

  // Éléments de décor et plateformes mobiles dans la page.
  for (const m of arena.movers) {
    for (const [x, y] of m.path) {
      if (x < 0 || y < 0 || x + m.rect[2] > GRID_W || y + m.rect[3] > GRID_H + 1) {
        errors.push('plateforme mobile hors de la page');
      }
    }
  }
  for (const p of arena.props) {
    const [x, y] = p.at;
    if (isBlocking(cellType(cells, x, y))) errors.push(`${p.type} (${x},${y}) dans un bloc plein`);
  }
  return { errors, standing, reachable };
}

export interface SpawnSuggestion {
  players: [number, number][];
  weapons: [number, number][];
}

/**
 * Propose des points d'apparition pour une arène dessinée à la main (créateur de niveau) : des
 * positions debout, réparties sur la largeur, toutes **atteignables dans les deux sens** depuis une
 * même position de départ (donc sans impasse), puis quelques points d'arme parmi elles.
 * Les listes sont vides si le terrain ne contient aucune position debout.
 */
export function suggestSpawns(
  arena: ArenaData,
  wantPlayers = 12,
  wantWeapons = 4,
): SpawnSuggestion {
  const cells = parseGrid(arena.grid);
  const standing: Node[] = [];
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      if (canStand(cells, cx, cy) && cellType(cells, cx, cy) !== Cell.HAZARD) {
        standing.push({ cx, cy });
      }
    }
  }
  const none: SpawnSuggestion = { players: [], weapons: [] };
  if (standing.length === 0) return none;

  const world = createWorld({ ...arena, movers: [] }, 1);
  world.auth = false;
  world.game.phase = 0;
  const cache = new Map<number, Node[]>();

  // Départ : parmi quelques positions basses, celle d'où l'on atteint le plus de monde.
  const starts = standing
    .slice()
    .sort((a, b) => b.cy - a.cy || a.cx - b.cx)
    .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 6)) === 0)
    .slice(0, 6);
  let best: { start: Node; ok: Node[] } | null = null;
  for (const start of starts) {
    const from = reachableFrom(world, cells, start, cache);
    const reach = standing.filter((n) => from.has(key(n.cx, n.cy)));
    // on n'éprouve que des échantillons répartis sur la largeur : `cache` rend les suivants gratuits
    const sample = reach
      .slice()
      .sort((a, b) => a.cx - b.cx || a.cy - b.cy)
      .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 48)) === 0);
    const ok = sample.filter((n) => {
      if (n.cx === start.cx && n.cy === start.cy) return true;
      return reachableFrom(world, cells, n, cache).has(key(start.cx, start.cy));
    });
    if (!best || ok.length > best.ok.length) best = { start, ok };
  }
  if (!best || best.ok.length === 0) return none;

  const spread = (list: Node[], n: number): Node[] => {
    if (list.length <= n) return list.slice();
    const out: Node[] = [];
    for (let i = 0; i < n; i++) out.push(list[Math.floor(((i + 0.5) * list.length) / n)]);
    return out;
  };
  const players = spread(best.ok, wantPlayers);
  // la première apparition doit être le point de départ (l'analyse part d'elle)
  const first = players.findIndex((p) => p.cx === best.start.cx && p.cy === best.start.cy);
  if (first > 0) players.unshift(players.splice(first, 1)[0]);
  else if (first < 0) players[0] = best.start;
  const used = new Set(players.map((p) => key(p.cx, p.cy)));
  const weapons = spread(
    best.ok.filter((n) => !used.has(key(n.cx, n.cy))),
    wantWeapons,
  );
  return {
    players: players.map((p): [number, number] => [p.cx, p.cy]),
    weapons: weapons.map((p): [number, number] => [p.cx, p.cy]),
  };
}
