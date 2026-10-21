import { COMBAT, GamePhase, ModeId, PlayerState, SimEvent } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { COUNTDOWN_TICKS, returnToLobby, ROUND_END_TICKS, startMatch, step } from '../src/index.ts';
import { FLOOR, ATTACK, RIGHT, pl } from './fight.ts';
import { eventsOf, idle, matchWorld, modeArena, startAndGo, tickAll, until } from './game.ts';

describe('déroulé de la partie', () => {
  it('décompte 3-2-1 : les joueurs sont placés à des points distincts et immobiles', () => {
    const w = matchWorld({ n: 4 });
    startMatch(w);
    expect(w.game.phase).toBe(GamePhase.COUNTDOWN);
    expect(w.game.round).toBe(1);
    const xs = new Set(w.players.slice(0, 4).map((p) => `${p.x},${p.y}`));
    expect(xs.size).toBe(4);
    const x0 = pl(w, 0).x;
    tickAll(w, 60, [RIGHT, RIGHT]);
    expect(pl(w, 0).x).toBeCloseTo(x0, 3);
    expect(w.game.phase).toBe(GamePhase.COUNTDOWN);
    tickAll(w, COUNTDOWN_TICKS, [RIGHT]);
    expect(w.game.phase).toBe(GamePhase.PLAYING);
    tickAll(w, 30, [RIGHT]);
    expect(pl(w, 0).x).toBeGreaterThan(x0 + 20);
  });

  it('protégés pendant le décompte, vulnérables juste après', () => {
    const w = matchWorld({ n: 2 });
    startMatch(w);
    expect(pl(w, 0).invuln).toBeGreaterThan(COUNTDOWN_TICKS);
    startAndGoRest(w);
    expect(pl(w, 0).invuln).toBeLessThanOrEqual(COMBAT.spawnInvulnTicks);
  });

  it('le dernier debout gagne la manche, puis la suivante démarre avec tout le monde en forme', () => {
    const w = matchWorld({ n: 3, ghosts: false });
    startAndGo(w);
    pl(w, 1).hp = 1;
    pl(w, 2).hp = 1;
    expect(w.game.phase).toBe(GamePhase.PLAYING);
    // le joueur 0 tue les deux autres d'un coup d'explosion
    w.players[1].y = 9999;
    w.players[2].y = 9999;
    const t = until(w, 10, () => w.game.phase === GamePhase.ROUND_END);
    expect(t).toBeLessThan(10);
    expect(w.game.scores[0]).toBe(1);
    expect(w.game.roundWinner).toBe(0);
    expect(eventsOf(w, SimEvent.ROUND_END)).toHaveLength(1);
    until(w, ROUND_END_TICKS + 5, () => w.game.round === 2);
    expect(w.game.round).toBe(2);
    expect(w.game.phase).toBe(GamePhase.COUNTDOWN);
    for (const p of w.players.slice(0, 3)) {
      expect(p.hp).toBe(100);
      expect(p.dead || p.ghost).toBe(false);
    }
  });

  it('double KO : manche sans vainqueur, aucun point', () => {
    const w = matchWorld({ n: 2, ghosts: false });
    startAndGo(w);
    w.players[0].y = 9999;
    w.players[1].y = 9999;
    until(w, 10, () => w.game.phase === GamePhase.ROUND_END);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.game.roundWinner).toBe(-1);
    expect(Array.from(w.game.scores).every((s) => s === 0)).toBe(true);
  });

  it('le premier à N manches gagne la partie', () => {
    const w = matchWorld({ n: 2, roundsToWin: 3, ghosts: false });
    startAndGo(w);
    for (let r = 1; r <= 3; r++) {
      w.players[1].y = 9999;
      until(w, 20, () => w.game.phase === GamePhase.ROUND_END);
      if (r < 3) {
        until(w, ROUND_END_TICKS + 5, () => w.game.round === r + 1);
        until(w, COUNTDOWN_TICKS + 2, () => w.game.phase === GamePhase.PLAYING);
      }
    }
    expect(w.game.matchWinner).toBe(0);
    let matchEnd = 0;
    for (let i = 0; i < ROUND_END_TICKS + 5; i++) {
      step(w, idle);
      matchEnd += eventsOf(w, SimEvent.MATCH_END).length;
    }
    expect(matchEnd).toBe(1);
    expect(w.game.phase).toBe(GamePhase.MATCH_END);
    expect(w.game.scores[0]).toBe(3);
  });

  it('retour au salon d attente : les joueurs réapparaissent, les dégâts ne comptent plus', () => {
    const w = matchWorld({ n: 2 });
    startAndGo(w);
    returnToLobby(w, modeArena());
    expect(w.game.phase).toBe(GamePhase.LOBBY);
    expect(pl(w, 0).hp).toBe(100);
    expect(w.inMatch[0]).toBe(0);
  });

  it('en équipes, la manche se joue entre équipes', () => {
    const w = matchWorld({ n: 4, teams: [0, 0, 1, 1], ghosts: false });
    startAndGo(w);
    w.players[0].y = 9999; // un coéquipier tombe : la manche continue
    tickAll(w, 5);
    expect(w.game.phase).toBe(GamePhase.PLAYING);
    w.players[2].y = 9999;
    w.players[3].y = 9999;
    until(w, 10, () => w.game.phase === GamePhase.ROUND_END);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.game.roundWinner).toBe(0);
    expect(w.game.scores[0]).toBe(1);
    expect(w.game.scores[1]).toBe(0);
  });

  it('rotation : une arène différente de la précédente quand il y en a plusieurs', () => {
    const w = matchWorld({ n: 2 });
    const a2 = modeArena();
    a2.id = 'other';
    w.arenaPool = [modeArena(), a2];
    const seen = new Set<string>();
    startMatch(w);
    seen.add(w.arena.id);
    for (let r = 0; r < 6; r++) {
      const prev = w.arena.id;
      w.game.phase = GamePhase.ROUND_END;
      w.game.phaseTick = ROUND_END_TICKS;
      step(w, idle);
      expect(w.arena.id).not.toBe(prev);
      seen.add(w.arena.id);
    }
    expect(seen.size).toBe(2);
  });

  it('un mode bonus remplace une manche sur N', () => {
    const w = matchWorld({ n: 2 });
    w.rules.bonusEvery = 3;
    w.rules.bonusModes = [ModeId.MOON];
    startMatch(w);
    const modes = [w.game.mode];
    for (let r = 0; r < 5; r++) {
      w.game.phase = GamePhase.ROUND_END;
      w.game.phaseTick = ROUND_END_TICKS;
      step(w, idle);
      modes.push(w.game.mode);
    }
    expect(modes).toEqual([
      ModeId.FFA,
      ModeId.FFA,
      ModeId.MOON,
      ModeId.FFA,
      ModeId.FFA,
      ModeId.MOON,
    ]);
  });
});

describe('mort subite', () => {
  it('l encre monte après le délai et termine la manche', () => {
    const w = matchWorld({ n: 2, suddenSec: 20 });
    startAndGo(w);
    expect(w.game.suddenStarted).toBe(false);
    tickAll(w, 20 * 60 + 5);
    expect(w.game.suddenStarted).toBe(true);
    expect(w.game.inkY).toBeLessThan(576);
    const sudden = until(w, 60 * 60, () => w.game.phase === GamePhase.ROUND_END);
    expect(sudden).toBeLessThan(60 * 60);
  });

  it('sans mort subite, une limite absolue de 5 minutes finit quand même la manche', () => {
    const w = matchWorld({ n: 2 });
    w.rules.suddenAfterTicks = 0;
    startAndGo(w);
    const t = until(w, 7 * 60 * 60, () => w.game.phase === GamePhase.ROUND_END);
    expect(t).toBeLessThan(6 * 60 * 60);
    expect(t).toBeGreaterThan(299 * 60);
  });

  it('bords déchirés : la page se referme depuis les côtés', () => {
    const w = matchWorld({ n: 2, suddenSec: 5 });
    w.arena.suddenDeath = 'tear-edges';
    startAndGo(w);
    tickAll(w, 5 * 60 + 60);
    expect(w.game.tear).toBeGreaterThan(0);
    const t = until(w, 60 * 60, () => w.game.phase === GamePhase.ROUND_END);
    expect(t).toBeLessThan(60 * 60);
  });
});

function startAndGoRest(w: ReturnType<typeof matchWorld>): void {
  for (let i = 0; i < COUNTDOWN_TICKS + 2; i++) step(w, idle);
}

void ATTACK;
void FLOOR;
void PlayerState;
