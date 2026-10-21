import { isMovementKey, MAX_PLAYERS } from '@stickyclaude/shared';
import type { ArenaData, Recording } from '@stickyclaude/shared';
import { addPlayer, removePlayer } from './spawn.ts';
import { step } from './step.ts';
import { createWorld } from './world.ts';
import type { World } from './world.ts';

/** Rejoue un enregistrement pas à pas (relecture visuelle, tests). */
export class ReplayCursor {
  readonly world: World;
  private readonly inputs = new Uint16Array(MAX_PLAYERS);
  private ji = 0;
  private li = 0;
  private ii = 0;
  private ti = 0;

  constructor(
    readonly rec: Recording,
    arena: ArenaData,
  ) {
    this.world = createWorld(arena, rec.seed);
  }

  get done(): boolean {
    return this.world.tick >= this.rec.ticks;
  }

  /** Simule le pas suivant. Retourne faux quand l'enregistrement est terminé. */
  stepOnce(): boolean {
    if (this.done) return false;
    const { rec, world, inputs } = this;
    const t = world.tick + 1;
    while (this.ji < rec.joins.length && rec.joins[this.ji].tick <= world.tick) {
      const j = rec.joins[this.ji++];
      addPlayer(world, j.slot);
      inputs[j.slot] = 0;
    }
    while (this.li < rec.leaves.length && rec.leaves[this.li].tick <= world.tick) {
      const l = rec.leaves[this.li++];
      removePlayer(world, l.slot);
      inputs[l.slot] = 0;
    }
    const tunes = rec.tunes ?? [];
    while (this.ti < tunes.length && tunes[this.ti][0] <= world.tick) {
      const [, key, value] = tunes[this.ti++];
      if (isMovementKey(key)) world.params[key] = value;
    }
    while (this.ii < rec.inputs.length && rec.inputs[this.ii][0] <= t) {
      const c = rec.inputs[this.ii++];
      inputs[c[1]] = c[2];
    }
    step(world, inputs);
    return true;
  }
}

/**
 * Rejoue un enregistrement d'entrées dans une simulation neuve. `onTick` est appelé après chaque
 * pas. Retourne le monde final.
 */
export function replayRecording(
  rec: Recording,
  arena: ArenaData,
  onTick?: (world: World) => void,
): World {
  const cursor = new ReplayCursor(rec, arena);
  while (cursor.stepOnce()) onTick?.(cursor.world);
  return cursor.world;
}
