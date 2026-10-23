import {
  BinType,
  createGameSnap,
  createOwnState,
  createSnapshot,
  encodeSnapshot,
  getArena,
  Input,
  PROTOCOL_VERSION,
  SNAPSHOT_MAX_BYTES,
} from '@stickyclaude/shared';
import { addPlayer, createWorld, exportOwn } from '@stickyclaude/sim';
import { describe, expect, it } from 'vitest';
import { Predictor, ReconcileResult } from '../src/net/predictor.ts';
import type { SnapshotBuffer } from '../src/net/interpolation.ts';
import type { GameClient } from '../src/net/client.ts';
import { TestWorld } from './harness.ts';
import type { Probe } from './harness.ts';

const ARENA = 'test-tower';
const NET = { lag: 100, jitter: 10, loss: 0 };

/** Champs privés du client dont les tests vérifient l'état. */
interface ClientInternals {
  keptValid: Uint8Array;
  buffer: SnapshotBuffer;
}
const internals = (c: GameClient): ClientInternals => c as unknown as ClientInternals;

/** Prédicteur seul, sur un monde non autoritaire : démarre au tick 1000 puis simule `steps` ticks. */
function predictor(steps: number): { pred: Predictor; own: ReturnType<typeof createOwnState> } {
  const world = createWorld(getArena(ARENA)!, 7);
  world.auth = false;
  addPlayer(world, 0);
  const pred = new Predictor(world, 0);
  const own = createOwnState();
  exportOwn(world, 0, own);
  pred.start(1000, own, createGameSnap());
  for (let i = 0; i < steps; i++) pred.stepTick(Input.RIGHT);
  return { pred, own };
}

describe('socket à moitié ouverte', () => {
  it('sans aucun pong pendant 6 s, la socket est fermée pour déclencher la reprise', () => {
    const w = new TestWorld();
    const [a] = w.populate(2, NET, ARENA);
    w.run(5000);
    expect(a.client.state).toBe('joined');
    // la socket reste « ouverte » mais plus rien n'arrive (bascule Wi-Fi/4G)
    a.transport.onMessage = (): void => {};
    w.run(5000);
    expect(a.closes).toBe(0);
    w.run(2500);
    expect(a.closes).toBe(1);
    expect(a.client.state).toBe('closed');
  });

  it("un onglet resté masqué longtemps n'est pas pris pour une socket morte", () => {
    const w = new TestWorld();
    const [a] = w.populate(2, NET, ARENA);
    w.run(5000);
    const realUpdate = a.client.update.bind(a.client);
    a.client.update = (): void => {};
    w.run(10_000);
    a.client.update = realUpdate;
    w.run(5000);
    expect(a.closes).toBe(0);
    expect(a.client.state).toBe('joined');
  });
});

describe('rattrapage après une longue interruption', () => {
  it("la prédiction repart de l'état du serveur et couvre le tick serveur courant", () => {
    const w = new TestWorld();
    // 800 ms d'aller-retour : l'écart prédiction/serveur dépasse le plafond de rattrapage
    const [a] = w.populate(2, { lag: 800, jitter: 0, loss: 0 }, ARENA);
    w.run(8000);
    const realUpdate = a.client.update.bind(a.client);
    a.client.update = (): void => {};
    w.run(3000);
    a.client.update = realUpdate;
    w.run(250);
    // l'historique couvre déjà le tick serveur (avant, il restait vide jusqu'à un écart énorme)
    expect(a.client.predictor!.ownAt(w.room().world.tick)).not.toBeNull();
    w.run(3000);
    const room = w.room();
    const own = a.client.predictor!.ownAt(room.world.tick);
    expect(own).not.toBeNull();
    const sp = room.world.players[a.client.slot];
    expect(Math.hypot(own!.x - sp.x, own!.y - sp.y)).toBeLessThan(40);
  });
});

describe('réseau très lent (plus de 2 s d aller-retour)', () => {
  it("l'écart dépasse l'historique : la prédiction se resynchronise et converge", () => {
    const w = new TestWorld();
    const probes = w.populate(2, { lag: 2400, jitter: 0, loss: 0 }, ARENA);
    for (const p of probes) p.bot.fight = true;
    w.run(30_000);
    for (const p of probes) p.bot.idle = true;
    w.run(20_000);
    const room = w.room();
    for (const p of probes) {
      expect(p.client.predictor!.resyncs).toBeGreaterThan(0);
      const own = p.client.predictor!.ownAt(room.world.tick);
      expect(own).not.toBeNull();
      const sp = room.world.players[p.client.slot];
      expect(Math.hypot(own!.x - sp.x, own!.y - sp.y)).toBeLessThan(0.5);
    }
  });

  it('un snapshot plus vieux que l historique redémarre la prédiction', () => {
    const { pred, own } = predictor(200);
    expect(pred.tick).toBe(1200);
    own.x += 50;
    const r = pred.reconcile(1010, own, createGameSnap());
    expect(r).toBe(ReconcileResult.Resynced);
    expect(pred.tick).toBe(1010);
    expect(pred.resyncs).toBe(1);
  });
});

describe('rejeu des entrées', () => {
  it("un trou dans l'historique n'est pas rejoué : le snapshot est ignoré", () => {
    const { pred, own } = predictor(10);
    pred.jumpTo(1100); // saut sans simuler : les ticks 1011 à 1100 n'ont pas d'entrée
    own.x += 50;
    const before = pred.player.x;
    const r = pred.reconcile(1005, own, createGameSnap());
    expect(r).toBe(ReconcileResult.Skipped);
    expect(pred.player.x).toBe(before);
    expect(pred.corrections).toBe(0);
  });
});

describe('interpolation des autres joueurs', () => {
  it('le temps de rendu suit la latence lissée, il ne saute pas à chaque pong', () => {
    const w = new TestWorld();
    const [a] = w.populate(2, { lag: 150, jitter: 60, loss: 5 }, ARENA);
    w.run(6000);
    const c = a.client;
    const real = c.update.bind(c);
    let prev = Number.NaN;
    let worst = 0;
    c.update = (input): void => {
      real(input);
      // part « latence » du retard de rendu des autres joueurs, en ticks, à l'instant de l'image
      const total = c.clock.serverTick(w.net.nowMs) - c.view.remoteTick;
      const delay = total - c.stats.interpMs / (1000 / 60);
      if (!Number.isNaN(prev)) worst = Math.max(worst, Math.abs(delay - prev));
      prev = delay;
    };
    w.run(40_000);
    // la latence utilisée varie d'au plus 0,05 ms par ms (le retard d'interpolation a son propre lissage)
    expect(worst).toBeLessThan(0.1);
  });

  it('un spectateur voit les autres avec la latence lissée aussi', () => {
    const w = new TestWorld();
    const first = w.populate(2, NET, ARENA)[0];
    w.run(2000);
    w.room().startMatch(null, w.net.nowMs, true);
    const spec = w.addClient('Spec', NET, first.client.code, ARENA);
    w.run(6000);
    const c = spec.client;
    expect(c.slot).toBe(-1);
    expect(c.view.remoteCount).toBeGreaterThan(0);
    const delayMs = (c.clock.serverTick(w.net.nowMs) - c.view.remoteTick) * (1000 / 60);
    // latence aller (≈ 50 ms) + retard d'interpolation (≥ 100 ms) : sans la latence, ≈ 100 ms
    expect(delayMs).toBeGreaterThan(130);
  });

  it('un joueur qui part oublie sa position lissée', () => {
    const w = new TestWorld();
    const first = w.populate(3, NET, ARENA);
    w.run(8000);
    const late = first[0];
    const leaver = first[2];
    const slot = leaver.client.slot;
    expect(internals(late.client).keptValid[slot]).toBe(1);
    leaver.client.leave();
    w.run(2000);
    expect(internals(late.client).keptValid[slot]).toBe(0);
  });

  it("un snapshot en retard n'écrase pas le tampon", () => {
    const w = new TestWorld();
    const [a] = w.populate(2, NET, ARENA);
    w.run(8000);
    const buf = internals(a.client).buffer;
    const size = buf.size;
    const oldest = buf.at(0).tick;
    const late = createSnapshot();
    late.tick = oldest - 5;
    const bytes = new Uint8Array(SNAPSHOT_MAX_BYTES);
    const n = encodeSnapshot(bytes, late);
    const lateBefore = a.client.stats.lateSnapshots;
    a.transport.onMessage!(bytes.slice(0, n));
    expect(a.client.stats.lateSnapshots).toBe(lateBefore + 1);
    expect(buf.size).toBe(size);
    expect(buf.at(0).tick).toBe(oldest);
  });
});

describe('protocole', () => {
  it('30 snapshots illisibles de suite préviennent la page', () => {
    const w = new TestWorld();
    const [a] = w.populate(2, NET, ARENA);
    w.run(3000);
    const junk = new Uint8Array([BinType.SNAPSHOT, 1, 2]);
    for (let i = 0; i < 29; i++) a.transport.onMessage!(junk.slice());
    expect(a.desyncs).toBe(0);
    a.transport.onMessage!(junk.slice());
    expect(a.desyncs).toBe(1);
  });

  it('un snapshot lisible remet le compteur à zéro', () => {
    const w = new TestWorld();
    const [a] = w.populate(2, NET, ARENA);
    w.run(3000);
    const junk = new Uint8Array([BinType.SNAPSHOT, 1, 2]);
    for (let i = 0; i < 29; i++) a.transport.onMessage!(junk.slice());
    w.run(500); // de vrais snapshots arrivent
    for (let i = 0; i < 29; i++) a.transport.onMessage!(junk.slice());
    expect(a.desyncs).toBe(0);
  });

  it('un joined d une autre version du protocole est signalé', () => {
    const w = new TestWorld();
    const [a] = w.populate(2, NET, ARENA);
    w.run(3000);
    expect(a.versions).toBe(0);
    const other = { ...a.joined!, v: PROTOCOL_VERSION + 1 };
    a.transport.onMessage!(JSON.stringify(other));
    expect(a.versions).toBe(1);
  });
});

describe('envoi des entrées', () => {
  it('les paquets partent depuis un même tampon réutilisé (pas d allocation par envoi)', () => {
    const w = new TestWorld();
    const [a] = w.populate(2, NET, ARENA);
    w.run(3000);
    const sent: Uint8Array[] = [];
    const send = a.transport.send.bind(a.transport);
    a.transport.send = (d): void => {
      if (typeof d !== 'string') sent.push(d);
      send(d);
    };
    w.run(500);
    const inputs = sent.filter((d) => d[0] === BinType.INPUT);
    expect(inputs.length).toBeGreaterThan(10);
    expect(new Set(inputs.map((d) => d.buffer)).size).toBe(1);
    // et le serveur les a bien reçus : le joueur reste synchronisé
    expect(a.client.state).toBe('joined');
  });
});

export type { Probe };
