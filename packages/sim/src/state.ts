import {
  AtkPhase,
  AttackKind,
  MOVER_MASK,
  MOVER_SHIFT,
  ObjType,
  OwnFlag,
  PlayerFlag,
  PlayerState,
  StatusFlag,
  WeaponId,
  WeaponKind,
  weaponDef,
  MAX_PLAYERS,
} from '@stickyclaude/shared';
import type { GameSnap, ObjSnap, OwnState, PlayerSnap, ProjSnap } from '@stickyclaude/shared';
import { exportModeData } from './game.ts';
import type { World } from './world.ts';

/** Écrit l'état exact de prédiction d'un joueur (envoyé à son propriétaire, voir snapshot). */
export function exportOwn(world: World, slot: number, out: OwnState): void {
  const p = world.players[slot];
  out.x = p.x;
  out.y = p.y;
  out.vx = p.vx;
  out.vy = p.vy;
  out.grappleX = p.grappleX;
  out.grappleY = p.grappleY;
  out.ghostX = p.ghostX;
  out.ghostY = p.ghostY;
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
  out.hp = p.hp;
  out.weapon = p.weapon;
  out.ammo = p.ammo;
  out.stun = p.stun;
  out.hitLock = p.hitLock;
  out.invuln = p.invuln > 255 ? 255 : p.invuln;
  out.atkPhase = p.atkPhase;
  out.atkKind = p.atkKind;
  out.atkTicks = p.atkTicks > 255 ? 255 : p.atkTicks;
  out.combo = p.combo;
  out.comboWindow = p.comboWindow;
  out.chargeTicks = p.chargeTicks;
  out.attackHeld = p.attackHeld;
  out.blockTicks = p.blockTicks;
  out.blockCd = p.blockCd;
  out.atkBuffer = p.atkBuffer;
  out.pickupCd = p.pickupCd;
  out.aim = p.aim;
  out.grappleTicks = p.grappleTicks;
  out.status =
    (p.ghost ? StatusFlag.GHOST : 0) |
    (p.dead ? StatusFlag.DEAD : 0) |
    (p.hasBomb ? StatusFlag.HAS_BOMB : 0) |
    (p.kicking ? StatusFlag.KICKING : 0);
  out.stunImmune = p.stunImmune;
  out.dashTicks = p.dashTicks;
  out.dashCd = p.dashCd;
  out.prevInput = p.prevInput;
  out.respawns = p.respawns;
  out.respawnTimer = p.respawnTimer > 65535 ? 65535 : p.respawnTimer;
  out.ghostCd = p.ghostCd > 65535 ? 65535 : p.ghostCd;
}

/** Restaure l'état d'un joueur depuis un état exact (réconciliation côté client). */
export function importOwn(world: World, slot: number, o: OwnState): void {
  const p = world.players[slot];
  p.active = true;
  p.x = o.x;
  p.y = o.y;
  p.vx = o.vx;
  p.vy = o.vy;
  p.grappleX = o.grappleX;
  p.grappleY = o.grappleY;
  p.ghostX = o.ghostX;
  p.ghostY = o.ghostY;
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
  p.hp = o.hp;
  p.weapon = o.weapon;
  p.ammo = o.ammo;
  p.stun = o.stun;
  p.hitLock = o.hitLock;
  p.invuln = o.invuln;
  p.atkPhase = o.atkPhase;
  p.atkKind = o.atkKind;
  p.atkTicks = o.atkTicks;
  p.combo = o.combo;
  p.comboWindow = o.comboWindow;
  p.chargeTicks = o.chargeTicks;
  p.attackHeld = o.attackHeld;
  p.blockTicks = o.blockTicks;
  p.blockCd = o.blockCd;
  p.atkBuffer = o.atkBuffer;
  p.pickupCd = o.pickupCd;
  p.aim = o.aim;
  p.grappleTicks = o.grappleTicks;
  p.ghost = (o.status & StatusFlag.GHOST) !== 0;
  p.dead = (o.status & StatusFlag.DEAD) !== 0;
  p.hasBomb = (o.status & StatusFlag.HAS_BOMB) !== 0;
  p.kicking = (o.status & StatusFlag.KICKING) !== 0;
  p.stunImmune = o.stunImmune;
  p.dashTicks = o.dashTicks;
  p.dashCd = o.dashCd;
  p.prevInput = o.prevInput;
  p.respawns = o.respawns;
  p.respawnTimer = o.respawnTimer;
  p.ghostCd = o.ghostCd;
  p.wantFire = false;
  p.wantThrow = false;
  p.wantPickup = false;
  p.wantDrop = false;
}

/** Remplit l'entrée de snapshot d'un joueur (valeurs en flottants, quantifiées à l'encodage). */
export function fillPlayerSnap(world: World, slot: number, out: PlayerSnap): void {
  const p = world.players[slot];
  out.slot = slot;
  const alive = !p.dead && !p.ghost;
  out.flags =
    (alive ? PlayerFlag.ALIVE : 0) |
    (p.facing > 0 ? PlayerFlag.FACING_RIGHT : 0) |
    (p.grounded ? PlayerFlag.GROUNDED : 0) |
    (p.crouching ? PlayerFlag.CROUCHING : 0) |
    (p.state === PlayerState.WALL_SLIDE ? PlayerFlag.WALL_SLIDING : 0) |
    (p.doubleAvailable ? 0 : PlayerFlag.DOUBLE_JUMP_USED) |
    (p.vy < 0 ? PlayerFlag.RISING : 0) |
    (p.groundMover >= 0 ? PlayerFlag.ON_MOVER | ((p.groundMover & MOVER_MASK) << MOVER_SHIFT) : 0) |
    (p.hitLock > 0 ? PlayerFlag.HIT_FLASH : 0) |
    (p.invuln > 0 ? PlayerFlag.INVULN : 0) |
    (p.hasBomb ? PlayerFlag.HAS_BOMB : 0) |
    (p.weapon === WeaponId.SHARPENER_SHIELD && p.ammo > 0 ? PlayerFlag.SHIELD_UP : 0);
  if (p.ghost) {
    out.x = p.ghostX;
    out.y = p.ghostY;
    out.vx = 0;
    out.vy = 0;
  } else {
    out.x = p.x;
    out.y = p.y;
    out.vx = p.vx;
    out.vy = p.vy;
  }
  out.aim = p.aim;
  out.hp = p.hp;
  out.weapon = p.weapon;
  out.ammo = p.ammo;
  let anim: number = p.state;
  if (p.ghost) anim = PlayerState.GHOST;
  else if (p.dead) anim = PlayerState.DEAD;
  out.anim = anim;
  let prog = p.stateTicks;
  let variant = 0;
  if (anim === PlayerState.ATTACK) {
    variant = (p.atkKind & 15) | (p.atkPhase << 4);
    prog = p.atkTicks;
  } else if (anim === PlayerState.CHARGE) {
    variant = p.chargeTicks;
  } else if (anim === PlayerState.BLOCK) {
    prog = p.blockTicks;
  }
  out.animProg = prog > 255 ? 255 : prog;
  out.variant = variant;
}

/**
 * Remplit la liste d'objets d'un snapshot pour le joueur `viewer` (-1 : spectateur, voit tout).
 * Les mines armées de l'équipe adverse sont invisibles. Retourne le nombre d'objets.
 */
export function fillObjects(world: World, objects: ObjSnap[], viewer: number): number {
  let n = 0;
  const viewerTeam = viewer >= 0 ? world.team[viewer] : -1;
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i];
    if (!o.active) continue;
    if (o.type === ObjType.MINE && o.b === 1 && viewer >= 0 && o.team !== viewerTeam) continue;
    const s = objects[n++];
    s.uid = o.uid;
    s.type = o.type;
    s.x = o.x;
    s.y = o.y;
    s.vx = o.vx;
    s.vy = o.vy;
    if (o.type === ObjType.MINE) {
      s.a = o.b;
      s.b = o.team < 0 ? 255 : o.team;
    } else {
      s.a = Math.max(0, Math.min(255, Math.round(o.a)));
      s.b = Math.max(0, Math.min(255, Math.round(o.b)));
    }
  }
  return n;
}

/** Vrai si une mine armée existe : les snapshots doivent alors être filtrés par destinataire. */
export function hasHiddenMines(world: World): boolean {
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i];
    if (o.active && o.type === ObjType.MINE && o.b === 1) return true;
  }
  return false;
}

export function fillProjectiles(world: World, out: ProjSnap[]): number {
  let n = 0;
  for (let i = 0; i < world.projectiles.length; i++) {
    const p = world.projectiles[i];
    if (!p.active) continue;
    const s = out[n++];
    s.uid = p.uid;
    s.type = p.type;
    s.x = p.x;
    s.y = p.y;
    s.vx = p.vx;
    s.vy = p.vy;
    s.owner = p.owner < 0 ? 255 : p.owner;
    s.a = p.weapon;
  }
  return n;
}

export function fillGameSnap(world: World, out: GameSnap): void {
  const g = world.game;
  out.phase = g.phase;
  out.phaseTick = g.phaseTick > 65535 ? 65535 : g.phaseTick;
  out.round = g.round;
  out.mode = g.mode;
  out.modeCount = exportModeData(world, out.modeData);
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
  const g = world.game;
  h = mix(h, g.phase);
  h = mix(h, g.phaseTick);
  h = mix(h, g.round);
  h = mix(h, g.mode);
  h = mix(h, g.roundTick);
  h = mix(h, g.weaponTimer);
  h = mix(h, g.healTimer);
  for (let i = 0; i < MAX_PLAYERS; i++) h = mix(h, g.scores[i] & 0xffff);
  for (let i = 0; i < 8; i++) h = mix(h, g.modeData[i] >>> 0);
  h = mixF(h, g.inkY);
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
        (p.jumping ? 8 : 0) |
        (p.ghost ? 16 : 0) |
        (p.dead ? 32 : 0) |
        (p.hasBomb ? 64 : 0) |
        (p.kicking ? 128 : 0),
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
    h = mix(h, p.weapon);
    h = mix(h, p.ammo);
    h = mix(h, p.stun);
    h = mix(h, p.hitLock);
    h = mix(h, p.invuln);
    h = mix(h, p.atkPhase | (p.atkKind << 4));
    h = mix(h, p.atkTicks);
    h = mix(h, p.combo | (p.comboWindow << 8));
    h = mix(h, p.chargeTicks | (p.attackHeld << 8));
    h = mix(h, p.blockTicks | (p.blockCd << 8));
    h = mix(h, p.pickupCd | (p.aim << 8));
    h = mix(h, p.dashTicks | (p.dashCd << 8));
    h = mix(h, p.grappleTicks);
    h = mixF(h, p.grappleX);
    h = mixF(h, p.grappleY);
    h = mixF(h, p.ghostX);
    h = mixF(h, p.ghostY);
    h = mix(h, p.ghostCd);
    h = mix(h, p.respawnTimer);
  }
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i];
    if (!o.active) continue;
    h = mix(h, o.uid);
    h = mix(h, o.type);
    h = mixF(h, o.x);
    h = mixF(h, o.y);
    h = mixF(h, o.vx);
    h = mixF(h, o.vy);
    h = mix(h, (o.a | 0) & 0xffff);
    h = mix(h, (o.b | 0) & 0xffff);
    h = mix(h, o.life);
  }
  for (let i = 0; i < world.projectiles.length; i++) {
    const p = world.projectiles[i];
    if (!p.active) continue;
    h = mix(h, p.uid);
    h = mixF(h, p.x);
    h = mixF(h, p.y);
    h = mixF(h, p.vx);
    h = mixF(h, p.vy);
    h = mix(h, p.life);
  }
  const cells = world.cells;
  for (let i = 0; i < cells.length; i++) h = mix(h, cells[i]);
  return h >>> 0;
}

export { AtkPhase, AttackKind, WeaponKind, weaponDef };
