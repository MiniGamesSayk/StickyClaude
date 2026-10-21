import type { GameSnap, MovementParams } from '@stickyclaude/shared';
import type { World } from '@stickyclaude/sim';
import type { ObjView, ProjView } from '../net/interpolation.ts';

/** Un joueur à dessiner, indépendamment de sa provenance (réseau, relecture, prédiction, local). */
export interface DrawPlayer {
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  crouching: boolean;
  /** Drapeaux au format `PlayerFlag`. */
  flags: number;
  /** `PlayerState`. */
  state: number;
  animProg: number;
  variant: number;
  hp: number;
  weapon: number;
  ammo: number;
  aim: number;
  self: boolean;
  name: string;
  /** Couleur d'encre (indice 0 à 11). */
  color: number;
  /** Équipe (0 à 3) ; -1 en chacun pour soi. */
  team: number;
  /** Style de trait (0 à 3) et couvre-chef (0 à 11). */
  stroke: number;
  hat: number;
  /** Emote de victoire (0 à 3) du joueur. */
  victory: number;
  /** Mannequin d'entraînement : gris, avec une cible sur le torse. */
  mannequin: boolean;
}

export interface Scene {
  world: World;
  /** Réserve de joueurs : seuls les `playerCount` premiers sont à dessiner. */
  players: DrawPlayer[];
  playerCount: number;
  objects: ObjView[];
  objectCount: number;
  projectiles: ProjView[];
  projCount: number;
  /** Tick (flottant) auquel dessiner les plateformes. */
  moverTick: number;
  /** Tick (flottant) des joueurs distants, pour recoller ceux qui sont sur une plateforme. */
  remoteTick: number;
  params: MovementParams;
  game: Pick<GameSnap, 'phase' | 'mode' | 'modeData'>;
  ghost: { x: number; y: number; visible: boolean };
  debug: boolean;
  /** Couleurs d'équipe (indices 0 à 3) quand on joue par équipes. */
  teamColors: readonly number[] | null;
  /** Emplacements qui gagnent la manche (masque de bits) : ils jouent leur emote de victoire. */
  winners: number;
}
