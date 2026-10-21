import {
  AIM_DX,
  AIM_DY,
  COMBAT,
  Cause,
  MAX_PLAYERS,
  ObjType,
  ProjType,
  SimEvent,
  WeaponId,
  WeaponKind,
  weaponDef,
} from '@stickyclaude/shared';
import { bodyHeight, raycastGrid } from './collision.ts';
import type { RayHit } from './collision.ts';
import {
  aimDir,
  assistAim,
  HitFlag,
  queueHit,
  trace,
  traceRay,
} from './combat.ts';
import { damageObject, dropWeapon, spawnObj, spawnWeaponObj } from './objects.ts';
import { spawnProjectile } from './projectiles.ts';
import { emit } from './world.ts';
import type { Player, World } from './world.ts';

const grapple: RayHit = { dist: 0, cx: 0, cy: 0 };
const pelletHits = new Int32Array(MAX_PLAYERS);
const pelletAngles = new Float64Array(8);

function muzzle(world: World, p: Player, ux: number, uy: number, out: { x: number; y: number }): void {
  out.x = p.x + ux * 9;
  out.y = p.y - bodyHeight(world, p) * 0.6 + uy * 9;
}
const mz = { x: 0, y: 0 };

/** Tir de l'arme tenue (une fois par utilisation, au premier tick actif). */
export function fire(world: World, p: Player, slot: number): void {
  const w = weaponDef(p.weapon);
  if (w.kind === WeaponKind.HITSCAN || w.kind === WeaponKind.GRAPPLE) {
    assistAim(world, slot, w.reach, p.rewind);
  } else {
    assistAim(world, slot, 400, p.rewind);
  }
  const ux = aimDir.x;
  const uy = aimDir.y;
  muzzle(world, p, ux, uy, mz);

  switch (w.kind) {
    case WeaponKind.HITSCAN: {
      const n = Math.max(1, w.pellets);
      pelletHits.fill(0);
      let farX = mz.x;
      let farY = mz.y;
      const base = Math.atan2(uy, ux);
      for (let k = 0; k < n; k++) {
        const off = n > 1 ? (k / (n - 1) - 0.5) * w.spread : 0;
        pelletAngles[k] = base + off;
        const dx = Math.cos(base + off);
        const dy = Math.sin(base + off);
        traceRay(world, slot, mz.x, mz.y, dx, dy, w.reach, p.rewind);
        if (trace.kind === 2) pelletHits[trace.slot]!++;
        else if (trace.kind === 3 && trace.obj) damageObject(world, trace.obj, w.damage, slot);
        farX = mz.x + dx * trace.dist;
        farY = mz.y + dy * trace.dist;
      }
      emit(world, SimEvent.SHOT, slot, mz.x, mz.y, farX, farY, w.id);
      for (let v = 0; v < MAX_PLAYERS; v++) {
        const c = pelletHits[v]!;
        if (c === 0) continue;
        const dir = ux >= 0 ? 1 : -1;
        queueHit(
          world,
          v,
          slot,
          w.damage * c,
          dir * w.kbx * (0.6 + 0.4 * c),
          w.kby,
          0,
          Cause.BULLET,
          HitFlag.RANGED,
          mz.x,
          mz.y,
        );
      }
      break;
    }
    case WeaponKind.PROJECTILE: {
      spawnProjectile(
        world,
        w.proj,
        mz.x,
        mz.y,
        ux * w.speed,
        uy * w.speed,
        slot,
        w.id,
        0,
        w.life,
        w.bounces,
      );
      emit(world, SimEvent.SHOT, slot, mz.x, mz.y, mz.x + ux * 8, mz.y + uy * 8, w.id);
      break;
    }
    case WeaponKind.MINE: {
      const m = spawnObj(world, ObjType.MINE, p.x, p.y, 12, 6, 0, 0);
      if (m) {
        m.owner = slot;
        m.team = world.team[slot]!;
      }
      emit(world, SimEvent.SHOT, slot, p.x, p.y, p.x, p.y, w.id);
      break;
    }
    case WeaponKind.GRAPPLE: {
      traceRay(world, slot, mz.x, mz.y, ux, uy, w.reach, p.rewind);
      emit(world, SimEvent.SHOT, slot, mz.x, mz.y, mz.x + ux * trace.dist, mz.y + uy * trace.dist, w.id);
      if (trace.kind === 2) {
        const v = world.players[trace.slot]!;
        v.grappleTicks = w.pullTicks;
        v.grappleX = p.x;
        v.grappleY = p.y - bodyHeight(world, p) * 0.5;
        queueHit(world, trace.slot, slot, w.damage, 0, 0, 0, Cause.PROJECTILE, HitFlag.RANGED, mz.x, mz.y);
        emit(world, SimEvent.GRAPPLE, slot, v.x, v.y - 14, trace.slot);
      } else if (trace.kind === 1) {
        // Ancrage au décor : le joueur est tiré vers le point d'impact.
        if (raycastGrid(world, mz.x, mz.y, ux, uy, w.reach, grapple)) {
          p.grappleTicks = w.pullTicks;
          p.grappleX = mz.x + ux * (grapple.dist - 4);
          p.grappleY = mz.y + uy * (grapple.dist - 4);
          emit(world, SimEvent.GRAPPLE, slot, p.grappleX, p.grappleY, 255);
        }
      } else if (trace.kind === 3 && trace.obj) {
        damageObject(world, trace.obj, w.damage, slot);
      }
      break;
    }
    default:
      break;
  }
}

/** Lance l'arme (ou la caisse) qui vient de quitter la main du joueur. */
export function throwHeld(world: World, p: Player, slot: number): void {
  const wid = p.throwW;
  if (wid === WeaponId.NONE) return;
  const dx = AIM_DX[p.aim]!;
  const dy = AIM_DY[p.aim]!;
  const n = Math.hypot(dx, dy);
  const ux = dx / n;
  const uy = dy / n;
  muzzle(world, p, ux, uy, mz);
  spawnProjectile(
    world,
    ProjType.THROWN,
    mz.x,
    mz.y,
    ux * COMBAT.throwSpeed + p.vx * 0.4,
    uy * COMBAT.throwSpeed - COMBAT.throwUp,
    slot,
    wid,
    p.throwA,
    90,
    0,
  );
  emit(world, SimEvent.THROW, slot, wid, 0);
  p.throwW = 0;
  p.throwA = 0;
}

/** Ramasse l'objet à portée, ou lance l'arme tenue s'il n'y en a pas. */
export function pickupOrThrow(world: World, p: Player, slot: number): void {
  const hw = world.params.width * 0.5 + COMBAT.pickupReach;
  const h = bodyHeight(world, p);
  let best: number = -1;
  let bestD = Infinity;
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i]!;
    if (!o.active) continue;
    if (o.type !== ObjType.WEAPON && o.type !== ObjType.CRATE) continue;
    if (o.x + o.w / 2 < p.x - hw || o.x - o.w / 2 > p.x + hw) continue;
    if (o.y < p.y - h - COMBAT.pickupReach || o.y - o.h > p.y + 4) continue;
    const d = Math.abs(o.x - p.x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best >= 0) {
    const o = world.objects[best]!;
    if (p.weapon !== WeaponId.NONE) dropWeapon(world, p, slot);
    p.weapon = o.type === ObjType.CRATE ? WeaponId.CRATE : o.a;
    p.ammo = o.type === ObjType.CRATE ? 1 : o.b;
    o.active = false;
    emit(world, SimEvent.PICKUP, slot, p.weapon, p.ammo, o.uid);
    return;
  }
  if (p.weapon !== WeaponId.NONE) {
    p.throwW = p.weapon;
    p.throwA = p.ammo;
    p.weapon = 0;
    p.ammo = 0;
    throwHeld(world, p, slot);
  }
}

/** Résout les demandes d'actions du tick (tir, lancer, ramassage, lâcher) : autorité seulement. */
export function resolveActions(world: World): void {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s]!;
    if (!p.active) continue;
    if (p.dead || p.ghost) {
      p.wantFire = p.wantThrow = p.wantPickup = p.wantDrop = false;
      continue;
    }
    if (p.wantFire) {
      p.wantFire = false;
      fire(world, p, s);
    }
    if (p.wantThrow) {
      p.wantThrow = false;
      throwHeld(world, p, s);
    }
    if (p.wantDrop) {
      p.wantDrop = false;
      dropWeapon(world, p, s);
    }
    if (p.wantPickup) {
      p.wantPickup = false;
      pickupOrThrow(world, p, s);
    }
  }
}

export { spawnWeaponObj };
