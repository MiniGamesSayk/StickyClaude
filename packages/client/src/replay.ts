import {
  createGameSnap,
  getArena,
  MAX_OBJECTS,
  MAX_PROJECTILES,
  PlayerFlag,
  PlayerState,
  TICK_MS,
} from '@stickyclaude/shared';
import type { Recording } from '@stickyclaude/shared';
import { ReplayCursor } from '@stickyclaude/sim';
import { createObjView, createProjView } from './net/interpolation.ts';
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
  if (rec.version !== 3 || !arena) throw new Error('enregistrement invalide');
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
  const objects = Array.from({ length: MAX_OBJECTS }, createObjView);
  const projectiles = Array.from({ length: MAX_PROJECTILES }, createProjView);
  const game = createGameSnap();
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
    players.length = 0;
    w.players.forEach((p, slot) => {
      if (!p.active || p.dead) return;
      players.push({
        slot,
        x: p.ghost ? p.ghostX : p.x,
        y: p.ghost ? p.ghostY : p.y,
        vx: p.vx,
        vy: p.vy,
        facing: p.facing,
        crouching: p.crouching,
        flags: (p.facing > 0 ? PlayerFlag.FACING_RIGHT : 0) | PlayerFlag.ALIVE,
        state: p.ghost ? PlayerState.GHOST : p.state,
        animProg: p.stateTicks,
        variant: 0,
        hp: p.hp,
        weapon: p.weapon,
        ammo: p.ammo,
        aim: p.aim,
        self: false,
        name: '',
        color: slot,
        team: -1,
        stroke: 0,
        hat: 0,
        victory: 0,
        mannequin: false,
      });
    });
    let n = 0;
    for (const o of w.objects) {
      if (!o.active || n >= MAX_OBJECTS) continue;
      const v = objects[n++];
      v.uid = o.uid;
      v.type = o.type;
      v.x = o.x;
      v.y = o.y;
      v.vx = o.vx;
      v.vy = o.vy;
      v.a = o.a;
      v.b = o.b;
    }
    let m = 0;
    for (const p of w.projectiles) {
      if (!p.active || m >= MAX_PROJECTILES) continue;
      const v = projectiles[m++];
      v.uid = p.uid;
      v.type = p.type;
      v.x = p.x;
      v.y = p.y;
      v.vx = p.vx;
      v.vy = p.vy;
      v.owner = p.owner < 0 ? 255 : p.owner;
      v.a = p.weapon;
    }
    game.phase = w.game.phase;
    game.mode = w.game.mode;
    const scene: Scene = {
      world: w,
      players,
      objects,
      objectCount: n,
      projectiles,
      projCount: m,
      moverTick: w.tick,
      remoteTick: w.tick,
      params: w.params,
      game,
      ghost: { x: 0, y: 0, visible: false },
      debug: false,
      teamColors: null,
      winners: 0,
    };
    renderer.render(scene);
    onInfo(
      `Relecture · tick ${w.tick}/${rec.ticks} · manche ${w.game.round} · ×${speed}${paused ? ' (pause)' : ''}`,
    );
  });
}
