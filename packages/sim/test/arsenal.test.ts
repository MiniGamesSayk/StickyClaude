import {
  AttackKind,
  Cause,
  Cell,
  COMBAT,
  Input,
  ObjType,
  ProjType,
  SimEvent,
  WeaponId,
  weaponDef,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { damageObject, killPlayer, spawnObj } from '../src/index.ts';
import type { World } from '../src/index.ts';
import {
  ATTACK,
  BLOCK,
  DOWN,
  FLOOR,
  JUMP,
  LEFT,
  PICKUP,
  RIGHT,
  UP,
  fightWorld,
  pl,
  tap,
  tick,
  ticks,
} from './fight.ts';
import { customArena, fill } from './helpers.ts';

const DASH = Input.DASH;

function give(w: World, slot: number, weapon: number, ammo = weaponDef(weapon).ammo): void {
  pl(w, slot).weapon = weapon;
  pl(w, slot).ammo = ammo;
}

/** Arguments du premier événement d'un type émis pendant les `n` prochains ticks. */
function firstEvent(w: World, n: number, type: number, ...masks: number[]): number[] | null {
  for (let i = 0; i < n; i++) {
    tick(w, ...masks);
    for (let k = 0; k < w.events.count; k++) {
      if (w.events.type[k] === type) return Array.from(w.events.v.slice(k * 6, k * 6 + 6));
    }
  }
  return null;
}

function active(w: World, type: number): number {
  return w.projectiles.filter((p) => p.active && p.type === type).length;
}

describe('bout du canon', () => {
  it('le tir part du bout de l’arme dessinée, pas du corps', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    pl(w, 1).x = 700;
    const ev = firstEvent(w, 10, SimEvent.SHOT, ATTACK)!;
    // épaule (+1,6) + bras (8) + longueur de l'arme (18)
    expect(ev[0]).toBeCloseTo(300 + 1.6 + 8 + weaponDef(WeaponId.PISTOL).tip, 0);
    expect(ev[1]).toBeCloseTo(FLOOR - 17.8, 0);
  });

  it('contre un mur, le tir part du mur', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.SHOTGUN);
    pl(w, 0).x = 1000 - 10; // colé au mur de droite
    pl(w, 1).x = 700;
    const ev = firstEvent(w, 10, SimEvent.SHOT, ATTACK)!;
    expect(ev[0]).toBeLessThan(992);
  });

  it('un adversaire collé à soi est touché quand même', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.BLOWGUN);
    pl(w, 1).x = 318;
    ticks(w, 16, ATTACK | RIGHT);
    expect(pl(w, 1).hp).toBeLessThan(100);
  });
});

describe('fusil à pompe', () => {
  it('tire neuf éclats visibles en éventail', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.SHOTGUN);
    pl(w, 1).x = 900;
    firstEvent(w, 10, SimEvent.SHOT, ATTACK);
    expect(active(w, ProjType.SHRAPNEL)).toBe(9);
    const angles = w.projectiles
      .filter((p) => p.active)
      .map((p) => Math.atan2(p.vy, p.vx))
      .sort((a, b) => a - b);
    expect(angles[angles.length - 1] - angles[0]).toBeGreaterThan(0.3);
  });

  it('frappe fort de près, très peu de loin', () => {
    const near = fightWorld();
    give(near, 0, WeaponId.SHOTGUN);
    pl(near, 1).x = 330;
    ticks(near, 30, ATTACK);
    const far = fightWorld();
    give(far, 0, WeaponId.SHOTGUN);
    pl(far, 1).x = 470;
    ticks(far, 30, ATTACK);
    const dNear = 100 - pl(near, 1).hp;
    const dFar = 100 - pl(far, 1).hp;
    expect(dNear).toBeGreaterThanOrEqual(25);
    expect(dFar).toBeLessThan(dNear / 2);
  });

  it('les éclats s’arrêtent sur le décor', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.SHOTGUN);
    pl(w, 0).x = 1000 - 20;
    pl(w, 1).x = 600;
    ticks(w, 10, ATTACK | LEFT);
    ticks(w, 40, 0);
    expect(active(w, ProjType.SHRAPNEL)).toBe(0);
  });
});

describe('grappin', () => {
  it('a une portée infinie et tire vers un mur lointain', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 0).x = 100;
    pl(w, 1).x = 900;
    pl(w, 1).y = FLOOR - 400; // hors de la ligne de tir
    tap(w, 5, ATTACK | RIGHT);
    ticks(w, 170, 0);
    expect(pl(w, 0).x).toBeGreaterThan(900);
  });

  it('s’accroche à une plateforme à sens unique', () => {
    const arena = customArena((r) => {
      for (let y = 2; y < 33; y++) for (let x = 2; x < 62; x++) r[y][x] = '.';
      for (let y = 33; y < 36; y++) for (let x = 0; x < 64; x++) r[y][x] = '#';
      fill(r, 10, 12, 50, 12, '-');
    });
    expect(arena.grid[12][20]).toBe('-');
    expect(Cell.ONEWAY).toBe(3);
    const w = fightWorld({ arena });
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 1).x = 900;
    tap(w, 5, ATTACK | UP);
    ticks(w, 40, 0);
    expect(pl(w, 0).y).toBeLessThan(FLOOR - 200);
  });

  it('attire un adversaire vers soi', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 1).x = 700;
    tap(w, 5, ATTACK | RIGHT);
    ticks(w, 25, 0);
    expect(pl(w, 1).grappleTicks).toBeGreaterThan(0);
    ticks(w, 80, 0);
    expect(Math.abs(pl(w, 1).x - pl(w, 0).x)).toBeLessThan(80);
  });

  it('ramène une caisse vers soi', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 1).x = 900;
    pl(w, 1).y = FLOOR - 400;
    const crate = spawnObj(w, ObjType.CRATE, 700, FLOOR, 16, 16, 20, 0)!;
    tap(w, 5, ATTACK | RIGHT);
    ticks(w, 90, 0);
    expect(crate.x).toBeLessThan(400);
  });

  it('sauter lâche la corde et garde l’élan', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 0).x = 700;
    pl(w, 1).x = 400;
    pl(w, 1).y = FLOOR - 400;
    tap(w, 5, ATTACK | RIGHT);
    ticks(w, 25, 0);
    expect(pl(w, 0).grappleTicks).toBeGreaterThan(0);
    tick(w, JUMP);
    expect(pl(w, 0).grappleTicks).toBe(0);
    expect(pl(w, 0).vx).toBeGreaterThan(200);
  });
});

describe('arc à trombones', () => {
  it('une flèche bandée à fond frappe bien plus fort qu’une flèche lâchée vite', () => {
    const quick = fightWorld();
    give(quick, 0, WeaponId.BOW);
    pl(quick, 1).x = 380;
    tap(quick, 4, ATTACK);
    ticks(quick, 40, 0);
    const dQuick = 100 - pl(quick, 1).hp;

    const full = fightWorld();
    give(full, 0, WeaponId.BOW);
    pl(full, 1).x = 600;
    ticks(full, 45, ATTACK);
    ticks(full, 40, 0);
    const dFull = 100 - pl(full, 1).hp;

    expect(dQuick).toBeGreaterThanOrEqual(9);
    expect(dFull).toBeGreaterThan(dQuick * 2);
  });
});

describe('lance-pierre à agrafes', () => {
  it('tire trois agrafes d’un coup', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.STAPLER);
    pl(w, 1).x = 900;
    firstEvent(w, 10, SimEvent.SHOT, ATTACK);
    expect(active(w, ProjType.STAPLE)).toBe(3);
  });
});

describe('pistolet à colle', () => {
  it('englue : la cible est ralentie', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GLUE_GUN);
    pl(w, 1).x = 420;
    tap(w, 3, ATTACK | RIGHT);
    ticks(w, 40, 0);
    const q = pl(w, 1);
    expect(q.glueTicks).toBeGreaterThan(60);
    const x0 = q.x;
    ticks(w, 20, 0, RIGHT);
    const glued = q.x - x0;

    const free = fightWorld();
    pl(free, 1).x = 420;
    const y0 = pl(free, 1).x;
    ticks(free, 20, 0, RIGHT);
    expect(glued).toBeLessThan((pl(free, 1).x - y0) * 0.7);
  });

  it('on ne peut pas dasher englué', () => {
    const w = fightWorld();
    pl(w, 0).glueTicks = 100;
    tick(w, RIGHT | DASH);
    expect(pl(w, 0).dashTicks).toBe(0);
  });
});

describe('grenade d’encre', () => {
  it('explose à la fin de sa mèche et blesse autour', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.INK_GRENADE);
    pl(w, 1).x = 440;
    tap(w, 4, ATTACK | RIGHT);
    let booms = 0;
    for (let i = 0; i < 160; i++) {
      tick(w, 0);
      for (let k = 0; k < w.events.count; k++) {
        if (w.events.type[k] === SimEvent.EXPLOSION) booms++;
      }
    }
    expect(booms).toBeGreaterThan(0);
    expect(pl(w, 1).hp).toBeLessThan(100);
  });
});

describe('règle-boomerang', () => {
  it('est à usage unique : il part, revient et disparaît, sans rendre la munition', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.BOOMERANG);
    pl(w, 1).x = 900;
    pl(w, 1).y = FLOOR - 400;
    tap(w, 10, ATTACK | RIGHT);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
    expect(active(w, ProjType.BOOMERANG)).toBe(1);
    ticks(w, 160, 0);
    expect(active(w, ProjType.BOOMERANG)).toBe(0);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
    expect(pl(w, 0).ammo).toBe(0);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(false);
  });

  it('touche à l’aller et au retour', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.BOOMERANG);
    pl(w, 1).x = 480;
    tap(w, 4, ATTACK | RIGHT);
    ticks(w, 160, 0);
    expect(pl(w, 1).hp).toBeLessThanOrEqual(100 - 2 * weaponDef(WeaponId.BOOMERANG).damage);
  });
});

describe('ciseaux', () => {
  it('libèrent un adversaire accroché', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.SCISSORS);
    pl(w, 1).x = 330;
    pl(w, 1).grappleTicks = 60;
    pl(w, 1).grappleX = 330;
    pl(w, 1).grappleY = FLOOR - 14;
    tap(w, 14, ATTACK);
    expect(pl(w, 1).grappleTicks).toBe(0);
  });

  it('coupent un crochet en vol', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.SCISSORS);
    pl(w, 1).x = 330;
    pl(w, 1).y = FLOOR - 300;
    const hook = w.projectiles[0];
    hook.active = true;
    hook.type = ProjType.HOOK;
    hook.owner = 1;
    hook.weapon = WeaponId.GRAPPLE;
    hook.x = 325;
    hook.y = FLOOR - 14;
    hook.vx = 0;
    hook.vy = 0;
    hook.life = 50;
    tap(w, 14, ATTACK);
    expect(hook.active).toBe(false);
  });
});

describe('surligneur laser', () => {
  it('blesse sur la durée sans repousser ni interrompre', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.HIGHLIGHTER);
    const q = pl(w, 1);
    q.x = 420;
    ticks(w, 40, ATTACK);
    expect(q.hp).toBeLessThanOrEqual(100 - 12);
    expect(q.stun).toBe(0);
    expect(Math.abs(q.vx)).toBeLessThan(20);
    expect(q.hitLock).toBe(0);
  });
});

describe('rouleau de scotch', () => {
  it('colle qui marche dessus, mais pas son poseur', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.TAPE);
    pl(w, 1).x = 900;
    tap(w, 6, ATTACK);
    ticks(w, 10, 0);
    const tape = w.objects.find((o) => o.active && o.type === ObjType.TAPE)!;
    expect(tape).toBeDefined();
    expect(pl(w, 0).glueTicks).toBe(0);
    pl(w, 1).x = tape.x;
    pl(w, 1).y = FLOOR;
    ticks(w, 3, 0);
    expect(pl(w, 1).glueTicks).toBeGreaterThan(0);
  });
});

describe('cahier-paravent', () => {
  it('arrête les balles et finit par céder', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.COVER);
    give(w, 1, WeaponId.PISTOL, 8);
    pl(w, 1).x = 560;
    pl(w, 1).facing = -1;
    tap(w, 12, ATTACK);
    const cover = w.objects.find((o) => o.active && o.type === ObjType.COVER)!;
    expect(cover).toBeDefined();
    tick(w, 0, ATTACK | LEFT);
    ticks(w, 6, 0, 0);
    expect(pl(w, 0).hp).toBe(100);
    for (let i = 0; i < 6; i++) {
      tap(w, 14, 0, ATTACK | LEFT);
    }
    expect(cover.active).toBe(false);
  });
});

describe('trousse de soin', () => {
  it('soigne après un long geste, puis disparaît', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.MEDKIT);
    pl(w, 0).hp = 40;
    pl(w, 1).x = 900;
    tap(w, 70, ATTACK);
    expect(pl(w, 0).hp).toBe(40 + weaponDef(WeaponId.MEDKIT).heal);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
  });

  it('est interrompue par un coup', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.MEDKIT);
    pl(w, 0).hp = 40;
    pl(w, 1).x = 900;
    tap(w, 20, ATTACK);
    pl(w, 0).stun = 12;
    ticks(w, 60, 0);
    expect(pl(w, 0).hp).toBe(40);
    expect(pl(w, 0).weapon).toBe(WeaponId.MEDKIT);
  });
});

describe('dash dans toutes les directions', () => {
  it('vers le haut', () => {
    const w = fightWorld();
    const y0 = pl(w, 0).y;
    tick(w, UP | DASH);
    ticks(w, 8, UP);
    expect(y0 - pl(w, 0).y).toBeGreaterThan(40);
  });

  it('en diagonale', () => {
    const w = fightWorld();
    const x0 = pl(w, 0).x;
    const y0 = pl(w, 0).y;
    tick(w, UP | RIGHT | DASH);
    ticks(w, 8, UP | RIGHT);
    expect(pl(w, 0).x - x0).toBeGreaterThan(30);
    expect(y0 - pl(w, 0).y).toBeGreaterThan(30);
  });

  it('vers le bas en l’air', () => {
    const w = fightWorld();
    pl(w, 0).y = FLOOR - 200;
    pl(w, 0).grounded = false;
    const y0 = pl(w, 0).y;
    tick(w, DOWN | DASH);
    ticks(w, 8, DOWN);
    expect(pl(w, 0).y - y0).toBeGreaterThan(55);
  });

  it('bas seul au sol : esquive sur place', () => {
    const w = fightWorld();
    tick(w, DOWN | DASH);
    expect(pl(w, 0).dodging).toBe(true);
  });

  it('le dash horizontal reste inchangé', () => {
    const w = fightWorld();
    const x0 = pl(w, 0).x;
    tick(w, LEFT | DASH);
    ticks(w, 8, LEFT);
    expect(x0 - pl(w, 0).x).toBeGreaterThan(50);
  });
});

describe('coup chargé dans toutes les directions', () => {
  it('vers le haut', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.x = 304;
    q.y = FLOOR - 30;
    q.grounded = false;
    ticks(w, 30, UP | ATTACK);
    tick(w, UP);
    expect(pl(w, 0).atkKind).toBe(AttackKind.CHARGED);
    let minVy = 0;
    for (let i = 0; i < 12; i++) {
      tick(w, UP);
      minVy = Math.min(minVy, q.vy);
    }
    expect(q.hp).toBeLessThan(100 - COMBAT.charged.damageMin + 1);
    expect(minVy).toBeLessThan(-250);
  });

  it('vers l’avant, avec la même force qu’avant', () => {
    const w = fightWorld();
    pl(w, 1).x = 330;
    ticks(w, 40, ATTACK);
    ticks(w, 12, 0);
    expect(pl(w, 1).hp).toBeLessThanOrEqual(100 - COMBAT.charged.damageMin);
    expect(pl(w, 1).vx).toBeGreaterThan(0);
  });

  it('vers l’arrière : on se retourne', () => {
    const w = fightWorld();
    pl(w, 1).x = 270;
    ticks(w, 40, ATTACK);
    ticks(w, 12, LEFT);
    expect(pl(w, 1).hp).toBeLessThanOrEqual(100 - COMBAT.charged.damageMin);
    expect(pl(w, 1).vx).toBeLessThan(0);
  });
});

describe('armes de mêlée chargées', () => {
  it('maintenir l’attaque frappe plus fort qu’un appui bref', () => {
    const a = fightWorld();
    give(a, 0, WeaponId.RULER);
    pl(a, 1).x = 330;
    tap(a, 20, ATTACK);
    const dTap = 100 - pl(a, 1).hp;

    const b = fightWorld();
    give(b, 0, WeaponId.RULER);
    pl(b, 1).x = 330;
    ticks(b, 30, ATTACK);
    ticks(b, 20, 0);
    const dHold = 100 - pl(b, 1).hp;

    expect(dTap).toBe(weaponDef(WeaponId.RULER).damage);
    expect(dHold).toBeGreaterThan(dTap * 1.5);
  });

  it('un appui bref garde les dégâts de base pour chaque arme de mêlée', () => {
    for (const id of [WeaponId.COMPASS, WeaponId.SCISSORS, WeaponId.STAMP_HAMMER]) {
      const w = fightWorld();
      give(w, 0, id);
      pl(w, 1).x = 330;
      tap(w, 40, ATTACK);
      expect(100 - pl(w, 1).hp).toBe(weaponDef(id).damage);
    }
  });
});

describe('coups vers le bas en l’air', () => {
  it('attaque + bas : un petit coup sous les pieds, pas un plongeon', () => {
    const w = fightWorld();
    pl(w, 0).y = FLOOR - 45;
    pl(w, 0).grounded = false;
    pl(w, 1).x = 304;
    let sawAirDown = false;
    tick(w, DOWN | ATTACK);
    for (let i = 0; i < 12; i++) {
      tick(w, DOWN);
      if (pl(w, 0).atkKind === AttackKind.AIR_DOWN) sawAirDown = true;
      expect(pl(w, 0).kicking).toBe(false);
    }
    expect(sawAirDown).toBe(true);
    expect(pl(w, 1).hp).toBe(100 - COMBAT.airDown.damage);
  });

  it('« smash bas » (attaque + parade ensemble) lance le coup de pied plongeant', () => {
    const w = fightWorld();
    pl(w, 0).y = FLOOR - 200;
    pl(w, 0).grounded = false;
    pl(w, 1).x = 900;
    tick(w, ATTACK | BLOCK);
    ticks(w, 4, 0);
    expect(pl(w, 0).kicking).toBe(true);
    expect(pl(w, 0).blockTicks).toBe(0);
    expect(pl(w, 0).vy).toBeGreaterThan(300);
  });

  it('le plongeon s’annule avec un dash', () => {
    const w = fightWorld();
    pl(w, 0).y = FLOOR - 250;
    pl(w, 0).grounded = false;
    pl(w, 1).x = 900;
    tick(w, ATTACK | BLOCK);
    ticks(w, 3, 0);
    expect(pl(w, 0).kicking).toBe(true);
    tick(w, RIGHT | DASH);
    expect(pl(w, 0).kicking).toBe(false);
    expect(pl(w, 0).atkPhase).toBe(0);
    expect(pl(w, 0).dashTicks).toBeGreaterThan(0);
  });

  it('le plongeon s’annule avec un saut (double saut)', () => {
    const w = fightWorld();
    pl(w, 0).y = FLOOR - 250;
    pl(w, 0).grounded = false;
    pl(w, 1).x = 900;
    tick(w, ATTACK | BLOCK);
    ticks(w, 3, 0);
    tick(w, JUMP);
    expect(pl(w, 0).kicking).toBe(false);
    expect(pl(w, 0).vy).toBeLessThan(0);
  });

  it('le plongeon s’annule avec la parade', () => {
    const w = fightWorld();
    pl(w, 0).y = FLOOR - 250;
    pl(w, 0).grounded = false;
    pl(w, 1).x = 900;
    tick(w, ATTACK | BLOCK);
    ticks(w, 3, 0);
    tick(w, BLOCK);
    expect(pl(w, 0).kicking).toBe(false);
    expect(pl(w, 0).blockTicks).toBeGreaterThan(0);
  });

  it('au sol, « smash bas » ne pare pas : c’est une simple attaque', () => {
    const w = fightWorld();
    pl(w, 1).x = 900;
    tick(w, ATTACK | BLOCK);
    expect(pl(w, 0).blockTicks).toBe(0);
    ticks(w, 20, 0);
    tick(w, BLOCK);
    expect(pl(w, 0).blockTicks).toBeGreaterThan(0);
  });
});

describe('caisses', () => {
  it('une caisse brisée laisse une arme une fois sur deux', () => {
    const w = fightWorld({ weapons: true });
    let drops = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const c = spawnObj(w, ObjType.CRATE, 500, FLOOR, 16, 16, 1, 0)!;
      damageObject(w, c, 99, 0);
      for (const o of w.objects) {
        if (o.active && o.type === ObjType.WEAPON) {
          drops++;
          o.active = false;
        }
      }
    }
    expect(drops / N).toBeGreaterThan(0.4);
    expect(drops / N).toBeLessThan(0.6);
  });
});

describe('lancers chargés', () => {
  function thrownSpeed(w: World): number {
    const pr = w.projectiles.find((p) => p.active && p.type === ProjType.THROWN);
    return pr ? Math.hypot(pr.vx, pr.vy) : 0;
  }

  it('un appui bref sur ramasser lance doucement, comme avant', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    pl(w, 1).x = 900;
    tick(w, PICKUP);
    tick(w, 0);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
    expect(thrownSpeed(w)).toBeGreaterThan(300);
    expect(thrownSpeed(w)).toBeLessThan(450);
  });

  it('maintenir ramasser charge le lancer : plus vite, plus fort', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    pl(w, 1).x = 900;
    ticks(w, 40, PICKUP);
    expect(pl(w, 0).weapon).toBe(WeaponId.PISTOL);
    expect(pl(w, 0).chargeTicks).toBeGreaterThan(20);
    tick(w, 0);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
    expect(thrownSpeed(w)).toBeGreaterThan(600);
  });

  it('une arme lancée à fond blesse bien plus qu’une arme lancée doucement', () => {
    const soft = fightWorld();
    give(soft, 0, WeaponId.PISTOL);
    pl(soft, 1).x = 360;
    tick(soft, PICKUP);
    ticks(soft, 40, 0);
    const hard = fightWorld();
    give(hard, 0, WeaponId.PISTOL);
    pl(hard, 1).x = 360;
    ticks(hard, 40, PICKUP);
    ticks(hard, 40, 0);
    const dSoft = 100 - pl(soft, 1).hp;
    const dHard = 100 - pl(hard, 1).hp;
    expect(dSoft).toBeGreaterThan(0);
    expect(dHard).toBeGreaterThan(dSoft * 1.8);
  });

  it('une caisse se charge avec l’attaque', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.CRATE, 1);
    pl(w, 1).x = 900;
    ticks(w, 30, ATTACK);
    expect(pl(w, 0).weapon).toBe(WeaponId.CRATE);
    ticks(w, 6, 0);
    expect(thrownSpeed(w)).toBeGreaterThan(600);
  });

  it('être touché interrompt la charge', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    pl(w, 1).x = 900;
    ticks(w, 20, PICKUP);
    pl(w, 0).stun = 5;
    ticks(w, 12, 0);
    expect(pl(w, 0).chargeTicks).toBe(0);
    expect(pl(w, 0).weapon).toBe(WeaponId.PISTOL);
  });
});

describe('grappin : la corde ne reste jamais sans traction', () => {
  /** Lance un grappin et note, tick par tick, les cordes lâchées (254) et accrochées (255 ou joueur). */
  function trace(
    w: World,
    ticksN: number,
  ): { released: number; anchored: number; pulling: boolean[] } {
    let released = 0;
    let anchored = 0;
    const pulling: boolean[] = [];
    for (let i = 0; i < ticksN; i++) {
      tick(w, 0);
      for (let k = 0; k < w.events.count; k++) {
        if (w.events.type[k] !== SimEvent.GRAPPLE) continue;
        if (w.events.v[k * 6 + 2] === 254) released++;
        else anchored++;
      }
      pulling.push(pl(w, 0).grappleTicks > 0 || pl(w, 1).grappleTicks > 0);
    }
    return { released, anchored, pulling };
  }

  it('arrivée au point d’ancrage : un événement efface la corde', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 0).x = 700;
    pl(w, 1).x = 400;
    pl(w, 1).y = FLOOR - 400;
    tap(w, 5, ATTACK | RIGHT);
    const r = trace(w, 220);
    expect(r.anchored).toBeGreaterThan(0);
    expect(r.released).toBeGreaterThanOrEqual(1);
    expect(r.pulling[r.pulling.length - 1]).toBe(false);
  });

  it('un adversaire tiré qui meurt efface la corde de son tireur', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 1).x = 700;
    tap(w, 5, ATTACK | RIGHT);
    ticks(w, 25, 0);
    expect(pl(w, 1).grappleTicks).toBeGreaterThan(0);
    killPlayer(w, 1, 0, Cause.MELEE);
    let released = 0;
    for (let k = 0; k < w.events.count; k++) {
      if (
        w.events.type[k] === SimEvent.GRAPPLE &&
        w.events.slot[k] === 1 &&
        w.events.v[k * 6 + 2] === 254
      ) {
        released++;
      }
    }
    expect(released).toBe(1);
    expect(pl(w, 1).grappleTicks).toBe(0);
  });

  it('un mur arrête la traction et la corde est lâchée', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 0).x = 100;
    pl(w, 1).y = FLOOR - 400;
    pl(w, 1).x = 900;
    tap(w, 5, ATTACK | LEFT);
    const r = trace(w, 120);
    expect(r.released).toBeGreaterThanOrEqual(1);
  });
});

describe('grappin à usage limité', () => {
  it('disparaît de la main après la dernière charge', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE, 1);
    pl(w, 1).x = 900;
    pl(w, 1).y = FLOOR - 400;
    tap(w, 8, ATTACK | RIGHT);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
  });
});
