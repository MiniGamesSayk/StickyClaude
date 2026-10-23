import type { PublicRoom } from '@stickyclaude/shared';
import type { NetStatus } from '../app/store.ts';

/** Une validation (Entrée, bouton) part si aucune connexion n'est déjà en cours et si ce n'est pas une répétition de touche. */
export function submitAllowed(status: NetStatus, repeat = false): boolean {
  return status !== 'connecting' && !repeat;
}

/**
 * Salon d'attente complet : y entrer ne donnerait qu'une place de spectateur jusqu'à la fin de la
 * prochaine partie. Une partie en cours reste regardable même pleine.
 */
export function roomFull(r: Pick<PublicRoom, 'players' | 'maxPlayers' | 'phase'>): boolean {
  return r.phase === 'lobby' && r.players >= r.maxPlayers;
}

/** Délai après lequel un bouton « en cours d'envoi » se réactive même sans réponse du serveur (ms). */
export const SEND_PENDING_MS = 1500;
