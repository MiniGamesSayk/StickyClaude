import { getArena, TICK_MS } from '@stickyclaude/shared';
import type { Recording } from '@stickyclaude/shared';
import { ReplayCursor } from '@stickyclaude/sim';
import type { Renderer } from './render/renderer.ts';
import type { DrawPlayer, Scene } from './render/renderer.ts';

/**
 * Relecture visuelle d'un enregistrement d'entrées (`?replay=/chemin.json`), en local, sans
 * serveur : espace = pause, [ et ] = vitesse.
 */
export async function startReplay(
  url: string,
  renderer: Renderer,
  onInfo: (text: string) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`enregistrement introuvable (${res.status})`);
  const rec = (await res.json()) as Recording;
  const arena = getArena(rec.arenaId);
  if (rec.version !== 1 || !arena) throw new Error('enregistrement invalide');
  renderer.setArena(arena);
  const cursor = new ReplayCursor(rec, arena);
  let speed = 1;
  let paused = false;
  let acc = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.key === '[') speed = Math.max(0.125, speed / 2);
    if (e.key === ']') speed = Math.min(8, speed * 2);
  });
  const players: DrawPlayer[] = [];
  renderer.ticker.add((t) => {
    if (!paused) acc += t.deltaMS * speed;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      if (!cursor.stepOnce()) {
        paused = true;
        break;
      }
    }
    players.length = 0;
    for (const p of cursor.world.players) {
      if (!p.active) continue;
      players.push({
        slot: players.length,
        x: p.x,
        y: p.y,
        facing: p.facing,
        crouching: p.crouching,
        flags: 0,
        state: p.state,
        self: false,
        name: '',
        color: players.length,
      });
    }
    const scene: Scene = {
      players,
      movers: cursor.world.movers,
      moverCount: cursor.world.moverCount,
      moverTick: cursor.world.tick,
      remoteTick: cursor.world.tick,
      params: cursor.world.params,
      ghost: { x: 0, y: 0, visible: false },
      debug: false,
    };
    renderer.render(scene);
    onInfo(
      `Relecture · tick ${cursor.world.tick}/${rec.ticks} · ×${speed}${paused ? ' (pause)' : ''}`,
    );
  });
}
