import { DEFAULT_LOOK, INPUT_RING } from '@stickyclaude/shared';
import type { Look } from '@stickyclaude/shared';
import type { Connection } from './connection.ts';
import type { Room } from './room.ts';

/**
 * Un participant d'un salon : joueur (emplacement 0 à 7) ou spectateur (-1). Il survit à sa
 * connexion pendant le délai de reconnexion (`client` vaut alors null).
 */
export class Member {
  client: ClientState | null = null;
  slot = -1;
  name = '';
  look: Look = { ...DEFAULT_LOOK };
  /** Compte sayk.fr (vide si anonyme), fixé à l'arrivée : la reconnexion garde le même compte. */
  userId = '';
  /** Jeton de reconnexion (128 bits, hexadécimal). */
  token = '';
  /** Ordre d'arrivée dans le salon (pour choisir le prochain hôte). */
  joinSeq = 0;
  ready = false;
  /** Équipe (0 à 3) ; -1 en chacun pour soi. */
  team = -1;
  /** Horodatage de la perte de connexion, null si connecté. */
  disconnectedAt: number | null = null;
  /** Éliminé après la fin du délai de reconnexion : retiré à la fin de la manche. */
  leaving = false;
  /** Spectateur qui prendra une place à la prochaine manche (faux : devenu spectateur par inactivité). */
  wantsToPlay = true;

  // Anneau d'entrées étiquetées par tick (voir NETCODE.md).
  readonly ringTick = new Int32Array(INPUT_RING).fill(-1);
  readonly ringMask = new Uint16Array(INPUT_RING);
  lastMask = 0;
  missStreak = 0;
  /** Plus petite avance (en ticks) des entrées reçues depuis le dernier snapshot ; 127 = aucune. */
  minMargin = 127;
  /** Dernier événement fiable acquitté (u16). */
  ackedEvent = 0;
  /** Retard de compensation de latence annoncé par le client (ticks), borné par le serveur. */
  rewindTicks = 0;
  /** Dernière activité (entrée non neutre ou changement d'entrée), en ms. */
  lastActiveAt = 0;
  lastEmoteAt = -Infinity;

  constructor(
    readonly id: number,
    public room: Room,
  ) {}

  get connected(): boolean {
    return this.client !== null;
  }

  get isPlayer(): boolean {
    return this.slot >= 0;
  }

  resetInputs(): void {
    this.ringTick.fill(-1);
    this.lastMask = 0;
    this.missStreak = 0;
    this.minMargin = 127;
  }
}

/** État serveur d'une connexion WebSocket. */
export class ClientState {
  member: Member | null = null;
  invalidCount = 0;

  // Limites de débit (fenêtres fixes d'une seconde).
  inputWindowStart = 0;
  inputWindowCount = 0;
  pingWindowStart = 0;
  pingWindowCount = 0;
  controlWindowStart = 0;
  controlWindowCount = 0;

  constructor(readonly conn: Connection) {}

  get id(): number {
    return this.conn.id;
  }

  get room(): Room | null {
    return this.member?.room ?? null;
  }
}
