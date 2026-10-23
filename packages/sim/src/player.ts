import {
  aimOfInput,
  AIM_DX,
  AtkPhase,
  AttackKind,
  COMBAT,
  CROUCH_PUNCH,
  DT,
  FIST,
  Input,
  PlayerState,
  SimEvent,
  UPPER,
  WeaponId,
  WeaponKind,
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
  wallContact,
} from './collision.ts';
import { inPuddle, PUDDLE_GRIP } from './terrain.ts';
import { emit } from './world.ts';
import type { Player, World } from './world.ts';

/** Appui d'attaque mémorisé (ticks), comme la mémoire du saut. */
const ATK_BUFFER_TICKS = 6;
/** Durée maximale d'un coup de pied plongeant (sécurité). */
const KICK_MAX_TICKS = 150;

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
  const ch = COMBAT.charged;
  switch (p.atkKind) {
    case AttackKind.FIST1:
    case AttackKind.FIST2:
    case AttackKind.FIST3: {
      const a = FIST[p.atkKind - AttackKind.FIST1];
      return phase === AtkPhase.STARTUP
        ? a.startup
        : phase === AtkPhase.ACTIVE
          ? a.active
          : a.recovery;
    }
    case AttackKind.CHARGED:
      return phase === AtkPhase.STARTUP
        ? ch.startup
        : phase === AtkPhase.ACTIVE
          ? ch.active
          : ch.recovery;
    case AttackKind.UPPER:
    case AttackKind.CROUCH: {
      const a = p.atkKind === AttackKind.UPPER ? UPPER : CROUCH_PUNCH;
      return phase === AtkPhase.STARTUP
        ? a.startup
        : phase === AtkPhase.ACTIVE
          ? a.active
          : a.recovery;
    }
    case AttackKind.KICK:
      return phase === AtkPhase.STARTUP ? 0 : phase === AtkPhase.ACTIVE ? 0 : COMBAT.kick.recovery;
    case AttackKind.THROW:
      return phase === AtkPhase.STARTUP ? 3 : phase === AtkPhase.ACTIVE ? 1 : 8;
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

/** Annule toute action en cours (touché, étourdi, mort). */
export function cancelActions(p: Player): void {
  p.atkPhase = AtkPhase.NONE;
  p.atkKind = AttackKind.NONE;
  p.atkTicks = 0;
  p.chargeTicks = 0;
  p.kicking = false;
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
  p.atkPhase = phase;
  p.atkTicks = 0;
  if (phase === AtkPhase.ACTIVE) onActiveStart(world, p, slot);
  else if (phase === AtkPhase.RECOVERY) {
    const k = p.atkKind;
    if (k === AttackKind.FIST1 || k === AttackKind.FIST2) p.comboWindow = COMBAT.comboWindowTicks;
  }
}

function onActiveStart(world: World, p: Player, slot: number): void {
  p.hitMask = 0;
  const k = p.atkKind;
  const dir = p.facing;
  emit(world, SimEvent.SWING, slot, p.x, p.y, k);
  if (k === AttackKind.FIST1 || k === AttackKind.FIST2 || k === AttackKind.FIST3) {
    const a = FIST[k - AttackKind.FIST1];
    if (Math.abs(p.vx) < a.lunge) p.vx = dir * a.lunge;
  } else if (k === AttackKind.CHARGED) {
    if (Math.abs(p.vx) < COMBAT.charged.lunge) p.vx = dir * COMBAT.charged.lunge;
  } else if (k === AttackKind.CROUCH) {
    if (Math.abs(p.vx) < CROUCH_PUNCH.lunge) p.vx = dir * CROUCH_PUNCH.lunge;
  } else if (k === AttackKind.THROW) {
    // L'arme quitte la main tout de suite (prédit) ; la passe d'autorité crée le projectile.
    p.throwW = p.weapon;
    p.throwA = p.ammo;
    p.weapon = 0;
    p.ammo = 0;
    p.wantThrow = true;
  } else if (k === AttackKind.WEAPON || k === AttackKind.SHOOT || k === AttackKind.BASH) {
    const w = weaponDef(p.weapon);
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

function startThrow(p: Player): void {
  p.atkKind = AttackKind.THROW;
  p.atkPhase = AtkPhase.STARTUP;
  p.atkTicks = 0;
  p.atkBuffer = 0;
  p.combo = 0;
  p.comboWindow = 0;
}

/**
 * Passe 1, actions : parade, enchaînement de coups, charge, utilisation d'arme, demande de
 * ramassage. Ne dépend que de l'état du joueur et de ses entrées (prédictible côté client).
 */
function stepActions(world: World, p: Player, slot: number, input: number, pressed: number): void {
  const weapon = weaponDef(p.weapon);

  const a = aimOfInput(input);
  p.aim = a >= 0 ? a : p.facing > 0 ? 0 : 8;

  if ((input & Input.ATTACK) !== 0) {
    if (p.attackHeld < 255) p.attackHeld++;
  } else p.attackHeld = 0;
  if ((pressed & Input.ATTACK) !== 0) p.atkBuffer = ATK_BUFFER_TICKS;
  else if (p.atkBuffer > 0) p.atkBuffer--;
  if ((pressed & Input.PICKUP) !== 0 && p.pickupCd === 0) {
    p.pickupCd = COMBAT.pickupCooldownTicks;
    if ((input & Input.DOWN) !== 0 && p.weapon !== 0) p.wantDrop = true;
    else p.wantPickup = true;
  }

  // --- Parade ---------------------------------------------------------------------------------
  if (p.blockTicks > 0) {
    if ((input & Input.BLOCK) !== 0) {
      if (p.blockTicks < 255) p.blockTicks++;
    } else {
      p.blockTicks = 0;
      p.blockCd = COMBAT.blockCooldownTicks;
    }
  } else {
    if (p.blockCd > 0) p.blockCd--;
    if (
      (pressed & Input.BLOCK) !== 0 &&
      p.blockCd === 0 &&
      p.atkPhase === AtkPhase.NONE &&
      p.chargeTicks === 0 &&
      !p.kicking
    ) {
      p.blockTicks = 1;
      p.atkBuffer = 0;
    }
  }
  if (p.blockTicks > 0) return;

  // --- Progression de l'attaque en cours ------------------------------------------------------
  if (p.atkPhase !== AtkPhase.NONE) {
    p.atkTicks++;
    if (p.kicking) {
      if (p.atkPhase === AtkPhase.ACTIVE && p.atkTicks > KICK_MAX_TICKS) endKick(p);
    } else {
      const dur = phaseTicks(p, p.atkPhase);
      if (p.atkTicks >= dur) {
        if (p.atkPhase === AtkPhase.STARTUP) enterPhase(world, p, slot, AtkPhase.ACTIVE);
        else if (p.atkPhase === AtkPhase.ACTIVE) enterPhase(world, p, slot, AtkPhase.RECOVERY);
        else finishAttack(p);
        // Une phase de durée nulle est franchie dans le même tick.
        if (p.atkPhase !== AtkPhase.NONE && phaseTicks(p, p.atkPhase) === 0 && !p.kicking) {
          if (p.atkPhase === AtkPhase.ACTIVE) enterPhase(world, p, slot, AtkPhase.RECOVERY);
          else if (p.atkPhase === AtkPhase.RECOVERY) finishAttack(p);
        }
      }
    }
  }
  if (p.comboWindow > 0) {
    p.comboWindow--;
    if (p.comboWindow === 0 && p.atkPhase === AtkPhase.NONE) p.combo = 0;
  }

  // --- Charge (mains nues) --------------------------------------------------------------------
  const fists = weapon.kind === WeaponKind.FISTS;
  if (
    fists &&
    (input & Input.ATTACK) !== 0 &&
    p.attackHeld >= COMBAT.chargeHoldTicks &&
    p.chargeTicks === 0 &&
    p.atkKind !== AttackKind.CHARGED &&
    !p.kicking &&
    (p.atkPhase === AtkPhase.NONE || p.atkPhase === AtkPhase.RECOVERY)
  ) {
    p.atkPhase = AtkPhase.NONE;
    p.atkKind = AttackKind.NONE;
    p.atkTicks = 0;
    p.combo = 0;
    p.comboWindow = 0;
    p.atkBuffer = 0;
    p.chargeTicks = 1;
  } else if (p.chargeTicks > 0 && p.atkPhase === AtkPhase.NONE) {
    if ((input & Input.ATTACK) !== 0) {
      if (p.chargeTicks < COMBAT.chargeMaxTicks) p.chargeTicks++;
    } else {
      p.atkKind = AttackKind.CHARGED;
      p.atkPhase = AtkPhase.STARTUP;
      p.atkTicks = 0;
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
  // Mains nues, sans direction : tant que le bouton est tenu sans avoir atteint le seuil de charge,
  // on ne sait pas encore si c'est un coup ou une charge. Le coup part au relâchement (appui
  // bref) ; au-delà du seuil, la charge commence directement, sans coup parasite avant. Les coups
  // dirigés (haut, bas) partent tout de suite.
  if (
    fists &&
    (input & (Input.ATTACK | Input.UP | Input.DOWN)) === Input.ATTACK &&
    p.attackHeld < COMBAT.chargeHoldTicks
  ) {
    p.atkBuffer = ATK_BUFFER_TICKS;
    return;
  }
  const chain =
    fists &&
    p.atkPhase === AtkPhase.RECOVERY &&
    p.comboWindow > 0 &&
    p.combo >= 1 &&
    p.combo <= 2 &&
    !p.kicking;
  if (p.atkPhase !== AtkPhase.NONE && !chain) return;

  if (fists) {
    if ((input & Input.DOWN) !== 0 && !p.grounded && !p.kicking) {
      startKick(world, p, slot);
    } else if ((input & Input.DOWN) !== 0 && p.grounded) {
      startSpecial(p, AttackKind.CROUCH);
    } else if ((input & Input.UP) !== 0) {
      startSpecial(p, AttackKind.UPPER);
    } else {
      const next = p.comboWindow > 0 && p.combo >= 1 && p.combo <= 2 ? p.combo : 0;
      startFist(p, next);
    }
  } else if (weapon.kind === WeaponKind.CRATE || p.ammo === 0) {
    startThrow(p);
  } else {
    startWeaponUse(p, weapon);
  }
}

/** Coup vers le haut ou coup accroupi : jamais enchaîné, pas de fenêtre de combo. */
function startSpecial(p: Player, kind: number): void {
  p.atkKind = kind;
  p.atkPhase = AtkPhase.STARTUP;
  p.atkTicks = 0;
  p.atkBuffer = 0;
  p.combo = 0;
  p.comboWindow = 0;
}

function startKick(_world: World, p: Player, _slot: number): void {
  p.atkKind = AttackKind.KICK;
  p.atkPhase = AtkPhase.ACTIVE;
  p.atkTicks = 0;
  p.atkBuffer = 0;
  p.kicking = true;
  p.hitMask = 0;
  p.combo = 0;
  p.comboWindow = 0;
}

export function endKick(p: Player): void {
  p.kicking = false;
  p.atkPhase = AtkPhase.RECOVERY;
  p.atkTicks = 0;
}

function finishAttack(p: Player): void {
  const wasFinisher = p.atkKind === AttackKind.FIST3;
  const wasCharged = p.atkKind === AttackKind.CHARGED;
  const wasThrow = p.atkKind === AttackKind.THROW;
  p.atkPhase = AtkPhase.NONE;
  p.atkKind = AttackKind.NONE;
  p.atkTicks = 0;
  if (wasFinisher) {
    p.combo = 0;
    p.comboWindow = 0;
  }
  if (wasCharged) p.chargeTicks = 0;
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
  if (p.blockTicks > 0) mul = COMBAT.blockSpeedMul;
  else if (p.atkPhase !== AtkPhase.NONE) mul = COMBAT.attackSpeedMul;
  else if (p.chargeTicks > 0) mul = COMBAT.chargeSpeedMul;
  if (w.kind === WeaponKind.SHIELD) mul *= w.slowMul;
  p.moveMul = mul;
  p.ctrlLocked = p.hitLock > 0 || p.stun > 0;
  p.jumpLocked = p.blockTicks > 0 || p.chargeTicks > 0 || p.stun > 0 || p.kicking || p.dodging;

  const jumpPressed = (pressed & Input.JUMP) !== 0 && !p.jumpLocked;
  if (jumpPressed) p.jumpBuffer = P.jumpBufferTicks;
  const dir = p.ctrlLocked
    ? 0
    : ((input & Input.RIGHT) !== 0 ? 1 : 0) - ((input & Input.LEFT) !== 0 ? 1 : 0);

  // --- Dash : ruée horizontale, sans gravité, vers la direction tenue (sinon vers où l'on regarde) ---
  const busy =
    p.ctrlLocked ||
    p.blockTicks > 0 ||
    p.chargeTicks > 0 ||
    p.atkPhase !== AtkPhase.NONE ||
    p.kicking ||
    p.grappleTicks > 0;
  if (busy) {
    p.dashTicks = 0;
    p.dodging = false;
  } else if ((pressed & Input.DASH) !== 0 && p.dashCd === 0 && p.dashTicks === 0) {
    p.jumping = false;
    p.wallLock = 0;
    if (dir !== 0) {
      p.dashTicks = P.dashTicks;
      p.dashCd = P.dashCooldownTicks;
      p.facing = dir;
      emit(world, SimEvent.DASH, slot, p.x, p.y, p.facing);
    } else {
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
  const wallSliding = !p.grounded && wall !== 0 && dir === wall && p.vy >= 0 && !p.kicking;

  // --- Sauts ----------------------------------------------------------------------------------
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
    p.vx = p.dodging ? 0 : p.facing * P.dashSpeed;
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
    if (dir !== 0 && p.atkPhase === AtkPhase.NONE) p.facing = dir;
  }

  // --- Vertical -------------------------------------------------------------------------------
  if (p.dashTicks > 0) {
    p.vy = 0;
  } else if (p.grappleTicks <= 0 || p.kicking) {
    let maxFall = P.maxFallSpeed;
    let g = P.gravity;
    if (p.kicking) {
      p.vy = COMBAT.kick.diveSpeed;
      p.vx = p.facing * 60;
      g = 0;
    } else if (!p.grounded && downHeld && p.vy > 0 && !wallSliding && !p.ctrlLocked) {
      g *= P.fastFallGravityMul;
      maxFall = P.fastFallSpeed;
    }
    p.vy += g * DT;
    if (p.vy > maxFall && !p.kicking) p.vy = maxFall;
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
  const dashing = p.dashTicks > 0;
  const dodgingNow = dashing && p.dodging;
  if (dashing && --p.dashTicks === 0) {
    p.dodging = false;
    // Fin du dash : on repart à la vitesse de course, sans glisser à pleine vitesse.
    if (Math.abs(p.vx) > P.runSpeed) p.vx = Math.sign(p.vx) * P.runSpeed;
  }
  if (hit === 1) {
    p.vy = 0;
    if (p.kicking) endKick(p);
  } else if (hit === -1) {
    p.vy = 0;
    p.jumping = false;
    if (p.grappleTicks > 0) p.grappleTicks = 0;
  }

  // --- Sol (après déplacement) et état --------------------------------------------------------
  const groundAfter = probeGround(world, p);
  p.groundMover = probeMover(world, p);
  p.grounded = groundAfter !== 0 || p.groundMover >= 0;
  if (!wasGrounded && p.grounded && fallSpeed > P.landEventSpeed)
    emit(world, SimEvent.LAND, slot, p.x, p.y);
  if (p.kicking && p.grounded) endKick(p);

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
