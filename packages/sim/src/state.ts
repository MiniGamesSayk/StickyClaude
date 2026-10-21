import { OwnFlag, PlayerFlag, PlayerState } from '@stickyclaude/shared';
import type { OwnState, PlayerSnap } from '@stickyclaude/shared';
import type { World } from './world.ts';

/** Écrit l'état exact de prédiction d'un joueur (envoyé à son propriétaire, voir snapshot). */
export function exportOwn(world: World, slot: number, out: OwnState): void {
  const p = world.players[slot];
  out.x = p.x;
  out.y = p.y;
  out.vx = p.vx;
  out.vy = p.vy;
  out.flags =
    (p.grounded ? OwnFlag.GROUNDED : 0) |
    (p.crouching ? OwnFlag.CROUCHING : 0) |
    (p.doubleAvailable ? OwnFlag.DOUBLE_AVAILABLE : 0) |
    (p.jumping ? OwnFlag.JUMPING : 0) |
    (p.facing > 0 ? OwnFlag.FACING_RIGHT : 0);
  out.coyote = p.coyote;
  out.jumpBuffer = p.jumpBuffer;
  out.wallLock = p.wallLock;
  out.wallCoyote = p.wallCoyote;
  out.dropTimer = p.dropTimer;
  out.wallDir = p.wallSide;
  out.groundMover = p.groundMover;
  out.prevInput = p.prevInput;
  out.respawns = p.respawns;
}

/** Restaure l'état d'un joueur depuis un état exact (réconciliation côté client). */
export function importOwn(world: World, slot: number, o: OwnState): void {
  const p = world.players[slot];
  p.active = true;
  p.x = o.x;
  p.y = o.y;
  p.vx = o.vx;
  p.vy = o.vy;
  p.grounded = (o.flags & OwnFlag.GROUNDED) !== 0;
  p.crouching = (o.flags & OwnFlag.CROUCHING) !== 0;
  p.doubleAvailable = (o.flags & OwnFlag.DOUBLE_AVAILABLE) !== 0;
  p.jumping = (o.flags & OwnFlag.JUMPING) !== 0;
  p.facing = (o.flags & OwnFlag.FACING_RIGHT) !== 0 ? 1 : -1;
  p.coyote = o.coyote;
  p.jumpBuffer = o.jumpBuffer;
  p.wallLock = o.wallLock;
  p.wallCoyote = o.wallCoyote;
  p.dropTimer = o.dropTimer;
  p.wallSide = o.wallDir;
  p.groundMover = o.groundMover;
  p.prevInput = o.prevInput;
  p.respawns = o.respawns;
}

/** Remplit l'entrée de snapshot d'un joueur (valeurs en flottants, quantifiées à l'encodage). */
export function fillPlayerSnap(world: World, slot: number, out: PlayerSnap): void {
  const p = world.players[slot];
  out.slot = slot;
  out.flags =
    PlayerFlag.ALIVE |
    (p.facing > 0 ? PlayerFlag.FACING_RIGHT : 0) |
    (p.grounded ? PlayerFlag.GROUNDED : 0) |
    (p.crouching ? PlayerFlag.CROUCHING : 0) |
    (p.state === PlayerState.WALL_SLIDE ? PlayerFlag.WALL_SLIDING : 0) |
    (p.doubleAvailable ? 0 : PlayerFlag.DOUBLE_JUMP_USED) |
    (p.vy < 0 ? PlayerFlag.RISING : 0);
  out.x = p.x;
  out.y = p.y;
  out.vx = p.vx;
  out.vy = p.vy;
  out.aim = p.facing > 0 ? 0 : 4;
  out.hp = p.hp;
  out.weapon = p.weapon;
  out.ammo = p.ammo;
  out.anim = p.state;
  out.animProg = p.stateTicks > 255 ? 255 : p.stateTicks;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mix(h: number, v: number): number {
  return Math.imul(h ^ v, 16777619) >>> 0;
}

function mixF(h: number, v: number): number {
  f64[0] = v;
  return mix(mix(h, u32[0]), u32[1]);
}

/** Hash FNV-1a de tout l'état de la simulation (pour les tests de déterminisme). */
export function hashWorld(world: World): number {
  let h = 2166136261;
  h = mix(h, world.tick >>> 0);
  for (let i = 0; i < 4; i++) h = mix(h, world.rng.s[i]);
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i];
    h = mix(h, p.active ? 1 : 0);
    if (!p.active) continue;
    h = mixF(h, p.x);
    h = mixF(h, p.y);
    h = mixF(h, p.vx);
    h = mixF(h, p.vy);
    h = mix(h, p.facing + 1);
    h = mix(h, p.state);
    h = mix(h, p.stateTicks);
    h = mix(
      h,
      (p.crouching ? 1 : 0) |
        (p.grounded ? 2 : 0) |
        (p.doubleAvailable ? 4 : 0) |
        (p.jumping ? 8 : 0),
    );
    h = mix(h, p.groundMover + 1);
    h = mix(h, p.coyote);
    h = mix(h, p.jumpBuffer);
    h = mix(h, p.wallLock);
    h = mix(h, p.wallCoyote);
    h = mix(h, p.dropTimer);
    h = mix(h, p.wallSide + 1);
    h = mix(h, p.prevInput);
    h = mix(h, p.respawns);
    h = mix(h, p.hp);
  }
  const cells = world.cells;
  for (let i = 0; i < cells.length; i++) h = mix(h, cells[i]);
  return h >>> 0;
}
