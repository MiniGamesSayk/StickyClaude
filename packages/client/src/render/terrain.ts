import { parseGrid } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { moverPosition } from '@stickyclaude/sim';

export function parseArenaCells(arena: ArenaData): Uint8Array {
  return parseGrid(arena.grid);
}

export { moverPosition };
