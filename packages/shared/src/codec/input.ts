import { INPUT_REDUNDANCY } from '../constants.ts';
import { BinType } from './messages.ts';
import { DecodeError, Reader, Writer } from './io.ts';

/**
 * Paquet d'entrées (client → serveur), 9 à 15 octets :
 *
 *   0  u8   type = INPUT
 *   1  u16  tick        étiquette (16 bits de poids faible) de l'entrée la plus récente
 *   3  u16  ack         dernier événement fiable appliqué (contigu)
 *   5  u8   rewind      durée entre l'entrée et ce que le joueur voit des autres (latence aller
 *                       + interpolation + avance), en pas de 4 ms : compensation de latence
 *   6  u8   count       nombre d'entrées, 1..4
 *   7  u16* masks       entrées, de la plus récente (tick) à la plus ancienne (tick - count + 1)
 */
export interface InputPacket {
  tick: number;
  ack: number;
  rewind: number;
  count: number;
  masks: Uint16Array;
}

export const INPUT_PACKET_MIN = 9;
export const INPUT_PACKET_MAX = 7 + 2 * INPUT_REDUNDANCY;

export function createInputPacket(): InputPacket {
  return { tick: 0, ack: 0, rewind: 0, count: 0, masks: new Uint16Array(INPUT_REDUNDANCY) };
}

export function encodeInput(
  out: Uint8Array,
  tick: number,
  ack: number,
  rewind: number,
  masks: ArrayLike<number>,
  count: number,
): number {
  const w = new Writer(out);
  w.u8(BinType.INPUT);
  w.u16(tick & 0xffff);
  w.u16(ack & 0xffff);
  w.u8(Math.min(255, Math.max(0, rewind)));
  w.u8(count);
  for (let i = 0; i < count; i++) w.u16(masks[i] & 0xffff);
  return w.pos;
}

/** Décode dans `out` (sans allocation hormis le Reader). Lève `DecodeError` si invalide. */
export function decodeInput(buf: Uint8Array, out: InputPacket): void {
  const r = new Reader(buf);
  if (r.u8() !== BinType.INPUT) throw new DecodeError('not an input packet');
  out.tick = r.u16();
  out.ack = r.u16();
  out.rewind = r.u8();
  const count = r.u8();
  if (count < 1 || count > INPUT_REDUNDANCY) throw new DecodeError('bad input count');
  if (r.remaining !== count * 2) throw new DecodeError('bad input length');
  out.count = count;
  for (let i = 0; i < count; i++) out.masks[i] = r.u16();
}
