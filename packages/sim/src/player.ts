import {
  aimFromInput,
  aimOfInput,
  AIM_DX,
  AIM_DY,
  AtkPhase,
  AttackKind,
  COMBAT,
  DT,
  FIST,
  fistPhaseTicks,
  Input,
  PlayerState,
  SimEvent,
  WeaponId,
  WeaponKind,
  weaponChargeLevel,
  weaponDef,
} from '@stickyclaude/shared';
import type { WeaponDef } from '@stickyclaude/shared';
import {
  GROUND_ONEWAY,
  GROUND_SOLID,
  hasHeadroom,
  moveX,
  moveY,
  probeGround,
  probeMover,
  trampolineBelow,
  wallContact,
} from './collision.ts';
import { inPuddle, PUDDLE_GRIP } from './terrain.ts';
import { clearSwingHits, emit } from './world.ts';
import type { Player, World } from './world.ts';

/** Appui d'attaque mémorisé (ticks), comme la mémoire du saut. */
const ATK_BUFFER_TICKS = 6;
/** Durée du geste d'un lancer à l'attaque (avant que la charge ne s'ajoute). */
const THROW_STARTUP = 3;

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) {
    v += maxDelta;
    return v > target ? target : v;
  }
  v -= maxDelta;
  return v < target ? target : v;
}

/** Durée (ticks) d'une phase de l'attaque courante ; 0 = phase de durée libre. */
export function phaseTicks(p: Player, phase: number): number {
  const fist = fistPhaseTicks(p.atkKind, phase);
  if (fist >= 0) return fist;
  switch (p.atkKind) {
    case AttackKind.THROW:
      return phase === AtkPhase.STARTUP ? THROW_STARTUP : phase === AtkPhase.ACTIVE ? 1 : 8;
    default: {
      const w = weaponDef(p.weapon);
      return phase === AtkPhase.STARTUP
        ? w.startup
        : phase === AtkPhase.ACTIVE
          ? w.active
          : w.recovery;
    }
  }
}

/** Un lancer chargé est en cours : « ramasser » tenu avec une arme en main. */
export function throwCharging(p: Player): boolean {
  return p.chargeTicks > 0 && p.weapon !== 0 && p.atkPhase === AtkPhase.NONE && !p.dodging;
}

/**
 * La récupération d'un coup léger (poings, balayage, coups aériens) peut être coupée par n'importe
 * quelle autre action : autre coup, dash, saut, défense, attaque spéciale. Les attaques spéciales,
 * elles, laissent une longue récupération qu'on ne coupe pas.
 */
function cancelableRecovery(p: Player): boolean {
  if (p.atkPhase !== AtkPhase.RECOVERY) return false;
  switch (p.atkKind) {
    case AttackKind.FIST1:
    case AttackKind.FIST2:
    case AttackKind.FIST3:
    case AttackKind.UPPER:
    case AttackKind.CROUCH:
    case AttackKind.AIR_NEUTRAL:
    case AttackKind.AIR_SIDE:
    case AttackKind.AIR_UP:
    case AttackKind.AIR_DOWN:
      return true;
    default:
      return false;
  }
}

function endAttack(p: Player): void {
  p.atkPhase = AtkPhase.NONE;
  p.atkKind = AttackKind.NONE;
  p.atkTicks = 0;
  p.combo = 0;
  p.comboWindow = 0;
}

/** Annule toute action en cours (touché, étourdi, mort). */
export function cancelActions(p: Player): void {
  p.atkPhase = AtkPhase.NONE;
  p.atkKind = AttackKind.NONE;
  p.atkTicks = 0;
  p.chargeTicks = 0;
  p.dashTicks = 0;
  p.dodging = false;
  p.atkBuffer = 0;
  p.combo = 0;
  p.comboWindow = 0;
  p.wantFire = false;
  p.wantThrow = false;
}

function startFist(p: Player, idx: number): void {
  p.atkKind = AttackKind.FIST1 + idx;
  p.atkPhase = AtkPhase.STARTUP;
  p.atkTicks = 0;
  p.combo = idx + 1;
  p.comboWindow = 0;
  p.atkBuffer = 0;
}

function enterPhase(world: World, p: Player, slot: number, phase: number): void {
  const held = p.atkTicks;
  p.atkPhase = phase;
  p.atkTicks = 0;
  if (phase === AtkPhase.ACTIVE) onActiveStart(world, p, slot, held);
  else if (phase === AtkPhase.RECOVERY) {
    const k = p.atkKind;
    if (k === AttackKind.FIST1 || k === AttackKind.FIST2) p.comboWindow = COMBAT.comboWindowTicks;
  }
}

function onActiveStart(world: World, p: Player, slot: number, held: number): void {
  p.hitMask = 0;
  clearSwingHits(world, slot);
  const k = p.atkKind;
  const dir = p.facing;
  emit(world, SimEvent.SWING, slot, p.x, p.y, k);
  if (k === AttackKind.FIST1 || k === AttackKind.FIST2 || k === AttackKind.FIST3) {
    const a = FIST[k - AttackKind.FIST1];
    if (Math.abs(p.vx) < a.lunge) p.vx = dir * a.lunge;
  } else if (k === AttackKind.CHARGED) {
    // L'élan suit la visée : un coup chargé vers le haut ou le bas ne propulse pas de côté.
    const ux = AIM_DX[p.aim] / Math.hypot(AIM_DX[p.aim], AIM_DY[p.aim]);
    if (Math.abs(ux) > 0.4 && Math.abs(p.vx) < COMBAT.charged.lunge) {
      p.vx = Math.sign(ux) * COMBAT.charged.lunge;
    }
  } else if (k === AttackKind.THROW) {
    // L'arme quitte la main tout de suite (prédit) ; la passe d'autorité crée le projectile.
    p.throwLevel = throwLevel(held - THROW_STARTUP);
    p.throwW = p.weapon;
    p.throwA = p.ammo;
    p.weapon = 0;
    p.ammo = 0;
    p.wantThrow = true;
  } else if (k === AttackKind.WEAPON || k === AttackKind.SHOOT || k === AttackKind.BASH) {
    const w = weaponDef(p.weapon);
    // Arme chargeable (arc, mêlée) : la durée de maintien est conservée pour l'impact ou le tir.
    p.chargeTicks = w.chargeMax > 0 && weaponChargeLevel(w, held) > 0 ? held : 0;
    // Le bouclier s'use quand il encaisse, pas quand il frappe.
    if (k !== AttackKind.BASH && p.ammo > 0) p.ammo--;
    if (k === AttackKind.SHOOT) {
      p.wantFire = true;
      if (w.recoil > 0 && w.kind !== WeaponKind.MINE) {
        const a = p.aim;
        p.vx -= AIM_DX[a] * w.recoil;
      }
    }
  }
}

function startWeaponUse(p: Player, w: WeaponDef): void {
  p.atkPhase = AtkPhase.STARTUP;
  p.atkTicks = 0;
  p.atkBuffer = 0;
  p.combo = 0;
  p.comboWindow = 0;
  switch (w.kind) {
    case WeaponKind.MELEE:
      p.atkKind = AttackKind.WEAPON;
      break;
    case WeaponKind.SHIELD:
      p.atkKind = AttackKind.BASH;
      break;
    default:
      p.atkKind = AttackKind.SHOOT;
  }
}

/** Charge d'un lancer (0 à 1) après `ticks` ticks de maintien au-delà du geste de base. */
function throwLevel(ticks: number): number {
  const span = COMBAT.throwChargeMax - THROW_STARTUP;
  return ticks <= 0 ? 0 : Math.min(1, ticks / span);
}

function startThrow(p: Player): void {
  p.atkKind = AttackKind.THROW;
  p.atkPhase = AtkPhase.STARTUP;
  p.atkTicks = 0;
  p.atkBuffer = 0;
  p.combo = 0;
  p.comboWindow = 0;
}

/**
 * Direction (secteur de visée) des touches directionnelles seules, sans la souris : celle qui
 * choisit un coup. Sans touche, le personnage regarde dans sa direction.
 */
function keySector(input: number, facing: number): number {
  const a = aimFromInput(input);
  return a >= 0 ? a : facing > 0 ? 0 : 8;
}

/**
 * Passe 1, actions : parade, enchaînement de coups, attaque spéciale, utilisation d'arme, demande
 * de ramassage. Ne dépend que de l'état du joueur et de ses entrées (prédictible côté client).
 *
 * Le moveset : clic gauche (`ATTACK`) = coups légers, non chargeables, qui dépendent de la
 * direction tenue et de l'appui au sol ou en l'air ; clic droit (`SPECIAL`) = attaque spéciale,
 * chargeable au sol, ruée ou esquive en l'air ; `BLOCK` = parade maintenue, du côté où regarde le
 * personnage, impossible avec une arme.
 */
function stepActions(world: World, p: Player, slot: number, input: number, pressed: number): void {
  const weapon = weaponDef(p.weapon);
  const fists = weapon.kind === WeaponKind.FISTS;

  // Visée : la souris ou le stick, sinon les touches. Un coup spécial en cours garde la direction
  // choisie au départ (c'est elle que dessinent aussi les autres joueurs).
  if (!(p.atkPhase !== AtkPhase.NONE && p.atkKind === AttackKind.CHARGED)) {
    const a = p.chargeTicks > 0 && fists ? keySector(input, p.facing) : aimOfInput(input);
    p.aim = a >= 0 ? a : p.facing > 0 ? 0 : 8;
  }

  if ((input & Input.ATTACK) !== 0) {
    if (p.attackHeld < 255) p.attackHeld++;
  } else p.attackHeld = 0;
  if ((pressed & Input.ATTACK) !== 0) p.atkBuffer = ATK_BUFFER_TICKS;
  else if (p.atkBuffer > 0) p.atkBuffer--;
  if ((pressed & Input.PICKUP) !== 0 && p.pickupCd === 0) {
    if ((input & Input.DOWN) !== 0 && p.weapon !== 0) {
      p.pickupCd = COMBAT.pickupCooldownTicks;
      p.wantDrop = true;
    } else if (
      p.weapon !== 0 &&
      p.chargeTicks === 0 &&
      p.blockTicks === 0 &&
      p.atkPhase === AtkPhase.NONE
    ) {
      // Une arme en main : on arme le lancer ; un appui bref ramasse ou lance doucement.
      p.chargeTicks = 1;
    } else {
      p.pickupCd = COMBAT.pickupCooldownTicks;
      p.wantPickup = true;
    }
  } else if (throwCharging(p)) {
    if ((input & Input.PICKUP) !== 0) {
      if (p.chargeTicks < COMBAT.throwChargeMax) p.chargeTicks++;
    } else {
      p.pickupCd = COMBAT.pickupCooldownTicks;
      if (p.chargeTicks < COMBAT.throwHoldTicks) {
        p.chargeTicks = 0;
        p.wantPickup = true;
      } else {
        p.throwLevel = throwLevel(p.chargeTicks - COMBAT.throwHoldTicks + 1);
        p.chargeTicks = 0;
        p.throwW = p.weapon;
        p.throwA = p.ammo;
        p.weapon = 0;
        p.ammo = 0;
        p.wantThrow = true;
      }
    }
  }

  // --- Parade : bouton maintenu, bras devant (côté où l'on regarde), impossible avec une arme ---
  const defending = (input & Input.BLOCK) !== 0 && p.weapon === 0;
  if (p.blockTicks > 0) {
    if (defending) {
      if (p.blockTicks < 255) p.blockTicks++;
    } else {
      p.blockTicks = 0;
      p.blockCd = COMBAT.blockCooldownTicks;
    }
  } else {
    if (p.blockCd > 0) p.blockCd--;
    if (
      defending &&
      p.blockCd === 0 &&
      (p.atkPhase === AtkPhase.NONE || cancelableRecovery(p)) &&
      p.chargeTicks === 0
    ) {
      if (p.atkPhase !== AtkPhase.NONE) endAttack(p);
      // Seul un nouvel appui ouvre la fenêtre de parade parfaite : une garde qui se relève d'elle-même
      // (bouton resté tenu pendant la recharge ou pendant un coup) commence après cette fenêtre.
      p.blockTicks = (pressed & Input.BLOCK) !== 0 ? 1 : COMBAT.perfectParryTicks + 1;
      p.atkBuffer = 0;
    }
  }
  if (p.blockTicks > 0) return;
  // Parade tenue : on n'attaque pas, même pendant la recharge d'une parade qui vient d'encaisser.
  if (defending) {
    p.atkBuffer = 0;
    return;
  }

  // --- Progression de l'attaque en cours ------------------------------------------------------
  if (p.atkPhase !== AtkPhase.NONE) {
    p.atkTicks++;
    const dur = phaseTicks(p, p.atkPhase);
    // Arc et armes de mêlée : tant que l'attaque est tenue, le geste reste armé (charge).
    const drawing =
      p.atkPhase === AtkPhase.STARTUP &&
      (input & Input.ATTACK) !== 0 &&
      ((weapon.chargeMax > 0 &&
        (p.atkKind === AttackKind.WEAPON || p.atkKind === AttackKind.SHOOT) &&
        p.atkTicks < weapon.chargeMax) ||
        (p.atkKind === AttackKind.THROW && p.atkTicks < COMBAT.throwChargeMax));
    if (p.atkTicks >= dur && !drawing) {
      if (p.atkPhase === AtkPhase.STARTUP) enterPhase(world, p, slot, AtkPhase.ACTIVE);
      else if (p.atkPhase === AtkPhase.ACTIVE) enterPhase(world, p, slot, AtkPhase.RECOVERY);
      else finishAttack(p);
      // Une phase de durée nulle est franchie dans le même tick.
      if (p.atkPhase !== AtkPhase.NONE && phaseTicks(p, p.atkPhase) === 0) {
        if (p.atkPhase === AtkPhase.ACTIVE) enterPhase(world, p, slot, AtkPhase.RECOVERY);
        else if (p.atkPhase === AtkPhase.RECOVERY) finishAttack(p);
      }
    }
  }
  if (p.comboWindow > 0) {
    p.comboWindow--;
    if (p.comboWindow === 0 && p.atkPhase === AtkPhase.NONE) p.combo = 0;
  }

  // --- Attaque spéciale au sol, mains nues : charge puis frappe --------------------------------
  if (fists && p.chargeTicks === 0) {
    if (
      (pressed & Input.SPECIAL) !== 0 &&
      p.grounded &&
      (p.atkPhase === AtkPhase.NONE || cancelableRecovery(p))
    ) {
      if (p.atkPhase !== AtkPhase.NONE) endAttack(p);
      p.chargeTicks = 1;
      p.atkBuffer = 0;
      p.combo = 0;
      p.comboWindow = 0;
    }
  } else if (fists && p.atkPhase === AtkPhase.NONE) {
    if (!p.grounded) {
      // On a quitté le sol (rebord, plateforme mobile) : la charge est perdue.
      p.chargeTicks = 0;
    } else if ((input & Input.SPECIAL) !== 0) {
      if (p.chargeTicks < COMBAT.chargeMaxTicks) p.chargeTicks++;
    } else {
      // Relâché : le coup part dans la direction tenue (bas : de chaque côté ; haut ; côté).
      p.atkPhase = AtkPhase.STARTUP;
      p.atkTicks = 0;
      p.atkBuffer = 0;
      if ((input & Input.DOWN) !== 0) {
        p.atkKind = AttackKind.SPECIAL_DOWN;
      } else {
        p.atkKind = AttackKind.CHARGED;
        const dx = ((input & Input.RIGHT) !== 0 ? 1 : 0) - ((input & Input.LEFT) !== 0 ? 1 : 0);
        if ((input & Input.UP) !== 0) p.aim = 12;
        else {
          if (dx !== 0) p.facing = dx;
          p.aim = p.facing > 0 ? 0 : 8;
        }
      }
    }
  }

  // --- Départ d'une nouvelle attaque ----------------------------------------------------------
  if (
    (weapon.kind === WeaponKind.HITSCAN || weapon.kind === WeaponKind.PROJECTILE) &&
    (input & Input.ATTACK) !== 0 &&
    p.ammo > 0
  ) {
    p.atkBuffer = Math.max(p.atkBuffer, 1);
  }
  if (p.atkBuffer === 0 || p.chargeTicks > 0) return;
  const chain =
    fists && p.atkPhase === AtkPhase.RECOVERY && p.comboWindow > 0 && p.combo >= 1 && p.combo <= 2;
  // Un coup léger se coupe en récupération : le nouvel appui part tout de suite.
  const cancel = fists && !chain && cancelableRecovery(p);
  if (p.atkPhase !== AtkPhase.NONE && !chain && !cancel) return;
  if (cancel) endAttack(p);

  if (fists) {
    // Le personnage se retourne vers la direction tenue avant de frapper.
    const dx = ((input & Input.RIGHT) !== 0 ? 1 : 0) - ((input & Input.LEFT) !== 0 ? 1 : 0);
    if (dx !== 0) p.facing = dx;
    const up = (input & Input.UP) !== 0;
    const down = (input & Input.DOWN) !== 0;
    if (p.grounded) {
      if (down) startSpecial(p, AttackKind.CROUCH);
      else if (up) startSpecial(p, AttackKind.UPPER);
      else {
        const next = p.comboWindow > 0 && p.combo >= 1 && p.combo <= 2 ? p.combo : 0;
        startFist(p, next);
      }
    } else if (down) startSpecial(p, AttackKind.AIR_DOWN);
    else if (up) startSpecial(p, AttackKind.AIR_UP);
    else if (dx !== 0) startSpecial(p, AttackKind.AIR_SIDE);
    else startSpecial(p, AttackKind.AIR_NEUTRAL);
  } else if (weapon.kind === WeaponKind.CRATE || p.ammo === 0) {
    startThrow(p);
  } else {
    startWeaponUse(p, weapon);
  }
}

/** Coup léger à direction (haut, bas, aérien) : jamais enchaîné, pas de fenêtre de combo. */
function startSpecial(p: Player, kind: number): void {
  p.atkKind = kind;
  p.atkPhase = AtkPhase.STARTUP;
  p.atkTicks = 0;
  p.atkBuffer = 0;
  p.combo = 0;
  p.comboWindow = 0;
}

function finishAttack(p: Player): void {
  const wasFinisher = p.atkKind === AttackKind.FIST3;
  const wasCharged = p.atkKind === AttackKind.CHARGED || p.atkKind === AttackKind.SPECIAL_DOWN;
  const wasThrow = p.atkKind === AttackKind.THROW;
  const wasWeapon = p.atkKind === AttackKind.WEAPON || p.atkKind === AttackKind.SHOOT;
  p.atkPhase = AtkPhase.NONE;
  p.atkKind = AttackKind.NONE;
  p.atkTicks = 0;
  if (wasFinisher) {
    p.combo = 0;
    p.comboWindow = 0;
  }
  if (wasCharged || wasWeapon) p.chargeTicks = 0;
  if (wasThrow) p.combo = 0;
}

/**
 * Un pas d'un joueur vivant : minuteries, actions, mouvement, état d'animation. Passe 1 : ne
 * dépend que du joueur, de ses entrées et du décor (donc identique côté client et serveur).
 */
export function stepPlayer(world: World, p: Player, slot: number, input: number): void {
  const P = world.params;
  const pressed = input & ~p.prevInput;
  const jumpHeld = (input & Input.JUMP) !== 0;
  const downHeld = (input & Input.DOWN) !== 0;
  const downPressed = (pressed & Input.DOWN) !== 0;
  p.prevInput = input;

  // --- Minuteries -----------------------------------------------------------------------------
  if (p.invuln > 0) p.invuln--;
  if (p.hitLock > 0) p.hitLock--;
  if (p.pickupCd > 0) p.pickupCd--;
  if (p.stunImmune > 0) p.stunImmune--;
  if (p.hazardCd > 0) p.hazardCd--;
  if (p.tackCd > 0) p.tackCd--;
  if (p.bombPassCd > 0) p.bombPassCd--;
  if (p.dashCd > 0) p.dashCd--;
  if (p.glueTicks > 0) p.glueTicks--;
  if (p.stun > 0) {
    p.stun--;
    if (p.stun === 0) p.stunImmune = COMBAT.stunImmuneTicks;
    cancelActions(p);
    p.blockTicks = 0;
    p.attackHeld = 0;
  } else if (p.dodging) {
    // Pendant l'esquive on ne frappe ni ne pare : seule la fin de l'esquive rend la main.
    p.attackHeld = 0;
    p.atkBuffer = 0;
  } else {
    stepActions(world, p, slot, input, pressed);
  }
  if (p.dropTimer > 0) p.dropTimer--;
  if (p.wallLock > 0) p.wallLock--;
  if (p.jumpBuffer > 0) p.jumpBuffer--;

  // --- Contrôle -------------------------------------------------------------------------------
  const w = weaponDef(p.weapon);
  let mul = 1;
  // Au sol, parer, frapper ou charger ralentit ; en l'air on garde son élan (un coup aérien ne
  // freine pas la trajectoire).
  if (p.grounded) {
    if (p.blockTicks > 0) mul = COMBAT.blockSpeedMul;
    else if (p.atkPhase !== AtkPhase.NONE) mul = COMBAT.attackSpeedMul;
    else if (p.chargeTicks > 0) mul = COMBAT.chargeSpeedMul;
  }
  if (w.kind === WeaponKind.SHIELD) mul *= w.slowMul;
  if (p.glueTicks > 0) mul *= COMBAT.glueSpeedMul;
  p.moveMul = mul;
  p.ctrlLocked = p.hitLock > 0 || p.stun > 0;
  p.jumpLocked = p.blockTicks > 0 || p.chargeTicks > 0 || p.stun > 0 || p.dodging;

  const jumpPressed = (pressed & Input.JUMP) !== 0 && !p.jumpLocked;
  if (jumpPressed) p.jumpBuffer = P.jumpBufferTicks;
  const dir = p.ctrlLocked
    ? 0
    : ((input & Input.RIGHT) !== 0 ? 1 : 0) - ((input & Input.LEFT) !== 0 ? 1 : 0);

  // --- Dash : ruée sans gravité dans l'une des huit directions tenues ; sans direction, esquive ---
  const busy =
    p.ctrlLocked ||
    p.blockTicks > 0 ||
    p.chargeTicks > 0 ||
    (p.atkPhase !== AtkPhase.NONE && !cancelableRecovery(p)) ||
    p.grappleTicks > 0;
  // Clic droit en l'air, mains nues : ruée invulnérable dans la direction tenue, ou esquive sur place.
  const airSpecial = (pressed & Input.SPECIAL) !== 0 && !p.grounded && p.weapon === 0;
  if (busy) {
    p.dashTicks = 0;
    p.dodging = false;
  } else if (
    ((pressed & Input.DASH) !== 0 || airSpecial) &&
    p.dashCd === 0 &&
    p.dashTicks === 0 &&
    p.glueTicks === 0
  ) {
    if (p.atkPhase !== AtkPhase.NONE) endAttack(p);
    p.jumping = false;
    p.wallLock = 0;
    // Bas seul au sol : on s'accroupit, le dash n'a pas de direction verticale.
    let dy = ((input & Input.DOWN) !== 0 ? 1 : 0) - ((input & Input.UP) !== 0 ? 1 : 0);
    if (dy > 0 && p.grounded) dy = 0;
    if (dir !== 0 || dy !== 0) {
      const sp = COMBAT.airSpecial;
      p.dashTicks = P.dashTicks + (airSpecial ? sp.extraTicks : 0);
      p.dashCd = P.dashCooldownTicks + (airSpecial ? sp.extraCooldownTicks : 0);
      p.dashX = dir;
      p.dashY = dy;
      if (dir !== 0) p.facing = dir;
      // Spécial aérien : invulnérable sauf pendant les derniers ticks de la ruée.
      if (airSpecial && p.invuln < p.dashTicks - sp.vulnerableTicks) {
        p.invuln = p.dashTicks - sp.vulnerableTicks;
      }
      emit(world, SimEvent.DASH, slot, p.x, p.y, p.facing, airSpecial ? 1 : 0);
    } else {
      p.dashX = 0;
      p.dashY = 0;
      // Dash sans direction : esquive sur place, invulnérable (comme dans Brawlhalla).
      p.dodging = true;
      p.dashTicks = P.dodgeTicks;
      p.dashCd = P.dodgeCooldownTicks;
      if (p.invuln < P.dodgeTicks) p.invuln = P.dodgeTicks;
      emit(world, SimEvent.DODGE, slot, p.x, p.y, p.facing);
    }
  }

  // --- Sol ------------------------------------------------------------------------------------
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

  // Traversée vers le bas d'une plateforme à sens unique : un appui sur « bas » suffit.
  if (downPressed && !p.jumpLocked && p.grounded && (ground & GROUND_SOLID) === 0) {
    if ((ground & GROUND_ONEWAY) !== 0 || p.groundMover >= 0) {
      p.dropTimer = P.dropThroughTicks;
      p.jumpBuffer = 0;
      p.grounded = false;
      p.groundMover = -1;
      p.coyote = 0;
      emit(world, SimEvent.DROP_THROUGH, slot, p.x, p.y);
    }
  }

  // --- Accroupi -------------------------------------------------------------------------------
  if (
    p.grounded &&
    downHeld &&
    !p.ctrlLocked &&
    (p.atkPhase === AtkPhase.NONE || p.atkKind === AttackKind.CROUCH)
  ) {
    p.crouching = true;
  } else if (p.crouching && hasHeadroom(world, p)) {
    p.crouching = false;
  }

  // --- Mur ------------------------------------------------------------------------------------
  let wall = 0;
  if (!p.grounded) {
    wall = wallContact(world, p, dir);
    if (wall !== 0) {
      p.wallSide = wall;
      p.wallCoyote = P.wallCoyoteTicks;
      // S'accrocher à un mur rend le double saut.
      p.doubleAvailable = true;
    } else if (p.wallCoyote > 0) {
      p.wallCoyote--;
    }
  }
  const wallSliding = !p.grounded && wall !== 0 && dir === wall && p.vy >= 0;

  // --- Sauts ----------------------------------------------------------------------------------
  // Sauter pendant la traction du grappin lâche la corde et garde l'élan.
  if (p.grappleTicks > 0 && jumpPressed) {
    p.grappleTicks = 0;
    p.jumpBuffer = 0;
    emit(world, SimEvent.GRAPPLE, slot, p.x, p.y, 254);
  }
  if (p.jumpBuffer > 0 && !p.jumpLocked) {
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
      p.doubleAvailable = true;
      p.jumpBuffer = 0;
      emit(world, SimEvent.WALL_JUMP, slot, p.x, p.y);
    } else if (jumpPressed && p.doubleAvailable) {
      // Le double saut a toujours la même hauteur : relâcher le bouton ne le raccourcit pas, même
      // si l'on enchaîne les deux appuis très vite.
      p.vy = -P.doubleJumpSpeed;
      p.doubleAvailable = false;
      p.jumping = false;
      p.dashTicks = 0;
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

  // Un saut (sol, mur ou double) interrompt le dash : on garde l'élan, pas l'apesanteur.
  if (p.jumping) p.dashTicks = 0;

  // --- Horizontal -----------------------------------------------------------------------------
  const slippery = p.grounded && inPuddle(world, p.x, p.y);
  if (p.grappleTicks > 0) {
    // Traction du grappin : la vitesse est imposée vers le point d'ancrage.
    const tx = p.grappleX - p.x;
    const ty = p.grappleY - (p.y - P.height * 0.5);
    const d = Math.hypot(tx, ty);
    if (d < 8) p.grappleTicks = 0;
    else {
      p.grappleTicks--;
      const speed = weaponDef(WeaponId.GRAPPLE).pullSpeed;
      p.vx = (tx / d) * speed;
      p.vy = (ty / d) * speed;
      p.jumping = false;
    }
  } else if (p.dashTicks > 0) {
    p.vx = p.dodging ? 0 : p.dashX * P.dashSpeed * (p.dashY !== 0 ? Math.SQRT1_2 : 1);
  } else if (p.wallLock === 0) {
    const maxSpeed = (p.crouching ? P.crouchSpeed : P.runSpeed) * p.moveMul;
    const target = dir * maxSpeed;
    let accel: number;
    if (p.ctrlLocked) {
      accel = p.grounded ? P.groundDecel * 0.3 : P.airDecel * 0.3;
    } else if (p.grounded) {
      if (dir === 0) accel = P.groundDecel;
      else if (p.vx !== 0 && p.vx > 0 !== dir > 0) accel = P.groundTurnAccel;
      else accel = P.groundAccel;
    } else {
      accel = dir === 0 ? P.airDecel : P.airAccel;
    }
    if (slippery) accel *= PUDDLE_GRIP;
    p.vx = approach(p.vx, target, accel * DT);
    // On se retourne tant que le coup n'est pas parti (départ et récupération) : enchaîner les
    // attaques ne fige plus la direction. En parade, on garde son côté : on recule en se protégeant.
    if (dir !== 0 && p.atkPhase !== AtkPhase.ACTIVE && p.blockTicks === 0) p.facing = dir;
  }

  // --- Vertical -------------------------------------------------------------------------------
  if (p.dashTicks > 0) {
    p.vy = p.dodging ? 0 : p.dashY * P.dashSpeed * (p.dashX !== 0 ? Math.SQRT1_2 : 1);
  } else if (p.grappleTicks <= 0) {
    let maxFall = P.maxFallSpeed;
    let g = P.gravity;
    if (!p.grounded && downHeld && p.vy > 0 && !wallSliding && !p.ctrlLocked) {
      g *= Math.max(P.fastFallGravityMul, P.fallGravityMul);
      maxFall = P.fastFallSpeed;
    } else if (!p.grounded && p.vy > 0 && !wallSliding) {
      g *= P.fallGravityMul;
    }
    p.vy += g * DT;
    if (p.vy > maxFall) p.vy = maxFall;
    if (wallSliding && p.vy > P.wallSlideSpeed) p.vy = P.wallSlideSpeed;
  }

  // --- Déplacement ----------------------------------------------------------------------------
  const fallSpeed = p.vy;
  if (moveX(world, p, p.vx * DT)) {
    p.vx = 0;
    if (p.grappleTicks > 0) p.grappleTicks = 0;
    p.dashTicks = 0;
  }
  const hit = moveY(world, p, p.vy * DT);
  if (hit !== 0 && p.dashTicks > 0 && p.dashY !== 0) p.dashTicks = 0;
  const dashing = p.dashTicks > 0;
  const dodgingNow = dashing && p.dodging;
  if (dashing && --p.dashTicks === 0) {
    p.dodging = false;
    // Fin du dash : on repart à la vitesse de course, sans glisser à pleine vitesse.
    if (Math.abs(p.vx) > P.runSpeed) p.vx = Math.sign(p.vx) * P.runSpeed;
    if (p.dashY !== 0) p.vy *= 0.25;
  }
  let bounced = false;
  if (hit === 1) {
    p.vy = 0;
    if (fallSpeed > 0 && !downHeld && trampolineBelow(world, p)) {
      // trampoline : on repart en rendant l'essentiel de la chute (au moins un bon saut)
      p.vy = -Math.min(
        COMBAT.trampolineMax,
        Math.max(COMBAT.trampolineMin, fallSpeed * COMBAT.trampolineGain),
      );
      p.jumping = false;
      bounced = true;
      emit(world, SimEvent.BOUNCE, slot, p.x, p.y);
    }
  } else if (hit === -1) {
    p.vy = 0;
    p.jumping = false;
    if (p.grappleTicks > 0) p.grappleTicks = 0;
  }

  // --- Sol (après déplacement) et état --------------------------------------------------------
  const groundAfter = probeGround(world, p);
  p.groundMover = probeMover(world, p);
  p.grounded = !bounced && (groundAfter !== 0 || p.groundMover >= 0);
  if (bounced) p.groundMover = -1;
  if (!wasGrounded && p.grounded && fallSpeed > P.landEventSpeed)
    emit(world, SimEvent.LAND, slot, p.x, p.y);

  let state: number;
  if (p.stun > 0) state = PlayerState.STUN;
  else if (p.blockTicks > 0) state = PlayerState.BLOCK;
  else if (p.atkPhase !== AtkPhase.NONE) state = PlayerState.ATTACK;
  else if (p.chargeTicks > 0) state = PlayerState.CHARGE;
  else if (dashing) state = dodgingNow ? PlayerState.DODGE : PlayerState.DASH;
  else if (p.grounded) {
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
