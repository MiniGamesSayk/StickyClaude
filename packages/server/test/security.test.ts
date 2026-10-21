import * as fc from 'fast-check';
import { GamePhase, Input, MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { Bot, harness } from './helpers.ts';
import type { FakeConn, Harness } from './helpers.ts';

function twoPlayers(env: Record<string, string> = {}): {
  h: Harness;
  code: string;
  a: FakeConn;
  b: FakeConn;
} {
  const h = harness(env);
  const a = h.connect('10.0.0.1');
  const b = h.connect('10.0.0.2');
  const code = h.create(a);
  h.join(b, code);
  return { h, code, a, b };
}

function worldState(h: Harness, code: string): string {
  const w = h.room(code).world;
  return JSON.stringify([
    w.players.map((p) => [p.x, p.y, p.vx, p.vy, p.hp, p.weapon, p.ammo, p.active]),
    Array.from(w.game.scores),
    w.game.phase,
    w.game.round,
  ]);
}

describe('tentatives de triche : aucun message ne fixe un état', () => {
  it('des champs d état ajoutés à des messages valides sont rejetés', () => {
    const { h, code, a, b } = twoPlayers();
    h.advance(100);
    const before = worldState(h, code);
    const hostile: unknown[] = [
      { t: 'ready', ready: true, hp: 999 },
      { t: 'emote', id: 1, x: 5, y: 5 },
      { t: 'look', look: { color: 1 }, score: 100 },
      { t: 'settings', settings: { roundsToWin: 3 }, scores: [9] },
      { t: 'settings', settings: { hp: 1 } },
      { t: 'teams', assign: [0, 0], x: 1 },
      { t: 'kick', slot: 1, hp: 0 },
      { t: 'start', now: true },
      { t: 'create', v: 2, name: 'Zed', x: 1, y: 1 },
      { t: 'leave', hp: 1 },
      { t: 'position', x: 100, y: 100 },
      { t: 'damage', slot: 0, amount: 100 },
      { t: 'score', value: 50 },
    ];
    for (const m of hostile) h.send(b, m);
    h.send(a, { t: 'score', value: 50 });
    h.advance(2);
    expect(worldState(h, code)).toBe(before);
    expect(h.server.metrics.invalidMessages).toBeGreaterThanOrEqual(hostile.length - 1);
  });

  it('un fuzzing de messages JSON aléatoires ne change ni PV, ni position, ni score', () => {
    const { h, code, b } = twoPlayers();
    h.advance(100);
    const before = worldState(h, code);
    const types = [
      'ready',
      'start',
      'settings',
      'teams',
      'kick',
      'look',
      'emote',
      'tune',
      'leave',
      'quick',
      'join',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...types),
        fc.dictionary(
          fc.string({ maxLength: 8 }),
          fc.oneof(fc.integer(), fc.string({ maxLength: 12 }), fc.boolean(), fc.constant(null)),
        ),
        (t, body) => {
          const conn = h.connect('10.8.0.1');
          h.send(conn, { t, ...body });
          h.server.onClose(conn);
          return true;
        },
      ),
      { numRuns: 150 },
    );
    // hors messages valides sans effet (ex. ready/emote d'un spectateur ne touchent pas le monde)
    h.send(b, { t: 'emote', id: 99 });
    expect(JSON.parse(worldState(h, code))[1]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(h.room(code).world.players[0].hp).toBe(100);
    void before;
  });

  it('seul l hôte lance, règle, forme les équipes et expulse', () => {
    const { h, code, a, b } = twoPlayers();
    h.send(b, { t: 'start' });
    h.settings(b, { roundsToWin: 3 });
    h.send(b, { t: 'teams', shuffle: true });
    h.send(b, { t: 'kick', slot: 0 });
    expect(b.of('error').map((e) => e.code)).toEqual([
      'not_host',
      'not_host',
      'not_host',
      'not_host',
    ]);
    expect(h.room(code).settings.roundsToWin).toBe(5);
    expect(a.of('left')).toHaveLength(0);
  });

  it('un spectateur ne peut ni se déclarer prêt, ni émettre d emote', () => {
    const { h, code, a, b } = twoPlayers();
    h.startMatch(a, [b]);
    const s = h.connect('10.0.0.3');
    h.join(s, code, 'Spec');
    h.send(s, { t: 'ready', ready: true });
    expect(s.lastOf('error')?.code).toBe('forbidden');
    const before = h.room(code).reliable.lastId;
    h.send(s, { t: 'emote', id: 1 });
    expect(h.room(code).reliable.lastId).toBe(before);
    expect(h.server.metrics.emotesLimited).toBeGreaterThanOrEqual(1);
  });

  it('les paquets d entrées ne peuvent pas porter la compensation de latence ni de faux boutons', () => {
    const { h, code, a, b } = twoPlayers();
    h.startMatch(a, [b]);
    h.advance(300);
    const room = h.room(code);
    const slot = h.slotOf(a);
    for (let i = 0; i < 6; i++) {
      h.sendInput(a, room.world.tick + 3, [0xff00 | Input.ATTACK]);
      h.advance(1);
    }
    const p = room.world.players[slot];
    expect(p.prevInput & 0xff00).toBe(0);
  });

  it('une compensation de latence énorme ne sert qu à rattraper 250 ms au plus', () => {
    const { h, code, a, b } = twoPlayers();
    h.startMatch(a, [b]);
    h.advance(300);
    const room = h.room(code);
    const slot = h.slotOf(a);
    const buf = new Uint8Array(16);
    // le paquet annonce 1 s de retard : le serveur ramène à 15 ticks
    buf[0] = 1;
    new DataView(buf.buffer).setUint16(1, (room.world.tick + 3) & 0xffff, true);
    buf[5] = 255;
    buf[6] = 1;
    h.server.onMessage(a, buf.slice(0, 9), true);
    h.advance(3);
    expect(room.world.players[slot].rewind).toBeLessThanOrEqual(15);
  });
});

describe('abus et inondation', () => {
  it('un message trop gros est rejeté et compté', () => {
    const { h, a } = twoPlayers();
    const before = h.server.metrics.invalidMessages;
    h.server.onMessage(a, new Uint8Array(MAX_CLIENT_MESSAGE_BYTES + 1), true);
    h.server.onMessage(a, 'x'.repeat(MAX_CLIENT_MESSAGE_BYTES + 1), false);
    expect(h.server.metrics.invalidMessages).toBe(before + 2);
  });

  it('plus de 20 messages de contrôle par seconde : ignorés, puis déconnexion', () => {
    const { h, a } = twoPlayers();
    for (let i = 0; i < 60; i++) h.send(a, { t: 'ready', ready: i % 2 === 0 });
    expect(h.server.metrics.controlLimited).toBeGreaterThan(30);
    expect(a.closed?.code).toBe(1008);
  });

  it('une seconde plus tard, le compteur repart', () => {
    const { h, a } = twoPlayers();
    for (let i = 0; i < 15; i++) h.send(a, { t: 'ready', ready: true });
    h.advance(70);
    for (let i = 0; i < 15; i++) h.send(a, { t: 'ready', ready: false });
    expect(a.closed).toBeNull();
    expect(h.server.metrics.controlLimited).toBe(0);
  });

  it('la force brute sur les codes de salon est bloquée', () => {
    const h = harness();
    const owner = h.connect('1.1.1.1');
    const code = h.create(owner);
    const attacker = h.connect('6.6.6.6');
    let found = false;
    for (let i = 0; i < 40; i++) {
      h.join(attacker, i === 25 ? code : `AAAA${String.fromCharCode(65 + (i % 20))}`, 'Intrus');
      if (attacker.lastOf('joined')) found = true;
      h.advance(1);
    }
    // les 10 premiers essais seuls comptent : ensuite, même le bon code est refusé
    expect(attacker.of('error').some((e) => e.code === 'rate_limited')).toBe(true);
    expect(found).toBe(false);
  });

  it('la force brute sur les jetons de reconnexion est bloquée', () => {
    const { h, code } = twoPlayers({ RECONNECT_GRACE_MS: '60000' });
    const attacker = h.connect('6.6.6.6');
    for (let i = 0; i < 15; i++) {
      h.send(attacker, {
        t: 'resume',
        v: PROTOCOL_VERSION,
        token: i.toString(16).padStart(32, '0'),
        code,
      });
    }
    expect(attacker.of('error').some((e) => e.code === 'rate_limited')).toBe(true);
  });

  it('une inondation de binaires invalides finit par déconnecter', () => {
    const h = harness();
    const c = h.connect();
    for (let i = 0; i < 25; i++) h.server.onMessage(c, new Uint8Array([200, i]), true);
    expect(c.closed?.code).toBe(1008);
  });

  it('les pseudos sont du texte : balises et HTML passent tels quels (jamais interprétés)', () => {
    const h = harness();
    const c = h.connect();
    h.send(c, { t: 'create', v: PROTOCOL_VERSION, name: '<b>x</b>&amp;' });
    expect(c.lastOf('joined')!.lobby.players[0].name).toBe('<b>x</b>&amp;');
  });

  it('un joueur ne peut pas agir sur un autre salon', () => {
    const h = harness();
    const a = h.connect('1.1.1.1');
    const b = h.connect('1.1.1.2');
    const ca = h.create(a);
    const cb = h.create(b);
    expect(ca).not.toBe(cb);
    h.send(a, { t: 'kick', slot: 0 });
    h.send(a, { t: 'settings', settings: { roundsToWin: 3 } });
    expect(h.room(cb).settings.roundsToWin).toBe(5);
    expect(h.room(ca).settings.roundsToWin).toBe(3);
  });

  it('la partie continue normalement pendant qu un client hostile s acharne', () => {
    const { h, code, a, b } = twoPlayers({ MATCH_END_MS: '300' });
    h.settings(a, { suddenDeathSec: 20, roundsToWin: 3 });
    h.startMatch(a, [b]);
    const attacker = h.connect('6.6.6.6');
    const bots = [new Bot(h, a, 1), new Bot(h, b, 2)];
    for (let t = 0; t < 600; t++) {
      for (const bot of bots) bot.act(code);
      h.server.onMessage(attacker, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), true);
      h.server.onMessage(attacker, '{"t":"start"}', false);
      h.advance(1);
    }
    expect(h.room(code).phase).toBe(GamePhase.PLAYING);
    expect(attacker.closed?.code).toBe(1008);
  });
});
