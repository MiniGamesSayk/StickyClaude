import {
  BinType,
  createDecodedEvent,
  decodeEventPayload,
  Input,
  ObjType,
  PROTOCOL_VERSION,
  SimEvent,
  WeaponId,
  GamePhase,
  rewindOf,
  LAG_COMP_TICKS,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { Bot, harness } from './helpers.ts';
import type { FakeConn } from './helpers.ts';

function eventsOf(conn: FakeConn, type: number): number[][] {
  const out: number[][] = [];
  const seen = new Set<number>();
  const ev = createDecodedEvent();
  for (const s of conn.snapshots()) {
    for (let i = 0; i < s.eventCount; i++) {
      const e = s.events[i];
      if (e.type !== type || seen.has(e.id)) continue;
      seen.add(e.id);
      decodeEventPayload(e.type, e.data, e.len, ev);
      out.push([ev.slot, ...Array.from(ev.a.subarray(0, ev.n))]);
    }
  }
  return out;
}

describe('ticks, entrées et snapshots', () => {
  it('envoie des snapshots à 30 Hz avec le bloc own et l état de la partie', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(60);
    const snaps = a.snapshots();
    expect(snaps).toHaveLength(30);
    expect(snaps[0].hasOwn).toBe(true);
    expect(snaps.at(-1)!.tick).toBe(60);
    const last = snaps.at(-1)!;
    expect(last.own.y).toBeCloseTo(528, 1);
    expect(last.playerCount).toBe(1);
    expect(last.game.phase).toBe(GamePhase.LOBBY);
    expect(last.own.hp).toBe(100);
  });

  it('applique les entrées étiquetées par tick, de façon déterministe', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(100); // se pose
    const x0 = a.snapshots().at(-1)!.own.x;
    const start = h.room([...h.server.rooms.keys()][0]).world.tick;
    for (let t = start + 1; t <= start + 30; t += 4) {
      const hi = Math.min(start + 30, t + 3);
      h.sendInput(a, hi, [Input.RIGHT, Input.RIGHT, Input.RIGHT, Input.RIGHT]);
    }
    h.advance(30);
    const last = a.snapshots().at(-1)!;
    expect(last.own.x).toBeGreaterThan(x0 + 40);
    expect(last.own.vx).toBeCloseTo(190, 1);
  });

  it('répète la dernière entrée quand une entrée manque, puis revient au neutre', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(100);
    h.sendInput(a, 102, [Input.RIGHT, Input.RIGHT]);
    h.advance(10);
    expect(a.snapshots().at(-1)!.own.vx).toBeGreaterThan(100);
    h.advance(60);
    expect(a.snapshots().at(-1)!.own.vx).toBe(0);
  });

  it('rejette les entrées en retard et trop en avance, et signale la marge', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(10);
    h.sendInput(a, 16, [Input.LEFT]);
    h.advance(2);
    expect(a.snapshots().at(-1)!.margin).toBe(5);
    const late0 = h.server.metrics.inputsLate;
    h.sendInput(a, 5, [Input.LEFT]);
    expect(h.server.metrics.inputsLate).toBe(late0 + 1);
    h.advance(2);
    expect(a.snapshots().at(-1)!.margin).toBe(-8);
    h.sendInput(a, 13 + 500, [Input.LEFT]);
    h.advance(4);
    expect(a.closed).toBeNull();
  });

  it('reconstitue les étiquettes de 16 bits autour du tick courant', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.advance(100);
    const room = h.room(code);
    room.world.tick = 65_530;
    h.sendInput(a, (65_536 + 3) & 0xffff, [Input.RIGHT]);
    h.advance(2);
    expect(room.world.tick).toBe(65_532);
    expect(a.snapshots().at(-1)!.margin).toBe(65_539 - 65_531);
  });

  it('limite les paquets d entrées à 70 par seconde', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    for (let i = 0; i < 100; i++) h.sendInput(a, 5, [Input.RIGHT]);
    expect(h.server.metrics.inputsLimited).toBe(30);
    h.time += 1100;
    h.sendInput(a, 5, [Input.RIGHT]);
    expect(h.server.metrics.inputsLimited).toBe(30);
  });

  it('répond aux pings avec le tick et la fraction de tick', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(5);
    h.time += 8;
    h.sendPing(a, 123456);
    const p = a.pongs()[0];
    expect(p.clientTime).toBe(123456);
    expect(p.tick).toBe(5);
    expect(p.frac).toBeGreaterThan(0.3);
    expect(p.frac).toBeLessThan(0.7);
  });

  it('ne simule pas les salons sans joueur', () => {
    const h = harness({ ROOM_IDLE_TTL_SEC: '600', RECONNECT_GRACE_MS: '0' });
    const a = h.connect();
    const code = h.create(a);
    h.advance(10);
    h.server.onClose(a);
    const tick = h.room(code).world.tick;
    h.advance(100);
    expect(h.room(code).world.tick).toBe(tick);
  });

  it('les bits réservés au serveur sont ignorés quand un client les forge', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.advance(100);
    const room = h.room(code);
    const t = room.world.tick;
    // un client forge le retard de compensation (bits 14 et 15 d'un ancien client, 16-17 inatteignables) et des bits inexistants
    h.sendInput(a, t + 3, [0xf000 | 0x0f00 | Input.ATTACK]);
    h.advance(5);
    const p = room.world.players[0];
    expect(rewindOf(p.prevInput)).toBe(0);
    // le bit 14 est le bouton spécial ; seul le bit 15 réservé doit être filtré
    expect(p.prevInput & 0x8000).toBe(0);
    expect(p.prevInput & Input.SPECIAL).toBe(Input.SPECIAL);
  });

  it('borne la compensation de latence annoncée', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.advance(10);
    const room = h.room(code);
    const t = room.world.tick;
    const buf = new Uint8Array(16);
    // rewind = 255 pas de 4 ms (1 s) : le serveur la ramène à LAG_COMP_TICKS (18 ticks, 300 ms)
    const n = (await_import(), encode(buf, t + 3, 255));
    h.server.onMessage(a, buf.slice(0, n), true);
    expect(room.recording).toBeNull();
    h.advance(3);
    expect(room.world.players[0].rewind).toBe(LAG_COMP_TICKS);
  });
});

function await_import(): void {}
import { encodeInput } from '@stickyclaude/shared';
function encode(buf: Uint8Array, tick: number, rewind: number): number {
  return encodeInput(buf, tick, 0, rewind, [0], 1);
}

describe('événements fiables', () => {
  it('répète SPAWN dans les snapshots jusqu à l accusé de réception', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const b = h.connect('10.0.0.2');
    h.advance(10);
    h.join(b, code);
    h.advance(6);
    const carrying = (c: FakeConn): { id: number; slot: number }[] => {
      const out: { id: number; slot: number }[] = [];
      const ev = createDecodedEvent();
      for (const s of c.snapshots()) {
        for (let i = 0; i < s.eventCount; i++) {
          const e = s.events[i];
          if (e.type !== SimEvent.SPAWN) continue;
          decodeEventPayload(e.type, e.data, e.len, ev);
          out.push({ id: e.id, slot: ev.slot });
        }
      }
      return out;
    };
    const seen = carrying(a);
    expect(seen.length).toBeGreaterThanOrEqual(2); // répété dans plusieurs snapshots
    expect(seen.every((e) => e.slot === 1)).toBe(true);
    // Le nouvel arrivant, lui, ne reçoit pas son propre SPAWN.
    expect(carrying(b)).toHaveLength(0);
    h.sendInput(a, 30, [0], seen[0].id);
    h.advance(6);
    a.clear();
    h.advance(6);
    expect(carrying(a)).toHaveLength(0);
  });

  it('livre aussi les événements quand des snapshots sont sautés (contre-pression)', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.advance(4);
    a.clear();
    a.bufferedAmount = 200_000;
    const b = h.connect('10.0.0.2');
    h.join(b, code);
    h.advance(20);
    expect(a.snapshots()).toHaveLength(0);
    expect(h.server.metrics.snapshotsSkipped).toBeGreaterThan(0);
    a.bufferedAmount = 0;
    h.advance(4);
    expect(eventsOf(a, SimEvent.SPAWN).some((e) => e[0] === 1)).toBe(true);
  });

  it('déconnecte un client dont le tampon dépasse 1 Mo', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    a.bufferedAmount = 2_000_000;
    h.advance(4);
    expect(a.closed?.code).toBe(1013);
  });

  it('ignore un accusé de réception falsifié (avenir lointain)', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const b = h.connect('10.0.0.2');
    h.join(b, code);
    h.advance(2);
    h.sendInput(a, 10, [0], 30000);
    h.advance(4);
    expect(a.snapshots().at(-1)!.eventCount).toBeGreaterThan(0);
  });

  it('un joueur qui tombe hors de la page réapparaît (salon d attente) avec un événement SPAWN', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.advance(100);
    const room = h.room(code);
    const p = room.world.players[0];
    p.x = 31 * 16;
    p.y = 34 * 16 + 40;
    p.vy = 400;
    p.grounded = false;
    const before = room.reliable.lastId;
    h.advance(60);
    expect(room.reliable.lastId).toBeGreaterThan(before);
    expect(eventsOf(a, SimEvent.SPAWN).length).toBeGreaterThanOrEqual(1);
  });

  it('une emote est un événement fiable, limité à une toutes les 3 s', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const b = h.connect('10.0.0.2');
    h.join(b, code);
    h.advance(2);
    h.send(a, { t: 'emote', id: 2 });
    h.send(a, { t: 'emote', id: 3 });
    h.advance(10);
    expect(eventsOf(b, SimEvent.EMOTE)).toEqual([[0, 2]]);
    expect(h.server.metrics.emotesLimited).toBe(1);
    h.advance(190);
    h.send(a, { t: 'emote', id: 5 });
    h.advance(6);
    expect(eventsOf(b, SimEvent.EMOTE)).toEqual([
      [0, 2],
      [0, 5],
    ]);
  });
});

describe('contenu des snapshots de partie', () => {
  function playing(): ReturnType<typeof setupMatch> {
    return setupMatch();
  }
  function setupMatch(): { h: ReturnType<typeof harness>; a: FakeConn; b: FakeConn; code: string } {
    const h = harness();
    const a = h.connect('10.0.0.1');
    const b = h.connect('10.0.0.2');
    const code = h.create(a);
    h.join(b, code);
    h.startMatch(a, [b]);
    h.advance(200);
    return { h, a, b, code };
  }

  it('les spectateurs reçoivent la partie sans bloc own', () => {
    const { h, code } = playing();
    const s = h.connect('10.0.0.3');
    h.join(s, code, 'Spec');
    expect(s.lastOf('joined')!.slot).toBe(-1);
    h.advance(10);
    const snap = s.snapshots().at(-1)!;
    expect(snap.hasOwn).toBe(false);
    expect(snap.playerCount).toBe(2);
    expect(snap.game.phase).toBe(GamePhase.PLAYING);
    // un spectateur n'agit pas sur le monde, même en envoyant des entrées
    const room = h.room(code);
    const before = JSON.stringify(room.world.players.map((p) => [p.x, p.y]));
    h.sendInput(s, room.world.tick + 3, [Input.RIGHT | Input.ATTACK]);
    expect(room.slots.every((m) => m?.id !== s.lastOf('joined')!.id)).toBe(true);
    expect(before).toBe(JSON.stringify(room.world.players.map((p) => [p.x, p.y])));
  });

  it('les mines armées sont invisibles pour l adversaire, visibles pour leur poseur et les spectateurs', () => {
    const { h, a, b, code } = playing();
    const room = h.room(code);
    const spec = h.connect('10.0.0.3');
    h.join(spec, code, 'Spec');
    const mine = room.world.objects.find((o) => !o.active)!;
    mine.active = true;
    mine.type = ObjType.MINE;
    mine.uid = 4242;
    mine.x = 300;
    mine.y = 528;
    mine.w = 12;
    mine.h = 6;
    mine.b = 1;
    mine.owner = room.slots[0]!.slot;
    mine.team = room.world.team[0]!;
    h.advance(8);
    const has = (c: FakeConn): boolean =>
      c
        .snapshots()
        .at(-1)!
        .objects.slice(0, c.snapshots().at(-1)!.objectCount)
        .some((o) => o.type === ObjType.MINE);
    expect(has(a)).toBe(true);
    expect(has(b)).toBe(false);
    expect(has(spec)).toBe(true);
    expect(WeaponId.INK_MINE).toBe(11);
  });

  it('un snapshot de huit joueurs en combat reste léger', () => {
    const h = harness();
    const conns: FakeConn[] = [];
    const host = h.connect('10.0.0.1');
    const code = h.create(host);
    conns.push(host);
    for (let i = 1; i < 8; i++) {
      const c = h.connect(`10.0.0.${i + 1}`);
      h.join(c, code, `Joueur${i}`);
      conns.push(c);
    }
    h.startMatch(host, conns.slice(1));
    const bots = conns.map((c, i) => new Bot(h, c, i + 1));
    for (let i = 0; i < 1200; i++) {
      for (const b of bots) b.act(code);
      h.advance(1);
    }
    let n = 0;
    for (const s of host.snapshots().slice(-300)) {
      void s;
      n++;
    }
    const bytes = h.server.metrics.bytesOut;
    expect(n).toBeGreaterThan(100);
    expect(bytes).toBeGreaterThan(0);
    // débit descendant par client sur les 1200 derniers ticks (20 s)
    const perClient = bytes / 8 / 20;
    expect(perClient).toBeLessThan(20_000);
  });
});

describe('enregistrement et relecture d une partie complète', () => {
  it('rejoue à l identique : arrivées, départ, réglages, partie, coups, armes et fin', async () => {
    const { replayRecording, hashWorld } = await import('@stickyclaude/sim');
    const h = harness({ DEV_TOOLS: '1', MATCH_END_MS: '500', RECONNECT_GRACE_MS: '800' });
    const a = h.connect('10.0.0.1');
    const b = h.connect('10.0.0.2');
    const c = h.connect('10.0.0.3');
    const code = h.create(a);
    h.join(b, code);
    h.advance(30);
    h.join(c, code);
    h.settings(a, { roundsToWin: 3, suddenDeathSec: 20, weapons: true });
    h.send(a, { t: 'tune', k: 'jumpSpeed', val: 420 });
    h.advance(100);
    h.startMatch(a, [b, c]);
    const bots = [new Bot(h, a, 1), new Bot(h, b, 2), new Bot(h, c, 3)];
    let over = false;
    for (let t = 0; t < 40_000 && !over; t++) {
      for (const bot of bots) bot.act(code);
      // un joueur quitte puis une connexion tombe en cours de partie
      if (t === 2500) h.send(c, { t: 'leave' });
      if (t === 3000) h.server.onClose(b);
      h.advance(1);
      over = h.room(code).phase === GamePhase.MATCH_END && t > 3100;
    }
    h.advance(80);
    const room = h.room(code);
    expect(room.recording).not.toBeNull();
    const rec = room.recording!.toRecording(room.world.tick);
    expect(rec.ops.some((o) => o.op === 'start')).toBe(true);
    expect(rec.ops.some((o) => o.op === 'leave')).toBe(true);
    const replayed = replayRecording(rec, room.lobbyArena);
    expect(replayed.tick).toBe(room.world.tick);
    expect(hashWorld(replayed)).toBe(room.stateHash());
  });
});

void PROTOCOL_VERSION;
void BinType;
