import { MAX_PLAYERS, TICK_HZ } from '@stickyclaude/shared';
import type { Recording } from '@stickyclaude/shared';

const MAX_CHANGES = 400_000;

/** Enregistre les entrées d'une salle sous forme de changements de masque. */
export class RoomRecorder {
  private readonly joins: Recording['joins'] = [];
  private readonly leaves: Recording['leaves'] = [];
  private readonly inputs: Recording['inputs'] = [];
  private readonly last = new Uint16Array(MAX_PLAYERS);

  constructor(
    private readonly arenaId: string,
    private readonly seed: number,
  ) {}

  join(tick: number, slot: number): void {
    this.joins.push({ tick, slot });
    this.last[slot] = 0;
  }

  leave(tick: number, slot: number): void {
    this.leaves.push({ tick, slot });
    this.last[slot] = 0;
  }

  input(tick: number, slot: number, mask: number): void {
    if (this.last[slot] === mask || this.inputs.length >= MAX_CHANGES) return;
    this.last[slot] = mask;
    this.inputs.push([tick, slot, mask]);
  }

  toRecording(ticks: number, finalHash?: number): Recording {
    return {
      version: 1,
      arenaId: this.arenaId,
      seed: this.seed,
      tickHz: TICK_HZ,
      ticks,
      joins: this.joins,
      leaves: this.leaves,
      inputs: this.inputs,
      finalHash,
    };
  }
}
