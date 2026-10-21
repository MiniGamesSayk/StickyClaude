import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  Cell,
  CELL,
  GRID_H,
  GRID_W,
  INK_COLORS,
  MOVER_MASK,
  MOVER_SHIFT,
  PlayerFlag,
  WORLD_H,
  WORLD_W,
} from '@stickyclaude/shared';
import type { ArenaData, MovementParams } from '@stickyclaude/shared';
import { moverPosition, parseArenaCells } from './terrain.ts';
import type { Mover } from '@stickyclaude/sim';

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
  flags: number;
  state: number;
  self: boolean;
  name: string;
  color: number;
}

export interface Scene {
  players: DrawPlayer[];
  movers: Mover[];
  moverCount: number;
  /** Tick (flottant) auquel dessiner les plateformes. */
  moverTick: number;
  /** Tick (flottant) des joueurs distants, pour recoller ceux qui sont sur une plateforme. */
  remoteTick: number;
  params: MovementParams;
  ghost: { x: number; y: number; visible: boolean };
  debug: boolean;
}

interface Sprite {
  body: Graphics;
  label: Text;
  name: string;
}

const tmpA = { x: 0, y: 0 };
const tmpB = { x: 0, y: 0 };

/** Rendu Pixi : rectangles et traits simples (graphismes de développement). */
export class Renderer {
  private app!: Application;
  private readonly world = new Container();
  private readonly terrain = new Graphics();
  private readonly moversG = new Graphics();
  private readonly playersLayer = new Container();
  private readonly overlay = new Graphics();
  private readonly sprites = new Map<number, Sprite>();
  private scale = 1;

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
    this.world.addChild(this.terrain, this.moversG, this.playersLayer, this.overlay);
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

  /** Dessine le papier et le terrain de l'arène (une seule fois par arène). */
  setArena(arena: ArenaData): void {
    const g = this.terrain;
    g.clear();
    g.rect(0, 0, WORLD_W, WORLD_H).fill(PAPER);
    for (let x = 0; x <= GRID_W; x++) g.moveTo(x * CELL, 0).lineTo(x * CELL, WORLD_H);
    for (let y = 0; y <= GRID_H; y++) g.moveTo(0, y * CELL).lineTo(WORLD_W, y * CELL);
    g.stroke({ width: 1, color: GRID_LINE });
    const cells = parseArenaCells(arena);
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

  /** Efface les joueurs et les plateformes (retour au menu). */
  reset(): void {
    for (const s of this.sprites.values()) {
      s.body.destroy();
      s.label.destroy();
    }
    this.sprites.clear();
    this.moversG.clear();
    this.overlay.clear();
  }

  render(scene: Scene): void {
    this.drawMovers(scene);
    this.drawPlayers(scene);
    this.drawOverlay(scene);
  }

  private drawMovers(scene: Scene): void {
    const g = this.moversG;
    g.clear();
    for (let i = 0; i < scene.moverCount; i++) {
      const m = scene.movers[i];
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

  private drawPlayers(scene: Scene): void {
    const seen = new Set<number>();
    for (const p of scene.players) {
      seen.add(p.slot);
      let s = this.sprites.get(p.slot);
      if (!s) {
        const label = new Text({
          text: p.name,
          style: { fontFamily: 'sans-serif', fontSize: 11, fill: INK, align: 'center' },
        });
        label.anchor.set(0.5, 1);
        const body = new Graphics();
        this.playersLayer.addChild(body, label);
        s = { body, label, name: p.name };
        this.sprites.set(p.slot, s);
      }
      if (s.name !== p.name) {
        s.label.text = p.name;
        s.name = p.name;
      }
      let x = p.x;
      let y = p.y;
      // Un joueur distant posé sur une plateforme mobile est recollé à elle (elle est dessinée
      // à l'instant de notre prédiction, lui à l'instant d'interpolation).
      if (!p.self && (p.flags & PlayerFlag.ON_MOVER) !== 0) {
        const mi = (p.flags >> MOVER_SHIFT) & MOVER_MASK;
        const m = mi < scene.moverCount ? scene.movers[mi] : undefined;
        if (m && m.n > 0) {
          this.moverAt(m, scene.moverTick, tmpA);
          this.moverAt(m, scene.remoteTick, tmpB);
          x += tmpA.x - tmpB.x;
          y += tmpA.y - tmpB.y;
        }
      }
      const w = scene.params.width;
      const h = p.crouching ? scene.params.crouchHeight : scene.params.height;
      const g = s.body;
      g.clear();
      const color = INK_COLORS[p.color % INK_COLORS.length] ?? 0x000000;
      g.roundRect(x - w / 2, y - h, w, h, 3).fill({ color, alpha: 0.88 });
      g.roundRect(x - w / 2, y - h, w, h, 3).stroke({
        width: p.self ? 3 : 1.5,
        color: p.self ? 0xffffff : 0x111111,
      });
      if (p.self)
        g.roundRect(x - w / 2 - 1.5, y - h - 1.5, w + 3, h + 3, 4).stroke({
          width: 1.5,
          color: 0x111111,
        });
      // « Œil » : indique la direction
      const ex = x + p.facing * (w * 0.22);
      g.circle(ex, y - h + 8, 2.2).fill(0xffffff);
      s.label.position.set(x, y - h - 3);
    }
    for (const [slot, s] of this.sprites) {
      if (!seen.has(slot)) {
        s.body.destroy();
        s.label.destroy();
        this.sprites.delete(slot);
      }
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

export { WORLD_W, WORLD_H };
