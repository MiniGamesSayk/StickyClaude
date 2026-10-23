import {
  GamePhase,
  INK_COLORS,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { harness } from './helpers.ts';
import type { FakeConn, Harness } from './helpers.ts';

/** Ticks pour qu'un changement de salon soit diffusé (au plus un envoi toutes les 500 ms). */
const LOBBY_FLUSH_TICKS = 31;

function fill(h: Harness, code: string, n: number): FakeConn[] {
  const out: FakeConn[] = [];
  for (let i = 0; i < n; i++) {
    const c = h.connect(`10.0.1.${i}`);
    h.join(c, code, `Joueur${i}`);
    out.push(c);
  }
  return out;
}

describe('créer et rejoindre', () => {
  it('crée un salon : code de 5 caractères sans ambiguïté, jeton, salon d attente', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    expect(code).not.toMatch(/[01OIL]/);
    const j = a.lastOf('joined')!;
    expect(j.slot).toBe(0);
    expect(j.token).toMatch(/^[0-9a-f]{32}$/);
    expect(j.lobby.host).toBe(0);
    expect(j.lobby.phase).toBe(GamePhase.LOBBY);
    expect(j.lobby.settings.roundsToWin).toBe(5);
    expect(j.lobby.settings.isPublic).toBe(true);
    expect(j.round.round).toBe(0);
    expect(j.round.rows).toHaveLength(36);
    expect(j.lobby.players).toHaveLength(1);
    expect(j.lobby.players[0].name).toBe('Alice');
    expect(h.server.stats()).toEqual({ rooms: 1, players: 1, connections: 1 });
  });

  it('rejoindre par code (insensible à la casse) prévient tout le monde', () => {
    const h = harness();
    const a = h.connect();
    const b = h.connect('10.0.0.2');
    const code = h.create(a);
    h.join(b, code.toLowerCase());
    const jb = b.lastOf('joined')!;
    expect(jb.slot).toBe(1);
    expect(jb.lobby.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    const la = a.lastOf('lobby')!;
    expect(la.lobby.players).toHaveLength(2);
    expect(la.lobby.host).toBe(0);
  });

  it('refuse un code inconnu, un mauvais pseudo, une mauvaise version', () => {
    const h = harness();
    const a = h.connect();
    h.send(a, { t: 'join', v: PROTOCOL_VERSION, name: 'Alice', code: 'ZZZZZ' });
    expect(a.lastOf('error')?.code).toBe('not_found');
    h.send(a, { t: 'create', v: PROTOCOL_VERSION, name: 'x' });
    expect(a.lastOf('error')?.code).toBe('bad_name');
    h.send(a, { t: 'create', v: 1, name: 'Alice' });
    expect(a.lastOf('error')?.code).toBe('version');
    expect(h.server.rooms.size).toBe(0);
  });

  it('normalise les pseudos et refuse les mots offensants', () => {
    const h = harness();
    const a = h.connect();
    h.send(a, { t: 'create', v: PROTOCOL_VERSION, name: '  Ａlice​‮  ' });
    expect(a.lastOf('joined')!.lobby.players[0].name).toBe('Alice');
    for (const [i, bad] of ['connard', 'Fu(k fuck', 'xXmerdeXx', 'p.u.t.a.i.n', 'n4zi'].entries()) {
      const c = h.connect(`10.9.0.${i}`);
      h.send(c, { t: 'create', v: PROTOCOL_VERSION, name: bad });
      expect(c.lastOf('error')?.code, bad).toBe('bad_name');
    }
    // des pseudos innocents qui contiennent des suites de lettres banales sont acceptés
    const ok = h.connect('10.9.1.1');
    h.send(ok, { t: 'create', v: PROTOCOL_VERSION, name: 'Classe 5B' });
    expect(ok.lastOf('joined')).toBeDefined();
    for (const [i, fine] of [
      'Scunthorpe',
      'Technique',
      'Fichier',
      'Connecteur',
      'Retardataire',
      'Hancock',
      'Classique',
    ].entries()) {
      const c = h.connect(`10.9.2.${i}`);
      h.send(c, { t: 'create', v: PROTOCOL_VERSION, name: fine });
      expect(c.lastOf('error')?.code, fine).toBeUndefined();
      expect(c.lastOf('joined'), fine).toBeDefined();
    }
  });

  it('refuse un second create/join pendant qu on est dans un salon', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.send(a, { t: 'create', v: PROTOCOL_VERSION, name: 'Alice' });
    expect(a.lastOf('error')?.code).toBe('already_joined');
    h.join(a, code);
    expect(a.lastOf('error')?.code).toBe('already_joined');
  });

  it('huit joueurs, puis quatre spectateurs, puis le salon est plein', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const others = fill(h, code, MAX_PLAYERS - 1);
    expect(others.every((c) => c.lastOf('joined')!.slot >= 1)).toBe(true);
    const spectators = fill(h, code, MAX_SPECTATORS);
    for (const s of spectators) expect(s.lastOf('joined')!.slot).toBe(-1);
    const late = h.connect('10.0.2.2');
    h.join(late, code);
    expect(late.lastOf('error')?.code).toBe('full');
    const view = a.lastOf('lobby')!.lobby;
    expect(view.players).toHaveLength(MAX_PLAYERS);
    expect(view.spectators).toHaveLength(MAX_SPECTATORS);
  });

  it('donne à chaque joueur une couleur d encre différente, la plus proche si conflit', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a, 'Alice', { look: { color: 3 } });
    const b = h.connect('10.0.0.2');
    h.send(b, { t: 'join', v: PROTOCOL_VERSION, name: 'Bob', code, look: { color: 3 } });
    const players = b.lastOf('joined')!.lobby.players;
    expect(players[0].look.color).toBe(3);
    const bobColor = players[1].look.color;
    expect(bobColor).not.toBe(3);
    // le noir (3) est proche du bleu nuit (11) et du gris (9) : un des deux doit être choisi
    expect([9, 11]).toContain(bobColor);
    const colors = new Set(players.map((p) => p.look.color));
    expect(colors.size).toBe(players.length);
    expect(INK_COLORS[bobColor]).toBeDefined();
  });

  it('valide l apparence contre des listes blanches', () => {
    const h = harness();
    const a = h.connect();
    h.send(a, {
      t: 'create',
      v: PROTOCOL_VERSION,
      name: 'Alice',
      look: { color: 99, stroke: 2, hat: 11, victory: -1, extra: 'x' },
    });
    const look = a.lastOf('joined')!.lobby.players[0].look;
    expect(look).toEqual({ color: 0, stroke: 2, hat: 11, victory: 0 });
    h.send(a, { t: 'look', look: { hat: 99, stroke: 1 } });
    h.advance(LOBBY_FLUSH_TICKS);
    expect(a.lastOf('lobby')!.lobby.players[0].look).toEqual({
      color: 0,
      stroke: 1,
      hat: 11,
      victory: 0,
    });
  });
});

describe('hôte, départs, expulsion', () => {
  it('transmet l hôte au joueur le plus ancien quand il part', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const [b, c] = fill(h, code, 2);
    h.send(a, { t: 'leave' });
    expect(a.lastOf('left')?.reason).toBe('left');
    expect(b.lastOf('lobby')!.lobby.host).toBe(1);
    h.send(b, { t: 'leave' });
    expect(c.lastOf('lobby')!.lobby.host).toBe(2);
  });

  it('libère l emplacement et supprime le salon vide après le délai d inactivité', () => {
    const h = harness({ ROOM_IDLE_TTL_SEC: '2', RECONNECT_GRACE_MS: '1000' });
    const a = h.connect();
    const code = h.create(a);
    h.server.onClose(a);
    h.advance(30);
    expect(h.room(code).playerCount).toBe(1); // le joueur peut encore revenir
    h.advance(60 * 5);
    expect(h.server.rooms.has(code)).toBe(false);
  });

  it('l hôte expulse un joueur, qui peut rejoindre à nouveau', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const [b] = fill(h, code, 1);
    h.send(a, { t: 'kick', slot: 1 });
    expect(b.lastOf('left')?.reason).toBe('kicked');
    expect(a.lastOf('lobby')!.lobby.players).toHaveLength(1);
    h.join(b, code);
    expect(b.lastOf('joined')!.slot).toBe(1);
  });

  it('seul l hôte expulse, et pas lui-même', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const [b, c] = fill(h, code, 2);
    h.send(b, { t: 'kick', slot: 2 });
    expect(b.lastOf('error')?.code).toBe('not_host');
    h.send(a, { t: 'kick', slot: 0 });
    expect(a.lastOf('error')?.code).toBe('bad_request');
    expect(c.lastOf('left')).toBeUndefined();
  });
});

describe('prêt, réglages, équipes', () => {
  it('lancer exige l hôte, deux joueurs et que les autres soient prêts', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.send(a, { t: 'start' });
    expect(a.lastOf('error')?.code).toBe('not_enough_players');
    const [b] = fill(h, code, 1);
    h.send(b, { t: 'start' });
    expect(b.lastOf('error')?.code).toBe('not_host');
    h.send(a, { t: 'start' });
    expect(a.lastOf('error')?.code).toBe('not_ready');
    h.send(b, { t: 'ready', ready: true });
    h.advance(LOBBY_FLUSH_TICKS);
    expect(a.lastOf('lobby')!.lobby.players[1].ready).toBe(true);
    h.send(a, { t: 'start' });
    expect(h.room(code).phase).toBe(GamePhase.COUNTDOWN);
    const round = b.lastOf('round')!;
    expect(round.round.round).toBe(1);
    expect(round.round.rows).toBeNull();
    expect(a.lastOf('lobby')!.lobby.players.every((p) => !p.ready)).toBe(true);
    h.send(a, { t: 'start' });
    expect(a.lastOf('error')?.code).toBe('in_game');
  });

  it('les réglages sont réservés à l hôte, bornés, et gelés en partie', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const [b] = fill(h, code, 1);
    h.settings(b, { roundsToWin: 3 });
    expect(b.lastOf('error')?.code).toBe('not_host');
    h.settings(a, {
      roundsToWin: 7,
      suddenDeathSec: 120,
      weapons: false,
      friendlyFire: true,
      isPublic: true,
    });
    h.advance(LOBBY_FLUSH_TICKS);
    const s = a.lastOf('lobby')!.lobby.settings;
    expect(s.roundsToWin).toBe(7);
    expect(s.suddenDeathSec).toBe(120);
    expect(s.weapons).toBe(false);
    expect(s.friendlyFire).toBe(true);
    expect(s.isPublic).toBe(true);
    // hors bornes : le message est rejeté, ou la valeur ramenée à une valeur permise
    const before = a.of('lobby').length;
    h.settings(a, { roundsToWin: 4 });
    h.advance(LOBBY_FLUSH_TICKS);
    expect(a.lastOf('lobby')!.lobby.settings.roundsToWin).toBe(7);
    h.settings(a, { suddenDeathSec: 5 });
    h.settings(a, { suddenDeathSec: 500 });
    h.advance(LOBBY_FLUSH_TICKS);
    expect(a.lastOf('lobby')!.lobby.settings.suddenDeathSec).toBe(120);
    expect(a.of('lobby').length).toBeLessThanOrEqual(before + 2);
    // des arènes inconnues sont ignorées
    h.settings(a, { arenas: ['partition', 'nope'] });
    h.advance(LOBBY_FLUSH_TICKS);
    expect(a.lastOf('lobby')!.lobby.settings.arenas).toEqual(['partition']);
    h.startMatch(a, [b]);
    h.settings(a, { roundsToWin: 3 });
    expect(a.lastOf('error')?.code).toBe('in_game');
  });

  it('équipes : répartition équilibrée, affectation et mélange par l hôte', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    fill(h, code, 5);
    h.settings(a, { mode: 'teams', teams: 3 });
    h.advance(LOBBY_FLUSH_TICKS);
    let players = a.lastOf('lobby')!.lobby.players;
    const counts = [0, 0, 0];
    for (const p of players) counts[p.team]++;
    expect(counts).toEqual([2, 2, 2]);
    h.send(a, { t: 'teams', assign: [2, 2, 2, 0, 0, 1] });
    h.advance(LOBBY_FLUSH_TICKS);
    players = a.lastOf('lobby')!.lobby.players;
    expect(players.map((p) => p.team)).toEqual([2, 2, 2, 0, 0, 1]);
    h.send(a, { t: 'teams', shuffle: true });
    h.advance(LOBBY_FLUSH_TICKS);
    players = a.lastOf('lobby')!.lobby.players;
    const c2 = [0, 0, 0];
    for (const p of players) c2[p.team]++;
    expect(c2).toEqual([2, 2, 2]);
    h.settings(a, { mode: 'ffa' });
    h.advance(LOBBY_FLUSH_TICKS);
    expect(a.lastOf('lobby')!.lobby.players.every((p) => p.team === -1)).toBe(true);
    h.send(a, { t: 'teams', shuffle: true });
    expect(a.lastOf('error')?.code).toBe('bad_request');
  });
});

describe('salons publics et partie rapide', () => {
  it('la liste ne montre que les salons publics qui ont de la place', () => {
    const h = harness();
    const a = h.connect('10.0.0.1');
    const b = h.connect('10.0.0.2');
    const codeA = h.create(a, 'Alice', { isPublic: true });
    h.create(b, 'Bob', { isPublic: false });
    const list = h.server.publicRooms();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      code: codeA,
      players: 1,
      maxPlayers: 8,
      mode: 'ffa',
      phase: 'lobby',
      host: 'Alice',
    });
    h.settings(a, { isPublic: false });
    expect(h.server.publicRooms()).toHaveLength(0);
  });

  it('partie rapide : crée un salon public, puis rejoint le plus rempli en attente', () => {
    const h = harness();
    const a = h.connect('10.0.0.1');
    h.send(a, { t: 'quick', v: PROTOCOL_VERSION, name: 'Alice' });
    const codeA = a.lastOf('joined')!.code;
    expect(h.room(codeA).settings.isPublic).toBe(true);

    const b = h.connect('10.0.0.2');
    h.send(b, { t: 'quick', v: PROTOCOL_VERSION, name: 'Bob' });
    expect(b.lastOf('joined')!.code).toBe(codeA);

    // un second salon public moins rempli
    const c = h.connect('10.0.0.3');
    const codeC = h.create(c, 'Chloé', { isPublic: true });
    expect(codeC).not.toBe(codeA);
    const d = h.connect('10.0.0.4');
    h.send(d, { t: 'quick', v: PROTOCOL_VERSION, name: 'Dan' });
    expect(d.lastOf('joined')!.code).toBe(codeA);
  });

  it('partie rapide : un salon plein ou privé est évité', () => {
    const h = harness();
    const a = h.connect('10.0.0.1');
    const code = h.create(a, 'Alice', { isPublic: true });
    fill(h, code, MAX_PLAYERS - 1);
    fill(h, code, MAX_SPECTATORS);
    const z = h.connect('10.0.5.5');
    h.send(z, { t: 'quick', v: PROTOCOL_VERSION, name: 'Zoé' });
    expect(z.lastOf('joined')!.code).not.toBe(code);
  });

  it('partie rapide en cours de partie : on entre comme spectateur', () => {
    const h = harness();
    const a = h.connect('10.0.0.1');
    const code = h.create(a, 'Alice', { isPublic: true });
    const [b] = fill(h, code, 1);
    h.startMatch(a, [b]);
    const z = h.connect('10.0.5.5');
    h.send(z, { t: 'quick', v: PROTOCOL_VERSION, name: 'Zoé' });
    expect(z.lastOf('joined')!.code).toBe(code);
    expect(z.lastOf('joined')!.slot).toBe(-1);
  });

  it('un salon public en attente se lance seul 20 s après que deux joueurs sont prêts', () => {
    const h = harness({ AUTOSTART_MS: '2000' });
    const a = h.connect('10.0.0.1');
    const code = h.create(a, 'Alice', { isPublic: true });
    const [b, c] = fill(h, code, 2);
    h.send(a, { t: 'ready', ready: true });
    h.advance(300);
    expect(h.room(code).phase).toBe(GamePhase.LOBBY);
    h.send(b, { t: 'ready', ready: true });
    h.advance(60);
    expect(a.lastOf('lobby')!.lobby.autostartMs).toBeGreaterThan(0);
    // si l'un se rétracte, le compte à rebours s'arrête
    h.send(b, { t: 'ready', ready: false });
    h.advance(60);
    expect(a.lastOf('lobby')!.lobby.autostartMs).toBe(-1);
    h.send(b, { t: 'ready', ready: true });
    h.advance(60 * 3);
    expect(h.room(code).phase).toBe(GamePhase.COUNTDOWN);
    // même celui qui n'était pas prêt joue
    expect(h.room(code).world.inMatch[c.lastOf('joined')!.slot]).toBe(1);
  });

  it('un salon privé ne se lance jamais seul', () => {
    const h = harness({ AUTOSTART_MS: '500' });
    const a = h.connect('10.0.0.1');
    const code = h.create(a, 'Alice', { isPublic: false });
    const [b] = fill(h, code, 1);
    h.send(a, { t: 'ready', ready: true });
    h.send(b, { t: 'ready', ready: true });
    h.advance(60 * 5);
    expect(h.room(code).phase).toBe(GamePhase.LOBBY);
  });
});

describe('limites', () => {
  it('applique MAX_ROOMS, MAX_CONNECTIONS et MAX_CONN_PER_IP', () => {
    const h = harness({
      MAX_ROOMS: '2',
      MAX_CONNECTIONS: '5',
      MAX_CONN_PER_IP: '3',
      CREATE_PER_MIN: '100',
    });
    const c1 = h.connect('1.1.1.1');
    const c2 = h.connect('1.1.1.2');
    h.create(c1);
    h.create(c2);
    const c3 = h.connect('1.1.1.3');
    h.send(c3, { t: 'create', v: PROTOCOL_VERSION, name: 'Alice' });
    expect(c3.lastOf('error')?.code).toBe('server_full');
    const same = [h.connect('9.9.9.9'), h.connect('9.9.9.9'), h.connect('9.9.9.9')];
    expect(same.every((c) => c.closed === null)).toBe(false);
    expect(h.server.connectionCount).toBe(5);
  });

  it('limite la création de salons à 3 par minute et par IP', () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      const c = h.connect('2.2.2.2');
      h.create(c);
      h.send(c, { t: 'leave' });
    }
    const c = h.connect('2.2.2.2');
    h.send(c, { t: 'create', v: PROTOCOL_VERSION, name: 'Alice' });
    expect(c.lastOf('error')?.code).toBe('rate_limited');
    h.advance(60 * 61);
    const d = h.connect('2.2.2.2');
    h.send(d, { t: 'create', v: PROTOCOL_VERSION, name: 'Alice' });
    expect(d.lastOf('joined')).toBeDefined();
  });

  it('limite les essais de codes à 10 par minute et par IP', () => {
    const h = harness();
    const c = h.connect('3.3.3.3');
    for (let i = 0; i < 10; i++) {
      h.send(c, { t: 'join', v: PROTOCOL_VERSION, name: 'Alice', code: 'ZZZZZ' });
      expect(c.lastOf('error')?.code).toBe('not_found');
    }
    h.send(c, { t: 'join', v: PROTOCOL_VERSION, name: 'Alice', code: 'ZZZZZ' });
    expect(c.lastOf('error')?.code).toBe('rate_limited');
  });
});
