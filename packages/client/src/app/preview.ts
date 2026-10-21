import { GamePhase, getArena, PlayerFlag, PlayerState } from '@stickyclaude/shared';
import type { ArenaData, Look } from '@stickyclaude/shared';
import { createWorld } from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';
import type { Scene } from '../render/types.ts';
import { createScene } from './scene.ts';
import type { RenderSource } from './source.ts';

/**
 * Le décor de l'accueil : une page de cahier avec **son** stickman en grand, qui regarde la carte
 * de menu. Pas de simulation : rien ne bouge sauf la respiration, les emotes et l'essai de
 * l'emote de victoire.
 */

export const MENU_ARENA_ID = 'maths-quadrille';
/** Position du stickman de l'aperçu (pieds) et cadre de la caméra. */
export const PREVIEW_X = 800;
export const PREVIEW_Y = 528;
export const PREVIEW_CAMERA = { x: 722, y: 452, zoom: 3 };

export class PreviewSource implements RenderSource {
  readonly world: World;
  readonly scene: Scene;
  readonly self = 0;
  private look: Look;
  private name: string;
  private victoryUntil = 0;
  /** Emote d'animation demandée par l'interface (lue par l'application). */
  constructor(look: Look, name: string) {
    this.look = look;
    this.name = name;
    this.world = createWorld(getArena(MENU_ARENA_ID) as ArenaData, 1);
    this.scene = createScene(this.world);
  }

  setLook(look: Look, name: string): void {
    this.look = look;
    this.name = name;
  }

  /** Joue l'emote de victoire pendant `ms` millisecondes. */
  celebrate(nowMs: number, ms = 3200): void {
    this.victoryUntil = nowMs + ms;
  }

  update(_input: number, nowMs: number): void {
    const sc = this.scene;
    const d = sc.players[0];
    d.slot = 0;
    d.x = PREVIEW_X;
    d.y = PREVIEW_Y;
    d.vx = 0;
    d.vy = 0;
    d.facing = -1;
    d.crouching = false;
    d.flags = PlayerFlag.ALIVE | PlayerFlag.GROUNDED;
    d.state = PlayerState.IDLE;
    d.animProg = 0;
    d.variant = 0;
    d.hp = 100;
    d.weapon = 0;
    d.ammo = 0;
    d.aim = 4;
    d.self = false;
    d.name = '';
    d.color = this.look.color;
    d.team = -1;
    d.stroke = this.look.stroke;
    d.hat = this.look.hat;
    d.victory = this.look.victory;
    d.mannequin = false;
    sc.playerCount = 1;
    sc.objectCount = 0;
    sc.projCount = 0;
    const celebrating = nowMs < this.victoryUntil;
    sc.game.phase = celebrating ? GamePhase.ROUND_END : GamePhase.LOBBY;
    sc.winners = celebrating ? 1 : 0;
    sc.moverTick = 0;
    sc.remoteTick = 0;
    void this.name;
  }

  dispose(): void {
    /* rien à libérer */
  }
}
