import { AtkPhase, AttackKind, createSnapshot, PlayerState } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { CONFIRM_WINDOW_MS, HitConfirms } from '../src/app/confirm.ts';
import { createRemoteView, sampleAnim } from '../src/net/interpolation.ts';

describe('animation des autres joueurs entre deux snapshots', () => {
  const snap = (anim: number, animProg: number, variant = 0) => {
    const p = createSnapshot().players[0];
    p.anim = anim;
    p.animProg = animProg;
    p.variant = variant;
    return p;
  };
  const active = (AtkPhase.ACTIVE << 4) | AttackKind.FIST1;
  const recovery = (AtkPhase.RECOVERY << 4) | AttackKind.FIST1;

  it('dans un même état, la progression avance avec le temps au lieu de sauter', () => {
    const out = createRemoteView();
    const a = snap(PlayerState.RUN, 10);
    const b = snap(PlayerState.RUN, 12);
    sampleAnim(a, 100, b, 102, 100.5, out);
    expect(out.animProg).toBeCloseTo(10.5, 5);
    sampleAnim(a, 100, b, 102, 101.5, out);
    expect(out.animProg).toBeCloseTo(11.5, 5);
  });

  it('un changement de phase entre deux snapshots est placé au tick où il a eu lieu', () => {
    const out = createRemoteView();
    // en `a` (tick 100) : images actives depuis 1 tick ; en `b` (tick 102) : récupération depuis 0
    const a = snap(PlayerState.ATTACK, 1, active);
    const b = snap(PlayerState.ATTACK, 0, recovery);
    sampleAnim(a, 100, b, 102, 101, out);
    expect(out.variant).toBe(active);
    expect(out.animProg).toBeCloseTo(2, 5);
    sampleAnim(a, 100, b, 102, 102, out);
    expect(out.variant).toBe(recovery);
    expect(out.animProg).toBe(0);
  });

  it('une progression plafonnée (255) garde l’état de `b`', () => {
    const out = createRemoteView();
    sampleAnim(snap(PlayerState.IDLE, 255), 100, snap(PlayerState.IDLE, 255), 102, 101, out);
    expect(out.anim).toBe(PlayerState.IDLE);
    expect(out.animProg).toBe(255);
  });
});

describe('coups confirmés à l’écran', () => {
  it('l’événement du serveur qui suit est reconnu une seule fois, et seulement le sien', () => {
    const c = new HitConfirms();
    c.mark(3, 1000);
    expect(c.take(2, 3, 1, 1100)).toBe(false); // un autre frappeur
    expect(c.take(1, 4, 1, 1100)).toBe(false); // une autre cible
    expect(c.take(1, 3, 1, 1100)).toBe(true);
    expect(c.take(1, 3, 1, 1150)).toBe(false); // déjà consommé
  });

  it('une confirmation trop ancienne ne masque rien', () => {
    const c = new HitConfirms();
    c.mark(3, 1000);
    expect(c.take(1, 3, 1, 1000 + CONFIRM_WINDOW_MS + 1)).toBe(false);
  });
});
