import { eventIdDiff, MAX_EVENT_PAYLOAD, MAX_SNAPSHOT_EVENTS } from '@stickyclaude/shared';
import type { Snapshot } from '@stickyclaude/shared';

const RELIABLE_RING = 128;

/**
 * Journal d'événements fiables d'une salle : chaque événement reçoit un identifiant (u16) et est
 * répété dans les snapshots d'un client jusqu'à ce qu'il l'acquitte.
 */
export class ReliableLog {
  lastId = 0;
  private readonly types = new Uint8Array(RELIABLE_RING);
  private readonly lens = new Uint8Array(RELIABLE_RING);
  private readonly data = new Uint8Array(RELIABLE_RING * MAX_EVENT_PAYLOAD);

  push(type: number, payload: Uint8Array, len: number): void {
    this.lastId = (this.lastId + 1) & 0xffff;
    const i = this.lastId & (RELIABLE_RING - 1);
    this.types[i] = type;
    this.lens[i] = len;
    this.data.set(payload.subarray(0, len), i * MAX_EVENT_PAYLOAD);
  }

  /**
   * Copie dans `snap` les événements postérieurs à `acked` (au plus MAX_SNAPSHOT_EVENTS).
   * Retourne leur nombre, ou -1 si le client a trop de retard pour être resynchronisé.
   */
  fill(snap: Snapshot, acked: number): number {
    const behind = eventIdDiff(this.lastId, acked);
    if (behind <= 0) return 0;
    if (behind > RELIABLE_RING - 8) return -1;
    const n = Math.min(behind, MAX_SNAPSHOT_EVENTS);
    for (let k = 0; k < n; k++) {
      const id = (acked + 1 + k) & 0xffff;
      const i = id & (RELIABLE_RING - 1);
      const e = snap.events[k];
      e.id = id;
      e.type = this.types[i]!;
      e.len = this.lens[i]!;
      for (let j = 0; j < e.len; j++) e.data[j] = this.data[i * MAX_EVENT_PAYLOAD + j]!;
    }
    return n;
  }
}
