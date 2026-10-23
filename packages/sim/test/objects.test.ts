import {
  Cause,
  Cell,
  CELL,
  COMBAT,
  GamePhase,
  GRID_W,
  ObjType,
  SimEvent,
  WeaponId,
} from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import {
  itemInterval,
  maxGroundHearts,
  maxGroundWeapons,
  randomWeapon,
  spawnObj,
  spawnProps,
  spawnWeaponObj,
  WEAPON_DRAW_TICKS,
} from '../src/index.ts';
import {
  ATTACK,
  FLOOR,
  PICKUP,
  RIGHT,
  countEvents,
  eventCount,
  fightWorld,
  pl,
  tick,
  ticks,
} from './fight.ts';
import { boxArena } from './helpers.ts';

function arenaWithProps(props: ArenaData['props']): ArenaData {
  const a = boxArena();
  a.props = props;
  return a;
}

describe('caisses', () => {
  it('se poussent en marchant dedans', () => {
    const w = fightWorld({ arena: arenaWithProps([{ type: 'crate', at: [20, 32] }]) });
    spawnProps(w);
    const crate = w.objects.find((o) => o.active && o.type === ObjType.CRATE)!;
    expect(crate).toBeDefined();
    const p = pl(w, 0);
    p.x = crate.x - 20;
    p.y = FLOOR;
    const x0 = crate.x;
    ticks(w, 40, RIGHT);
    expect(crate.x).toBeGreaterThan(x0 + 8);
    // le joueur n'est pas bloqué par la caisse
    expect(p.x).toBeGreaterThan(x0);
  });

  it('se cassent sous les coups et peuvent laisser une arme', () => {
    const w = fightWorld({
      arena: arenaWithProps([{ type: 'crate', at: [20, 32] }]),
      weapons: true,
    });
    spawnProps(w);
    const crate = w.objects.find((o) => o.active && o.type === ObjType.CRATE)!;
    const p = pl(w, 0);
    p.x = crate.x - 24;
    p.y = FLOOR;
    p.facing = 1;
    let broke = 0;
    for (let i = 0; i < 200 && broke === 0; i++) {
      tick(w, i % 14 === 0 ? ATTACK : 0);
      broke += eventCount(w, SimEvent.CRATE_BREAK);
    }
    expect(broke).toBe(1);
    // l'emplacement de la caisse a pu être réutilisé par l'arme qu'elle contenait
    expect(crate.active && crate.type === ObjType.CRATE).toBe(false);
  });

  it('se portent et se lancent : dégâts puis casse', () => {
    const w = fightWorld({ arena: arenaWithProps([{ type: 'crate', at: [19, 32] }]) });
    spawnProps(w);
    const crate = w.objects.find((o) => o.active && o.type === ObjType.CRATE)!;
    const p = pl(w, 0);
    p.x = crate.x;
    p.y = FLOOR;
    tick(w, PICKUP);
    expect(p.weapon).toBe(WeaponId.CRATE);
    expect(crate.active).toBe(false);
    pl(w, 1).x = p.x + 60;
    ticks(w, 8, 0);
    tick(w, ATTACK | RIGHT);
    ticks(w, 50, 0);
    expect(pl(w, 1).hp).toBe(100 - COMBAT.crateThrowDamage);
    expect(w.projectiles.some((q) => q.active)).toBe(false);
  });
});

describe('ballons', () => {
  it('flottent vers le haut et éclatent sous un coup en blessant à côté', () => {
    const w = fightWorld({ arena: arenaWithProps([{ type: 'balloon', at: [20, 31] }]) });
    spawnProps(w);
    const b = w.objects.find((o) => o.active && o.type === ObjType.BALLOON)!;
    const y0 = b.y;
    ticks(w, 30, 0);
    expect(b.y).toBeLessThan(y0 - 10);
    const p = pl(w, 0);
    const q = pl(w, 1);
    b.y = FLOOR - 10;
    b.x = 300 + 20;
    p.x = 300;
    q.x = 300 + 36;
    let pops = 0;
    for (let i = 0; i < 20; i++) {
      tick(w, i === 0 ? ATTACK : 0);
      pops += eventCount(w, SimEvent.EXPLOSION);
      b.y = Math.min(b.y, FLOOR - 10);
    }
    expect(pops).toBe(1);
    expect(b.active).toBe(false);
    expect(q.hp).toBeLessThan(100);
  });

  it('finissent par éclater au bout de 30 s', () => {
    const w = fightWorld({ arena: arenaWithProps([{ type: 'balloon', at: [20, 31] }]) });
    spawnProps(w);
    const b = w.objects.find((o) => o.active && o.type === ObjType.BALLOON)!;
    b.life = 5;
    ticks(w, 10, 0);
    expect(b.active).toBe(false);
  });
});

describe('punaises', () => {
  it('blessent au contact, une fois par seconde au plus', () => {
    const w = fightWorld({ arena: arenaWithProps([{ type: 'tack', at: [20, 32] }]) });
    spawnProps(w);
    const t = w.objects.find((o) => o.active && o.type === ObjType.TACK)!;
    const p = pl(w, 0);
    p.x = t.x;
    p.y = FLOOR;
    tick(w, 0);
    expect(p.hp).toBe(100 - COMBAT.tackDamage);
    expect(p.vy).toBeLessThan(-100);
    p.x = t.x;
    p.y = FLOOR;
    ticks(w, 5, 0);
    p.x = t.x;
    p.y = FLOOR;
    tick(w, 0);
    expect(p.hp).toBe(100 - COMBAT.tackDamage);
  });

  it('tuent avec la bonne cause', () => {
    const w = fightWorld({
      arena: arenaWithProps([{ type: 'tack', at: [20, 32] }]),
      ghosts: false,
    });
    spawnProps(w);
    const t = w.objects.find((o) => o.active && o.type === ObjType.TACK)!;
    const p = pl(w, 0);
    p.hp = 3;
    p.x = t.x;
    p.y = FLOOR;
    let cause = -1;
    for (let i = 0; i < 3; i++) {
      tick(w, 0);
      for (let k = 0; k < w.events.count; k++) {
        if (w.events.type[k] === SimEvent.KO) cause = w.events.v[k * 6 + 3]!;
      }
    }
    expect(cause).toBe(Cause.TACK);
  });
});

describe('cellules de danger', () => {
  it('blessent et font rebondir', () => {
    const a = boxArena();
    const rows = a.grid.map((r) => r.split(''));
    for (let x = 18; x <= 22; x++) rows[32][x] = '^';
    a.grid = rows.map((r) => r.join(''));
    const w = fightWorld({ arena: a });
    const p = pl(w, 0);
    p.x = 20 * CELL + 8;
    p.y = FLOOR;
    tick(w, 0);
    expect(p.hp).toBe(100 - COMBAT.hazardDamage);
    expect(p.vy).toBeLessThan(-100);
    expect(w.cells[32 * GRID_W + 20]).toBe(Cell.HAZARD);
  });
});

describe('apparition des armes', () => {
  function weaponWorld(): ReturnType<typeof fightWorld> {
    const a = boxArena();
    a.spawns.weapons = [
      [10, 32],
      [30, 32],
      [50, 32],
    ];
    const w = fightWorld({ arena: a, weapons: true });
    for (const o of w.objects) o.active = false;
    for (const s of w.spawns) s.active = false;
    w.game.weaponTimer = 400;
    return w;
  }

  it('un dessin au crayon (événement), puis l arme tombe', () => {
    const w = weaponWorld();
    w.game.weaponTimer = 0;
    let spawnEvents = 0;
    let appearedAt = -1;
    for (let i = 0; i < WEAPON_DRAW_TICKS + 10; i++) {
      tick(w);
      spawnEvents += eventCount(w, SimEvent.WEAPON_SPAWN);
      if (appearedAt < 0 && w.objects.some((o) => o.active && o.type === ObjType.WEAPON))
        appearedAt = i;
    }
    expect(spawnEvents).toBe(1);
    expect(appearedAt).toBeGreaterThanOrEqual(WEAPON_DRAW_TICKS - 2);
  });

  it('un point d’apparition posé en hauteur descend jusqu’au sol, un point sans sol est écarté', () => {
    const a = boxArena();
    a.spawns.weapons = [
      [10, 8], // très haut : retombe sur le sol (ligne 32)
      [20, 32],
    ];
    a.grid[34] = a.grid[34].slice(0, 40) + '.'.repeat(4) + a.grid[34].slice(44);
    a.grid[33] = a.grid[33].slice(0, 40) + '.'.repeat(4) + a.grid[33].slice(44);
    a.grid[35] = a.grid[35].slice(0, 40) + '.'.repeat(4) + a.grid[35].slice(44);
    a.spawns.weapons.push([41, 10]); // au-dessus d'un trou : pas de sol
    const w = fightWorld({ arena: a, weapons: true });
    expect(w.weaponSpawnCount).toBe(2);
    expect(w.weaponSpawnY[0]).toBe(33 * CELL);
    expect(w.weaponSpawnY[1]).toBe(33 * CELL);
  });

  it('pas deux armes au même point tant que la première n’est pas ramassée', () => {
    const a = boxArena();
    a.spawns.weapons = [[30, 32]];
    const w = fightWorld({ n: 8, arena: a, weapons: true });
    for (const o of w.objects) o.active = false;
    for (const s of w.spawns) s.active = false;
    w.game.weaponTimer = 0;
    for (let i = 0; i < 60 * 60; i++) {
      w.game.weaponTimer = Math.min(w.game.weaponTimer, 5);
      tick(w);
      const near = w.objects.filter(
        (o) => o.active && o.type === ObjType.WEAPON && Math.abs(o.x - 30.5 * CELL) < CELL,
      );
      expect(near.length).toBeLessThanOrEqual(1);
    }
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(true);
  });

  it('l’arène peut limiter les armes qui apparaissent', () => {
    const a = boxArena();
    a.weapons = [WeaponId.PISTOL, WeaponId.RULER];
    const w = fightWorld({ arena: a, weapons: true });
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(randomWeapon(w));
    expect([...seen].sort()).toEqual([WeaponId.RULER, WeaponId.PISTOL]);
    delete a.weapons;
    const all = fightWorld({ arena: a, weapons: true });
    const many = new Set<number>();
    for (let i = 0; i < 400; i++) many.add(randomWeapon(all));
    expect(many.size).toBeGreaterThan(4);
  });

  /** Joue `seconds` secondes avec `n` joueurs : maximum d'armes au sol et nombre d'apparitions. */
  function play(n: number, seconds = 90): { max: number; spawns: number } {
    const a = boxArena();
    a.spawns.weapons = [
      [6, 32],
      [16, 32],
      [26, 32],
      [36, 32],
      [46, 32],
      [56, 32],
    ];
    const w = fightWorld({ n, arena: a, weapons: true });
    for (const o of w.objects) o.active = false;
    for (const s of w.spawns) s.active = false;
    w.game.weaponTimer = 400;
    let max = 0;
    let spawns = 0;
    for (let i = 0; i < seconds * 60; i++) {
      tick(w);
      spawns += eventCount(w, SimEvent.WEAPON_SPAWN);
      const c = w.objects.filter((o) => o.active && o.type === ObjType.WEAPON).length;
      max = Math.max(max, c);
    }
    return { max, spawns };
  }

  it('le nombre d’armes au sol et leur rythme suivent le nombre de joueurs', () => {
    expect(maxGroundWeapons(2)).toBe(2);
    expect(maxGroundWeapons(8)).toBe(5);
    expect(maxGroundWeapons(8)).toBeGreaterThan(maxGroundWeapons(4));
    expect(itemInterval(8)).toBeLessThan(itemInterval(2));
    const two = play(2);
    const eight = play(8);
    expect(two.max).toBeLessThanOrEqual(maxGroundWeapons(2));
    expect(eight.max).toBeLessThanOrEqual(maxGroundWeapons(8));
    expect(two.max).toBeGreaterThanOrEqual(2);
    expect(eight.max).toBeGreaterThan(two.max);
    expect(eight.spawns).toBeGreaterThan(two.spawns);
  });

  describe('cœurs de soin', () => {
    function heartWorld(n = 2): ReturnType<typeof fightWorld> {
      const a = boxArena();
      a.spawns.weapons = [
        [10, 32],
        [30, 32],
        [50, 32],
      ];
      const w = fightWorld({ n, arena: a, weapons: false });
      for (const o of w.objects) o.active = false;
      w.game.healTimer = 30 * 60;
      return w;
    }
    const hearts = (w: ReturnType<typeof fightWorld>): number =>
      w.objects.filter((o) => o.active && o.type === ObjType.HEART).length;

    it('un cœur apparaît en combat même sans armes, et pas dans le salon', () => {
      const w = heartWorld();
      w.game.healTimer = 5;
      ticks(w, 60);
      expect(hearts(w)).toBe(1);
      const lobby = heartWorld();
      lobby.game.phase = GamePhase.LOBBY;
      lobby.game.healTimer = 0;
      ticks(lobby, 600);
      expect(hearts(lobby)).toBe(0);
    });

    it('toucher un cœur rend des points de vie, sans dépasser le maximum', () => {
      const w = heartWorld();
      spawnObj(w, ObjType.HEART, pl(w, 0).x, FLOOR, 12, 12, 0, 0);
      pl(w, 0).hp = 50;
      expect(countEvents(w, 2, SimEvent.HEAL)).toBe(1);
      expect(pl(w, 0).hp).toBe(50 + COMBAT.healAmount);
      expect(hearts(w)).toBe(0);
      spawnObj(w, ObjType.HEART, pl(w, 1).x, FLOOR, 12, 12, 0, 0);
      pl(w, 1).hp = COMBAT.maxHp - 10;
      ticks(w, 2);
      expect(pl(w, 1).hp).toBe(COMBAT.maxHp);
    });

    it('un joueur en pleine forme ne gaspille pas le cœur', () => {
      const w = heartWorld();
      spawnObj(w, ObjType.HEART, pl(w, 0).x, FLOOR, 12, 12, 0, 0);
      ticks(w, 30);
      expect(hearts(w)).toBe(1);
      expect(pl(w, 0).hp).toBe(COMBAT.maxHp);
    });

    it('au plus un cœur à 2 joueurs, deux à 8, et ils disparaissent s’ils sont oubliés', () => {
      expect(maxGroundHearts(2)).toBe(1);
      expect(maxGroundHearts(8)).toBe(2);
      for (const n of [2, 8]) {
        const w = heartWorld(n);
        let max = 0;
        for (let i = 0; i < 180 * 60; i++) {
          tick(w);
          max = Math.max(max, hearts(w));
        }
        expect(max).toBeLessThanOrEqual(maxGroundHearts(n));
        expect(max).toBeGreaterThanOrEqual(1);
      }
      const w = heartWorld();
      const o = spawnObj(w, ObjType.HEART, 300, FLOOR, 12, 12, 0, 0)!;
      o.life = COMBAT.heartLifeTicks;
      ticks(w, COMBAT.heartLifeTicks + 5);
      expect(o.active).toBe(false);
    });
  });

  it('rien quand les armes sont désactivées', () => {
    const w = weaponWorld();
    w.rules.weapons = false;
    ticks(w, 30 * 60, 0);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(false);
  });

  it('actif aussi dans le salon d attente (entraînement)', () => {
    const w = weaponWorld();
    w.game.phase = GamePhase.LOBBY;
    w.game.weaponTimer = 0;
    ticks(w, WEAPON_DRAW_TICKS + 5, 0);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(true);
  });

  it('toutes les armes peuvent sortir, et seulement elles', () => {
    const w = weaponWorld();
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) seen.add(randomWeapon(w));
    expect(seen.size).toBe(12);
    expect(seen.has(WeaponId.NONE)).toBe(false);
    expect(seen.has(WeaponId.CRATE)).toBe(false);
  });
});

describe('capacité des réserves', () => {
  it('les objets ne débordent jamais', () => {
    const w = fightWorld();
    let made = 0;
    for (let i = 0; i < 100; i++) if (spawnObj(w, ObjType.CRATE, 100, 100, 16, 16, 20, 0)) made++;
    expect(made).toBe(32);
    expect(countEvents(w, 3, SimEvent.HIT)).toBeGreaterThanOrEqual(0);
  });
});

describe('armes prises dans le décor', () => {
  it('une arme posée à moitié dans un mur en ressort et peut être ramassée', () => {
    const w = fightWorld();
    // mur plein de la bordure gauche : colonnes 0 et 1 (x < 32)
    const o = spawnWeaponObj(w, WeaponId.PISTOL, 5, 28, FLOOR - 40, 0, 0)!;
    ticks(w, 90, 0);
    expect(o.active).toBe(true);
    expect(o.x - o.w / 2).toBeGreaterThanOrEqual(2 * CELL - 0.01);
    expect(o.grounded).toBe(true);
  });

  it('une arme enfouie loin dans la masse disparaît au lieu de rester inaccessible', () => {
    const w = fightWorld();
    const o = spawnWeaponObj(w, WeaponId.PISTOL, 5, 5, FLOOR + 20, 0, 0)!;
    ticks(w, 3, 0);
    expect(o.active === false || o.x - o.w / 2 >= 2 * CELL - 0.01).toBe(true);
  });
});
