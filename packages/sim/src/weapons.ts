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
  weaponChargeLevel,
  weaponDef,
} from '@stickyclaude/shared';
import type { WeaponDef } from '@stickyclaude/shared';
import { bodyHeight, raycastGrid, segmentBox } from './collision.ts';
import type { RayHit } from './collision.ts';
import { aimDir, assistAim, HitFlag, isTeammate, queueHit, trace, traceRay } from './combat.ts';
import {
  COVER_HP,
  COVER_LIFE_TICKS,
  COVER_H,
  COVER_W,
  TAPE_H,
  TAPE_LIFE_TICKS,
  TAPE_W,
  damageObject,
  dropWeapon,
  spawnObj,
  spawnWeaponObj,
} from './objects.ts';
import { spawnProjectile } from './projectiles.ts';
import { emit } from './world.ts';
import type { Player, World } from './world.ts';

const wallRay: RayHit = { dist: 0, cx: 0, cy: 0 };
const pelletHits = new Int32Array(MAX_PLAYERS);

/** Position de l'épaule dans le dessin du squelette (par rapport aux pieds). */
const SHOULDER_Y = 17.8;
const SHOULDER_Y_CROUCH = 10.4;
const SHOULDER_X = 1.6;
/** Le bras tendu avance la poignée de cette distance avant le bout de l'arme. */
const ARM_REACH = 8;

/**
 * Bout du canon : l'épaule, plus le bras tendu, plus la longueur de l'arme dessinée (`tip`), le
 * long de la visée. Si un mur se trouve entre l'épaule et le bout, le tir part du mur.
 */
function muzzle(
  world: World,
  p: Player,
  slot: number,
  w: WeaponDef,
  ux: number,
  uy: number,
  out: { x: number; y: number },
): void {
  const sx = p.x + p.facing * SHOULDER_X;
  const sy = p.y - (p.crouching ? SHOULDER_Y_CROUCH : SHOULDER_Y);
  let len = ARM_REACH + w.tip;
  if (raycastGrid(world, sx, sy, ux, uy, len, wallRay)) len = Math.max(0, wallRay.dist - 1);
  // Un adversaire collé à soi : le tir part juste devant lui, sinon le bout du canon le dépasse.
  const hw = world.params.width * 0.5;
  let near = 1;
  for (let v = 0; v < MAX_PLAYERS; v++) {
    const q = world.players[v];
    if (v === slot || !q.active || q.dead || q.ghost || isTeammate(world, slot, v)) continue;
    const t = segmentBox(
      sx,
      sy,
      sx + ux * len,
      sy + uy * len,
      q.x - hw - 2,
      q.y - bodyHeight(world, q) - 2,
      q.x + hw + 2,
      q.y + 2,
    );
    if (t >= 0 && t < near) near = t;
  }
  len *= near;
  out.x = sx + ux * len;
  out.y = sy + uy * len;
}
const mz = { x: 0, y: 0 };

/** Variation de vitesse (déterministe) entre les éclats d'une même salve. */
function speedVariation(k: number): number {
  return 0.86 + 0.14 * (((k * 5) % 7) / 6);
}

/** Tir de l'arme tenue (une fois par utilisation, au premier tick actif). */
export function fire(world: World, p: Player, slot: number): void {
  const w = weaponDef(p.weapon);
  if (w.kind === WeaponKind.HITSCAN || w.kind === WeaponKind.GRAPPLE) {
    assistAim(world, slot, Math.min(w.reach, 700), p.rewind);
  } else {
    assistAim(world, slot, 400, p.rewind);
  }
  const ux = aimDir.x;
  const uy = aimDir.y;
  muzzle(world, p, slot, w, ux, uy, mz);

  switch (w.kind) {
    case WeaponKind.HITSCAN: {
      const n = Math.max(1, w.pellets);
      pelletHits.fill(0);
      let farX = mz.x;
      let farY = mz.y;
      const base = Math.atan2(uy, ux);
      for (let k = 0; k < n; k++) {
        const off = n > 1 ? (k / (n - 1) - 0.5) * w.spread : 0;
        const dx = Math.cos(base + off);
        const dy = Math.sin(base + off);
        traceRay(world, slot, mz.x, mz.y, dx, dy, w.reach, p.rewind);
        if (trace.kind === 2) pelletHits[trace.slot]++;
        else if (trace.kind === 3 && trace.obj) damageObject(world, trace.obj, w.damage, slot);
        farX = mz.x + dx * trace.dist;
        farY = mz.y + dy * trace.dist;
      }
      emit(world, SimEvent.SHOT, slot, mz.x, mz.y, farX, farY, w.id);
      for (let v = 0; v < MAX_PLAYERS; v++) {
        const c = pelletHits[v];
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
          HitFlag.RANGED | (w.light ? HitFlag.LIGHT : 0),
          mz.x,
          mz.y,
        );
      }
      break;
    }
    case WeaponKind.PROJECTILE:
    case WeaponKind.BOW: {
      const n = Math.max(1, w.pellets);
      const base = Math.atan2(uy, ux);
      // Arc : la tension de la corde donne vitesse et dégâts.
      const lvl = w.kind === WeaponKind.BOW ? weaponChargeLevel(w, p.chargeTicks) : 0;
      let speed = w.speed * (1 + 1.3 * lvl);
      let lift = 0;
      let inherit = 0;
      if (w.proj === ProjType.GRENADE) {
        lift = 90;
        inherit = 0.5;
      }
      for (let k = 0; k < n; k++) {
        const off = n > 1 ? (k / (n - 1) - 0.5) * w.spread : 0;
        const dx = Math.cos(base + off);
        const dy = Math.sin(base + off);
        if (n > 3) speed = w.speed * speedVariation(k);
        spawnProjectile(
          world,
          w.proj,
          mz.x,
          mz.y,
          dx * speed + p.vx * inherit,
          dy * speed - lift,
          slot,
          w.id,
          Math.round(lvl * 100),
          w.life,
          w.bounces,
        );
      }
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
    case WeaponKind.TRAP: {
      const tape = w.trap === ObjType.TAPE;
      const hw = world.params.width * 0.5;
      const x = p.x + p.facing * (tape ? TAPE_W * 0.5 + hw : COVER_W + hw + 4);
      const o = tape
        ? spawnObj(world, w.trap, x, p.y, TAPE_W, TAPE_H, 0, 0)
        : spawnObj(world, w.trap, x, p.y, COVER_W, COVER_H, COVER_HP, 0);
      if (o) {
        o.owner = slot;
        o.team = world.team[slot]!;
        o.life = tape ? TAPE_LIFE_TICKS : COVER_LIFE_TICKS;
      }
      emit(world, SimEvent.SHOT, slot, p.x, p.y, x, p.y, w.id);
      break;
    }
    case WeaponKind.HEAL: {
      const gained = Math.min(w.heal, COMBAT.maxHp - p.hp);
      p.hp += gained;
      emit(world, SimEvent.HEAL, slot, p.x, p.y - 14, gained);
      if (p.ammo === 0) p.weapon = WeaponId.NONE;
      break;
    }
    case WeaponKind.GRAPPLE: {
      // Un seul crochet à la fois par tireur.
      for (let i = 0; i < world.projectiles.length; i++) {
        const h = world.projectiles[i];
        if (h.active && h.type === ProjType.HOOK && h.owner === slot) h.active = false;
      }
      spawnProjectile(
        world,
        ProjType.HOOK,
        mz.x,
        mz.y,
        ux * w.speed,
        uy * w.speed,
        slot,
        w.id,
        0,
        w.life,
        0,
      );
      emit(world, SimEvent.SHOT, slot, mz.x, mz.y, mz.x + ux * 10, mz.y + uy * 10, w.id);
      // Le grappin est à usage limité : il disparaît de la main une fois la dernière charge utilisée.
      if (p.ammo === 0) p.weapon = WeaponId.NONE;
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
  const lvl = p.throwLevel;
  p.throwLevel = 0;
  const dx = AIM_DX[p.aim];
  const dy = AIM_DY[p.aim];
  const n = Math.hypot(dx, dy);
  const ux = dx / n;
  const uy = dy / n;
  muzzle(world, p, slot, weaponDef(WeaponId.NONE), ux, uy, mz);
  spawnProjectile(
    world,
    ProjType.THROWN,
    mz.x,
    mz.y,
    ux * COMBAT.throwSpeed * (1 + 1.1 * lvl) + p.vx * 0.4,
    uy * COMBAT.throwSpeed * (1 + 1.1 * lvl) - COMBAT.throwUp * (1 + 0.3 * lvl),
    slot,
    wid,
    p.throwA,
    90,
    // la charge (en %) voyage dans le champ des rebonds, inutile pour une arme lancée
    Math.round(lvl * 100),
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
    const o = world.objects[i];
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
    const o = world.objects[best];
    if (p.weapon !== WeaponId.NONE) dropWeapon(world, p, slot);
    p.chargeTicks = 0;
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
    const p = world.players[s];
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
