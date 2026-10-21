import {
  CELL,
  GamePhase,
  MAX_PLAYERS,
  ModeId,
  ObjType,
  ROTATION_ARENA_IDS,
  getArena,
} from '@stickyclaude/shared';
import type { RoomSettings } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { Bot, harness } from './helpers.ts';
import type { BotGoal, FakeConn } from './helpers.ts';

/** Plafond de manches pour 3 manches à gagner : (2 × 3 − 1) × 3. */
const ROUND_CAP = 15;

/** Une partie complète dure au plus ce nombre de ticks (ici : 2000 s). */
const MAX_TICKS = 120_000;

interface Played {
  modes: number[];
  arenas: string[];
  rounds: number;
  winner: number;
  scores: number[];
  podium: number[];
  ticks: number;
  maxTicks: number;
  errors: string[];
  closed: boolean;
}

/** Joue une partie complète, du salon au podium, avec des joueurs automatiques. */
function playMatch(
  n: number,
  settings: Partial<RoomSettings>,
  seed = 1,
  goal: BotGoal | null = null,
  maxTicks = MAX_TICKS,
): Played {
  const h = harness({ MATCH_END_MS: '500' });
  const host = h.connect('10.0.0.1');
  const code = h.create(host, 'Hôte');
  const conns: FakeConn[] = [host];
  for (let i = 1; i < n; i++) {
    const c = h.connect(`10.0.0.${i + 1}`);
    h.join(c, code, `Joueur${i}`);
    conns.push(c);
  }
  h.settings(host, { roundsToWin: 3, suddenDeathSec: 20, bonusEvery: 0, ...settings });
  h.startMatch(host, conns.slice(1));
  const room = h.room(code);
  const bots = conns.map((c, i) => new Bot(h, c, seed * 100 + i, goal));
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    for (const b of bots) b.act(code);
    h.advance(1);
    if (room.phase === GamePhase.MATCH_END) break;
  }
  const results = host.lastOf('results');
  const rounds = host.of('round');
  const errors = conns.flatMap((c) => c.of('error').map((e) => e.code));
  // retour au salon d'attente après le podium
  h.advance(60);
  expect(room.phase).toBe(GamePhase.LOBBY);
  expect(host.lastOf('lobby')!.lobby.phase).toBe(GamePhase.LOBBY);
  return {
    modes: rounds.map((r) => r.round.mode),
    arenas: rounds.map((r) => r.round.arena),
    rounds: host.of('scores').length,
    winner: results?.winner ?? -1,
    scores: results?.scores ?? [],
    podium: results?.podium ?? [],
    ticks,
    maxTicks,
    errors,
    closed: conns.some((c) => c.closed !== null),
  };
}

const SIZES = [2, 4, 8];

function expectClean(p: Played): void {
  expect(p.errors).toEqual([]);
  expect(p.closed).toBe(false);
  expect(p.winner).toBeGreaterThanOrEqual(0);
  expect(p.podium.length).toBeGreaterThanOrEqual(2);
  // Le vainqueur a 3 manches, ou la partie a atteint le plafond de manches (tranchée au score).
  expect(Math.max(...p.scores) >= 3 || p.rounds >= ROUND_CAP).toBe(true);
  expect(p.podium[0]).toBe(p.winner);
  expect(p.rounds).toBeGreaterThanOrEqual(3);
  expect(p.ticks).toBeLessThan(p.maxTicks);
}

// Une partie complète simule jusqu'à 2000 s de jeu : de quelques secondes à plus d'une minute de calcul.
describe('parties complètes : du salon au podium', { timeout: 300_000 }, () => {
  for (const n of SIZES) {
    it(`chacun pour soi à ${n} joueurs`, () => {
      const p = playMatch(n, { mode: 'ffa' });
      expectClean(p);
      expect(p.modes.every((m) => m === ModeId.FFA)).toBe(true);
      expect(p.podium).toHaveLength(n);
    });

    if (n >= 4) {
      it(`équipes sans tir ami à ${n} joueurs`, () => {
        const p = playMatch(n, { mode: 'teams', teams: 2, friendlyFire: false });
        expectClean(p);
        expect(p.modes.every((m) => m === ModeId.TEAMS)).toBe(true);
        expect(p.podium).toHaveLength(2);
      });

      it(`équipes avec tir ami à ${n} joueurs`, () => {
        const p = playMatch(n, { mode: 'teams', teams: 2, friendlyFire: true }, 3);
        expectClean(p);
        expect(p.podium).toHaveLength(2);
      });
    }

    if (n === 8) {
      it('quatre équipes de deux', () => {
        const p = playMatch(8, { mode: 'teams', teams: 4 }, 4);
        expectClean(p);
        expect(p.podium).toHaveLength(4);
      });
    }
  }

  const BONUS: [string, number][] = [
    ['roi de la colline', ModeId.KOTH],
    ['boulette-ball', ModeId.BALL],
    ['encre montante', ModeId.INK_RISE],
    ['patate d’encre', ModeId.POTATO],
    ['gravité lunaire', ModeId.MOON],
    ['même arme pour tous', ModeId.SAME_WEAPON],
  ];
  /** Les joueurs automatiques vont vers la colline, ou vers la boule (sans cela, aucun but). */
  const GOALS: Partial<Record<number, BotGoal>> = {
    [ModeId.KOTH]: (room) => {
      const z = room.world.arena.modes?.koth?.zone;
      return z ? { x: (z[0] + z[2] / 2) * CELL, y: (z[1] + z[3]) * CELL } : null;
    },
    [ModeId.BALL]: (room) => {
      for (const o of room.world.objects) {
        if (o.active && o.type === ObjType.BALL) return { x: o.x, y: o.y };
      }
      return null;
    },
  };
  for (const [label, mode] of BONUS) {
    for (const n of SIZES) {
      it(`mode bonus « ${label} » à ${n} joueurs`, () => {
        // Un match de boulette-ball peut aller jusqu'au plafond de manches (matchs nuls à 150 s).
        const maxTicks = mode === ModeId.BALL ? 260_000 : MAX_TICKS;
        const p = playMatch(
          n,
          { bonusEvery: 1, bonusModes: [mode], mode: 'ffa' },
          mode + n,
          GOALS[mode] ?? null,
          maxTicks,
        );
        expectClean(p);
        expect(p.modes.every((m) => m === mode)).toBe(true);
      });
    }
  }

  it('les modes bonus en rotation : une manche sur trois', () => {
    const p = playMatch(4, { bonusEvery: 3, bonusModes: [ModeId.MOON, ModeId.POTATO] }, 9);
    expectClean(p);
    p.modes.forEach((m, i) => {
      const round = i + 1;
      if (round % 3 === 0) expect([ModeId.MOON, ModeId.POTATO]).toContain(m);
      else expect(m).toBe(ModeId.FFA);
    });
  });

  it('les armes désactivées : aucune arme dans les snapshots', () => {
    const h = harness({ MATCH_END_MS: '500' });
    const a = h.connect('10.0.0.1');
    const b = h.connect('10.0.0.2');
    const code = h.create(a);
    h.join(b, code);
    h.settings(a, { weapons: false, roundsToWin: 3, suddenDeathSec: 20 });
    h.startMatch(a, [b]);
    const bots = [new Bot(h, a, 1), new Bot(h, b, 2)];
    let weaponSeen = false;
    for (let t = 0; t < 5000; t++) {
      for (const bot of bots) bot.act(code);
      h.advance(1);
      const s = a.lastSnapshot();
      if (s && s.objects.slice(0, s.objectCount).some((o) => o.type === 1)) weaponSeen = true;
    }
    expect(weaponSeen).toBe(false);
  });

  it('chaque arène de la rotation est jouable', () => {
    const seen = new Set<string>();
    const settings = {
      arenas: [] as string[],
      roundsToWin: 7,
      suddenDeathSec: 20,
    } satisfies Partial<RoomSettings>;
    for (let seed = 1; seed <= 3; seed++) {
      const h = harness({ MATCH_END_MS: '300' });
      const a = h.connect('10.0.0.1');
      const b = h.connect('10.0.0.2');
      const code = h.create(a);
      h.join(b, code);
      h.settings(a, settings);
      h.startMatch(a, [b]);
      const bots = [new Bot(h, a, seed), new Bot(h, b, seed + 7)];
      const room = h.room(code);
      for (let t = 0; t < 30_000 && room.phase !== GamePhase.MATCH_END; t++) {
        for (const bot of bots) bot.act(code);
        h.advance(1);
        seen.add(room.world.arena.id);
      }
    }
    for (const id of seen) expect(ROTATION_ARENA_IDS).toContain(id);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(getArena('partition')).toBeDefined();
    expect(MAX_PLAYERS).toBe(8);
  });
});
