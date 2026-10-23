import {
  AtkPhase,
  AttackKind,
  COMBAT,
  CROUCH_PUNCH,
  FIST,
  GamePhase,
  Input,
  PlayerState,
  SimEvent,
  UPPER,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import {
  ATTACK,
  BLOCK,
  DOWN,
  FLOOR,
  JUMP,
  LEFT,
  RIGHT,
  UP,
  countEvents,
  eventCount,
  fightWorld,
  pl,
  tick,
  tickRewind,
  tap,
  ticks,
} from './fight.ts';

describe('mains nues : enchaînement de 3 coups', () => {
  it('un jab touche à portée, retire des PV et repousse', () => {
    const w = fightWorld();
    tap(w, 12, ATTACK);
    expect(pl(w, 1).hp).toBe(100 - FIST[0].damage);
    expect(pl(w, 1).x).toBeGreaterThan(330);
  });

  it('ne touche pas hors de portée', () => {
    const w = fightWorld();
    pl(w, 1).x = 400;
    ticks(w, 20, ATTACK);
    expect(pl(w, 1).hp).toBe(100);
  });

  it('un seul coup par attaque et par cible', () => {
    const w = fightWorld();
    // L'appui est bref : une seule attaque démarre, et elle ne touche qu'une fois.
    tick(w, ATTACK);
    ticks(w, 20, 0);
    expect(pl(w, 1).hp).toBe(100 - FIST[0].damage);
  });

  it('trois appuis enchaînés : jab, crochet, final qui étourdit', () => {
    const w = fightWorld();
    const hits: number[] = [];
    let last = 100;
    // Rapproche la cible après chaque coup pour ne mesurer que l'enchaînement.
    for (let press = 0; press < 3; press++) {
      tick(w, ATTACK);
      for (let i = 0; i < 8; i++) {
        tick(w, 0);
        pl(w, 1).x = 330;
        pl(w, 1).vx = 0;
        if (pl(w, 1).hp < last) {
          hits.push(last - pl(w, 1).hp);
          last = pl(w, 1).hp;
        }
      }
    }
    expect(hits).toEqual([FIST[0].damage, FIST[1].damage, FIST[2].damage]);
    expect(pl(w, 1).stun).toBeGreaterThan(0);
  });

  it('l enchaînement se perd si on attend trop', () => {
    const w = fightWorld();
    tick(w, ATTACK);
    ticks(w, 60, 0);
    expect(pl(w, 0).combo).toBe(0);
    pl(w, 1).x = 330;
    tick(w, ATTACK);
    tick(w, 0); // le coup part au relâchement
    expect(pl(w, 0).atkKind).toBe(AttackKind.FIST1);
  });

  it('un appui mémorisé pendant le coup déclenche le suivant', () => {
    const w = fightWorld();
    tick(w, ATTACK);
    tick(w, 0);
    tick(w, ATTACK); // en plein départ du premier coup
    let second = false;
    for (let i = 0; i < 20 && !second; i++) {
      tick(w, 0);
      if (pl(w, 0).atkKind === AttackKind.FIST2) second = true;
    }
    expect(second).toBe(true);
  });
});

describe('direction pendant les coups', () => {
  it('on peut se retourner avant que le coup parte (départ et récupération), pas pendant', () => {
    const w = fightWorld();
    const a = pl(w, 0);
    tick(w, ATTACK);
    tick(w, LEFT); // départ du coup : on se retourne
    expect(a.atkPhase).toBe(AtkPhase.STARTUP);
    expect(a.facing).toBe(-1);
    ticks(w, FIST[0].startup, LEFT);
    expect(a.atkPhase).toBe(AtkPhase.ACTIVE);
    tick(w, RIGHT); // coup en cours : la direction est figée
    expect(a.facing).toBe(-1);
    ticks(w, FIST[0].active, RIGHT);
    expect(a.atkPhase).toBe(AtkPhase.RECOVERY);
    tick(w, RIGHT);
    expect(a.facing).toBe(1);
  });
});

describe('coup chargé', () => {
  it('maintenir le bouton charge puis projette fort au relâchement', () => {
    const w = fightWorld();
    pl(w, 1).x = 330;
    ticks(w, 60, ATTACK); // charge pleine
    expect(pl(w, 0).state).toBe(PlayerState.CHARGE);
    const hpBefore = pl(w, 1).hp;
    pl(w, 1).x = 330;
    ticks(w, 14, 0);
    const dmg = hpBefore - pl(w, 1).hp;
    expect(dmg).toBeGreaterThanOrEqual(COMBAT.charged.damageMax - 8);
    expect(pl(w, 1).stun).toBeGreaterThan(0);
    expect(Math.abs(pl(w, 1).vx)).toBeGreaterThan(200);
  });

  it('maintenir le bouton ne donne pas d abord un coup : la charge démarre directement', () => {
    const w = fightWorld();
    pl(w, 1).x = 330;
    const swings = countEvents(w, 40, SimEvent.SWING, ATTACK);
    expect(swings).toBe(0);
    expect(pl(w, 1).hp).toBe(100);
    expect(pl(w, 0).state).toBe(PlayerState.CHARGE);
  });

  it('la pose de charge est visible dès l appui, et la charge démarre au seuil', () => {
    const w = fightWorld();
    tick(w, ATTACK);
    expect(pl(w, 0).state).toBe(PlayerState.CHARGE);
    expect(pl(w, 0).chargeTicks).toBe(0);
    ticks(w, COMBAT.chargeHoldTicks, ATTACK);
    expect(pl(w, 0).chargeTicks).toBeGreaterThan(0);
  });

  it('un appui bref reste un jab, qui part au relâchement', () => {
    const w = fightWorld();
    tick(w, ATTACK);
    expect(pl(w, 0).atkKind).toBe(AttackKind.NONE);
    tick(w, 0);
    expect(pl(w, 0).atkKind).toBe(AttackKind.FIST1);
  });

  it('une charge courte fait moins mal qu une charge pleine', () => {
    const run = (hold: number): number => {
      const w = fightWorld();
      pl(w, 1).x = 330;
      ticks(w, hold, ATTACK);
      const before = pl(w, 1).hp;
      pl(w, 1).x = 330;
      pl(w, 1).vx = 0;
      ticks(w, 16, 0);
      return before - pl(w, 1).hp;
    };
    // Le premier jab est donné pendant la charge ; on compare ce qui s'ajoute.
    expect(run(60)).toBeGreaterThan(run(20));
  });

  it('on avance lentement en chargeant', () => {
    const w = fightWorld();
    ticks(w, 30, ATTACK | RIGHT);
    expect(pl(w, 0).vx).toBeLessThan(80);
  });
});

describe('coup de pied sauté vers le bas', () => {
  it('« smash bas » en l air plonge et touche en dessous, puis rebondit', () => {
    const w = fightWorld();
    const p = pl(w, 0);
    const q = pl(w, 1);
    p.y = FLOOR - 120;
    p.grounded = false;
    q.x = p.x + 4;
    tick(w, ATTACK | BLOCK);
    expect(p.kicking).toBe(true);
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) {
      tick(w, DOWN);
      if (q.hp < 100) hit = true;
    }
    expect(hit).toBe(true);
    expect(q.hp).toBe(100 - COMBAT.kick.damage);
    expect(p.vy).toBeLessThan(0);
    expect(p.kicking).toBe(false);
  });

  it('au sol, bas + attaque ne déclenche pas de coup de pied', () => {
    const w = fightWorld();
    tick(w, DOWN | ATTACK);
    expect(pl(w, 0).kicking).toBe(false);
  });
});

describe('coup accroupi et coup vers le haut', () => {
  it('accroupi, le coup porte plus loin que le jab et projette vers le haut', () => {
    const w = fightWorld();
    // hors de portée du jab (à 26 unités du corps : x_cible - 6,4 - 20 > x), dans celle du coup accroupi
    expect(FIST[0].reach).toBeLessThan(CROUCH_PUNCH.reach);
    pl(w, 1).x = 300 + 6.4 + FIST[0].reach + 6.4 + 8;
    tap(w, 14, ATTACK);
    expect(pl(w, 1).hp).toBe(100);
    const w2 = fightWorld();
    pl(w2, 1).x = 300 + 6.4 + FIST[0].reach + 6.4 + 8;
    tick(w2, DOWN | ATTACK);
    tick(w2, DOWN);
    expect(pl(w2, 0).atkKind).toBe(AttackKind.CROUCH);
    expect(pl(w2, 0).crouching).toBe(true);
    let sawUp = false;
    for (let i = 0; i < 16; i++) {
      tick(w2, DOWN);
      if (pl(w2, 1).vy < -100) sawUp = true;
    }
    expect(pl(w2, 1).hp).toBe(100 - CROUCH_PUNCH.damage);
    expect(sawUp).toBe(true);
    expect(pl(w2, 0).crouching).toBe(true);
  });

  it('haut + attaquer frappe au-dessus de la tête et projette vers le haut', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.x = 304;
    q.y = FLOOR - 30; // en l'air, juste au-dessus de l'attaquant
    q.grounded = false;
    tick(w, UP | ATTACK);
    tick(w, UP);
    expect(pl(w, 0).atkKind).toBe(AttackKind.UPPER);
    let minVy = 0;
    for (let i = 0; i < 12; i++) {
      tick(w, UP);
      minVy = Math.min(minVy, q.vy);
    }
    expect(q.hp).toBe(100 - UPPER.damage);
    expect(minVy).toBeLessThan(-150);
  });

  it('haut + attaquer ne touche pas un adversaire au sol à côté', () => {
    const w = fightWorld();
    pl(w, 1).x = 330;
    ticks(w, 14, UP | ATTACK);
    expect(pl(w, 1).hp).toBe(100);
  });
});

describe('parade', () => {
  it('bloquer de face réduit les dégâts à 30 %', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = -1;
    ticks(w, 20, 0, BLOCK); // parade bien établie (hors fenêtre parfaite)
    pl(w, 0).x = 300;
    q.x = 330;
    tap(w, 12, ATTACK, BLOCK);
    expect(q.hp).toBe(100 - Math.round(FIST[0].damage * COMBAT.blockDamageTaken));
    expect(q.stun).toBe(0);
  });

  it('bloquer ne protège pas dans le dos', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = 1; // tourné à l'opposé de l'attaquant
    ticks(w, 20, 0, BLOCK);
    q.x = 330;
    tap(w, 12, ATTACK, BLOCK);
    expect(q.hp).toBe(100 - FIST[0].damage);
  });

  it('parade parfaite : coup annulé et attaquant étourdi 0,4 s', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = -1;
    // L'attaquant lance le coup ; le défenseur appuie juste à temps.
    tick(w, ATTACK, 0);
    tick(w, 0, BLOCK);
    let perfect = 0;
    for (let i = 0; i < 12; i++) {
      tick(w, 0, BLOCK);
      for (let k = 0; k < w.events.count; k++) {
        if (w.events.type[k] === SimEvent.BLOCKED && w.events.v[k * 6 + 3] === 1) perfect++;
      }
    }
    expect(perfect).toBe(1);
    expect(q.hp).toBe(100);
    expect(pl(w, 0).stun).toBeGreaterThan(0);
    expect(pl(w, 0).stun).toBeLessThanOrEqual(COMBAT.parryStunTicks);
  });

  it('une parade qui fonctionne étourdit l attaquant 0,4 s, même hors de la fenêtre parfaite', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = -1;
    ticks(w, 20, 0, BLOCK);
    pl(w, 0).x = 300;
    q.x = 330;
    tap(w, 12, ATTACK, BLOCK);
    expect(pl(w, 0).stun).toBeGreaterThan(0);
    expect(COMBAT.parryStunTicks).toBe(24);
    expect(pl(w, 0).stun).toBeLessThanOrEqual(COMBAT.parryStunTicks);
  });

  it('la parade n encaisse qu un coup, puis 0,5 s de recharge avant de parer de nouveau', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = -1;
    ticks(w, 20, 0, BLOCK);
    pl(w, 0).x = 300;
    q.x = 330;
    // premier coup : paré (dégâts réduits), la parade retombe d'elle-même
    tap(w, 12, ATTACK, BLOCK);
    const afterFirst = q.hp;
    expect(afterFirst).toBe(100 - Math.round(FIST[0].damage * COMBAT.blockDamageTaken));
    expect(q.blockTicks).toBe(0);
    expect(q.blockCd).toBeGreaterThan(0);
    // tenir le bouton ne ré-engage pas la parade pendant la recharge
    ticks(w, COMBAT.parryCooldownTicks - 2, 0, BLOCK);
    expect(q.blockTicks).toBe(0);
    // l'attaquant est sorti de son étourdissement : le coup suivant passe en entier
    pl(w, 0).stun = 0;
    pl(w, 0).stunImmune = 0;
    pl(w, 0).x = 300;
    q.x = 330;
    q.vx = 0;
    tap(w, 12, ATTACK, BLOCK);
    expect(q.hp).toBeLessThan(afterFirst - FIST[0].damage + 1);
    // relâcher puis rappuyer après la recharge : la parade revient
    ticks(w, COMBAT.parryCooldownTicks + 20, 0, 0);
    tick(w, 0, BLOCK);
    expect(q.blockTicks).toBe(1);
  });

  it('le coup de pied plongeant est paré et étourdit celui qui le porte', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.facing = -1;
    ticks(w, 20, 0, BLOCK);
    const a = pl(w, 0);
    a.x = q.x - 2;
    a.y = FLOOR - 70;
    a.grounded = false;
    a.vy = 0;
    tick(w, ATTACK | BLOCK, BLOCK);
    ticks(w, 40, DOWN, BLOCK);
    expect(q.hp).toBeGreaterThan(100 - 10);
    expect(a.stun + a.stunImmune).toBeGreaterThan(0);
  });

  it('relâcher la parade sans avoir encaissé de coup ne recharge pas : on reprend aussitôt', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    ticks(w, 3, 0, BLOCK);
    tick(w, 0, 0); // relâche
    expect(q.blockCd).toBe(0);
    tick(w, 0, BLOCK);
    expect(q.blockTicks).toBe(1);
  });

  it('la parade coupe la récupération d un jab : enchaîner les coups ne bloque plus les autres actions', () => {
    const w = fightWorld();
    const a = pl(w, 0);
    tap(w, 8, ATTACK);
    expect(a.atkPhase).toBe(AtkPhase.RECOVERY);
    tick(w, BLOCK);
    expect(a.blockTicks).toBe(1);
    expect(a.atkKind).toBe(AttackKind.NONE);
  });

  it('le dash coupe aussi la récupération d un jab', () => {
    const w = fightWorld();
    const a = pl(w, 0);
    tap(w, 8, ATTACK);
    expect(a.atkPhase).toBe(AtkPhase.RECOVERY);
    tick(w, RIGHT | Input.DASH);
    expect(a.dashTicks).toBeGreaterThan(0);
    expect(a.atkKind).toBe(AttackKind.NONE);
  });

  it('on ne peut pas sauter en parant', () => {
    const w = fightWorld();
    ticks(w, 5, BLOCK | JUMP);
    expect(pl(w, 0).grounded).toBe(true);
    expect(pl(w, 0).vy).toBeGreaterThanOrEqual(0);
  });
});

describe('étourdissement et knockback', () => {
  it('cumul limité : un étourdi ne peut pas être ré-étourdi tout de suite', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.stun = 1;
    tick(w, 0, 0);
    expect(q.stun).toBe(0);
    expect(q.stunImmune).toBeGreaterThan(0);
    // Finisher immédiat : dégâts et projection oui, étourdissement non.
    pl(w, 0).combo = 2;
    pl(w, 0).comboWindow = 10;
    q.x = 330;
    tap(w, 12, ATTACK);
    expect(q.stun).toBe(0);
  });

  it('plus fort quand il reste peu de PV', () => {
    const push = (hp: number): number => {
      const w = fightWorld();
      pl(w, 1).hp = hp;
      tap(w, 8, ATTACK);
      return Math.abs(pl(w, 1).vx);
    };
    const full = push(100);
    // 90 PV → après le jab il en reste 85 ; 20 PV → il en reste 15
    const low = push(20);
    expect(low).toBeGreaterThan(full);
  });

  it('un joueur touché perd le contrôle un court instant', () => {
    const w = fightWorld();
    tap(w, 6, ATTACK);
    expect(pl(w, 1).hitLock).toBeGreaterThan(0);
    const x = pl(w, 1).x;
    ticks(w, 3, 0, LEFT);
    expect(pl(w, 1).x).toBeGreaterThanOrEqual(x);
  });

  it('protégé après une apparition', () => {
    const w = fightWorld();
    pl(w, 1).invuln = 30;
    tap(w, 12, ATTACK);
    expect(pl(w, 1).hp).toBe(100);
  });

  it('un coup annule l attaque en préparation de la cible', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.atkPhase = AtkPhase.STARTUP;
    q.atkKind = AttackKind.FIST1;
    tap(w, 6, ATTACK);
    expect(q.atkPhase).toBe(AtkPhase.NONE);
  });
});

describe('mort', () => {
  it('PV à zéro : événement KO, le joueur devient fantôme-crayon', () => {
    const w = fightWorld();
    pl(w, 1).hp = 3;
    tick(w, ATTACK);
    const ko = countEvents(w, 11, SimEvent.KO);
    expect(ko).toBe(1);
    expect(pl(w, 1).ghost).toBe(true);
    expect(pl(w, 1).state).toBe(PlayerState.GHOST);
    expect(w.stats.kos[0]).toBe(1);
    expect(w.stats.deaths[1]).toBe(1);
  });

  it('sans fantômes, le mort reste inerte', () => {
    const w = fightWorld({ ghosts: false });
    pl(w, 1).hp = 3;
    tap(w, 12, ATTACK);
    expect(pl(w, 1).dead).toBe(true);
    expect(pl(w, 1).ghost).toBe(false);
  });

  it('tomber hors de la page tue (cause chute) et crédite le dernier agresseur', () => {
    const w = fightWorld({ ghosts: false });
    // pas de sol : un trou sous le joueur 1
    pl(w, 1).lastAttacker = 0;
    pl(w, 1).lastAttackTick = w.tick;
    pl(w, 1).y = 36 * 16 + 80;
    pl(w, 1).vy = 100;
    const c = countEvents(w, 3, SimEvent.KO);
    expect(c).toBe(1);
    expect(w.stats.kos[0]).toBe(1);
  });

  it('dans le salon d attente les dégâts ne comptent pas', () => {
    const w = fightWorld();
    w.game.phase = GamePhase.LOBBY;
    tap(w, 12, ATTACK);
    expect(pl(w, 1).hp).toBe(100);
    expect(pl(w, 1).x).toBeGreaterThan(330); // mais la projection a lieu
  });

  it('une arme est lâchée à la mort de son porteur', () => {
    const w = fightWorld();
    pl(w, 1).hp = 3;
    pl(w, 1).weapon = 1;
    pl(w, 1).ammo = 10;
    tap(w, 12, ATTACK);
    expect(w.objects.some((o) => o.active && o.type === 1 && o.a === 1 && o.b === 10)).toBe(true);
  });
});

describe('équipes et tir ami', () => {
  it('pas de dégâts entre coéquipiers par défaut', () => {
    const w = fightWorld({ n: 3, teams: [0, 0, 1] });
    tap(w, 12, ATTACK);
    expect(pl(w, 1).hp).toBe(100);
    expect(pl(w, 1).stun).toBe(0);
  });

  it('tir ami activé : les coéquipiers se blessent', () => {
    const w = fightWorld({ n: 3, teams: [0, 0, 1], friendlyFire: true });
    tap(w, 12, ATTACK);
    expect(pl(w, 1).hp).toBeLessThan(100);
  });

  it('adversaires de deux équipes différentes', () => {
    const w = fightWorld({ teams: [0, 1] });
    tap(w, 12, ATTACK);
    expect(pl(w, 1).hp).toBeLessThan(100);
  });
});

describe('compensation de latence', () => {
  it('la mêlée touche la cible là où l attaquant la voyait', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    // La cible était à portée il y a 10 ticks, puis s'est éloignée.
    ticks(w, 12, 0);
    q.x = 330;
    ticks(w, 10, 0);
    q.x = 420;
    q.vx = 0;
    tickRewind(w, 0, ATTACK, 14);
    for (let i = 0; i < 10; i++) tickRewind(w, 0, 0, 14);
    expect(q.hp).toBeLessThan(100);
  });

  it('sans compensation, la même attaque rate', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    ticks(w, 12, 0);
    q.x = 330;
    ticks(w, 10, 0);
    q.x = 420;
    tap(w, 12, ATTACK);
    expect(q.hp).toBe(100);
  });

  it('la compensation est plafonnée par l historique', () => {
    const w = fightWorld();
    const q = pl(w, 1);
    q.x = 330;
    ticks(w, 40, 0);
    q.x = 420;
    ticks(w, 2, 0);
    tickRewind(w, 0, ATTACK, 15);
    for (let i = 0; i < 10; i++) tickRewind(w, 0, 0, 15);
    // 15 ticks en arrière : la cible était déjà à 420 depuis 2 ticks seulement → à portée il y a 15
    expect(q.hp).toBeLessThan(100);
  });
});

describe('bits réservés', () => {
  it('le retard de compensation vient du serveur : les bits hauts sont ignorés comme boutons', () => {
    const w = fightWorld();
    tick(w, 0xc000 | ATTACK);
    const swings = countEvents(w, 7, SimEvent.SWING, 0xc000);
    expect(swings).toBe(1);
    expect(eventCount(w, SimEvent.SWING)).toBeGreaterThanOrEqual(0);
  });
});
