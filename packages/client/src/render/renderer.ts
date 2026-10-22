// Pixi sans `eval` : la politique de sécurité du contenu (CSP, analyse §2.9) interdit `unsafe-eval`.
import 'pixi.js/unsafe-eval';
import { Application, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  CELL,
  GamePhase,
  GRID_W,
  INK_COLORS,
  ModeId,
  MOVER_MASK,
  MOVER_SHIFT,
  ObjType,
  PlayerFlag,
  PlayerState,
  ProjType,
  WORLD_H,
  WORLD_W,
  weaponDef,
  WeaponKind,
} from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { moverPosition } from '@stickyclaude/sim';
import type { Mover, World } from '@stickyclaude/sim';
import type { GameEvent } from '../net/client.ts';
import { Camera, DESKTOP_LIMITS, MOBILE_LIMITS } from './camera.ts';
import { drawShape } from './draw.ts';
import type { Boil } from './draw.ts';
import { FxSystem } from './fx.ts';
import type { FxEnv, FxHooks } from './fx.ts';
import { BOIL_HZ, boilVariant } from './noise.ts';
import { renderPage } from './page.ts';
import { resample } from './art.ts';
import { INK, legibleInk, TABLE, themeOf } from './palette.ts';
import { Pen, penTextures } from './pen.ts';
import { PenStyle } from './penStyle.ts';
import { QualityController } from './quality.ts';
import type { QualityLevel, QualityProfile, QualitySetting } from './quality.ts';
import { RagdollPool } from './ragdoll.ts';
import { OBJECT_SHAPES, PROJECTILE_SHAPES, WEAPON_INK, WEAPON_SHAPES } from './shapes.ts';
import { StickmanPainter } from './stickman.ts';
import type { PaintEnv } from './stickman.ts';
import { TerrainLayer } from './terrainLayer.ts';
import { TextPool } from './textpool.ts';
import type { DrawPlayer, Scene } from './types.ts';

export type { DrawPlayer, Scene } from './types.ts';

/** Réglages du rendu, modifiables à chaud (options du jeu). */
export interface RenderOptions {
  quality: QualitySetting;
  reducedMotion: boolean;
  /** Téléphone : caméra plus serrée, qualité de départ moyenne. */
  mobile: boolean;
}

const tmpA = { x: 0, y: 0 };
const tmpB = { x: 0, y: 0 };

/** Arrondit à 0,25 (les morceaux de terrain ont des dimensions entières à cette condition). */
function quarter(v: number): number {
  return Math.round(v * 4) / 4;
}

/** Rendu Pixi « encre et carnet » : papier, terrain à main levée, stickmen au stylo, effets. */
export class Renderer {
  private app!: Application;
  private readonly root = new Container();
  private readonly worldLayer = new Container();
  private readonly pageSprite = new Sprite();
  private readonly blotLayer = new Container();
  private readonly terrain = new TerrainLayer();
  private readonly screenLayer = new Container();
  private readonly camera = new Camera();
  private readonly painter = new StickmanPainter();
  private readonly ragdolls = new RagdollPool();
  private quality = new QualityController(2);
  private options: RenderOptions = { quality: 'auto', reducedMotion: false, mobile: false };
  private profile: QualityProfile = this.quality.profile;

  private introPen!: Pen;
  private markPen!: Pen;
  private zonePen!: Pen;
  private moverPen!: Pen;
  private objectPen!: Pen;
  private playerPen!: Pen;
  private projPen!: Pen;
  private ragPen!: Pen;
  private fxPen!: Pen;
  private arrowPen!: Pen;
  private labels!: TextPool;
  private fx!: FxSystem;
  private readonly flipFront = new Sprite();
  private readonly flipShade = new Sprite(Texture.WHITE);
  private flipT = -1;
  private readonly flipDur = 0.6;
  private flipReduced = false;
  /** Dessin de l'arène : instant (s) depuis le début, −1 si inactif. */
  private introT = -1;
  private introLen = 0;
  private introLines: number[][] = [];
  private readonly introPts = new Float32Array(8);
  private readonly inkFill = new Sprite(Texture.WHITE);

  private arena: ArenaData | null = null;
  private paperColor = 0xf8f4e6;
  /** Les 12 encres adaptées au papier courant (calculées une fois par arène). */
  private inks: number[] = INK_COLORS.map((c) => c);
  private readonly objBoil: Boil = { variant: 0, amp: 0, seed: 0 };
  private frameNo = 0;
  private baseScale = 1;
  private pageRes = 1;
  private pageWorld: World | null = null;
  private lastDrawAt = Number.NaN;
  private lastResizeAt = 0;
  private needRes = false;
  private colorOf: (slot: number) => number = (s) => INK_COLORS[s % INK_COLORS.length];
  private readonly framePts = new Float32Array(MAX_FRAME_POINTS * 2);
  private readonly view = new Float32Array(4);
  private readonly markCells: number[] = [];
  private readonly pos = new Map<number, { x: number; y: number; frame: number }>();
  private fxEnv!: FxEnv;
  private winners = 0;
  /** Image courante : instant, durée, tremblé. */
  private nowMs = 0;
  private dtS = 1 / 60;
  private boil: Boil = { variant: 0, amp: 0, seed: 0 };
  private lastBoilVariant = -1;
  private ownSlot = -1;
  /** Cadre imposé à la caméra (aperçu de l'accueil) ; null = cadrage automatique. */
  private cameraOverride: { x: number; y: number; zoom: number } | null = null;
  /** Mesures (affichage du débit, tests). */
  stats = {
    sprites: 0,
    particles: 0,
    ragdolls: 0,
    fps: 60,
    /** Amplitude du tremblé des traits (0 = coupé) et mouvement réduit. */
    boil: 0,
    reduced: false,
    level: 2,
    dpr: 1,
  };

  async init(host: HTMLElement, options?: Partial<RenderOptions>): Promise<void> {
    if (options) this.options = { ...this.options, ...options };
    this.quality = new QualityController(this.options.mobile ? 1 : 2);
    this.quality.setSetting(this.options.quality);
    this.profile = this.quality.profile;
    this.app = new Application();
    await this.app.init({
      background: TABLE,
      resizeTo: window,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, this.profile.dprCap),
      preference: 'webgl',
    });
    host.appendChild(this.app.canvas);

    const tx = penTextures();
    this.pageSprite.texture = Texture.EMPTY;
    this.worldLayer.addChild(this.pageSprite, this.blotLayer, this.terrain.container, this.inkFill);
    const layer = (): Container => {
      const c = new Container();
      this.worldLayer.addChild(c);
      return c;
    };
    this.introPen = new Pen(layer());
    this.markPen = new Pen(layer());
    this.zonePen = new Pen(layer());
    this.moverPen = new Pen(layer());
    this.objectPen = new Pen(layer());
    this.playerPen = new Pen(layer());
    this.projPen = new Pen(layer());
    this.ragPen = new Pen(layer());
    this.fxPen = new Pen(layer());
    const onoLayer = layer();
    const labelLayer = layer();
    this.labels = new TextPool(labelLayer);
    this.inkFill.visible = false;
    this.arrowPen = new Pen(this.screenLayer);
    this.flipFront.visible = false;
    this.flipShade.visible = false;
    this.screenLayer.addChild(this.flipShade, this.flipFront);
    this.fx = new FxSystem(this.hooks(), this.blotLayer, onoLayer, tx);
    this.fxEnv = {
      nowMs: 0,
      playerPos: (slot) => {
        const e = this.pos.get(slot);
        return e !== undefined && e.frame === this.frameNo ? e : null;
      },
      colorOf: (slot) => this.colorOf(slot),
      reducedMotion: false,
      density: 1,
    };
    this.root.addChild(this.worldLayer, this.screenLayer);
    this.app.stage.addChild(this.root);
    window.addEventListener('resize', () => {
      this.lastResizeAt = performance.now();
      this.needRes = true;
    });
    this.layout();
    this.applyQuality();
  }

  get ticker(): Application['ticker'] {
    return this.app.ticker;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  /** Couches et outils pour la planche de référence et les mesures. */
  get internals(): {
    pen: Pen;
    painter: StickmanPainter;
    fx: FxSystem;
    labels: TextPool;
    ragdolls: RagdollPool;
    camera: Camera;
  } {
    return {
      pen: this.playerPen,
      painter: this.painter,
      fx: this.fx,
      labels: this.labels,
      ragdolls: this.ragdolls,
      camera: this.camera,
    };
  }

  setOptions(o: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...o };
    this.quality.setSetting(this.options.quality);
    this.camera.limits = this.options.mobile ? MOBILE_LIMITS : DESKTOP_LIMITS;
    this.applyQuality();
  }

  get qualityLevel(): QualityLevel {
    return this.quality.level;
  }

  /** Applique le profil de qualité : DPR, terrain, particules. */
  private applyQuality(): void {
    this.profile = this.quality.profile;
    const dpr = Math.min(window.devicePixelRatio || 1, this.profile.dprCap);
    if (this.app.renderer.resolution !== dpr) {
      this.app.renderer.resolution = dpr;
      this.app.renderer.resize(window.innerWidth, window.innerHeight);
    }
    this.camera.limits = this.options.mobile ? MOBILE_LIMITS : DESKTOP_LIMITS;
    this.layout();
    this.configureTerrain();
    this.fxEnv.density = this.profile.density;
  }

  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.baseScale = Math.min(w / WORLD_W, h / WORLD_H);
  }

  private configureTerrain(): void {
    const dpr = this.app.renderer.resolution;
    const res = Math.max(
      1,
      Math.min(this.profile.terrainRes, quarter(this.baseScale * dpr * 1.25)),
    );
    const variants = this.options.reducedMotion ? 1 : this.profile.terrainVariants;
    const changed = res !== this.pageRes;
    this.pageRes = res;
    this.terrain.configure(res, variants);
    if (changed && this.arena) this.buildPage(this.arena);
  }

  private buildPage(arena: ArenaData): void {
    const canvas = renderPage(arena, this.pageRes);
    const old = this.pageSprite.texture;
    this.pageSprite.texture = Texture.from(canvas);
    this.pageSprite.width = WORLD_W;
    this.pageSprite.height = WORLD_H;
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  /** Fournit la couleur d'encre (0xRRGGBB) de chaque emplacement (pour les effets). */
  setColorSource(fn: (slot: number) => number): void {
    this.colorOf = fn;
  }

  /** Impose un cadre à la caméra (aperçu du stickman), ou rend le cadrage automatique. */
  setCameraOverride(o: { x: number; y: number; zoom: number } | null): void {
    this.cameraOverride = o;
    this.camera.snap();
  }

  /** Joue une emote d'animation (6 salut, 7 danse, 8 rire) sur un joueur affiché. */
  playEmote(slot: number, id: number): void {
    this.painter.setEmote(slot, id, this.nowMs || performance.now());
  }

  /** Emplacement du joueur local (le contour blanc, la flèche hors cadre). */
  setSelf(slot: number): void {
    this.ownSlot = slot;
  }

  /** Nouvelle arène : papier, décor et terrain sont redessinés. */
  setArena(arena: ArenaData, animate = false): void {
    this.arena = arena;
    this.paperColor = themeOf(arena.theme).paper;
    this.inks = INK_COLORS.map((c) => legibleInk(c, this.paperColor, 3));
    this.buildPage(arena);
    this.terrain.setArena(arena);
    this.pageWorld = null;
    this.camera.snap();
    this.introT = animate && !this.options.reducedMotion ? 0 : -1;
    this.introLen = 0;
    this.introLines = [];
    this.terrain.container.alpha = this.introT >= 0 ? 0 : 1;
  }

  /**
   * La page se tourne : on garde une image de l'écran courant et on la retourne (0,6 s) par-dessus
   * la nouvelle arène. En mouvement réduit : simple fondu de 150 ms.
   */
  turnPage(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const vw = this.view[2] - this.view[0];
    const vh = this.view[3] - this.view[1];
    if (vw <= 0 || vh <= 0 || this.app.renderer.width === 0) return;
    const old = this.flipFront.texture;
    this.flipFront.texture = this.app.renderer.generateTexture({
      target: this.worldLayer,
      frame: new Rectangle(this.view[0], this.view[1], vw, vh),
      resolution: Math.min(1, this.app.renderer.resolution),
    });
    if (old !== Texture.EMPTY) old.destroy(true);
    this.flipFront.position.set(0, 0);
    this.flipFront.width = w;
    this.flipFront.height = h;
    this.flipFront.visible = true;
    this.flipT = 0;
    this.flipReduced = this.options.reducedMotion;
    this.flipShade.visible = !this.flipReduced;
  }

  /** Efface joueurs, effets, ragdolls et taches (changement de manche, retour au menu). */
  reset(): void {
    this.painter.reset();
    this.ragdolls.clear();
    this.fx.clear();
    this.pos.clear();
    this.winners = 0;
    this.camera.snap();
    this.pageWorld = null;
  }

  /** Un événement de la simulation à illustrer. */
  addEvent(e: GameEvent): void {
    this.fxEnv.nowMs = this.nowMs || performance.now();
    this.fxEnv.reducedMotion = this.options.reducedMotion;
    this.fx.add(e, this.fxEnv);
  }

  private hooks(): FxHooks {
    return {
      shake: (amp) => this.camera.shake(amp),
      freeze: (slot, ms) => this.painter.freeze(slot, this.nowMs, ms),
      ko: (slot, x, y, vx, vy) => this.spawnRagdoll(slot, x, y, vx, vy),
      emote: (slot, id) => this.painter.setEmote(slot, id, this.nowMs),
    };
  }

  private lastScene: Scene | null = null;

  private spawnRagdoll(slot: number, x: number, y: number, vx: number, vy: number): void {
    if (y > WORLD_H + 20) return;
    let p: DrawPlayer | undefined;
    const sc = this.lastScene;
    if (sc) {
      for (let i = 0; i < sc.playerCount; i++) {
        if (sc.players[i].slot === slot) p = sc.players[i];
      }
    }
    const joints = this.painter.jointsOf(slot);
    const r = this.ragdolls.acquire();
    const color = this.legible(p?.mannequin ? 9 : (p?.color ?? slot));
    r.spawn(
      joints && p ? joints : standingJoints(x, y + 14),
      vx,
      vy,
      p?.mannequin ? INK.graphite : color,
      p?.stroke ?? 0,
      p?.hat ?? 0,
      slot,
      p?.facing ?? 1,
      slot * 13 + Math.floor(x),
    );
  }

  private legible(inkIndex: number): number {
    return this.inks[inkIndex % this.inks.length];
  }

  // --- Image ---------------------------------------------------------------------------------

  render(scene: Scene): void {
    const t0 = performance.now();
    const rawDt = Number.isNaN(this.lastDrawAt) ? 16.7 : t0 - this.lastDrawAt;
    this.lastDrawAt = t0;
    const dtMs = Math.min(100, rawDt);
    this.nowMs = t0;
    this.dtS = dtMs / 1000;
    this.stats.fps += (1000 / Math.max(1, rawDt) - this.stats.fps) * 0.05;
    if (this.quality.frame(rawDt)) this.applyQuality();
    if (this.needRes && t0 - this.lastResizeAt > 250) {
      this.needRes = false;
      this.layout();
      this.configureTerrain();
    }

    const reduced = this.options.reducedMotion;
    const boilOn = this.profile.boilStrokes && !reduced;
    this.boil.variant = boilVariant(t0);
    this.boil.amp = boilOn ? 0.55 : 0;
    this.fxEnv.nowMs = t0;
    this.fxEnv.reducedMotion = reduced;
    this.lastScene = scene;

    const world = scene.world;
    this.syncTerrain(world);
    this.updateCamera(scene);

    const paint: PaintEnv = {
      timeMs: t0,
      dtS: this.dtS,
      boil: this.boil,
      cells: world.cells,
      paper: this.paperColor,
      inks: this.inks,
      reducedMotion: reduced,
    };

    this.introPen.begin();
    this.updateIntro(world);
    this.updateFlip();
    this.labels.begin();
    this.markPen.begin();
    this.zonePen.begin();
    this.moverPen.begin();
    this.objectPen.begin();
    this.playerPen.begin();
    this.projPen.begin();
    this.ragPen.begin();
    this.fxPen.begin();
    this.arrowPen.begin();

    this.drawMarks(world);
    this.drawZones(scene);
    this.drawMovers(scene);
    this.drawObjects(scene);
    this.drawPlayers(scene, paint);
    this.drawProjectiles(scene);
    this.ragdolls.step(this.dtS, world.cells);
    this.ragdolls.draw(this.ragPen, this.boil);
    this.fx.draw(this.fxPen, this.labels, this.dtS, this.fxEnv, this.boil);
    this.drawArrows(scene);

    this.introPen.end();
    this.markPen.end();
    this.zonePen.end();
    this.moverPen.end();
    this.objectPen.end();
    this.playerPen.end();
    this.projPen.end();
    this.ragPen.end();
    this.fxPen.end();
    this.arrowPen.end();
    this.labels.end();
    this.stats.sprites =
      this.playerPen.sprites + this.fxPen.sprites + this.objectPen.sprites + this.projPen.sprites;
    this.stats.particles = this.fx.activeParticles;
    this.stats.ragdolls = this.ragdolls.count;
    this.stats.boil = this.boil.amp;
    this.stats.reduced = reduced;
    this.stats.level = this.quality.level;
    this.stats.dpr = this.app.renderer.resolution;
  }

  private syncTerrain(world: World): void {
    if (this.pageWorld !== world) {
      this.pageWorld = world;
    }
    this.markCells.length = 0;
    for (const m of world.marks) {
      if (!m.active) continue;
      this.markCells.push(m.c0, m.c1, m.c2);
    }
    this.terrain.update(world.cells, world.terrainVersion, this.markCells, 3);
    if (this.profile.boilTerrain && !this.options.reducedMotion) {
      const v = boilVariant(this.nowMs);
      if (v !== this.lastBoilVariant) {
        this.lastBoilVariant = v;
        this.terrain.setVariant(v);
      }
    } else if (this.lastBoilVariant !== 0) {
      this.lastBoilVariant = 0;
      this.terrain.setVariant(0);
    }
  }

  private updateCamera(scene: Scene): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const playing =
      scene.game.phase === GamePhase.COUNTDOWN ||
      scene.game.phase === GamePhase.PLAYING ||
      scene.game.phase === GamePhase.ROUND_END;
    if (this.cameraOverride) {
      const o = this.cameraOverride;
      this.camera.setTarget(o.x, o.y, o.zoom);
    } else if (playing) {
      let n = 0;
      for (let i = 0; i < scene.playerCount; i++) {
        const p = scene.players[i];
        if (n >= MAX_FRAME_POINTS) break;
        if (p.state === PlayerState.DEAD) continue;
        this.framePts[n * 2] = p.x;
        this.framePts[n * 2 + 1] = p.y - 14;
        n++;
      }
      this.camera.frame(this.framePts, n);
    } else {
      this.camera.frameAll();
    }
    this.camera.update(this.dtS, w, h, this.baseScale, this.options.reducedMotion);
    const scale = this.baseScale * this.camera.zoom;
    this.worldLayer.scale.set(scale);
    this.worldLayer.position.set(
      w / 2 - (this.camera.x - this.camera.shakeX) * scale,
      h / 2 - (this.camera.y - this.camera.shakeY) * scale,
    );
    this.camera.visible(w, h, this.baseScale, this.view);
  }

  // --- Transitions -------------------------------------------------------------------------------

  /** Dessin de l'arène : les contours se tracent un par un en 0,8 s, puis les blocs se remplissent. */
  private updateIntro(_world: World): void {
    if (this.introT < 0) return;
    this.introT += this.dtS;
    const t = Math.min(1, this.introT / 0.8);
    if (this.introLen === 0) {
      this.introLines = this.terrain.outlines.map((l) => resample(l, 1.2));
      this.introLen = this.introLines.reduce((a, c) => a + c.length / 2, 0);
    }
    const pen = this.introPen;
    let remaining = Math.floor(this.introLen * t);
    const pts = this.introPts;
    for (const cells of this.introLines) {
      if (remaining <= 0) break;
      const n = Math.min(cells.length / 2, remaining);
      remaining -= cells.length / 2;
      for (let i = 0; i + 1 < n; i++) {
        pts[0] = cells[i * 2] * CELL;
        pts[1] = cells[i * 2 + 1] * CELL;
        pts[2] = cells[i * 2 + 2] * CELL;
        pts[3] = cells[i * 2 + 3] * CELL;
        pen.seg(
          pts[0],
          pts[1],
          pts[2],
          pts[3],
          2.6,
          INK.night,
          1 - Math.max(0, (t - 0.7) / 0.3),
          PenStyle.BALLPOINT,
        );
      }
    }
    // les blocs se remplissent à la fin du tracé
    this.terrain.container.alpha = Math.max(0, Math.min(1, (t - 0.55) / 0.45));
    if (this.introT >= 0.8) {
      this.introT = -1;
      this.introLen = 0;
      this.introLines = [];
      this.terrain.container.alpha = 1;
    }
  }

  private updateFlip(): void {
    if (this.flipT < 0) return;
    this.flipT += this.dtS;
    const k = Math.min(1, this.flipT / (this.flipReduced ? 0.15 : this.flipDur));
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (this.flipReduced) {
      this.flipFront.alpha = 1 - k;
      this.flipFront.scale.set(w / this.flipFront.texture.width, h / this.flipFront.texture.height);
    } else {
      // charnière à gauche : la page se retourne vers la gauche (cos θ), en se soulevant un peu
      const e = k * k * (3 - 2 * k);
      const theta = e * Math.PI * 0.5;
      this.flipFront.alpha = 1;
      this.flipFront.scale.set(
        (w / this.flipFront.texture.width) * Math.cos(theta),
        h / this.flipFront.texture.height,
      );
      this.flipFront.skew.y = -0.05 * Math.sin(theta);
      this.flipFront.tint = 0xffffff;
      this.flipShade.position.set(w * Math.cos(theta) - 2, 0);
      this.flipShade.width = Math.max(0, w * 0.06 * Math.sin(theta));
      this.flipShade.height = h;
      this.flipShade.tint = INK.night;
      this.flipShade.alpha = 0.22 * (1 - k);
    }
    if (k >= 1) {
      this.flipT = -1;
      this.flipFront.visible = false;
      this.flipShade.visible = false;
      this.flipFront.skew.y = 0;
      this.flipFront.alpha = 1;
    }
  }

  // --- Marques des fantômes ------------------------------------------------------------------

  private drawMarks(world: World): void {
    const pen = this.markPen;
    for (const m of world.marks) {
      if (!m.active) continue;
      const left = m.expire - world.tick;
      const fade = left < 60 ? (Math.floor(this.nowMs / 80) % 2 === 0 ? 0.35 : 0.9) : 1;
      const color = this.legible(this.markColor(m.owner));
      const cells = [m.c0, m.c1, m.c2].filter((c) => c >= 0);
      if (cells.length === 0) continue;
      if (m.kind === 0) {
        const x0 = (cells[0] % GRID_W) * CELL;
        const x1 = ((cells[cells.length - 1] % GRID_W) + 1) * CELL;
        const y = Math.floor(cells[0] / GRID_W) * CELL;
        pen.seg(x0, y + 3, x1, y + 3.5, 2.4, color, 0.85 * fade, PenStyle.PENCIL);
        pen.seg(x0 + 2, y + 6, x1 - 2, y + 5.4, 1.4, INK.graphite, 0.6 * fade, PenStyle.PENCIL);
      } else {
        const c = cells[0];
        const cx = (c % GRID_W) * CELL + CELL / 2;
        const cy = Math.floor(c / GRID_W) * CELL + CELL * 0.62;
        pen.disc(cx, cy, 5.2, 5.6, color, 0.9 * fade);
        pen.disc(cx - 1.6, cy - 2, 1.3, 1.6, 0xffffff, 0.6 * fade);
        pen.seg(cx, cy - 5, cx - 1, cy - 8.5, 1.4, color, 0.8 * fade, PenStyle.BALLPOINT);
      }
    }
  }

  private markColor(owner: number): number {
    // l'indice de couleur du propriétaire est déduit de `colorOf` : on retrouve l'indice le plus proche
    const c = this.colorOf(owner);
    const i = INK_COLORS.indexOf(c as (typeof INK_COLORS)[number]);
    return i < 0 ? 9 : i;
  }

  // --- Zones, mort subite, flaques -------------------------------------------------------------

  private drawZones(scene: Scene): void {
    const pen = this.zonePen;
    const w = scene.world;
    const arena = w.arena;
    const mode = scene.game.mode;
    const phase = scene.game.phase;
    const playing = phase === GamePhase.PLAYING || phase === GamePhase.ROUND_END;
    const t = this.nowMs;
    if (mode === ModeId.KOTH && arena.modes?.koth) {
      const z = arena.modes.koth.zone;
      this.wobblyRect(pen, z[0] * CELL, z[1] * CELL, z[2] * CELL, z[3] * CELL, INK.gold, 2.4, 1);
      // hachures dorées légères dans la zone
      const x0 = z[0] * CELL;
      const y0 = z[1] * CELL;
      const ww = z[2] * CELL;
      const hh = z[3] * CELL;
      for (let k = 0; k < ww + hh; k += 14) {
        const ax = x0 + Math.min(k, ww);
        const ay = y0 + Math.max(0, k - ww);
        const bx = x0 + Math.max(0, k - hh);
        const by = y0 + Math.min(k, hh);
        pen.seg(ax, ay, bx, by, 1.1, INK.gold, 0.28, PenStyle.PENCIL, false);
      }
    }
    if (mode === ModeId.BALL && arena.modes?.ball) {
      arena.modes.ball.goals.forEach((r, i) => {
        const color = i === 0 ? INK.blue : INK.red;
        this.wobblyRect(pen, r[0] * CELL, r[1] * CELL, r[2] * CELL, r[3] * CELL, color, 2.2, 2 + i);
        // filet : quadrillage
        const x0 = r[0] * CELL;
        const y0 = r[1] * CELL;
        const ww = r[2] * CELL;
        const hh = r[3] * CELL;
        for (let x = 8; x < ww; x += 8)
          pen.seg(x0 + x, y0, x0 + x, y0 + hh, 1, color, 0.35, PenStyle.BALLPOINT, false);
        for (let y = 8; y < hh; y += 8)
          pen.seg(x0, y0 + y, x0 + ww, y0 + y, 1, color, 0.35, PenStyle.BALLPOINT, false);
      });
    }
    for (const p of w.puddles) {
      if (!p.active) continue;
      const wobble = Math.sin(t / 300 + p.x0) * 0.4;
      for (let x = p.x0 + 3; x < p.x1 - 2; x += 5) {
        pen.disc(x, p.y - 0.5 + wobble, 4.2, 2, INK.night, 0.72);
      }
      pen.seg(
        p.x0 + 4,
        p.y - 2.2,
        p.x1 - 4,
        p.y - 2.2,
        1,
        0xffffff,
        0.35,
        PenStyle.BALLPOINT,
        false,
      );
    }
    // mort subite : l'encre monte ou les bords se déchirent
    this.inkFill.visible = false;
    if (playing && w.game.suddenStarted) {
      const ink = mode === ModeId.INK_RISE || arena.suddenDeath === 'ink-rise';
      if (ink) {
        const y = w.game.inkY;
        this.inkFill.visible = true;
        this.inkFill.position.set(-20, y);
        this.inkFill.width = WORLD_W + 40;
        this.inkFill.height = WORLD_H - y + 40;
        this.inkFill.tint = INK.night;
        this.inkFill.alpha = 0.62;
        // lisière ondulée et bulles
        for (let x = -4; x < WORLD_W + 8; x += 7) {
          const yy = y + Math.sin(x * 0.07 + t / 380) * 2.4;
          pen.disc(x, yy, 5.2, 3.6, INK.night, 0.62);
        }
        for (let k = 0; k < 5; k++) {
          const bx = ((k * 211 + 60) % WORLD_W) + Math.sin(t / 700 + k) * 6;
          const by = y + 10 + ((t / 25 + k * 53) % 70);
          pen.ring(bx, by, 2 + (k % 3), 2 + (k % 3), 0xffffff, 0.35);
        }
      } else {
        const tear = w.game.tear;
        this.inkFill.visible = true;
        this.inkFill.position.set(-20, -20);
        this.inkFill.width = tear + 20;
        this.inkFill.height = WORLD_H + 40;
        this.inkFill.tint = 0xb4392f;
        this.inkFill.alpha = 0.3;
        pen.rect(WORLD_W - tear, -20, tear + 20, WORLD_H + 40, 0xb4392f, 0.3);
        for (let y = 0; y < WORLD_H; y += 9) {
          const j = ((y * 7) % 5) - 2;
          pen.seg(tear + j, y, tear + 5 + j, y + 4.5, 1.8, INK.red, 0.8, PenStyle.BALLPOINT, false);
          pen.seg(
            tear + 5 + j,
            y + 4.5,
            tear + j,
            y + 9,
            1.8,
            INK.red,
            0.8,
            PenStyle.BALLPOINT,
            false,
          );
          pen.seg(
            WORLD_W - tear - j,
            y,
            WORLD_W - tear - 5 - j,
            y + 4.5,
            1.8,
            INK.red,
            0.8,
            PenStyle.BALLPOINT,
            false,
          );
          pen.seg(
            WORLD_W - tear - 5 - j,
            y + 4.5,
            WORLD_W - tear - j,
            y + 9,
            1.8,
            INK.red,
            0.8,
            PenStyle.BALLPOINT,
            false,
          );
        }
      }
    }
  }

  private readonly rectPts = new Float32Array(200);

  /** Rectangle tracé à main levée (coins arrondis par la jointure, côtés légèrement ondulés). */
  private wobblyRect(
    pen: Pen,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    width: number,
    seed: number,
  ): void {
    const pts = this.rectPts;
    let n = 0;
    const step = 14;
    const t = Math.floor(this.nowMs / (1000 / BOIL_HZ)) % 3;
    const j = (k: number): number => Math.sin(k * 12.9898 + seed * 78.233 + t * 3.1) * 0.9;
    const add = (px: number, py: number): void => {
      if (n < 98) {
        pts[n * 2] = px;
        pts[n * 2 + 1] = py;
        n++;
      }
    };
    for (let px = 0; px < w; px += step) add(x + px, y + j(px));
    for (let py = 0; py < h; py += step) add(x + w + j(py + 99), y + py);
    for (let px = w; px > 0; px -= step) add(x + px, y + h + j(px + 199));
    for (let py = h; py > 0; py -= step) add(x + j(py + 299), y + py);
    pen.poly(pts, n, true, width, color, 0.85, PenStyle.MARKER);
  }

  // --- Plateformes mobiles, objets, projectiles ---------------------------------------------------

  private drawMovers(scene: Scene): void {
    const pen = this.moverPen;
    for (let i = 0; i < scene.world.moverCount; i++) {
      const m = scene.world.movers[i];
      if (m.n === 0) continue;
      this.moverAt(m, scene.moverTick, tmpA);
      const x = tmpA.x;
      const y = tmpA.y;
      pen.rect(x, y, m.w, m.h, this.paperColor, 1);
      pen.rect(x, y, m.w, m.h, INK.blue, 0.12);
      // double trait bleu sur le dessus, hachures dessous
      pen.seg(x, y + 1.4, x + m.w, y + 1.4, 2.2, INK.blue, 0.95, PenStyle.MARKER);
      pen.seg(x, y + m.h - 0.8, x + m.w, y + m.h - 0.8, 1.6, INK.blue, 0.8, PenStyle.BALLPOINT);
      for (let k = 6; k < m.w; k += 8) {
        pen.seg(
          x + k,
          y + 2,
          x + k - 3,
          y + m.h - 1.5,
          1.1,
          INK.blue,
          0.5,
          PenStyle.BALLPOINT,
          false,
        );
      }
      pen.seg(x + 1, y + 2, x + 1, y + m.h - 1, 1.6, INK.blue, 0.7, PenStyle.BALLPOINT, false);
      pen.seg(
        x + m.w - 1,
        y + 2,
        x + m.w - 1,
        y + m.h - 1,
        1.6,
        INK.blue,
        0.7,
        PenStyle.BALLPOINT,
        false,
      );
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
    const pen = this.objectPen;
    const t = this.nowMs / 1000;
    for (let i = 0; i < scene.objectCount; i++) {
      const o = scene.objects[i];
      const boil = this.objBoil;
      boil.variant = this.boil.variant;
      boil.amp = this.boil.amp * 0.6;
      boil.seed = o.uid * 17;
      if (o.type === ObjType.WEAPON) {
        const shape = WEAPON_SHAPES[o.a];
        if (!shape) continue;
        const ang = (((o.uid * 37) % 11) - 5) * 0.04;
        const bob = Math.sin(t * 3 + o.uid) * 0.9;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        // la forme est centrée sur (o.x, o.y − 5), tournée autour de son centre
        const lx = o.x - (shape.cx * c - shape.cy * s);
        const ly = o.y - 5 + bob - (shape.cx * s + shape.cy * c);
        drawShape(
          pen,
          shape,
          0,
          0,
          1,
          lx,
          ly,
          ang,
          1,
          2,
          WEAPON_INK[o.a] ?? INK.black,
          1,
          PenStyle.BALLPOINT,
          boil,
        );
        // petit éclat qui attire l'œil
        const glint = (t * 0.8 + o.uid * 0.37) % 1;
        if (glint < 0.25) {
          const k = glint / 0.25;
          const gx = o.x + 8 + Math.sin(o.uid) * 6;
          const gy = o.y - 14;
          pen.seg(
            gx - 3 * k,
            gy,
            gx + 3 * k,
            gy,
            1.2,
            INK.gold,
            1 - k * 0.5,
            PenStyle.BALLPOINT,
            false,
          );
          pen.seg(
            gx,
            gy - 3 * k,
            gx,
            gy + 3 * k,
            1.2,
            INK.gold,
            1 - k * 0.5,
            PenStyle.BALLPOINT,
            false,
          );
        }
        continue;
      }
      const shape = OBJECT_SHAPES[o.type];
      if (!shape) continue;
      let color: number = INK.black;
      let alpha = 1;
      if (o.type === ObjType.CRATE) color = 0x7a4a2b;
      else if (o.type === ObjType.BALLOON) color = 0xe5579a;
      else if (o.type === ObjType.TACK) color = INK.graphite;
      else if (o.type === ObjType.MINE) {
        color = INK.night;
        alpha = o.a === 1 ? 0.55 : 0.95;
      } else if (o.type === ObjType.BALL) color = INK.black;
      const sway = o.type === ObjType.BALLOON ? Math.sin(t * 2 + o.uid) * 0.1 : 0;
      drawShape(pen, shape, o.x, o.y, 1, 0, 0, sway, 1, 2, color, alpha, PenStyle.BALLPOINT, boil);
      if (o.type === ObjType.BALLOON) pen.disc(o.x - 2.2, o.y - 18, 1.3, 2, 0xffffff, 0.55);
      if (o.type === ObjType.CRATE) pen.rect(o.x - 7.4, o.y - 15.4, 14.8, 14.8, 0xb98a5a, 0.5);
    }
  }

  private drawProjectiles(scene: Scene): void {
    const pen = this.projPen;
    for (let i = 0; i < scene.projCount; i++) {
      const p = scene.projectiles[i];
      const ang = Math.atan2(p.vy, p.vx);
      const boil = this.objBoil;
      boil.variant = this.boil.variant;
      boil.amp = this.boil.amp * 0.5;
      boil.seed = p.uid * 11;
      let trail = 0xffffff;
      let size = 2.2;
      if (p.type === ProjType.THROWN) {
        const shape = WEAPON_SHAPES[p.a] ?? WEAPON_SHAPES[13];
        const spin = this.nowMs / 120 + p.uid;
        const c = Math.cos(spin) * 0.8;
        const s = Math.sin(spin) * 0.8;
        drawShape(
          pen,
          shape,
          p.x - (shape.cx * c - shape.cy * s),
          p.y - (shape.cx * s + shape.cy * c),
          1,
          0,
          0,
          spin,
          0.8,
          2,
          WEAPON_INK[p.a] ?? INK.black,
          1,
          PenStyle.BALLPOINT,
          boil,
        );
        trail = 0xb98a5a;
      } else {
        const shape = PROJECTILE_SHAPES[p.type];
        if (shape) {
          let col: number = INK.black;
          if (p.type === ProjType.PLANE) col = INK.blue;
          else if (p.type === ProjType.ROCKET) col = 0x7b3fb5;
          else if (p.type === ProjType.ERASER) col = 0xe5579a;
          drawShape(
            pen,
            shape,
            p.x,
            p.y,
            1,
            0,
            0,
            p.type === ProjType.PELLET ? 0 : ang,
            1,
            1.9,
            col,
            1,
            PenStyle.BALLPOINT,
            boil,
          );
          trail =
            p.type === ProjType.ROCKET ? 0xe8801a : p.type === ProjType.PLANE ? 0xa9dcf2 : col;
          size = p.type === ProjType.ROCKET ? 3.2 : 2.2;
        }
      }
      this.fx.trail(p.x - Math.cos(ang) * 5, p.y - Math.sin(ang) * 5, trail, size, this.fxEnv);
    }
  }

  // --- Joueurs ------------------------------------------------------------------------------------

  private drawPlayers(scene: Scene, paint: PaintEnv): void {
    const pen = this.playerPen;
    const t = this.nowMs;
    this.frameNo++;
    const roundDone =
      scene.game.phase === GamePhase.ROUND_END || scene.game.phase === GamePhase.MATCH_END;
    for (let pi = 0; pi < scene.playerCount; pi++) {
      const p = scene.players[pi];
      this.painter.setVictory(p.slot, roundDone && (scene.winners & (1 << p.slot)) !== 0, t);
      if (p.state === PlayerState.DEAD) {
        this.painter.forget(p.slot);
        continue;
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
      const q = this.drawable(p, x, y);
      if (p.state === PlayerState.GHOST) {
        this.painter.drawGhost(pen, q, paint);
        this.setPos(p.slot, x, y);
        const label = this.labels.get(p.name, 11, 0x44507f, true);
        label.position.set(x, y - 14);
        label.alpha = 0.8;
        continue;
      }
      this.painter.draw(pen, q, paint);
      const d = this.painter.displayed(p.slot);
      this.setPos(p.slot, d ? d.x : x, d ? d.y : y);
      this.drawOverhead(p, paint);
    }
  }

  private setPos(slot: number, x: number, y: number): void {
    let e = this.pos.get(slot);
    if (!e) {
      e = { x, y, frame: this.frameNo };
      this.pos.set(slot, e);
    }
    e.x = x;
    e.y = y;
    e.frame = this.frameNo;
  }

  private readonly scratchPlayer: DrawPlayer = {
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

  /** Copie `p` avec la position corrigée (plateforme mobile) dans un objet réutilisé. */
  private drawable(p: DrawPlayer, x: number, y: number): DrawPlayer {
    if (x === p.x && y === p.y) return p;
    Object.assign(this.scratchPlayer, p);
    this.scratchPlayer.x = x;
    this.scratchPlayer.y = y;
    return this.scratchPlayer;
  }

  /** Nom, barre de vie et munitions au-dessus du stickman. */
  private drawOverhead(p: DrawPlayer, paint: PaintEnv): void {
    const pen = this.playerPen;
    const vis = this.painter.visOf(p.slot);
    const top = vis.topY - 3;
    let y = top;
    const showHp = p.hp > 0 && p.hp < 100 && (paint.timeMs < vis.hpUntil || p.hp <= 30);
    if (showHp) {
      const ticks = 10;
      const filled = Math.ceil((p.hp / 100) * ticks);
      const color = p.hp > 50 ? INK.green : p.hp > 25 ? 0xe8801a : INK.red;
      const x0 = vis.headX - ticks * 1.15;
      for (let i = 0; i < ticks; i++) {
        const on = i < filled;
        pen.seg(
          x0 + i * 2.3,
          y,
          x0 + i * 2.3,
          y - 3.4,
          1.3,
          on ? color : INK.graphite,
          on ? 0.95 : 0.35,
          PenStyle.BALLPOINT,
          false,
        );
      }
      y -= 6;
    }
    const w = weaponDef(p.weapon);
    if (p.self && w.kind !== WeaponKind.FISTS && w.ammo > 0 && p.ammo > 0) {
      const n = Math.min(14, p.ammo);
      const x0 = vis.headX - n * 1.5;
      for (let i = 0; i < n; i++) pen.disc(x0 + i * 3, y, 1, 1, INK.black, 0.75);
      y -= 4;
    }
    if (p.name !== '') {
      const label = this.labels.get(p.name, p.self ? 12 : 11, this.labelColor(p), true);
      label.position.set(vis.headX, y - 1);
    }
  }

  private labelColor(p: DrawPlayer): number {
    if (p.mannequin) return INK.graphite;
    return legibleInk(INK_COLORS[p.color % INK_COLORS.length], this.paperColor, 4.5);
  }

  // --- Flèches hors cadre --------------------------------------------------------------------------

  private drawArrows(scene: Scene): void {
    const pen = this.arrowPen;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const scale = this.baseScale * this.camera.zoom;
    const ox = this.worldLayer.position.x;
    const oy = this.worldLayer.position.y;
    const m = 22;
    for (let pi = 0; pi < scene.playerCount; pi++) {
      const p = scene.players[pi];
      if (p.state === PlayerState.DEAD) continue;
      const wx = p.x;
      const wy = p.y - 14;
      const sx = ox + wx * scale;
      const sy = oy + wy * scale;
      if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) continue;
      // direction du centre de l'écran vers le joueur, posée sur le bord
      const cx = w / 2;
      const cy = h / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const k = Math.min((w / 2 - m) / Math.abs(dx || 1e-6), (h / 2 - m) / Math.abs(dy || 1e-6));
      const ax = cx + dx * k;
      const ay = cy + dy * k;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const color = p.mannequin
        ? INK.graphite
        : legibleInk(INK_COLORS[p.color % INK_COLORS.length], 0xffffff, 3);
      pen.disc(ax - ux * 4, ay - uy * 4, 11, 11, 0xffffff, 0.85);
      pen.seg(ax - ux * 9 - uy * 6, ay - uy * 9 + ux * 6, ax, ay, 3, color, 1, PenStyle.MARKER);
      pen.seg(ax - ux * 9 + uy * 6, ay - uy * 9 - ux * 6, ax, ay, 3, color, 1, PenStyle.MARKER);
    }
  }
}

const MAX_FRAME_POINTS = 16;

/** Squelette debout approximatif (ragdoll d'un joueur jamais dessiné). */
function standingJoints(x: number, y: number): Float32Array {
  const j = new Float32Array(26);
  const set = (i: number, dx: number, dy: number): void => {
    j[i * 2] = x + dx;
    j[i * 2 + 1] = y + dy;
  };
  set(0, 0.5, -24.4);
  set(1, 0.2, -19);
  set(2, -1.4, -17.8);
  set(3, 1.6, -17.8);
  set(4, -2, -13);
  set(5, 3, -13);
  set(6, -1.8, -8.6);
  set(7, 2.6, -8.4);
  set(8, 0, -11.2);
  set(9, -2, -5.6);
  set(10, 2, -5.6);
  set(11, -3.2, 0);
  set(12, 3, 0);
  return j;
}
