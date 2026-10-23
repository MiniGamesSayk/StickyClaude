import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GamePhase, MAX_SPECTATORS, PROTOCOL_VERSION } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { writeRecording } from '../src/index.ts';
import { Bot, harness } from './helpers.ts';
import type { FakeConn, Harness } from './helpers.ts';

type LogEntry = Record<string, unknown>;

function twoPlayers(env: Record<string, string> = {}): {
  h: Harness;
  code: string;
  a: FakeConn;
  b: FakeConn;
} {
  const h = harness(env);
  const a = h.connect('10.0.0.1');
  const code = h.create(a, 'Alice');
  const b = h.connect('10.0.0.2');
  h.join(b, code, 'Bob');
  return { h, code, a, b };
}

describe('une erreur ne tue pas les autres salons', () => {
  it('un salon dont le tick lève est fermé (1011), les autres continuent', () => {
    const logs: LogEntry[] = [];
    const h = harness({}, (o) => logs.push(o));
    const a = h.connect('10.0.0.1');
    const codeA = h.create(a);
    const b = h.connect('10.0.0.2');
    const codeB = h.create(b);
    h.room(codeA).tick = (): void => {
      throw new Error('boom');
    };
    const before = h.room(codeB).world.tick;
    expect(() => h.advance(10)).not.toThrow();
    expect(h.server.rooms.has(codeA)).toBe(false);
    expect(a.closed?.code).toBe(1011);
    expect(b.closed).toBeNull();
    expect(h.room(codeB).world.tick).toBe(before + 10);
    const err = logs.find((l) => l.level === 'error');
    expect(err).toMatchObject({ room: codeA });
    expect(String(err?.err)).toContain('boom');
    // la connexion fermée ne laisse pas de membre derrière elle
    expect(() => h.server.onClose(a)).not.toThrow();
    expect(h.server.connectionCount).toBe(1);
  });

  it('un message qui fait lever le salon ferme la connexion fautive, pas le process', () => {
    const logs: LogEntry[] = [];
    const h = harness({}, (o) => logs.push(o));
    const a = h.connect('10.0.0.1');
    const code = h.create(a);
    const b = h.connect('10.0.0.2');
    h.join(b, code);
    h.room(code).setReady = (): boolean => {
      throw new Error('boom');
    };
    expect(() => h.send(b, { t: 'ready', ready: true })).not.toThrow();
    expect(b.closed?.code).toBe(1011);
    expect(a.closed).toBeNull();
    expect(logs.some((l) => l.level === 'error')).toBe(true);
    expect(h.server.rooms.has(code)).toBe(true);
  });

  it("l'écriture de l'enregistrement qui échoue est journalisée, sans lever", () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-rec-'));
    const file = join(dir, 'fichier');
    writeFileSync(file, '');
    // un dossier d'enregistrement sous un fichier ordinaire : mkdir échoue
    const h = harness({ RECORD_DIR: join(file, 'sous-dossier') });
    const a = h.connect();
    const code = h.create(a);
    h.advance(5);
    const logs: LogEntry[] = [];
    expect(() => writeRecording(h.config, h.room(code), (o) => logs.push(o))).not.toThrow();
    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });
});

describe('inactivité de tous les joueurs', () => {
  it('2 joueurs inactifs 61 s en combat : le salon avance encore et la manche se termine', () => {
    const { h, code, a, b } = twoPlayers({ MATCH_END_MS: '300' });
    h.settings(a, { suddenDeathSec: 60 });
    h.startMatch(a, [b]);
    h.advance(200);
    const room = h.room(code);
    expect(room.phase).toBe(GamePhase.PLAYING);
    h.advance(61 * 60);
    // un seul est rétrogradé : l'autre reste, la manche se termine par forfait
    expect(room.playerCount).toBe(1);
    const tick = room.world.tick;
    h.advance(60);
    expect(room.world.tick).toBe(tick + 60);
    expect(room.world.game.scores.some((s) => s > 0) || room.phase !== GamePhase.PLAYING).toBe(
      true,
    );
  });

  it('un joueur inactif part si la liste des spectateurs est pleine, au lieu de la dépasser', () => {
    const h = harness({ IDLE_PLAYING_MS: '3000' });
    const a = h.connect('10.0.0.1');
    const code = h.create(a);
    const others = [h.connect('10.0.0.2'), h.connect('10.0.0.3')];
    for (const c of others) h.join(c, code);
    h.startMatch(a, others);
    h.advance(100);
    const room = h.room(code);
    for (let i = 0; i < MAX_SPECTATORS; i++) {
      const s = h.connect(`10.0.1.${i}`);
      h.join(s, code, `Spec${i}`);
    }
    expect(room.spectators).toHaveLength(MAX_SPECTATORS);
    const idle = others[1];
    const bots = [new Bot(h, a, 1), new Bot(h, others[0], 2)];
    for (let t = 0; t < 60 * 6; t++) {
      for (const bot of bots) bot.act(code);
      h.advance(1);
    }
    expect(room.spectators.length).toBeLessThanOrEqual(MAX_SPECTATORS);
    expect(idle.lastOf('left')?.reason).toBe('idle');
  });
});

describe('reprise avec une socket fantôme', () => {
  it("le jeton valide évince l'ancienne connexion encore ouverte", () => {
    const { h, code, b } = twoPlayers({ RECONNECT_GRACE_MS: '20000' });
    const token = b.lastOf('joined')!.token;
    const slot = h.slotOf(b);
    const b2 = h.connect('10.0.0.9');
    h.send(b2, { t: 'resume', v: PROTOCOL_VERSION, token, code });
    const j = b2.lastOf('joined');
    expect(j?.slot).toBe(slot);
    expect(j?.token).toBe(token);
    expect(b.closed).toEqual({ code: 4000, reason: 'replaced' });
    // la fermeture tardive de l'ancienne socket ne déconnecte pas le membre repris
    h.server.onClose(b);
    const member = h.room(code).slots[slot]!;
    expect(member.client?.conn).toBe(b2);
    expect(member.disconnectedAt).toBeNull();
    h.advance(6);
    expect(b2.snapshots().length).toBeGreaterThan(0);
    expect(h.server.metrics.reconnects).toBe(1);
  });

  it('un mauvais jeton ne détrône personne', () => {
    const { h, code, b } = twoPlayers({ RECONNECT_GRACE_MS: '20000' });
    const x = h.connect('10.0.0.9');
    h.send(x, { t: 'resume', v: PROTOCOL_VERSION, token: 'ab'.repeat(16), code });
    expect(x.lastOf('error')?.code).toBe('bad_token');
    expect(b.closed).toBeNull();
  });
});

describe('connexions sans salon', () => {
  it('fermée après 60 s sans salon ; celle qui rejoint dans les temps reste', () => {
    const h = harness();
    const idle = h.connect('10.0.0.1');
    const owner = h.connect('10.0.0.2');
    const code = h.create(owner);
    const late = h.connect('10.0.0.3');
    h.advance(50 * 60);
    h.join(late, code);
    h.advance(20 * 60);
    expect(idle.closed?.reason).toBe('no room');
    expect(owner.closed).toBeNull();
    expect(late.closed).toBeNull();
  });

  it('une connexion qui a quitté son salon est fermée à son tour', () => {
    const h = harness();
    const a = h.connect('10.0.0.1');
    const code = h.create(a);
    const b = h.connect('10.0.0.2');
    h.join(b, code);
    h.send(b, { t: 'leave' });
    expect(b.closed).toBeNull();
    h.advance(70 * 60);
    expect(b.closed?.reason).toBe('no room');
    expect(a.closed).toBeNull();
  });
});

describe('messages invalides', () => {
  it('le compteur repart au bout de la fenêtre', () => {
    const h = harness();
    const c = h.connect();
    h.create(c);
    for (let i = 0; i < 15; i++) h.server.onMessage(c, new Uint8Array([200, i]), true);
    h.advance(61 * 60);
    for (let i = 0; i < 15; i++) h.server.onMessage(c, new Uint8Array([200, i]), true);
    expect(c.closed).toBeNull();
  });

  it("l'inondation continue de couper la connexion, une seule fois", () => {
    const h = harness();
    const c = h.connect();
    for (let i = 0; i < 60; i++) h.server.onMessage(c, new Uint8Array([200, i]), true);
    expect(c.closed?.code).toBe(1008);
    expect(c.closeCalls).toBe(1);
  });
});

describe('fermeture de connexion', () => {
  it('la contre-pression ne ferme la connexion qu une fois', () => {
    const { h, code, a } = twoPlayers();
    h.room(code);
    a.bufferedAmount = 2 * 1024 * 1024;
    h.advance(30);
    expect(a.closed?.code).toBe(1013);
    expect(a.closeCalls).toBe(1);
  });
});

describe('diffusion du salon', () => {
  it("les réglages en rafale ne produisent qu'un envoi, avec l'état final", () => {
    const { h, a, b } = twoPlayers();
    h.advance(60);
    const before = b.of('lobby').length;
    for (let i = 0; i < 10; i++) h.settings(a, { roundsToWin: 2 + (i % 6) });
    h.advance(1);
    expect(b.of('lobby').length - before).toBeLessThanOrEqual(1);
    h.advance(60);
    expect(b.lastOf('lobby')!.lobby.settings.roundsToWin).toBe(2 + (9 % 6));
  });

  it("les réglages de l'hôte comptent comme de l'activité", () => {
    const { h, a, b } = twoPlayers({ IDLE_LOBBY_MS: '4000' });
    for (let t = 0; t < 60 * 8; t++) {
      if (t % 60 === 0) h.settings(a, { roundsToWin: 3 + ((t / 60) % 2) });
      h.advance(1);
    }
    expect(a.lastOf('left')).toBeUndefined();
    expect(b.lastOf('left')?.reason).toBe('idle');
  });
});

describe('salon de spectateurs seuls', () => {
  it('sans joueur, la partie est figée : le salon est fermé après le délai, spectateurs prévenus', () => {
    const { h, code, a, b } = twoPlayers({
      ROOM_IDLE_TTL_SEC: '2',
      RECONNECT_GRACE_MS: '0',
    });
    h.startMatch(a, [b]);
    h.advance(100);
    const s = h.connect('10.0.0.7');
    h.join(s, code, 'Spec');
    h.send(a, { t: 'leave' });
    h.send(b, { t: 'leave' });
    const room = h.room(code);
    expect(room.playerCount).toBe(0);
    expect(room.isEmpty).toBe(false);
    h.advance(60 * 5);
    expect(h.server.rooms.has(code)).toBe(false);
    expect(s.lastOf('left')?.reason).toBe('closed');
  });
});

describe('événements de simulation perdus', () => {
  it('le dépassement du tampon de 128 événements est visible dans /metrics', () => {
    const { h, code } = twoPlayers();
    h.advance(5);
    expect(h.server.metrics.snapshot({}).eventsDropped).toBe(0);
    const ev = h.room(code).world.events;
    // 3 événements perdus pendant un pas : le serveur les relève au pas suivant
    ev.dropped = 3;
    h.advance(1);
    expect(h.server.metrics.eventsDropped).toBe(3);
    expect(h.server.metrics.snapshot({}).eventsDropped).toBe(3);
    expect(ev.dropped).toBe(0);
  });
});
