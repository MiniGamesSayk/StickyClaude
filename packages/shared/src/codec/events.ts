import { POS_SCALE } from '../constants.ts';
import { EVENT_MAX_ARGS, EVENT_SPECS } from '../types.ts';
import { MAX_EVENT_PAYLOAD } from './snapshot.ts';
import { clamp, DecodeError } from './io.ts';

/**
 * Charge utile d'un événement réseau : `u8 slot`, puis un entier de 16 bits (little-endian) par
 * argument. Le format de chaque événement est dans `EVENT_SPECS` (`p` position au 1/8 d'unité,
 * `i` entier signé, `u` entier non signé). La longueur est donc `1 + 2 × arguments` (13 octets au
 * plus).
 */
export interface DecodedEvent {
  type: number;
  slot: number;
  /** Arguments dans l'ordre de `EVENT_SPECS` (les positions sont déjà en unités de monde). */
  a: Float64Array;
  /** Nombre d'arguments valides. */
  n: number;
}

export function createDecodedEvent(): DecodedEvent {
  return { type: 0, slot: 0, a: new Float64Array(EVENT_MAX_ARGS), n: 0 };
}

export function isNetworkEvent(type: number): boolean {
  return Object.prototype.hasOwnProperty.call(EVENT_SPECS, type);
}

export function eventPayloadLength(type: number): number {
  const spec = EVENT_SPECS[type];
  return spec === undefined ? -1 : 1 + 2 * spec.length;
}

/** Écrit la charge utile ; retourne sa longueur (ou -1 si le type n'est pas un événement réseau). */
export function encodeEventPayload(
  dst: Uint8Array,
  type: number,
  slot: number,
  args: ArrayLike<number>,
): number {
  const spec = EVENT_SPECS[type];
  if (spec === undefined) return -1;
  dst[0] = slot & 0xff;
  let o = 1;
  for (let i = 0; i < spec.length; i++) {
    const v = args[i] ?? 0;
    let n: number;
    switch (spec.charAt(i)) {
      case 'p':
        n = clamp(Math.round(v * POS_SCALE), -32768, 32767) & 0xffff;
        break;
      case 'u':
        n = clamp(Math.round(v), 0, 65535);
        break;
      default:
        n = clamp(Math.round(v), -32768, 32767) & 0xffff;
    }
    dst[o++] = n & 0xff;
    dst[o++] = n >> 8;
  }
  return o;
}

/** Décode une charge utile. Lève `DecodeError` si la longueur ne correspond pas au type. */
export function decodeEventPayload(
  type: number,
  data: Uint8Array,
  len: number,
  out: DecodedEvent,
): void {
  const spec = EVENT_SPECS[type];
  if (spec === undefined) throw new DecodeError('unknown event type');
  if (len !== 1 + 2 * spec.length || len > MAX_EVENT_PAYLOAD) {
    throw new DecodeError('bad event length');
  }
  out.type = type;
  out.slot = data[0]!;
  out.n = spec.length;
  let o = 1;
  for (let i = 0; i < spec.length; i++) {
    const lo = data[o++];
    const hi = data[o++];
    const raw = lo | (hi << 8);
    switch (spec.charAt(i)) {
      case 'p':
        out.a[i] = ((raw << 16) >> 16) / POS_SCALE;
        break;
      case 'u':
        out.a[i] = raw;
        break;
      default:
        out.a[i] = (raw << 16) >> 16;
    }
  }
}
