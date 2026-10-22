import { Cell, CELL, GRID_H, GRID_W, WORLD_H, WORLD_W } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { newLevelId, saveLevels, MAX_LEVELS } from '../app/levels.ts';
import { actions, levels, mode, overlay, say } from '../app/store.ts';
import {
  addMover,
  applySpawns,
  fillRect,
  finalizeLevel,
  floodFill,
  fromArena,
  levelCheck,
  newLevel,
  removeMoverAt,
  THEME_IDS,
} from '../creator/model.ts';
import { LevelChecker } from '../creator/checker.ts';
import type { EditorState, LevelCheck } from '../creator/model.ts';
import { applyRect, applyTool, CELL_TOOLS, RECT_TOOLS, Tool, toArena } from '../editor/model.ts';
import type { Rect, ToolId } from '../editor/model.ts';
import { pick, t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { drawHazard, drawPlayerSpawn, drawProp, drawWeaponSpawn } from '../creator/draw2d.ts';
import { renderPage } from '../render/page.ts';
import { Button, Select } from './components.tsx';

/** Outil du créateur : ceux de l'éditeur, plus la plateforme mobile. */
type CTool = ToolId | 'mover';
/** Manière de poser une case : au pinceau, en rectangle ou au seau. */
type PoseMode = 'brush' | 'rect' | 'bucket';

const MODES: [PoseMode, MessageKey][] = [
  ['brush', 'cr.mode_brush'],
  ['rect', 'cr.mode_rect'],
  ['bucket', 'cr.mode_bucket'],
];

const GROUPS: { title: MessageKey; tools: [CTool, MessageKey][] }[] = [
  {
    title: 'cr.group_platforms',
    tools: [
      [Tool.SOLID, 'cr.tool_solid'],
      [Tool.PAPER, 'cr.tool_paper'],
      [Tool.ONEWAY, 'cr.tool_oneway'],
      ['mover', 'cr.tool_mover'],
    ],
  },
  {
    title: 'cr.group_traps',
    tools: [
      [Tool.HAZARD, 'cr.tool_hazard'],
      [Tool.TACK, 'cr.tool_tack'],
      [Tool.BALLOON, 'cr.tool_balloon'],
      [Tool.CRATE, 'cr.tool_crate'],
    ],
  },
  {
    title: 'cr.group_points',
    tools: [
      [Tool.SPAWN, 'cr.tool_spawn'],
      [Tool.WEAPON, 'cr.tool_weapon'],
    ],
  },
  {
    title: 'cr.group_modes',
    tools: [
      [Tool.KOTH, 'cr.tool_koth'],
      [Tool.GOAL_A, 'cr.tool_goal_a'],
      [Tool.GOAL_B, 'cr.tool_goal_b'],
    ],
  },
  { title: 'cr.group_edit', tools: [[Tool.ERASE, 'cr.tool_erase']] },
];

/** Outils qui posent des cases : ils suivent le mode (pinceau, rectangle, seau). */
const CELL_TOOL_IDS: ReadonlySet<CTool> = new Set([
  Tool.SOLID,
  Tool.PAPER,
  Tool.ONEWAY,
  Tool.HAZARD,
  Tool.ERASE,
]);

/** Valeur de case d'un outil de cases (la gomme vide la case). */
function cellValue(tool: CTool): number {
  return tool === Tool.ERASE ? Cell.EMPTY : (CELL_TOOLS[tool as ToolId] ?? Cell.EMPTY);
}

/** Le brouillon survit à la fermeture du créateur (test du niveau, puis retour). */
let draft: EditorState | null = null;
let draftId = '';
/** Historique du brouillon (annuler / rétablir), conservé avec lui. */
let undoStack: EditorState[] = [];
let redoStack: EditorState[] = [];
const MAX_HISTORY = 100;

function snapshot(s: EditorState): EditorState {
  return structuredClone(s);
}

/** Fonds de page (papier, lignes, marges du thème), dessinés une fois par thème. */
const backgrounds = new Map<string, HTMLCanvasElement>();
function backgroundOf(theme: string): HTMLCanvasElement {
  let c = backgrounds.get(theme);
  if (!c) {
    c = renderPage({ id: 'creator', theme, decor: [] } as unknown as ArenaData, 1);
    backgrounds.set(theme, c);
  }
  return c;
}

const THEME_KEYS: Record<(typeof THEME_IDS)[number], MessageKey> = {
  'graph-paper': 'theme.graph-paper',
  'ruled-paper': 'theme.ruled-paper',
  practice: 'theme.practice',
  'staff-paper': 'theme.staff-paper',
  'scratch-paper': 'theme.scratch-paper',
  'treasure-map': 'theme.treasure-map',
  'comic-page': 'theme.comic-page',
  'cover-page': 'theme.cover-page',
  'millimeter-paper': 'theme.millimeter-paper',
  'dictionary-page': 'theme.dictionary-page',
  'doodle-margin': 'theme.doodle-margin',
  spread: 'theme.spread',
};

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function dashedRect(
  ctx: CanvasRenderingContext2D,
  r: Rect | null,
  color: string,
  text: string,
): void {
  if (!r) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(r[0] * CELL, r[1] * CELL, r[2] * CELL, r[3] * CELL);
  ctx.setLineDash([]);
  label(ctx, text, (r[0] + r[2] / 2) * CELL, r[1] * CELL - 3, color);
}

/** Dessine le niveau : vrai fond du thème, centre, cases, objets du jeu, marqueurs, plateformes. */
function draw(
  ctx: CanvasRenderingContext2D,
  s: EditorState,
  hover: { x: number; y: number },
  drag: { x: number; y: number } | null,
  rectLike: boolean,
  pending: Rect | null,
): void {
  ctx.drawImage(backgroundOf(s.theme), 0, 0, WORLD_W, WORLD_H);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const c = s.cells[y * GRID_W + x];
      const px = x * CELL;
      const py = y * CELL;
      if (c === Cell.SOLID) {
        ctx.fillStyle = '#1b2a5e';
        ctx.fillRect(px, py, CELL, CELL);
      } else if (c === Cell.PAPER) {
        ctx.fillStyle = '#e9d9a8';
        ctx.fillRect(px, py, CELL, CELL);
        ctx.strokeStyle = '#8a6a2b';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(px + 0.7, py + 0.7, CELL - 1.4, CELL - 1.4);
        ctx.beginPath();
        ctx.moveTo(px + 3, py + 13);
        ctx.lineTo(px + 13, py + 3);
        ctx.stroke();
      } else if (c === Cell.ONEWAY) {
        ctx.strokeStyle = '#1f4fd1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py + 1.4);
        ctx.lineTo(px + CELL, py + 1.4);
        ctx.moveTo(px, py + 4.8);
        ctx.lineTo(px + CELL, py + 4.8);
        ctx.stroke();
      } else if (c === Cell.HAZARD) {
        drawHazard(ctx, x, y);
      }
    }
  }
  // le centre de la page : repère pour équilibrer le niveau (symétrie des apparitions)
  ctx.save();
  ctx.strokeStyle = 'rgba(214,50,46,0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(WORLD_W / 2 + 0.5, 0);
  ctx.lineTo(WORLD_W / 2 + 0.5, WORLD_H);
  ctx.moveTo(0, WORLD_H / 2 + 0.5);
  ctx.lineTo(WORLD_W, WORLD_H / 2 + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(WORLD_W / 2, WORLD_H / 2, 7, 0, Math.PI * 2);
  ctx.moveTo(WORLD_W / 2 - 11, WORLD_H / 2);
  ctx.lineTo(WORLD_W / 2 + 11, WORLD_H / 2);
  ctx.moveTo(WORLD_W / 2, WORLD_H / 2 - 11);
  ctx.lineTo(WORLD_W / 2, WORLD_H / 2 + 11);
  ctx.stroke();
  ctx.restore();
  for (const m of s.movers) {
    ctx.strokeStyle = 'rgba(31,79,209,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    m.path.forEach(([x, y], i) => {
      const cx = (x + m.rect[2] / 2) * CELL;
      const cy = (y + m.rect[3] / 2) * CELL;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    for (const [x, y] of m.path) {
      ctx.fillStyle = 'rgba(31,79,209,0.3)';
      ctx.fillRect(x * CELL, y * CELL, m.rect[2] * CELL, m.rect[3] * CELL);
      ctx.strokeStyle = '#1f4fd1';
      ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, m.rect[2] * CELL - 1, m.rect[3] * CELL - 1);
    }
  }
  for (const p of s.props) drawProp(ctx, p.type, p.at[0], p.at[1]);
  for (const [x, y] of s.weaponSpawns) drawWeaponSpawn(ctx, x, y);
  s.spawns.forEach(([x, y], i) => drawPlayerSpawn(ctx, x, y, i + 1));
  dashedRect(ctx, s.koth, '#c9a227', 'colline');
  dashedRect(ctx, s.goalA, '#1f4fd1', 'cage A');
  dashedRect(ctx, s.goalB, '#d6322e', 'cage B');
  if (pending) {
    ctx.fillStyle = 'rgba(31,79,209,0.3)';
    ctx.fillRect(pending[0] * CELL, pending[1] * CELL, pending[2] * CELL, pending[3] * CELL);
    ctx.strokeStyle = '#1f4fd1';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(hover.x * CELL, hover.y * CELL, pending[2] * CELL, pending[3] * CELL);
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = 'rgba(34,38,46,0.7)';
  ctx.lineWidth = 1;
  if (drag && rectLike) {
    const x = Math.min(drag.x, hover.x);
    const y = Math.min(drag.y, hover.y);
    ctx.strokeRect(
      x * CELL,
      y * CELL,
      (Math.abs(hover.x - drag.x) + 1) * CELL,
      (Math.abs(hover.y - drag.y) + 1) * CELL,
    );
  } else if (!pending) {
    ctx.strokeRect(hover.x * CELL, hover.y * CELL, CELL, CELL);
  }
}

/**
 * Créateur de niveau : plateformes, fond, pièges, source de la mort subite. Les niveaux gardés
 * dans le navigateur peuvent être testés (entraînement) puis proposés au salon, où ils entrent
 * dans le vote des cartes. Annuler / rétablir : Ctrl+Z, Ctrl+Y (ou Maj+Ctrl+Z).
 */
export function Creator(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  if (draft === null) {
    draft = newLevel(t('cr.default_name'));
    draftId = newLevelId();
    undoStack = [];
    redoStack = [];
  }
  const state = draft;
  const [tool, setTool] = useState<CTool>(Tool.SOLID);
  const [poseMode, setPoseMode] = useState<PoseMode>('brush');
  const [, setRev] = useState(0);
  const [check, setCheck] = useState<LevelCheck | null>(null);
  const hover = useRef({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; tool: CTool } | null>(null);
  const painting = useRef(false);
  const pending = useRef<Rect | null>(null);
  const timer = useRef(0);
  const checker = useRef<LevelChecker | null>(null);
  const canTest = mode.value === 'menu';
  const cellTool = CELL_TOOL_IDS.has(tool);
  /** Outil et mode lus par les écouteurs (qui ne se réabonnent pas à chaque rendu). */
  const live = useRef({ undo: (): void => undefined, redo: (): void => undefined });

  const rectLike = (): boolean =>
    tool === 'mover' || RECT_TOOLS.has(tool) || (cellTool && poseMode === 'rect');
  const redraw = (): void => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && draft) draw(ctx, draft, hover.current, drag.current, rectLike(), pending.current);
  };
  /** Analyse du niveau dans un worker (plusieurs secondes sur un terrain très ouvert). */
  const verify = async (): Promise<void> => {
    const c = (checker.current ??= new LevelChecker());
    const d = draft;
    if (!d) return;
    const report = await c.check(toArena(d));
    if (report && draft === d) setCheck(levelCheck(d.nameFr, report));
  };
  const changed = (): void => {
    redraw();
    window.clearTimeout(timer.current);
    setCheck(null);
    timer.current = window.setTimeout(() => void verify(), 350);
  };
  const rev = (): void => setRev((n) => n + 1);

  /** À appeler avant toute modification : garde l'état actuel pour « annuler ». */
  const commit = (): void => {
    if (!draft) return;
    undoStack.push(snapshot(draft));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    rev();
  };
  const undo = (): void => {
    const prev = undoStack.pop();
    if (!prev || !draft) return;
    redoStack.push(snapshot(draft));
    draft = prev;
    pending.current = null;
    rev();
    changed();
  };
  const redo = (): void => {
    const next = redoStack.pop();
    if (!next || !draft) return;
    undoStack.push(snapshot(draft));
    draft = next;
    pending.current = null;
    rev();
    changed();
  };
  live.current = { undo, redo };

  useEffect(() => {
    redraw();
    void verify();
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if ((e.ctrlKey || e.metaKey) && !typing) {
        if (e.code === 'KeyZ') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) live.current.redo();
          else live.current.undo();
          return;
        }
        if (e.code === 'KeyY') {
          e.preventDefault();
          e.stopPropagation();
          live.current.redo();
          return;
        }
      }
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      if (pending.current) {
        pending.current = null;
        redraw();
      } else overlay.value = null;
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer.current);
      checker.current?.dispose();
    };
  }, []);
  useEffect(redraw, [tool, poseMode, state.theme]);

  const cellAt = (e: PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(GRID_W - 1, Math.floor(((e.clientX - r.left) / r.width) * GRID_W))),
      y: Math.max(0, Math.min(GRID_H - 1, Math.floor(((e.clientY - r.top) / r.height) * GRID_H))),
    };
  };

  const onDown = (e: PointerEvent): void => {
    if (!draft) return;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const c = cellAt(e);
    hover.current = c;
    const tl: CTool = e.button === 2 ? Tool.ERASE : tool;
    if (pending.current && tl === 'mover') {
      commit();
      const ok = addMover(draft, pending.current, c.x, c.y);
      pending.current = null;
      if (!ok) {
        undoStack.pop();
        say(t('cr.mover_bad'));
      }
      changed();
      return;
    }
    const isCell = CELL_TOOL_IDS.has(tl);
    if (tl === 'mover' || RECT_TOOLS.has(tl) || (isCell && poseMode === 'rect')) {
      drag.current = { ...c, tool: tl };
      redraw();
      return;
    }
    commit();
    if (isCell && poseMode === 'bucket') {
      floodFill(draft, c.x, c.y, cellValue(tl), tl === Tool.ERASE);
      changed();
      return;
    }
    painting.current = true;
    if (tl === Tool.ERASE) removeMoverAt(draft, c.x, c.y);
    applyTool(draft, tl, c.x, c.y);
    changed();
  };
  const onMove = (e: PointerEvent): void => {
    const c = cellAt(e);
    hover.current = c;
    if (painting.current && draft) {
      const tl: CTool = e.buttons === 2 ? Tool.ERASE : tool;
      if (CELL_TOOL_IDS.has(tl) && poseMode === 'brush') {
        applyTool(draft, tl as ToolId, c.x, c.y);
        changed();
        return;
      }
    }
    redraw();
  };
  const onUp = (e: PointerEvent): void => {
    const c = cellAt(e);
    const d = drag.current;
    drag.current = null;
    if (d && draft) {
      if (d.tool === 'mover') {
        const x = Math.min(d.x, c.x);
        const y = Math.min(d.y, c.y);
        pending.current = [x, y, Math.abs(c.x - d.x) + 1, Math.abs(c.y - d.y) + 1];
        say(t('cr.mover_end'));
        redraw();
      } else if (RECT_TOOLS.has(d.tool)) {
        commit();
        applyRect(draft, d.tool, d.x, d.y, c.x, c.y);
        changed();
      } else {
        commit();
        fillRect(draft, d.x, d.y, c.x, c.y, cellValue(d.tool), d.tool === Tool.ERASE);
        changed();
      }
    }
    painting.current = false;
  };

  const validCount = state.spawns.length;
  const saved = levels.value;

  const save = (): void => {
    const level = finalizeLevel(state, draftId);
    const next = saved.filter((l) => l.id !== level.id);
    if (next.length >= MAX_LEVELS) {
      say(t('cr.full'));
      return;
    }
    levels.value = [level, ...next];
    saveLevels(levels.value);
    say(t('cr.saved'));
  };
  const load = (a: ArenaData): void => {
    commit();
    draft = fromArena(a);
    draftId = a.id;
    pending.current = null;
    rev();
    changed();
  };
  const fresh = (): void => {
    commit();
    draft = newLevel(t('cr.default_name'));
    draftId = newLevelId();
    pending.current = null;
    rev();
    changed();
  };
  const themeOptions = useMemo(
    () => THEME_IDS.map((id) => ({ value: id, label: t(THEME_KEYS[id]) })),
    [t('cr.title')],
  );

  return (
    <div class="creator" role="dialog" aria-modal="true" aria-label={t('cr.title')}>
      <header class="creator-head">
        <h1>{t('cr.title')}</h1>
        <input
          type="text"
          class="creator-name"
          aria-label={t('cr.name')}
          value={state.nameFr}
          maxLength={40}
          onInput={(e) => {
            state.nameFr = e.currentTarget.value;
            state.nameEn = e.currentTarget.value;
            changed();
          }}
        />
        <Button
          small
          secondary
          label={t('cr.undo')}
          title={`${t('cr.undo')} (Ctrl+Z)`}
          disabled={undoStack.length === 0}
          onClick={undo}
        >
          ↶
        </Button>
        <Button
          small
          secondary
          label={t('cr.redo')}
          title={`${t('cr.redo')} (Ctrl+Y)`}
          disabled={redoStack.length === 0}
          onClick={redo}
        >
          ↷
        </Button>
        <Button small secondary onClick={fresh}>
          {t('cr.new')}
        </Button>
        <Button
          small
          disabled={!canTest || !check?.ok}
          title={canTest ? undefined : t('cr.test_menu_only')}
          onClick={() => actions.testLevel(finalizeLevel(state, draftId))}
        >
          {t('cr.test')}
        </Button>
        <Button small onClick={save} disabled={!check?.ok}>
          {t('cr.save')}
        </Button>
        <Button small secondary onClick={() => (overlay.value = null)}>
          {t('cr.close')}
        </Button>
      </header>
      <div class="creator-body">
        <nav class="creator-tools" aria-label={t('cr.tools')}>
          <section>
            <h2>{t('cr.group_mode')}</h2>
            <div class="modes">
              {MODES.map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  class={`tool${poseMode === id ? ' on' : ''}`}
                  aria-pressed={poseMode === id}
                  disabled={!cellTool}
                  onClick={(e) => {
                    setPoseMode(id);
                    e.currentTarget.blur();
                  }}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </section>
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h2>{t(g.title)}</h2>
              {g.tools.map(([id, key]) => (
                <button
                  key={id}
                  type="button"
                  class={`tool${tool === id ? ' on' : ''}`}
                  aria-pressed={tool === id}
                  onClick={(e) => {
                    pending.current = null;
                    setTool(id);
                    e.currentTarget.blur();
                  }}
                >
                  {t(key)}
                </button>
              ))}
            </section>
          ))}
          <p class="hint">{t('cr.hint')}</p>
        </nav>
        <main class="creator-stage">
          <canvas
            ref={canvasRef}
            width={WORLD_W}
            height={WORLD_H}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
        </main>
        <aside class="creator-side">
          <Select
            label={t('cr.theme')}
            value={state.theme}
            options={themeOptions}
            onChange={(v) => {
              commit();
              state.theme = v;
              rev();
              changed();
            }}
          />
          <Select
            label={t('cr.death')}
            value={state.suddenDeath}
            options={[
              { value: 'ink-rise', label: t('cr.death_ink') },
              { value: 'tear-edges', label: t('cr.death_tear') },
            ]}
            onChange={(v) => {
              commit();
              state.suddenDeath = v;
              rev();
              changed();
            }}
          />
          <p class="hint">{t('cr.death_hint')}</p>
          <div class="row">
            <span>{t('cr.spawns', { n: validCount })}</span>
            <Button
              small
              secondary
              onClick={() => {
                const c = (checker.current ??= new LevelChecker());
                setCheck(null);
                void c.spawns(toArena(state)).then((sug) => {
                  if (!sug || !draft) return;
                  commit();
                  if (applySpawns(draft, sug) < 8) say(t('cr.auto_fail'));
                  rev();
                  changed();
                });
              }}
            >
              {t('cr.auto')}
            </Button>
          </div>
          <div class={`check ${check?.ok ? 'ok' : 'ko'}`} role="status">
            {check === null
              ? t('cr.checking')
              : check.ok
                ? t('cr.valid', { n: check.reachable })
                : t('cr.invalid', { n: check.problems.length })}
          </div>
          {check && !check.ok && (
            <ul class="problems">
              {check.problems.slice(0, 5).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <h2>{t('cr.my_levels')}</h2>
          {saved.length === 0 && <p class="hint">{t('lobby.levels_mine_none')}</p>}
          <ul class="level-list">
            {saved.map((l) => (
              <li key={l.id}>
                <span class="pname">{pick(l.name)}</span>
                <Button small secondary onClick={() => load(l)}>
                  {t('cr.open')}
                </Button>
                <Button
                  small
                  secondary
                  label={t('cr.delete')}
                  title={t('cr.delete')}
                  onClick={() => {
                    levels.value = saved.filter((x) => x.id !== l.id);
                    saveLevels(levels.value);
                  }}
                >
                  ✖
                </Button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
