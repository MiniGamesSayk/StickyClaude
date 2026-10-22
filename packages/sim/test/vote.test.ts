import { GamePhase, getArena, ROTATION_ARENA_IDS, VOTE_OPTIONS } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { resolveVote, ROUND_END_TICKS, startMatch, VOTE_SAFETY_TICKS } from '../src/index.ts';
import { matchWorld, tickAll } from './game.ts';
import { pl } from './fight.ts';
import type { World } from '../src/index.ts';

function votingWorld(pool: string[] = [...ROTATION_ARENA_IDS], seed = 5): World {
  const w = matchWorld({ n: 2, seed });
  w.arenaPool = pool.map((id) => getArena(id) as ArenaData);
  w.rules.vote = true;
  return w;
}

describe('vote de la carte', () => {
  it('avant la première manche : la partie attend, hors combat, sur la carte du salon', () => {
    const w = votingWorld();
    const lobbyArena = w.arena.id;
    startMatch(w);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.game.round).toBe(0);
    tickAll(w, 5, []);
    expect(w.voteHold).toBe(true);
    expect(w.voteCount).toBeGreaterThan(1);
    expect(w.voteCount).toBeLessThanOrEqual(VOTE_OPTIONS);
    expect(w.arena.id).toBe(lobbyArena);
    // les cartes proposées sont distinctes et dans la réserve
    const ids = Array.from(w.voteOptions.subarray(0, w.voteCount)).map((i) => w.arenaPool[i].id);
    expect(new Set(ids).size).toBe(ids.length);
    // tant que le salon n'a pas tranché, rien ne démarre
    tickAll(w, 600, []);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.game.round).toBe(0);
  });

  it('la carte votée est celle de la manche, le décompte part ensuite', () => {
    const w = votingWorld();
    startMatch(w);
    tickAll(w, 5, []);
    const wanted = w.arenaPool[w.voteOptions[2]].id;
    resolveVote(w, 2);
    tickAll(w, 2, []);
    expect(w.game.phase).toBe(GamePhase.COUNTDOWN);
    expect(w.game.round).toBe(1);
    expect(w.arena.id).toBe(wanted);
    expect(w.voteHold).toBe(false);
  });

  it('entre deux manches : nouveau vote, sans la carte qui vient d’être jouée', () => {
    const w = votingWorld();
    startMatch(w);
    tickAll(w, 5, []);
    resolveVote(w, 0);
    tickAll(w, 200, []);
    expect(w.game.phase).toBe(GamePhase.PLAYING);
    const played = w.arena.id;
    // le joueur 1 tombe : fin de manche
    pl(w, 1).y = 9999;
    for (let i = 0; i < ROUND_END_TICKS + 10 && !w.voteHold; i++) tickAll(w, 1, []);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.voteHold).toBe(true);
    const ids = Array.from(w.voteOptions.subarray(0, w.voteCount)).map((i) => w.arenaPool[i].id);
    expect(ids).not.toContain(played);
    resolveVote(w, 1);
    tickAll(w, 2, []);
    expect(w.game.round).toBe(2);
    expect(w.arena.id).toBe(ids[1]);
  });

  it('sans réponse du salon, la simulation tranche seule après le garde-fou', () => {
    const w = votingWorld();
    startMatch(w);
    tickAll(w, VOTE_SAFETY_TICKS + 20, []);
    expect(w.game.phase).toBe(GamePhase.COUNTDOWN);
    expect(w.game.round).toBe(1);
  });

  it('une seule carte possible : pas de vote', () => {
    const w = votingWorld(['brouillon']);
    startMatch(w);
    tickAll(w, 5, []);
    expect(w.voteHold).toBe(false);
    tickAll(w, 5, []);
    expect(w.game.phase).toBe(GamePhase.COUNTDOWN);
  });

  it('le vote est déterministe : même graine, mêmes cartes proposées', () => {
    const options = (seed: number): number[] => {
      const w = votingWorld(undefined, seed);
      startMatch(w);
      tickAll(w, 5, []);
      return Array.from(w.voteOptions.subarray(0, w.voteCount));
    };
    expect(options(9)).toEqual(options(9));
  });
});
