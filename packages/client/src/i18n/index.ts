import { signal } from '@preact/signals';
import { en } from './en.ts';
import { fr } from './fr.ts';
import type { MessageKey } from './fr.ts';

/**
 * i18n FR + EN (analyse §1.12). Un fichier par langue, avec des clés typées : `fr.ts` fixe la liste
 * des clés, `en.ts` est un `Record<MessageKey, string>`, donc une clé qui manque (ou en trop) est
 * une erreur de compilation. Les onomatopées (BAM, POW…) sont des éléments graphiques, communes
 * aux deux langues, et ne passent pas par ici.
 */

export type Lang = 'fr' | 'en';
export type { MessageKey };

const DICTS: Record<Lang, Record<MessageKey, string>> = { fr, en };

/** Langue par défaut : FR, sauf si le navigateur n'est pas en français. */
export function detectLang(navLang: string | undefined): Lang {
  return navLang === undefined || navLang === '' || navLang.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en';
}

/** Langue courante : lire `lang.value` dans un composant l'abonne aux changements. */
export const lang = signal<Lang>(
  detectLang(typeof navigator === 'undefined' ? undefined : navigator.language),
);

/** Remplace les `{nom}` d'un message par les valeurs données. */
export function format(text: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}

/** Traduit une clé dans la langue courante. */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  return format(DICTS[lang.value][key], params);
}

/** Traduit dans une langue précise (tests, messages hors interface). */
export function tIn(
  l: Lang,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  return format(DICTS[l][key], params);
}

/** Choisit le texte d'une paire `{ fr, en }` des données partagées (armes, modes, arènes…). */
export function pick(name: Readonly<{ fr: string; en: string }>): string {
  return name[lang.value];
}

export function setLang(l: Lang): void {
  lang.value = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/** Toutes les clés d'une langue (tests de complétude). */
export function keysOf(l: Lang): MessageKey[] {
  return Object.keys(DICTS[l]) as MessageKey[];
}
