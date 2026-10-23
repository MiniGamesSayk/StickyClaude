import {
  Cause,
  CELL,
  Cell,
  COMBAT,
  GamePhase,
  GRID_W,
  MAX_PLAYERS,
  ObjType,
  SimEvent,
  SPAWNABLE_WEAPONS,
  WeaponId,
  weaponDef,
} from '@stickyclaude/shared';
import type { Explosion } from '@stickyclaude/shared';
import { bodyHeight, cellAt, moveBoxX, moveBoxY, rectBlocked } from './collision.ts';
import { explode, HitFlag, queueHit } from './combat.ts';
import { emit, newUid } from './world.ts';
import type { Obj, Player, World } from './world.ts';

/** Une arme oubliée s'efface après 20 s. */
export const WEAPON_LIFE_TICKS = 20 * 60;
/** Délai entre le début du dessin d'une arme et son apparition (0,8 s). */
export const WEAPON_DRAW_TICKS = 48;

/**
 * Objets au sol, proportionnels au nombre de joueurs en lice : plus il y a de monde, plus il y a
 * d'armes et de cœurs en même temps, et plus ils apparaissent souvent.
 */
export function maxGroundWeapons(players: number): number {
  return Math.max(2, Math.ceil(players * 0.6));
}
export function maxGroundHearts(players: number): number {
  return Math.max(1, Math.ceil(players / 4));
}
/** Délai moyen (ticks) entre deux apparitions : 10 s à 2 ou 4 joueurs, 5 s à 8. */
export function itemInterval(players: number): number {
  return Math.min(600, Math.max(240, Math.round(2400 / Math.max(2, players))));
}
/** Joueurs en lice (hors fantômes et absents). */
export function playersInPlay(world: World): number {
  let n = 0;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (p.active && !p.ghost) n++;
  }
  return n;
}
const HEART_SIZE = 12;
const CRATE_HP = 20;
/** Probabilité qu'une caisse brisée laisse une arme. */
export const CRATE_WEAPON_CHANCE = 0.5;
/** Bande de scotch posée au sol et couverture dressée (dimensions, solidité, durée de vie). */
export const TAPE_W = 44;
export const TAPE_H = 3;
export const TAPE_LIFE_TICKS = 12 * 60;
export const COVER_W = 6;
export const COVER_H = 30;
export const COVER_HP = 6;
export const COVER_LIFE_TICKS = 9 * 60;
const CRATE_SIZE = 16;
const BALLOON_SIZE = 14;
const TACK_W = 14;
const TACK_H = 6;

const BALLOON_EXPLOSION: Explosion = {
  radius: 26,
  damage: 12,
  kb: 220,
  destroys: false,
  puddle: false,
};

export function allocObj(world: World): Obj | null {
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i];
    if (!o.active) return o;
  }
  return null;
}

export function spawnObj(
  world: World,
  type: number,
  x: number,
  y: number,
  w: number,
  h: number,
  a: number,
  b: number,
): Obj | null {
  const o = allocObj(world);
  if (!o) return null;
  o.active = true;
  o.uid = newUid(world);
  o.type = type;
  o.x = x;
  o.y = y;
  o.vx = 0;
  o.vy = 0;
  o.w = w;
  o.h = h;
  o.grounded = false;
  o.a = a;
  o.b = b;
  o.owner = -1;
  o.team = -1;
  o.life = 0;
  o.timer = 0;
  return o;
}

export function spawnWeaponObj(
  world: World,
  weapon: number,
  ammo: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Obj | null {
  const o = spawnObj(world, ObjType.WEAPON, x, y, 14, 8, weapon, ammo);
  if (!o) return null;
  o.vx = vx;
  o.vy = vy;
  o.life = WEAPON_LIFE_TICKS;
  return o;
}

/** Crée caisses, ballons et punaises décrits par l'arène (début de manche). */
export function spawnProps(world: World): void {
  for (const prop of world.arena.props) {
    const cx = (prop.at[0] + 0.5) * CELL;
    const by = (prop.at[1] + 1) * CELL;
    if (prop.type === 'crate')
      spawnObj(world, ObjType.CRATE, cx, by, CRATE_SIZE, CRATE_SIZE, CRATE_HP, 0);
    else if (prop.type === 'balloon') {
      const o = spawnObj(world, ObjType.BALLOON, cx, by, BALLOON_SIZE, BALLOON_SIZE, 1, 0);
      if (o) o.life = 30 * 60;
    } else if (prop.type === 'tack') {
      spawnObj(world, ObjType.TACK, cx, by, TACK_W, TACK_H, 0, 0);
    }
  }
}

export function countGroundHearts(world: World): number {
  let n = 0;
  for (const o of world.objects) if (o.active && o.type === ObjType.HEART) n++;
  return n;
}

export function countGroundWeapons(world: World): number {
  let n = 0;
  for (const o of world.objects) if (o.active && o.type === ObjType.WEAPON) n++;
  for (const s of world.spawns) if (s.active) n++;
  return n;
}

/** Arme tirée au hasard, selon les poids de `weapons.ts`. */
export function randomWeapon(world: World): number {
  let total = 0;
  for (const id of SPAWNABLE_WEAPONS) total += weaponDef(id).weight;
  let r = world.rng.float() * total;
  for (const id of SPAWNABLE_WEAPONS) {
    r -= weaponDef(id).weight;
    if (r < 0) return id;
  }
  return SPAWNABLE_WEAPONS[0];
}

/** L'arme tenue tombe quand son porteur meurt. */
export function dropWeaponAt(world: World, p: Player): void {
  if (p.weapon === WeaponId.NONE) return;
  if (p.weapon === WeaponId.CRATE) {
    const c = spawnObj(world, ObjType.CRATE, p.x, p.y, CRATE_SIZE, CRATE_SIZE, CRATE_HP, 0);
    if (c) c.vy = -120;
  } else if (p.ammo > 0) {
    spawnWeaponObj(world, p.weapon, p.ammo, p.x, p.y - 6, p.facing * -40, -140);
  }
  p.weapon = WeaponId.NONE;
  p.ammo = 0;
}

/** Lâcher volontaire : l'arme tombe aux pieds du joueur. */
export function dropWeapon(world: World, p: Player, slot: number): void {
  if (p.weapon === WeaponId.NONE) return;
  const w = p.weapon;
  dropWeaponAt(world, p);
  emit(world, SimEvent.THROW, slot, w, 1);
}

export function kickBall(world: World, o: Obj, p: Player, kbx: number, kby: number): void {
  const dir = p.facing >= 0 ? 1 : -1;
  const power = Math.max(180, Math.abs(kbx) * 1.8);
  o.vx = dir * power;
  o.vy = Math.min(-140, kby * 1.3);
  o.grounded = false;
  o.owner = world.players.indexOf(p);
}

export function triggerMine(world: World, o: Obj): void {
  if (!o.active) return;
  o.active = false;
  const ex = weaponDef(WeaponId.INK_MINE).explosion!;
  explode(world, o.x, o.y - 4, ex, o.owner, Cause.MINE, 1);
}

export function breakCrate(world: World, o: Obj): void {
  o.active = false;
  emit(world, SimEvent.CRATE_BREAK, 0, o.x, o.y - o.h / 2);
  // Une chance sur deux, sans plafond d'armes au sol (seule la réserve d'objets limite).
  if (world.rules.weapons && world.rng.float() < CRATE_WEAPON_CHANCE) {
    const w = randomWeapon(world);
    spawnWeaponObj(world, w, weaponDef(w).ammo, o.x, o.y - 4, 0, -100);
  }
}

export function popBalloon(world: World, o: Obj, owner: number): void {
  o.active = false;
  explode(world, o.x, o.y - o.h / 2, BALLOON_EXPLOSION, owner, Cause.BALLOON, 2);
}

/** Dégâts infligés à un objet (mêlée, balle, explosion). */
export function damageObject(world: World, o: Obj, dmg: number, byPlayer: number): void {
  if (!o.active) return;
  if (o.type === ObjType.CRATE) {
    o.a -= dmg;
    if (o.a <= 0) breakCrate(world, o);
  } else if (o.type === ObjType.BALLOON) {
    popBalloon(world, o, byPlayer);
  } else if (o.type === ObjType.COVER) {
    o.a -= Math.max(1, Math.round(dmg / 4));
    if (o.a <= 0) {
      o.active = false;
      emit(world, SimEvent.CRATE_BREAK, 0, o.x, o.y - o.h / 2);
    }
  }
}

function overlapsPlayer(world: World, o: Obj, p: Player): boolean {
  const hw = world.params.width * 0.5;
  const h = bodyHeight(world, p);
  return o.x + o.w / 2 > p.x - hw && o.x - o.w / 2 < p.x + hw && o.y > p.y - h && o.y - o.h < p.y;
}

/** Physique et comportement des objets dynamiques (autorité). */
export function stepObjects(world: World): void {
  const P = world.params;
  const dt = 1 / 60;
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i];
    if (!o.active) continue;

    if (o.life > 0) {
      o.life--;
      if (o.life === 0) {
        if (o.type === ObjType.BALLOON) popBalloon(world, o, -1);
        else o.active = false;
        continue;
      }
    }

    switch (o.type) {
      case ObjType.TACK: {
        for (let s = 0; s < MAX_PLAYERS; s++) {
          const p = world.players[s];
          if (!p.active || p.dead || p.ghost || p.tackCd > 0) continue;
          if (!overlapsPlayer(world, o, p)) continue;
          p.tackCd = COMBAT.tackCooldownTicks;
          queueHit(
            world,
            s,
            -1,
            COMBAT.tackDamage,
            0,
            -COMBAT.tackBounce,
            0,
            Cause.TACK,
            HitFlag.UNBLOCKABLE,
            o.x,
            o.y,
          );
        }
        break;
      }
      case ObjType.BALLOON: {
        o.vy = -32;
        o.vx = Math.sin((world.tick + o.uid * 7) * 0.045) * 26;
        const hw = o.w / 2;
        moveBoxX(world, o, hw, o.h, o.vx * dt);
        if (moveBoxY(world, o, hw, o.h, o.vy * dt, 1) === -1) popBalloon(world, o, -1);
        else if (o.y < -o.h) o.active = false;
        break;
      }
      case ObjType.MINE: {
        if (o.b === 0) {
          o.timer++;
          if (o.timer >= weaponDef(WeaponId.INK_MINE).armTicks) o.b = 1;
        }
        gravityStep(world, o, dt);
        if (o.b === 1) {
          const r = weaponDef(WeaponId.INK_MINE).triggerRadius;
          for (let s = 0; s < MAX_PLAYERS; s++) {
            const p = world.players[s];
            if (!p.active || p.dead || p.ghost || p.invuln > 0) continue;
            if (
              s !== o.owner &&
              o.team >= 0 &&
              world.team[s] === o.team &&
              !world.rules.friendlyFire
            ) {
              continue;
            }
            const cy = p.y - bodyHeight(world, p) * 0.5;
            const near = Math.hypot(p.x - o.x, cy - (o.y - 4)) <= r + P.width * 0.5;
            if (s === o.owner && o.a === 0) {
              // Le poseur peut rester dessus tant qu'il ne s'en est pas éloigné une fois.
              if (!near) o.a = 1;
              continue;
            }
            if (near) {
              triggerMine(world, o);
              break;
            }
          }
        }
        break;
      }
      case ObjType.TAPE: {
        gravityStep(world, o, dt);
        const ticks = weaponDef(WeaponId.TAPE).statusTicks;
        for (let s = 0; s < MAX_PLAYERS; s++) {
          const p = world.players[s];
          if (!p.active || p.dead || p.ghost || !p.grounded) continue;
          if (s === o.owner || (o.team >= 0 && world.team[s] === o.team)) continue;
          if (overlapsPlayer(world, o, p) && p.glueTicks < ticks) p.glueTicks = ticks;
        }
        break;
      }
      case ObjType.COVER: {
        gravityStep(world, o, dt);
        break;
      }
      case ObjType.HEART: {
        gravityStep(world, o, dt);
        if (o.y > world.arena.size[1] * CELL + 3 * CELL) o.active = false;
        else if (world.game.phase === GamePhase.PLAYING) healByContact(world, o);
        break;
      }
      default: {
        // Arme, caisse, boule : tombent, glissent, sont poussées par les joueurs.
        if (o.type === ObjType.CRATE || o.type === ObjType.BALL) pushByPlayers(world, o);
        gravityStep(world, o, dt);
        if (o.type === ObjType.WEAPON && o.y > world.arena.size[1] * CELL + 3 * CELL)
          o.active = false;
        if (o.type === ObjType.CRATE && o.y > world.arena.size[1] * CELL + 3 * CELL)
          o.active = false;
      }
    }
  }
}

function pushByPlayers(world: World, o: Obj): void {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!p.active || p.dead || p.ghost) continue;
    if (!overlapsPlayer(world, o, p)) continue;
    if (o.type === ObjType.BALL) {
      const dir = o.x >= p.x ? 1 : -1;
      const v = Math.abs(p.vx) * 1.1 + 40;
      if (Math.abs(o.vx) < v) o.vx = dir * v;
      if (p.vy < -80 && p.y > o.y) o.vy = Math.min(o.vy, p.vy * 0.6);
      o.owner = s;
    } else if (Math.abs(p.vx) > 20) {
      o.vx += (p.vx - o.vx) * 0.12;
    }
  }
}

/** Décalages essayés, du plus proche au plus lointain, pour sortir un objet d'un décor plein. */
const UNSTICK_STEP = 2;
const UNSTICK_MAX = 64;

/**
 * Sort un objet resté pris dans le décor : arme lancée contre un mur (le centre du projectile
 * s'arrête à 3 unités du mur, la boîte de l'arme est plus large), arme lâchée dans un angle,
 * bloc de papier qui se referme. Sans cela, la collision par balayage ne le libère jamais et il
 * reste hors de portée des joueurs. Retourne faux si aucun emplacement libre n'est proche.
 */
function unstick(world: World, o: Obj): boolean {
  const hw = o.w / 2;
  if (!rectBlocked(world, o.x - hw, o.y - o.h, o.x + hw, o.y)) return true;
  for (let d = UNSTICK_STEP; d <= UNSTICK_MAX; d += UNSTICK_STEP) {
    for (let k = 0; k < 8; k++) {
      // côtés, haut, diagonales hautes, puis bas
      const dx =
        k === 0 ? -d : k === 1 ? d : k === 3 ? -d : k === 4 ? d : k === 6 ? -d : k === 7 ? d : 0;
      const dy = k <= 1 ? 0 : k <= 4 ? -d : d;
      if (!rectBlocked(world, o.x + dx - hw, o.y + dy - o.h, o.x + dx + hw, o.y + dy)) {
        o.x += dx;
        o.y += dy;
        o.vx = 0;
        if (o.vy > 0) o.vy = 0;
        return true;
      }
    }
  }
  return false;
}

function gravityStep(world: World, o: Obj, dt: number): void {
  const P = world.params;
  const hw = o.w / 2;
  if (!unstick(world, o) && o.type !== ObjType.BALL) {
    o.active = false;
    return;
  }
  o.vy += P.gravity * dt;
  if (o.vy > P.maxFallSpeed) o.vy = P.maxFallSpeed;
  if (moveBoxX(world, o, hw, o.h, o.vx * dt)) o.vx = -o.vx * (o.type === ObjType.BALL ? 0.7 : 0.2);
  const hit = moveBoxY(world, o, hw, o.h, o.vy * dt, 0);
  if (hit === 1) {
    o.grounded = true;
    if (o.type === ObjType.BALL && o.vy > 90) o.vy = -o.vy * 0.7;
    else o.vy = 0;
  } else {
    if (hit === -1) o.vy = o.type === ObjType.BALL ? -o.vy * 0.5 : 0;
    o.grounded = false;
  }
  if (o.grounded) {
    const fr = (o.type === ObjType.BALL ? 120 : 900) * dt;
    if (o.vx > 0) o.vx = Math.max(0, o.vx - fr);
    else if (o.vx < 0) o.vx = Math.min(0, o.vx + fr);
  }
}

/** Un objet (arme, cœur) ou un dessin en cours occupe-t-il déjà ce point d'apparition ? */
function spotTaken(world: World, x: number, y: number): boolean {
  for (const o of world.objects) {
    if (!o.active || (o.type !== ObjType.WEAPON && o.type !== ObjType.HEART)) continue;
    if (Math.abs(o.x - x) < CELL && Math.abs(o.y - y) < CELL) return true;
  }
  for (const s of world.spawns)
    if (s.active && Math.abs(s.x - x) < CELL && Math.abs(s.y - y) < CELL) return true;
  return false;
}

/** Premier point libre à partir de `from` (circulaire), ou -1 si tous sont occupés. */
function freeSpot(world: World, from: number): number {
  const n = world.weaponSpawnCount;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (!spotTaken(world, world.weaponSpawnX[i], world.weaponSpawnY[i])) return i;
  }
  return -1;
}

/** Apparition programmée des armes (autorité) : un dessin au crayon, puis l'objet tombe. */
export function stepWeaponSpawner(world: World): void {
  for (let i = 0; i < world.spawns.length; i++) {
    const s = world.spawns[i];
    if (s.active && world.tick >= s.at) {
      s.active = false;
      spawnWeaponObj(world, s.weapon, weaponDef(s.weapon).ammo, s.x, s.y, 0, 0);
    }
  }
  const g = world.game;
  if (world.weaponSpawnCount === 0) return;
  const phase = g.phase;
  if (phase !== GamePhase.PLAYING && phase !== GamePhase.LOBBY) return;
  const players = playersInPlay(world);
  if (phase === GamePhase.PLAYING) stepHearts(world, players);
  if (!world.rules.weapons) return;
  if (g.mode === 7) return; // même arme pour tous : rien d'autre n'apparaît
  if (g.weaponTimer > 0) {
    g.weaponTimer--;
    return;
  }
  const interval = itemInterval(players);
  g.weaponTimer = interval + world.rng.int(Math.round(interval * 0.4));
  if (countGroundWeapons(world) >= maxGroundWeapons(players)) return;
  const idx = freeSpot(world, world.rng.int(world.weaponSpawnCount));
  if (idx < 0) return; // chaque point porte déjà une arme ou un cœur non ramassé
  const x = world.weaponSpawnX[idx];
  const y = world.weaponSpawnY[idx];
  const weapon = randomWeapon(world);
  for (let i = 0; i < world.spawns.length; i++) {
    const s = world.spawns[i];
    if (s.active) continue;
    s.active = true;
    s.uid = newUid(world);
    s.x = x;
    s.y = y;
    s.weapon = weapon;
    s.at = world.tick + WEAPON_DRAW_TICKS;
    emit(world, SimEvent.WEAPON_SPAWN, 0, x, y, weapon, s.uid);
    break;
  }
}

/** Apparition des cœurs de soin (combat seulement), au rythme et en nombre proportionnels aux joueurs. */
function stepHearts(world: World, players: number): void {
  const g = world.game;
  if (g.healTimer > 0) {
    g.healTimer--;
    return;
  }
  const interval = itemInterval(players);
  g.healTimer = Math.round(interval * 1.5) + world.rng.int(Math.round(interval * 0.6));
  if (countGroundHearts(world) >= maxGroundHearts(players)) return;
  const idx = freeSpot(world, world.rng.int(world.weaponSpawnCount));
  if (idx < 0) return;
  const o = spawnObj(
    world,
    ObjType.HEART,
    world.weaponSpawnX[idx],
    world.weaponSpawnY[idx],
    HEART_SIZE,
    HEART_SIZE,
    0,
    0,
  );
  if (o) o.life = COMBAT.heartLifeTicks;
}

/** Un cœur touché soigne le joueur (s'il est blessé : sinon il reste pour un autre). */
function healByContact(world: World, o: Obj): void {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!p.active || p.dead || p.ghost || p.hp >= COMBAT.maxHp) continue;
    if (!overlapsPlayer(world, o, p)) continue;
    const gained = Math.min(COMBAT.healAmount, COMBAT.maxHp - p.hp);
    p.hp += gained;
    o.active = false;
    emit(world, SimEvent.HEAL, s, o.x, o.y - o.h / 2, gained);
    return;
  }
}

/** Contact avec les cellules de danger (encre bouillonnante, taille-crayon géant, gouttes). */
export function stepHazards(world: World): void {
  const hw = world.params.width * 0.5;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!p.active || p.dead || p.ghost || p.hazardCd > 0) continue;
    const h = bodyHeight(world, p);
    const c0 = Math.floor((p.x - hw + 1) / CELL);
    const c1 = Math.floor((p.x + hw - 1) / CELL);
    const r0 = Math.floor((p.y - h + 1) / CELL);
    const r1 = Math.floor((p.y - 1) / CELL);
    let found = -1;
    for (let cy = r0; cy <= r1 && found < 0; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (cellAt(world, cx, cy) === Cell.HAZARD) {
          found = cy * GRID_W + cx;
          break;
        }
      }
    }
    if (found < 0) continue;
    p.hazardCd = COMBAT.hazardIntervalTicks;
    let owner = -1;
    let cause: number = Cause.HAZARD;
    for (const m of world.marks) {
      if (m.active && (m.c0 === found || m.c1 === found || m.c2 === found)) {
        owner = m.owner;
        cause = Cause.GHOST;
      }
    }
    queueHit(
      world,
      s,
      owner,
      COMBAT.hazardDamage,
      0,
      -COMBAT.hazardBounce,
      0,
      cause,
      HitFlag.UNBLOCKABLE,
      p.x,
      p.y,
    );
  }
}
