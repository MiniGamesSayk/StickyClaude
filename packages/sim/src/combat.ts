import {
  AIM_DX,
  AIM_DY,
  AtkPhase,
  AttackKind,
  Cause,
  COMBAT,
  CROUCH_SWEEP,
  FIST,
  GamePhase,
  HISTORY_TICKS,
  MAX_PLAYERS,
  modeInfo,
  NO_SLOT,
  ObjType,
  PlayerState,
  ProjType,
  SimEvent,
  SillyDeath,
  UPPER,
  WeaponKind,
  weaponChargeLevel,
  weaponDef,
} from '@stickyclaude/shared';
import type { Explosion } from '@stickyclaude/shared';
import { bodyHeight, raycastGrid, segmentBox } from './collision.ts';
import type { RayHit } from './collision.ts';
import { cancelActions } from './player.ts';
import { addPuddle, explodeTerrain } from './terrain.ts';
import { emit } from './world.ts';
import type { Obj, Player, World } from './world.ts';
import { damageObject, dropWeaponAt, kickBall, triggerMine } from './objects.ts';

/** Demi-largeur perdue par la boîte du corps depuis le réglage des allonges (12,8 → 9). */
const MELEE_BODY_BONUS = 1.9;

export const HitFlag = { PIERCE: 1, RANGED: 2, HEAVY: 4, UNBLOCKABLE: 8, LIGHT: 16 } as const;

// --- Historique des positions (compensation de latence) ---------------------------------------

/** Enregistre les boîtes des joueurs à ce tick (x, y, hauteur ; hauteur 0 = absent). */
export function recordHistory(world: World): void {
  const base = (world.tick & (HISTORY_TICKS - 1)) * MAX_PLAYERS * 3;
  const h = world.history;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    const o = base + s * 3;
    if (p.active && !p.dead && !p.ghost) {
      h[o] = p.x;
      h[o + 1] = p.y;
      h[o + 2] = bodyHeight(world, p);
    } else {
      h[o] = 0;
      h[o + 1] = 0;
      h[o + 2] = 0;
    }
  }
}

export const rewound = { x: 0, y: 0, h: 0 };

/** Boîte d'un joueur il y a `ago` ticks (position actuelle si l'historique ne la connaît pas). */
export function rewoundBox(world: World, slot: number, ago: number): void {
  const p = world.players[slot];
  rewound.x = p.x;
  rewound.y = p.y;
  rewound.h = bodyHeight(world, p);
  if (ago <= 0) return;
  const a = ago >= HISTORY_TICKS ? HISTORY_TICKS - 1 : ago;
  const t = world.tick - a;
  if (t < 0) return;
  const o = ((t & (HISTORY_TICKS - 1)) * MAX_PLAYERS + slot) * 3;
  const hh = world.history[o + 2];
  if (hh > 0) {
    rewound.x = world.history[o]!;
    rewound.y = world.history[o + 1]!;
    rewound.h = hh;
  }
}

// --- Coups en attente -------------------------------------------------------------------------

export function isTeammate(world: World, a: number, b: number): boolean {
  return a !== b && a >= 0 && b >= 0 && world.team[a] === world.team[b];
}

export function queueHit(
  world: World,
  victim: number,
  attacker: number,
  damage: number,
  kbx: number,
  kby: number,
  stun: number,
  cause: number,
  flags: number,
  x: number,
  y: number,
): void {
  if (world.hitCount >= world.hits.length) return;
  const h = world.hits[world.hitCount++];
  h.victim = victim;
  h.attacker = attacker;
  h.damage = damage;
  h.kbx = kbx;
  h.kby = kby;
  h.stun = stun;
  h.cause = cause;
  h.pierce = (flags & HitFlag.PIERCE) !== 0;
  h.ranged = (flags & HitFlag.RANGED) !== 0;
  h.heavy = (flags & HitFlag.HEAVY) !== 0;
  h.unblockable = (flags & HitFlag.UNBLOCKABLE) !== 0;
  h.light = (flags & HitFlag.LIGHT) !== 0;
  h.x = x;
  h.y = y;
}

/** Applique tous les coups en attente, dans l'ordre où ils ont été détectés. */
export function applyHits(world: World): void {
  for (let i = 0; i < world.hitCount; i++) applyHit(world, i);
  world.hitCount = 0;
}

/**
 * La garde de `v` couvre-t-elle un coup parti de l'abscisse `sx` ? Elle couvre le côté où le
 * personnage regarde (les bras devant), et l'aplomb du corps : un coup venu de dessus ou de
 * dessous (spike, coup vers le haut) est paré même un peu dans le dos.
 */
export function guardCovers(world: World, v: Player, sx: number): boolean {
  const dx = sx - v.x;
  return dx * v.facing >= -2 || Math.abs(dx) <= world.params.width * 0.5;
}

/** La parade vient d'être levée : le coup est annulé en entier. */
function perfectWindow(v: Player): boolean {
  return v.blockTicks <= COMBAT.perfectParryTicks;
}

function applyHit(world: World, index: number): void {
  const h = world.hits[index];
  const v = world.players[h.victim];
  if (!v.active || v.dead || v.ghost) return;
  const phase = world.game.phase;
  if (
    phase === GamePhase.COUNTDOWN ||
    phase === GamePhase.ROUND_END ||
    phase === GamePhase.MATCH_END
  ) {
    return;
  }
  const attacker = h.attacker;
  const a = attacker >= 0 ? world.players[attacker] : null;
  if (attacker >= 0 && isTeammate(world, attacker, h.victim) && !world.rules.friendlyFire) return;
  if (v.invuln > 0) return;

  let damage = h.damage;
  let kbx = h.kbx;
  let kby = h.kby;
  let stun = h.stun;
  let blocked = false;

  if (!h.unblockable) {
    const w = weaponDef(v.weapon);
    // Le bouclier d'une arme et la parade à mains nues couvrent tous deux le devant.
    const guarded = guardCovers(world, v, h.x);
    if (h.ranged && w.kind === WeaponKind.SHIELD && v.ammo > 0 && guarded) {
      v.ammo--;
      if (v.ammo === 0) {
        v.weapon = 0;
      }
      emit(world, SimEvent.BLOCKED, h.victim, v.x, v.y - 14, attacker < 0 ? NO_SLOT : attacker, 0);
      return;
    }
    if (v.blockTicks > 0 && guarded && (!h.pierce || (!h.ranged && perfectWindow(v)))) {
      const perfect = !h.ranged && perfectWindow(v);
      // La parade n'encaisse qu'un coup : elle retombe et ne reviendra qu'après la recharge.
      v.blockTicks = 0;
      v.blockCd = COMBAT.parryCooldownTicks;
      // Un coup de mêlée paré étourdit celui qui l'a porté (0,4 s), quelle que soit sa direction.
      if (!h.ranged && a && a !== v && !a.dead) {
        a.stun = COMBAT.parryStunTicks;
        cancelActions(a);
        a.blockTicks = 0;
        a.hitMask = 0;
      }
      emit(
        world,
        SimEvent.BLOCKED,
        h.victim,
        v.x,
        v.y - 14,
        attacker < 0 ? NO_SLOT : attacker,
        perfect ? 1 : 0,
      );
      if (perfect) return;
      damage *= COMBAT.blockDamageTaken;
      kbx *= COMBAT.blockKnockbackMul;
      kby *= COMBAT.blockKnockbackMul;
      stun = 0;
      blocked = true;
    }
  }

  const lobby = phase === GamePhase.LOBBY;
  let dealt = 0;
  /** Dégâts annoncés dans l'événement : au salon (entraînement) rien n'est retiré, mais le chiffre s'affiche. */
  let shown = 0;
  if (damage > 0) {
    shown = Math.max(1, Math.round(damage));
    if (!lobby) {
      dealt = Math.min(shown, v.hp);
      shown = dealt;
      v.hp -= dealt;
    }
  }

  if (a && a !== v) {
    if (world.tick - a.lastHitTick <= 90) a.combos++;
    else a.combos = 1;
    a.lastHitTick = world.tick;
    if (a.combos > world.stats.bestCombo[attacker]) world.stats.bestCombo[attacker] = a.combos;
    world.stats.damage[attacker] = world.stats.damage[attacker] + dealt;
  }
  v.combos = 0;
  if (attacker >= 0 && attacker !== h.victim) {
    v.lastAttacker = attacker;
    v.lastAttackTick = world.tick;
  }

  if ((kbx !== 0 || kby !== 0) && !h.light) {
    const hpFrac = Math.max(0, Math.min(1, v.hp / COMBAT.maxHp));
    const scale = 1 + COMBAT.lowHpKnockbackBonus * (1 - hpFrac);
    v.vx = v.vx * 0.2 + kbx * scale;
    v.vy = kby * scale;
    v.grounded = false;
    v.groundMover = -1;
    v.jumping = false;
    v.coyote = 0;
    const lock = COMBAT.hitLockMin + Math.hypot(kbx, kby) * scale * COMBAT.hitLockPerKb;
    const l = Math.min(COMBAT.hitLockMax, Math.round(lock));
    if (l > v.hitLock) v.hitLock = l;
  }
  if (!blocked && !h.light) {
    cancelActions(v);
    if (stun > 0 && v.stunImmune === 0) {
      v.stun = Math.min(COMBAT.stunMaxTicks, stun);
      v.blockTicks = 0;
    }
  }
  const lethal = v.hp <= 0 && !lobby;
  emit(
    world,
    SimEvent.HIT,
    h.victim,
    v.x,
    v.y - bodyHeight(world, v) * 0.5,
    attacker < 0 ? NO_SLOT : attacker,
    shown,
    (h.heavy ? 1 : 0) | (blocked ? 2 : 0) | (lethal ? 4 : 0),
  );
  if (lethal) killPlayer(world, h.victim, attacker, h.cause);
}

// --- Mort --------------------------------------------------------------------------------------

export function killPlayer(world: World, slot: number, killer: number, cause: number): void {
  const p = world.players[slot];
  if (p.dead || p.ghost || !p.active) return;
  let credited = killer;
  if (
    credited < 0 &&
    p.lastAttacker >= 0 &&
    world.tick - p.lastAttackTick <= COMBAT.killCreditTicks
  ) {
    credited = p.lastAttacker;
  }
  const stats = world.stats;
  stats.deaths[slot] = stats.deaths[slot] + 1;
  if (credited >= 0 && credited !== slot) stats.kos[credited] = stats.kos[credited] + 1;
  let silly: number = SillyDeath.NONE;
  if (credited === slot) silly = SillyDeath.SELF;
  else if (credited >= 0 && isTeammate(world, credited, slot)) silly = SillyDeath.FRIENDLY;
  else if (cause === Cause.FALL && credited < 0) silly = SillyDeath.FALL;
  if (silly > stats.silly[slot]) stats.silly[slot] = silly;

  p.hp = 0;
  emit(
    world,
    SimEvent.KO,
    slot,
    p.x,
    p.y - bodyHeight(world, p) * 0.5,
    credited < 0 ? NO_SLOT : credited,
    cause,
    p.vx,
    p.vy,
  );
  dropWeaponAt(world, p);
  cancelActions(p);
  p.blockTicks = 0;
  p.stun = 0;
  p.hitLock = 0;
  p.grappleTicks = 0;
  p.attackHeld = 0;
  p.vx = 0;
  p.vy = 0;
  p.combos = 0;
  p.state = PlayerState.DEAD;

  const info = modeInfo(world.game.mode);
  const lobby = world.game.phase === GamePhase.LOBBY;
  if (lobby) {
    p.dead = true;
    p.respawnTimer = 60;
  } else if (info.respawn) {
    p.dead = true;
    p.respawnTimer = world.game.mode === 3 ? 120 : 180;
  } else if (world.rules.ghosts) {
    p.ghost = true;
    p.ghostX = Math.max(0, Math.min(world.arena.size[0] * 16, p.x));
    p.ghostY = Math.max(0, Math.min(world.arena.size[1] * 16, p.y - 20));
    p.ghostCd = 120;
    p.state = PlayerState.GHOST;
  } else {
    p.dead = true;
  }
}

// --- Mêlée -------------------------------------------------------------------------------------

interface MeleeSpec {
  damage: number;
  kbx: number;
  kby: number;
  stun: number;
  reach: number;
  halfHeight: number;
  flags: number;
  cause: number;
}
const spec: MeleeSpec = {
  damage: 0,
  kbx: 0,
  kby: 0,
  stun: 0,
  reach: 0,
  halfHeight: 0,
  flags: 0,
  cause: Cause.MELEE,
};

function meleeSpec(p: Player): boolean {
  switch (p.atkKind) {
    case AttackKind.FIST1:
    case AttackKind.FIST2:
    case AttackKind.FIST3: {
      const a = FIST[p.atkKind - AttackKind.FIST1];
      spec.damage = a.damage;
      spec.kbx = a.kbx;
      spec.kby = a.kby;
      spec.stun = a.stun;
      spec.reach = a.reach;
      spec.halfHeight = 0;
      spec.flags = p.atkKind === AttackKind.FIST3 ? HitFlag.HEAVY : 0;
      spec.cause = Cause.MELEE;
      return true;
    }
    case AttackKind.CHARGED:
    case AttackKind.SPECIAL_DOWN: {
      // attaques spéciales : la charge (clic droit tenu) fait varier dégâts, projection, étourdissement
      const c = p.atkKind === AttackKind.CHARGED ? COMBAT.charged : COMBAT.specialDown;
      const level = Math.min(1, p.chargeTicks / COMBAT.chargeMaxTicks);
      spec.damage = c.damageMin + (c.damageMax - c.damageMin) * level;
      spec.kbx = c.kbxMin + (c.kbxMax - c.kbxMin) * level;
      spec.kby = c.kbyMin + (c.kbyMax - c.kbyMin) * level;
      spec.stun = level >= c.stunFrom ? c.stun : 0;
      spec.reach = c.reach;
      spec.halfHeight = 0;
      spec.flags = HitFlag.HEAVY;
      spec.cause = Cause.MELEE;
      return true;
    }
    case AttackKind.UPPER:
    case AttackKind.CROUCH: {
      const a = p.atkKind === AttackKind.UPPER ? UPPER : CROUCH_SWEEP;
      spec.damage = a.damage;
      spec.kbx = a.kbx;
      spec.kby = a.kby;
      spec.stun = a.stun;
      spec.reach = a.reach;
      spec.halfHeight = 0;
      spec.flags = 0;
      spec.cause = Cause.MELEE;
      return true;
    }
    case AttackKind.AIR_DOWN:
    case AttackKind.AIR_NEUTRAL:
    case AttackKind.AIR_SIDE:
    case AttackKind.AIR_UP: {
      const a =
        p.atkKind === AttackKind.AIR_DOWN
          ? COMBAT.airDown
          : p.atkKind === AttackKind.AIR_NEUTRAL
            ? COMBAT.airNeutral
            : p.atkKind === AttackKind.AIR_SIDE
              ? COMBAT.airSide
              : COMBAT.airUp;
      spec.damage = a.damage;
      spec.kbx = a.kbx;
      spec.kby = a.kby;
      spec.stun = a.stun;
      spec.reach = a.reach;
      spec.halfHeight = 0;
      spec.flags = p.atkKind === AttackKind.AIR_DOWN ? HitFlag.HEAVY : 0;
      // le coup vers le bas est un pied qui pique : cause « coup de pied »
      spec.cause = p.atkKind === AttackKind.AIR_DOWN ? Cause.KICK : Cause.MELEE;
      return true;
    }
    case AttackKind.WEAPON:
    case AttackKind.BASH: {
      const w = weaponDef(p.weapon);
      // Une arme de mêlée chargée (attaque maintenue) frappe plus fort, plus loin.
      const lvl = p.atkKind === AttackKind.WEAPON ? weaponChargeLevel(w, p.chargeTicks) : 0;
      spec.damage = w.damage * (1 + w.chargeBonus * lvl);
      spec.kbx = w.kbx * (1 + 0.7 * lvl);
      spec.kby = w.kby * (1 + 0.7 * lvl);
      spec.stun = w.stun > 0 ? w.stun : lvl >= 0.7 ? 18 : 0;
      spec.reach = w.reach + 8 * lvl;
      spec.halfHeight = w.halfHeight;
      spec.flags =
        (w.pierceBlock ? HitFlag.PIERCE : 0) | (w.stun > 0 || lvl >= 0.5 ? HitFlag.HEAVY : 0);
      spec.cause = p.atkKind === AttackKind.BASH ? Cause.MELEE : Cause.WEAPON_MELEE;
      return true;
    }
    default:
      return false;
  }
}

/** Zone de frappe (rectangle) du joueur pour l'attaque en cours. */
const box = { l: 0, t: 0, r: 0, b: 0 };

/** Direction du coup chargé : la visée, mais au sol « vers le bas » devient un coup bas de côté. */
const cdir = { x: 1, y: 0 };
function chargedDir(p: Player): void {
  const dx = AIM_DX[p.aim];
  const dy = AIM_DY[p.aim];
  const n = Math.hypot(dx, dy) || 1;
  cdir.x = dx / n;
  cdir.y = dy / n;
  if (p.grounded && cdir.y > 0.4) {
    cdir.y = 0;
    cdir.x = p.facing;
  }
}

function meleeBox(world: World, p: Player): void {
  const hw = world.params.width * 0.5;
  const h = bodyHeight(world, p);
  if (p.atkKind === AttackKind.CHARGED) {
    chargedDir(p);
    // le poing s'allonge pendant les images actives
    const c = COMBAT.charged;
    const reach =
      spec.reach +
      MELEE_BODY_BONUS +
      c.extend * Math.min(1, p.atkTicks / Math.max(1, c.active - 1));
    const side = Math.abs(cdir.x) > 0.4;
    if (cdir.x > 0.4) {
      box.l = p.x;
      box.r = p.x + hw + reach;
    } else if (cdir.x < -0.4) {
      box.l = p.x - hw - reach;
      box.r = p.x;
    } else {
      box.l = p.x - hw - 4;
      box.r = p.x + hw + 4;
    }
    if (cdir.y < -0.4) {
      box.t = p.y - h - reach;
      box.b = side ? p.y + 2 : p.y - h * 0.3;
    } else if (cdir.y > 0.4) {
      box.t = side ? p.y - h - 2 : p.y - h * 0.5;
      box.b = p.y + reach;
    } else {
      box.t = p.y - h - 2;
      box.b = p.y + 2;
    }
    return;
  }
  if (p.atkKind === AttackKind.SPECIAL_DOWN) {
    // de chaque côté, à hauteur du corps
    box.l = p.x - hw - spec.reach - MELEE_BODY_BONUS;
    box.r = p.x + hw + spec.reach + MELEE_BODY_BONUS;
    box.t = p.y - h - 2;
    box.b = p.y + 2;
    return;
  }
  if (p.atkKind === AttackKind.AIR_NEUTRAL) {
    // tout autour du corps
    box.l = p.x - hw - spec.reach;
    box.r = p.x + hw + spec.reach;
    box.t = p.y - h - spec.reach * 0.5;
    box.b = p.y + spec.reach * 0.5;
    return;
  }
  if (p.atkKind === AttackKind.AIR_SIDE) {
    // large balayage devant, du haut à mi-jambes
    const reach = spec.reach + MELEE_BODY_BONUS;
    if (p.facing > 0) {
      box.l = p.x;
      box.r = p.x + hw + reach;
    } else {
      box.l = p.x - hw - reach;
      box.r = p.x;
    }
    box.t = p.y - h - 6;
    box.b = p.y + 4;
    return;
  }
  if (p.atkKind === AttackKind.AIR_UP) {
    // au-dessus de la tête, un peu des deux côtés
    box.l = p.x - hw - 8;
    box.r = p.x + hw + 8;
    box.t = p.y - h - spec.reach;
    box.b = p.y - h * 0.3;
    return;
  }
  if (p.atkKind === AttackKind.AIR_DOWN) {
    // sous les pieds, un peu devant
    box.l = p.x - hw - 3 - (p.facing < 0 ? 5 : 0);
    box.r = p.x + hw + 3 + (p.facing > 0 ? 5 : 0);
    box.t = p.y - 6;
    box.b = p.y + spec.reach;
    return;
  }
  if (p.atkKind === AttackKind.UPPER) {
    // au-dessus de la tête, un peu vers l'avant
    box.l = p.x - hw - 4 - (p.facing < 0 ? 8 : 0);
    box.r = p.x + hw + 4 + (p.facing > 0 ? 8 : 0);
    box.t = p.y - h - spec.reach;
    box.b = p.y - h * 0.3;
    return;
  }
  // Le corps est plus mince que lorsque les allonges ont été réglées (12,8 → 9) : on garde la même
  // portée depuis le centre en ajoutant ce que la demi-largeur a perdu.
  const reach = spec.reach + MELEE_BODY_BONUS;
  if (p.facing > 0) {
    box.l = p.x;
    box.r = p.x + hw + reach;
  } else {
    box.l = p.x - hw - reach;
    box.r = p.x;
  }
  if (spec.halfHeight > 0) {
    const cy = p.y - h * 0.55;
    box.t = cy - spec.halfHeight;
    box.b = cy + spec.halfHeight;
  } else {
    box.t = p.y - h - 2;
    box.b = p.y + 2;
  }
}

/**
 * Zone de frappe de mêlée de `p` à ce tick, ou null s'il ne porte pas de coup de mêlée actif. Le
 * client s'en sert pour confirmer à l'écran un coup qui touche, sans attendre le serveur ; le
 * rectangle est réutilisé d'un appel à l'autre (à lire tout de suite). `meleeHeavy` dit ensuite si
 * c'est un gros coup.
 */
export function meleeHitBox(world: World, p: Player): Readonly<typeof box> | null {
  if (p.atkPhase !== AtkPhase.ACTIVE || !meleeSpec(p)) return null;
  meleeBox(world, p);
  return box;
}

/** Le dernier coup lu par `meleeHitBox` est-il un gros coup ? */
export function meleeHeavy(): boolean {
  return (spec.flags & HitFlag.HEAVY) !== 0;
}

/** Détecte les coups de mêlée du tick : un coup au plus par attaque et par cible. */
export function resolveMelee(world: World): void {
  const hw = world.params.width * 0.5;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!p.active || p.dead || p.ghost || p.atkPhase !== AtkPhase.ACTIVE) continue;
    if (!meleeSpec(p)) continue;
    meleeBox(world, p);
    if (p.atkKind === AttackKind.WEAPON && p.atkTicks === 0) {
      const w = weaponDef(p.weapon);
      if (w.stamp) {
        emit(world, SimEvent.STAMP, s, p.x + p.facing * (hw + w.reach), p.y);
      }
    }
    let hitAny = false;
    for (let v = 0; v < MAX_PLAYERS; v++) {
      if (v === s || (p.hitMask & (1 << v)) !== 0) continue;
      const q = world.players[v];
      if (!q.active || q.dead || q.ghost) continue;
      rewoundBox(world, v, p.rewind);
      const l = rewound.x - hw;
      const r = rewound.x + hw;
      const t = rewound.y - rewound.h;
      const b = rewound.y;
      if (r < box.l || l > box.r || b < box.t || t > box.b) continue;
      p.hitMask |= 1 << v;
      hitAny = true;
      const dir =
        p.atkKind === AttackKind.UPPER ||
        p.atkKind === AttackKind.AIR_DOWN ||
        p.atkKind === AttackKind.AIR_NEUTRAL ||
        p.atkKind === AttackKind.AIR_UP ||
        p.atkKind === AttackKind.SPECIAL_DOWN
          ? q.x >= p.x
            ? 1
            : -1
          : p.facing;
      let kx = dir * spec.kbx;
      let ky = spec.kby;
      if (p.atkKind === AttackKind.CHARGED) {
        // La projection suit la direction du coup : haut = lancer, bas = smash vers le sol.
        const side = Math.abs(cdir.x) > 0.4;
        const sx = side ? (cdir.x > 0 ? 1 : -1) : q.x >= p.x ? 1 : -1;
        if (cdir.y < -0.4) {
          kx = sx * spec.kbx * (side ? 0.7 : 0.25);
          ky = -(Math.abs(spec.kby) * 1.5 + spec.kbx * 0.2);
        } else if (cdir.y > 0.4) {
          kx = sx * spec.kbx * 0.3;
          ky = spec.kbx * 0.8;
        } else {
          kx = sx * spec.kbx;
        }
      }
      if (p.atkKind === AttackKind.WEAPON && weaponDef(p.weapon).cuts) q.grappleTicks = 0;
      queueHit(world, v, s, spec.damage, kx, ky, spec.stun, spec.cause, spec.flags, p.x, p.y - 14);
    }
    // Ciseaux : coupent les crochets de grappin en vol.
    if (p.atkKind === AttackKind.WEAPON && weaponDef(p.weapon).cuts) {
      for (let i = 0; i < world.projectiles.length; i++) {
        const pr = world.projectiles[i];
        if (!pr.active || pr.type !== ProjType.HOOK) continue;
        if (pr.x < box.l - 6 || pr.x > box.r + 6 || pr.y < box.t - 6 || pr.y > box.b + 6) continue;
        pr.active = false;
        emit(world, SimEvent.GRAPPLE, pr.owner, pr.x, pr.y, 254);
      }
    }
    // Objets : caisses, ballons, boule.
    for (let i = 0; i < world.objects.length; i++) {
      const o = world.objects[i];
      if (!o.active) continue;
      if (
        o.type !== ObjType.CRATE &&
        o.type !== ObjType.BALLOON &&
        o.type !== ObjType.BALL &&
        o.type !== ObjType.COVER
      )
        continue;
      // un coup ne touche un objet qu'une fois (comme `hitMask` pour les joueurs)
      if ((o.hitBy & (1 << s)) !== 0) continue;
      if (o.x + o.w / 2 < box.l || o.x - o.w / 2 > box.r || o.y < box.t || o.y - o.h > box.b)
        continue;
      o.hitBy |= 1 << s;
      if (o.type === ObjType.BALL) kickBall(world, o, p, spec.kbx, spec.kby);
      else damageObject(world, o, Math.max(spec.damage, 8), s);
    }
    if (hitAny && p.atkKind === AttackKind.AIR_DOWN) p.vy = -COMBAT.airDown.bounce;
  }
}

// --- Explosions --------------------------------------------------------------------------------

const down: RayHit = { dist: 0, cx: 0, cy: 0 };

export function explode(
  world: World,
  x: number,
  y: number,
  ex: Explosion,
  owner: number,
  cause: number,
  kind: number,
): void {
  emit(world, SimEvent.EXPLOSION, 0, x, y, ex.radius, kind);
  const hw = world.params.width * 0.5;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!p.active || p.dead || p.ghost) continue;
    const cy = p.y - bodyHeight(world, p) * 0.5;
    const dx = p.x - x;
    const dy = cy - y;
    const dist = Math.hypot(dx, dy);
    const reach = ex.radius + hw;
    if (dist > reach) continue;
    const fall = Math.max(0.25, 1 - dist / reach);
    const ux = dist > 0.01 ? dx / dist : 0;
    const uy = dist > 0.01 ? dy / dist : -1;
    queueHit(
      world,
      s,
      owner,
      ex.damage * fall,
      ux * ex.kb * fall,
      uy * ex.kb * fall - ex.kb * fall * 0.35,
      ex.damage >= 25 ? 24 : 0,
      cause,
      HitFlag.UNBLOCKABLE | HitFlag.HEAVY,
      x,
      y,
    );
  }
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i];
    if (!o.active) continue;
    if (o.type === ObjType.CRATE || o.type === ObjType.BALLOON || o.type === ObjType.COVER) {
      const dist = Math.hypot(o.x - x, o.y - o.h / 2 - y);
      if (dist <= ex.radius + o.w / 2) damageObject(world, o, ex.damage, owner);
    } else if (o.type === ObjType.MINE && o.b === 1) {
      const dist = Math.hypot(o.x - x, o.y - y);
      if (dist <= ex.radius) triggerMine(world, o);
    } else if (o.type === ObjType.BALL) {
      const dx = o.x - x;
      const dy = o.y - o.h / 2 - y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ex.radius + o.w / 2 && dist > 0.01) {
        o.vx += (dx / dist) * ex.kb * 0.8;
        o.vy += (dy / dist) * ex.kb * 0.8 - 120;
      }
    }
  }
  if (ex.destroys) explodeTerrain(world, x, y, ex.radius);
  if (ex.puddle && raycastGrid(world, x, y, 0, 1, 64, down)) {
    const floorY = y + down.dist;
    addPuddle(world, x, floorY, 72, world.tick);
    emit(world, SimEvent.PUDDLE, 0, x, floorY, 72, world.tick & 0xffff, world.tick >>> 16);
  }
}

// --- Visée et tir instantané -------------------------------------------------------------------

export interface Trace {
  /** 0 rien, 1 décor, 2 joueur, 3 objet. */
  kind: number;
  dist: number;
  slot: number;
  obj: Obj | null;
}
export const trace: Trace = { kind: 0, dist: 0, slot: -1, obj: null };
const wall: RayHit = { dist: 0, cx: 0, cy: 0 };

/**
 * Lance un rayon depuis (ox, oy) dans la direction unitaire (dx, dy). Le résultat est dans `trace`.
 * Les joueurs sont testés à leur position d'il y a `rewind` ticks (compensation de latence).
 */
export function traceRay(
  world: World,
  shooter: number,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  rewind: number,
): void {
  trace.kind = 0;
  trace.dist = maxDist;
  trace.slot = -1;
  trace.obj = null;
  if (raycastGrid(world, ox, oy, dx, dy, maxDist, wall)) {
    trace.kind = 1;
    trace.dist = wall.dist;
  }
  const ex = ox + dx * trace.dist;
  const ey = oy + dy * trace.dist;
  const hw = world.params.width * 0.5;
  let best = 1;
  const full = trace.dist;
  for (let v = 0; v < MAX_PLAYERS; v++) {
    if (v === shooter) continue;
    const q = world.players[v];
    if (!q.active || q.dead || q.ghost || q.invuln > 0) continue;
    if (isTeammate(world, shooter, v) && !world.rules.friendlyFire) continue;
    rewoundBox(world, v, rewind);
    const t = segmentBox(
      ox,
      oy,
      ex,
      ey,
      rewound.x - hw,
      rewound.y - rewound.h,
      rewound.x + hw,
      rewound.y,
    );
    if (t >= 0 && t < best) {
      best = t;
      trace.kind = 2;
      trace.slot = v;
      trace.dist = full * t;
    }
  }
  for (let i = 0; i < world.objects.length; i++) {
    const o = world.objects[i];
    if (!o.active) continue;
    if (o.type !== ObjType.CRATE && o.type !== ObjType.BALLOON && o.type !== ObjType.COVER)
      continue;
    const t = segmentBox(ox, oy, ex, ey, o.x - o.w / 2, o.y - o.h, o.x + o.w / 2, o.y);
    if (t >= 0 && t < best) {
      best = t;
      trace.kind = 3;
      trace.obj = o;
      trace.slot = -1;
      trace.dist = full * t;
    }
  }
}

const ASSIST_CONE = 0.35;
const ASSIST_MAX = 0.14;

/**
 * Aide à la visée, identique pour tous les appareils : la direction (une des 8) est corrigée d'au
 * plus 8° vers la cible la plus proche située dans un cône. Résultat dans `aimDir`.
 */
export const aimDir = { x: 1, y: 0 };

export function assistAim(world: World, slot: number, range: number, rewind: number): void {
  const p = world.players[slot];
  let ux = AIM_DX[p.aim];
  let uy = AIM_DY[p.aim];
  const n = Math.hypot(ux, uy);
  ux /= n;
  uy /= n;
  const ox = p.x;
  const oy = p.y - bodyHeight(world, p) * 0.6;
  let bestDiff = 0;
  let bestAbs = ASSIST_CONE;
  let bestDist = Infinity;
  for (let v = 0; v < MAX_PLAYERS; v++) {
    if (v === slot) continue;
    const q = world.players[v];
    if (!q.active || q.dead || q.ghost) continue;
    if (isTeammate(world, slot, v)) continue;
    rewoundBox(world, v, rewind);
    const tx = rewound.x - ox;
    const ty = rewound.y - rewound.h * 0.5 - oy;
    const d = Math.hypot(tx, ty);
    if (d < 1 || d > range) continue;
    const diff = Math.atan2(ux * ty - uy * tx, ux * tx + uy * ty);
    const abs = Math.abs(diff);
    if (abs <= bestAbs && d < bestDist) {
      bestAbs = abs;
      bestDiff = diff;
      bestDist = d;
    }
  }
  const corr = Math.max(-ASSIST_MAX, Math.min(ASSIST_MAX, bestDiff));
  const c = Math.cos(corr);
  const s = Math.sin(corr);
  aimDir.x = ux * c - uy * s;
  aimDir.y = ux * s + uy * c;
}
