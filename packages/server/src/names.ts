import { NAME_MAX, NAME_MIN } from '@stickyclaude/shared';
import { isOffensive } from './badwords.ts';

// Contrôles, caractères de largeur nulle et contrôles bidirectionnels.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Normalise un pseudo (NFKC, sans invisibles) ; null s'il est invalide : 2 à 16 caractères, ou
 * contenant un mot refusé (voir `badwords.ts`).
 */
export function sanitizeName(raw: string): string | null {
  const name = raw.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
  const len = [...name].length;
  if (len < NAME_MIN || len > NAME_MAX) return null;
  if (isOffensive(name)) return null;
  return name;
}
