import {
  AtkPhase,
  AttackKind,
  COMBAT,
  GRID_H,
  MAX_PLAYERS,
  PlayerState,
  SimEvent,
  WORLD_W,
  CELL,
} from '@stickyclaude/shared';
import { emit } from './world.ts';
import type { Player, World } from './world.ts';

/** Remet à zéro tout l'état de combat d'un joueur (apparition). */
export function resetCombatState(p: Player): void {
  p.hp = COMBAT.maxHp;
  p.weapon = 0;
  p.ammo = 0;
  p.stun = 0;
  p.stunImmune = 0;
  p.hitLock = 0;
  p.atkPhase = AtkPhase.NONE;
  p.atkKind = AttackKind.NONE;
  p.atkTicks = 0;
  p.combo = 0;
  p.comboWindow = 0;
  p.atkBuffer = 0;
  p.chargeTicks = 0;
  p.attackHeld = 0;
  p.blockTicks = 0;
  p.blockCd = 0;
  p.pickupCd = 0;
  p.grappleTicks = 0;
  p.kicking = false;
  p.ghost = false;
  p.dead = false;
  p.hasBomb = false;
  p.respawnTimer = 0;
  p.ghostCd = 0;
  p.hitMask = 0;
  p.wantFire = false;
  p.wantThrow = false;
  p.wantPickup = false;
  p.wantDrop = false;
  p.throwW = 0;
  p.throwA = 0;
  p.lastAttacker = -1;
  p.lastAttackTick = -1000;
  p.lastHitTick = -1000;
  p.combos = 0;
  p.hazardCd = 0;
  p.tackCd = 0;
  p.bombFuse = 0;
  p.bombPassCd = 0;
}

/** Place un joueur à un endroit précis, vivant et protégé `invuln` ticks. */
export function spawnPlayerAt(
  world: World,
  slot: number,
  x: number,
  y: number,
  invuln: number,
): void {
  const p = world.players[slot];
  p.active = true;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.facing = x < WORLD_W / 2 ? 1 : -1;
  p.crouching = false;
  p.grounded = false;
  p.groundMover = -1;
  p.doubleAvailable = true;
  p.jumping = false;
  p.coyote = 0;
  p.jumpBuffer = 0;
  p.wallLock = 0;
  p.wallCoyote = 0;
  p.dropTimer = 0;
  p.wallSide = 0;
  p.state = PlayerState.FALL;
  p.stateTicks = 0;
  p.aim = p.facing > 0 ? 0 : 4;
  resetCombatState(p);
  p.invuln = invuln;
  p.respawns = (p.respawns + 1) & 0xffff;
  emit(world, SimEvent.SPAWN, slot, p.x, p.y);
}

/**
 * Point d'apparition : le plus éloigné des autres joueurs vivants (choix déterministe) ; sans
 * autre joueur, un point fixé par l'emplacement et le nombre d'apparitions.
 */
export function pickSpawn(world: World, slot: number): number {
  const n = world.spawnCount;
  const me = world.players[slot];
  let others = 0;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const q = world.players[s];
    if (s !== slot && q.active && !q.dead && !q.ghost) others++;
  }
  if (others === 0) return (slot + me.respawns * 3) % n;
  let best = 0;
  let bestD = -1;
  for (let k = 0; k < n; k++) {
    const i = (k + slot) % n;
    let d = Infinity;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (s === slot) continue;
      const q = world.players[s];
      if (!q.active || q.dead || q.ghost) continue;
      const dd = Math.hypot(q.x - world.spawnX[i], q.y - 14 - world.spawnY[i]);
      if (dd < d) d = dd;
    }
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** (Ré)apparition d'un joueur à un point d'apparition de l'arène. */
export function spawnPlayer(world: World, slot: number): void {
  const idx = pickSpawn(world, slot);
  spawnPlayerAt(world, slot, world.spawnX[idx], world.spawnY[idx], COMBAT.spawnInvulnTicks);
}

/** Ajoute un joueur dans l'emplacement `slot` (première apparition). */
export function addPlayer(world: World, slot: number): void {
  const p = world.players[slot];
  p.respawns = 0;
  p.prevInput = 0;
  spawnPlayer(world, slot);
}

export function removePlayer(world: World, slot: number): void {
  const p = world.players[slot];
  p.active = false;
  p.prevInput = 0;
  p.hasBomb = false;
}

export const WORLD_ROWS = GRID_H * CELL;
