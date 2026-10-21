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
  MAX_GROUND_WEAPONS,
  randomWeapon,
  spawnObj,
  spawnProps,
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

  it('au plus 3 armes au sol, une toutes les 6 à 10 s', () => {
    const w = weaponWorld();
    let max = 0;
    let events = 0;
    for (let i = 0; i < 90 * 60; i++) {
      tick(w);
      events += eventCount(w, SimEvent.WEAPON_SPAWN);
      const n = w.objects.filter((o) => o.active && o.type === ObjType.WEAPON).length;
      max = Math.max(max, n);
    }
    expect(max).toBeLessThanOrEqual(MAX_GROUND_WEAPONS);
    expect(max).toBeGreaterThanOrEqual(2);
    expect(events).toBeGreaterThanOrEqual(8);
    expect(events).toBeLessThanOrEqual(16 + MAX_GROUND_WEAPONS);
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
