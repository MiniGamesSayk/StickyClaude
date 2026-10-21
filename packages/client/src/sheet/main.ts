import '../style.css';
import {
  AtkPhase,
  AttackKind,
  ARENAS,
  EMOTES,
  HAT_NAMES,
  INK_COLORS,
  PlayerFlag,
  PlayerState,
  SimEvent,
  STROKE_NAMES,
  WEAPONS,
  ObjType,
  ProjType,
  getArena,
  CELL,
} from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { createWorld } from '@stickyclaude/sim';
import { Application, Container, Sprite, Texture } from 'pixi.js';
import type { GameEvent } from '../net/client.ts';
import { drawShape } from '../render/draw.ts';
import type { Boil } from '../render/draw.ts';
import { loadFonts } from '../render/fonts.ts';
import { FxSystem, onoTextures } from '../render/fx.ts';
import type { FxEnv } from '../render/fx.ts';
import { boilVariant } from '../render/noise.ts';
import { FONT_BODY, FONT_DISPLAY, renderPage } from '../render/page.ts';
import { INK, legibleInk, THEMES } from '../render/palette.ts';
import { Pen, penTextures } from '../render/pen.ts';
import { PenStyle } from '../render/penStyle.ts';
import { RagdollPool } from '../render/ragdoll.ts';
import {
  HAT_SHAPES,
  OBJECT_SHAPES,
  PATTERN_SHAPES,
  PROJECTILE_SHAPES,
  WEAPON_INK,
  WEAPON_SHAPES,
} from '../render/shapes.ts';
import { StickmanPainter } from '../render/stickman.ts';
import type { PaintEnv } from '../render/stickman.ts';
import { TextPool } from '../render/textpool.ts';
import type { DrawPlayer } from '../render/types.ts';

/**
 * Planche de référence (docs/DIRECTION_ARTISTIQUE.md §9) : tous les éléments du style, dessinés
 * avec les vrais modules de rendu. Page de développement (`/sheet`), absente du build de
 * production. `?scale=1.5` change l'échelle, `?theme=` le papier.
 */

const W = 1024;
const H = 1100;

function player(over: Partial<DrawPlayer>): DrawPlayer {
  return {
    slot: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    crouching: false,
    flags: PlayerFlag.ALIVE | PlayerFlag.GROUNDED | PlayerFlag.FACING_RIGHT,
    state: PlayerState.IDLE,
    animProg: 0,
    variant: 0,
    hp: 100,
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
    ...over,
  };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const scale = Number(params.get('scale') ?? 1.4);
  const themeId = params.get('theme') ?? 'graph-paper';
  await loadFonts();
  const app = new Application();
  await app.init({
    width: W * scale,
    height: H * scale,
    background: 0xe7dfc8,
    antialias: false,
    resolution: 1,
    preference: 'webgl',
  });
  document.getElementById('sheet')?.appendChild(app.canvas);
  const root = new Container();
  root.scale.set(scale);
  app.stage.addChild(root);

  // papier : deux pages empilées
  const arena: ArenaData = {
    ...(getArena('maths-quadrille') as ArenaData),
    decor: [],
    theme: THEMES[themeId] ? themeId : 'graph-paper',
  };
  const page = Texture.from(renderPage(arena, Math.min(2, scale)));
  for (let k = 0; k < 3; k++) {
    const s = new Sprite(page);
    s.width = 1024;
    s.height = 576;
    s.y = k * 576 - (k === 2 ? 0 : 0);
    root.addChild(s);
  }
  const blotLayer = new Container();
  const penLayer = new Container();
  const fxLayer = new Container();
  const onoLayer = new Container();
  const labelLayer = new Container();
  root.addChild(blotLayer, penLayer, fxLayer, onoLayer, labelLayer);
  const pen = new Pen(penLayer);
  const fxPen = new Pen(fxLayer);
  const labels = new TextPool(labelLayer);
  onoTextures();
  const painter = new StickmanPainter();
  const ragdolls = new RagdollPool();
  const world = createWorld(getArena('maths-quadrille') as ArenaData, 1);
  const cells = new Uint8Array(world.cells.length);
  const paper = THEMES[arena.theme].paper;

  const fxEnv: FxEnv = {
    nowMs: 0,
    playerPos: () => ({ x: 560, y: 1000 }),
    colorOf: (s) => legibleInk(INK_COLORS[s % 12], paper, 3),
    reducedMotion: false,
    density: 1,
  };
  const fx = new FxSystem(
    {
      shake: () => undefined,
      freeze: () => undefined,
      ko: (slot, x, y, vx, vy) => {
        const r = ragdolls.acquire();
        const joints = new Float32Array(26);
        const j = painter.jointsOf(0);
        if (j) joints.set(j);
        for (let i = 0; i < 13; i++) {
          joints[i * 2] += x - (j?.[16] ?? 0);
          joints[i * 2 + 1] += y + 14 - (j?.[25] ?? 0);
        }
        r.spawn(joints, vx, vy, legibleInk(INK_COLORS[slot], paper, 3), 0, 0, slot, 1, 3);
      },
      emote: () => undefined,
    },
    blotLayer,
    onoLayer,
    penTextures(),
  );

  const ev = (type: number, slot: number, ...a: number[]): GameEvent => ({
    tick: 0,
    type,
    slot,
    a,
  });
  const script: GameEvent[][] = [
    [ev(SimEvent.HIT, 1, 120, 900, 0, 22, 5)],
    [ev(SimEvent.BLOCKED, 1, 230, 900, 0, 1)],
    [ev(SimEvent.EXPLOSION, 0, 340, 900, 56, 0)],
    [ev(SimEvent.TERRAIN, 0, 22, 56, 14)],
    [ev(SimEvent.SHOT, 2, 470, 888, 560, 880, 4)],
    [ev(SimEvent.EMOTE, 0, 0)],
    [ev(SimEvent.GOAL, 0, 0, 560, 910)],
    [ev(SimEvent.WEAPON_SPAWN, 0, 640, 915, 4, 1)],
    [ev(SimEvent.STAMP, 0, 760, 920)],
    [ev(SimEvent.CRATE_BREAK, 0, 860, 920)],
    [ev(SimEvent.KO, 3, 920, 870, 255, 1, 120, -160)],
  ];

  const boil: Boil = { variant: 0, amp: 0.55, seed: 0 };
  let last = performance.now();
  let scriptAt = 0;
  let scriptIdx = 0;
  const label = (t: string, x: number, y: number, size = 11, color: number = INK.night): void => {
    const l = labels.get(t, size, color, false);
    l.anchor.set(0, 0.5);
    l.position.set(x, y);
  };
  const heading = (t: string, y: number): void => {
    const l = labels.get(t, 20, INK.night, false);
    l.style.fontFamily = FONT_DISPLAY;
    l.position.set(512, y);
    l.style.fontFamily = FONT_BODY;
  };

  app.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    boil.variant = boilVariant(now);
    fxEnv.nowMs = now;
    const env: PaintEnv = { timeMs: now, dtS: dt, boil, cells, paper, reducedMotion: false };
    pen.begin();
    fxPen.begin();
    labels.begin();

    heading('Planche de référence · encre et carnet', 18);

    // 1. Styles de trait et contour de soi
    label('Styles de trait', 24, 44, 14);
    for (let i = 0; i < 4; i++) {
      const x = 90 + i * 110;
      painter.draw(
        pen,
        player({
          slot: 10 + i,
          x,
          y: 120,
          stroke: i,
          color: i === 0 ? 0 : i === 1 ? 1 : i === 2 ? 3 : 4,
        }),
        env,
      );
      label(STROKE_NAMES[i].fr, x - 28, 128, 11);
    }
    painter.draw(pen, player({ slot: 14, x: 560, y: 120, self: true, name: 'Moi', color: 2 }), env);
    label('son propre stickman', 520, 128, 11);
    painter.draw(pen, player({ slot: 15, x: 700, y: 120, mannequin: true }), env);
    label('mannequin', 672, 128, 11);

    // 2. Poses
    label('Poses', 24, 148, 14);
    const base = (over: Partial<DrawPlayer>, slot: number, x: number, y: number): void => {
      painter.draw(pen, player({ slot: 20 + slot, x, y, color: slot % 12, ...over }), env);
    };
    const atk = (kind: number, phase: number, prog: number): Partial<DrawPlayer> => ({
      state: PlayerState.ATTACK,
      variant: kind | (phase << 4),
      animProg: prog,
    });
    const row1: [string, Partial<DrawPlayer>][] = [
      ['repos', {}],
      ['course', { state: PlayerState.RUN, vx: 190 }],
      [
        'saut',
        { state: PlayerState.JUMP, vy: -200, flags: PlayerFlag.ALIVE | PlayerFlag.FACING_RIGHT },
      ],
      [
        'chute',
        { state: PlayerState.FALL, vy: 300, flags: PlayerFlag.ALIVE | PlayerFlag.FACING_RIGHT },
      ],
      ['mur', { state: PlayerState.WALL_SLIDE, flags: PlayerFlag.ALIVE | PlayerFlag.FACING_RIGHT }],
      ['accroupi', { state: PlayerState.CROUCH, crouching: true }],
      ['charge', { state: PlayerState.CHARGE, variant: 40 }],
      ['parade', { state: PlayerState.BLOCK, animProg: 20 }],
      ['étourdi', { state: PlayerState.STUN }],
    ];
    row1.forEach(([n, o], i) => {
      const x = 60 + i * 108;
      base(o, i, x, 230);
      label(n, x - 22, 238, 11);
    });
    const row2: [string, Partial<DrawPlayer>][] = [
      ['coup 1', atk(AttackKind.FIST1, AtkPhase.ACTIVE, 1)],
      ['coup 2', atk(AttackKind.FIST2, AtkPhase.ACTIVE, 1)],
      ['coup 3', atk(AttackKind.FIST3, AtkPhase.ACTIVE, 2)],
      ['chargé', atk(AttackKind.CHARGED, AtkPhase.ACTIVE, 2)],
      ['pied', atk(AttackKind.KICK, AtkPhase.RECOVERY, 4)],
      ['lancer', atk(AttackKind.THROW, AtkPhase.ACTIVE, 0)],
      ['pistolet', { weapon: 4, ...atk(AttackKind.SHOOT, AtkPhase.ACTIVE, 0), aim: 0 }],
      ['règle', { weapon: 1, ...atk(AttackKind.WEAPON, AtkPhase.ACTIVE, 2) }],
      ['bazooka', { weapon: 8, aim: 7 }],
    ];
    row2.forEach(([n, o], i) => {
      const x = 60 + i * 108;
      base(o, 10 + i, x, 330);
      label(n, x - 22, 338, 11);
    });
    const tt = now / 1000;
    const row3: [string, Partial<DrawPlayer>, number, number][] = [
      ['salut', {}, 1, 0],
      ['danse', {}, 2, 0],
      ['rire', {}, 3, 0],
      ['poings levés', { victory: 0 }, 0, 1],
      ['saut périlleux', { victory: 1 }, 0, 2],
      ['salut (v.)', { victory: 2 }, 0, 3],
      ['danse (v.)', { victory: 3 }, 0, 4],
    ];
    row3.forEach(([n, o, emote, victory], i) => {
      const x = 60 + i * 108;
      const slot = 30 + i;
      if (emote > 0) painter.setEmote(slot, emote + 5, now - ((tt * 1000) % 1500));
      painter.setVictory(slot, victory > 0, victory > 0 ? now - ((tt * 1000) % 2000) : 0);
      base({ ...o, victory: victory > 0 ? victory - 1 : 0 }, 20 + i, x, 430);
      label(n, x - 26, 438, 11);
    });
    painter.drawGhost(
      pen,
      player({ slot: 40, x: 810, y: 420, state: PlayerState.GHOST, color: 6, self: true }),
      env,
    );
    label('fantôme', 786, 438, 11);

    // 3. Accessoires et motifs
    label('Accessoires et motifs (un par encre)', 24, 462, 14);
    for (let i = 0; i < 12; i++) {
      const x = 52 + i * 78;
      base({ hat: i, color: i, stroke: i % 4 }, i, x, 540);
      label(HAT_NAMES[i].fr.slice(0, 10), x - 28, 548, 9);
    }

    // 4. Armes et objets
    label('Armes (tenues) et objets', 24, 568, 14);
    for (let i = 1; i <= 13; i++) {
      const s = WEAPON_SHAPES[i];
      if (!s) continue;
      const x = 40 + ((i - 1) % 7) * 100;
      const y = 622 + Math.floor((i - 1) / 7) * 54;
      drawShape(
        pen,
        s,
        0,
        0,
        1,
        x - s.cx,
        y - s.cy,
        0,
        1,
        2,
        WEAPON_INK[i] ?? INK.black,
        1,
        PenStyle.BALLPOINT,
        boil,
      );
      label(WEAPONS[i].name.fr.slice(0, 18), x - 28, y + 14, 9);
    }
    const objs = [ObjType.CRATE, ObjType.BALLOON, ObjType.TACK, ObjType.MINE, ObjType.BALL];
    objs.forEach((t, i) => {
      const x = 760 + i * 52;
      const shape = OBJECT_SHAPES[t];
      if (!shape) return;
      drawShape(
        pen,
        shape,
        x,
        690,
        1,
        0,
        0,
        0,
        1,
        2,
        t === ObjType.BALLOON ? 0xe5579a : t === ObjType.CRATE ? 0x7a4a2b : INK.black,
        1,
        PenStyle.BALLPOINT,
        boil,
      );
    });
    label('caisse · ballon · punaise · mine · boule', 700, 702, 9);
    [ProjType.PELLET, ProjType.PLANE, ProjType.ROCKET, ProjType.ERASER].forEach((t, i) => {
      const s = PROJECTILE_SHAPES[t];
      if (s)
        drawShape(
          pen,
          s,
          770 + i * 50,
          640,
          1,
          0,
          0,
          0,
          1,
          1.9,
          INK.black,
          1,
          PenStyle.BALLPOINT,
          boil,
        );
    });
    label('boulette · avion · roquette · gomme', 700, 654, 9);

    // 5. Motifs seuls (agrandis)
    PATTERN_SHAPES.forEach((s, i) => {
      const x = 52 + i * 78;
      pen.disc(x, 760, 9, 9, 0xffffff, 0.9);
      drawShape(
        pen,
        s,
        x,
        760,
        1,
        0,
        0,
        0,
        2.4,
        1.2,
        legibleInk(INK_COLORS[i], paper, 3),
        1,
        PenStyle.BALLPOINT,
        { variant: 0, amp: 0, seed: 0 },
      );
    });
    label('motifs de poitrine (daltoniens), agrandis ×2,4', 24, 780, 11);
    HAT_SHAPES.forEach(() => undefined);

    // 6. Effets
    label(
      'Effets : coup, parade parfaite, explosion, terrain, tir, emote, but, arme dessinée, tampon, caisse, KO',
      24,
      808,
      12,
    );
    if (now - scriptAt > 1500) {
      scriptAt = now;
      for (const e of script[scriptIdx % script.length]) fx.add(e, fxEnv);
      scriptIdx++;
      if (scriptIdx % script.length === 0) {
        fx.clear();
        ragdolls.clear();
      }
    }
    // le « KO » a besoin d'un corps affiché
    painter.draw(pen, player({ slot: 0, x: 120, y: 900, color: 0 }), env);
    painter.draw(pen, player({ slot: 1, x: 150, y: 900, color: 1, hp: 60 }), env);
    ragdolls.step(dt, cells);
    ragdolls.draw(pen, boil);
    fx.draw(fxPen, labels, dt, fxEnv, boil);

    // 7. Terrain et décor : miniatures des papiers
    label('Papiers (un par thème)', 24, 960, 14);

    pen.end();
    fxPen.end();
    labels.end();
  });

  // miniatures des papiers (DOM → texture)
  const ids = Object.keys(THEMES);
  ids.forEach((id, i) => {
    const a = Object.values(ARENAS).find((x) => x.theme === id) ?? arena;
    const thumb = Texture.from(renderPage({ ...a, theme: id }, 0.2));
    const s = new Sprite(thumb);
    s.width = 80;
    s.height = 45;
    s.position.set(24 + (i % 12) * 82, 984 + Math.floor(i / 12) * 66);
    root.addChild(s);
    const l = new Container();
    root.addChild(l);
  });
  void CELL;
  void EMOTES;
  (window as unknown as { __sheet: unknown }).__sheet = { app };
}

main().catch((e: unknown) => {
  console.error(e);
  document.body.append(String(e));
});
