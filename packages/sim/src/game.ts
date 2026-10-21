import {
  CELL,
  COMBAT,
  Cause,
  FALL_MARGIN,
  GamePhase,
  MAX_PLAYERS,
  MODE_PARAMS,
  ModeId,
  modeInfo,
  ObjType,
  SimEvent,
  TICK_HZ,
  WORLD_H,
  WORLD_W,
  weaponDef,
} from '@stickyclaude/shared';
import type { ArenaData, RoomSettings } from '@stickyclaude/shared';
import { bodyHeight } from './collision.ts';
import { explode, killPlayer, queueHit, HitFlag, applyHits } from './combat.ts';
import { randomWeapon, spawnObj, spawnProps } from './objects.ts';
import { resetCombatState, spawnPlayer, spawnPlayerAt } from './spawn.ts';
import { emit, loadArena } from './world.ts';
import type { Player, Rules, World } from './world.ts';

export const COUNTDOWN_TICKS = 3 * TICK_HZ;
export const ROUND_END_TICKS = Math.round(3.6 * TICK_HZ);
/** Au-delà de ce nombre de manches sans vainqueur, la partie est tranchée au score. */
const ROUND_CAP_FACTOR = 3;

/** Réglages de l'hôte → règles lues par la simulation. */
export function rulesFromSettings(s: Readonly<RoomSettings>): Rules {
  return {
    friendlyFire: s.friendlyFire,
    weapons: s.weapons,
    ghosts: s.ghosts,
    suddenAfterTicks: s.suddenDeath ? s.suddenDeathSec * TICK_HZ : 0,
    roundsToWin: s.roundsToWin,
    teamsMode: s.mode === 'teams',
    teamCount: s.teams,
    bonusModes: [...s.bonusModes],
    bonusEvery: s.bonusEvery,
  };
}

/** Ce qu'il faut pour lancer une partie dans un monde (voir `StartRecord`). */
export interface StartConfig {
  rules: Rules;
  arenas: ArenaData[];
  inMatch: ArrayLike<number>;
  teams: ArrayLike<number>;
}

/** Règles, participants, équipes et arènes en place, puis première manche. */
export function applyStart(world: World, cfg: StartConfig): void {
  world.rules = { ...cfg.rules, bonusModes: [...cfg.rules.bonusModes] };
  world.arenaPool = cfg.arenas;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    world.inMatch[s] = cfg.inMatch[s]! ? 1 : 0;
    world.team[s] = cfg.teams[s]!;
  }
  startMatch(world);
}

/** Constantes de mouvement de la manche : réglage de base, puis modification du mode. */
export function applyModeParams(world: World, mode: number): void {
  Object.assign(world.params, world.baseParams);
  if (mode === ModeId.MOON) {
    world.params.gravity *= MODE_PARAMS.moonGravityMul;
    world.params.maxFallSpeed *= MODE_PARAMS.moonFallMul;
    world.params.fastFallSpeed *= MODE_PARAMS.moonFallMul;
  }
}

function popcount(m: number): number {
  let n = 0;
  while (m !== 0) {
    n += m & 1;
    m >>>= 1;
  }
  return n;
}

function participates(world: World, p: Player, slot: number): boolean {
  return p.active && world.inMatch[slot] === 1;
}

function isAlive(p: Player): boolean {
  return p.active && !p.dead && !p.ghost;
}

/** Bits des équipes qui ont encore au moins un joueur en vie. */
export function aliveTeams(world: World): number {
  let mask = 0;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (participates(world, p, s) && isAlive(p)) mask |= 1 << world.team[s];
  }
  return mask;
}

export function participantCount(world: World): number {
  let n = 0;
  for (let s = 0; s < MAX_PLAYERS; s++) if (participates(world, world.players[s], s)) n++;
  return n;
}

// --- Choix de l'arène et du mode ---------------------------------------------------------------

function supportsMode(arena: ArenaData, mode: number): boolean {
  const need = modeInfo(mode).needs;
  if (need === 'koth') return arena.modes?.koth !== undefined;
  if (need === 'ball') return arena.modes?.ball !== undefined;
  return true;
}

function baseMode(world: World): number {
  return world.rules.teamsMode ? ModeId.TEAMS : ModeId.FFA;
}

function pickRound(world: World): { arena: ArenaData; mode: number } {
  const g = world.game;
  const pool = world.arenaPool.length > 0 ? world.arenaPool : [world.arena];
  const nextRound = g.round + 1;
  let mode = baseMode(world);
  const r = world.rules;
  if (r.bonusEvery > 0 && r.bonusModes.length > 0 && nextRound % r.bonusEvery === 0) {
    const ok = r.bonusModes.filter((m) => pool.some((a) => supportsMode(a, m)));
    if (ok.length > 0) mode = ok[world.rng.int(ok.length)]!;
  }
  const compatible: number[] = [];
  for (let i = 0; i < pool.length; i++) if (supportsMode(pool[i], mode)) compatible.push(i);
  let idx = compatible[world.rng.int(compatible.length)];
  if (compatible.length > 1 && idx === g.lastArena) {
    idx =
      compatible[
        (compatible.indexOf(idx) + 1 + world.rng.int(compatible.length - 1)) % compatible.length
      ]!;
  }
  g.lastArena = idx;
  return { arena: pool[idx], mode };
}

// --- Démarrage d'une partie et d'une manche ----------------------------------------------------

/** Lance la partie : scores et statistiques remis à zéro, première manche. */
export function startMatch(world: World): void {
  const g = world.game;
  g.scores.fill(0);
  g.round = 0;
  g.matchWinner = -1;
  g.lastArena = -1;
  const st = world.stats;
  st.kos.fill(0);
  st.deaths.fill(0);
  st.damage.fill(0);
  st.bestCombo.fill(0);
  st.silly.fill(0);
  const { arena, mode } = pickRound(world);
  beginRound(world, arena, mode);
}

/**
 * Début d'une manche : arène chargée, joueurs placés (un point distinct chacun), décompte. Les
 * joueurs qui ne participent pas sont retirés du monde.
 */
export function beginRound(world: World, arena: ArenaData, mode: number): void {
  const g = world.game;
  loadArena(world, arena);
  g.round++;
  g.mode = mode;
  g.phase = GamePhase.COUNTDOWN;
  g.phaseTick = 0;
  g.roundTick = 0;
  g.roundWinner = -1;
  g.suddenStarted = false;
  g.inkY = WORLD_H;
  g.tear = 0;
  g.weaponTimer = 6 * TICK_HZ + world.rng.int(4 * TICK_HZ);
  g.modeData.fill(0);
  g.commonWeapon = 0;
  applyModeParams(world, mode);

  // Permutation des points d'apparition tirée avec le RNG du monde (déterministe).
  const n = world.spawnCount;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = world.rng.int(i + 1);
    const t = order[i];
    order[i] = order[j]!;
    order[j] = t;
  }
  let k = 0;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (world.inMatch[s] !== 1) {
      p.active = false;
      continue;
    }
    if (!p.active) continue;
    const idx = order[k++ % n];
    spawnPlayerAt(
      world,
      s,
      world.spawnX[idx],
      world.spawnY[idx],
      COUNTDOWN_TICKS + COMBAT.spawnInvulnTicks,
    );
  }
  spawnProps(world);

  if (mode === ModeId.SAME_WEAPON) {
    g.commonWeapon = randomWeapon(world);
    const w = weaponDef(g.commonWeapon);
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const p = world.players[s];
      if (participates(world, p, s)) {
        p.weapon = g.commonWeapon;
        p.ammo = w.ammo;
      }
    }
  }
  if (mode === ModeId.BALL) {
    assignSides(world);
    spawnBall(world);
  }
  emit(world, SimEvent.ROUND_START, 0, g.round, mode);
}

/** Camps de la boulette-ball : équipes si la partie est par équipes, sinon alternance. */
function assignSides(world: World): void {
  let k = 0;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!participates(world, p, s)) continue;
    world.side[s] = world.rules.teamsMode ? world.team[s] & 1 : k & 1;
    k++;
  }
}

function ballCenter(world: World): { x: number; y: number } {
  const ball = world.arena.modes?.ball;
  const goals = ball?.goals;
  if (!goals) return { x: WORLD_W / 2, y: WORLD_H / 2 };
  if (ball.spawn) return { x: (ball.spawn[0] + 0.5) * CELL, y: (ball.spawn[1] + 1) * CELL };
  const a = goals[0];
  const b = goals[1];
  return {
    x: ((a[0] + a[2] / 2 + b[0] + b[2] / 2) / 2) * CELL,
    y: ((a[1] + a[3] + b[1] + b[3]) / 2 - 4) * CELL,
  };
}

function spawnBall(world: World): void {
  const c = ballCenter(world);
  const o = spawnObj(world, ObjType.BALL, c.x, c.y, 14, 14, 0, 0);
  if (o) o.owner = -1;
  world.game.modeData[2] = 0;
}

/** Retour au salon d'attente : arène d'entraînement, tout le monde réapparaît. */
export function returnToLobby(world: World, lobbyArena: ArenaData): void {
  const g = world.game;
  loadArena(world, lobbyArena);
  g.phase = GamePhase.LOBBY;
  g.phaseTick = 0;
  g.mode = ModeId.FFA;
  g.suddenStarted = false;
  g.inkY = WORLD_H;
  g.tear = 0;
  g.modeData.fill(0);
  g.weaponTimer = 4 * TICK_HZ;
  applyModeParams(world, ModeId.FFA);
  world.inMatch.fill(0);
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (p.active) spawnPlayer(world, s);
  }
}

// --- Fin de manche -----------------------------------------------------------------------------

function endRound(world: World, mask: number): void {
  const g = world.game;
  g.phase = GamePhase.ROUND_END;
  g.phaseTick = 0;
  let first = -1;
  for (let t = 0; t < MAX_PLAYERS; t++) {
    if ((mask & (1 << t)) !== 0) {
      g.scores[t] = g.scores[t] + 1;
      if (first < 0) first = t;
    }
  }
  g.roundWinner = first;
  // Vainqueur de la partie ?
  let best = -1;
  let bestScore = 0;
  for (let t = 0; t < MAX_PLAYERS; t++) {
    if (g.scores[t] >= world.rules.roundsToWin && g.scores[t] > bestScore) {
      best = t;
      bestScore = g.scores[t]!;
    }
  }
  const cap = (2 * world.rules.roundsToWin - 1) * ROUND_CAP_FACTOR;
  if (best < 0 && g.round >= cap) {
    for (let t = 0; t < MAX_PLAYERS; t++) {
      if (g.scores[t] > bestScore) {
        best = t;
        bestScore = g.scores[t]!;
      }
    }
    if (best < 0) best = 0;
  }
  g.matchWinner = best;
  emit(world, SimEvent.ROUND_END, 0, first, mask, g.round, best);
}

function nextAfterRound(world: World): void {
  const g = world.game;
  if (g.matchWinner >= 0) {
    g.phase = GamePhase.MATCH_END;
    g.phaseTick = 0;
    emit(world, SimEvent.MATCH_END, 0, g.matchWinner);
    return;
  }
  const { arena, mode } = pickRound(world);
  beginRound(world, arena, mode);
}

// --- Mort subite -------------------------------------------------------------------------------

function suddenAt(world: World): number {
  const g = world.game;
  if (g.mode === ModeId.INK_RISE) return MODE_PARAMS.inkRiseStartTicks + 5 * TICK_HZ;
  if (world.rules.suddenAfterTicks > 0) return world.rules.suddenAfterTicks;
  return MODE_PARAMS.hardCapSec * TICK_HZ;
}

function usesSudden(mode: number): boolean {
  return mode !== ModeId.KOTH && mode !== ModeId.BALL;
}

function envDamage(world: World, slot: number, dmg: number, cause: number): void {
  const p = world.players[slot];
  p.hp -= dmg;
  if (p.hp <= 0) {
    p.hp = 0;
    killPlayer(world, slot, -1, cause);
  }
}

function stepSudden(world: World): void {
  const g = world.game;
  const at = suddenAt(world);
  if (!g.suddenStarted && g.roundTick >= at) {
    g.suddenStarted = true;
    const ink = g.mode === ModeId.INK_RISE || world.arena.suddenDeath === 'ink-rise';
    emit(world, SimEvent.SUDDEN_DEATH, 0, ink ? 0 : 1);
  }
  if (!g.suddenStarted) return;
  updateSuddenGeometry(world);
  if (!world.auth) return;
  const ink = g.mode === ModeId.INK_RISE || world.arena.suddenDeath === 'ink-rise';
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!participates(world, p, s) || !isAlive(p)) continue;
    const inZone = ink ? p.y > g.inkY : p.x < g.tear || p.x > WORLD_W - g.tear;
    if (inZone) envDamage(world, s, COMBAT.inkDamagePerTick, Cause.INK);
  }
}

/** Niveau de l'encre et largeur déchirée : fonctions du tick de manche. */
function updateSuddenGeometry(world: World): void {
  const g = world.game;
  const elapsed = (g.roundTick - suddenAt(world)) / TICK_HZ;
  const d = Math.max(0, elapsed) * COMBAT.suddenSpeed;
  g.inkY = WORLD_H - d;
  g.tear = d;
}

// --- Boucle d'une phase ------------------------------------------------------------------------

function respawnPlayer(world: World, slot: number): void {
  const p = world.players[slot];
  p.dead = false;
  p.ghost = false;
  spawnPlayer(world, slot);
  if (world.game.mode === ModeId.SAME_WEAPON && world.game.commonWeapon !== 0) {
    p.weapon = world.game.commonWeapon;
    p.ammo = weaponDef(p.weapon).ammo;
  }
}

function stepRespawns(world: World): void {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!p.active || !p.dead || p.respawnTimer <= 0) continue;
    p.respawnTimer--;
    if (p.respawnTimer === 0) respawnPlayer(world, s);
  }
}

function stepOutOfBounds(world: World): void {
  const phase = world.game.phase;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!p.active || p.dead || p.ghost) continue;
    if (p.y > WORLD_H + FALL_MARGIN || p.y - bodyHeight(world, p) < -COMBAT.outTop) {
      if (phase === GamePhase.PLAYING) killPlayer(world, s, -1, Cause.FALL);
      else spawnPlayer(world, s);
    }
  }
}

function leaderMask(world: World, values: ArrayLike<number>): number {
  let best = 0;
  let mask = 0;
  for (let t = 0; t < MAX_PLAYERS; t++) {
    const v = values[t];
    if (v > best) {
      best = v;
      mask = 1 << t;
    } else if (v === best && v > 0) mask |= 1 << t;
  }
  // Égalité : personne ne gagne la manche.
  return popcount(mask) === 1 ? mask : 0;
}

function stepKoth(world: World): void {
  const g = world.game;
  const z = world.arena.modes?.koth?.zone;
  if (!z) return;
  const l = z[0] * CELL;
  const t = z[1] * CELL;
  const r = (z[0] + z[2]) * CELL;
  const b = (z[1] + z[3]) * CELL;
  let present = 0;
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (!participates(world, p, s) || !isAlive(p)) continue;
    const cy = p.y - bodyHeight(world, p) * 0.5;
    if (p.x >= l && p.x <= r && cy >= t && cy <= b) present |= 1 << world.team[s];
  }
  if (popcount(present) === 1) {
    const team = 31 - Math.clz32(present);
    g.modeData[team] = g.modeData[team] + 1;
    if (g.modeData[team] >= MODE_PARAMS.kothHoldTicks) {
      endRound(world, 1 << team);
      return;
    }
  }
  if (g.roundTick >= MODE_PARAMS.kothMaxTicks) endRound(world, leaderMask(world, g.modeData));
}

function stepBall(world: World): void {
  const g = world.game;
  const goals = world.arena.modes?.ball?.goals;
  if (!goals) return;
  let ball = null;
  for (const o of world.objects) if (o.active && o.type === ObjType.BALL) ball = o;
  if (!ball) {
    if (g.modeData[2] > 0) {
      g.modeData[2] = g.modeData[2] - 1;
      if (g.modeData[2] === 0) spawnBall(world);
    } else spawnBall(world);
    return;
  }
  const cy = ball.y - ball.h / 2;
  if (ball.y > WORLD_H + 2 * CELL) {
    ball.active = false;
    g.modeData[2] = MODE_PARAMS.ballResetTicks;
    return;
  }
  for (let i = 0; i < 2; i++) {
    const gl = goals[i];
    if (
      ball.x >= gl[0] * CELL &&
      ball.x <= (gl[0] + gl[2]) * CELL &&
      cy >= gl[1] * CELL &&
      cy <= (gl[1] + gl[3]) * CELL
    ) {
      const side = 1 - i;
      g.modeData[side] = g.modeData[side] + 1;
      emit(world, SimEvent.GOAL, 0, side, ball.x, cy);
      ball.active = false;
      g.modeData[2] = MODE_PARAMS.ballResetTicks;
      if (g.modeData[side] >= MODE_PARAMS.ballGoals) {
        let mask = 0;
        for (let s = 0; s < MAX_PLAYERS; s++) {
          const p = world.players[s];
          if (participates(world, p, s) && world.side[s] === side) mask |= 1 << world.team[s];
        }
        endRound(world, mask);
      }
      return;
    }
  }
  if (g.roundTick >= MODE_PARAMS.ballMaxTicks) {
    const d0 = g.modeData[0];
    const d1 = g.modeData[1];
    let mask = 0;
    if (d0 !== d1) {
      const side = d0 > d1 ? 0 : 1;
      for (let s = 0; s < MAX_PLAYERS; s++) {
        const p = world.players[s];
        if (participates(world, p, s) && world.side[s] === side) mask |= 1 << world.team[s];
      }
    }
    endRound(world, mask);
  }
}

const POTATO_EXPLOSION = { radius: 52, damage: 35, kb: 380, destroys: false, puddle: false };

function assignBomb(world: World): void {
  const alive: number[] = [];
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const p = world.players[s];
    if (participates(world, p, s) && isAlive(p)) alive.push(s);
  }
  if (alive.length < 2) return;
  const s = alive[world.rng.int(alive.length)];
  const p = world.players[s];
  p.hasBomb = true;
  p.bombPassCd = MODE_PARAMS.potatoPassCooldownTicks;
  world.game.modeData[0] = s + 1;
  world.game.modeData[1] = MODE_PARAMS.potatoFuseTicks;
}

function stepPotato(world: World): void {
  const g = world.game;
  const holder = g.modeData[0] - 1;
  const hp = holder >= 0 ? world.players[holder] : null;
  if (!hp || !hp.hasBomb || !isAlive(hp)) {
    if (hp) hp.hasBomb = false;
    g.modeData[0] = 0;
    if (g.modeData[2] > 0) g.modeData[2] = g.modeData[2] - 1;
    else {
      g.modeData[2] = MODE_PARAMS.potatoNextTicks;
      return;
    }
    if (g.modeData[2] === 0) assignBomb(world);
    return;
  }
  g.modeData[1] = g.modeData[1] - 1;
  // Passage au contact.
  const hw = world.params.width * 0.5;
  if (hp.bombPassCd === 0) {
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (s === holder) continue;
      const q = world.players[s];
      if (!participates(world, q, s) || !isAlive(q)) continue;
      const hh = bodyHeight(world, hp);
      const qh = bodyHeight(world, q);
      if (Math.abs(q.x - hp.x) < hw * 2 && q.y > hp.y - hh && q.y - qh < hp.y) {
        hp.hasBomb = false;
        q.hasBomb = true;
        q.bombPassCd = MODE_PARAMS.potatoPassCooldownTicks;
        g.modeData[0] = s + 1;
        break;
      }
    }
  }
  if (g.modeData[1] <= 0) {
    const x = hp.x;
    const y = hp.y - bodyHeight(world, hp) * 0.5;
    hp.hasBomb = false;
    g.modeData[0] = 0;
    g.modeData[2] = MODE_PARAMS.potatoNextTicks;
    // Le porteur meurt, le souffle touche les autres.
    killPlayer(world, holder, holder, Cause.POTATO);
    explode(world, x, y, POTATO_EXPLOSION, holder, Cause.EXPLOSION, 3);
    applyHits(world);
  }
}

function stepPlaying(world: World): void {
  const g = world.game;
  g.roundTick++;
  const info = modeInfo(g.mode);
  if (usesSudden(g.mode)) stepSudden(world);
  if (info.respawn) stepRespawns(world);
  switch (g.mode) {
    case ModeId.KOTH:
      stepKoth(world);
      break;
    case ModeId.BALL:
      stepBall(world);
      break;
    case ModeId.POTATO:
      if (g.roundTick === 1) g.modeData[2] = 1;
      stepPotato(world);
      break;
    default:
      break;
  }
  if (g.phase !== GamePhase.PLAYING) return;
  if (!info.respawn) {
    const alive = aliveTeams(world);
    if (popcount(alive) <= 1) endRound(world, alive);
  }
}

/** Avance l'état de partie d'un pas (autorité). */
export function stepGame(world: World): void {
  const g = world.game;
  g.phaseTick++;
  switch (g.phase) {
    case GamePhase.LOBBY:
      stepRespawns(world);
      stepOutOfBounds(world);
      break;
    case GamePhase.COUNTDOWN:
      stepOutOfBounds(world);
      if (g.phaseTick >= COUNTDOWN_TICKS) {
        g.phase = GamePhase.PLAYING;
        g.phaseTick = 0;
        g.roundTick = 0;
      }
      break;
    case GamePhase.PLAYING:
      stepOutOfBounds(world);
      stepPlaying(world);
      break;
    case GamePhase.ROUND_END:
      stepOutOfBounds(world);
      if (g.phaseTick >= ROUND_END_TICKS) nextAfterRound(world);
      break;
    default:
      stepOutOfBounds(world);
      break;
  }
}

/**
 * Monde de prédiction du client : seuls les compteurs de phase avancent (le décompte se termine
 * tout seul ; le reste vient des snapshots).
 */
export function stepGameClient(world: World): void {
  const g = world.game;
  if (g.phaseTick < 65535) g.phaseTick++;
  if (g.phase === GamePhase.COUNTDOWN && g.phaseTick >= COUNTDOWN_TICKS) {
    g.phase = GamePhase.PLAYING;
    g.phaseTick = 0;
    g.roundTick = 0;
  } else if (g.phase === GamePhase.PLAYING) {
    g.roundTick++;
    if (usesSudden(g.mode) && g.roundTick >= suddenAt(world)) {
      g.suddenStarted = true;
      updateSuddenGeometry(world);
    }
  }
}

/** Remet un joueur dans l'état d'un nouveau-venu (ré-entrée après une manche). */
export function refreshPlayer(world: World, slot: number): void {
  resetCombatState(world.players[slot]);
}

/** Données propres au mode pour les snapshots : jusqu'à 8 valeurs de 16 bits. Retourne leur nombre. */
export function exportModeData(world: World, out: Uint16Array): number {
  const g = world.game;
  const d = g.modeData;
  switch (g.mode) {
    case ModeId.KOTH:
      for (let i = 0; i < 8; i++) out[i] = Math.min(65535, d[i]);
      return 8;
    case ModeId.BALL:
      out[0] = d[0]!;
      out[1] = d[1]!;
      out[2] = d[2]!;
      return 3;
    case ModeId.POTATO:
      out[0] = d[0]!;
      out[1] = Math.max(0, d[1]);
      out[2] = d[2]!;
      return 3;
    default:
      return 0;
  }
}

export { queueHit, HitFlag };
