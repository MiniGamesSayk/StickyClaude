import { AtkPhase, AttackKind, PlayerState, weaponDef, WeaponKind } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { BODY, createPoseInput, ik2, J, JOINT_COUNT, Rig } from '../src/render/skeleton.ts';
import type { Ik2, PoseInput } from '../src/render/skeleton.ts';

const times = (w: number, phase: number): number => {
  const d = weaponDef(w);
  return phase === AtkPhase.STARTUP ? d.startup : phase === AtkPhase.ACTIVE ? d.active : d.recovery;
};

function pt(r: Rig, j: number): [number, number] {
  return [r.joints[j * 2], r.joints[j * 2 + 1]];
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Fait vivre un squelette `seconds` secondes à 60 Hz avec une entrée fixe. */
function run(r: Rig, p: PoseInput, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) {
    p.timeS += 1 / 60;
    r.update(p, times);
  }
}

describe('ik2', () => {
  const out: Ik2 = { jx: 0, jy: 0, ex: 0, ey: 0 };

  it('atteint une cible à portée avec des os de longueur constante', () => {
    ik2(out, 0, 0, 6, 8, 5.8, 5.8, 1, 0, 1.5);
    expect(Math.hypot(out.ex - 6, out.ey - 8)).toBeLessThan(1e-4);
    expect(Math.hypot(out.jx, out.jy)).toBeCloseTo(5.8, 4);
    expect(Math.hypot(out.ex - out.jx, out.ey - out.jy)).toBeCloseTo(5.8, 4);
  });

  it('plie le genou du côté préféré', () => {
    ik2(out, 0, 0, 0, 10, 5.8, 5.8, 1, 0, 1.5);
    expect(out.jx).toBeGreaterThan(0);
    ik2(out, 0, 0, 0, 10, 5.8, 5.8, -1, 0, 1.5);
    expect(out.jx).toBeLessThan(0);
  });

  it('allonge les os quand la cible est trop loin, dans la limite du facteur maximal', () => {
    ik2(out, 0, 0, 20, 0, 5, 5, 0, 1, BODY.maxStretch);
    expect(out.ex).toBeGreaterThan(9.9);
    expect(Math.hypot(out.jx, out.jy)).toBeCloseTo(Math.hypot(out.ex - out.jx, out.ey - out.jy), 3);
    ik2(out, 0, 0, 100, 0, 5, 5, 0, 1, BODY.maxStretch);
    expect(out.ex).toBeLessThanOrEqual(10 * BODY.maxStretch + 1e-3);
  });

  it('ne produit jamais de NaN, même cible sur la racine', () => {
    ik2(out, 3, 3, 3, 3, 5, 5, 1, 1, 2);
    for (const v of [out.jx, out.jy, out.ex, out.ey]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('Rig', () => {
  it('au repos : debout sur le sol, la tête à la hauteur du corps (28,8)', () => {
    const r = new Rig();
    const p = createPoseInput();
    run(r, p, 0.5);
    const head = pt(r, J.HEAD);
    // sommet de la tête = centre - rayon
    expect(-(head[1] - BODY.headR)).toBeGreaterThan(27.0);
    expect(-(head[1] - BODY.headR)).toBeLessThan(30.0);
    expect(Math.abs(pt(r, J.FTL)[1])).toBeLessThan(0.3);
    expect(Math.abs(pt(r, J.FTR)[1])).toBeLessThan(0.3);
  });

  it('les os gardent leur longueur hors étirement (jambes au repos, bras)', () => {
    const r = new Rig();
    const p = createPoseInput();
    run(r, p, 0.5);
    expect(dist(pt(r, J.PEL), pt(r, J.KNR))).toBeCloseTo(BODY.thigh, 3);
    expect(dist(pt(r, J.KNR), pt(r, J.FTR))).toBeCloseTo(BODY.shin, 3);
    expect(dist(pt(r, J.SHR), pt(r, J.ELR))).toBeCloseTo(BODY.upper, 3);
  });

  it('chaque état produit une pose finie, avec les pieds près du sol quand on y est', () => {
    for (const state of Object.values(PlayerState)) {
      const r = new Rig();
      const p = createPoseInput();
      p.state = state;
      p.vx = 190;
      p.variant = state === PlayerState.ATTACK ? AttackKind.FIST1 | (AtkPhase.ACTIVE << 4) : 20;
      run(r, p, 0.4);
      for (let i = 0; i < JOINT_COUNT * 2; i++) {
        expect(Number.isFinite(r.joints[i]), `état ${state}, point ${i}`).toBe(true);
        expect(Math.abs(r.joints[i])).toBeLessThan(80);
      }
    }
  });

  it('la course alterne les pieds et ne les enfonce jamais dans le sol', () => {
    const r = new Rig();
    const p = createPoseInput();
    p.state = PlayerState.RUN;
    p.vx = 190;
    run(r, p, 0.3);
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 120; i++) {
      p.timeS += 1 / 60;
      r.update(p, times);
      const fr = pt(r, J.FTR);
      minX = Math.min(minX, fr[0]);
      maxX = Math.max(maxX, fr[0]);
      maxY = Math.max(maxY, fr[1], pt(r, J.FTL)[1]);
    }
    expect(maxX - minX).toBeGreaterThan(8);
    expect(maxY).toBeLessThan(0.6);
  });

  it('le poing d’un jab atteint la portée du coup (bras étirés), et revient ensuite', () => {
    const r = new Rig();
    const p = createPoseInput();
    p.state = PlayerState.ATTACK;
    p.variant = AttackKind.FIST1 | (AtkPhase.ACTIVE << 4);
    p.animProg = 2;
    run(r, p, 0.2);
    const hand = pt(r, J.HNR);
    // corps (demi-largeur 6,4) + 70 % de l'allonge de 20
    expect(hand[0]).toBeGreaterThan(6.4 + 20 * 0.7);
    p.state = PlayerState.IDLE;
    p.variant = 0;
    run(r, p, 0.4);
    expect(pt(r, J.HNR)[0]).toBeLessThan(8);
  });

  it('se mélange vers la nouvelle pose en ≈ 100 ms', () => {
    const r = new Rig();
    const p = createPoseInput();
    run(r, p, 0.3);
    p.state = PlayerState.BLOCK;
    p.animProg = 10;
    run(r, p, 0.1);
    const early = pt(r, J.HNR)[0];
    run(r, p, 0.4);
    const late = pt(r, J.HNR)[0];
    expect(late).toBeGreaterThan(11);
    // à 100 ms, on a parcouru l'essentiel du chemin
    expect(Math.abs(early - late)).toBeLessThan(2.5);
  });

  it('une arme à feu pointe dans la direction de visée, tenue à deux mains', () => {
    const r = new Rig();
    const p = createPoseInput();
    p.weapon = 4;
    p.weaponKind = WeaponKind.HITSCAN;
    p.aimX = 0;
    p.aimY = -1;
    run(r, p, 0.3);
    expect(r.holding).toBe(true);
    expect(r.weaponAngle).toBeCloseTo(-Math.PI / 2, 3);
    expect(dist(pt(r, J.HNR), [r.gripX, r.gripY])).toBeLessThan(0.5);
  });

  it('le coup vers le haut lève le poing au-dessus de la tête', () => {
    const r = new Rig();
    const p = createPoseInput();
    p.state = PlayerState.ATTACK;
    p.variant = AttackKind.UPPER | (AtkPhase.ACTIVE << 4);
    p.animProg = 3;
    run(r, p, 0.3);
    expect(pt(r, J.HNR)[1]).toBeLessThan(pt(r, J.HEAD)[1] - 3);
  });

  it('le tacle accroupi reste bas et tend le pied loin devant', () => {
    const jab = new Rig();
    const low = new Rig();
    const p = createPoseInput();
    p.state = PlayerState.ATTACK;
    p.animProg = 2;
    p.variant = AttackKind.FIST1 | (AtkPhase.ACTIVE << 4);
    run(jab, p, 0.3);
    p.variant = AttackKind.CROUCH | (AtkPhase.ACTIVE << 4);
    run(low, p, 0.3);
    expect(pt(low, J.HEAD)[1]).toBeGreaterThan(-16);
    expect(pt(low, J.FTR)[0]).toBeGreaterThan(12);
    expect(pt(low, J.FTR)[0]).toBeGreaterThan(pt(jab, J.FTR)[0] + 8);
    expect(pt(low, J.FTR)[1]).toBeGreaterThan(-4);
    for (const v of low.joints) expect(Number.isFinite(v)).toBe(true);
  });

  it('le saut périlleux soulève les pieds puis revient au sol', () => {
    const r = new Rig();
    const p = createPoseInput();
    p.victory = 2;
    let minFoot = 0;
    for (let i = 0; i < 120; i++) {
      p.timeS += 1 / 60;
      p.victoryT = p.timeS;
      r.update(p, times);
      minFoot = Math.min(minFoot, pt(r, J.FTR)[1]);
    }
    expect(minFoot).toBeLessThan(-6);
    p.victory = 0;
    run(r, p, 0.6);
    expect(Math.abs(pt(r, J.FTR)[1])).toBeLessThan(0.3);
  });
});
