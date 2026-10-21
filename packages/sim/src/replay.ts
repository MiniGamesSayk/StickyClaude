import { Cause, getArena, isMovementKey, MAX_PLAYERS } from '@stickyclaude/shared';
import type { ArenaData, Recording, RecordOp } from '@stickyclaude/shared';
import { killPlayer } from './combat.ts';
import { applyStart, returnToLobby } from './game.ts';
import { addPlayer, removePlayer } from './spawn.ts';
import { step } from './step.ts';
import { createWorld } from './world.ts';
import type { World } from './world.ts';

/** Applique une opération du salon à un monde (relecture). */
export function applyOp(world: World, op: RecordOp, lobbyArena: ArenaData): void {
  switch (op.op) {
    case 'join':
      addPlayer(world, op.slot);
      world.inMatch[op.slot] = op.inMatch ? 1 : 0;
      break;
    case 'leave':
      removePlayer(world, op.slot);
      break;
    case 'lobby':
      returnToLobby(world, lobbyArena);
      break;
    case 'kill':
      killPlayer(world, op.slot, -1, Cause.NONE);
      break;
    case 'rules':
      world.rules = { ...op.rules, bonusModes: [...op.rules.bonusModes] };
      break;
    case 'start': {
      const arenas: ArenaData[] = [];
      for (const id of op.arenas) {
        const a = getArena(id);
        if (a) arenas.push(a);
      }
      applyStart(world, { rules: op.rules, arenas, inMatch: op.inMatch, teams: op.teams });
      break;
    }
  }
}

/** Rejoue un enregistrement pas à pas (relecture visuelle, tests). */
export class ReplayCursor {
  readonly world: World;
  private readonly inputs = new Uint16Array(MAX_PLAYERS);
  private oi = 0;
  private ii = 0;
  private ti = 0;

  constructor(
    readonly rec: Recording,
    private readonly lobbyArena: ArenaData,
  ) {
    this.world = createWorld(lobbyArena, rec.seed);
  }

  get done(): boolean {
    return this.world.tick >= this.rec.ticks;
  }

  /** Simule le pas suivant. Retourne faux quand l'enregistrement est terminé. */
  stepOnce(): boolean {
    if (this.done) return false;
    const { rec, world, inputs } = this;
    const t = world.tick + 1;
    while (this.oi < rec.ops.length && rec.ops[this.oi].tick <= world.tick) {
      const op = rec.ops[this.oi++];
      applyOp(world, op, this.lobbyArena);
      if (op.op === 'join' || op.op === 'leave') {
        inputs[op.slot] = 0;
      }
    }
    const tunes = rec.tunes ?? [];
    while (this.ti < tunes.length && tunes[this.ti][0] <= world.tick) {
      const [, key, value] = tunes[this.ti++];
      if (isMovementKey(key)) {
        world.baseParams[key] = value;
        world.params[key] = value;
      }
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
