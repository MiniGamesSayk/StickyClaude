import OpusScript from 'opusscript';
import { SR } from './dsp.ts';

/**
 * Encodage Opus dans un conteneur Ogg (RFC 7845), sans dépendance native : `opusscript` encode
 * les trames de 20 ms, ce module écrit les pages Ogg (en-tête `OpusHead`, `OpusTags`, CRC 32).
 * `parseOgg` relit un fichier (tests et vérification).
 */

const FRAME = 960; // 20 ms à 48 kHz
/** Retard de l'encodeur à ignorer au décodage (échantillons à 48 kHz). */
const PRE_SKIP = 312;

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      crcTable[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (let i = 0; i < data.length; i++)
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** Une page Ogg contenant `packets` (chacun ≤ 255 × 255 octets), granule et drapeaux. */
function page(
  serial: number,
  seq: number,
  flags: number,
  granule: bigint,
  packets: Uint8Array[],
): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new Error('page Ogg trop grande');
  const body = packets.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + body);
  const dv = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53, 0, flags], 0); // « OggS », version 0
  dv.setBigUint64(6, BigInt.asUintN(64, granule), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  dv.setUint32(22, 0, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let pos = 27 + lacing.length;
  for (const p of packets) {
    out.set(p, pos);
    pos += p.length;
  }
  dv.setUint32(22, crc32(out), true);
  return out;
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export interface EncodeOptions {
  /** Débit visé (bits/s) : 24 000 pour un effet, 40 000 pour une musique. */
  bitrate?: number;
}

/** Encode du PCM mono flottant à 48 kHz en Opus dans Ogg. */
export function encodeOggOpus(pcm: Float32Array, opts: EncodeOptions = {}): Buffer {
  const enc = new OpusScript(SR, 1, OpusScript.Application.AUDIO);
  enc.setBitrate(opts.bitrate ?? 32000);
  const frames = Math.ceil((pcm.length + PRE_SKIP) / FRAME);
  const packets: Uint8Array[] = [];
  const buf = Buffer.alloc(FRAME * 2);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) {
      const j = f * FRAME + i - PRE_SKIP;
      const v = j >= 0 && j < pcm.length ? pcm[j] : 0;
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
    }
    packets.push(new Uint8Array(enc.encode(buf, FRAME)));
  }
  enc.delete();

  const serial = 0x57c1a0de;
  const head = new Uint8Array(19);
  head.set(ascii('OpusHead'), 0);
  head[8] = 1; // version
  head[9] = 1; // canaux
  new DataView(head.buffer).setUint16(10, PRE_SKIP, true);
  new DataView(head.buffer).setUint32(12, SR, true);
  // gain de sortie 0, famille de correspondance 0 (octets 16 à 18)
  const vendor = ascii('StickyClaude gen-audio');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(ascii('OpusTags'), 0);
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  // 0 commentaire (quatre derniers octets à zéro)

  const out: Uint8Array[] = [page(serial, 0, 0x02, 0n, [head]), page(serial, 1, 0, 0n, [tags])];
  // une page par groupe de 25 paquets (≈ 0,5 s)
  let seq = 2;
  const per = 25;
  for (let i = 0; i < packets.length; i += per) {
    const group = packets.slice(i, i + per);
    const last = i + per >= packets.length;
    // position granulaire : échantillons (avec le retard) rendus à la fin de la page ; la dernière
    // page est tronquée à la longueur réelle du son
    const end = last ? PRE_SKIP + pcm.length : (i + group.length) * FRAME;
    out.push(page(serial, seq++, last ? 0x04 : 0, BigInt(end), group));
  }
  return Buffer.concat(out);
}

export interface ParsedOgg {
  channels: number;
  preSkip: number;
  sampleRate: number;
  packets: Uint8Array[];
  /** Position granulaire de la dernière page (durée = (granule − preSkip) / 48 000). */
  granule: bigint;
  pages: number;
  crcOk: boolean;
}

/** Relit un fichier Ogg Opus produit par `encodeOggOpus`. */
export function parseOgg(file: Uint8Array): ParsedOgg {
  const packets: Uint8Array[] = [];
  let pos = 0;
  let granule = 0n;
  let pages = 0;
  let crcOk = true;
  let pending: number[] = [];
  let channels = 0;
  let preSkip = 0;
  let sampleRate = 0;
  while (pos + 27 <= file.length) {
    const dv = new DataView(file.buffer, file.byteOffset + pos);
    if (
      file[pos] !== 0x4f ||
      file[pos + 1] !== 0x67 ||
      file[pos + 2] !== 0x67 ||
      file[pos + 3] !== 0x53
    ) {
      throw new Error('page Ogg invalide');
    }
    const segs = file[pos + 26];
    const lacing = file.subarray(pos + 27, pos + 27 + segs);
    const size = lacing.reduce((a, b) => a + b, 0);
    const total = 27 + segs + size;
    const copy = Uint8Array.from(file.subarray(pos, pos + total));
    const stored = new DataView(copy.buffer).getUint32(22, true);
    new DataView(copy.buffer).setUint32(22, 0, true);
    if (crc32(copy) !== stored) crcOk = false;
    granule = dv.getBigUint64(6, true);
    let at = pos + 27 + segs;
    let cur: number[] = pending;
    for (const l of lacing) {
      for (let i = 0; i < l; i++) cur.push(file[at + i]);
      at += l;
      if (l < 255) {
        packets.push(Uint8Array.from(cur));
        cur = [];
      }
    }
    pending = cur;
    pages++;
    pos += total;
  }
  const head = packets[0];
  if (head && String.fromCharCode(...head.subarray(0, 8)) === 'OpusHead') {
    channels = head[9];
    preSkip = head[10] | (head[11] << 8);
    sampleRate = new DataView(head.buffer, head.byteOffset).getUint32(12, true);
  }
  return { channels, preSkip, sampleRate, packets: packets.slice(2), granule, pages, crcOk };
}
