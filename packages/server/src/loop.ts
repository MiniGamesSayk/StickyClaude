import type { GameServer } from './gameServer.ts';

/** Au plus ce nombre de ticks de rattrapage par tour de boucle, puis on abandonne le retard. */
const MAX_CATCHUP = 4;

export interface Loop {
  stop(): void;
}

/**
 * Boucle de ticks unique pour toutes les salles : horloge monotone, accumulateur, `setTimeout`
 * réglé sur le prochain tick. La cadence moyenne est exacte même si un tour arrive en retard.
 */
export function startLoop(
  game: GameServer,
  tickHz: number,
  onOverrun?: (lagMs: number) => void,
): Loop {
  const tickMs = 1000 / tickHz;
  let next = performance.now() + tickMs;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const run = (): void => {
    if (stopped) return;
    let now = performance.now();
    let n = 0;
    while (now >= next && n < MAX_CATCHUP) {
      game.tick(next);
      next += tickMs;
      n++;
      now = performance.now();
    }
    if (now >= next) {
      game.metrics.tickOverruns++;
      onOverrun?.(now - next);
      next = now + tickMs;
    }
    timer = setTimeout(run, Math.max(0, Math.floor(next - performance.now())));
  };
  timer = setTimeout(run, 0);

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
