import { GamePhase, MAX_PLAYERS, ModeId, SimEvent } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { addPlayer, beginRound, createWorld, startMatch, step } from '../src/index.ts';
import type { World } from '../src/index.ts';
import { boxArena } from './helpers.ts';

/** Arène vide avec une colline au centre et deux cages aux extrémités. */
export function modeArena(): ArenaData {
  const a = boxArena();
  a.modes = {
    koth: { zone: [28, 29, 8, 4] },
    ball: {
      goals: [
        [3, 29, 3, 4],
        [58, 29, 3, 4],
      ],
    },
  };
  return a;
}

export const idle = new Uint32Array(MAX_PLAYERS);
const buf = new Uint32Array(MAX_PLAYERS);

export interface MatchOptions {
  n?: number;
  roundsToWin?: number;
  teams?: number[];
  ghosts?: boolean;
  weapons?: boolean;
  friendlyFire?: boolean;
  suddenSec?: number;
  seed?: number;
}

/** Monde avec `n` joueurs enregistrés dans la partie, avant `startMatch`. */
export function matchWorld(o: MatchOptions = {}): World {
  const n = o.n ?? 2;
  const arena = modeArena();
  const w = createWorld(arena, o.seed ?? 11);
  w.arenaPool = [arena];
  w.rules.roundsToWin = o.roundsToWin ?? 3;
  w.rules.ghosts = o.ghosts ?? true;
  w.rules.weapons = o.weapons ?? false;
  w.rules.friendlyFire = o.friendlyFire ?? false;
  w.rules.suddenAfterTicks = (o.suddenSec ?? 75) * 60;
  for (let s = 0; s < n; s++) {
    addPlayer(w, s);
    w.inMatch[s] = 1;
  }
  if (o.teams) {
    w.rules.teamsMode = true;
    for (let s = 0; s < n; s++) w.team[s] = o.teams[s]!;
  }
  for (let i = 0; i < 100; i++) step(w, idle);
  return w;
}

/** Lance la partie et avance jusqu'à la fin du décompte. */
export function startAndGo(w: World): void {
  startMatch(w);
  for (let i = 0; i < 181; i++) step(w, idle);
}

export function tickAll(w: World, n: number, masks: ArrayLike<number> = idle): void {
  buf.fill(0);
  for (let i = 0; i < masks.length; i++) buf[i] = masks[i]!;
  for (let i = 0; i < n; i++) step(w, buf);
}

export function eventsOf(w: World, type: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < w.events.count; i++) {
    if (w.events.type[i] === type)
      out.push([w.events.slot[i], ...Array.from(w.events.v.slice(i * 6, i * 6 + 6))]);
  }
  return out;
}

/** Avance jusqu'à ce que `pred` soit vrai (au plus `max` ticks) et retourne les ticks écoulés. */
export function until(
  w: World,
  max: number,
  pred: () => boolean,
  masks: ArrayLike<number> = idle,
): number {
  buf.fill(0);
  for (let i = 0; i < masks.length; i++) buf[i] = masks[i]!;
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    step(w, buf);
  }
  return max;
}

export function playing(w: World, mode: number = ModeId.FFA, arena: ArenaData = w.arena): void {
  beginRound(w, arena, mode);
  for (let i = 0; i < 181; i++) step(w, idle);
  w.game.phase = GamePhase.PLAYING;
  for (const p of w.players) p.invuln = 0;
}

export { SimEvent };
