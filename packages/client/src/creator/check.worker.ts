import { analyzeArena, suggestSpawns } from '@stickyclaude/sim';
import type { ArenaData } from '@stickyclaude/shared';

/**
 * Analyse d'un niveau hors du fil de l'interface : sur un terrain très ouvert elle prend plusieurs
 * secondes de simulation (voir `analyzeArena`).
 */
export type CheckRequest =
  | { id: number; kind: 'check'; arena: ArenaData }
  | { id: number; kind: 'spawns'; arena: ArenaData };

self.onmessage = (e: MessageEvent<CheckRequest>): void => {
  const m = e.data;
  const post = (self as unknown as Worker).postMessage.bind(self);
  if (m.kind === 'check') post({ id: m.id, report: analyzeArena(m.arena) });
  else post({ id: m.id, spawns: suggestSpawns(m.arena) });
};
