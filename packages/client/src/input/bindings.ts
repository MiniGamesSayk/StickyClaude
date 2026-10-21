import type { KeyboardLayout } from '../app/options.ts';

/**
 * Libellés des touches (analyse §1.6) : les touches sont enregistrées par position physique, on
 * affiche ce qui est gravé dessus. `navigator.keyboard.getLayoutMap()` (Chromium) donne la
 * disposition réelle ; sinon on s'appuie sur le choix de l'option (AZERTY ou QWERTY).
 */

export type LayoutMap = { get(code: string): string | undefined };

/** Lettres qui changent de place entre QWERTY et AZERTY (position physique → lettre AZERTY). */
const AZERTY: Record<string, string> = {
  KeyQ: 'A',
  KeyA: 'Q',
  KeyW: 'Z',
  KeyZ: 'W',
  KeyM: ',',
  Semicolon: 'M',
};

/** Détecte AZERTY d'après la carte de disposition (la touche physique « Q » donne « a »). */
export function detectLayout(map: LayoutMap | null): 'azerty' | 'qwerty' {
  return map?.get('KeyQ') === 'a' ? 'azerty' : 'qwerty';
}

let layoutMap: LayoutMap | null = null;

/** Charge la carte de disposition (silencieux si l'API n'existe pas). */
export async function loadLayoutMap(): Promise<void> {
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<LayoutMap> } })
      .keyboard;
    if (kb) layoutMap = await kb.getLayoutMap();
  } catch {
    layoutMap = null;
  }
}

export function currentLayout(option: KeyboardLayout): 'azerty' | 'qwerty' {
  if (option !== 'auto') return option;
  if (layoutMap) return detectLayout(layoutMap);
  // repli : la langue du navigateur
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fr')
    ? 'azerty'
    : 'qwerty';
}

const NAMED: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '⏎',
  ShiftLeft: '⇧',
  ShiftRight: '⇧',
  Tab: '⇥',
  Backspace: '⌫',
  Escape: 'Échap',
};

/** Libellé court d'un code de touche, `space` : texte traduit de la barre d'espace. */
export function keyLabel(code: string, option: KeyboardLayout, space = 'Espace'): string {
  if (code === '') return '—';
  if (code === 'Space') return space;
  if (NAMED[code]) return NAMED[code];
  if (layoutMap && option === 'auto') {
    const v = layoutMap.get(code);
    if (v) return v.length === 1 ? v.toUpperCase() : v;
  }
  if (/^Key[A-Z]$/.test(code)) {
    return currentLayout(option) === 'azerty' ? (AZERTY[code] ?? code.slice(3)) : code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}
