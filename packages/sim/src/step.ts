import {
  DT,
  FALL_MARGIN,
  Input,
  MAX_PLAYERS,
  PlayerState,
  SimEvent,
  WORLD_H,
  WORLD_W,
} from '@stickyclaude/shared';
import {
  bodyHeight,
  GROUND_ONEWAY,
  GROUND_SOLID,
  hasHeadroom,
  moveX,
  moveY,
  probeGround,
  probeMover,
  wallContact,
} from './collision.ts';
import { emit, moverPosition } from './world.ts';
import type { Player, World } from './world.ts';

/**
 * Un pas de simulation (1/60 s) pour tous les joueurs actifs. Aucune allocation, aucune E/S,
 * aucun `Math.random` : le même état et les mêmes entrées donnent toujours le même résultat.
 *
 * `inputs[slot]` est le masque d'entrées de ce tick pour chaque emplacement (voir `Input`).
 * Les événements du pas sont dans `world.events` (remis à zéro au début de chaque pas).
 */
export function step(world: World, inputs: ArrayLike<number>): void {
  world.tick++;
  world.events.count = 0;
  updateMovers(world);
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    const p = world.players[slot];
    if (!p.active) continue;
    if (p.groundMover >= 0) carry(world, p);
    stepPlayer(world, p, slot, inputs[slot] | 0);
  }
}

const moverPos = { x: 0, y: 0 };

function updateMovers(world: World): void {
  for (let i = 0; i < world.moverCount; i++) {
    const m = world.movers[i];
    moverPosition(m, world.tick, moverPos);
    m.dx = moverPos.x - m.x;
    m.dy = moverPos.y - m.y;
    m.x = moverPos.x;
    m.y = moverPos.y;
  }
}

/** Entraîne un joueur posé sur une plateforme mobile avec elle. */
function carry(world: World, p: Player): void {
  const m = world.movers[p.groundMover];
  moveX(world, p, m.dx);
  moveY(world, p, m.dy);
}

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) {
    v += maxDelta;
    return v > target ? target : v;
  }
  v -= maxDelta;
  return v < target ? target : v;
}

function stepPlayer(world: World, p: Player, slot: number, input: number): void {
  const P = world.params;
  const pressed = input & ~p.prevInput;
  const jumpHeld = (input & Input.JUMP) !== 0;
  const jumpPressed = (pressed & Input.JUMP) !== 0;
  const downHeld = (input & Input.DOWN) !== 0;
  const dir = ((input & Input.RIGHT) !== 0 ? 1 : 0) - ((input & Input.LEFT) !== 0 ? 1 : 0);
  p.prevInput = input;

  if (p.dropTimer > 0) p.dropTimer--;
  if (p.wallLock > 0) p.wallLock--;
  if (p.jumpBuffer > 0) p.jumpBuffer--;
  if (jumpPressed) p.jumpBuffer = P.jumpBufferTicks;

  // --- Sol -----------------------------------------------------------------------------------
  const wasGrounded = p.grounded;
  const ground = probeGround(world, p);
  p.groundMover = probeMover(world, p);
  p.grounded = ground !== 0 || p.groundMover >= 0;
  if (p.grounded) {
    p.coyote = P.coyoteTicks;
    p.doubleAvailable = true;
    p.wallCoyote = 0;
    p.wallSide = 0;
  } else if (p.coyote > 0) {
    p.coyote--;
  }

  // Traversée vers le bas d'une plateforme à sens unique : bas + saut.
  if (jumpPressed && downHeld && p.grounded && (ground & GROUND_SOLID) === 0) {
    if ((ground & GROUND_ONEWAY) !== 0 || p.groundMover >= 0) {
      p.dropTimer = P.dropThroughTicks;
      p.jumpBuffer = 0;
      p.grounded = false;
      p.groundMover = -1;
      p.coyote = 0;
      emit(world, SimEvent.DROP_THROUGH, slot, p.x, p.y);
    }
  }

  // --- Accroupi ------------------------------------------------------------------------------
  if (p.grounded && downHeld) {
    p.crouching = true;
  } else if (p.crouching && hasHeadroom(world, p)) {
    p.crouching = false;
  }

  // --- Mur -----------------------------------------------------------------------------------
  let wall = 0;
  if (!p.grounded) {
    wall = wallContact(world, p, dir);
    if (wall !== 0) {
      p.wallSide = wall;
      p.wallCoyote = P.wallCoyoteTicks;
    } else if (p.wallCoyote > 0) {
      p.wallCoyote--;
    }
  }
  const wallSliding = !p.grounded && wall !== 0 && dir === wall && p.vy >= 0;

  // --- Sauts ---------------------------------------------------------------------------------
  if (p.jumpBuffer > 0) {
    if (p.coyote > 0) {
      p.vy = -P.jumpSpeed;
      p.jumping = true;
      p.coyote = 0;
      p.jumpBuffer = 0;
      p.grounded = false;
      p.groundMover = -1;
      emit(world, SimEvent.JUMP, slot, p.x, p.y);
    } else if (!p.grounded && (wall !== 0 || p.wallCoyote > 0)) {
      const side = wall !== 0 ? wall : p.wallSide;
      p.vx = -side * P.wallJumpSpeedX;
      p.vy = -P.wallJumpSpeedY;
      p.facing = -side;
      p.wallLock = P.wallLockTicks;
      p.jumping = true;
      p.wallCoyote = 0;
      p.wallSide = 0;
      p.jumpBuffer = 0;
      emit(world, SimEvent.WALL_JUMP, slot, p.x, p.y);
    } else if (jumpPressed && p.doubleAvailable) {
      p.vy = -P.doubleJumpSpeed;
      p.doubleAvailable = false;
      p.jumping = true;
      p.jumpBuffer = 0;
      emit(world, SimEvent.DOUBLE_JUMP, slot, p.x, p.y);
    }
  }
  // Saut à hauteur variable : relâcher le bouton coupe la montée.
  if (p.jumping) {
    if (p.vy >= 0) p.jumping = false;
    else if (!jumpHeld) {
      p.vy *= P.jumpCut;
      p.jumping = false;
    }
  }

  // --- Horizontal ----------------------------------------------------------------------------
  if (p.wallLock === 0) {
    const maxSpeed = p.crouching ? P.crouchSpeed : P.runSpeed;
    const target = dir * maxSpeed;
    let accel: number;
    if (p.grounded) {
      if (dir === 0) accel = P.groundDecel;
      else if (p.vx !== 0 && p.vx > 0 !== dir > 0) accel = P.groundTurnAccel;
      else accel = P.groundAccel;
    } else {
      accel = dir === 0 ? P.airDecel : P.airAccel;
    }
    p.vx = approach(p.vx, target, accel * DT);
    if (dir !== 0) p.facing = dir;
  }

  // --- Vertical ------------------------------------------------------------------------------
  let maxFall = P.maxFallSpeed;
  let g = P.gravity;
  if (!p.grounded && downHeld && p.vy > 0 && !wallSliding) {
    g *= P.fastFallGravityMul;
    maxFall = P.fastFallSpeed;
  }
  p.vy += g * DT;
  if (p.vy > maxFall) p.vy = maxFall;
  if (wallSliding && p.vy > P.wallSlideSpeed) p.vy = P.wallSlideSpeed;

  // --- Déplacement ---------------------------------------------------------------------------
  const fallSpeed = p.vy;
  if (moveX(world, p, p.vx * DT)) p.vx = 0;
  const hit = moveY(world, p, p.vy * DT);
  if (hit === 1) p.vy = 0;
  else if (hit === -1) {
    p.vy = 0;
    p.jumping = false;
  }

  // --- Sol (après déplacement) et état -------------------------------------------------------
  const groundAfter = probeGround(world, p);
  p.groundMover = probeMover(world, p);
  p.grounded = groundAfter !== 0 || p.groundMover >= 0;
  if (!wasGrounded && p.grounded && fallSpeed > P.landEventSpeed)
    emit(world, SimEvent.LAND, slot, p.x, p.y);

  if (p.y > WORLD_H + FALL_MARGIN) {
    emit(world, SimEvent.FELL, slot, p.x, p.y);
    spawnPlayer(world, slot);
    return;
  }

  let state: number;
  if (p.grounded) {
    state = p.crouching ? PlayerState.CROUCH : dir !== 0 ? PlayerState.RUN : PlayerState.IDLE;
  } else if (wallSliding && wall !== 0) {
    state = PlayerState.WALL_SLIDE;
  } else {
    state = p.vy < 0 ? PlayerState.JUMP : PlayerState.FALL;
  }
  if (state !== p.state) {
    p.state = state;
    p.stateTicks = 0;
  } else if (p.stateTicks < 65535) {
    p.stateTicks++;
  }
}

/** Fait (ré)apparaître un joueur à un point d'apparition choisi de façon déterministe. */
export function spawnPlayer(world: World, slot: number): void {
  const p = world.players[slot];
  const idx = (slot + p.respawns * 3) % world.spawnCount;
  p.active = true;
  p.x = world.spawnX[idx]!;
  p.y = world.spawnY[idx]!;
  p.vx = 0;
  p.vy = 0;
  p.facing = p.x < WORLD_W / 2 ? 1 : -1;
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
  p.hp = 100;
  p.respawns = (p.respawns + 1) & 0xffff;
  emit(world, SimEvent.SPAWN, slot, p.x, p.y);
}

/** Ajoute un joueur dans l'emplacement `slot` (premier apparition). */
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
}

/** Hauteur courante de la boîte du joueur (debout ou accroupi). */
export function playerHeight(world: World, slot: number): number {
  return bodyHeight(world, world.players[slot]);
}
