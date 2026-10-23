import { AtkPhase, AttackKind, COMBAT, FIST, Input, WeaponId, withAim } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import {
  ATTACK,
  BLOCK,
  DOWN,
  FLOOR,
  LEFT,
  RIGHT,
  SPECIAL,
  UP,
  fightWorld,
  pl,
  tap,
  tick,
  ticks,
} from './fight.ts';

const DASH = Input.DASH;

/** Place le joueur 0 en l'air, juste au-dessus du sol (hors contact). */
function airborne(w: ReturnType<typeof fightWorld>, slot = 0, height = 40): void {
  const p = pl(w, slot);
  p.y = FLOOR - height;
  p.grounded = false;
  p.vy = 0;
}

describe('clic gauche au sol : coups légers non chargeables', () => {
  it('gauche ou droite : le jab se retourne vers la direction tenue', () => {
    const w = fightWorld();
    pl(w, 1).x = 270; // à gauche de l'attaquant, qui regarde à droite
    tick(w, ATTACK | LEFT);
    ticks(w, 12, LEFT);
    expect(pl(w, 0).facing).toBe(-1);
    expect(pl(w, 1).hp).toBe(100 - FIST[0].damage);
  });

  it('le troisième coup projette, les deux premiers non', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    for (let press = 0; press < 3; press++) {
      q.x = 330;
      q.vx = 0;
      tick(w, ATTACK);
      for (let i = 0; i < 8; i++) tick(w, 0);
    }
    expect(q.stun + q.stunImmune).toBeGreaterThan(0);
  });

  it('haut : le coup monte, avec une portée un peu plus grande qu’avant', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.x = 304;
    q.y = FLOOR - 40;
    q.grounded = false;
    tick(w, UP | ATTACK);
    ticks(w, 12, UP);
    expect(pl(w, 0).atkKind === AttackKind.UPPER || q.hp < 100).toBe(true);
    expect(q.hp).toBe(100 - 8);
    expect(q.vy).toBeLessThan(0);
  });

  it('la récupération se coupe par un autre coup, un dash ou la défense', () => {
    const jabThen = (mask: number, owner = 0): { atk: number; block: number; dash: number } => {
      const w = fightWorld();
      pl(w, 1).x = 700;
      tick(w, ATTACK);
      const a = pl(w, owner);
      for (let i = 0; i < 20 && a.atkPhase !== AtkPhase.RECOVERY; i++) tick(w, 0);
      expect(a.atkPhase).toBe(AtkPhase.RECOVERY);
      tick(w, mask);
      return { atk: a.atkKind, block: a.blockTicks, dash: a.dashTicks };
    };
    // autre direction : un coup vers le haut part aussitôt
    expect(jabThen(UP | ATTACK).atk).toBe(AttackKind.UPPER);
    expect(jabThen(DOWN | ATTACK).atk).toBe(AttackKind.CROUCH);
    expect(jabThen(BLOCK).block).toBeGreaterThan(0);
    expect(jabThen(RIGHT | DASH).dash).toBeGreaterThan(0);
    expect(jabThen(SPECIAL).atk).toBe(AttackKind.NONE);
  });

  it('pas de coup chargé au bouton d’attaque : le coup part à l’appui', () => {
    const w = fightWorld();
    tick(w, ATTACK);
    expect(pl(w, 0).atkKind).toBe(AttackKind.FIST1);
    expect(pl(w, 0).chargeTicks).toBe(0);
  });
});

describe('clic gauche en l’air', () => {
  it('sans direction : frappe ceux qui sont collés, devant comme derrière', () => {
    for (const x of [304, 296]) {
      const w = fightWorld();
      airborne(w, 0, 20);
      pl(w, 1).x = x;
      tick(w, ATTACK);
      ticks(w, 12, 0);
      expect(pl(w, 0).atkKind).not.toBe(AttackKind.AIR_SIDE);
      expect(pl(w, 1).hp).toBe(100 - COMBAT.airNeutral.damage);
    }
    // à bonne distance, rien
    const far = fightWorld();
    airborne(far, 0, 20);
    pl(far, 1).x = 340;
    tick(far, ATTACK);
    ticks(far, 12, 0);
    expect(pl(far, 1).hp).toBe(100);
  });

  it('gauche ou droite : un large balayage devant, pas derrière', () => {
    const front = fightWorld();
    airborne(front, 0, 20);
    pl(front, 1).x = 322;
    tick(front, ATTACK | RIGHT);
    ticks(front, 12, RIGHT);
    expect(pl(front, 1).hp).toBe(100 - COMBAT.airSide.damage);
    const back = fightWorld();
    airborne(back, 0, 20);
    pl(back, 1).x = 278;
    tick(back, ATTACK | RIGHT);
    ticks(back, 12, RIGHT);
    expect(pl(back, 1).hp).toBe(100);
    // vers la gauche, on se retourne
    const left = fightWorld();
    airborne(left, 0, 20);
    pl(left, 1).x = 278;
    tick(left, ATTACK | LEFT);
    ticks(left, 12, LEFT);
    expect(pl(left, 1).hp).toBe(100 - COMBAT.airSide.damage);
  });

  it('haut : un petit balayage au-dessus de la tête', () => {
    const w = fightWorld();
    airborne(w, 0, 20);
    const q = pl(w, 1);
    q.x = 304;
    q.y = FLOOR - 70;
    q.grounded = false;
    tick(w, ATTACK | UP);
    ticks(w, 12, UP);
    expect(q.hp).toBe(100 - COMBAT.airUp.damage);
    expect(q.vy).toBeLessThan(0);
  });

  it('bas : un coup sous les pieds qui projette fort vers le bas (spike), le frappeur rebondit', () => {
    const w = fightWorld();
    airborne(w, 0, 45);
    const q = pl(w, 1);
    q.x = 304;
    q.y = FLOOR - 10;
    tick(w, ATTACK | DOWN);
    let maxVy = 0;
    for (let i = 0; i < 10; i++) {
      tick(w, DOWN);
      maxVy = Math.max(maxVy, q.vy);
    }
    expect(q.hp).toBe(100 - COMBAT.airDown.damage);
    expect(COMBAT.airDown.kby).toBeGreaterThan(300);
    expect(maxVy).toBeGreaterThan(200);
    expect(pl(w, 0).vy).toBeLessThan(0);
  });
});

describe('clic droit au sol : attaque spéciale chargeable', () => {
  it('bas : frappe de chaque côté', () => {
    const w = fightWorld({ n: 3 });
    pl(w, 1).x = 330;
    pl(w, 2).x = 270;
    pl(w, 2).facing = 1;
    tick(w, SPECIAL);
    ticks(w, 6, SPECIAL);
    ticks(w, 1, DOWN);
    expect(pl(w, 0).atkKind).toBe(AttackKind.SPECIAL_DOWN);
    ticks(w, 12, DOWN);
    expect(pl(w, 1).hp).toBeLessThan(100);
    expect(pl(w, 2).hp).toBeLessThan(100);
    expect(pl(w, 1).vx).toBeGreaterThan(0);
    expect(pl(w, 2).vx).toBeLessThan(0);
  });

  it('haut : le poing monte', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.x = 304;
    q.y = FLOOR - 40;
    q.grounded = false;
    ticks(w, 20, SPECIAL);
    ticks(w, 1, UP);
    expect(pl(w, 0).atkKind).toBe(AttackKind.CHARGED);
    expect(pl(w, 0).aim).toBe(12);
    ticks(w, 12, UP);
    expect(q.hp).toBeLessThan(100);
    expect(q.vy).toBeLessThan(-100);
  });

  it('côté : le poing s’allonge pendant l’attaque (touche plus loin qu’au départ)', () => {
    const w = fightWorld();
    const base = 300 + 6.4 + COMBAT.charged.reach + 1.9 + 6.4;
    // juste au-delà de la portée de départ, dans celle du poing allongé
    pl(w, 1).x = base + 8;
    ticks(w, 20, SPECIAL);
    tick(w, 0);
    let first = -1;
    for (let i = 0; i < 12; i++) {
      tick(w, 0);
      if (first < 0 && pl(w, 1).hp < 100) first = pl(w, 0).atkTicks;
    }
    expect(pl(w, 1).hp).toBeLessThan(100);
    expect(first).toBeGreaterThan(0);
    // et le coup léger n'y arrive pas
    const j = fightWorld();
    pl(j, 1).x = base + 8;
    tap(j, 14, ATTACK);
    expect(pl(j, 1).hp).toBe(100);
  });

  it('une longue récupération qu’on ne coupe pas', () => {
    const w = fightWorld();
    pl(w, 1).x = 700;
    tick(w, SPECIAL);
    tick(w, 0);
    ticks(w, COMBAT.charged.startup + COMBAT.charged.active, 0);
    expect(pl(w, 0).atkPhase).toBe(AtkPhase.RECOVERY);
    tick(w, ATTACK);
    tick(w, RIGHT | DASH);
    tick(w, BLOCK);
    expect(pl(w, 0).atkKind).toBe(AttackKind.CHARGED);
    expect(pl(w, 0).dashTicks).toBe(0);
    expect(pl(w, 0).blockTicks).toBe(0);
  });

  it('avec une arme en main, le clic droit ne fait rien', () => {
    const w = fightWorld();
    pl(w, 0).weapon = WeaponId.RULER;
    pl(w, 0).ammo = 10;
    ticks(w, 10, SPECIAL);
    expect(pl(w, 0).chargeTicks).toBe(0);
    expect(pl(w, 0).atkKind).toBe(AttackKind.NONE);
  });

  it('la direction est lue au relâchement et choisit l’attaque', () => {
    const w = fightWorld();
    ticks(w, 15, SPECIAL | UP);
    ticks(w, 1, DOWN); // changement d'avis avant de relâcher
    expect(pl(w, 0).atkKind).toBe(AttackKind.SPECIAL_DOWN);
  });
});

describe('clic droit en l’air : esquive et ruée invulnérables', () => {
  it('sans direction : invulnérable sur place, le personnage s’arrête', () => {
    const w = fightWorld();
    airborne(w, 0, 90);
    pl(w, 0).vy = 200;
    tick(w, SPECIAL);
    expect(pl(w, 0).invuln).toBeGreaterThan(0);
    ticks(w, 3, 0);
    expect(pl(w, 0).vy).toBe(0);
    expect(pl(w, 0).vx).toBe(0);
  });

  it('avec une direction : une ruée invulnérable, vulnérable à la fin', () => {
    const w = fightWorld();
    pl(w, 1).x = 900;
    airborne(w, 0, 150);
    const x0 = pl(w, 0).x;
    tick(w, SPECIAL | RIGHT);
    const a = pl(w, 0);
    // durée totale de la ruée (un tick déjà écoulé) : plus longue que le dash simple
    const total = a.dashTicks + 1;
    expect(total).toBe(w.params.dashTicks + COMBAT.airSpecial.extraTicks);
    expect(a.invuln).toBe(total - COMBAT.airSpecial.vulnerableTicks);
    let vulnerableAt = -1;
    for (let i = 1; i <= total && vulnerableAt < 0; i++) {
      tick(w, RIGHT);
      if (a.invuln === 0) vulnerableAt = i + 1;
    }
    // les derniers ticks de la ruée sont vulnérables
    expect(vulnerableAt).toBeGreaterThan(0);
    expect(total - vulnerableAt).toBeLessThanOrEqual(COMBAT.airSpecial.vulnerableTicks);
    expect(a.dashTicks).toBeGreaterThan(0);
    expect(a.x).toBeGreaterThan(x0 + 20);
  });

  it('une ruée invulnérable traverse un coup', () => {
    const w = fightWorld();
    airborne(w, 0, 120);
    pl(w, 1).x = 330;
    pl(w, 1).y = FLOOR - 120;
    pl(w, 1).grounded = false;
    pl(w, 1).facing = -1;
    tick(w, 0, ATTACK);
    tick(w, UP | SPECIAL, 0);
    ticks(w, 10, UP, 0);
    expect(pl(w, 0).hp).toBe(100);
  });

  it('un seul par temps de recharge', () => {
    const w = fightWorld();
    airborne(w, 0, 200);
    tick(w, SPECIAL | RIGHT);
    ticks(w, 40, 0);
    const cd = pl(w, 0).dashCd;
    expect(cd).toBeGreaterThan(0);
    tick(w, 0);
    tick(w, SPECIAL | RIGHT);
    expect(pl(w, 0).dashTicks).toBe(0);
  });

  it('avec une arme, le clic droit en l’air ne fait rien', () => {
    const w = fightWorld();
    airborne(w, 0, 150);
    pl(w, 0).weapon = WeaponId.RULER;
    pl(w, 0).ammo = 10;
    tick(w, SPECIAL | RIGHT);
    expect(pl(w, 0).dashTicks).toBe(0);
  });
});

describe('dash (Maj) : dans la direction tenue, en diagonale avec deux touches', () => {
  it('une touche : horizontal ; deux touches : diagonale ; aucune : esquive sur place', () => {
    const dash = (mask: number): { x: number; y: number; dodging: boolean } => {
      const w = fightWorld();
      pl(w, 1).x = 900;
      airborne(w, 0, 120);
      tick(w, mask | DASH);
      const a = pl(w, 0);
      return { x: a.dashX, y: a.dashY, dodging: a.dodging };
    };
    expect(dash(RIGHT)).toEqual({ x: 1, y: 0, dodging: false });
    expect(dash(LEFT | UP)).toEqual({ x: -1, y: -1, dodging: false });
    expect(dash(RIGHT | DOWN)).toEqual({ x: 1, y: 1, dodging: false });
    expect(dash(UP).y).toBe(-1);
    expect(dash(0).dodging).toBe(true);
  });

  it('le dash simple n’est pas invulnérable', () => {
    const w = fightWorld();
    airborne(w, 0, 120);
    tick(w, RIGHT | DASH);
    expect(pl(w, 0).invuln).toBe(0);
  });
});

describe('mode défense : parade orientée, en l’air aussi, impossible avec une arme', () => {
  const guard = (aimSector: number | null, attackerX: number, air = false): number => {
    const w = fightWorld();
    const q = pl(w, 1);
    pl(w, 0).x = attackerX;
    q.x = 330;
    const mask = aimSector === null ? BLOCK : withAim(BLOCK, aimSector);
    if (air) airborne(w, 1, 20);
    ticks(w, 20, 0, mask);
    if (air) airborne(w, 1, 20);
    tap(w, 12, ATTACK, mask);
    return q.hp;
  };

  it('une garde tournée vers l’attaquant l’arrête, tournée ailleurs non', () => {
    const toward = guard(8, 300); // visée à gauche, attaquant à gauche
    const away = guard(0, 300); // visée à droite
    expect(toward).toBeGreaterThan(100 - FIST[0].damage);
    expect(away).toBe(100 - FIST[0].damage);
  });

  it('le côté où regarde le personnage ne compte pas, seule la visée', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = 1; // regarde loin de l'attaquant…
    ticks(w, 20, 0, withAim(BLOCK, 8)); // …mais garde à gauche
    q.x = 330;
    pl(w, 0).x = 300;
    tap(w, 12, ATTACK, withAim(BLOCK, 8));
    expect(q.hp).toBeGreaterThan(100 - FIST[0].damage);
  });

  it('en l’air aussi', () => {
    expect(guard(8, 300, true)).toBeGreaterThan(100 - COMBAT.airNeutral.damage - 8);
    const w = fightWorld();
    airborne(w, 1, 60);
    ticks(w, 2, 0, BLOCK);
    expect(pl(w, 1).blockTicks).toBeGreaterThan(0);
  });

  it('vers le haut : pare un coup venu d’en haut', () => {
    const run = (sector: number): number => {
      const w = fightWorld();
      const q = pl(w, 1);
      ticks(w, 20, 0, withAim(BLOCK, sector));
      const a = pl(w, 0);
      a.x = q.x;
      a.y = FLOOR - 46;
      a.grounded = false;
      a.vy = 0;
      tick(w, ATTACK | DOWN, withAim(BLOCK, sector));
      ticks(w, 12, DOWN, withAim(BLOCK, sector));
      return q.hp;
    };
    expect(run(12)).toBeGreaterThan(100 - COMBAT.airDown.damage);
    expect(run(4)).toBe(100 - COMBAT.airDown.damage); // garde vers le bas : le coup vient du haut
  });

  it('avec une arme en main, on ne peut plus parer', () => {
    const w = fightWorld();
    pl(w, 0).weapon = WeaponId.RULER;
    pl(w, 0).ammo = 10;
    ticks(w, 5, BLOCK);
    expect(pl(w, 0).blockTicks).toBe(0);
    const q = fightWorld();
    ticks(q, 5, BLOCK);
    expect(pl(q, 0).blockTicks).toBeGreaterThan(0);
    // ramasser une arme pendant la garde la fait tomber
    q.players[0].weapon = WeaponId.RULER;
    q.players[0].ammo = 10;
    tick(q, BLOCK);
    expect(pl(q, 0).blockTicks).toBe(0);
  });

  it('en mode défense on n’attaque pas', () => {
    const w = fightWorld();
    ticks(w, 3, BLOCK);
    ticks(w, 10, BLOCK | ATTACK);
    expect(pl(w, 0).atkKind).toBe(AttackKind.NONE);
    ticks(w, 10, BLOCK | SPECIAL);
    expect(pl(w, 0).chargeTicks).toBe(0);
    // le mode quitté, on attaque de nouveau
    tick(w, 0);
    tick(w, ATTACK);
    expect(pl(w, 0).atkKind).toBe(AttackKind.FIST1);
  });
});
