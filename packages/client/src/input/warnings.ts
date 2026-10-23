import type { Bindings } from '../app/options.ts';
import { ACTIONS, mouseButtonOf } from '../app/options.ts';

/**
 * Combinaisons de touches qui risquent de mal interagir avec le navigateur quand elles sont
 * pressées en même temps (menu contextuel, fermeture d'onglet, navigation…). La liste est
 * purement informative : rien n'est refusé, l'écran des options affiche un avertissement.
 */

export type WarningId =
  | 'shift_rightclick'
  | 'ctrl_click'
  | 'ctrl_tab'
  | 'alt_arrows'
  | 'alt_alone'
  | 'meta'
  | 'function_key'
  | 'mouse_side'
  | 'duplicate';

export interface BindingWarning {
  id: WarningId;
  /** Codes de touche concernés (pour l'affichage). */
  keys: string[];
}

export interface Env {
  firefox: boolean;
  mac: boolean;
}

export function detectEnv(): Env {
  if (typeof navigator === 'undefined') return { firefox: false, mac: false };
  const ua = navigator.userAgent;
  return { firefox: /firefox/i.test(ua), mac: /Mac|iPhone|iPad/i.test(ua) };
}

const isShift = (c: string): boolean => c === 'ShiftLeft' || c === 'ShiftRight';
const isCtrl = (c: string): boolean => c === 'ControlLeft' || c === 'ControlRight';
const isAlt = (c: string): boolean => c === 'AltLeft' || c === 'AltRight';
const isMeta = (c: string): boolean => c === 'MetaLeft' || c === 'MetaRight' || c === 'OSLeft';
const isFunction = (c: string): boolean => /^F([1-9]|1[0-2])$/.test(c);

/** Raccourcis de fenêtre que le navigateur garde pour lui, même quand la page les intercepte. */
const CTRL_RESERVED = ['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'Tab', 'PageUp', 'PageDown'];

/** Avertissements pour un jeu de touches, dans l'ordre d'importance. */
export function bindingWarnings(b: Readonly<Bindings>, env: Env): BindingWarning[] {
  const all: string[] = [];
  for (const a of ACTIONS) for (const c of b[a]) if (c !== '') all.push(c);
  const has = (pred: (c: string) => boolean): string[] => [...new Set(all.filter(pred))];
  const out: BindingWarning[] = [];

  const shift = has(isShift);
  if (env.firefox && shift.length > 0 && all.includes('Mouse2')) {
    out.push({ id: 'shift_rightclick', keys: [...shift, 'Mouse2'] });
  }
  const ctrl = has(isCtrl);
  if (ctrl.length > 0) {
    const reserved = has((c) => CTRL_RESERVED.includes(c));
    if (reserved.length > 0) out.push({ id: 'ctrl_tab', keys: [...ctrl, ...reserved] });
    if (env.mac && (all.includes('Mouse0') || all.includes('Mouse2'))) {
      out.push({ id: 'ctrl_click', keys: [...ctrl, 'Mouse0'] });
    }
  }
  const alt = has(isAlt);
  if (alt.length > 0) {
    const arrows = has((c) => c === 'ArrowLeft' || c === 'ArrowRight');
    if (arrows.length > 0) out.push({ id: 'alt_arrows', keys: [...alt, ...arrows] });
    out.push({ id: 'alt_alone', keys: alt });
  }
  const meta = has(isMeta);
  if (meta.length > 0) out.push({ id: 'meta', keys: meta });
  const fn = has(isFunction);
  if (fn.length > 0) out.push({ id: 'function_key', keys: fn });
  const side = has((c) => mouseButtonOf(c) === 3 || mouseButtonOf(c) === 4);
  if (side.length > 0) out.push({ id: 'mouse_side', keys: side });
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of all) (seen.has(c) ? dup : seen).add(c);
  if (dup.size > 0) out.push({ id: 'duplicate', keys: [...dup] });
  return out;
}
