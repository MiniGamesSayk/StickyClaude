import {
  COMBAT,
  GamePhase,
  MODE_PARAMS,
  ModeId,
  ObjType,
  SimEvent,
  WeaponId,
  weaponDef,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { step } from '../src/index.ts';
import { ATTACK, FLOOR, JUMP, pl, RIGHT } from './fight.ts';
import { eventsOf, idle, matchWorld, playing, tickAll, until } from './game.ts';

describe('roi de la colline', () => {
  it('15 s cumulées dans la zone gagnent la manche', () => {
    const w = matchWorld({ n: 2, ghosts: false });
    playing(w, ModeId.KOTH);
    pl(w, 0).x = 32 * 16;
    pl(w, 0).y = FLOOR;
    pl(w, 1).x = 100;
    pl(w, 1).y = FLOOR;
    const t = until(w, 16 * 60, () => w.game.phase === GamePhase.ROUND_END);
    expect(t).toBeGreaterThanOrEqual(MODE_PARAMS.kothHoldTicks - 3);
    expect(t).toBeLessThan(MODE_PARAMS.kothHoldTicks + 10);
    expect(w.game.roundWinner).toBe(0);
  });

  it('à deux dans la zone, le temps ne s écoule pas', () => {
    const w = matchWorld({ n: 2, ghosts: false });
    playing(w, ModeId.KOTH);
    pl(w, 0).x = 31 * 16;
    pl(w, 1).x = 33 * 16;
    tickAll(w, 300);
    expect(w.game.modeData[0]).toBe(0);
    expect(w.game.modeData[1]).toBe(0);
    pl(w, 1).x = 100;
    tickAll(w, 60);
    expect(w.game.modeData[0]).toBeGreaterThan(50);
  });

  it('réapparition 3 s après une mort, pas de fantôme', () => {
    const w = matchWorld({ n: 2 });
    playing(w, ModeId.KOTH);
    pl(w, 1).y = 9999;
    tickAll(w, 3);
    expect(pl(w, 1).dead).toBe(true);
    expect(pl(w, 1).ghost).toBe(false);
    expect(w.game.phase).toBe(GamePhase.PLAYING);
    tickAll(w, MODE_PARAMS.kothRespawnTicks + 5);
    expect(pl(w, 1).dead).toBe(false);
    expect(pl(w, 1).hp).toBe(100);
  });

  it('sans vainqueur au bout du temps imparti, le meneur gagne', () => {
    const w = matchWorld({ n: 2, ghosts: false });
    playing(w, ModeId.KOTH);
    w.game.modeData[1] = 400;
    w.game.roundTick = MODE_PARAMS.kothMaxTicks;
    tickAll(w, 2);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.game.roundWinner).toBe(1);
  });
});

describe('boulette-ball', () => {
  it('une boule apparaît et rebondit', () => {
    const w = matchWorld({ n: 2 });
    playing(w, ModeId.BALL);
    tickAll(w, 5);
    const ball = w.objects.find((o) => o.active && o.type === ObjType.BALL);
    expect(ball).toBeDefined();
  });

  it('3 buts gagnent la manche pour le camp', () => {
    const w = matchWorld({ n: 2 });
    playing(w, ModeId.BALL);
    expect(w.side[0]).not.toBe(w.side[1]);
    const side0 = w.side[0];
    const goals = w.arena.modes!.ball!.goals;
    let goalsEvents = 0;
    for (let g = 0; g < MODE_PARAMS.ballGoals; g++) {
      until(w, 400, () => w.objects.some((o) => o.active && o.type === ObjType.BALL));
      const ball = w.objects.find((o) => o.active && o.type === ObjType.BALL)!;
      // cage i défendue par le camp i : la boule dans la cage 1 marque pour le camp 0
      const cage = side0 === 0 ? goals[1] : goals[0];
      ball.x = (cage[0] + 1) * 16;
      ball.y = (cage[1] + 2) * 16;
      ball.vx = 0;
      ball.vy = 0;
      step(w, idle);
      goalsEvents += eventsOf(w, SimEvent.GOAL).length;
      if (g < MODE_PARAMS.ballGoals - 1) expect(w.game.phase).toBe(GamePhase.PLAYING);
    }
    expect(goalsEvents).toBe(MODE_PARAMS.ballGoals);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.game.roundWinner).toBe(0);
  });

  it('un joueur peut pousser la boule en courant', () => {
    const w = matchWorld({ n: 2 });
    playing(w, ModeId.BALL);
    tickAll(w, 30);
    const ball = w.objects.find((o) => o.active && o.type === ObjType.BALL)!;
    const p = pl(w, 0);
    p.x = ball.x - 20;
    p.y = FLOOR;
    p.vx = 0;
    const x0 = ball.x;
    tickAll(w, 40, [RIGHT]);
    expect(ball.x).toBeGreaterThan(x0 + 20);
  });

  it('un coup de poing envoie la boule', () => {
    const w = matchWorld({ n: 2 });
    playing(w, ModeId.BALL);
    tickAll(w, 30);
    const ball = w.objects.find((o) => o.active && o.type === ObjType.BALL)!;
    const p = pl(w, 0);
    p.x = ball.x - 14;
    p.y = FLOOR;
    p.facing = 1;
    p.vx = 0;
    const x0 = ball.x;
    tickAll(w, 20, [ATTACK]);
    expect(ball.x).toBeGreaterThan(x0 + 30);
  });
});

describe('encre montante', () => {
  it('l encre monte dès le début', () => {
    const w = matchWorld({ n: 2 });
    playing(w, ModeId.INK_RISE);
    tickAll(w, 6 * 60);
    expect(w.game.suddenStarted).toBe(true);
    expect(w.game.inkY).toBeLessThan(576);
  });
});

describe('patate d encre', () => {
  it('une bombe passe au contact et finit par exploser sur son porteur', () => {
    const w = matchWorld({ n: 3, ghosts: false });
    playing(w, ModeId.POTATO);
    tickAll(w, 5);
    const holder = w.game.modeData[0] - 1;
    expect(holder).toBeGreaterThanOrEqual(0);
    expect(pl(w, holder).hasBomb).toBe(true);
    // tout le monde se rassemble : la bombe passe
    for (let s = 0; s < 3; s++) {
      pl(w, s).x = 300 + (s === holder ? 0 : 4);
      pl(w, s).y = FLOOR;
    }
    tickAll(w, MODE_PARAMS.potatoPassCooldownTicks + 5);
    const holder2 = w.game.modeData[0] - 1;
    expect(holder2).not.toBe(holder);
    expect(pl(w, holder2).hasBomb).toBe(true);
    expect(pl(w, holder).hasBomb).toBe(false);
    // la mèche se consume
    for (let s = 0; s < 3; s++) {
      pl(w, s).x = 100 + s * 300;
      pl(w, s).y = FLOOR;
    }
    let kos = 0;
    for (let i = 0; i < MODE_PARAMS.potatoFuseTicks + 5; i++) {
      step(w, idle);
      kos += eventsOf(w, SimEvent.KO).length;
      if (kos > 0) break;
    }
    expect(kos).toBe(1);
  });

  it('jusqu au dernier vivant', () => {
    const w = matchWorld({ n: 3, ghosts: false, seed: 4 });
    playing(w, ModeId.POTATO);
    const t = until(
      w,
      2 * MODE_PARAMS.potatoFuseTicks + 600,
      () => w.game.phase === GamePhase.ROUND_END,
    );
    // les joueurs immobiles, chacun à l'écart : la bombe explose sur chacun à son tour
    expect(t).toBeLessThan(2 * MODE_PARAMS.potatoFuseTicks + 600);
  });
});

describe('gravité lunaire', () => {
  it('les sauts sont bien plus hauts', () => {
    const apex = (mode: number): number => {
      const w = matchWorld({ n: 2 });
      playing(w, mode);
      pl(w, 0).x = 300;
      pl(w, 0).y = FLOOR;
      pl(w, 0).vy = 0;
      pl(w, 0).grounded = true;
      tickAll(w, 1);
      let top = FLOOR;
      for (let i = 0; i < 200; i++) {
        tickAll(w, 1, [JUMP]);
        top = Math.min(top, pl(w, 0).y);
      }
      return FLOOR - top;
    };
    const normal = apex(ModeId.FFA);
    const moon = apex(ModeId.MOON);
    expect(moon).toBeGreaterThan(normal * 2);
  });

  it('la gravité revient à la normale à la manche suivante', () => {
    const w = matchWorld({ n: 2 });
    playing(w, ModeId.MOON);
    const g = w.params.gravity;
    playing(w, ModeId.FFA);
    expect(w.params.gravity).toBeGreaterThan(g * 2);
  });
});

describe('même arme pour tous', () => {
  it('tout le monde commence avec la même arme et rien d autre n apparaît', () => {
    const w = matchWorld({ n: 3, weapons: true });
    playing(w, ModeId.SAME_WEAPON);
    const id = w.game.commonWeapon;
    expect(id).toBeGreaterThan(0);
    for (let s = 0; s < 3; s++) {
      expect(pl(w, s).weapon).toBe(id);
      expect(pl(w, s).ammo).toBe(weaponDef(id).ammo);
    }
    w.rules.weapons = true;
    tickAll(w, 20 * 60);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON && o.a !== id)).toBe(false);
    expect(w.spawns.some((s) => s.active)).toBe(false);
  });
});

void COMBAT;
void WeaponId;
