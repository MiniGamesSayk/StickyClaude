import { MAX_PLAYERS, TICK_HZ } from '@stickyclaude/shared';
import type { RecordOp, Recording } from '@stickyclaude/shared';

const MAX_CHANGES = 400_000;

/** Enregistre les entrées et les opérations d'une salle, pour les rejouer à l'identique. */
export class RoomRecorder {
  private readonly ops: RecordOp[] = [];
  private readonly inputs: Recording['inputs'] = [];
  private readonly tunes: [number, string, number][] = [];
  private readonly last = new Uint32Array(MAX_PLAYERS);

  constructor(
    private readonly arenaId: string,
    private readonly seed: number,
  ) {}

  /** Opération du salon (arrivée, départ, lancement…), à enregistrer au moment où elle a lieu. */
  op(op: RecordOp): void {
    if (op.op === 'join' || op.op === 'leave') this.last[op.slot] = 0;
    this.ops.push(op);
  }

  input(tick: number, slot: number, mask: number): void {
    if (this.last[slot] === mask || this.inputs.length >= MAX_CHANGES) return;
    this.last[slot] = mask;
    this.inputs.push([tick, slot, mask]);
  }

  tune(tick: number, key: string, value: number): void {
    this.tunes.push([tick, key, value]);
  }

  toRecording(ticks: number, finalHash?: number): Recording {
    return {
      version: 4,
      arenaId: this.arenaId,
      seed: this.seed,
      tickHz: TICK_HZ,
      ticks,
      ops: this.ops,
      inputs: this.inputs,
      tunes: this.tunes,
      finalHash,
    };
  }
}
