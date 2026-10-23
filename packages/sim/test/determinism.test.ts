import { MAX_PLAYERS, Rng, SimEvent, TICK_HZ } from '@stickyclaude/shared';
import type { Recording } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  createWorld,
  exportOwn,
  hashWorld,
  importOwn,
  removePlayer,
  replayRecording,
  setTick,
  step,
} from '../src/index.ts';
import { createOwnState } from '@stickyclaude/shared';
import { arena } from './helpers.ts';

/** Génère des entrées « réalistes » : appuis tenus pendant plusieurs ticks. */
class InputGen {
  private readonly rng: Rng;
  private readonly cur = new Uint32Array(MAX_PLAYERS);
  private readonly hold = new Int32Array(MAX_PLAYERS);
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }
  next(out: Uint32Array): void {
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (this.hold[s] <= 0) {
        this.hold[s] = 1 + this.rng.int(40);
        const r = this.rng.nextU32();
        this.cur[s] = r & 0xff & ~((r >>> 8) & 0x20);
      }
      this.hold[s] = this.hold[s] - 1;
      out[s] = this.cur[s]!;
    }
  }
}

describe('déterminisme', () => {
  it('même graine + mêmes entrées = même hash sur 10 000 ticks', () => {
    for (const id of ['test-flat', 'test-tower']) {
      const a = createWorld(arena(id), 42);
      const b = createWorld(arena(id), 42);
      const genA = new InputGen(7);
      const genB = new InputGen(7);
      const inA = new Uint32Array(MAX_PLAYERS);
      const inB = new Uint32Array(MAX_PLAYERS);
      for (let s = 0; s < MAX_PLAYERS; s++) {
        addPlayer(a, s);
        addPlayer(b, s);
      }
      for (let t = 0; t < 10_000; t++) {
        genA.next(inA);
        genB.next(inB);
        step(a, inA);
        step(b, inB);
        if (t % 250 === 0) expect(hashWorld(a)).toBe(hashWorld(b));
      }
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
  });

  it('des entrées différentes donnent un hash différent', () => {
    const a = createWorld(arena(), 42);
    const b = createWorld(arena(), 42);
    addPlayer(a, 0);
    addPlayer(b, 0);
    const inA = new Uint32Array(MAX_PLAYERS);
    const inB = new Uint32Array(MAX_PLAYERS);
    inB[0] = 2;
    for (let t = 0; t < 100; t++) {
      step(a, inA);
      step(b, inB);
    }
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('la relecture d un enregistrement redonne exactement le même état', () => {
    const w = createWorld(arena('test-tower'), 99);
    const gen = new InputGen(5);
    const inputs = new Uint32Array(MAX_PLAYERS);
    const rec: Recording = {
      version: 4,
      arenaId: 'test-tower',
      seed: 99,
      tickHz: TICK_HZ,
      ticks: 4000,
      ops: [],
      inputs: [],
    };
    const last = new Int32Array(MAX_PLAYERS).fill(-1);
    const joined = new Uint8Array(MAX_PLAYERS);
    for (let t = 1; t <= rec.ticks; t++) {
      // Arrivées et départs échelonnés
      if (t % 300 === 1) {
        const s = Math.floor(t / 300) % MAX_PLAYERS;
        if (!joined[s]) {
          rec.ops.push({ tick: w.tick, op: 'join', slot: s, inMatch: false });
          addPlayer(w, s);
          joined[s] = 1;
        }
      }
      if (t % 700 === 0) {
        const s = Math.floor(t / 700) % MAX_PLAYERS;
        if (joined[s]) {
          rec.ops.push({ tick: w.tick, op: 'leave', slot: s });
          removePlayer(w, s);
          joined[s] = 0;
        }
      }
      gen.next(inputs);
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (!joined[s]) inputs[s] = 0;
        if (inputs[s] !== last[s]) {
          rec.inputs.push([t, s, inputs[s]]);
          last[s] = inputs[s]!;
        }
      }
      step(w, inputs);
    }
    const replayed = replayRecording(rec, arena('test-tower'));
    expect(replayed.tick).toBe(w.tick);
    expect(hashWorld(replayed)).toBe(hashWorld(w));
  });
});

describe('restauration d état (réconciliation)', () => {
  it('un monde restauré depuis l état exporté évolue de façon identique', () => {
    // Mouvements seulement : sans coups ni armes, rien ne vient d'un autre joueur.
    const full = createWorld(arena('test-flat'), 1);
    const gen = new InputGen(21);
    const inputs = new Uint32Array(MAX_PLAYERS);
    for (let s = 0; s < MAX_PLAYERS; s++) addPlayer(full, s);
    for (let t = 0; t < 500; t++) {
      gen.next(inputs);
      for (let s = 0; s < MAX_PLAYERS; s++) inputs[s] = inputs[s] & 0x1f;
      step(full, inputs);
    }
    // Monde « client » : un seul joueur actif, restauré à partir de l'état exporté.
    const client = createWorld(arena('test-flat'), 1);
    const own = createOwnState();
    exportOwn(full, 3, own);
    setTick(client, full.tick);
    importOwn(client, 3, own);
    const mine = new Uint32Array(MAX_PLAYERS);
    for (let t = 0; t < 2000; t++) {
      gen.next(inputs);
      for (let s = 0; s < MAX_PLAYERS; s++) inputs[s] = inputs[s] & 0x1f;
      mine.fill(0);
      mine[3] = inputs[3]!;
      step(full, inputs);
      step(client, mine);
      // Une réapparition est une décision du serveur (point choisi selon les autres joueurs) :
      // le client la reçoit par un snapshot, il ne la prédit pas.
      let respawned = false;
      for (let i = 0; i < full.events.count; i++) {
        if (full.events.type[i] === SimEvent.SPAWN && full.events.slot[i] === 3) respawned = true;
      }
      if (respawned) break;
      const a = full.players[3];
      const b = client.players[3];
      expect(b.x).toBe(a.x);
      expect(b.y).toBe(a.y);
      expect(b.vx).toBe(a.vx);
      expect(b.vy).toBe(a.vy);
      expect(b.grounded).toBe(a.grounded);
      expect(b.groundMover).toBe(a.groundMover);
    }
  });

  it('avec des positions arrondies en 32 bits, l écart reste négligeable', () => {
    const full = createWorld(arena('test-flat'), 1);
    const gen = new InputGen(33);
    const inputs = new Uint32Array(MAX_PLAYERS);
    addPlayer(full, 0);
    for (let t = 0; t < 400; t++) {
      gen.next(inputs);
      step(full, inputs);
    }
    const own = createOwnState();
    exportOwn(full, 0, own);
    own.x = Math.fround(own.x);
    own.y = Math.fround(own.y);
    own.vx = Math.fround(own.vx);
    own.vy = Math.fround(own.vy);
    const client = createWorld(arena('test-flat'), 1);
    setTick(client, full.tick);
    importOwn(client, 0, own);
    let maxErr = 0;
    for (let t = 0; t < 600; t++) {
      gen.next(inputs);
      const mine = new Uint32Array(MAX_PLAYERS);
      mine[0] = inputs[0]!;
      step(full, inputs);
      step(client, mine);
      const a = full.players[0];
      const b = client.players[0];
      maxErr = Math.max(maxErr, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }
    expect(maxErr).toBeLessThan(0.05);
  });
});
