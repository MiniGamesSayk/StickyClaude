import type { ArenaData } from '@stickyclaude/shared';
import { analyzeArena, suggestSpawns } from '@stickyclaude/sim';
import type { ArenaReport, SpawnSuggestion } from '@stickyclaude/sim';

/**
 * Lance les analyses de niveau dans un worker. Une demande plus récente abandonne l'ancienne (le
 * worker est relancé : un calcul périmé ne bloque jamais le suivant). Sans `Worker` (tests,
 * vieux navigateurs), le calcul se fait sur place.
 */
export class LevelChecker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (v: unknown) => void>();

  private spawn(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./check.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number }>): void => {
        const done = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        done?.(e.data);
      };
      return w;
    } catch {
      return null;
    }
  }

  /** Abandonne ce qui est en cours (les promesses en attente ne se résolvent jamais). */
  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private ask<T>(kind: 'check' | 'spawns', arena: ArenaData): Promise<T | null> {
    if (this.pending.size > 0) this.reset();
    this.worker ??= this.spawn();
    const w = this.worker;
    if (!w) {
      const r =
        kind === 'check' ? { report: analyzeArena(arena) } : { spawns: suggestSpawns(arena) };
      return Promise.resolve(r as T);
    }
    const id = ++this.seq;
    return new Promise<T | null>((resolve) => {
      this.pending.set(id, (v) => resolve(v as T));
      w.postMessage({ id, kind, arena });
    });
  }

  async check(arena: ArenaData): Promise<ArenaReport | null> {
    return (await this.ask<{ report: ArenaReport }>('check', arena))?.report ?? null;
  }

  async spawns(arena: ArenaData): Promise<SpawnSuggestion | null> {
    return (await this.ask<{ spawns: SpawnSuggestion }>('spawns', arena))?.spawns ?? null;
  }

  dispose(): void {
    this.reset();
  }
}
