import { INPUT_RING } from '@stickyclaude/shared';
import type { Connection } from './connection.ts';
import type { Room } from './room.ts';

/** État serveur d'un client connecté. */
export class ClientState {
  room: Room | null = null;
  slot = -1;
  name = '';
  color = 0;
  /** Ordre d'arrivée dans le salon (pour choisir le prochain hôte). */
  joinSeq = 0;
  invalidCount = 0;

  // Anneau d'entrées étiquetées par tick (voir NETCODE.md).
  readonly ringTick = new Int32Array(INPUT_RING).fill(-1);
  readonly ringMask = new Uint16Array(INPUT_RING);
  lastMask = 0;
  missStreak = 0;
  /** Plus petite avance (en ticks) des entrées reçues depuis le dernier snapshot ; 127 = aucune. */
  minMargin = 127;
  /** Dernier événement fiable acquitté par le client (u16). */
  ackedEvent = 0;
  /** Retard d'interpolation annoncé par le client (ms), pour la compensation de latence. */
  interpDelayMs = 100;

  // Limites de débit (fenêtres fixes d'une seconde).
  inputWindowStart = 0;
  inputWindowCount = 0;
  pingWindowStart = 0;
  pingWindowCount = 0;

  constructor(readonly conn: Connection) {}

  get id(): number {
    return this.conn.id;
  }

  resetInputs(): void {
    this.ringTick.fill(-1);
    this.lastMask = 0;
    this.missStreak = 0;
    this.minMargin = 127;
  }
}
