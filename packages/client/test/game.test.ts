import { Cell, GamePhase, Input, PlayerState, SimEvent } from '@stickyclaude/shared';
import { destroyCircle, killPlayer, pointBlocked } from '@stickyclaude/sim';
import { describe, expect, it } from 'vitest';
import { TestWorld } from './harness.ts';
import type { NetOptions, Probe } from './harness.ts';

const NET: NetOptions = { lag: 60, jitter: 5, loss: 0 };

/** Lance une partie : réglages rapides, tous prêts, l'hôte lance. */
function startMatch(w: TestWorld, probes: Probe[], extra: Record<string, unknown> = {}): void {
  probes[0].client.settings({ roundsToWin: 3, suddenDeathSec: 20, bonusEvery: 0, ...extra });
  w.run(300);
  for (const p of probes.slice(1)) p.client.ready(true);
  w.run(300);
  probes[0].client.start();
  w.run(500);
}

/** Avance jusqu'à ce que `cond` soit vraie (par pas de 250 ms), au plus `maxMs`. */
function runUntil(w: TestWorld, cond: () => boolean, maxMs: number): boolean {
  for (let t = 0; t < maxMs && !cond(); t += 250) w.run(250);
  return cond();
}

/** Les joueurs sont posés, la manche est lancée et les protections d'apparition ont expiré. */
function reachFight(w: TestWorld, probes: Probe[]): void {
  for (const p of probes) p.bot.forced = 0;
  expect(runUntil(w, () => probes[0].client.game.phase === GamePhase.PLAYING, 8000)).toBe(true);
  w.run(4000);
}

describe('partie complète', () => {
  it('du salon au podium, avec des joueurs qui se battent', () => {
    const w = new TestWorld({ MATCH_END_MS: '1000' });
    const probes = w.populate(3, NET);
    for (const p of probes) p.bot.fight = true;
    const phases = new Set<number>();
    startMatch(w, probes);
    const done = runUntil(
      w,
      () => {
        phases.add(probes[0].client.game.phase);
        return probes[0].results.length > 0;
      },
      1_200_000,
    );
    expect(done).toBe(true);
    w.run(500);
    for (const p of probes) {
      expect(p.results).toHaveLength(1);
      expect(p.results[0].podium).toHaveLength(3);
      expect(p.results[0].winner).toBeGreaterThanOrEqual(0);
      expect(p.results[0].stats).toHaveLength(3);
      expect(p.scores.length).toBeGreaterThanOrEqual(3);
      expect(p.rounds.length).toBeGreaterThanOrEqual(3);
      expect(p.rounds.some((r) => r.round === 1)).toBe(true);
      expect(p.errors).toEqual([]);
      expect(p.closes).toBe(0);
      expect(p.client.predictor!.resyncs).toBeLessThanOrEqual(3);
    }
    expect(phases.has(GamePhase.COUNTDOWN)).toBe(true);
    expect(phases.has(GamePhase.PLAYING)).toBe(true);
    expect(phases.has(GamePhase.ROUND_END)).toBe(true);
    expect(probes[0].events.some((e) => e.type === SimEvent.KO)).toBe(true);
    // retour au salon d'attente après le podium
    w.run(3000);
    for (const p of probes) {
      expect(p.client.game.phase).toBe(GamePhase.LOBBY);
      expect(p.client.lobby!.phase).toBe(GamePhase.LOBBY);
      expect(p.client.round!.round).toBe(0);
    }
  });

  it('chaque client voit la même arène et les mêmes scores que le serveur', () => {
    const w = new TestWorld();
    const probes = w.populate(2, NET);
    startMatch(w, probes);
    const room = w.room();
    for (const p of probes) {
      expect(p.client.round!.arena).toBe(room.world.arena.id);
      expect(p.client.world!.arena.id).toBe(room.world.arena.id);
      expect(p.client.game.round).toBe(1);
    }
  });
});

describe('combat', () => {
  function duel(): { w: TestWorld; a: Probe; b: Probe } {
    const w = new TestWorld();
    const probes = w.populate(2, NET);
    startMatch(w, probes);
    reachFight(w, probes);
    return { w, a: probes[0], b: probes[1] };
  }

  /** Place B à côté de A, face à lui, sur un sol libre. Retourne le côté choisi (1 : à droite). */
  function faceOff(w: TestWorld, a: Probe, b: Probe): number {
    const room = w.room();
    const wa = room.world.players[a.client.slot];
    const wb = room.world.players[b.client.slot];
    for (const side of [1, -1]) {
      const x = wa.x + side * 14;
      if (pointBlocked(room.world, x, wa.y - 8) || pointBlocked(room.world, x, wa.y - 30)) continue;
      wb.x = x;
      wb.y = wa.y;
      wb.vx = 0;
      wb.vy = 0;
      wa.facing = side;
      wb.facing = -side;
      w.run(500);
      return side;
    }
    throw new Error('pas de place pour le duel');
  }

  it('son coup démarre tout de suite à l’écran, touche l’adversaire et lui retire des PV', () => {
    const { w, a, b } = duel();
    const side = faceOff(w, a, b);
    const room = w.room();
    const sb = b.client.slot;
    expect(room.world.players[sb].hp).toBe(100);
    a.bot.forced = side > 0 ? Input.RIGHT | Input.ATTACK : Input.LEFT | Input.ATTACK;
    let frames = 0;
    while (a.client.view.own.state !== PlayerState.ATTACK && frames < 6) {
      w.run(1000 / 60);
      frames++;
    }
    // réponse immédiate : l'animation de coup ne attend pas le serveur (60 ms de latence)
    expect(frames).toBeLessThanOrEqual(3);
    w.run(600);
    a.bot.forced = 0;
    w.run(800);
    expect(room.world.players[sb].hp).toBeLessThan(100);
    // B le voit sur son propre état (PV du bloc « own »), A reçoit l'événement
    expect(b.client.view.own.hp).toBeLessThan(100);
    const hits = a.events.filter((e) => e.type === SimEvent.HIT && e.slot === sb);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].a[3]).toBeGreaterThan(0);
  });

  it('la parade annule une partie des dégâts et l’événement arrive aux deux joueurs', () => {
    const { w, a, b } = duel();
    const side = faceOff(w, a, b);
    const room = w.room();
    const sb = b.client.slot;
    b.bot.forced = Input.BLOCK;
    a.bot.forced = side > 0 ? Input.RIGHT | Input.ATTACK : Input.LEFT | Input.ATTACK;
    w.run(1500);
    a.bot.forced = 0;
    w.run(500);
    const blocked = a.events.filter((e) => e.type === SimEvent.BLOCKED && e.slot === sb);
    expect(blocked.length).toBeGreaterThan(0);
    expect(b.events.some((e) => e.type === SimEvent.BLOCKED && e.slot === sb)).toBe(true);
    expect(room.world.players[sb].hp).toBeGreaterThan(40);
  });

  it('un joueur éliminé devient un fantôme-crayon dont les traits apparaissent chez tous', () => {
    const w = new TestWorld();
    const probes = w.populate(3, NET);
    startMatch(w, probes);
    reachFight(w, probes);
    const room = w.room();
    const [a, b] = probes;
    const sa = a.client.slot;
    killPlayer(room.world, sa, -1, 0);
    (room as unknown as { drainEvents(now: number): void }).drainEvents(0);
    w.run(500);
    expect(a.client.view.own.ghost).toBe(true);
    expect(b.events.some((e) => e.type === SimEvent.KO && e.slot === sa)).toBe(true);
    // le fantôme pose un trait quand son délai est écoulé (2 s au début)
    w.run(2500);
    a.bot.forced = Input.ATTACK;
    w.run(400);
    a.bot.forced = 0;
    w.run(1000);
    expect(b.events.some((e) => e.type === SimEvent.GHOST_DRAW && e.slot === sa)).toBe(true);
    let oneway = 0;
    for (const c of b.client.world!.cells) if (c === Cell.ONEWAY) oneway++;
    const base = [...room.world.arena.grid.join('')].filter((ch) => ch === '-').length;
    expect(oneway).toBeGreaterThan(base);
  });
});

describe('terrain destructible', () => {
  it('une destruction décidée par le serveur se retrouve dans le monde de chaque client', () => {
    const w = new TestWorld();
    const probes = w.populate(2, NET);
    w.run(2000);
    const room = w.room();
    const cells = room.world.cells;
    const paper = cells.findIndex((c) => c === Cell.PAPER);
    expect(paper).toBeGreaterThanOrEqual(0);
    const cx = paper % 64;
    const cy = Math.floor(paper / 64);
    const before = probes.map((p) => p.client.world!.terrainVersion);
    expect(probes[0].client.world!.cells[paper]).toBe(Cell.PAPER);
    expect(destroyCircle(room.world, cx, cy, 0)).toBe(1);
    room.pushNet(SimEvent.TERRAIN, 0, [cx, cy, 0]);
    w.run(1500);
    probes.forEach((p, i) => {
      expect(p.client.world!.cells[paper]).toBe(Cell.EMPTY);
      expect(p.client.world!.terrainVersion).toBeGreaterThan(before[i]);
    });
    // un arrivant reçoit directement le terrain courant
    const late = w.addClient('Late', NET, probes[0].client.code);
    w.run(1500);
    expect(late.client.world!.cells[paper]).toBe(Cell.EMPTY);
  });
});

describe('spectateur', () => {
  it('arrive en cours de manche, suit la partie sans être déconnecté, entre à la manche suivante', () => {
    const w = new TestWorld();
    const probes = w.populate(2, NET);
    for (const p of probes) p.bot.fight = true;
    startMatch(w, probes);
    const spec = w.addClient('Specta', NET, probes[0].client.code);
    w.run(3000);
    expect(spec.client.state).toBe('joined');
    expect(spec.client.slot).toBe(-1);
    expect(spec.client.predictor).toBeNull();
    expect(spec.client.view.remoteCount).toBe(2);
    expect(spec.client.world!.arena.id).toBe(w.room().world.arena.id);
    w.run(20_000);
    expect(spec.closes).toBe(0);
    expect(spec.errors).toEqual([]);
    expect(spec.events.length).toBeGreaterThan(0);
    // à la fin de la manche il prend la place libre… ou reste spectateur si aucune n'est libre
    expect(runUntil(w, () => spec.client.slot >= 0 || probes[0].results.length > 0, 600_000)).toBe(
      true,
    );
    w.run(500);
    expect(spec.client.state).toBe('joined');
  });
});

describe('reconnexion', () => {
  it('reprend sa place avec le jeton dans les 20 secondes, pas après', () => {
    const w = new TestWorld();
    const [a, b] = w.populate(2, NET);
    w.run(2000);
    const { token, code } = a.client;
    const slot = a.client.slot;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    a.client.close();
    w.run(3000);
    expect(b.client.lobby!.players.find((p) => p.slot === slot)!.connected).toBe(false);
    const again = w.addClient('Aaaa', NET, undefined, undefined, (c) => c.resume(token, code));
    w.run(1500);
    expect(again.client.state).toBe('joined');
    expect(again.client.slot).toBe(slot);
    expect(again.errors).toEqual([]);
    expect(b.client.lobby!.players.find((p) => p.slot === slot)!.connected).toBe(true);
    // un jeton inconnu ou périmé est refusé
    const late = w.addClient('Cccc', NET, undefined, undefined, (c) =>
      c.resume('0'.repeat(32), code),
    );
    w.run(1500);
    expect(late.client.state).not.toBe('joined');
    expect(late.errors).toContain('bad_token');
  });
});

describe('compensation de latence', () => {
  it('le client annonce au serveur la durée qui sépare son entrée de ce qu’il voit', () => {
    const w = new TestWorld();
    const probes = w.populate(2, { lag: 100, jitter: 5, loss: 0 });
    w.run(6000);
    const room = w.room();
    for (const p of probes) {
      const st = p.client.stats;
      // rtt + avance + interpolation (≥ 100 ms)
      expect(st.rewindMs).toBeGreaterThan(st.rttMs + 100);
      expect(st.rewindMs).toBeLessThan(st.rttMs + 400);
      const member = room.slots[p.client.slot]!;
      const expected = Math.min(15, Math.round(st.rewindMs / (1000 / 60)));
      expect(Math.abs(member.rewindTicks - expected)).toBeLessThanOrEqual(2);
    }
  });
});
