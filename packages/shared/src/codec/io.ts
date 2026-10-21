/** Lecture et écriture binaires (little-endian) avec vérification des bornes en lecture. */

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export class Reader {
  readonly view: DataView;
  pos = 0;
  readonly end: number;

  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.end = buf.byteLength;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.end) throw new DecodeError('truncated');
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    if (!Number.isFinite(v)) throw new DecodeError('non-finite float');
    return v;
  }
}

export class Writer {
  readonly view: DataView;
  pos = 0;

  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  u8(v: number): void {
    this.view.setUint8(this.pos++, v);
  }
  i8(v: number): void {
    this.view.setInt8(this.pos++, v);
  }
  u16(v: number): void {
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }
  i16(v: number): void {
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  f32(v: number): void {
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
