import { MAX_OBJECTS, MAX_PLAYERS, MAX_PROJECTILES } from '@stickyclaude/shared';
import type { World } from '@stickyclaude/sim';
import { createObjView, createProjView } from '../net/interpolation.ts';
import type { DrawPlayer, Scene } from '../render/types.ts';

export function createDrawPlayer(): DrawPlayer {
  return {
    slot: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    crouching: false,
    flags: 0,
    state: 0,
    animProg: 0,
    variant: 0,
    hp: 0,
    weapon: 0,
    ammo: 0,
    aim: 0,
    self: false,
    name: '',
    color: 0,
    team: -1,
    stroke: 0,
    hat: 0,
    victory: 0,
    mannequin: false,
  };
}

/** Une scène vide autour d'un monde, avec ses tableaux réservés une fois pour toutes. */
export function createScene(world: World): Scene {
  return {
    world,
    players: Array.from({ length: MAX_PLAYERS }, createDrawPlayer),
    playerCount: 0,
    objects: Array.from({ length: MAX_OBJECTS }, createObjView),
    objectCount: 0,
    projectiles: Array.from({ length: MAX_PROJECTILES }, createProjView),
    projCount: 0,
    moverTick: 0,
    remoteTick: 0,
    params: world.params,
    game: { phase: 0, mode: 0, modeData: new Uint16Array(8) },
    ghost: { x: 0, y: 0, visible: false },
    debug: false,
    teamColors: null,
    winners: 0,
  };
}
