import { Cause, SillyDeath } from '@stickyclaude/shared';
import type { ErrorCode } from '@stickyclaude/shared';

/** Textes de l'interface de développement (français). L'i18n FR + EN arrive en phase 3. */

export const ERRORS: Record<ErrorCode, string> = {
  version: 'Version du jeu incompatible : recharge la page.',
  bad_request: 'Requête invalide.',
  bad_name: 'Pseudo invalide (2 à 16 caractères, sans mot interdit).',
  not_found: 'Aucun salon avec ce code.',
  full: 'Ce salon est plein.',
  server_full: 'Le serveur est plein, réessaie dans un instant.',
  rate_limited: 'Trop d’essais, patiente un peu.',
  already_joined: 'Tu es déjà dans un salon.',
  not_joined: 'Tu n’es dans aucun salon.',
  forbidden: 'Action interdite.',
  not_host: 'Seul l’hôte peut faire cela.',
  not_enough_players: 'Il faut au moins 2 joueurs pour lancer la partie.',
  not_ready: 'Tous les joueurs ne sont pas prêts.',
  in_game: 'Impossible pendant une partie.',
  bad_token: 'Impossible de reprendre ta place : le délai est dépassé.',
};

export const CAUSE_TEXT: Record<number, string> = {
  [Cause.NONE]: 'on ne sait quoi',
  [Cause.MELEE]: 'un coup de poing',
  [Cause.KICK]: 'un coup de pied',
  [Cause.WEAPON_MELEE]: 'une arme de mêlée',
  [Cause.BULLET]: 'une balle',
  [Cause.PROJECTILE]: 'un projectile',
  [Cause.EXPLOSION]: 'une explosion',
  [Cause.THROWN]: 'un objet lancé',
  [Cause.HAZARD]: 'le décor',
  [Cause.FALL]: 'une chute',
  [Cause.INK]: 'l’encre',
  [Cause.MINE]: 'une mine',
  [Cause.POTATO]: 'la patate d’encre',
  [Cause.BALLOON]: 'un ballon',
  [Cause.GHOST]: 'un fantôme',
  [Cause.TACK]: 'une punaise',
};

export const SILLY_TEXT: Record<number, string> = {
  [SillyDeath.NONE]: '–',
  [SillyDeath.FALL]: 'chute dans le vide',
  [SillyDeath.FRIENDLY]: 'tir ami',
  [SillyDeath.SELF]: 'sa propre arme',
};

export const KEYS_HINT =
  'Flèches ou WASD/ZQSD : bouger et viser · Espace : sauter (×2) · J : frapper (maintenu : coup chargé) · K : parer · L : ramasser / lancer (↓+L : lâcher) · 1-9 : emotes · F3 : réseau';
