import {
  Cause,
  CELL,
  FALL_MARGIN,
  GamePhase,
  ModeId,
  ObjType,
  SimEvent,
  WeaponId,
  WORLD_H,
  weaponDef,
} from '@stickyclaude/shared';
import type { ArenaData, CauseId } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { GhostMark, placeMark, spawnProps } from '../src/index.ts';
import type { World } from '../src/index.ts';
import {
  ATTACK,
  BLOCK,
  DOWN,
  FLOOR,
  RIGHT,
  eventCount,
  fightWorld,
  pl,
  tap,
  tick,
  ticks,
} from './fight.ts';
import { boxArena } from './helpers.ts';

/**
 * Analyse §2.11 : « mort par chaque cause ». Chaque scénario amène un joueur à 1 PV (ou à la
 * limite) et vérifie la cause portée par l'événement KO de la victime, puis qu'il est bien éliminé.
 */

/** Cause de l'événement KO de `victim` dans les `n` prochains ticks, -1 s'il n'est pas mort. */
function koCause(
  w: World,
  victim: number,
  n: number,
  tapAttack: boolean,
  ...masks: number[]
): number {
  for (let i = 0; i < n; i++) {
    // Les mains nues frappent au relâchement : un appui bref suffit.
    if (tapAttack && i > 0) tick(w, ...masks.map((m) => m & ~ATTACK));
    else tick(w, ...masks);
    for (let k = 0; k < w.events.count; k++) {
      if (w.events.type[k] === SimEvent.KO && w.events.slot[k] === victim) {
        return w.events.v[k * 6 + 3];
      }
    }
  }
  return -1;
}

function give(w: World, slot: number, weapon: number, ammo = weaponDef(weapon).ammo): void {
  pl(w, slot).weapon = weapon;
  pl(w, slot).ammo = ammo;
}

function withHazardAt(cx: number, cy: number, ch = '^'): ArenaData {
  const a = boxArena();
  const rows = a.grid.map((r) => r.split(''));
  rows[cy][cx] = ch;
  a.grid = rows.map((r) => r.join(''));
  return a;
}

function withProps(props: ArenaData['props']): ArenaData {
  const a = boxArena();
  a.props = props;
  return a;
}

/** Un scénario : monde préparé, joueur visé, ticks à simuler, masques tenus. */
interface Scenario {
  cause: CauseId;
  name: string;
  build: () => { w: World; victim: number; ticks: number; masks: number[] };
  /** Appui bref sur ATTACK (mains nues) au lieu d'un bouton tenu. */
  tap?: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    cause: Cause.MELEE,
    name: 'un coup de poing',
    tap: true,
    build: () => {
      const w = fightWorld({ ghosts: false });
      pl(w, 1).hp = 1;
      return { w, victim: 1, ticks: 20, masks: [ATTACK] };
    },
  },
  {
    cause: Cause.KICK,
    name: 'un coup de pied plongeant',
    build: () => {
      const w = fightWorld({ ghosts: false });
      const p = pl(w, 0);
      p.y = FLOOR - 120;
      p.grounded = false;
      pl(w, 1).x = p.x + 4;
      pl(w, 1).hp = 1;
      tick(w, ATTACK | BLOCK);
      return { w, victim: 1, ticks: 40, masks: [DOWN] };
    },
  },
  {
    cause: Cause.WEAPON_MELEE,
    name: 'une arme de mêlée (règle)',
    tap: true,
    build: () => {
      const w = fightWorld({ ghosts: false });
      give(w, 0, WeaponId.RULER);
      pl(w, 1).x = 340;
      pl(w, 1).hp = 1;
      return { w, victim: 1, ticks: 20, masks: [ATTACK] };
    },
  },
  {
    cause: Cause.BULLET,
    name: 'une balle (pistolet)',
    build: () => {
      const w = fightWorld({ ghosts: false });
      give(w, 0, WeaponId.PISTOL);
      pl(w, 1).hp = 1;
      return { w, victim: 1, ticks: 20, masks: [ATTACK] };
    },
  },
  {
    cause: Cause.PROJECTILE,
    name: 'un projectile (sarbacane)',
    build: () => {
      const w = fightWorld({ ghosts: false });
      give(w, 0, WeaponId.BLOWGUN);
      pl(w, 1).x = 330;
      pl(w, 1).hp = 1;
      return { w, victim: 1, ticks: 40, masks: [ATTACK | RIGHT] };
    },
  },
  {
    cause: Cause.EXPLOSION,
    name: 'une explosion (bazooka)',
    build: () => {
      const w = fightWorld({ ghosts: false });
      give(w, 0, WeaponId.BAZOOKA);
      pl(w, 1).x = 372;
      pl(w, 1).hp = 1;
      return { w, victim: 1, ticks: 60, masks: [ATTACK | RIGHT] };
    },
  },
  {
    cause: Cause.THROWN,
    name: 'une arme vide lancée',
    build: () => {
      const w = fightWorld({ ghosts: false });
      give(w, 0, WeaponId.RULER, 0);
      pl(w, 1).x = 340;
      pl(w, 1).hp = 1;
      return { w, victim: 1, ticks: 60, masks: [ATTACK] };
    },
  },
  {
    cause: Cause.HAZARD,
    name: 'une cellule de danger',
    build: () => {
      const w = fightWorld({ arena: withHazardAt(20, 32), ghosts: false });
      const q = pl(w, 1);
      q.x = 20 * CELL + CELL / 2;
      q.y = FLOOR;
      q.hp = 1;
      return { w, victim: 1, ticks: 5, masks: [] };
    },
  },
  {
    cause: Cause.LAVA,
    name: 'de la lave',
    build: () => {
      const w = fightWorld({ arena: withHazardAt(20, 32, 'l'), ghosts: false });
      const q = pl(w, 1);
      q.x = 20 * CELL + CELL / 2;
      q.y = FLOOR;
      q.hp = 1;
      return { w, victim: 1, ticks: 5, masks: [] };
    },
  },
  {
    cause: Cause.SAW,
    name: 'une scie',
    build: () => {
      const w = fightWorld({ arena: withHazardAt(20, 32, 's'), ghosts: false });
      const q = pl(w, 1);
      q.x = 20 * CELL + CELL / 2;
      q.y = FLOOR;
      q.hp = 1;
      return { w, victim: 1, ticks: 5, masks: [] };
    },
  },
  {
    cause: Cause.FALL,
    name: 'une chute hors de la page',
    build: () => {
      const w = fightWorld({ ghosts: false });
      pl(w, 1).y = WORLD_H + FALL_MARGIN + 60;
      return { w, victim: 1, ticks: 3, masks: [] };
    },
  },
  {
    cause: Cause.INK,
    name: 'l’encre de la mort subite',
    build: () => {
      const w = fightWorld({ ghosts: false });
      // L'encre a déjà tout recouvert : elle avance de 14 unités/s depuis la 1re seconde.
      w.rules.suddenAfterTicks = 60;
      w.game.roundTick = 60 + 60 * 60;
      return { w, victim: 1, ticks: 60, masks: [] };
    },
  },
  {
    cause: Cause.MINE,
    name: 'une mine d’encre',
    build: () => {
      const w = fightWorld({ ghosts: false });
      give(w, 0, WeaponId.INK_MINE);
      pl(w, 1).x = 700;
      tap(w, 10, ATTACK);
      ticks(w, 70, 0);
      const mine = w.objects.find((o) => o.active && o.type === ObjType.MINE)!;
      const q = pl(w, 1);
      q.x = mine.x + 4;
      q.y = FLOOR;
      q.hp = 1;
      return { w, victim: 1, ticks: 5, masks: [] };
    },
  },
  {
    cause: Cause.POTATO,
    name: 'la patate d’encre',
    build: () => {
      const w = fightWorld({ ghosts: false });
      w.game.mode = ModeId.POTATO;
      pl(w, 0).hasBomb = true;
      w.game.modeData[0] = 1; // porteur + 1
      w.game.modeData[1] = 1; // la mèche brûle au prochain tick
      return { w, victim: 0, ticks: 5, masks: [] };
    },
  },
  {
    cause: Cause.BALLOON,
    name: 'l’éclatement d’un ballon',
    tap: true,
    build: () => {
      const w = fightWorld({
        arena: withProps([{ type: 'balloon', at: [20, 31] }]),
        ghosts: false,
      });
      spawnProps(w);
      const b = w.objects.find((o) => o.active && o.type === ObjType.BALLOON)!;
      b.y = FLOOR - 10;
      b.x = 300 + 20;
      pl(w, 0).x = 300;
      pl(w, 1).x = 300 + 36;
      pl(w, 1).hp = 1;
      return { w, victim: 1, ticks: 20, masks: [ATTACK] };
    },
  },
  {
    cause: Cause.TACK,
    name: 'une punaise',
    build: () => {
      const w = fightWorld({ arena: withProps([{ type: 'tack', at: [20, 32] }]), ghosts: false });
      spawnProps(w);
      const t = w.objects.find((o) => o.active && o.type === ObjType.TACK)!;
      const q = pl(w, 1);
      q.x = t.x;
      q.y = FLOOR;
      q.hp = 1;
      return { w, victim: 1, ticks: 5, masks: [] };
    },
  },
  {
    cause: Cause.GHOST,
    name: 'une goutte d’encre posée par un fantôme',
    build: () => {
      const w = fightWorld({ ghosts: false });
      expect(placeMark(w, GhostMark.DROP, 20, 32, 0, w.tick)).toBe(true);
      const q = pl(w, 1);
      q.x = 20 * CELL + CELL / 2;
      q.y = FLOOR;
      q.hp = 1;
      return { w, victim: 1, ticks: 5, masks: [] };
    },
  },
];

describe('mort par chaque cause', () => {
  it('toutes les causes de mort ont un scénario', () => {
    const covered = new Set(SCENARIOS.map((s) => s.cause));
    for (const [name, id] of Object.entries(Cause)) {
      if (id === Cause.NONE) continue;
      expect(covered.has(id), `cause ${name}`).toBe(true);
    }
  });

  for (const s of SCENARIOS) {
    it(`${Object.keys(Cause)[s.cause]} : ${s.name}`, () => {
      const { w, victim, ticks: n, masks } = s.build();
      expect(w.game.phase).toBe(GamePhase.PLAYING);
      const cause = koCause(w, victim, n, s.tap === true, ...masks);
      expect(cause).toBe(s.cause);
      expect(pl(w, victim).dead).toBe(true);
      expect(pl(w, victim).hp).toBe(0);
      expect(w.stats.deaths[victim]).toBe(1);
    });
  }

  it('l’encre ne laisse aucun joueur en vie sur son passage, mais ne tue qu’une fois chacun', () => {
    const w = fightWorld({ ghosts: false });
    w.rules.suddenAfterTicks = 60;
    w.game.roundTick = 60 + 60 * 60;
    let kos = 0;
    for (let i = 0; i < 80; i++) {
      tick(w, 0);
      kos += eventCount(w, SimEvent.KO);
    }
    expect(kos).toBe(2);
  });
});
