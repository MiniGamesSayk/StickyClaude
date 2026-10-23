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
/** Le boomerang fait demi-tour après ce nombre de ticks. */
const BOOMERANG_TURN_TICKS = 38;
/** Éclats du fusil à pompe : ce que la même salve inflige à une même cible dans un tick. */
const shrapDamage = new Float64Array(MAX_PLAYERS);
const shrapCount = new Int32Array(MAX_PLAYERS);
const shrapOwner = new Int32Array(MAX_PLAYERS);
const shrapDir = new Int8Array(MAX_PLAYERS);
const shrapX = new Float64Array(MAX_PLAYERS);
const shrapY = new Float64Array(MAX_PLAYERS);

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
    const p = world.projectiles[i];
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
    const q = world.players[v];
    if (!q.active || q.dead || q.ghost) continue;
    if (isTeammate(world, p.owner, v)) continue;
    const d = Math.hypot(q.x - p.x, q.y - bodyHeight(world, q) * 0.5 - p.y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  if (best < 0) return;
  const q = world.players[best];
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
  const base =
    p.weapon === WeaponId.CRATE
      ? COMBAT.crateThrowDamage
      : p.ammo > 0
        ? COMBAT.throwDamage
        : COMBAT.emptyThrowDamage;
  return base * (1 + 1.5 * (p.bounces / 100));
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
  } else if (p.type === ProjType.GRENADE) {
    const ex = weaponDef(WeaponId.INK_GRENADE).explosion!;
    explode(world, hitX, hitY, ex, p.owner, Cause.EXPLOSION, 0);
  } else if (p.type === ProjType.THROWN) {
    p.x = hitX;
    p.y = hitY;
    settleThrown(world, p);
  }
}

/** Le boomerang revient dans la main de son lanceur, ou tombe au sol s'il ne peut plus la reprendre. */
function catchBoomerang(world: World, p: Proj): void {
  p.active = false;
  const o = p.owner >= 0 ? world.players[p.owner] : null;
  const def = weaponDef(WeaponId.BOOMERANG);
  if (o && o.active && !o.dead && !o.ghost) {
    if (o.weapon === WeaponId.BOOMERANG && o.ammo < def.ammo) {
      o.ammo++;
      return;
    }
    if (o.weapon === WeaponId.NONE) {
      o.weapon = WeaponId.BOOMERANG;
      o.ammo = 1;
      emit(world, SimEvent.PICKUP, p.owner, o.weapon, o.ammo, 0);
      return;
    }
  }
  spawnWeaponObj(world, WeaponId.BOOMERANG, 1, p.x, p.y - 4, 0, -60);
}

/** Dégâts d'un éclat selon la distance parcourue. */
function shrapnelDamage(p: Proj): number {
  const def = weaponDef(p.weapon);
  const left = def.life > 0 ? Math.max(0, Math.min(1, p.life / def.life)) : 1;
  return def.damage * (1 - (1 - def.falloff) * (1 - left));
}

// --- Crochet du grappin ------------------------------------------------------------------------

/** Objets que le crochet ramène vers son tireur. */
function reelable(type: number): boolean {
  return (
    type === ObjType.WEAPON ||
    type === ObjType.CRATE ||
    type === ObjType.BALL ||
    type === ObjType.HEART
  );
}

function hookAnchor(world: World, p: Proj, ownerSlot: number, ax: number, ay: number): void {
  const def = weaponDef(WeaponId.GRAPPLE);
  const o = world.players[ownerSlot];
  p.active = false;
  o.grappleTicks = def.pullTicks;
  o.grappleX = ax;
  o.grappleY = ay;
  o.dashTicks = 0;
  o.dodging = false;
  emit(world, SimEvent.GRAPPLE, ownerSlot, ax, ay, 255);
}

/** Le crochet vole, s'accroche au décor (plateformes comprises), saisit un joueur ou un objet. */
function stepHook(world: World, p: Proj): void {
  const def = weaponDef(WeaponId.GRAPPLE);
  const ownerSlot = p.owner;
  const o = ownerSlot >= 0 ? world.players[ownerSlot] : null;
  if (!o || !o.active || o.dead || o.ghost) {
    p.active = false;
    return;
  }
  p.age++;

  // Mode ramenage : le crochet revient en tirant l'objet saisi.
  if (p.bounces === 1) {
    let obj = null;
    for (let k = 0; k < world.objects.length; k++) {
      const c = world.objects[k];
      if (c.active && c.uid === p.hitMask) {
        obj = c;
        break;
      }
    }
    const tx = o.x - p.x;
    const ty = o.y - bodyHeight(world, o) * 0.5 - p.y;
    const d = Math.hypot(tx, ty);
    if (!obj || d < 16 || --p.life <= 0) {
      if (obj) {
        obj.x = o.x + o.facing * 10;
        obj.y = o.y;
        obj.vx = 0;
        obj.vy = -40;
      }
      p.active = false;
      return;
    }
    const step = Math.min(d, 640 * DT);
    const ux = tx / d;
    const uy = ty / d;
    if (raycastGrid(world, p.x, p.y, ux, uy, step + 2, wall)) {
      if (obj) obj.vy = -40;
      p.active = false;
      return;
    }
    p.x += ux * step;
    p.y += uy * step;
    p.vx = ux * 640;
    p.vy = uy * 640;
    obj.x = p.x;
    obj.y = p.y + obj.h / 2;
    obj.vx = 0;
    obj.vy = 0;
    return;
  }

  const dist = Math.hypot(p.vx, p.vy) * DT;
  const ux = p.vx / (dist / DT);
  const uy = p.vy / (dist / DT);
  let bestT = 2;
  let kind = 0; // 1 décor, 2 joueur, 3 objet
  let which = -1;
  // Décor : le crochet s'accroche aussi aux plateformes à sens unique.
  if (raycastGrid(world, p.x, p.y, ux, uy, dist, wall, true)) {
    bestT = wall.dist / dist;
    kind = 1;
  }
  // Plateformes mobiles.
  for (let i = 0; i < world.moverCount; i++) {
    const m = world.movers[i];
    const t = segmentBox(
      p.x,
      p.y,
      p.x + ux * dist,
      p.y + uy * dist,
      m.x,
      m.y,
      m.x + m.w,
      m.y + m.h,
    );
    if (t >= 0 && t < bestT) {
      bestT = t;
      kind = 1;
    }
  }
  const hw = world.params.width * 0.5;
  for (let v = 0; v < MAX_PLAYERS; v++) {
    if (v === ownerSlot) continue;
    const q = world.players[v];
    if (!q.active || q.dead || q.ghost || q.invuln > 0) continue;
    if (isTeammate(world, ownerSlot, v) && !world.rules.friendlyFire) continue;
    const h = bodyHeight(world, q);
    const t = segmentBox(
      p.x,
      p.y,
      p.x + ux * dist,
      p.y + uy * dist,
      q.x - hw - RADIUS,
      q.y - h - RADIUS,
      q.x + hw + RADIUS,
      q.y + RADIUS,
    );
    if (t >= 0 && t < bestT) {
      bestT = t;
      kind = 2;
      which = v;
    }
  }
  for (let k = 0; k < world.objects.length; k++) {
    const c = world.objects[k];
    if (!c.active || !reelable(c.type)) continue;
    const t = segmentBox(
      p.x,
      p.y,
      p.x + ux * dist,
      p.y + uy * dist,
      c.x - c.w / 2 - RADIUS,
      c.y - c.h - RADIUS,
      c.x + c.w / 2 + RADIUS,
      c.y + RADIUS,
    );
    if (t >= 0 && t < bestT) {
      bestT = t;
      kind = 3;
      which = k;
    }
  }

  if (kind === 0) {
    p.x += ux * dist;
    p.y += uy * dist;
    p.life--;
    if (
      p.life <= 0 ||
      p.y > world.arena.size[1] * 16 + 64 ||
      p.y < -128 ||
      p.x < -64 ||
      p.x > world.arena.size[0] * 16 + 64
    ) {
      p.active = false;
    }
    return;
  }
  const hx = p.x + ux * dist * bestT;
  const hy = p.y + uy * dist * bestT;
  if (kind === 1) {
    hookAnchor(world, p, ownerSlot, hx - ux * 4, hy - uy * 4);
  } else if (kind === 2) {
    const q = world.players[which];
    p.active = false;
    q.grappleTicks = Math.min(def.pullTicks, 70);
    q.grappleX = o.x;
    q.grappleY = o.y - bodyHeight(world, o) * 0.5;
    q.dashTicks = 0;
    q.dodging = false;
    queueHit(
      world,
      which,
      ownerSlot,
      def.damage,
      0,
      0,
      0,
      Cause.PROJECTILE,
      HitFlag.RANGED,
      hx,
      hy,
    );
    emit(world, SimEvent.GRAPPLE, ownerSlot, q.x, q.y - 14, which);
  } else {
    const c = world.objects[which];
    p.x = hx;
    p.y = hy;
    p.bounces = 1;
    p.hitMask = c.uid;
    p.life = 90;
    c.vx = 0;
    c.vy = 0;
    emit(world, SimEvent.GRAPPLE, ownerSlot, c.x, c.y - c.h / 2, 253);
  }
}

// --- Pas de simulation -------------------------------------------------------------------------

/** Les projectiles qui s'arrêtent net sur le décor (pas de rebond). */
function dies(type: number): boolean {
  return (
    type === ProjType.ROCKET ||
    type === ProjType.PLANE ||
    type === ProjType.SHRAPNEL ||
    type === ProjType.STAPLE ||
    type === ProjType.GLUE ||
    type === ProjType.ARROW
  );
}

/** Fait avancer tous les projectiles d'un pas (autorité). */
export function stepProjectiles(world: World): void {
  const hw = world.params.width * 0.5;
  shrapCount.fill(0);
  shrapDamage.fill(0);
  for (let i = 0; i < world.projectiles.length; i++) {
    const p = world.projectiles[i];
    if (!p.active) continue;
    if (p.type === ProjType.HOOK) {
      stepHook(world, p);
      continue;
    }
    const def = weaponDef(p.weapon);
    p.age++;
    if (p.type === ProjType.PLANE) steer(world, p, def.homing * DT);
    if (p.type === ProjType.BOOMERANG) {
      if (p.bounces === 0 && p.age >= BOOMERANG_TURN_TICKS) {
        p.bounces = 1;
        p.hitMask = 0;
      }
      if (p.bounces === 1) {
        const o = world.players[p.owner];
        if (!o || !o.active || o.dead || o.ghost) {
          spawnWeaponObj(world, WeaponId.BOOMERANG, 1, p.x, p.y - 4, 0, -60);
          p.active = false;
          continue;
        }
        const tx = o.x - p.x;
        const ty = o.y - bodyHeight(world, o) * 0.5 - p.y;
        const d = Math.hypot(tx, ty);
        if (d < 16) {
          catchBoomerang(world, p);
          continue;
        }
        const speed = def.speed * 1.1;
        p.vx = (tx / d) * speed;
        p.vy = (ty / d) * speed;
      }
    }
    if (p.type !== ProjType.PLANE)
      p.vy += (p.type === ProjType.THROWN ? world.params.gravity * 0.6 : def.gravity) * DT;
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
      const q = world.players[v];
      if (!q.active || q.dead || q.ghost || q.invuln > 0) continue;
      if (v === p.owner && (p.age < SELF_SAFE_TICKS || p.type === ProjType.BOOMERANG)) continue;
      if ((p.hitMask & (1 << v)) !== 0 && p.type !== ProjType.GLUE) continue;
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
    // Objets sur le trajet (caisses, ballons, couvertures).
    let bestObj = -1;
    let bestObjT = bestPlayer >= 0 ? bestT : 2;
    for (let k = 0; k < world.objects.length; k++) {
      const o = world.objects[k];
      if (!o.active) continue;
      if (o.type !== ObjType.CRATE && o.type !== ObjType.BALLOON && o.type !== ObjType.COVER) {
        continue;
      }
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

    if (bestObj >= 0) {
      const o = world.objects[bestObj];
      const hx = p.x + ux * reach * bestObjT;
      const hy = p.y + uy * reach * bestObjT;
      if (p.type === ProjType.ROCKET || p.type === ProjType.GRENADE) {
        endProjectile(world, p, hx, hy);
        continue;
      }
      if (p.type === ProjType.THROWN && p.weapon === WeaponId.CRATE) breakCrate(world, o);
      else damageObject(world, o, Math.max(6, def.damage), p.owner);
      if (p.type !== ProjType.ERASER && p.type !== ProjType.BOOMERANG) {
        endProjectile(world, p, hx, hy);
        continue;
      }
    }

    if (bestPlayer >= 0 && bestT <= 1) {
      const q = world.players[bestPlayer];
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
        p.type !== ProjType.ROCKET &&
        p.type !== ProjType.GRENADE
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
      if (p.type === ProjType.ROCKET || p.type === ProjType.GRENADE) {
        endProjectile(world, p, hx, hy);
        continue;
      }
      let damage = def.damage;
      let kbx = def.kbx;
      let kby = def.kby;
      let flags: number = HitFlag.RANGED;
      let cause: number = Cause.PROJECTILE;
      const dir = p.vx >= 0 ? 1 : -1;
      if (p.type === ProjType.THROWN) {
        damage = thrownDamage(p);
        kbx = COMBAT.throwKb * (1 + p.bounces / 100);
        kby = -120;
        flags = 0;
        cause = Cause.THROWN;
      } else if (p.type === ProjType.SHRAPNEL) {
        // Les éclats d'une même salve arrivent ensemble : un seul coup par cible et par tick.
        shrapDamage[bestPlayer] += shrapnelDamage(p);
        shrapCount[bestPlayer]++;
        shrapOwner[bestPlayer] = p.owner;
        shrapDir[bestPlayer] = dir;
        shrapX[bestPlayer] = p.x;
        shrapY[bestPlayer] = p.y;
        p.active = false;
        continue;
      } else if (p.type === ProjType.ARROW) {
        const lvl = p.ammo / 100;
        damage = def.damage * (1 + def.chargeBonus * lvl);
        kbx = def.kbx * (1 + lvl);
        cause = Cause.BULLET;
      } else if (p.type === ProjType.GLUE) {
        const blocking = q.blockTicks > 0 && front;
        if (!blocking && q.glueTicks < def.statusTicks) q.glueTicks = def.statusTicks;
      }
      queueHit(
        world,
        bestPlayer,
        p.owner,
        damage,
        dir * kbx,
        kby,
        def.stun,
        cause,
        flags,
        p.x,
        p.y,
      );
      p.hitMask |= 1 << bestPlayer;
      if (p.type === ProjType.ERASER || p.type === ProjType.BOOMERANG) {
        p.x = hx;
        p.y = hy;
        // la gomme continue de rebondir, le boomerang de voler
      } else {
        endProjectile(world, p, hx, hy);
        continue;
      }
    }

    if (hitWall) {
      const hx = p.x + ux * wallDist;
      const hy = p.y + uy * wallDist;
      if (p.type === ProjType.BOOMERANG) {
        if (p.bounces === 0) {
          // contre un mur : demi-tour immédiat
          p.bounces = 1;
          p.hitMask = 0;
          p.x = hx;
          p.y = hy;
        } else {
          p.x = hx;
          p.y = hy;
          spawnWeaponObj(world, WeaponId.BOOMERANG, 1, p.x, p.y - 4, 0, -60);
          p.active = false;
        }
        continue;
      }
      if (dies(p.type)) {
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
      if (p.type === ProjType.GRENADE && uy > 0 && Math.abs(p.vy) < 80) {
        // Posée au sol : elle roule un peu et attend la fin de sa mèche.
        p.x = hx;
        p.y = hy;
        p.vy = 0;
        p.vx *= 0.7;
        p.life--;
        if (p.life <= 0) endProjectile(world, p, p.x, p.y);
        continue;
      }
      // Rebond : la composante dominante est inversée.
      p.bounces--;
      if (p.bounces < 0) {
        if (p.type === ProjType.GRENADE) endProjectile(world, p, hx, hy);
        else p.active = false;
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
      if (p.type === ProjType.ROCKET || p.type === ProjType.GRENADE || p.type === ProjType.THROWN) {
        endProjectile(world, p, p.x, p.y);
      } else if (p.type === ProjType.BOOMERANG) {
        spawnWeaponObj(world, WeaponId.BOOMERANG, 1, p.x, p.y - 4, 0, -60);
        p.active = false;
      } else p.active = false;
      continue;
    }
    if (
      p.y > world.arena.size[1] * 16 + 64 ||
      p.y < -128 ||
      p.x < -64 ||
      p.x > world.arena.size[0] * 16 + 64
    ) {
      p.active = false;
    }
  }

  // Éclats : un coup par cible, dont la force dépend du nombre d'éclats reçus.
  for (let v = 0; v < MAX_PLAYERS; v++) {
    const c = shrapCount[v];
    if (c === 0) continue;
    const def = weaponDef(WeaponId.SHOTGUN);
    queueHit(
      world,
      v,
      shrapOwner[v],
      shrapDamage[v],
      shrapDir[v] * def.kbx * (0.6 + 0.4 * Math.min(c, 6)),
      def.kby,
      0,
      Cause.BULLET,
      HitFlag.RANGED,
      shrapX[v],
      shrapY[v],
    );
  }
}
