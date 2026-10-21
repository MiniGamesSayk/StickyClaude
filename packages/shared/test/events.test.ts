import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  closestFreeColor,
  COLOR_COUNT,
  createDecodedEvent,
  DecodeError,
  decodeEventPayload,
  DEFAULT_SETTINGS,
  encodeEventPayload,
  EVENT_MAX_ARGS,
  EVENT_SPECS,
  eventPayloadLength,
  INK_COLORS,
  isNetworkEvent,
  MAX_EVENT_PAYLOAD,
  MODES,
  BONUS_MODE_IDS,
  normalizeSettings,
  sanitizeLook,
  SimEvent,
  WEAPONS,
  rewindOf,
  withRewind,
  aimFromInput,
  Input,
} from '../src/index.ts';

describe('événements réseau génériques', () => {
  it('chaque type tient dans la charge utile maximale', () => {
    for (const [type, spec] of Object.entries(EVENT_SPECS)) {
      expect(spec.length).toBeLessThanOrEqual(EVENT_MAX_ARGS);
      expect(eventPayloadLength(Number(type))).toBeLessThanOrEqual(MAX_EVENT_PAYLOAD);
      expect(isNetworkEvent(Number(type))).toBe(true);
      expect(spec).toMatch(/^[piu]+$/);
    }
    expect(isNetworkEvent(SimEvent.JUMP)).toBe(false);
    expect(isNetworkEvent(SimEvent.ROUND_START)).toBe(false);
  });

  it('aller-retour pour chaque type, avec positions au 1/8 d unité', () => {
    const buf = new Uint8Array(MAX_EVENT_PAYLOAD);
    const out = createDecodedEvent();
    for (const [t, spec] of Object.entries(EVENT_SPECS)) {
      const type = Number(t);
      const args = Array.from(spec, (c, i) =>
        c === 'p' ? 100.25 + i : c === 'u' ? 65000 + i : -3 - i,
      );
      const n = encodeEventPayload(buf, type, 6, args);
      expect(n).toBe(1 + 2 * spec.length);
      decodeEventPayload(type, buf, n, out);
      expect(out.slot).toBe(6);
      expect(out.n).toBe(spec.length);
      expect(Array.from(out.a.subarray(0, out.n))).toEqual(args);
    }
  });

  it('rejette un type inconnu ou une longueur qui ne correspond pas', () => {
    const buf = new Uint8Array(MAX_EVENT_PAYLOAD);
    const out = createDecodedEvent();
    expect(() => decodeEventPayload(250, buf, 3, out)).toThrow(DecodeError);
    const n = encodeEventPayload(buf, SimEvent.KO, 0, [0, 0, 0, 0, 0, 0]);
    expect(() => decodeEventPayload(SimEvent.KO, buf, n - 1, out)).toThrow(DecodeError);
    expect(() => decodeEventPayload(SimEvent.KO, buf, n + 1, out)).toThrow(DecodeError);
    expect(encodeEventPayload(buf, SimEvent.JUMP, 0, [])).toBe(-1);
  });

  it('borne les valeurs hors plage au lieu de déborder', () => {
    const buf = new Uint8Array(MAX_EVENT_PAYLOAD);
    const out = createDecodedEvent();
    const n = encodeEventPayload(buf, SimEvent.EXPLOSION, 0, [1e9, -1e9, 1e9, -5]);
    decodeEventPayload(SimEvent.EXPLOSION, buf, n, out);
    expect(out.a[0]).toBe(32767 / 8);
    expect(out.a[1]).toBe(-32768 / 8);
    expect(out.a[3]).toBe(-5);
  });

  it('fuzzing : des octets aléatoires ne donnent jamais autre chose qu une DecodeError', () => {
    const out = createDecodedEvent();
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.uint8Array({ maxLength: 20 }),
        (type, bytes) => {
          try {
            decodeEventPayload(type, bytes, bytes.length, out);
          } catch (e) {
            return e instanceof DecodeError;
          }
          return true;
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('compensation de latence dans le masque', () => {
  it('les bits 12 à 15 portent le retard, les boutons restent intacts', () => {
    const m = withRewind(0xffff, 9);
    expect(rewindOf(m)).toBe(9);
    expect(m & 0xff).toBe(0xff);
    expect(m & 0x0f00).toBe(0);
    expect(rewindOf(withRewind(0, 99))).toBe(15);
    expect(rewindOf(withRewind(0, -4))).toBe(0);
  });

  it('huit directions de visée', () => {
    expect(aimFromInput(0)).toBe(-1);
    expect(aimFromInput(Input.RIGHT)).toBe(0);
    expect(aimFromInput(Input.LEFT)).toBe(4);
    expect(aimFromInput(Input.UP)).toBe(6);
    expect(aimFromInput(Input.DOWN)).toBe(2);
    expect(aimFromInput(Input.RIGHT | Input.UP)).toBe(7);
    expect(aimFromInput(Input.LEFT | Input.DOWN)).toBe(3);
    expect(aimFromInput(Input.LEFT | Input.RIGHT)).toBe(-1);
  });
});

describe('réglages de partie', () => {
  const known = new Set(['a', 'b']);

  it('les valeurs par défaut sont celles de l analyse', () => {
    expect(DEFAULT_SETTINGS.roundsToWin).toBe(5);
    expect(DEFAULT_SETTINGS.suddenDeathSec).toBe(75);
    expect(DEFAULT_SETTINGS.ghosts).toBe(true);
    expect(DEFAULT_SETTINGS.friendlyFire).toBe(false);
    expect(DEFAULT_SETTINGS.bonusEvery).toBe(3);
    expect(DEFAULT_SETTINGS.bonusModes).toEqual([...BONUS_MODE_IDS]);
    expect(BONUS_MODE_IDS).toHaveLength(6);
    expect(MODES.filter((m) => m.bonus)).toHaveLength(6);
  });

  it('normalise : bornes, listes blanches, types', () => {
    const s = normalizeSettings(
      {
        roundsToWin: 4,
        teams: 9,
        suddenDeathSec: 1,
        arenas: ['a', 'zzz', 'a', 'b'],
        bonusModes: [2, 2, 99, 6, 0],
        bonusEvery: 100,
        mode: 'nope' as 'ffa',
        weapons: 'oui' as unknown as boolean,
      },
      DEFAULT_SETTINGS,
      known,
    );
    expect(s.roundsToWin).toBe(5);
    expect(s.teams).toBe(4);
    expect(s.suddenDeathSec).toBe(20);
    expect(s.arenas).toEqual(['a', 'b']);
    expect(s.bonusModes).toEqual([2, 6]);
    expect(s.bonusEvery).toBe(6);
    expect(s.mode).toBe('ffa');
    expect(s.weapons).toBe(true);
  });

  it('propriété : le résultat est toujours valide, quelles que soient les entrées', () => {
    fc.assert(
      fc.property(
        fc.record({
          roundsToWin: fc.oneof(fc.integer(), fc.double(), fc.constant(NaN)),
          teams: fc.oneof(fc.integer(), fc.constant(Infinity)),
          suddenDeathSec: fc.integer(),
          bonusEvery: fc.integer(),
        }),
        (patch) => {
          const s = normalizeSettings(patch, DEFAULT_SETTINGS, known);
          return (
            [3, 5, 7].includes(s.roundsToWin) &&
            s.teams >= 2 &&
            s.teams <= 4 &&
            s.suddenDeathSec >= 20 &&
            s.suddenDeathSec <= 180 &&
            s.bonusEvery >= 0 &&
            s.bonusEvery <= 6
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('apparence', () => {
  it('chaque champ est validé contre sa liste blanche', () => {
    expect(sanitizeLook({ color: 5, stroke: 3, hat: 11, victory: 3 })).toEqual({
      color: 5,
      stroke: 3,
      hat: 11,
      victory: 3,
    });
    expect(sanitizeLook({ color: 12, stroke: 4, hat: -1, victory: 1.5 })).toEqual({
      color: 0,
      stroke: 0,
      hat: 0,
      victory: 0,
    });
    expect(sanitizeLook(null)).toEqual({ color: 0, stroke: 0, hat: 0, victory: 0 });
    expect(sanitizeLook('x')).toEqual({ color: 0, stroke: 0, hat: 0, victory: 0 });
    expect(
      sanitizeLook({ color: '3', constructor: 1 }, { color: 2, stroke: 1, hat: 1, victory: 1 }),
    ).toEqual({
      color: 2,
      stroke: 1,
      hat: 1,
      victory: 1,
    });
  });

  it('douze couleurs, la plus proche libre en cas de conflit', () => {
    expect(COLOR_COUNT).toBe(12);
    expect(INK_COLORS).toHaveLength(12);
    expect(closestFreeColor(4, new Set())).toBe(4);
    const used = new Set([4]);
    const c = closestFreeColor(4, used);
    expect(c).not.toBe(4);
    // tout est pris : on garde la couleur demandée
    expect(closestFreeColor(2, new Set(Array.from({ length: 12 }, (_, i) => i)))).toBe(2);
    // jamais deux fois la même couleur dans un salon de 8
    const taken = new Set<number>();
    for (let i = 0; i < 8; i++) taken.add(closestFreeColor(0, taken));
    expect(taken.size).toBe(8);
  });
});

describe('données des armes', () => {
  it('chaque arme a un identifiant égal à sa position', () => {
    WEAPONS.forEach((w, i) => expect(w.id).toBe(i));
  });
});
