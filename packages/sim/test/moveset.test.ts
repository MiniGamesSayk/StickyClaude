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

describe('en l’air, frapper ou parer ne freine pas', () => {
  it('un coup aérien garde la vitesse de course', () => {
    const w = fightWorld();
    pl(w, 1).x = 900;
    const p = pl(w, 0);
    ticks(w, 30, RIGHT);
    tick(w, RIGHT | Input.JUMP);
    ticks(w, 3, RIGHT | Input.JUMP);
    const before = p.vx;
    tick(w, RIGHT | ATTACK | Input.JUMP);
    ticks(w, 6, RIGHT | Input.JUMP);
    expect(p.grounded).toBe(false);
    expect(p.atkKind).not.toBe(AttackKind.NONE);
    expect(p.vx).toBeCloseTo(before, 0);
  });

  it('au sol, frapper ralentit toujours', () => {
    const w = fightWorld();
    pl(w, 1).x = 900;
    const p = pl(w, 0);
    ticks(w, 30, RIGHT);
    tick(w, RIGHT | ATTACK);
    ticks(w, 8, RIGHT);
    expect(p.vx).toBeLessThan(190 * COMBAT.attackSpeedMul + 1);
  });
});

describe('parade maintenue : de face, en l’air aussi, impossible avec une arme', () => {
  /** Le joueur 1 (en 330) pare en regardant vers `facing` ; le joueur 0 (en 300) lui donne un jab. */
  const guard = (facing: number, air = false): number => {
    const w = fightWorld();
    const q = pl(w, 1);
    pl(w, 0).x = 300;
    q.x = 330;
    q.facing = facing;
    if (air) airborne(w, 1, 20);
    ticks(w, 20, 0, BLOCK);
    if (air) airborne(w, 1, 20);
    tap(w, 12, ATTACK, BLOCK);
    return q.hp;
  };

  it('la garde couvre le côté où l’on regarde, pas le dos', () => {
    expect(guard(-1)).toBeGreaterThan(100 - FIST[0].damage);
    expect(guard(1)).toBe(100 - FIST[0].damage);
  });

  it('la souris ne compte pas : seule l’orientation du personnage', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.x = 330;
    pl(w, 0).x = 300;
    q.facing = -1;
    ticks(w, 20, 0, withAim(BLOCK, 0)); // visée à droite, dos à la visée
    tap(w, 12, ATTACK, withAim(BLOCK, 0));
    expect(q.hp).toBeGreaterThan(100 - FIST[0].damage);
  });

  it('on ne se retourne pas en parant : on recule en se protégeant', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = -1;
    ticks(w, 20, 0, BLOCK | RIGHT);
    expect(q.facing).toBe(-1);
    expect(q.vx).toBeGreaterThan(0);
    q.x = 330;
    q.vx = 0;
    pl(w, 0).x = 300;
    tap(w, 12, ATTACK, BLOCK | RIGHT);
    expect(q.hp).toBeGreaterThan(100 - FIST[0].damage);
    // relâchée, la parade rend le retournement
    tick(w, 0, RIGHT);
    expect(q.facing).toBe(1);
  });

  it('en l’air aussi', () => {
    expect(guard(-1, true)).toBeGreaterThan(100 - COMBAT.airNeutral.damage - 8);
    const w = fightWorld();
    airborne(w, 1, 60);
    ticks(w, 2, 0, BLOCK);
    expect(pl(w, 1).blockTicks).toBeGreaterThan(0);
  });

  it('un coup venu d’au-dessus est paré même dos tourné (aplomb du corps)', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = 1;
    ticks(w, 20, 0, BLOCK);
    const a = pl(w, 0);
    a.x = q.x;
    a.y = FLOOR - 46;
    a.grounded = false;
    a.vy = 0;
    tick(w, ATTACK | DOWN, BLOCK);
    ticks(w, 12, DOWN, BLOCK);
    expect(q.hp).toBeGreaterThan(100 - COMBAT.airDown.damage);
  });

  it('parade parfaite juste après l’appui : aucun dégât', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    pl(w, 0).x = 300;
    q.x = 330;
    q.facing = -1;
    tick(w, ATTACK, BLOCK);
    ticks(w, 11, 0, BLOCK);
    expect(q.hp).toBe(100);
  });

  it('une garde qui se relève seule (bouton resté tenu) n’offre pas de parade parfaite', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    pl(w, 0).x = 300;
    q.x = 330;
    q.facing = -1;
    ticks(w, 20, 0, BLOCK);
    tap(w, 12, ATTACK, BLOCK);
    expect(q.blockTicks).toBe(0); // elle a encaissé le coup et recharge
    let n = 0;
    while (q.blockTicks === 0 && n++ < 60) tick(w, 0, BLOCK);
    expect(q.blockTicks).toBeGreaterThan(COMBAT.perfectParryTicks);
    // relâcher puis rappuyer rouvre la fenêtre
    tick(w, 0, 0);
    tick(w, 0, BLOCK);
    expect(q.blockTicks).toBe(1);
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

  it('en parant on n’attaque pas', () => {
    const w = fightWorld();
    ticks(w, 3, BLOCK);
    ticks(w, 10, BLOCK | ATTACK);
    expect(pl(w, 0).atkKind).toBe(AttackKind.NONE);
    ticks(w, 10, BLOCK | SPECIAL);
    expect(pl(w, 0).chargeTicks).toBe(0);
    // la parade relâchée, on attaque de nouveau
    tick(w, 0);
    tick(w, ATTACK);
    expect(pl(w, 0).atkKind).toBe(AttackKind.FIST1);
  });
});
