import * as fc from 'fast-check';
import { CELL, FALL_MARGIN, GRID_W, MAX_PLAYERS, WORLD_H } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { addPlayer, createWorld, MAX_SIM_EVENTS, step } from '../src/index.ts';
import { arena, overlapsSolid } from './helpers.ts';

const inputSeq = fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 50, maxLength: 400 });

describe('propriétés', () => {
  it('un joueur n est jamais dans un bloc plein, quelles que soient les entrées', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('test-flat', 'test-tower'),
        fc.array(inputSeq, { minLength: 1, maxLength: 3 }),
        (arenaId, seqs) => {
          const w = createWorld(arena(arenaId), 3);
          const inputs = new Uint32Array(MAX_PLAYERS);
          for (let s = 0; s < seqs.length; s++) addPlayer(w, s);
          const len = Math.max(...seqs.map((q) => q.length));
          for (let t = 0; t < len; t++) {
            for (let s = 0; s < seqs.length; s++) inputs[s] = seqs[s][t % seqs[s].length]!;
            step(w, inputs);
            for (let s = 0; s < seqs.length; s++) {
              const p = w.players[s];
              if (overlapsSolid(w, p)) return false;
              if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
              if (p.x < 2 * CELL || p.x > (GRID_W - 2) * CELL) return false;
              if (p.y > WORLD_H + FALL_MARGIN + 800) return false;
              if (p.hp < 0 || p.hp > 100) return false;
            }
            if (w.events.count > MAX_SIM_EVENTS) return false;
          }
          return true;
        },
      ),
      { numRuns: 60 },
    );
  });

  it('aucune position ni vitesse de départ ne permet de traverser un bloc', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 40, max: 980, noNaN: true }),
        fc.double({ min: 40, max: 520, noNaN: true }),
        fc.double({ min: -20000, max: 20000, noNaN: true }),
        fc.double({ min: -20000, max: 20000, noNaN: true }),
        inputSeq,
        (x, y, vx, vy, seq) => {
          const w = createWorld(arena('test-tower'), 1);
          addPlayer(w, 0);
          const p = w.players[0];
          p.x = x;
          p.y = y;
          // Position de départ invalide (dans un bloc) : ignorée.
          if (overlapsSolid(w, p)) return true;
          p.vx = vx;
          p.vy = vy;
          const inputs = new Uint32Array(MAX_PLAYERS);
          for (let t = 0; t < seq.length; t++) {
            inputs[0] = seq[t]!;
            step(w, inputs);
            if (overlapsSolid(w, w.players[0])) return false;
          }
          return true;
        },
      ),
      { numRuns: 120 },
    );
  });

  it('un joueur laissé sans entrée finit toujours posé ou réapparu', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 }), (slot) => {
        const w = createWorld(arena('test-flat'), 5);
        addPlayer(w, slot);
        const inputs = new Uint32Array(MAX_PLAYERS);
        for (let t = 0; t < 400; t++) step(w, inputs);
        return w.players[slot].grounded;
      }),
      { numRuns: 8 },
    );
  });

  it('les tampons d événements ne débordent jamais avec 8 joueurs', () => {
    const w = createWorld(arena('test-flat'), 11);
    for (let s = 0; s < MAX_PLAYERS; s++) addPlayer(w, s);
    const inputs = new Uint32Array(MAX_PLAYERS);
    let seed = 12345;
    for (let t = 0; t < 3000; t++) {
      for (let s = 0; s < MAX_PLAYERS; s++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        inputs[s] = (seed >>> 16) & 0xff;
      }
      step(w, inputs);
      expect(w.events.count).toBeLessThanOrEqual(MAX_SIM_EVENTS);
    }
  });
});
