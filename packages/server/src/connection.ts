/** Ce que le cœur du serveur voit d'une connexion (WebSocket réel ou lien simulé en test). */
export interface Connection {
  readonly id: number;
  readonly ip: string;
  /** Octets en attente d'envoi (contre-pression). */
  readonly bufferedAmount: number;
  /** Latence aller-retour mesurée par le serveur (ms), 0 si inconnue. */
  rttMs?: number;
  /** Compte sayk.fr connecté (cookie de session vérifié à l'ouverture), absent si anonyme. */
  userId?: string;
  send(data: Uint8Array | string): void;
  close(code: number, reason: string): void;
}
