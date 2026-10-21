import { INK_COLORS, MAX_PLAYERS } from '@stickyclaude/shared';
import { roster } from '../app/store.ts';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { TEAM_COLORS } from '../render/palette.ts';
import { hex } from './components.tsx';

const TEAM_KEYS: MessageKey[] = ['team.blue', 'team.red', 'team.green', 'team.gold'];

/** Nom d'une équipe (0 à 3). */
export function teamLabel(team: number): string {
  const k = TEAM_KEYS[team];
  return k ? t(k) : t('team.name', { n: team + 1 });
}

export function teamColorCss(team: number): string {
  return hex(TEAM_COLORS[team] ?? 0x22262e);
}

/** Pseudo d'un emplacement (gardé après son départ). */
export function nameOf(slot: number): string {
  return roster.value[slot]?.name ?? t('player.n', { n: slot + 1 });
}

export function colorOfCss(slot: number): string {
  const c = roster.value[slot]?.color ?? INK_COLORS[slot % INK_COLORS.length];
  return hex(c);
}

/** Emplacement valide ? */
export function validSlot(slot: number): boolean {
  return slot >= 0 && slot < MAX_PLAYERS;
}
