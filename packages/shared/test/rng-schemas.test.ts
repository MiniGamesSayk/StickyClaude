import { describe, expect, it } from 'vitest';
import { clientMessageSchema } from '../src/schemas.ts';
import {
  DEFAULT_MOVEMENT,
  isMovementKey,
  MOVEMENT_KEYS,
  MOVEMENT_TUNING,
  Rng,
} from '../src/index.ts';

describe('Rng', () => {
  it('est déterministe selon la graine', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const c = new Rng(124);
    const sa = Array.from({ length: 100 }, () => a.nextU32());
    const sb = Array.from({ length: 100 }, () => b.nextU32());
    const sc = Array.from({ length: 100 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('produit des flottants dans [0, 1) et des entiers bornés, à peu près uniformes', () => {
    const r = new Rng(9);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      buckets[r.int(10)]++;
    }
    for (const n of buckets) expect(Math.abs(n - 10_000)).toBeLessThan(600);
  });

  it('accepte les graines extrêmes sans état nul', () => {
    for (const seed of [0, 1, 0xffffffff, -1, 2 ** 40]) {
      const r = new Rng(seed);
      expect(r.s[0] | r.s[1] | r.s[2] | r.s[3]).not.toBe(0);
      r.nextU32();
    }
  });
});

describe('mouvement', () => {
  it('chaque constante a des métadonnées de réglage cohérentes', () => {
    for (const k of MOVEMENT_KEYS) {
      const m = MOVEMENT_TUNING[k];
      expect(m.min).toBeLessThan(m.max);
      expect(DEFAULT_MOVEMENT[k]).toBeGreaterThanOrEqual(m.min);
      expect(DEFAULT_MOVEMENT[k]).toBeLessThanOrEqual(m.max);
    }
    expect(isMovementKey('runSpeed')).toBe(true);
    expect(isMovementKey('toString')).toBe(false);
    expect(isMovementKey('__proto__')).toBe(false);
  });
});

describe('messages de contrôle', () => {
  const ok = (m: unknown): boolean => clientMessageSchema.safeParse(m).success;

  it('accepte les messages valides', () => {
    expect(ok({ t: 'create', v: 1, name: 'Sayk' })).toBe(true);
    expect(ok({ t: 'create', v: 1, name: 'Sayk', arena: 'test-flat' })).toBe(true);
    expect(ok({ t: 'join', v: 1, name: 'Sayk', code: 'ABCDE' })).toBe(true);
    expect(ok({ t: 'leave' })).toBe(true);
    expect(ok({ t: 'tune', k: 'runSpeed', val: 200 })).toBe(true);
  });

  it('rejette les messages invalides', () => {
    expect(ok(null)).toBe(false);
    expect(ok('x')).toBe(false);
    expect(ok({})).toBe(false);
    expect(ok({ t: 'create' })).toBe(false);
    expect(ok({ t: 'create', v: 1.5, name: 'x' })).toBe(false);
    expect(ok({ t: 'create', v: 1, name: '' })).toBe(false);
    expect(ok({ t: 'create', v: 1, name: 'x'.repeat(65) })).toBe(false);
    expect(ok({ t: 'join', v: 1, name: 'ab', code: 'x'.repeat(9) })).toBe(false);
    expect(ok({ t: 'leave', extra: 1 })).toBe(false);
    expect(ok({ t: 'tune', k: 'nope', val: 1 })).toBe(false);
    expect(ok({ t: 'tune', k: 'runSpeed', val: Infinity })).toBe(false);
    expect(ok({ t: 'tune', k: 'runSpeed', val: '3' })).toBe(false);
    expect(ok({ t: 'unknown' })).toBe(false);
  });
});
