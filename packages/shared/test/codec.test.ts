import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BinType,
  copyOwnState,
  createInputPacket,
  createOwnState,
  createSnapshot,
  decodeInput,
  decodePing,
  decodePong,
  decodeSnapshot,
  DecodeError,
  encodeInput,
  encodePing,
  encodePong,
  encodeSnapshot,
  eventIdDiff,
  createDecodedEvent,
  decodeEventPayload,
  encodeEventPayload,
  GamePhase,
  INPUT_PACKET_MAX,
  INPUT_PACKET_MIN,
  MAX_EVENT_PAYLOAD,
  MAX_MODE_DATA,
  MAX_OBJECTS,
  MAX_PROJECTILES,
  MAX_SNAPSHOT_EVENTS,
  OBJ_BYTES,
  ObjType,
  OWN_BYTES,
  OWN_FIELDS,
  ownEquals,
  PLAYER_BYTES,
  PROJ_BYTES,
  ProjType,
  SimEvent,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_MAX_BYTES,
} from '../src/index.ts';
import type { Snapshot } from '../src/index.ts';

function expectDecodeError(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DecodeError);
    return;
  }
  throw new Error('expected a DecodeError');
}

function sampleSnapshot(): Snapshot {
  const s = createSnapshot();
  s.tick = 123456;
  s.margin = -3;
  s.hasOwn = true;
  s.playerCount = 3;
  for (let i = 0; i < 3; i++) {
    const p = s.players[i];
    p.slot = i * 2;
    p.flags = 0xffff - i;
    p.x = 100.37 + i * 200;
    p.y = 528 - i;
    p.vx = -190.2 * i;
    p.vy = 55.55;
    p.aim = 4;
    p.hp = 100 - i;
    p.weapon = i;
    p.ammo = 8;
    p.anim = 3;
    p.animProg = 300; // plafonné à 255
    p.variant = 0x35;
  }
  s.game.phase = GamePhase.PLAYING;
  s.game.phaseTick = 70000; // plafonné à 65535
  s.game.round = 7;
  s.game.mode = 3;
  s.game.modeCount = 3;
  s.game.modeData[0] = 1;
  s.game.modeData[1] = 65535;
  s.game.modeData[2] = 300;
  s.objectCount = 2;
  Object.assign(s.objects[0], {
    uid: 65535,
    type: ObjType.WEAPON,
    x: 10.5,
    y: 20.25,
    vx: 0,
    vy: -3,
    a: 8,
    b: 3,
  });
  Object.assign(s.objects[1], {
    uid: 2,
    type: ObjType.MINE,
    x: 300,
    y: 400,
    vx: 1,
    vy: 2,
    a: 1,
    b: 255,
  });
  s.projCount = 1;
  Object.assign(s.projectiles[0], {
    uid: 9,
    type: ProjType.ROCKET,
    x: 50,
    y: 60,
    vx: 320,
    vy: -4,
    owner: 255,
    a: 8,
  });
  const o = s.own as unknown as Record<string, number>;
  OWN_FIELDS.forEach((f, i) => {
    o[f.key] =
      f.t === 'f32'
        ? 100.5 + i
        : f.t === 'i8'
          ? -1
          : f.t === 'u8'
            ? (i * 7) % 256
            : (i * 1001) % 65536;
  });
  s.own.flags = 0b10101;
  s.eventCount = 2;
  const n = encodeEventPayload(s.events[0].data, SimEvent.SPAWN, 4, [100.5, 200.25]);
  s.events[0].id = 65535;
  s.events[0].type = SimEvent.SPAWN;
  s.events[0].len = n;
  const m = encodeEventPayload(s.events[1].data, SimEvent.EMOTE, 1, [3]);
  s.events[1].id = 0;
  s.events[1].type = SimEvent.EMOTE;
  s.events[1].len = m;
  return s;
}

describe('paquet d entrées', () => {
  it('aller-retour', () => {
    const buf = new Uint8Array(INPUT_PACKET_MAX);
    const n = encodeInput(buf, 70000, 65534, 25, [0xff, 0x12, 0, 0x8001], 4);
    expect(n).toBe(INPUT_PACKET_MAX);
    const out = createInputPacket();
    decodeInput(buf.subarray(0, n), out);
    expect(out.tick).toBe(70000 & 0xffff);
    expect(out.ack).toBe(65534);
    expect(out.rewind).toBe(25);
    expect(out.count).toBe(4);
    expect(Array.from(out.masks)).toEqual([0xff, 0x12, 0, 0x8001]);
  });

  it('taille minimale (une entrée)', () => {
    const buf = new Uint8Array(INPUT_PACKET_MAX);
    expect(encodeInput(buf, 1, 2, 3, [5], 1)).toBe(INPUT_PACKET_MIN);
  });

  it('rejette les paquets tronqués, trop longs ou au mauvais type', () => {
    const buf = new Uint8Array(INPUT_PACKET_MAX);
    const n = encodeInput(buf, 1, 2, 3, [1, 2, 3, 4], 4);
    const out = createInputPacket();
    for (let len = 0; len < n; len++)
      expectDecodeError(() => decodeInput(buf.subarray(0, len), out));
    const longer = new Uint8Array(n + 1);
    longer.set(buf.subarray(0, n));
    expectDecodeError(() => decodeInput(longer, out));
    const bad = buf.slice(0, n);
    bad[0] = BinType.PING;
    expectDecodeError(() => decodeInput(bad, out));
    const zero = buf.slice(0, n);
    zero[6] = 0;
    expectDecodeError(() => decodeInput(zero, out));
    zero[6] = 5;
    expectDecodeError(() => decodeInput(zero, out));
  });
});

describe('ping / pong', () => {
  it('aller-retour', () => {
    const buf = new Uint8Array(16);
    const n = encodePing(buf, 4_000_000_000);
    expect(n).toBe(5);
    expect(decodePing(buf.subarray(0, n))).toBe(4_000_000_000);
    const m = encodePong(buf, 123, 99999, 0.5);
    expect(m).toBe(10);
    const out = { clientTime: 0, tick: 0, frac: 0 };
    decodePong(buf.subarray(0, m), out);
    expect(out.clientTime).toBe(123);
    expect(out.tick).toBe(99999);
    expect(out.frac).toBeCloseTo(0.5, 2);
  });

  it('rejette les messages tronqués', () => {
    const buf = new Uint8Array(16);
    const n = encodePing(buf, 1);
    for (let len = 0; len < n; len++) expectDecodeError(() => decodePing(buf.subarray(0, len)));
    const m = encodePong(buf, 1, 2, 0.1);
    for (let len = 0; len < m; len++) {
      expectDecodeError(() =>
        decodePong(buf.subarray(0, len), { clientTime: 0, tick: 0, frac: 0 }),
      );
    }
  });
});

describe('snapshot', () => {
  it('aller-retour (à la quantification près)', () => {
    const s = sampleSnapshot();
    const buf = new Uint8Array(SNAPSHOT_MAX_BYTES);
    const n = encodeSnapshot(buf, s);
    const expectedSize =
      SNAPSHOT_HEADER_BYTES +
      3 * PLAYER_BYTES +
      2 * OBJ_BYTES +
      PROJ_BYTES +
      3 * 2 +
      OWN_BYTES +
      (4 + 5) +
      (4 + 3);
    expect(n).toBe(expectedSize);

    const d = createSnapshot();
    decodeSnapshot(buf.subarray(0, n), d);
    expect(d.tick).toBe(s.tick);
    expect(d.margin).toBe(-3);
    expect(d.hasOwn).toBe(true);
    expect(d.playerCount).toBe(3);
    for (let i = 0; i < 3; i++) {
      const a = s.players[i];
      const b = d.players[i];
      expect(b.slot).toBe(a.slot);
      expect(b.flags).toBe(a.flags);
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1 / 16 + 1e-9);
      expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1 / 16 + 1e-9);
      expect(Math.abs(b.vx - a.vx)).toBeLessThanOrEqual(1 / 16 + 1e-9);
      expect(Math.abs(b.vy - a.vy)).toBeLessThanOrEqual(1 / 16 + 1e-9);
      expect(b.hp).toBe(a.hp);
      expect(b.variant).toBe(0x35);
      expect(b.animProg).toBe(255);
    }
    expect(d.game).toMatchObject({
      phase: GamePhase.PLAYING,
      phaseTick: 65535,
      round: 7,
      mode: 3,
      modeCount: 3,
    });
    expect(Array.from(d.game.modeData.subarray(0, 3))).toEqual([1, 65535, 300]);
    expect(d.objectCount).toBe(2);
    expect(d.objects[0]).toEqual({
      uid: 65535,
      type: ObjType.WEAPON,
      x: 10.5,
      y: 20.25,
      vx: 0,
      vy: -3,
      a: 8,
      b: 3,
    });
    expect(d.objects[1].b).toBe(255);
    expect(d.projCount).toBe(1);
    expect(d.projectiles[0]).toEqual({
      uid: 9,
      type: ProjType.ROCKET,
      x: 50,
      y: 60,
      vx: 320,
      vy: -4,
      owner: 255,
      a: 8,
    });
    expect(ownEquals(d.own, s.own)).toBe(true);
    expect(d.eventCount).toBe(2);
    expect(d.events[0].id).toBe(65535);
    const ev = createDecodedEvent();
    decodeEventPayload(d.events[0].type, d.events[0].data, d.events[0].len, ev);
    expect(ev.slot).toBe(4);
    expect(Array.from(ev.a.subarray(0, ev.n))).toEqual([100.5, 200.25]);
  });

  it('le bloc own fait 69 octets et couvre tous les champs d état exact', () => {
    expect(OWN_BYTES).toBe(69);
    expect(OWN_FIELDS.map((f) => f.key)).toContain('atkBuffer');
    expect(new Set(OWN_FIELDS.map((f) => f.key)).size).toBe(OWN_FIELDS.length);
  });

  it('tailles maximales : un snapshot plein tient dans SNAPSHOT_MAX_BYTES', () => {
    const s = sampleSnapshot();
    s.playerCount = 8;
    s.objectCount = MAX_OBJECTS;
    s.projCount = MAX_PROJECTILES;
    s.game.modeCount = MAX_MODE_DATA;
    s.eventCount = MAX_SNAPSHOT_EVENTS;
    for (const e of s.events) {
      e.len = MAX_EVENT_PAYLOAD;
      e.type = SimEvent.KO;
    }
    for (let i = 0; i < 8; i++) s.players[i].slot = i;
    for (const o of s.objects) o.type = ObjType.CRATE;
    for (const p of s.projectiles) p.type = ProjType.PELLET;
    const buf = new Uint8Array(SNAPSHOT_MAX_BYTES);
    const n = encodeSnapshot(buf, s);
    expect(n).toBe(SNAPSHOT_MAX_BYTES);
    decodeSnapshot(buf.subarray(0, n), createSnapshot());
  });

  it('un snapshot sans bloc own est plus court', () => {
    const s = sampleSnapshot();
    s.hasOwn = false;
    const buf = new Uint8Array(SNAPSHOT_MAX_BYTES);
    const n = encodeSnapshot(buf, s);
    const d = createSnapshot();
    decodeSnapshot(buf.subarray(0, n), d);
    expect(d.hasOwn).toBe(false);
    expect(n).toBe(
      SNAPSHOT_HEADER_BYTES +
        3 * PLAYER_BYTES +
        2 * OBJ_BYTES +
        PROJ_BYTES +
        3 * 2 +
        (4 + 5) +
        (4 + 3),
    );
  });

  it('rejette toutes les troncatures', () => {
    const s = sampleSnapshot();
    const buf = new Uint8Array(SNAPSHOT_MAX_BYTES);
    const n = encodeSnapshot(buf, s);
    const d = createSnapshot();
    for (let len = 0; len < n; len++)
      expectDecodeError(() => decodeSnapshot(buf.subarray(0, len), d));
  });

  it('rejette les octets en trop, les compteurs hors bornes et les drapeaux inconnus', () => {
    const s = sampleSnapshot();
    const buf = new Uint8Array(SNAPSHOT_MAX_BYTES + 1);
    const n = encodeSnapshot(buf, s);
    const d = createSnapshot();
    expectDecodeError(() => decodeSnapshot(buf.subarray(0, n + 1), d));
    const b2 = buf.slice(0, n);
    b2[7] = 9; // playerCount
    expectDecodeError(() => decodeSnapshot(b2, d));
    const b3 = buf.slice(0, n);
    b3[8] = MAX_SNAPSHOT_EVENTS + 1;
    expectDecodeError(() => decodeSnapshot(b3, d));
    const b4 = buf.slice(0, n);
    b4[6] = 0x80;
    expectDecodeError(() => decodeSnapshot(b4, d));
    const b5 = buf.slice(0, n);
    b5[SNAPSHOT_HEADER_BYTES] = 8; // slot hors bornes
    expectDecodeError(() => decodeSnapshot(b5, d));
    const b6 = buf.slice(0, n);
    b6[9] = MAX_OBJECTS + 1;
    expectDecodeError(() => decodeSnapshot(b6, d));
    const b7 = buf.slice(0, n);
    b7[10] = MAX_PROJECTILES + 1;
    expectDecodeError(() => decodeSnapshot(b7, d));
    const b8 = buf.slice(0, n);
    b8[11] = 9; // phase inconnue
    expectDecodeError(() => decodeSnapshot(b8, d));
    const b9 = buf.slice(0, n);
    b9[16] = MAX_MODE_DATA + 1;
    expectDecodeError(() => decodeSnapshot(b9, d));
    const b10 = buf.slice(0, n);
    b10[SNAPSHOT_HEADER_BYTES + 3 * PLAYER_BYTES + 2] = 99; // type d'objet inconnu
    expectDecodeError(() => decodeSnapshot(b10, d));
    const b11 = buf.slice(0, n);
    b11[SNAPSHOT_HEADER_BYTES + 3 * PLAYER_BYTES + 2 * OBJ_BYTES + 2] = 0; // type de projectile
    expectDecodeError(() => decodeSnapshot(b11, d));
    const b12 = buf.slice(0, n);
    b12[SNAPSHOT_HEADER_BYTES + 11] = 17; // visée hors des 16 secteurs
    expectDecodeError(() => decodeSnapshot(b12, d));
  });

  it('rejette un flottant non fini dans le bloc own', () => {
    const s = sampleSnapshot();
    const buf = new Uint8Array(SNAPSHOT_MAX_BYTES);
    const n = encodeSnapshot(buf, s);
    const off = SNAPSHOT_HEADER_BYTES + 3 * PLAYER_BYTES + 2 * OBJ_BYTES + PROJ_BYTES + 3 * 2;
    new DataView(buf.buffer).setFloat32(off, NaN, true);
    expectDecodeError(() => decodeSnapshot(buf.subarray(0, n), createSnapshot()));
  });

  it('copyOwnState copie tous les champs', () => {
    const a = createOwnState();
    const b = sampleSnapshot().own;
    copyOwnState(a, b);
    expect(a).toEqual(b);
  });

  it('comparaison des identifiants d événements avec retour à zéro', () => {
    expect(eventIdDiff(5, 3)).toBe(2);
    expect(eventIdDiff(3, 5)).toBe(-2);
    expect(eventIdDiff(1, 65535)).toBe(2);
    expect(eventIdDiff(65535, 1)).toBe(-2);
  });
});

describe('fuzzing', () => {
  it('des octets aléatoires ne provoquent jamais autre chose qu une DecodeError', () => {
    const out = createInputPacket();
    const snap = createSnapshot();
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 600 }), (bytes) => {
        for (const first of [BinType.INPUT, BinType.SNAPSHOT, BinType.PING, BinType.PONG, 99]) {
          const buf = bytes.slice();
          if (buf.length > 0) buf[0] = first;
          for (const fn of [
            () => decodeInput(buf, out),
            () => decodeSnapshot(buf, snap),
            () => decodePing(buf),
            () => decodePong(buf, { clientTime: 0, tick: 0, frac: 0 }),
          ]) {
            try {
              fn();
            } catch (e) {
              if (!(e instanceof DecodeError)) return false;
            }
          }
        }
        return true;
      }),
      { numRuns: 2000 },
    );
  });

  it('muter un octet d un snapshot valide ne casse jamais le décodeur', () => {
    const buf = new Uint8Array(SNAPSHOT_MAX_BYTES);
    const n = encodeSnapshot(buf, sampleSnapshot());
    const valid = buf.slice(0, n);
    const d = createSnapshot();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: 255 }), (i, v) => {
        const m = valid.slice();
        m[i] = v;
        try {
          decodeSnapshot(m, d);
        } catch (e) {
          return e instanceof DecodeError;
        }
        return true;
      }),
      { numRuns: 3000 },
    );
  });

  it('un snapshot valide aléatoire fait l aller-retour', () => {
    const arbPlayer = fc.record({
      slot: fc.integer({ min: 0, max: 7 }),
      flags: fc.integer({ min: 0, max: 0xffff }),
      x: fc.integer({ min: -4000 * 8, max: 4000 * 8 }).map((v) => v / 8),
      y: fc.integer({ min: -4000 * 8, max: 4000 * 8 }).map((v) => v / 8),
      vx: fc.integer({ min: -4000 * 8, max: 4000 * 8 }).map((v) => v / 8),
      vy: fc.integer({ min: -4000 * 8, max: 4000 * 8 }).map((v) => v / 8),
      aim: fc.integer({ min: 0, max: 15 }),
      hp: fc.integer({ min: 0, max: 255 }),
      weapon: fc.integer({ min: 0, max: 255 }),
      ammo: fc.integer({ min: 0, max: 255 }),
      anim: fc.integer({ min: 0, max: 255 }),
      animProg: fc.integer({ min: 0, max: 255 }),
      variant: fc.integer({ min: 0, max: 255 }),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: -128, max: 127 }),
        fc.array(arbPlayer, { maxLength: 8 }),
        (tick, margin, players) => {
          const s = createSnapshot();
          s.tick = tick;
          s.margin = margin;
          s.playerCount = players.length;
          players.forEach((p, i) => Object.assign(s.players[i], p));
          const buf = new Uint8Array(SNAPSHOT_MAX_BYTES);
          const n = encodeSnapshot(buf, s);
          const d = createSnapshot();
          decodeSnapshot(buf.subarray(0, n), d);
          expect(d.tick).toBe(tick);
          expect(d.margin).toBe(margin);
          expect(d.playerCount).toBe(players.length);
          players.forEach((p, i) => expect(d.players[i]).toEqual(p));
          return true;
        },
      ),
      { numRuns: 500 },
    );
  });
});
