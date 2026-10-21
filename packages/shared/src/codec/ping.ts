import { BinType } from './messages.ts';
import { DecodeError, Reader, Writer } from './io.ts';

/** PING (client → serveur), 5 octets : type, u32 horloge client (ms, modulo 2^32). */
export function encodePing(out: Uint8Array, clientTimeMs: number): number {
  const w = new Writer(out);
  w.u8(BinType.PING);
  w.u32(clientTimeMs >>> 0);
  return w.pos;
}

export function decodePing(buf: Uint8Array): number {
  const r = new Reader(buf);
  if (r.u8() !== BinType.PING) throw new DecodeError('not a ping');
  const t = r.u32();
  if (r.remaining !== 0) throw new DecodeError('bad ping length');
  return t;
}

export interface Pong {
  clientTime: number;
  tick: number;
  /** Fraction de tick écoulée (0..255 → 0..1). */
  frac: number;
}

/** PONG (serveur → client), 10 octets : type, u32 horloge client, u32 tick serveur, u8 fraction. */
export function encodePong(
  out: Uint8Array,
  clientTime: number,
  tick: number,
  frac: number,
): number {
  const w = new Writer(out);
  w.u8(BinType.PONG);
  w.u32(clientTime >>> 0);
  w.u32(tick >>> 0);
  w.u8(Math.min(255, Math.max(0, Math.floor(frac * 256))));
  return w.pos;
}

export function decodePong(buf: Uint8Array, out: Pong): void {
  const r = new Reader(buf);
  if (r.u8() !== BinType.PONG) throw new DecodeError('not a pong');
  out.clientTime = r.u32();
  out.tick = r.u32();
  out.frac = r.u8() / 256;
  if (r.remaining !== 0) throw new DecodeError('bad pong length');
}
