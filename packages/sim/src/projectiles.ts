import {
  Cause,
  COMBAT,
  DT,
  MAX_PLAYERS,
  ObjType,
  ProjType,
  SimEvent,
  WeaponId,
  weaponDef,
} from '@stickyclaude/shared';
import { bodyHeight, raycastGrid, segmentBox } from './collision.ts';
import type { RayHit } from './collision.ts';
import { explode, HitFlag, isTeammate, queueHit } from './combat.ts';
import { breakCrate, damageObject, spawnWeaponObj } from './objects.ts';
import { eraseCell } from './terrain.ts';
import { emit, newUid } from './world.ts';
import type { Proj, World } from './world.ts';

/** Un projectile n'atteint pas son propre tireur pendant ses premiers ticks. */
const SELF_SAFE_TICKS = 8;
const HOMING_RANGE = 240;
const RADIUS = 3;

export function spawnProjectile(
  world: World,
  type: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  owner: number,
  weapon: number,
  ammo: number,
  life: number,
  bounces: number,
): Proj | null {
  for (let i = 0; i < world.projectiles.length; i++) {
    const p = world.projectiles[i]!;
    if (p.active) continue;
    p.active = true;
    p.uid = newUid(world);
    p.type = type;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.owner = owner;
    p.weapon = weapon;
    p.ammo = ammo;
    p.age = 0;
    p.life = life;
    p.bounces = bounces;
    p.hitMask = 0;
    return p;
  }
  return null;
}

const wall: RayHit = { dist: 0, cx: 0, cy: 0 };

function steer(world: World, p: Proj, maxTurn: number): void {
  let best = -1;
  let bestD = HOMING_RANGE;
  for (let v = 0; v < MAX_PLAYERS; v++) {
    if (v === p.owner) continue;
    const q = world.players[v]!;
    if (!q.active || q.dead || q.ghost) continue;
    if (isTeammate(world, p.owner, v)) continue;
    const d = Math.hypot(q.x - p.x, q.y - bodyHeight(world, q) * 0.5 - p.y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  if (best < 0) return;
  const q = world.players[best]!;
  const tx = q.x - p.x;
  const ty = q.y - bodyHeight(world, q) * 0.5 - p.y;
  const cur = Math.atan2(p.vy, p.vx);
  const want = Math.atan2(ty, tx);
  let diff = want - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const speed = Math.hypot(p.vx, p.vy);
  p.vx = Math.cos(cur + turn) * speed;
  p.vy = Math.sin(cur + turn) * speed;
}

function thrownDamage(p: Proj): number {
  if (p.weapon === WeaponId.CRATE) return COMBAT.crateThrowDamage;
  return p.ammo > 0 ? COMBAT.throwDamage : COMBAT.emptyThrowDamage;
}

/** Une arme lancée qui s'arrête : elle redevient un objet à ramasser (vide : elle disparaît). */
function settleThrown(world: World, p: Proj): void {
  p.active = false;
  if (p.weapon === WeaponId.CRATE) {
    emit(world, SimEvent.CRATE_BREAK, 0, p.x, p.y);
    return;
  }
  if (p.ammo > 0) spawnWeaponObj(world, p.weapon, p.ammo, p.x, p.y - 4, p.vx * 0.2, 0);
}

function endProjectile(world: World, p: Proj, hitX: number, hitY: number): void {
  p.active = false;
  if (p.type === ProjType.ROCKET) {
    const ex = weaponDef(WeaponId.BAZOOKA).explosion!;
    explode(world, hitX, hitY, ex, p.owner, Cause.EXPLOSION, 0);
  } else if (p.type === ProjType.THROWN) {
    p.x = hitX;
    p.y = hitY;
    settleThrown(world, p);
  }
}

/** Fait avancer tous les projectiles d'un pas (autorité). */
export function stepProjectiles(world: World): void {
  const hw = world.params.width * 0.5;
  for (let i = 0; i < world.projectiles.length; i++) {
    const p = world.projectiles[i]!;
    if (!p.active) continue;
    const def = weaponDef(p.weapon);
    p.age++;
    if (p.type === ProjType.PLANE) steer(world, p, def.homing * DT);
    if (p.type !== ProjType.PLANE) p.vy += (p.type === ProjType.THROWN ? world.params.gravity * 0.6 : def.gravity) * DT;
    if (p.type === ProjType.THROWN) p.vy = Math.min(p.vy, 600);

    const dx = p.vx * DT;
    const dy = p.vy * DT;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) continue;
    const ux = dx / dist;
    const uy = dy / dist;

    // Distance au décor.
    let wallDist = dist;
    let hitWall = false;
    if (raycastGrid(world, p.x, p.y, ux, uy, dist + RADIUS, wall)) {
      wallDist = Math.max(0, wall.dist - RADIUS);
      hitWall = wallDist <= dist;
    }
    const reach = hitWall ? wallDist : dist;

    // Joueur le plus proche sur le trajet.
    let bestT = 2;
    let bestPlayer = -1;
    for (let v = 0; v < MAX_PLAYERS; v++) {
      const q = world.players[v]!;
      if (!q.active || q.dead || q.ghost || q.invuln > 0) continue;
      if (v === p.owner && p.age < SELF_SAFE_TICKS) continue;
      if ((p.hitMask & (1 << v)) !== 0) continue;
      if (p.owner >= 0 && isTeammate(world, p.owner, v) && !world.rules.friendlyFire) continue;
      const h = bodyHeight(world, q);
      const t = segmentBox(
        p.x,
        p.y,
        p.x + ux * reach,
        p.y + uy * reach,
        q.x - hw - RADIUS,
        q.y - h - RADIUS,
        q.x + hw + RADIUS,
        q.y + RADIUS,
      );
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestPlayer = v;
      }
    }
    // Objets sur le trajet (caisses, ballons).
    let bestObj = -1;
    let bestObjT = bestPlayer >= 0 ? bestT : 2;
    if (p.type !== ProjType.THROWN || true) {
      for (let k = 0; k < world.objects.length; k++) {
        const o = world.objects[k]!;
        if (!o.active) continue;
        if (o.type !== ObjType.CRATE && o.type !== ObjType.BALLOON) continue;
        const t = segmentBox(
          p.x,
          p.y,
          p.x + ux * reach,
          p.y + uy * reach,
          o.x - o.w / 2 - RADIUS,
          o.y - o.h - RADIUS,
          o.x + o.w / 2 + RADIUS,
          o.y + RADIUS,
        );
        if (t >= 0 && t < bestObjT) {
          bestObjT = t;
          bestObj = k;
        }
      }
    }

    if (bestObj >= 0) {
      const o = world.objects[bestObj]!;
      const hx = p.x + ux * reach * bestObjT;
      const hy = p.y + uy * reach * bestObjT;
      if (p.type === ProjType.ROCKET) {
        endProjectile(world, p, hx, hy);
        continue;
      }
      if (p.type === ProjType.THROWN && p.weapon === WeaponId.CRATE) breakCrate(world, o);
      else damageObject(world, o, Math.max(6, def.damage), p.owner);
      if (p.type !== ProjType.ERASER) {
        endProjectile(world, p, hx, hy);
        continue;
      }
    }

    if (bestPlayer >= 0 && bestT <= 1) {
      const q = world.players[bestPlayer]!;
      const hx = p.x + ux * reach * bestT;
      const hy = p.y + uy * reach * bestT;
      const speed = Math.hypot(p.vx, p.vy);
      const front = (p.x - q.x) * q.facing >= -2;
      // Parade parfaite : les projectiles lents sont renvoyés.
      if (
        q.blockTicks > 0 &&
        q.blockTicks <= COMBAT.perfectParryTicks &&
        front &&
        speed <= COMBAT.reflectMaxSpeed &&
        p.type !== ProjType.ROCKET
      ) {
        p.vx = -p.vx * 1.2;
        p.vy = -p.vy * 1.2;
        p.owner = bestPlayer;
        p.hitMask = 0;
        p.age = 0;
        p.x = hx;
        p.y = hy;
        emit(world, SimEvent.BLOCKED, bestPlayer, q.x, q.y - 14, 255, 1);
        continue;
      }
      if (p.type === ProjType.ROCKET) {
        endProjectile(world, p, hx, hy);
        continue;
      }
      let damage = def.damage;
      let kbx = def.kbx;
      let kby = def.kby;
      let flags: number = HitFlag.RANGED;
      let cause: number = Cause.PROJECTILE;
      if (p.type === ProjType.THROWN) {
        damage = thrownDamage(p);
        kbx = COMBAT.throwKb;
        kby = -120;
        flags = 0;
        cause = Cause.THROWN;
      }
      const dir = p.vx >= 0 ? 1 : -1;
      queueHit(world, bestPlayer, p.owner, damage, dir * kbx, kby, def.stun, cause, flags, p.x, p.y);
      p.hitMask |= 1 << bestPlayer;
      if (p.type === ProjType.ERASER) {
        p.x = hx;
        p.y = hy;
        // la gomme continue de rebondir
      } else {
        endProjectile(world, p, hx, hy);
        continue;
      }
    }

    if (hitWall) {
      const hx = p.x + ux * wallDist;
      const hy = p.y + uy * wallDist;
      if (p.type === ProjType.ROCKET || p.type === ProjType.PLANE) {
        endProjectile(world, p, hx, hy);
        continue;
      }
      if (p.type === ProjType.THROWN) {
        p.vx *= 0.3;
        endProjectile(world, p, hx - ux * 2, hy - uy * 2);
        continue;
      }
      if (p.type === ProjType.ERASER) {
        eraseCell(world, hx + ux * (RADIUS + 2), hy + uy * (RADIUS + 2));
      }
      // Rebond : la composante dominante est inversée.
      p.bounces--;
      if (p.bounces < 0) {
        p.active = false;
        continue;
      }
      const e = def.restitution;
      p.x = hx;
      p.y = hy;
      if (Math.abs(ux) > Math.abs(uy)) p.vx = -p.vx * e;
      else p.vy = -p.vy * e;
      continue;
    }

    p.x += dx;
    p.y += dy;
    p.life--;
    if (p.life <= 0) {
      if (p.type === ProjType.ROCKET) endProjectile(world, p, p.x, p.y);
      else if (p.type === ProjType.THROWN) endProjectile(world, p, p.x, p.y);
      else p.active = false;
      continue;
    }
    if (p.y > world.arena.size[1] * 16 + 64 || p.y < -128 || p.x < -64 || p.x > world.arena.size[0] * 16 + 64) {
      p.active = false;
    }
  }
}
