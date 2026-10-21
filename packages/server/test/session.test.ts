import { GamePhase, MAX_PLAYERS, PROTOCOL_VERSION } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { Bot, harness } from './helpers.ts';
import type { FakeConn, Harness } from './helpers.ts';

function setup(
  env: Record<string, string> = {},
  n = 3,
): { h: Harness; code: string; conns: FakeConn[] } {
  const h = harness(env);
  const a = h.connect('10.0.0.1');
  const code = h.create(a, 'Alice');
  const conns = [a];
  for (let i = 1; i < n; i++) {
    const c = h.connect(`10.0.0.${i + 1}`);
    h.join(c, code, `Joueur${i}`);
    conns.push(c);
  }
  return { h, code, conns };
}

function runBots(h: Harness, code: string, conns: FakeConn[], ticks: number, seed = 1): void {
  const bots = conns.map((c, i) => new Bot(h, c, seed + i));
  for (let t = 0; t < ticks; t++) {
    for (const b of bots) b.act(code);
    h.advance(1);
  }
}

describe('reconnexion par jeton', () => {
  it('retrouve sa place pendant le délai, le stickman reste immobile', () => {
    const { h, code, conns } = setup({ RECONNECT_GRACE_MS: '5000' });
    const [a, b] = conns as [FakeConn, FakeConn, FakeConn];
    const token = b.lastOf('joined')!.token;
    h.advance(100);
    const room = h.room(code);
    const slot = h.slotOf(b);
    const x = room.world.players[slot]!.x;
    h.server.onClose(b);
    h.advance(120);
    expect(room.world.players[slot]!.x).toBe(x);
    const lobby = a.lastOf('lobby')!.lobby;
    expect(lobby.players.find((p) => p.slot === slot)!.connected).toBe(false);

    const b2 = h.connect('10.0.0.9');
    h.send(b2, { t: 'resume', v: PROTOCOL_VERSION, token, code });
    const j = b2.lastOf('joined')!;
    expect(j.slot).toBe(slot);
    expect(j.token).toBe(token);
    expect(a.lastOf('lobby')!.lobby.players.find((p) => p.slot === slot)!.connected).toBe(true);
    h.advance(6);
    expect(b2.snapshots().length).toBeGreaterThan(0);
    expect(h.server.metrics.reconnects).toBe(1);
  });

  it('après le délai, la place est perdue et le jeton ne marche plus', () => {
    const { h, code, conns } = setup({ RECONNECT_GRACE_MS: '2000' });
    const b = conns[1]!;
    const token = b.lastOf('joined')!.token;
    h.server.onClose(b);
    h.advance(60 * 3);
    const room = h.room(code);
    expect(room.playerCount).toBe(2);
    const b2 = h.connect('10.0.0.9');
    h.send(b2, { t: 'resume', v: PROTOCOL_VERSION, token, code });
    expect(b2.lastOf('error')?.code).toBe('bad_token');
  });

  it('un jeton falsifié, inconnu ou déjà utilisé est refusé', () => {
    const { h, code, conns } = setup({ RECONNECT_GRACE_MS: '5000' });
    const b = conns[1]!;
    const token = b.lastOf('joined')!.token;
    const x = h.connect('10.0.0.9');
    h.send(x, { t: 'resume', v: PROTOCOL_VERSION, token: 'ab'.repeat(16), code });
    expect(x.lastOf('error')?.code).toBe('bad_token');
    // la connexion d'origine est encore active : le jeton ne peut pas la détrôner
    h.send(x, { t: 'resume', v: PROTOCOL_VERSION, token, code });
    expect(x.lastOf('error')?.code).toBe('bad_token');
    h.send(x, { t: 'resume', v: PROTOCOL_VERSION, token: 'pas hexadécimal', code });
    expect(h.server.metrics.invalidMessages).toBeGreaterThan(0);
  });

  it('en cours de manche : éliminé après le délai, retiré à la fin de la manche', () => {
    const { h, code, conns } = setup({ RECONNECT_GRACE_MS: '1500', MATCH_END_MS: '300' }, 3);
    const [a, b, c] = conns as [FakeConn, FakeConn, FakeConn];
    h.settings(a, { suddenDeathSec: 20, roundsToWin: 3 });
    h.startMatch(a, [b, c]);
    h.advance(200);
    const room = h.room(code);
    const slot = h.slotOf(b);
    expect(room.phase).toBe(GamePhase.PLAYING);
    h.server.onClose(b);
    h.advance(60 * 3);
    const p = room.world.players[slot]!;
    expect(p.dead || p.ghost).toBe(true);
    expect(room.slots[slot]).not.toBeNull();
    // fin de manche : retiré du salon, son emplacement reste condamné jusqu'à la fin de la partie
    const bots = [new Bot(h, a, 1), new Bot(h, c, 2)];
    for (let t = 0; t < 8000 && room.slots[slot] !== null; t++) {
      for (const bot of bots) bot.act(code);
      h.advance(1);
    }
    expect(room.slots[slot]).toBeNull();
    expect(room.retired[slot]).toBe(1);
    expect(room.freeSlot()).not.toBe(slot);
  });

  it('l hôte déconnecté cède sa place d hôte tout de suite', () => {
    const { h, conns } = setup({ RECONNECT_GRACE_MS: '5000' });
    const [a, b] = conns as [FakeConn, FakeConn, FakeConn];
    h.server.onClose(a);
    expect(b.lastOf('lobby')!.lobby.host).toBe(1);
  });
});

describe('spectateurs', () => {
  it('arrivé en cours de manche : spectateur, puis joueur à la manche suivante', () => {
    const { h, code, conns } = setup({ MATCH_END_MS: '300' }, 2);
    const [a, b] = conns as [FakeConn, FakeConn];
    h.settings(a, { suddenDeathSec: 20, roundsToWin: 3 });
    h.startMatch(a, [b]);
    h.advance(200);
    const s = h.connect('10.0.0.7');
    h.join(s, code, 'Retardataire');
    expect(s.lastOf('joined')!.slot).toBe(-1);
    expect(a.lastOf('lobby')!.lobby.spectators.map((x) => x.name)).toEqual(['Retardataire']);
    const room = h.room(code);
    const round1 = room.world.game.round;
    const bots = [new Bot(h, a, 1), new Bot(h, b, 2)];
    let promoted = false;
    for (let t = 0; t < 9000 && !promoted; t++) {
      for (const bot of bots) bot.act(code);
      h.advance(1);
      const j = s.lastOf('joined');
      promoted = !!j && j.slot >= 0;
    }
    expect(promoted).toBe(true);
    expect(room.world.game.round).toBeGreaterThanOrEqual(round1);
    const slot = s.lastOf('joined')!.slot;
    expect(room.world.inMatch[slot]).toBe(1);
    expect(room.world.players[slot]!.active).toBe(true);
    // il apparaît au début de la manche suivante, avec les autres
    h.advance(200);
    expect(s.snapshots().at(-1)!.hasOwn).toBe(true);
  });

  it('au retour au salon, les spectateurs prennent les places libres', () => {
    const { h, code, conns } = setup({ MATCH_END_MS: '100' }, 2);
    const [a, b] = conns as [FakeConn, FakeConn];
    h.settings(a, { suddenDeathSec: 20, roundsToWin: 3 });
    h.startMatch(a, [b]);
    h.advance(100);
    const s = h.connect('10.0.0.7');
    h.join(s, code, 'Spec');
    const room = h.room(code);
    room.world.game.scores[0] = 3;
    room.world.game.round = 5;
    // force la fin de partie
    room.world.game.matchWinner = 0;
    room.world.game.phase = GamePhase.ROUND_END;
    room.world.game.phaseTick = 100_000;
    h.advance(3);
    expect(room.phase).toBe(GamePhase.MATCH_END);
    expect(a.lastOf('results')).toBeDefined();
    h.advance(60 * 3);
    expect(room.phase).toBe(GamePhase.LOBBY);
    expect(s.lastOf('joined')!.slot).toBeGreaterThanOrEqual(0);
    expect(a.lastOf('lobby')!.lobby.spectators).toHaveLength(0);
  });
});

describe('inactivité', () => {
  it('60 s sans entrée en manche : le joueur devient spectateur', () => {
    const { h, code, conns } = setup({ IDLE_PLAYING_MS: '3000', MATCH_END_MS: '300' }, 3);
    const [a, b, c] = conns as [FakeConn, FakeConn, FakeConn];
    h.settings(a, { suddenDeathSec: 60 });
    h.startMatch(a, [b, c]);
    h.advance(200);
    const room = h.room(code);
    const slot = h.slotOf(c);
    runBots(h, code, [a, b], 60 * 5);
    expect(room.slots[slot]).toBeNull();
    expect(c.lastOf('joined')!.slot).toBe(-1);
    expect(a.lastOf('lobby')!.lobby.spectators.map((x) => x.name)).toContain('Joueur2');
    expect(room.world.players[slot]!.active).toBe(false);
  });

  it('10 min d inactivité dans le salon : déconnexion', () => {
    const { h, code, conns } = setup({ IDLE_LOBBY_MS: '4000' }, 2);
    const [a, b] = conns as [FakeConn, FakeConn];
    // l'hôte bouge, pas l'autre
    runBots(h, code, [a], 60 * 6);
    expect(b.lastOf('left')?.reason).toBe('idle');
    expect(h.room(code).playerCount).toBe(1);
  });
});

describe('hôte et salon en cours de partie', () => {
  it('l hôte qui part en pleine partie : le plus ancien le remplace, la partie continue', () => {
    const { h, code, conns } = setup({ RECONNECT_GRACE_MS: '0' }, 3);
    const [a, b, c] = conns as [FakeConn, FakeConn, FakeConn];
    h.startMatch(a, [b, c]);
    h.advance(300);
    h.send(a, { t: 'leave' });
    expect(b.lastOf('lobby')!.lobby.host).toBe(1);
    h.advance(120);
    const room = h.room(code);
    expect(room.phase).toBe(GamePhase.PLAYING);
    expect(room.playerCount).toBe(2);
    // le nouvel hôte peut régler... une fois la partie terminée seulement
    h.settings(b, { roundsToWin: 3 });
    expect(b.lastOf('error')?.code).toBe('in_game');
  });

  it('la partie s arrête s il ne reste qu un joueur : manche gagnée par forfait', () => {
    const { h, code, conns } = setup({ RECONNECT_GRACE_MS: '0' }, 2);
    const [a, b] = conns as [FakeConn, FakeConn];
    h.startMatch(a, [b]);
    h.advance(260);
    const room = h.room(code);
    h.send(b, { t: 'leave' });
    h.advance(10);
    expect(room.phase).toBe(GamePhase.ROUND_END);
    expect(room.world.game.scores[h.slotOf(a)]).toBe(1);
    expect(MAX_PLAYERS).toBe(8);
  });
});
