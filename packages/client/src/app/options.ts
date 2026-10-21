import { signal } from '@preact/signals';
import { DEFAULT_LOOK, sanitizeLook } from '@stickyclaude/shared';
import type { Look } from '@stickyclaude/shared';
import { detectLang } from '../i18n/index.ts';
import type { Lang } from '../i18n/index.ts';
import type { QualitySetting } from '../render/quality.ts';

/**
 * Options du jeu et profil (pseudo, apparence), sauvegardés en `localStorage` : lecture et
 * écriture ne lèvent jamais (mode privé, stockage plein). Chaque valeur est validée à la lecture.
 */

export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack' | 'block' | 'pickup';
export const ACTIONS: readonly Action[] = [
  'left',
  'right',
  'up',
  'down',
  'jump',
  'attack',
  'block',
  'pickup',
];

/** Deux touches par action (position physique, `event.code`) : principale et secondaire. */
export type Bindings = Record<Action, [string, string]>;

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space', ''],
  attack: ['KeyJ', ''],
  block: ['KeyK', ''],
  pickup: ['KeyL', ''],
};

export type TouchMode = 'auto' | 'on' | 'off';
export type MotionSetting = 'auto' | 'on' | 'off';
export type FpsCap = 0 | 30 | 60;
export type KeyboardLayout = 'auto' | 'azerty' | 'qwerty';

export interface Options {
  lang: Lang;
  master: number;
  sfx: number;
  music: number;
  quality: QualitySetting;
  fpsCap: FpsCap;
  /** « auto » suit `prefers-reduced-motion`. */
  reducedMotion: MotionSetting;
  /** Taille du texte de l'interface en % (90, 100, 115, 130). */
  textScale: number;
  showStats: boolean;
  layout: KeyboardLayout;
  bindings: Bindings;
  touch: TouchMode;
  /** Taille des boutons tactiles (0,7 à 1,5) et côté du joystick (-1 gauche, 1 droite). */
  touchSize: number;
  touchSwap: boolean;
  vibration: boolean;
  padRumble: boolean;
  /** Plein écran au lancement d'une partie (mobile). */
  autoFullscreen: boolean;
}

const KEY = 'stickyclaude.options';
const PROFILE_KEY = 'stickyclaude.profile';
const NAME_KEY = 'stickyclaude.name';
const LOOK_KEY = 'stickyclaude.look';

export function defaultOptions(navLang?: string): Options {
  return {
    lang: detectLang(navLang),
    master: 0.8,
    sfx: 1,
    music: 0.6,
    quality: 'auto',
    fpsCap: 0,
    reducedMotion: 'auto',
    textScale: 100,
    showStats: false,
    layout: 'auto',
    bindings: structuredClone(DEFAULT_BINDINGS),
    touch: 'auto',
    touchSize: 1,
    touchSwap: false,
    vibration: true,
    padRumble: true,
    autoFullscreen: true,
  };
}

function num(v: unknown, lo: number, hi: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

function pick<T extends string | number>(v: unknown, allowed: readonly T[], def: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : def;
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

/** Ne garde que des codes de touche plausibles (lettres, chiffres, flèches…). */
function code(v: unknown, def: string): string {
  return typeof v === 'string' && /^[A-Za-z0-9]{0,24}$/.test(v) ? v : def;
}

/** Ramène un objet quelconque (JSON lu en local) à des options valides. */
export function sanitizeOptions(raw: unknown, base: Options = defaultOptions()): Options {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const b = base.bindings;
  const rb = (typeof r.bindings === 'object' && r.bindings !== null ? r.bindings : {}) as Record<
    string,
    unknown
  >;
  const bindings = {} as Bindings;
  for (const a of ACTIONS) {
    const pair = Array.isArray(rb[a]) ? (rb[a] as unknown[]) : [];
    bindings[a] = [code(pair[0], b[a][0]), code(pair[1], b[a][1])];
  }
  return {
    lang: pick(r.lang, ['fr', 'en'] as const, base.lang),
    master: num(r.master, 0, 1, base.master),
    sfx: num(r.sfx, 0, 1, base.sfx),
    music: num(r.music, 0, 1, base.music),
    quality: pick(r.quality, ['auto', 'low', 'medium', 'high'] as const, base.quality),
    fpsCap: pick(r.fpsCap, [0, 30, 60] as const, base.fpsCap),
    reducedMotion: pick(r.reducedMotion, ['auto', 'on', 'off'] as const, base.reducedMotion),
    textScale: pick(r.textScale, [90, 100, 115, 130] as const, base.textScale as 100),
    showStats: bool(r.showStats, base.showStats),
    layout: pick(r.layout, ['auto', 'azerty', 'qwerty'] as const, base.layout),
    bindings,
    touch: pick(r.touch, ['auto', 'on', 'off'] as const, base.touch),
    touchSize: num(r.touchSize, 0.7, 1.5, base.touchSize),
    touchSwap: bool(r.touchSwap, base.touchSwap),
    vibration: bool(r.vibration, base.vibration),
    padRumble: bool(r.padRumble, base.padRumble),
    autoFullscreen: bool(r.autoFullscreen, base.autoFullscreen),
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : sans importance */
  }
}

export function loadOptions(): Options {
  const base = defaultOptions(typeof navigator === 'undefined' ? undefined : navigator.language);
  const raw = read(KEY);
  if (!raw) return base;
  try {
    return sanitizeOptions(JSON.parse(raw), base);
  } catch {
    return base;
  }
}

export const options = signal<Options>(loadOptions());

/** Modifie une ou plusieurs options et les sauvegarde. */
export function setOptions(patch: Partial<Options>): void {
  options.value = sanitizeOptions({ ...options.value, ...patch }, options.value);
  write(KEY, JSON.stringify(options.value));
}

export function resetBindings(): void {
  setOptions({ bindings: structuredClone(DEFAULT_BINDINGS) });
}

/** Rattache `code` à l'action : si une autre action l'utilisait déjà, elle perd cette touche. */
export function rebind(action: Action, slot: 0 | 1, keyCode: string): void {
  const next: Bindings = structuredClone(options.value.bindings);
  for (const a of ACTIONS) {
    for (const s of [0, 1] as const) {
      if (next[a][s] === keyCode) next[a][s] = '';
    }
  }
  next[action][slot] = keyCode;
  // une action ne reste jamais sans touche
  if (next[action][0] === '' && next[action][1] !== '') {
    next[action] = [next[action][1], ''];
  }
  setOptions({ bindings: next });
}

// --- Profil -------------------------------------------------------------------------------------

export interface Profile {
  name: string;
  look: Look;
}

export function loadProfile(): Profile {
  let look: Look = { ...DEFAULT_LOOK, color: 0 };
  const raw = read(LOOK_KEY) ?? read(PROFILE_KEY);
  let hasLook = false;
  if (raw) {
    try {
      look = sanitizeLook(JSON.parse(raw), DEFAULT_LOOK);
      hasLook = true;
    } catch {
      /* illisible : valeurs par défaut */
    }
  }
  // première visite : une couleur au hasard (l'interface, pas la simulation)
  if (!hasLook) look.color = Math.floor(Math.random() * 12);
  const name = read(NAME_KEY) ?? `Joueur${Math.floor(Math.random() * 900 + 100)}`;
  return { name, look };
}

export const profile = signal<Profile>(loadProfile());

export function setProfile(patch: Partial<Profile>): void {
  const next = { ...profile.value, ...patch };
  if (patch.look) next.look = sanitizeLook(patch.look, DEFAULT_LOOK);
  profile.value = next;
  write(NAME_KEY, next.name);
  write(LOOK_KEY, JSON.stringify(next.look));
}
