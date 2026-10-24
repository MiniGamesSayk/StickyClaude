import {
  getArena,
  MAX_OBJECTS,
  MAX_PROJECTILES,
  PlayerFlag,
  PlayerState,
  TICK_MS,
} from '@stickyclaude/shared';
import type { Recording } from '@stickyclaude/shared';
import { ReplayCursor } from '@stickyclaude/sim';
import { createScene } from './app/scene.ts';
import type { Renderer } from './render/renderer.ts';
import type { Scene } from './render/types.ts';

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
  if (rec.version !== 5 || !arena) throw new Error('enregistrement invalide');
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
  const first = cursor.world;
  const scene: Scene = createScene(first);
  renderer.ticker.add((t) => {
    if (!paused) acc += t.deltaMS * speed;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      if (!cursor.stepOnce()) {
        paused = true;
        break;
      }
    }
    const w = cursor.world;
    scene.world = w;
    let np = 0;
    w.players.forEach((p, slot) => {
      if (!p.active || p.dead) return;
      const d = scene.players[np++];
      d.slot = slot;
      d.x = p.ghost ? p.ghostX : p.x;
      d.y = p.ghost ? p.ghostY : p.y;
      d.vx = p.vx;
      d.vy = p.vy;
      d.facing = p.facing;
      d.crouching = p.crouching;
      d.flags = (p.facing > 0 ? PlayerFlag.FACING_RIGHT : 0) | PlayerFlag.ALIVE;
      d.state = p.ghost ? PlayerState.GHOST : p.state;
      d.animProg = p.stateTicks;
      d.variant = 0;
      d.hp = p.hp;
      d.weapon = p.weapon;
      d.ammo = p.ammo;
      d.aim = p.aim;
      d.self = false;
      d.name = '';
      d.color = slot;
      d.team = -1;
      d.stroke = 0;
      d.hat = 0;
      d.victory = 0;
      d.mannequin = false;
    });
    scene.playerCount = np;
    let n = 0;
    for (const o of w.objects) {
      if (!o.active || n >= MAX_OBJECTS) continue;
      const v = scene.objects[n++];
      v.uid = o.uid;
      v.type = o.type;
      v.x = o.x;
      v.y = o.y;
      v.vx = o.vx;
      v.vy = o.vy;
      v.a = o.a;
      v.b = o.b;
    }
    scene.objectCount = n;
    let m = 0;
    for (const p of w.projectiles) {
      if (!p.active || m >= MAX_PROJECTILES) continue;
      const v = scene.projectiles[m++];
      v.uid = p.uid;
      v.type = p.type;
      v.x = p.x;
      v.y = p.y;
      v.vx = p.vx;
      v.vy = p.vy;
      v.owner = p.owner < 0 ? 255 : p.owner;
      v.a = p.weapon;
    }
    scene.projCount = m;
    scene.moverTick = w.tick;
    scene.remoteTick = w.tick;
    scene.params = w.params;
    scene.game.phase = w.game.phase;
    scene.game.mode = w.game.mode;
    renderer.render(scene);
    onInfo(
      `Relecture · tick ${w.tick}/${rec.ticks} · manche ${w.game.round} · ×${speed}${paused ? ' (pause)' : ''}`,
    );
  });
}
