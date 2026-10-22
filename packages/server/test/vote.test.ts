import { ARENAS, GamePhase, MAX_CUSTOM_ARENAS } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { Cause } from '@stickyclaude/shared';
import { killPlayer } from '@stickyclaude/sim';
import { describe, expect, it } from 'vitest';
import { harness } from './helpers.ts';
import type { FakeConn, Harness } from './helpers.ts';

/** Un niveau de joueur valide : une arène du jeu, sans décor. */
function level(name = 'Mon niveau'): ArenaData {
  const a = structuredClone(ARENAS['maths-quadrille']);
  a.id = 'brouillon-du-joueur';
  a.name = { fr: name, en: name };
  a.decor = [];
  return a;
}

function room(h: Harness, env = {}): { a: FakeConn; b: FakeConn; code: string } {
  void env;
  const a = h.connect('10.0.0.1');
  const b = h.connect('10.0.0.2');
  const code = h.create(a, 'Alice');
  h.join(b, code, 'Bob');
  return { a, b, code };
}

describe('vote de la carte', () => {
  it('s’ouvre avant la première manche, hors combat, chez tous les participants', () => {
    const h = harness({ VOTE_DEFAULT: '1', VOTE_MS: '4000' });
    const { a, b, code } = room(h);
    h.startMatch(a, [b]);
    h.advance(10);
    const r = h.room(code);
    expect(r.phase).toBe(GamePhase.ROUND_END);
    for (const c of [a, b]) {
      const v = c.lastOf('vote');
      expect(v).toBeDefined();
      expect(v!.options.length).toBeGreaterThanOrEqual(2);
      expect(v!.options.length).toBeLessThanOrEqual(4);
      expect(v!.round).toBe(1);
      expect(v!.endsInMs).toBe(4000);
      expect(v!.counts).toEqual(v!.options.map(() => 0));
    }
  });

  it('la carte la plus votée est jouée, la clôture est anticipée quand tout le monde a voté', () => {
    const h = harness({ VOTE_DEFAULT: '1', VOTE_MS: '20000' });
    const { a, b, code } = room(h);
    h.startMatch(a, [b]);
    h.advance(10);
    const options = a.lastOf('vote')!.options;
    h.send(a, { t: 'vote', pick: 2 });
    h.send(b, { t: 'vote', pick: 2 });
    expect(a.lastOf('votes')!.counts[2]).toBe(2);
    h.advance(120);
    expect(a.lastOf('voteEnd')?.pick).toBe(2);
    expect(h.room(code).world.arena.id).toBe(options[2].id);
    expect(h.room(code).phase).toBe(GamePhase.COUNTDOWN);
    expect(a.lastOf('round')?.round.arena).toBe(options[2].id);
  });

  it('on peut changer son vote ; un indice invalide ou un spectateur sont ignorés', () => {
    const h = harness({ VOTE_DEFAULT: '1', VOTE_MS: '20000' });
    const { a, b } = room(h);
    h.startMatch(a, [b]);
    h.advance(10);
    h.send(a, { t: 'vote', pick: 0 });
    h.send(a, { t: 'vote', pick: 1 });
    expect(a.lastOf('votes')!.counts.slice(0, 2)).toEqual([0, 1]);
    const spectator = h.connect('10.0.0.3');
    h.join(spectator, a.lastOf('joined')!.code, 'Zoe');
    expect(spectator.lastOf('joined')!.slot).toBe(-1);
    // le retardataire reçoit le vote en cours
    expect(spectator.lastOf('vote')).toBeDefined();
    const before = a.lastOf('votes')!.counts.slice();
    h.send(spectator, { t: 'vote', pick: 3 });
    h.send(a, { t: 'vote', pick: 99 });
    expect(
      a
        .messages()
        .filter((m) => m.t === 'votes')
        .at(-1),
    ).toMatchObject({ counts: before });
  });

  it('sans aucun vote, le délai écoulé tire une carte au sort et la manche démarre', () => {
    const h = harness({ VOTE_DEFAULT: '1', VOTE_MS: '1000' });
    const { a, b, code } = room(h);
    h.startMatch(a, [b]);
    h.advance(120);
    expect(a.lastOf('voteEnd')).toBeDefined();
    expect(h.room(code).phase).toBe(GamePhase.COUNTDOWN);
    expect(h.room(code).world.game.round).toBe(1);
  });

  it('un nouveau vote s’ouvre à la fin de chaque manche', () => {
    const h = harness({ VOTE_DEFAULT: '1', VOTE_MS: '1000' });
    const { a, b, code } = room(h);
    h.startMatch(a, [b]);
    h.advance(300);
    const r = h.room(code);
    expect(r.phase).toBe(GamePhase.PLAYING);
    const played = r.world.arena.id;
    a.clear();
    killPlayer(r.world, 1, 0, Cause.MELEE);
    h.advance(260);
    const v = a.lastOf('vote');
    expect(v?.round).toBe(2);
    expect(v!.options.map((o) => o.id)).not.toContain(played);
    h.advance(120);
    expect(r.world.game.round).toBe(2);
  });

  it('l’hôte peut le couper : la manche démarre sans attendre', () => {
    const h = harness({ VOTE_DEFAULT: '1' });
    const { a, b, code } = room(h);
    h.settings(a, { voteMaps: false });
    h.startMatch(a, [b]);
    h.advance(5);
    expect(h.room(code).phase).toBe(GamePhase.COUNTDOWN);
    expect(a.lastOf('vote')).toBeUndefined();
  });

  it('le vote est enregistré pour la relecture', () => {
    const h = harness({ VOTE_DEFAULT: '1', VOTE_MS: '1000', DEV_TOOLS: '1' });
    const { a, b, code } = room(h);
    h.startMatch(a, [b]);
    h.advance(120);
    const rec = h.room(code).recording!.toRecording(h.room(code).world.tick);
    expect(rec.ops.some((o) => o.op === 'vote')).toBe(true);
  });
});

describe('niveaux de joueurs', () => {
  it('un niveau valide est accepté, renommé, sans décor, et envoyé à tout le salon', () => {
    const h = harness();
    const { a, b, code } = room(h);
    const raw = level('Mon <b>niveau</b>');
    h.send(a, { t: 'arena', arena: raw });
    for (const c of [a, b]) {
      const m = c.lastOf('arena');
      expect(m).toBeDefined();
      expect(m!.arena.id).toMatch(/^custom-\d+$/);
      expect(m!.arena.decor).toEqual([]);
    }
    const info = h.room(code).lobbyView(0).custom;
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({ by: 'Alice' });
    expect(b.lastOf('lobby')!.lobby.custom[0].id).toBe(info[0].id);
  });

  it('un niveau dont les apparitions sont inaccessibles est refusé', () => {
    const h = harness();
    const { a } = room(h);
    const bad = level();
    bad.spawns.players[0] = [0, 0]; // dans le cadre plein : personne ne peut s'y tenir
    h.send(a, { t: 'arena', arena: bad });
    expect(a.lastOf('error')?.code).toBe('bad_arena');
    expect(a.lastOf('arena')).toBeUndefined();
  });

  it('un niveau mal formé est refusé par le schéma', () => {
    const h = harness();
    const { a } = room(h);
    const bad = level() as unknown as Record<string, unknown>;
    bad.grid = ['#'];
    h.send(a, { t: 'arena', arena: bad });
    expect(a.closed).toBeNull();
    expect(a.lastOf('arena')).toBeUndefined();
  });

  it('au plus un niveau toutes les 2 s, et un nombre borné par salon', () => {
    const h = harness();
    const { a } = room(h);
    h.send(a, { t: 'arena', arena: level('un') });
    h.send(a, { t: 'arena', arena: level('deux') });
    expect(a.lastOf('error')?.code).toBe('rate_limited');
    for (let i = 1; i < MAX_CUSTOM_ARENAS; i++) {
      h.advance(130);
      h.send(a, { t: 'arena', arena: level(`n${i}`) });
    }
    h.advance(130);
    a.clear();
    h.send(a, { t: 'arena', arena: level('de trop') });
    expect(a.lastOf('error')?.code).toBe('too_many_arenas');
  });

  it('un nouveau venu reçoit les niveaux avant d’entrer, et ils sont dans la réserve de la partie', () => {
    const h = harness();
    const { a, b, code } = room(h);
    h.send(a, { t: 'arena', arena: level('Partagé') });
    const c = h.connect('10.0.0.5');
    h.join(c, code, 'Cleo');
    const idxArena = c.sent.findIndex((m) => typeof m === 'string' && m.startsWith('{"t":"arena"'));
    const idxJoined = c.sent.findIndex(
      (m) => typeof m === 'string' && m.startsWith('{"t":"joined"'),
    );
    expect(idxArena).toBeGreaterThanOrEqual(0);
    expect(idxArena).toBeLessThan(idxJoined);
    h.startMatch(a, [b, c]);
    const ids = h.room(code).world.arenaPool.map((x) => x.id);
    expect(ids.some((id) => id.startsWith('custom-'))).toBe(true);
    // en partie : plus de nouveau niveau
    a.clear();
    h.advance(130);
    h.send(a, { t: 'arena', arena: level('trop tard') });
    expect(a.lastOf('error')?.code).toBe('in_game');
  });

  it('l’auteur ou l’hôte retire un niveau, pas un autre joueur', () => {
    const h = harness();
    const { a, b, code } = room(h);
    h.send(b, { t: 'arena', arena: level('De Bob') });
    const id = h.room(code).lobbyView(0).custom[0].id;
    const c = h.connect('10.0.0.6');
    h.join(c, code, 'Cleo');
    h.send(c, { t: 'arena_del', id });
    expect(h.room(code).lobbyView(0).custom).toHaveLength(1);
    h.send(a, { t: 'arena_del', id }); // l'hôte
    expect(h.room(code).lobbyView(0).custom).toHaveLength(0);
    expect(b.lastOf('arena_del')?.id).toBe(id);
  });

  it('un niveau ajouté après un choix d’arènes explicite entre dans la liste', () => {
    const h = harness();
    const { a, code } = room(h);
    h.settings(a, { arenas: ['brouillon'] });
    h.send(a, { t: 'arena', arena: level() });
    const r = h.room(code);
    expect(r.settings.arenas).toHaveLength(2);
    expect(r.settings.arenas[1]).toMatch(/^custom-/);
  });
});
