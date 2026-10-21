import { MAX_PLAYERS } from '@stickyclaude/shared';
import type { ArenaData, Recording } from '@stickyclaude/shared';
import { addPlayer, removePlayer, step } from './step.ts';
import { createWorld } from './world.ts';
import type { World } from './world.ts';

/**
 * Rejoue un enregistrement d'entrées dans une simulation neuve. `onTick` est appelé après chaque
 * pas (relecture visuelle, tests). Retourne le monde final.
 */
export function replayRecording(
  rec: Recording,
  arena: ArenaData,
  onTick?: (world: World) => void,
): World {
  const world = createWorld(arena, rec.seed);
  const inputs = new Uint16Array(MAX_PLAYERS);
  let ji = 0;
  let li = 0;
  let ii = 0;
  for (let t = 1; t <= rec.ticks; t++) {
    while (ji < rec.joins.length && rec.joins[ji].tick <= world.tick) {
      const j = rec.joins[ji++];
      addPlayer(world, j.slot);
      inputs[j.slot] = 0;
    }
    while (li < rec.leaves.length && rec.leaves[li].tick <= world.tick) {
      const l = rec.leaves[li++];
      removePlayer(world, l.slot);
      inputs[l.slot] = 0;
    }
    while (ii < rec.inputs.length && rec.inputs[ii][0] <= t) {
      const c = rec.inputs[ii++];
      inputs[c[1]] = c[2];
    }
    step(world, inputs);
    onTick?.(world);
  }
  return world;
}
