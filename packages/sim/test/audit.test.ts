import {
  Cause,
  CELL,
  GamePhase,
  MAX_OBJECTS,
  MODE_PARAMS,
  ModeId,
  NO_SLOT,
  ObjType,
  ProjType,
  SimEvent,
  WeaponId,
  weaponDef,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  emit,
  hashWorld,
  MAX_SIM_EVENTS,
  removePlayer,
  spawnObj,
  spawnProjectile,
  step,
} from '../src/index.ts';
import type { World } from '../src/index.ts';
import { ATTACK, DOWN, FLOOR, fightWorld, pl, tap, tick, ticks } from './fight.ts';
import { eventsOf, idle, matchWorld, modeArena, playing, tickAll } from './game.ts';

function crateAt(w: World, x: number): ReturnType<typeof spawnObj> & object {
  const c = spawnObj(w, ObjType.CRATE, x, FLOOR, 16, 16, 20, 0)!;
  c.grounded = true;
  return c;
}

/** Nombre de ticks où la valeur a changé pendant `n` ticks de jeu. */
function changes(w: World, n: number, read: () => number, ...masks: number[]): number {
  let last = read();
  let c = 0;
  for (let i = 0; i < n; i++) {
    tick(w, ...masks);
    const v = read();
    if (v !== last) c++;
    last = v;
  }
  return c;
}

describe('un coup ne touche un objet qu’une fois', () => {
  it('un seul appui accroupi inflige exactement un coup à la caisse', () => {
    const w = fightWorld({ n: 2 });
    pl(w, 1).x = 60;
    const p = pl(w, 0);
    p.x = 300;
    const crate = crateAt(w, 322);
    // l'appui est bref (un tick), le coup dure plusieurs ticks actifs
    tick(w, DOWN | ATTACK);
    const n = changes(w, 60, () => crate.a);
    expect(crate.a).toBeLessThan(20);
    expect(crate.active).toBe(true);
    // 1 coup au premier tick actif, jamais davantage
    expect(20 - crate.a).toBeLessThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(1);
  });

  it('un nouvel appui frappe de nouveau', () => {
    const w = fightWorld({ n: 2 });
    pl(w, 1).x = 60;
    pl(w, 0).x = 300;
    const crate = crateAt(w, 322);
    tap(w, 40, DOWN | ATTACK, 0);
    const first = 20 - crate.a;
    expect(first).toBeGreaterThan(0);
    tap(w, 40, DOWN | ATTACK, 0);
    expect(20 - crate.a).toBeGreaterThan(first);
  });

  it('le ballon n’est frappé qu’une fois par coup', () => {
    const w = fightWorld({ n: 2 });
    pl(w, 1).x = 60;
    pl(w, 0).x = 300;
    const ball = spawnObj(w, ObjType.BALL, 322, FLOOR, 14, 14, 0, 0)!;
    ball.grounded = false;
    tick(w, DOWN | ATTACK);
    let resets = 0;
    let lastVy = Number.NaN;
    for (let i = 0; i < 12; i++) {
      tick(w, 0);
      // la vitesse verticale décroît sous la gravité ; un nouveau coup la remettrait à sa valeur
      if (!Number.isNaN(lastVy) && ball.vy < lastVy) resets++;
      lastVy = ball.vy;
    }
    expect(resets).toBeLessThanOrEqual(1);
  });

  it('chaque joueur a sa propre mémoire de coup', () => {
    const w = fightWorld({ n: 2 });
    const crate = crateAt(w, 315);
    pl(w, 0).x = 300;
    pl(w, 1).x = 330;
    pl(w, 1).facing = -1;
    tick(w, ATTACK, ATTACK);
    ticks(w, 40, 0, 0);
    // les deux poings ont chacun frappé la caisse
    expect(crate.a).toBeLessThanOrEqual(20 - 16);
  });
});

describe('gomme et boomerang', () => {
  it('traversent un objet sans le frapper à chaque tick, et celui-ci protège le joueur derrière', () => {
    const w = fightWorld({ n: 2 });
    const def = weaponDef(WeaponId.ERASER);
    pl(w, 0).x = 120;
    pl(w, 1).x = 420;
    const crate = crateAt(w, 300);
    const hp = pl(w, 1).hp;
    spawnProjectile(
      w,
      ProjType.ERASER,
      250,
      FLOOR - 14,
      900,
      0,
      0,
      WeaponId.ERASER,
      0,
      def.life,
      def.bounces,
    );
    let crateHits = 0;
    let lastA = crate.a;
    let hpAtCrateHit = -1;
    for (let i = 0; i < 90; i++) {
      tick(w, 0, 0);
      if (crate.a !== lastA) {
        crateHits++;
        hpAtCrateHit = pl(w, 1).hp;
        lastA = crate.a;
      }
    }
    expect(crateHits).toBe(1);
    expect(hpAtCrateHit).toBe(hp);
  });
});

describe('boulette-ball sans boule', () => {
  it('la manche finit à l’heure même si la boule ne peut pas être recréée', () => {
    const w = matchWorld({ n: 2, ghosts: false });
    playing(w, ModeId.BALL, modeArena());
    const ball = w.objects.find((o) => o.active && o.type === ObjType.BALL)!;
    ball.active = false;
    // plus aucun emplacement libre
    for (const o of w.objects) {
      if (!o.active) {
        o.active = true;
        o.type = ObjType.TACK;
      }
    }
    w.game.modeData[2] = 0;
    w.game.roundTick = MODE_PARAMS.ballMaxTicks - 2;
    tickAll(w, 5);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
  });

  it('la boule est créée avant les props : une arène chargée ne lui prend pas sa place', () => {
    const arena = modeArena();
    arena.props = Array.from({ length: 40 }, (_, i) => ({
      type: 'crate' as const,
      at: [4 + (i % 20), 6 + Math.floor(i / 20) * 4] as [number, number],
    }));
    const w = matchWorld({ n: 2, ghosts: false });
    playing(w, ModeId.BALL, arena);
    const balls = w.objects.filter((o) => o.active && o.type === ObjType.BALL);
    expect(balls).toHaveLength(1);
    expect(w.objects.filter((o) => o.active)).toHaveLength(MAX_OBJECTS);
  });

  it('deux camps, deux cages : un but rapporte la manche à toutes les équipes du camp', () => {
    // 4 équipes : (0 et 2) contre (1 et 3), comme à la parité des équipes
    const w = matchWorld({ n: 4, ghosts: false, teams: [0, 1, 2, 3] });
    playing(w, ModeId.BALL, modeArena());
    expect(Array.from(w.side.subarray(0, 4))).toEqual([0, 1, 0, 1]);
    w.game.modeData[0] = MODE_PARAMS.ballGoals - 1;
    const ball = w.objects.find((o) => o.active && o.type === ObjType.BALL)!;
    const goal = w.arena.modes!.ball!.goals[1];
    ball.x = (goal[0] + 1) * CELL;
    ball.y = (goal[1] + 2) * CELL;
    ball.vx = 0;
    ball.vy = 0;
    tickAll(w, 2);
    expect(w.game.phase).toBe(GamePhase.ROUND_END);
    expect(w.game.scores[0]).toBe(1);
    expect(w.game.scores[2]).toBe(1);
    expect(w.game.scores[1]).toBe(0);
    expect(w.game.scores[3]).toBe(0);
  });
});

describe('empreinte de la simulation', () => {
  it('change dès que l’état qui influe sur la simulation change', () => {
    const base = (): World => {
      const w = fightWorld({ n: 2 });
      ticks(w, 5);
      return w;
    };
    const mutations: [string, (w: World) => void][] = [
      ['équipe', (w) => (w.team[1] = 3)],
      ['camp', (w) => (w.side[1] = 1)],
      ['participation', (w) => (w.inMatch[1] = 0)],
      [
        'flaque',
        (w) => {
          const q = w.puddles[0];
          q.active = true;
          q.x0 = 10;
          q.x1 = 50;
          q.y = 100;
          q.expire = 500;
        },
      ],
      [
        'trait de fantôme',
        (w) => {
          const m = w.marks[0];
          m.active = true;
          m.kind = 1;
          m.expire = 99;
          m.c0 = 4;
        },
      ],
      ['règle : tir allié', (w) => (w.rules.friendlyFire = !w.rules.friendlyFire)],
      ['mémoire de coup d’un joueur', (w) => (w.players[0].hitMask = 2)],
      ['dernier attaquant', (w) => (w.players[0].lastAttacker = 1)],
      [
        'taille d’un objet',
        (w) => {
          const o = spawnObj(w, ObjType.CRATE, 100, FLOOR, 16, 16, 20, 0)!;
          o.hitBy = 1;
        },
      ],
      ['gagnant de la partie', (w) => (w.game.matchWinner = 1)],
      ['prochain identifiant', (w) => (w.game.nextUid += 1)],
      ['historique de position', (w) => (w.history[3] += 1)],
    ];
    const ref = hashWorld(base());
    expect(hashWorld(base())).toBe(ref);
    const seen = new Set<number>([ref]);
    for (const [name, mutate] of mutations) {
      const w = base();
      mutate(w);
      const h = hashWorld(w);
      expect(h, name).not.toBe(ref);
      seen.add(h);
    }
    expect(seen.size).toBe(mutations.length + 1);
  });

  it('deux mondes qui jouent la même chose gardent la même empreinte', () => {
    const a = fightWorld({ n: 2 });
    const b = fightWorld({ n: 2 });
    for (let i = 0; i < 200; i++) {
      tick(a, i % 20 === 0 ? ATTACK : 0, 0);
      tick(b, i % 20 === 0 ? ATTACK : 0, 0);
    }
    expect(hashWorld(a)).toBe(hashWorld(b));
  });
});

describe('événements de simulation', () => {
  it('ceux qui dépassent la capacité sont comptés', () => {
    const w = fightWorld({ n: 2 });
    step(w, idle);
    for (let i = 0; i < MAX_SIM_EVENTS + 5; i++) emit(w, SimEvent.SWING, 0);
    expect(w.events.count).toBe(MAX_SIM_EVENTS);
    expect(w.events.dropped).toBe(5);
  });
});

describe('départ d’un joueur', () => {
  it('ses tirs s’arrêtent et ses mines n’appartiennent plus à personne', () => {
    const w = fightWorld({ n: 2 });
    const mine = spawnObj(w, ObjType.MINE, 200, FLOOR, 10, 6, 0, 1)!;
    mine.owner = 1;
    const ball = spawnObj(w, ObjType.BALL, 250, FLOOR, 14, 14, 0, 0)!;
    ball.owner = 1;
    const shot = spawnProjectile(
      w,
      ProjType.PELLET,
      100,
      100,
      200,
      0,
      1,
      WeaponId.PISTOL,
      0,
      60,
      0,
    )!;
    const other = spawnProjectile(
      w,
      ProjType.PELLET,
      100,
      120,
      200,
      0,
      0,
      WeaponId.PISTOL,
      0,
      60,
      0,
    )!;
    removePlayer(w, 1);
    expect(shot.active).toBe(false);
    expect(other.active).toBe(true);
    expect(mine.active).toBe(true);
    expect(mine.owner).toBe(-1);
    expect(ball.owner).toBe(-1);
    // un nouvel occupant du slot n'en hérite pas
    addPlayer(w, 1);
    expect(mine.owner).not.toBe(1);
  });
});

describe('patate d’encre', () => {
  it('l’explosion n’est pas créditée au porteur qui en meurt', () => {
    const w = matchWorld({ n: 3, ghosts: false });
    playing(w, ModeId.POTATO);
    tickAll(w, 5);
    const holder = w.game.modeData[0] - 1;
    for (let s = 0; s < 3; s++) {
      pl(w, s).x = 100 + s * 300;
      pl(w, s).y = FLOOR;
    }
    let ko: number[] | undefined;
    for (let i = 0; i < MODE_PARAMS.potatoFuseTicks + 5 && !ko; i++) {
      step(w, idle);
      ko = eventsOf(w, SimEvent.KO).find((e) => e[0] === holder);
    }
    expect(ko).toBeDefined();
    expect(ko![3]).toBe(NO_SLOT); // tueur : personne
    expect(ko![4]).toBe(Cause.POTATO);
    expect(w.stats.kos[holder]).toBe(0);
  });
});
