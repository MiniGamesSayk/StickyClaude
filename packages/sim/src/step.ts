import { INPUT_MASK_USED, MAX_PLAYERS, rewindOf, GamePhase } from '@stickyclaude/shared';
import { bodyHeight, moveX, moveY } from './collision.ts';
import { applyHits, recordHistory, resolveMelee } from './combat.ts';
import { stepGame, stepGameClient } from './game.ts';
import { stepGhost } from './ghost.ts';
import { stepHazards, stepObjects, stepWeaponSpawner } from './objects.ts';
import { stepPlayer } from './player.ts';
import { stepProjectiles } from './projectiles.ts';
import { stepMarks, stepPuddles } from './terrain.ts';
import { resolveActions } from './weapons.ts';
import { moverPosition } from './world.ts';
import type { Player, World } from './world.ts';

/**
 * Un pas de simulation (1/60 s) pour tous les joueurs actifs. Aucune allocation, aucune E/S,
 * aucun `Math.random` : le même état et les mêmes entrées donnent toujours le même résultat.
 *
 * `inputs[slot]` est le masque d'entrées de ce tick pour chaque emplacement (voir `Input`) ; les
 * bits 12 à 15 portent le retard de compensation de latence, ajouté par le serveur. Les
 * événements du pas sont dans `world.events` (remis à zéro au début de chaque pas).
 *
 * Deux passes. Passe 1 (tous les mondes) : mouvement et machine à états des actions de chaque
 * joueur, qui ne dépendent que de ses entrées et du décor. Passe 2 (`world.auth` seulement) :
 * résolution des coups, tirs, objets, projectiles et règles de la partie. Le monde de prédiction
 * du client n'exécute que la passe 1.
 */
export function step(world: World, inputs: ArrayLike<number>): void {
  world.tick++;
  world.events.count = 0;
  updateMovers(world);
  const g = world.game;
  const frozen = g.phase === GamePhase.COUNTDOWN;
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    const p = world.players[slot]!;
    if (!p.active) continue;
    const raw = inputs[slot]! | 0;
    p.rewind = rewindOf(raw);
    if (p.dead) continue;
    const input = frozen ? 0 : raw & INPUT_MASK_USED;
    if (p.ghost) {
      stepGhost(world, p, slot, input);
      continue;
    }
    if (p.groundMover >= 0) carry(world, p);
    stepPlayer(world, p, slot, input);
  }

  if (!world.auth) {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const p = world.players[slot]!;
      p.wantFire = false;
      p.wantThrow = false;
      p.wantPickup = false;
      p.wantDrop = false;
    }
    stepGameClient(world);
    return;
  }

  world.hitCount = 0;
  const canFight = g.phase !== GamePhase.COUNTDOWN;
  if (canFight) {
    resolveMelee(world);
    resolveActions(world);
  } else {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const p = world.players[slot]!;
      p.wantFire = false;
      p.wantThrow = false;
      p.wantPickup = false;
      p.wantDrop = false;
    }
  }
  stepProjectiles(world);
  stepObjects(world);
  stepHazards(world);
  applyHits(world);
  stepMarks(world);
  stepPuddles(world);
  stepWeaponSpawner(world);
  stepGame(world);
  applyHits(world);
  recordHistory(world);
}

const moverPos = { x: 0, y: 0 };

function updateMovers(world: World): void {
  for (let i = 0; i < world.moverCount; i++) {
    const m = world.movers[i]!;
    moverPosition(m, world.tick, moverPos);
    m.dx = moverPos.x - m.x;
    m.dy = moverPos.y - m.y;
    m.x = moverPos.x;
    m.y = moverPos.y;
  }
}

/** Entraîne un joueur posé sur une plateforme mobile avec elle. */
function carry(world: World, p: Player): void {
  const m = world.movers[p.groundMover]!;
  moveX(world, p, m.dx);
  moveY(world, p, m.dy);
}

/** Hauteur courante de la boîte du joueur (debout ou accroupi). */
export function playerHeight(world: World, slot: number): number {
  return bodyHeight(world, world.players[slot]!);
}
