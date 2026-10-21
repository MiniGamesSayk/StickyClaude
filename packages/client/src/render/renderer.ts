import { Application, Container, Graphics } from 'pixi.js';
import {
  AIM_DX,
  AIM_DY,
  AtkPhase,
  AttackKind,
  Cell,
  CELL,
  COMBAT,
  FIST,
  GamePhase,
  GRID_H,
  GRID_W,
  INK_COLORS,
  ModeId,
  MOVER_MASK,
  MOVER_SHIFT,
  ObjType,
  PlayerFlag,
  PlayerState,
  ProjType,
  TICK_MS,
  WORLD_H,
  WORLD_W,
  weaponDef,
} from '@stickyclaude/shared';
import type { ArenaData, GameSnap, MovementParams } from '@stickyclaude/shared';
import { moverPosition } from '@stickyclaude/sim';
import type { Mover, World } from '@stickyclaude/sim';
import type { GameEvent } from '../net/client.ts';
import type { ObjView, ProjView } from '../net/interpolation.ts';
import { FxLayer } from './fx.ts';
import type { FxContext } from './fx.ts';
import { TextPool } from './textpool.ts';

const PAPER = 0xf6f1e3;
const GRID_LINE = 0xdbe3f1;
const INK = 0x1b2a5e;

/** Un joueur à dessiner, indépendamment de sa provenance (réseau, relecture, prédiction). */
export interface DrawPlayer {
  slot: number;
  x: number;
  y: number;
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
  color: number;
  /** Équipe (0 à 3) ; -1 en chacun pour soi. */
  team: number;
}

export interface Scene {
  world: World;
  players: DrawPlayer[];
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
}

interface Sprite {
  body: Graphics;
}

const tmpA = { x: 0, y: 0 };
const tmpB = { x: 0, y: 0 };

/** Couleur de chaque arme (id 0 à 13), pour les repérer d'un coup d'œil. */
const WEAPON_COLOR = [
  0x22262e, 0x6b7280, 0x6b7280, 0x7a4a2b, 0xd6322e, 0xe8801a, 0x12a6a6, 0x1f4fd1, 0x7b3fb5,
  0xe5579a, 0x1f9d55, 0x1b2a5e, 0xc9a227, 0x9c8a5a,
];
const WEAPON_LETTER = ['', 'R', 'C', 'M', 'P', 'F', 'S', 'A', 'B', 'G', 'T', 'E', 'Q', 'C'];

/** Rendu Pixi : formes simples et lisibles (graphismes de développement, phase 2). */
export class Renderer {
  private app!: Application;
  private readonly world = new Container();
  private readonly terrain = new Graphics();
  private readonly zones = new Graphics();
  private readonly moversG = new Graphics();
  private readonly objectsG = new Graphics();
  private readonly playersLayer = new Container();
  private readonly projectilesG = new Graphics();
  private readonly fxG = new Graphics();
  private readonly overlay = new Graphics();
  private readonly labelLayer = new Container();
  private readonly sprites = new Map<number, Sprite>();
  private labels!: TextPool;
  private readonly fx = new FxLayer();
  private scale = 1;
  private terrainVersion = -1;
  private terrainWorld: World | null = null;
  private lastDrawAt = Number.NaN;
  private readonly positions = new Map<number, { x: number; y: number }>();
  private readonly fxCtx: FxContext;
  private colorOf: (slot: number) => number = (s) => INK_COLORS[s % INK_COLORS.length];

  constructor() {
    this.fxCtx = {
      playerPos: (slot) => this.positions.get(slot) ?? null,
      colorOf: (slot) => this.colorOf(slot),
    };
  }

  async init(host: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      background: 0xe7dfc8,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    host.appendChild(this.app.canvas);
    this.world.addChild(
      this.terrain,
      this.zones,
      this.moversG,
      this.objectsG,
      this.playersLayer,
      this.projectilesG,
      this.fxG,
      this.overlay,
      this.labelLayer,
    );
    this.labels = new TextPool(this.labelLayer);
    this.app.stage.addChild(this.world);
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  get ticker(): Application['ticker'] {
    return this.app.ticker;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.scale = Math.min(w / WORLD_W, h / WORLD_H);
    this.world.scale.set(this.scale);
    this.world.position.set((w - WORLD_W * this.scale) / 2, (h - WORLD_H * this.scale) / 2);
  }

  /** Fournit la couleur d'encre de chaque emplacement (pour les effets). */
  setColorSource(fn: (slot: number) => number): void {
    this.colorOf = fn;
  }

  /** Nouvelle arène : le terrain sera redessiné au prochain rendu. */
  setArena(_arena: ArenaData): void {
    this.terrainVersion = -1;
    this.fx.clear();
  }

  /** Efface les joueurs, les plateformes et les effets (retour au menu ou changement de manche). */
  reset(): void {
    for (const s of this.sprites.values()) s.body.destroy();
    this.sprites.clear();
    this.moversG.clear();
    this.objectsG.clear();
    this.projectilesG.clear();
    this.zones.clear();
    this.fxG.clear();
    this.overlay.clear();
    this.fx.clear();
    this.positions.clear();
    this.terrainVersion = -1;
    this.terrainWorld = null;
    this.labels?.begin();
    this.labels?.end();
  }

  /** Un événement de la simulation à illustrer. */
  addEvent(e: GameEvent): void {
    this.fx.add(e, this.fxCtx);
  }

  render(scene: Scene): void {
    const now = performance.now();
    const dt = Number.isNaN(this.lastDrawAt) ? 16.7 : Math.min(100, now - this.lastDrawAt);
    this.lastDrawAt = now;
    if (this.terrainWorld !== scene.world || this.terrainVersion !== scene.world.terrainVersion) {
      this.drawTerrain(scene.world);
    }
    this.labels.begin();
    this.drawZones(scene);
    this.drawMovers(scene);
    this.drawObjects(scene);
    this.drawPlayers(scene, now);
    this.drawProjectiles(scene);
    this.fx.draw(this.fxG, this.labels, dt, this.fxCtx);
    this.drawOverlay(scene);
    this.labels.end();
  }

  // --- Terrain --------------------------------------------------------------------------------

  /** Papier et terrain courants (modifiés par les destructions et les traits des fantômes). */
  private drawTerrain(world: World): void {
    this.terrainWorld = world;
    this.terrainVersion = world.terrainVersion;
    const g = this.terrain;
    g.clear();
    g.rect(0, 0, WORLD_W, WORLD_H).fill(PAPER);
    for (let x = 0; x <= GRID_W; x++) g.moveTo(x * CELL, 0).lineTo(x * CELL, WORLD_H);
    for (let y = 0; y <= GRID_H; y++) g.moveTo(0, y * CELL).lineTo(WORLD_W, y * CELL);
    g.stroke({ width: 1, color: GRID_LINE });
    const cells = world.cells;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const t = cells[y * GRID_W + x];
        const px = x * CELL;
        const py = y * CELL;
        if (t === Cell.SOLID) g.rect(px, py, CELL, CELL).fill(INK);
        else if (t === Cell.PAPER) {
          g.rect(px + 1, py + 1, CELL - 2, CELL - 2).fill(0xd8c79a);
          g.moveTo(px + 3, py + 3).lineTo(px + CELL - 3, py + CELL - 3);
          g.stroke({ width: 1, color: 0x9c8a5a });
        } else if (t === Cell.ONEWAY) {
          g.rect(px, py, CELL, 4).fill(0x1f4fd1);
        } else if (t === Cell.HAZARD) {
          g.moveTo(px, py + CELL)
            .lineTo(px + CELL / 2, py + 2)
            .lineTo(px + CELL, py + CELL)
            .closePath()
            .fill(0xd6322e);
        }
      }
    }
  }

  /** Zones des modes de jeu, flaques d'encre et mort subite. */
  private drawZones(scene: Scene): void {
    const g = this.zones;
    g.clear();
    const w = scene.world;
    const arena = w.arena;
    const mode = scene.game.mode;
    const playing =
      scene.game.phase === GamePhase.PLAYING || scene.game.phase === GamePhase.ROUND_END;
    if (mode === ModeId.KOTH && arena.modes?.koth) {
      const z = arena.modes.koth.zone;
      g.rect(z[0] * CELL, z[1] * CELL, z[2] * CELL, z[3] * CELL)
        .fill({ color: 0xc9a227, alpha: 0.15 })
        .stroke({ width: 2, color: 0xc9a227 });
    }
    if (mode === ModeId.BALL && arena.modes?.ball) {
      arena.modes.ball.goals.forEach((r, i) => {
        const color = i === 0 ? 0x1f4fd1 : 0xd6322e;
        g.rect(r[0] * CELL, r[1] * CELL, r[2] * CELL, r[3] * CELL)
          .fill({ color, alpha: 0.15 })
          .stroke({ width: 2, color });
      });
    }
    for (const p of w.puddles) {
      if (p.active) g.rect(p.x0, p.y - 2, p.x1 - p.x0, 3).fill({ color: INK, alpha: 0.6 });
    }
    // Mort subite : l'encre monte (y) ou les bords se déchirent (tear).
    if (playing && w.game.suddenStarted) {
      const ink = mode === ModeId.INK_RISE || arena.suddenDeath === 'ink-rise';
      if (ink) {
        g.rect(0, w.game.inkY, WORLD_W, WORLD_H - w.game.inkY).fill({ color: INK, alpha: 0.55 });
        g.moveTo(0, w.game.inkY).lineTo(WORLD_W, w.game.inkY).stroke({ width: 2, color: INK });
      } else {
        const t = w.game.tear;
        g.rect(0, 0, t, WORLD_H).fill({ color: 0xd6322e, alpha: 0.35 });
        g.rect(WORLD_W - t, 0, t, WORLD_H).fill({ color: 0xd6322e, alpha: 0.35 });
      }
    }
  }

  // --- Plateformes, objets, projectiles -------------------------------------------------------

  private drawMovers(scene: Scene): void {
    const g = this.moversG;
    g.clear();
    for (let i = 0; i < scene.world.moverCount; i++) {
      const m = scene.world.movers[i];
      if (m.n === 0) continue;
      this.moverAt(m, scene.moverTick, tmpA);
      g.rect(tmpA.x, tmpA.y, m.w, m.h).fill({ color: 0x1f4fd1, alpha: 0.35 });
      g.rect(tmpA.x, tmpA.y, m.w, 4).fill(0x1f4fd1);
    }
  }

  private moverAt(m: Mover, tickFloat: number, out: { x: number; y: number }): void {
    const t0 = Math.floor(tickFloat);
    const f = tickFloat - t0;
    moverPosition(m, t0, tmpB);
    const ax = tmpB.x;
    const ay = tmpB.y;
    moverPosition(m, t0 + 1, tmpB);
    out.x = ax + (tmpB.x - ax) * f;
    out.y = ay + (tmpB.y - ay) * f;
  }

  private drawObjects(scene: Scene): void {
    const g = this.objectsG;
    g.clear();
    for (let i = 0; i < scene.objectCount; i++) {
      const o = scene.objects[i];
      switch (o.type) {
        case ObjType.WEAPON: {
          const color = WEAPON_COLOR[o.a] ?? 0x22262e;
          g.roundRect(o.x - 7, o.y - 8, 14, 8, 2)
            .fill(color)
            .stroke({ width: 1, color: 0x111111 });
          const t = this.labels.get(
            `${WEAPON_LETTER[o.a] ?? '?'}${o.b > 0 ? o.b : ''}`,
            9,
            0x111111,
            true,
          );
          t.position.set(o.x, o.y - 9);
          break;
        }
        case ObjType.CRATE:
          g.rect(o.x - 8, o.y - 16, 16, 16)
            .fill(0xb98a5a)
            .stroke({ width: 1.5, color: 0x5a3a1a });
          g.moveTo(o.x - 8, o.y - 16)
            .lineTo(o.x + 8, o.y)
            .moveTo(o.x + 8, o.y - 16)
            .lineTo(o.x - 8, o.y);
          g.stroke({ width: 1, color: 0x5a3a1a });
          break;
        case ObjType.BALLOON:
          g.moveTo(o.x, o.y)
            .lineTo(o.x, o.y + 12)
            .stroke({ width: 1, color: 0x6b7280 });
          g.circle(o.x, o.y - 7, 7)
            .fill({ color: 0xe5579a, alpha: 0.85 })
            .stroke({ width: 1.5, color: 0x8c2a5a });
          break;
        case ObjType.TACK:
          g.moveTo(o.x - 7, o.y)
            .lineTo(o.x, o.y - 7)
            .lineTo(o.x + 7, o.y)
            .closePath()
            .fill(0x9ca3af);
          g.stroke({ width: 1, color: 0x22262e });
          break;
        case ObjType.MINE: {
          // a = 1 si armée ; elle ne se voit que pour les alliés (le serveur filtre les autres)
          const armed = o.a === 1;
          g.circle(o.x, o.y - 4, 6).fill({ color: INK, alpha: armed ? 0.9 : 0.4 });
          g.circle(o.x, o.y - 4, 9).stroke({ width: 1, color: INK, alpha: 0.5 });
          break;
        }
        case ObjType.BALL:
          g.circle(o.x, o.y - 7, 7)
            .fill(0xffffff)
            .stroke({ width: 2, color: 0x22262e });
          break;
        default:
          break;
      }
    }
  }

  private drawProjectiles(scene: Scene): void {
    const g = this.projectilesG;
    g.clear();
    for (let i = 0; i < scene.projCount; i++) {
      const p = scene.projectiles[i];
      const ang = Math.atan2(p.vy, p.vx);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      switch (p.type) {
        case ProjType.PELLET:
          g.circle(p.x, p.y, 3).fill(0xffffff).stroke({ width: 1.5, color: 0x22262e });
          break;
        case ProjType.PLANE:
          g.moveTo(p.x + c * 8, p.y + s * 8)
            .lineTo(p.x - c * 6 - s * 4, p.y - s * 6 + c * 4)
            .lineTo(p.x - c * 6 + s * 4, p.y - s * 6 - c * 4)
            .closePath()
            .fill(0xffffff)
            .stroke({ width: 1.5, color: 0x1f4fd1 });
          break;
        case ProjType.ROCKET:
          g.moveTo(p.x - c * 7, p.y - s * 7).lineTo(p.x + c * 7, p.y + s * 7);
          g.stroke({ width: 5, color: 0x7b3fb5, cap: 'round' });
          break;
        case ProjType.ERASER:
          g.roundRect(p.x - 5, p.y - 4, 10, 8, 2)
            .fill(0xe5579a)
            .stroke({ width: 1, color: 0x8c2a5a });
          break;
        default:
          g.rect(p.x - 5, p.y - 5, 10, 10)
            .fill({ color: 0x9c8a5a, alpha: 0.9 })
            .stroke({ width: 1, color: 0x5a3a1a });
      }
    }
  }

  // --- Joueurs --------------------------------------------------------------------------------

  private drawPlayers(scene: Scene, now: number): void {
    const seen = new Set<number>();
    this.positions.clear();
    const blink = Math.floor(now / 90) % 2 === 0;
    for (const p of scene.players) {
      seen.add(p.slot);
      let s = this.sprites.get(p.slot);
      if (!s) {
        const body = new Graphics();
        this.playersLayer.addChild(body);
        s = { body };
        this.sprites.set(p.slot, s);
      }
      let x = p.x;
      let y = p.y;
      // Un joueur distant posé sur une plateforme mobile est recollé à elle (elle est dessinée
      // à l'instant de notre prédiction, lui à l'instant d'interpolation).
      if (!p.self && (p.flags & PlayerFlag.ON_MOVER) !== 0) {
        const mi = (p.flags >> MOVER_SHIFT) & MOVER_MASK;
        const m = mi < scene.world.moverCount ? scene.world.movers[mi] : undefined;
        if (m && m.n > 0) {
          this.moverAt(m, scene.moverTick, tmpA);
          this.moverAt(m, scene.remoteTick, tmpB);
          x += tmpA.x - tmpB.x;
          y += tmpA.y - tmpB.y;
        }
      }
      this.positions.set(p.slot, { x, y });
      const g = s.body;
      g.clear();
      const color = INK_COLORS[p.color % INK_COLORS.length] ?? 0x000000;

      if (p.state === PlayerState.GHOST) {
        this.drawGhost(g, p, x, y, color);
        const t = this.labels.get(p.name, 11, INK, true);
        t.position.set(x, y - 12);
        continue;
      }
      this.drawStickman(g, scene, p, x, y, color, blink, now);
      const label = this.labelFor(p);
      const t = this.labels.get(label, 11, INK, true);
      t.position.set(x, y - this.bodyHeight(scene, p) - 9);
    }
    for (const [slot, s] of this.sprites) {
      if (!seen.has(slot)) {
        s.body.destroy();
        this.sprites.delete(slot);
      }
    }
  }

  private labelFor(p: DrawPlayer): string {
    const w = weaponDef(p.weapon);
    const held = p.weapon === 0 ? '' : ` · ${w.name.fr}${w.ammo > 0 ? ` ${p.ammo}` : ''}`;
    return `${p.name}${held}`;
  }

  private bodyHeight(scene: Scene, p: DrawPlayer): number {
    return p.crouching ? scene.params.crouchHeight : scene.params.height;
  }

  private drawGhost(g: Graphics, p: DrawPlayer, x: number, y: number, color: number): void {
    g.circle(x, y, 9).stroke({ width: 2, color, alpha: 0.9 });
    g.moveTo(x - 14, y)
      .lineTo(x + 14, y)
      .moveTo(x, y - 14)
      .lineTo(x, y + 14);
    g.stroke({ width: 1.5, color, alpha: 0.9 });
    if (p.self) g.circle(x, y, 13).stroke({ width: 1, color: 0x111111, alpha: 0.6 });
  }

  private drawStickman(
    g: Graphics,
    scene: Scene,
    p: DrawPlayer,
    x: number,
    y: number,
    color: number,
    blink: boolean,
    now: number,
  ): void {
    const w = scene.params.width;
    const h = this.bodyHeight(scene, p);
    const alpha = (p.flags & PlayerFlag.INVULN) !== 0 && blink ? 0.35 : 0.88;
    g.roundRect(x - w / 2, y - h, w, h, 3).fill({ color, alpha });
    g.roundRect(x - w / 2, y - h, w, h, 3).stroke({
      width: p.self ? 3 : 1.5,
      color: p.self ? 0xffffff : 0x111111,
    });
    if (p.self) {
      g.roundRect(x - w / 2 - 1.5, y - h - 1.5, w + 3, h + 3, 4).stroke({
        width: 1.5,
        color: 0x111111,
      });
    }
    if ((p.flags & PlayerFlag.HIT_FLASH) !== 0) {
      g.roundRect(x - w / 2, y - h, w, h, 3).fill({ color: 0xffffff, alpha: 0.6 });
    }
    // Équipe : bandeau de la couleur de l'équipe en haut du corps.
    if (p.team >= 0 && scene.teamColors) {
      g.rect(x - w / 2, y - h, w, 5).fill(scene.teamColors[p.team] ?? 0);
    }
    // « Œil » : indique la direction
    g.circle(x + p.facing * (w * 0.22), y - h + 9, 2.2).fill(0xffffff);

    // Arme tenue : un trait dans la direction de visée.
    if (p.weapon !== 0) {
      const a = p.aim & 7;
      const hx = x + p.facing * (w * 0.3);
      const hy = y - h * 0.55;
      g.moveTo(hx, hy).lineTo(hx + AIM_DX[a] * 14, hy + AIM_DY[a] * 14);
      g.stroke({ width: 4, color: WEAPON_COLOR[p.weapon] ?? 0x22262e, cap: 'round' });
    }

    this.drawAction(g, scene, p, x, y, h, now);

    // Barre de vie
    if (p.hp < 100 && p.hp > 0) {
      const bw = 26;
      const by = y - h - 6;
      g.rect(x - bw / 2, by, bw, 3).fill({ color: 0x22262e, alpha: 0.5 });
      g.rect(x - bw / 2, by, (bw * p.hp) / 100, 3).fill(
        p.hp > 50 ? 0x1f9d55 : p.hp > 25 ? 0xe8801a : 0xd6322e,
      );
    }
    if ((p.flags & PlayerFlag.HAS_BOMB) !== 0) {
      g.circle(x, y - h - 18, 7).fill(0x22262e);
      g.moveTo(x + 3, y - h - 24)
        .lineTo(x + 7, y - h - 29)
        .stroke({ width: 2, color: 0xe8801a });
      g.circle(x + 7, y - h - 29, 2).fill(0xd6322e);
    }
  }

  /** Coups, charge, parade, étourdissement. */
  private drawAction(
    g: Graphics,
    _scene: Scene,
    p: DrawPlayer,
    x: number,
    y: number,
    h: number,
    now: number,
  ): void {
    const dir = p.facing;
    const cy = y - h * 0.55;
    if (p.state === PlayerState.ATTACK) {
      const kind = p.variant & 15;
      const phase = p.variant >> 4;
      let reach = 20;
      if (kind >= AttackKind.FIST1 && kind <= AttackKind.FIST3) reach = FIST[kind - 1].reach;
      else if (kind === AttackKind.CHARGED) reach = COMBAT.charged.reach;
      else if (kind === AttackKind.WEAPON || kind === AttackKind.BASH)
        reach = weaponDef(p.weapon).reach;
      const x0 = x + dir * 6;
      if (kind === AttackKind.KICK) {
        g.moveTo(x, y)
          .lineTo(x + dir * 10, y + 14)
          .stroke({ width: 4, color: 0xd6322e, cap: 'round' });
      } else if (kind === AttackKind.SHOOT) {
        g.circle(x + dir * 14, cy, 5).fill({
          color: 0xe8801a,
          alpha: phase === AtkPhase.ACTIVE ? 0.9 : 0.3,
        });
      } else if (kind === AttackKind.THROW) {
        g.moveTo(x0, cy)
          .lineTo(x0 + dir * 16, cy - 6)
          .stroke({ width: 3, color: 0x6b7280, cap: 'round' });
      } else if (phase === AtkPhase.ACTIVE) {
        g.rect(Math.min(x0, x0 + dir * reach), cy - 8, reach, 16).fill({
          color: 0xd6322e,
          alpha: 0.35,
        });
        g.moveTo(x0, cy)
          .lineTo(x0 + dir * reach, cy)
          .stroke({ width: 4, color: 0xd6322e, cap: 'round' });
      } else {
        // préparation / récupération : trait fin
        g.moveTo(x0, cy).lineTo(x0 + dir * reach * (phase === AtkPhase.STARTUP ? 0.3 : 0.5), cy);
        g.stroke({ width: 2, color: 0x22262e, alpha: 0.6, cap: 'round' });
      }
    } else if (p.state === PlayerState.CHARGE) {
      const k = Math.min(1, p.variant / COMBAT.chargeMaxTicks);
      g.rect(x - 14, y - h - 14, 28, 4).fill({ color: 0x22262e, alpha: 0.4 });
      g.rect(x - 14, y - h - 14, 28 * k, 4).fill(k >= 1 ? 0xd6322e : 0xe8801a);
    } else if (p.state === PlayerState.BLOCK) {
      const perfect = p.animProg <= COMBAT.perfectParryTicks;
      g.moveTo(x + dir * 12, y - h + 4).lineTo(x + dir * 12, y - 2);
      g.stroke({ width: 5, color: perfect ? 0xc9a227 : 0x1f4fd1, cap: 'round' });
    } else if (p.state === PlayerState.STUN) {
      const t = (now / 1000) * 6;
      for (let i = 0; i < 3; i++) {
        const a = t + (i * Math.PI * 2) / 3;
        g.circle(x + Math.cos(a) * 11, y - h - 6 + Math.sin(a) * 3, 2.5).fill(0xc9a227);
      }
    }
    if ((p.flags & PlayerFlag.PARRY_FLASH) !== 0) {
      g.circle(x, cy, 22).stroke({ width: 3, color: 0xc9a227 });
    }
    if ((p.flags & PlayerFlag.SHIELD_UP) !== 0) {
      g.arc(x + dir * 4, cy, 18, dir > 0 ? -1 : Math.PI - 1, dir > 0 ? 1 : Math.PI + 1);
      g.stroke({ width: 4, color: 0xc9a227 });
    }
  }

  private drawOverlay(scene: Scene): void {
    const g = this.overlay;
    g.clear();
    if (!scene.debug || !scene.ghost.visible) return;
    const w = scene.params.width;
    const h = scene.params.height;
    // Dernier état confirmé par le serveur pour soi (fantôme rouge)
    g.roundRect(scene.ghost.x - w / 2, scene.ghost.y - h, w, h, 3).stroke({
      width: 1.5,
      color: 0xd6322e,
    });
  }
}

export { WORLD_W, WORLD_H, TICK_MS };
