import { CELL, GamePhase, Input, MAX_PLAYERS, SimEvent, withRewind } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { addPlayer, createWorld, step } from '../src/index.ts';
import type { Player, World } from '../src/index.ts';
import { boxArena, fill, customArena } from './helpers.ts';

export const FLOOR = 33 * CELL;
export const { LEFT, RIGHT, UP, DOWN, JUMP, ATTACK, BLOCK, PICKUP } = Input;

export interface FightOptions {
  n?: number;
  arena?: ArenaData;
  ghosts?: boolean;
  friendlyFire?: boolean;
  weapons?: boolean;
  /** Équipes : team[slot]. */
  teams?: number[];
}

/**
 * Monde en phase de combat : `n` joueurs posés au sol, espacés de 30 unités à partir de x = 300,
 * tous tournés vers la droite, sans protection d'apparition.
 */
export function fightWorld(opts: FightOptions = {}): World {
  const n = opts.n ?? 2;
  const w = createWorld(opts.arena ?? boxArena(), 1);
  w.rules.ghosts = opts.ghosts ?? true;
  w.rules.friendlyFire = opts.friendlyFire ?? false;
  w.rules.weapons = opts.weapons ?? false;
  for (let s = 0; s < n; s++) {
    addPlayer(w, s);
    w.inMatch[s] = 1;
  }
  if (opts.teams) {
    w.rules.teamsMode = true;
    for (let s = 0; s < n; s++) w.team[s] = opts.teams[s]!;
  }
  const zero = new Uint16Array(MAX_PLAYERS);
  for (let i = 0; i < 100; i++) step(w, zero);
  for (let s = 0; s < n; s++) {
    const p = w.players[s]!;
    p.x = 300 + s * 30;
    p.y = FLOOR;
    p.vx = 0;
    p.vy = 0;
    p.facing = 1;
    p.invuln = 0;
  }
  w.game.phase = GamePhase.PLAYING;
  w.game.phaseTick = 0;
  return w;
}

const buf = new Uint16Array(MAX_PLAYERS);

/** Un tick avec les masques donnés (les emplacements non précisés restent à 0). */
export function tick(w: World, ...masks: number[]): void {
  buf.fill(0);
  for (let i = 0; i < masks.length; i++) buf[i] = masks[i]!;
  step(w, buf);
}

/** `n` ticks avec les mêmes masques. */
export function ticks(w: World, n: number, ...masks: number[]): void {
  for (let i = 0; i < n; i++) tick(w, ...masks);
}

/** Un tick avec compensation de latence pour le joueur `slot`. */
export function tickRewind(w: World, slot: number, mask: number, rewind: number): void {
  buf.fill(0);
  buf[slot] = withRewind(mask, rewind);
  step(w, buf);
}

export function eventCount(w: World, type: number): number {
  let n = 0;
  for (let i = 0; i < w.events.count; i++) if (w.events.type[i] === type) n++;
  return n;
}

/** Cumule les événements d'un type sur `n` ticks. */
export function countEvents(w: World, n: number, type: number, ...masks: number[]): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    tick(w, ...masks);
    c += eventCount(w, type);
  }
  return c;
}

export function pl(w: World, slot: number): Player {
  return w.players[slot]!;
}

/** Arène avec un mur de papier (colonne x0..x1, du sol jusqu'en haut). */
export function paperWall(x0: number, x1: number): ArenaData {
  return customArena((r) => {
    for (let y = 2; y < 33; y++) for (let x = 2; x < 62; x++) r[y]![x] = '.';
    for (let y = 33; y < 36; y++) for (let x = 0; x < 64; x++) r[y]![x] = '#';
    fill(r, x0, 20, x1, 32, 'p');
  });
}

export { SimEvent };
