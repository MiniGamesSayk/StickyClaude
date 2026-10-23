import {
  ARENAS,
  Cell,
  CELL,
  GRID_H,
  GRID_W,
  Input,
  TICK_MS,
  WORLD_H,
  WORLD_W,
} from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import { arenaSchema } from '@stickyclaude/shared/schemas';
import { addPlayer, createWorld, step } from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';
import {
  applyRect,
  applyTool,
  emptyState,
  fromArena,
  RECT_TOOLS,
  Tool,
  toArena,
  validate,
} from './model.ts';
import type { EditorState, ToolId } from './model.ts';

/**
 * Éditeur d'arènes (développement seulement : servi par `npm run dev` à l'adresse `/editor`,
 * absent de la version construite). Voir `docs/ARENES.md`.
 */

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const toolsEl = byId('tools');
const sideEl = byId('side');
const statusEl = byId('status');

let state: EditorState = emptyState();
let tool: ToolId = Tool.SOLID;
let drag: { x: number; y: number } | null = null;
let hover = { x: 0, y: 0 };
let painting = false;
let world: World | null = null;
let held = 0;

const COLORS = {
  paper: '#f6f1e3',
  grid: '#dbe3f1',
  solid: '#1b2a5e',
  destructible: '#d8c79a',
  oneway: '#1f4fd1',
  hazard: '#d6322e',
};

/** Outils qui se peignent en glissant (les marqueurs, eux, se posent un par un). */
const PAINTABLE: ReadonlySet<ToolId> = new Set([
  Tool.EMPTY,
  Tool.SOLID,
  Tool.PAPER,
  Tool.ONEWAY,
  Tool.HAZARD,
  Tool.ERASE,
]);

// --- Dessin -------------------------------------------------------------------------------------

function drawCells(cells: Uint8Array): void {
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= GRID_W; x++) {
    ctx.moveTo(x * CELL + 0.5, 0);
    ctx.lineTo(x * CELL + 0.5, WORLD_H);
  }
  for (let y = 0; y <= GRID_H; y++) {
    ctx.moveTo(0, y * CELL + 0.5);
    ctx.lineTo(WORLD_W, y * CELL + 0.5);
  }
  ctx.stroke();
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const t = cells[y * GRID_W + x];
      const px = x * CELL;
      const py = y * CELL;
      if (t === Cell.SOLID) {
        ctx.fillStyle = COLORS.solid;
        ctx.fillRect(px, py, CELL, CELL);
      } else if (t === Cell.PAPER) {
        ctx.fillStyle = COLORS.destructible;
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      } else if (t === Cell.ONEWAY) {
        ctx.fillStyle = COLORS.oneway;
        ctx.fillRect(px, py, CELL, 4);
      } else if (t === Cell.HAZARD) {
        ctx.fillStyle = COLORS.hazard;
        ctx.beginPath();
        ctx.moveTo(px, py + CELL);
        ctx.lineTo(px + CELL / 2, py + 2);
        ctx.lineTo(px + CELL, py + CELL);
        ctx.fill();
      }
    }
  }
}

function label(text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

function dashedRect(r: number[] | null, color: string, text: string): void {
  if (!r) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(r[0] * CELL, r[1] * CELL, r[2] * CELL, r[3] * CELL);
  ctx.setLineDash([]);
  label(text, (r[0] + r[2] / 2) * CELL, r[1] * CELL - 3, color);
}

function drawMarkers(): void {
  state.spawns.forEach(([x, y], i) => {
    ctx.strokeStyle = '#1f9d55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc((x + 0.5) * CELL, (y + 0.5) * CELL, 6, 0, Math.PI * 2);
    ctx.stroke();
    label(String(i + 1), (x + 0.5) * CELL, (y + 0.5) * CELL + 4, '#1f9d55');
  });
  for (const [x, y] of state.weaponSpawns) {
    ctx.strokeStyle = '#e8801a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6);
    label('A', (x + 0.5) * CELL, (y + 0.5) * CELL + 4, '#e8801a');
  }
  for (const p of state.props) {
    const letter = p.type === 'crate' ? 'C' : p.type === 'balloon' ? 'B' : 'P';
    label(letter, (p.at[0] + 0.5) * CELL, (p.at[1] + 0.5) * CELL + 4, '#7a4a2b');
  }
  dashedRect(state.koth, '#c9a227', 'colline');
  dashedRect(state.goalA, '#1f4fd1', 'cage A');
  dashedRect(state.goalB, '#d6322e', 'cage B');
  if (state.ballSpawn) {
    const [x, y] = state.ballSpawn;
    ctx.strokeStyle = '#22262e';
    ctx.beginPath();
    ctx.arc((x + 0.5) * CELL, (y + 0.5) * CELL, 5, 0, Math.PI * 2);
    ctx.stroke();
    label('boule', (x + 0.5) * CELL, y * CELL - 2, '#22262e');
  }
  for (const m of state.movers) {
    ctx.strokeStyle = 'rgba(31,79,209,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    m.path.forEach(([x, y], i) => {
      const cx = (x + m.rect[2] / 2) * CELL;
      const cy = (y + m.rect[3] / 2) * CELL;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.fillStyle = 'rgba(31,79,209,0.35)';
    ctx.fillRect(m.rect[0] * CELL, m.rect[1] * CELL, m.rect[2] * CELL, m.rect[3] * CELL);
  }
}

function drawPlay(w: World): void {
  drawCells(w.cells);
  for (let i = 0; i < w.moverCount; i++) {
    const m = w.movers[i];
    ctx.fillStyle = 'rgba(31,79,209,0.45)';
    ctx.fillRect(m.x, m.y, m.w, m.h);
  }
  for (const o of w.objects) {
    if (!o.active) continue;
    ctx.fillStyle = '#e8801a';
    ctx.fillRect(o.x - o.w / 2, o.y - o.h, o.w, o.h);
  }
  w.players.forEach((p, slot) => {
    if (!p.active || p.dead) return;
    const h = p.crouching ? w.params.crouchHeight : w.params.height;
    ctx.fillStyle = slot === 0 ? '#1f4fd1' : '#d6322e';
    ctx.fillRect(p.x - w.params.width / 2, p.y - h, w.params.width, h);
  });
}

function draw(): void {
  if (world) {
    drawPlay(world);
    return;
  }
  drawCells(state.cells);
  drawMarkers();
  if (drag && RECT_TOOLS.has(tool)) {
    const x = Math.min(drag.x, hover.x);
    const y = Math.min(drag.y, hover.y);
    ctx.strokeStyle = '#22262e';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x * CELL,
      y * CELL,
      (Math.abs(hover.x - drag.x) + 1) * CELL,
      (Math.abs(hover.y - drag.y) + 1) * CELL,
    );
  } else {
    ctx.strokeStyle = 'rgba(34,38,46,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(hover.x * CELL, hover.y * CELL, CELL, CELL);
  }
}

// --- Entrées ------------------------------------------------------------------------------------

function cellAt(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(GRID_W - 1, Math.floor(((e.clientX - r.left) / r.width) * GRID_W))),
    y: Math.max(0, Math.min(GRID_H - 1, Math.floor(((e.clientY - r.top) / r.height) * GRID_H))),
  };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (world) return;
  canvas.setPointerCapture(e.pointerId);
  const c = cellAt(e);
  hover = c;
  const t: ToolId = e.button === 2 ? Tool.ERASE : tool;
  if (RECT_TOOLS.has(t)) drag = c;
  else {
    painting = true;
    applyTool(state, t, c.x, c.y);
    changed();
  }
});
canvas.addEventListener('pointermove', (e) => {
  const c = cellAt(e);
  hover = c;
  statusEl.textContent = `cellule (${c.x}, ${c.y})`;
  if (painting && !world) {
    const t: ToolId = e.buttons === 2 ? Tool.ERASE : tool;
    if (PAINTABLE.has(t)) {
      applyTool(state, t, c.x, c.y);
      changed();
    }
  }
});
canvas.addEventListener('pointerup', () => {
  if (drag) {
    applyRect(state, tool, drag.x, drag.y, hover.x, hover.y);
    drag = null;
    changed();
  }
  painting = false;
});

const KEYS: Record<string, number> = {
  KeyA: Input.LEFT,
  ArrowLeft: Input.LEFT,
  KeyD: Input.RIGHT,
  ArrowRight: Input.RIGHT,
  KeyW: Input.UP,
  ArrowUp: Input.UP,
  KeyS: Input.DOWN,
  ArrowDown: Input.DOWN,
  Space: Input.JUMP,
  KeyJ: Input.ATTACK,
  KeyE: Input.BLOCK,
  KeyL: Input.PICKUP,
  ShiftLeft: Input.DASH,
  ShiftRight: Input.DASH,
};
window.addEventListener('keydown', (e) => {
  const bit = KEYS[e.code];
  if (world && bit !== undefined) {
    held |= bit;
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  const bit = KEYS[e.code];
  if (bit !== undefined) held &= ~bit;
});

// --- Test en local ------------------------------------------------------------------------------

function startPlay(): void {
  const w = createWorld(toArena(state), 1234);
  addPlayer(w, 0);
  addPlayer(w, 1); // un mannequin pour essayer les coups
  w.players[1].x += 40;
  world = w;
}

let acc = 0;
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;
  if (world) {
    acc += dt;
    const inputs = new Uint32Array(8);
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      inputs[0] = held;
      step(world, inputs);
    }
  }
  draw();
  requestAnimationFrame(frame);
}

// --- Interface ----------------------------------------------------------------------------------

const TOOL_LABELS: [ToolId, string][] = [
  [Tool.EMPTY, 'Vide'],
  [Tool.SOLID, 'Bloc plein #'],
  [Tool.PAPER, 'Papier destructible p'],
  [Tool.ONEWAY, 'Plateforme à sens unique -'],
  [Tool.HAZARD, 'Danger ^'],
  [Tool.SPAWN, 'Apparition joueur'],
  [Tool.WEAPON, 'Apparition arme'],
  [Tool.CRATE, 'Caisse'],
  [Tool.BALLOON, 'Ballon'],
  [Tool.TACK, 'Punaise'],
  [Tool.KOTH, 'Zone de la colline (glisser)'],
  [Tool.GOAL_A, 'Cage A (glisser)'],
  [Tool.GOAL_B, 'Cage B (glisser)'],
  [Tool.BALL_SPAWN, 'Départ de la boule'],
  [Tool.ERASE, 'Gomme (ou clic droit)'],
];

function buildTools(): void {
  toolsEl.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = 'Éditeur d’arènes';
  toolsEl.append(h);
  for (const [id, text] of TOOL_LABELS) {
    const b = document.createElement('button');
    b.textContent = text;
    b.classList.toggle('on', id === tool);
    b.addEventListener('click', () => {
      tool = id;
      buildTools();
    });
    toolsEl.append(b);
  }
  const play = document.createElement('button');
  play.textContent = world ? '■ Arrêter le test' : '▶ Tester ici (flèches, espace, J E L)';
  play.addEventListener('click', () => {
    if (world) world = null;
    else startPlay();
    buildTools();
  });
  toolsEl.append(play);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent =
    'Clic gauche : poser · clic droit : effacer · les marqueurs se posent et se retirent d’un clic.';
  toolsEl.append(hint);
}

function field(text: string, value: string, onChange: (v: string) => void): HTMLElement {
  const l = document.createElement('label');
  l.textContent = text;
  const i = document.createElement('input');
  i.value = value;
  i.addEventListener('input', () => {
    onChange(i.value);
    changed(false);
  });
  l.append(i);
  return l;
}

let validationTimer = 0;
const validationEl = document.createElement('div');
const exportEl = document.createElement('textarea');
exportEl.readOnly = true;
const importEl = document.createElement('textarea');
importEl.placeholder = 'Coller ici le JSON d’une arène puis « Importer »';

function changed(refresh = true): void {
  window.clearTimeout(validationTimer);
  validationTimer = window.setTimeout(runValidation, 150);
  exportEl.value = JSON.stringify(toArena(state), null, 2);
  if (refresh) draw();
}

function runValidation(): void {
  const v = validate(state, (a: ArenaData) => {
    const r = arenaSchema.safeParse(a);
    return {
      ok: r.success,
      issues: r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`),
    };
  });
  validationEl.replaceChildren();
  const all = [...v.schema, ...v.analysis];
  const head = document.createElement('div');
  head.className = all.length === 0 ? 'ok' : 'ko';
  head.textContent =
    all.length === 0
      ? `✓ valide · ${v.standing} positions debout, ${v.reachable} atteignables`
      : `✗ ${all.length} problème${all.length > 1 ? 's' : ''}`;
  validationEl.append(head);
  if (all.length > 0) {
    const ul = document.createElement('ul');
    for (const m of all.slice(0, 30)) {
      const li = document.createElement('li');
      li.textContent = m;
      ul.append(li);
    }
    validationEl.append(ul);
  }
}

function jsonBox(value: unknown, apply: (parsed: unknown) => void): HTMLTextAreaElement {
  const t = document.createElement('textarea');
  t.value = JSON.stringify(value);
  t.style.height = '60px';
  t.addEventListener('change', () => {
    try {
      apply(JSON.parse(t.value));
      t.style.borderColor = '';
      changed();
    } catch {
      t.style.borderColor = '#d6322e';
    }
  });
  return t;
}

function title(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function buildSide(): void {
  sideEl.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = 'Arène';
  sideEl.append(
    h,
    field('Identifiant (a-z, 0-9, -)', state.id, (v) => (state.id = v)),
    field('Nom (français)', state.nameFr, (v) => (state.nameFr = v)),
    field('Nom (anglais)', state.nameEn, (v) => (state.nameEn = v)),
    field('Thème', state.theme, (v) => (state.theme = v)),
  );
  const sd = document.createElement('select');
  for (const v of ['ink-rise', 'tear-edges']) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent =
      v === 'ink-rise' ? 'Mort subite : l’encre monte' : 'Mort subite : bords déchirés';
    sd.append(o);
  }
  sd.value = state.suddenDeath;
  sd.addEventListener('change', () => {
    state.suddenDeath = sd.value as EditorState['suddenDeath'];
    changed(false);
  });
  const load = document.createElement('select');
  const none = document.createElement('option');
  none.textContent = 'Charger une arène existante…';
  none.value = '';
  load.append(none);
  for (const id of Object.keys(ARENAS)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    load.append(o);
  }
  load.addEventListener('change', () => {
    if (!load.value) return;
    state = fromArena(ARENAS[load.value]);
    buildSide();
    changed();
  });
  sideEl.append(
    sd,
    load,
    button('Nouvelle arène vide', () => {
      state = emptyState();
      buildSide();
      changed();
    }),
    title('Plateformes mobiles (JSON)'),
    jsonBox(state.movers, (p) => (state.movers = p as EditorState['movers'])),
    title('Décor (JSON)'),
    jsonBox(state.decor, (p) => (state.decor = p as EditorState['decor'])),
    title('Validation'),
    validationEl,
    title('Export'),
    exportEl,
    button('Copier le JSON', () => void navigator.clipboard.writeText(exportEl.value)),
    button('Télécharger le JSON', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([exportEl.value], { type: 'application/json' }));
      a.download = `${state.id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }),
    importEl,
    button('Importer le JSON collé', () => {
      try {
        state = fromArena(arenaSchema.parse(JSON.parse(importEl.value)));
        buildSide();
        changed();
      } catch (err) {
        statusEl.textContent = `Import impossible : ${err instanceof Error ? err.message : String(err)}`;
      }
    }),
  );
}

buildTools();
buildSide();
changed();
requestAnimationFrame(frame);
