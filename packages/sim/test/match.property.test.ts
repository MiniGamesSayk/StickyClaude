import * as fc from 'fast-check';
import { CELL, GamePhase, GRID_W, MAX_PLAYERS, ModeId, Rng } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  createWorld,
  hashWorld,
  MAX_SIM_EVENTS,
  startMatch,
  step,
} from '../src/index.ts';
import type { World } from '../src/index.ts';
import { beginRound } from '../src/index.ts';
import { modeArena } from './game.ts';
import { overlapsSolid } from './helpers.ts';

/** Entrées aléatoires « réalistes » : appuis tenus quelques ticks, tous les boutons. */
class Bots {
  private readonly cur = new Uint32Array(MAX_PLAYERS);
  private readonly hold = new Int32Array(MAX_PLAYERS);
  constructor(private readonly rng: Rng) {}
  next(out: Uint32Array, n: number): void {
    for (let s = 0; s < n; s++) {
      if (this.hold[s] <= 0) {
        this.hold[s] = 3 + this.rng.int(30);
        const r = this.rng.nextU32();
        this.cur[s] = r & 0xff;
      }
      this.hold[s] = this.hold[s] - 1;
      out[s] = this.cur[s]!;
    }
  }
}

function setup(n: number, seed: number, weapons: boolean, ghosts: boolean): World {
  const arena = modeArena();
  const w = createWorld(arena, seed);
  w.arenaPool = [arena];
  w.rules.roundsToWin = 3;
  w.rules.weapons = weapons;
  w.rules.ghosts = ghosts;
  w.rules.suddenAfterTicks = 40 * 60;
  for (let s = 0; s < n; s++) {
    addPlayer(w, s);
    w.inMatch[s] = 1;
  }
  return w;
}

function invariants(w: World): string | null {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = w.players[s];
    if (!p.active) continue;
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      !Number.isFinite(p.vx) ||
      !Number.isFinite(p.vy)
    ) {
      return `non fini (joueur ${s})`;
    }
    if (p.hp < 0 || p.hp > 100) return `PV hors bornes (${p.hp})`;
    if (p.ammo < 0 || p.ammo > 255) return `munitions hors bornes (${p.ammo})`;
    if (!p.dead && !p.ghost && overlapsSolid(w, p)) return `joueur ${s} dans un bloc plein`;
    if (!p.dead && !p.ghost && (p.x < 0 || p.x > GRID_W * CELL))
      return `joueur ${s} hors de la page`;
  }
  if (w.events.count > MAX_SIM_EVENTS) return 'événements débordent';
  let objs = 0;
  for (const o of w.objects) if (o.active) objs++;
  if (objs > w.objects.length) return 'objets débordent';
  return null;
}

const MODES = [
  ModeId.FFA,
  ModeId.KOTH,
  ModeId.BALL,
  ModeId.INK_RISE,
  ModeId.POTATO,
  ModeId.MOON,
  ModeId.SAME_WEAPON,
];

describe('propriétés d une partie', () => {
  it('une manche se termine toujours, quel que soit le mode, et les invariants tiennent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 8 }),
        fc.constantFrom(...MODES),
        fc.boolean(),
        fc.boolean(),
        (seed, n, mode, weapons, ghosts) => {
          const w = setup(n, seed, weapons, ghosts);
          for (let i = 0; i < 100; i++) step(w, new Uint32Array(MAX_PLAYERS));
          beginRound(w, w.arena, mode);
          const bots = new Bots(new Rng(seed));
          const inputs = new Uint32Array(MAX_PLAYERS);
          let ended = false;
          for (let t = 0; t < 22_000; t++) {
            bots.next(inputs, n);
            step(w, inputs);
            const bad = invariants(w);
            if (bad) throw new Error(`${bad} (graine ${seed}, mode ${mode}, tick ${t})`);
            if (w.game.phase === GamePhase.ROUND_END) {
              ended = true;
              break;
            }
          }
          return ended;
        },
      ),
      { numRuns: 28 },
    );
  });

  it('une partie complète va jusqu au podium, avec 8 joueurs et toutes les armes', () => {
    const w = setup(8, 99, true, true);
    w.rules.bonusEvery = 2;
    w.rules.bonusModes = [...MODES.filter((m) => m !== ModeId.FFA)];
    for (let i = 0; i < 100; i++) step(w, new Uint32Array(MAX_PLAYERS));
    startMatch(w);
    const bots = new Bots(new Rng(5));
    const inputs = new Uint32Array(MAX_PLAYERS);
    let over = false;
    for (let t = 0; t < 400_000 && !over; t++) {
      bots.next(inputs, 8);
      step(w, inputs);
      const bad = invariants(w);
      if (bad) throw new Error(`${bad} (tick ${t})`);
      if (w.game.phase === GamePhase.MATCH_END) over = true;
    }
    expect(over).toBe(true);
    expect(Math.max(...w.game.scores)).toBeGreaterThanOrEqual(3);
  });

  it('même graine + mêmes entrées = même hash, combat et armes compris, sur 10 000 ticks', () => {
    const run = (): number => {
      const w = setup(8, 7, true, true);
      w.rules.bonusEvery = 2;
      w.rules.bonusModes = [ModeId.KOTH, ModeId.BALL, ModeId.POTATO, ModeId.MOON];
      for (let i = 0; i < 100; i++) step(w, new Uint32Array(MAX_PLAYERS));
      startMatch(w);
      const bots = new Bots(new Rng(3));
      const inputs = new Uint32Array(MAX_PLAYERS);
      for (let t = 0; t < 10_000; t++) {
        bots.next(inputs, 8);
        step(w, inputs);
      }
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });
});
