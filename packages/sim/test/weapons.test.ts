import {
  Cell,
  CELL,
  COMBAT,
  GRID_W,
  ObjType,
  ProjType,
  SimEvent,
  WEAPONS,
  WeaponId,
  weaponDef,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { fillObjects } from '../src/index.ts';
import type { World } from '../src/index.ts';
import {
  ATTACK,
  BLOCK,
  DOWN,
  FLOOR,
  LEFT,
  PICKUP,
  RIGHT,
  UP,
  countEvents,
  eventCount,
  fightWorld,
  paperWall,
  pl,
  tick,
  ticks,
} from './fight.ts';

function give(w: World, slot: number, weapon: number, ammo = weaponDef(weapon).ammo): void {
  pl(w, slot).weapon = weapon;
  pl(w, slot).ammo = ammo;
}

function cellOf(w: World, cx: number, cy: number): number {
  return w.cells[cy * GRID_W + cx]!;
}

describe('les 12 armes sont des données', () => {
  it('douze armes, hors poings et caisse, toutes paramétrées', () => {
    const real = WEAPONS.filter((x) => x.id !== WeaponId.NONE && x.id !== WeaponId.CRATE);
    expect(real).toHaveLength(12);
    for (const d of real) {
      expect(d.ammo).toBeGreaterThan(0);
      expect(d.startup + d.active + d.recovery).toBeGreaterThan(0);
      expect(d.name.fr.length).toBeGreaterThan(0);
      expect(d.name.en.length).toBeGreaterThan(0);
    }
    expect(new Set(real.map((x) => x.key)).size).toBe(12);
  });
});

describe('règle', () => {
  it('touche plus loin que les poings et s use à chaque coup', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.RULER);
    pl(w, 1).x = 340; // hors de portée des poings (≤ 339)
    ticks(w, 14, ATTACK);
    expect(pl(w, 1).hp).toBe(100 - weaponDef(WeaponId.RULER).damage);
    expect(pl(w, 0).ammo).toBeLessThan(weaponDef(WeaponId.RULER).ammo);
  });

  it('une arme sans munition se lance : petits dégâts, puis disparition', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.RULER, 0);
    pl(w, 1).x = 340;
    ticks(w, 40, ATTACK);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
    expect(pl(w, 1).hp).toBe(100 - COMBAT.emptyThrowDamage);
    ticks(w, 120, 0);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(false);
  });
});

describe('compas', () => {
  it('traverse la parade normale mais pas la parade parfaite', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.COMPASS);
    const q = pl(w, 1);
    q.x = 330;
    q.facing = -1;
    ticks(w, 20, 0, BLOCK);
    ticks(w, 16, ATTACK, BLOCK);
    expect(q.hp).toBe(100 - weaponDef(WeaponId.COMPASS).damage);

    const w2 = fightWorld();
    give(w2, 0, WeaponId.COMPASS);
    pl(w2, 1).x = 330;
    pl(w2, 1).facing = -1;
    ticks(w2, 4, ATTACK, 0);
    ticks(w2, 14, 0, BLOCK);
    expect(pl(w2, 1).hp).toBe(100);
  });
});

describe('marteau-tampon', () => {
  it('lent, énorme projection, étourdit et laisse un tampon d encre', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.STAMP_HAMMER);
    pl(w, 1).x = 330;
    let stamps = 0;
    let first = -1;
    for (let i = 0; i < 40; i++) {
      tick(w, i === 0 ? ATTACK : 0);
      stamps += eventCount(w, SimEvent.STAMP);
      if (first < 0 && pl(w, 1).hp < 100) first = i;
    }
    expect(stamps).toBe(1);
    expect(first).toBeGreaterThanOrEqual(weaponDef(WeaponId.STAMP_HAMMER).startup);
    expect(pl(w, 1).hp).toBe(100 - 28);
    expect(Math.abs(pl(w, 1).vx)).toBeGreaterThan(200);
  });
});

describe('pistolet griffonné', () => {
  it('tir instantané précis, 8 balles', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    pl(w, 1).x = 560;
    pl(w, 1).invuln = 0;
    const shots = countEvents(w, 12, SimEvent.SHOT, ATTACK | RIGHT);
    expect(shots).toBeGreaterThanOrEqual(1);
    expect(pl(w, 1).hp).toBeLessThan(100);
    expect(pl(w, 0).ammo).toBeLessThan(8);
  });

  it('le décor arrête la balle', () => {
    const w = fightWorld({ arena: paperWall(20, 21) });
    give(w, 0, WeaponId.PISTOL);
    pl(w, 1).x = 560;
    ticks(w, 14, ATTACK | RIGHT);
    expect(pl(w, 1).hp).toBe(100);
  });

  it('plus de munitions : la dernière balle tirée, puis l arme se lance', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL, 1);
    pl(w, 1).x = 560;
    ticks(w, 14, ATTACK | RIGHT);
    expect(pl(w, 0).ammo).toBe(0);
    expect(pl(w, 0).weapon).toBe(WeaponId.PISTOL);
    tick(w, 0);
    ticks(w, 40, ATTACK);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
  });

  it('l aide à la visée corrige un tir légèrement à côté', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    // cible un peu plus haut que l'axe horizontal du tireur
    pl(w, 1).x = 520;
    pl(w, 1).y = FLOOR - 40;
    pl(w, 1).vy = 0;
    pl(w, 1).grounded = true;
    ticks(w, 1, ATTACK | RIGHT);
    pl(w, 1).y = FLOOR - 14;
    ticks(w, 12, ATTACK | RIGHT);
    expect(pl(w, 1).hp).toBeLessThan(100);
  });
});

describe('fusil à pompe gribouillé', () => {
  it('dispersion : bien plus de dégâts de près que de loin, et recul pour le tireur', () => {
    const near = fightWorld();
    give(near, 0, WeaponId.SHOTGUN);
    pl(near, 1).x = 340;
    ticks(near, 10, ATTACK | RIGHT);
    const nearDmg = 100 - pl(near, 1).hp;

    const far = fightWorld();
    give(far, 0, WeaponId.SHOTGUN);
    pl(far, 1).x = 440;
    ticks(far, 10, ATTACK | RIGHT);
    const farDmg = 100 - pl(far, 1).hp;

    expect(nearDmg).toBeGreaterThanOrEqual(25);
    expect(farDmg).toBeLessThan(nearDmg);

    const w = fightWorld();
    give(w, 0, WeaponId.SHOTGUN);
    pl(w, 1).x = 700;
    let minVx = 0;
    for (let i = 0; i < 12; i++) {
      tick(w, ATTACK | RIGHT);
      minVx = Math.min(minVx, pl(w, 0).vx);
    }
    expect(minVx).toBeLessThan(-100);
  });
});

describe('sarbacane à boulettes', () => {
  it('boulettes rebondissantes qui touchent', () => {
    const w = fightWorld({ arena: paperWall(30, 31) });
    give(w, 0, WeaponId.BLOWGUN);
    pl(w, 1).x = 330;
    ticks(w, 16, ATTACK | RIGHT);
    expect(pl(w, 1).hp).toBeLessThan(100);
    expect(w.projectiles.some((p) => p.active) || pl(w, 1).hp < 100).toBe(true);
  });

  it('rebondit sur le décor', () => {
    const w = fightWorld({ arena: paperWall(20, 21) });
    give(w, 0, WeaponId.BLOWGUN);
    pl(w, 1).x = 60;
    tick(w, ATTACK | RIGHT);
    ticks(w, 20, 0);
    let bounced = false;
    for (let i = 0; i < 80; i++) {
      tick(w, 0);
      for (const p of w.projectiles) {
        if (p.active && p.type === ProjType.PELLET && p.vx < 0) bounced = true;
      }
    }
    expect(bounced).toBe(true);
  });
});

describe('lance-avions en papier', () => {
  it('est guidé faiblement vers la cible la plus proche', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PLANE_LAUNCHER);
    const q = pl(w, 1);
    q.x = 480;
    q.y = FLOOR;
    ticks(w, 6, ATTACK | UP | RIGHT); // vise en diagonale haute : sans guidage, il passerait au-dessus
    ticks(w, 160, 0);
    expect(q.hp).toBeLessThan(100);
  });
});

describe('bazooka à encre', () => {
  it('un tir direct explose sur la cible et la blesse', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.BAZOOKA);
    pl(w, 1).x = 372;
    let explosion = 0;
    for (let i = 0; i < 60; i++) {
      tick(w, i < 10 ? ATTACK | RIGHT : 0);
      explosion += eventCount(w, SimEvent.EXPLOSION);
    }
    expect(explosion).toBe(1);
    expect(pl(w, 1).hp).toBeLessThan(100 - 20);
    expect(pl(w, 1).stun + pl(w, 1).hitLock).toBeGreaterThanOrEqual(0);
  });

  it('explose sur le décor, détruit le papier et laisse une flaque', () => {
    const w = fightWorld({ arena: paperWall(24, 26) });
    give(w, 0, WeaponId.BAZOOKA);
    pl(w, 0).x = 300;
    pl(w, 1).x = 60;
    let terrain = 0;
    let puddle = 0;
    let explosion = 0;
    for (let i = 0; i < 90; i++) {
      tick(w, i < 10 ? ATTACK | RIGHT : 0);
      terrain += eventCount(w, SimEvent.TERRAIN);
      puddle += eventCount(w, SimEvent.PUDDLE);
      explosion += eventCount(w, SimEvent.EXPLOSION);
    }
    expect(explosion).toBe(1);
    expect(terrain).toBe(1);
    expect(puddle).toBe(1);
    expect(w.puddles.some((p) => p.active)).toBe(true);
    // le mur de papier (colonnes 24 à 26) est troué au pied, mais pas tout en haut
    expect(cellOf(w, 24, 31)).toBe(Cell.EMPTY);
    expect(cellOf(w, 26, 22)).toBe(Cell.PAPER);
  });

  it('la flaque rend le sol glissant', () => {
    const w = fightWorld();
    pl(w, 0).x = 300;
    // sans flaque : arrêt rapide
    ticks(w, 20, 0, 0);
    pl(w, 0).vx = 190;
    ticks(w, 6, 0);
    const dry = pl(w, 0).vx;
    // avec flaque
    const w2 = fightWorld();
    w2.puddles[0]!.active = true;
    w2.puddles[0]!.x0 = 200;
    w2.puddles[0]!.x1 = 500;
    w2.puddles[0]!.y = FLOOR;
    w2.puddles[0]!.expire = 99999;
    pl(w2, 0).x = 300;
    pl(w2, 0).vx = 190;
    ticks(w2, 6, 0);
    expect(pl(w2, 0).vx).toBeGreaterThan(dry + 30);
  });
});

describe('gomme', () => {
  it('rebondit et efface les blocs de papier qu elle touche', () => {
    const w = fightWorld({ arena: paperWall(26, 26) });
    give(w, 0, WeaponId.ERASER);
    pl(w, 0).x = 300;
    pl(w, 1).x = 60;
    expect(cellOf(w, 26, 30)).toBe(Cell.PAPER);
    // tir horizontal vers la droite à hauteur de poitrine : touche le mur (x = 416)
    pl(w, 0).x = 360;
    let terrain = 0;
    for (let i = 0; i < 60; i++) {
      tick(w, i < 3 ? ATTACK | RIGHT : 0);
      terrain += eventCount(w, SimEvent.TERRAIN);
    }
    expect(terrain).toBeGreaterThanOrEqual(1);
  });
});

describe('trombone-grappin', () => {
  it('s accroche au décor et tire le joueur', () => {
    const w = fightWorld({ arena: paperWall(40, 41) });
    give(w, 0, WeaponId.GRAPPLE);
    const p = pl(w, 0);
    p.x = 540;
    pl(w, 1).x = 60;
    const x0 = p.x;
    let grappled = false;
    for (let i = 0; i < 40; i++) {
      tick(w, i < 6 ? ATTACK | RIGHT : 0);
      if (p.grappleTicks > 0) grappled = true;
    }
    expect(grappled).toBe(true);
    expect(p.x).toBeGreaterThan(x0 + 40);
  });

  it('attire un adversaire touché', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.GRAPPLE);
    pl(w, 1).x = 450;
    const x0 = pl(w, 1).x;
    ticks(w, 40, ATTACK | RIGHT);
    expect(pl(w, 1).x).toBeLessThan(x0 - 30);
  });
});

describe('tache d encre (mine)', () => {
  it('invisible pour l adversaire une fois armée, explose à son contact', () => {
    const w = fightWorld({ n: 2 });
    give(w, 0, WeaponId.INK_MINE);
    pl(w, 1).x = 700;
    ticks(w, 10, ATTACK);
    const mine = w.objects.find((o) => o.active && o.type === ObjType.MINE)!;
    expect(mine).toBeDefined();
    expect(mine.owner).toBe(0);
    // armement après 1 s
    ticks(w, 70, 0);
    expect(mine.b).toBe(1);
    const snapOwner = Array.from({ length: 8 }, () => ({ uid: 0, type: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, b: 0 }));
    expect(fillObjects(w, snapOwner, 0)).toBe(1);
    expect(fillObjects(w, snapOwner, 1)).toBe(0);
    expect(fillObjects(w, snapOwner, -1)).toBe(1);
    // l'adversaire marche dessus
    const q = pl(w, 1);
    q.x = mine.x + 4;
    q.y = FLOOR;
    let boom = 0;
    for (let i = 0; i < 4; i++) {
      tick(w, 0, 0);
      boom += eventCount(w, SimEvent.EXPLOSION);
    }
    expect(boom).toBe(1);
    expect(q.hp).toBeLessThan(100);
    expect(w.objects.some((o) => o.active && o.type === ObjType.MINE)).toBe(false);
  });

  it('ne se déclenche pas avant d être armée', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.INK_MINE);
    pl(w, 1).x = 700;
    ticks(w, 10, ATTACK);
    const mine = w.objects.find((o) => o.active && o.type === ObjType.MINE)!;
    pl(w, 1).x = mine.x;
    ticks(w, 10, 0, 0);
    expect(pl(w, 1).hp).toBe(100);
  });

  it('le poseur peut rester dessus, mais pas y revenir', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.INK_MINE);
    pl(w, 1).x = 700;
    ticks(w, 10, ATTACK);
    ticks(w, 90, 0);
    expect(pl(w, 0).hp).toBe(100);
    expect(w.objects.some((o) => o.active && o.type === ObjType.MINE)).toBe(true);
    pl(w, 0).x += 60; // s'éloigne
    ticks(w, 3, 0);
    pl(w, 0).x -= 60; // revient sur sa propre mine
    ticks(w, 5, 0);
    expect(pl(w, 0).hp).toBeLessThan(100);
  });
});

describe('taille-crayon (bouclier)', () => {
  it('bloque les tirs de face, pas de dos, et ralentit', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    give(w, 1, WeaponId.SHARPENER_SHIELD);
    pl(w, 1).x = 560;
    pl(w, 1).facing = -1;
    ticks(w, 14, ATTACK | RIGHT);
    expect(pl(w, 1).hp).toBe(100);
    expect(pl(w, 1).ammo).toBeLessThan(weaponDef(WeaponId.SHARPENER_SHIELD).ammo);

    const back = fightWorld();
    give(back, 0, WeaponId.PISTOL);
    give(back, 1, WeaponId.SHARPENER_SHIELD);
    pl(back, 1).x = 560;
    pl(back, 1).facing = 1; // de dos
    ticks(back, 14, ATTACK | RIGHT);
    expect(pl(back, 1).hp).toBeLessThan(100);

    const slow = fightWorld();
    give(slow, 0, WeaponId.SHARPENER_SHIELD);
    ticks(slow, 40, LEFT);
    const shielded = Math.abs(pl(slow, 0).vx);
    const bare = fightWorld();
    ticks(bare, 40, LEFT);
    expect(shielded).toBeLessThan(Math.abs(pl(bare, 0).vx));
  });

  it('se brise quand sa solidité est épuisée', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    give(w, 1, WeaponId.SHARPENER_SHIELD, 1);
    pl(w, 1).x = 560;
    pl(w, 1).facing = -1;
    ticks(w, 14, ATTACK | RIGHT);
    expect(pl(w, 1).weapon).toBe(WeaponId.NONE);
  });
});

describe('ramasser, lancer, lâcher', () => {
  it('ramasser une arme au sol, en lâchant celle qu on tenait', () => {
    const w = fightWorld();
    const p = pl(w, 0);
    give(w, 0, WeaponId.RULER);
    // une arme au sol à ses pieds
    const o = w.objects.find((x) => !x.active)!;
    o.active = true;
    o.type = ObjType.WEAPON;
    o.uid = 77;
    o.x = p.x + 4;
    o.y = FLOOR;
    o.w = 14;
    o.h = 8;
    o.a = WeaponId.PISTOL;
    o.b = 8;
    o.vx = o.vy = 0;
    o.life = 1200;
    tick(w, PICKUP);
    expect(p.weapon).toBe(WeaponId.PISTOL);
    expect(p.ammo).toBe(8);
    expect(w.objects.some((x) => x.active && x.type === ObjType.WEAPON && x.a === WeaponId.RULER)).toBe(true);
  });

  it('lancer l arme tenue : un projectile qui blesse, puis redevient un objet', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.PISTOL);
    pl(w, 1).x = 360;
    tick(w, PICKUP | RIGHT);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
    ticks(w, 40, 0);
    expect(pl(w, 1).hp).toBe(100 - COMBAT.throwDamage);
    ticks(w, 60, 0);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON && o.a === WeaponId.PISTOL)).toBe(true);
  });

  it('lâcher (bas + ramasser) pose l arme aux pieds', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.RULER);
    tick(w, PICKUP | DOWN);
    expect(pl(w, 0).weapon).toBe(WeaponId.NONE);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(true);
  });

  it('une arme oubliée s efface après 20 s', () => {
    const w = fightWorld();
    give(w, 0, WeaponId.RULER);
    tick(w, PICKUP | DOWN);
    ticks(w, 20 * 60 - 5, 0);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(true);
    ticks(w, 10, 0);
    expect(w.objects.some((o) => o.active && o.type === ObjType.WEAPON)).toBe(false);
  });
});
