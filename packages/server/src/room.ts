import {
  INK_COLORS,
  eventIdDiff,
  MAX_PLAYERS,
  MAX_EVENT_PAYLOAD,
  MAX_SNAPSHOT_EVENTS,
  ReliableType,
  SimEvent,
  writeSlotPosPayload,
} from '@stickyclaude/shared';
import type { ArenaData, RosterEntry, Snapshot } from '@stickyclaude/shared';
import { createSnapshot, INPUT_RING } from '@stickyclaude/shared';
import { addPlayer, createWorld, hashWorld, removePlayer, step } from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';
import type { ClientState } from './client.ts';
import type { Metrics } from './metrics.ts';
import type { RoomRecorder } from './recorder.ts';

const RELIABLE_RING = 128;
/** Au-delà de ce nombre de ticks sans entrée, on arrête de répéter la dernière entrée. */
const MISS_NEUTRAL_AFTER = 20;

/**
 * Journal d'événements fiables d'une salle : chaque événement reçoit un identifiant (u16) et est
 * répété dans les snapshots d'un client jusqu'à ce qu'il l'acquitte.
 */
export class ReliableLog {
  lastId = 0;
  private readonly ids = new Uint16Array(RELIABLE_RING);
  private readonly types = new Uint8Array(RELIABLE_RING);
  private readonly lens = new Uint8Array(RELIABLE_RING);
  private readonly data = new Uint8Array(RELIABLE_RING * MAX_EVENT_PAYLOAD);

  push(type: number, payload: Uint8Array, len: number): void {
    this.lastId = (this.lastId + 1) & 0xffff;
    const i = this.lastId & (RELIABLE_RING - 1);
    this.ids[i] = this.lastId;
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

export class Room {
  readonly world: World;
  readonly slots: (ClientState | null)[] = new Array<ClientState | null>(MAX_PLAYERS).fill(null);
  readonly reliable = new ReliableLog();
  readonly snap: Snapshot = createSnapshot();
  readonly inputs = new Uint16Array(MAX_PLAYERS);
  host = -1;
  /** Horodatage (ms) du moment où le salon est devenu vide, sinon null. */
  emptySince: number | null = null;
  private joinCounter = 0;
  private readonly payload = new Uint8Array(MAX_EVENT_PAYLOAD);

  constructor(
    readonly code: string,
    readonly arena: ArenaData,
    readonly seed: number,
    private readonly recorder: RoomRecorder | null,
    createdAt: number,
  ) {
    this.world = createWorld(arena, seed);
    this.emptySince = createdAt;
  }

  get playerCount(): number {
    let n = 0;
    for (const c of this.slots) if (c) n++;
    return n;
  }

  get recording(): RoomRecorder | null {
    return this.recorder;
  }

  freeSlot(): number {
    return this.slots.indexOf(null);
  }

  /** Plus petit indice de couleur d'encre libre dans le salon. */
  freeColor(): number {
    const used = new Set<number>();
    for (const c of this.slots) if (c) used.add(c.color);
    for (let i = 0; i < INK_COLORS.length; i++) if (!used.has(i)) return i;
    return 0;
  }

  roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const c = this.slots[s];
      if (c) out.push({ slot: s, name: c.name, color: c.color });
    }
    return out;
  }

  addClient(client: ClientState, slot: number): void {
    client.room = this;
    client.slot = slot;
    client.joinSeq = ++this.joinCounter;
    client.color = this.freeColor();
    client.resetInputs();
    client.ackedEvent = this.reliable.lastId;
    this.slots[slot] = client;
    this.emptySince = null;
    if (this.host < 0) this.host = slot;
    this.recorder?.join(this.world.tick, slot);
    addPlayer(this.world, slot);
    const p = this.world.players[slot];
    this.pushSlotPos(ReliableType.SPAWN, slot, p.x, p.y);
  }

  removeClient(client: ClientState, now: number): void {
    const slot = client.slot;
    if (slot < 0 || this.slots[slot] !== client) return;
    this.slots[slot] = null;
    this.recorder?.leave(this.world.tick, slot);
    removePlayer(this.world, slot);
    client.room = null;
    client.slot = -1;
    if (this.host === slot) {
      // L'hôte part : le plus ancien joueur restant devient hôte.
      let best = -1;
      let bestSeq = Infinity;
      for (let s = 0; s < MAX_PLAYERS; s++) {
        const c = this.slots[s];
        if (c && c.joinSeq < bestSeq) {
          best = s;
          bestSeq = c.joinSeq;
        }
      }
      this.host = best;
    }
    if (this.playerCount === 0) this.emptySince = now;
  }

  /** Enregistre un événement fiable « emplacement + position ». */
  pushSlotPos(type: number, slot: number, x: number, y: number): void {
    const n = writeSlotPosPayload(this.payload, slot, x, y);
    this.reliable.push(type, this.payload, n);
  }

  /** Avance la simulation d'un pas avec les entrées étiquetées pour ce tick. */
  step(metrics: Metrics): void {
    const w = this.world;
    const label = w.tick + 1;
    const idx = label & (INPUT_RING - 1);
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const c = this.slots[s];
      if (!c) {
        this.inputs[s] = 0;
        continue;
      }
      let mask: number;
      if (c.ringTick[idx] === label) {
        mask = c.ringMask[idx]!;
        c.ringTick[idx] = -1;
        c.missStreak = 0;
      } else {
        c.missStreak++;
        metrics.inputsMissed++;
        mask = c.missStreak > MISS_NEUTRAL_AFTER ? 0 : c.lastMask;
      }
      c.lastMask = mask;
      this.inputs[s] = mask;
      this.recorder?.input(label, s, mask);
    }
    const t0 = performance.now();
    step(w, this.inputs);
    metrics.roomStepMs.add(performance.now() - t0);

    const ev = w.events;
    for (let i = 0; i < ev.count; i++) {
      const t = ev.type[i];
      if (t === SimEvent.SPAWN)
        this.pushSlotPos(ReliableType.SPAWN, ev.slot[i], ev.a[i], ev.b[i]);
      else if (t === SimEvent.FELL)
        this.pushSlotPos(ReliableType.FELL, ev.slot[i], ev.a[i], ev.b[i]);
    }
  }

  stateHash(): number {
    return hashWorld(this.world);
  }
}
