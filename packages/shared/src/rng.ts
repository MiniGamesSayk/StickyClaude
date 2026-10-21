/**
 * RNG à graine (xoshiro128**). Seul générateur autorisé dans la simulation :
 * même graine + même suite d'appels = même suite de valeurs, sur tous les moteurs JS.
 */

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export class Rng {
  /** État (4 × u32), exposé pour le hash d'état et la sérialisation. */
  readonly s = new Uint32Array(4);

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // splitmix32 pour étaler la graine sur 128 bits
    let z = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z;
      t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
      t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
      t ^= t >>> 16;
      this.s[i] = t >>> 0;
    }
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] = s[2] ^ s[0];
    s[3] = s[3] ^ s[1];
    s[1] = s[1] ^ s[2];
    s[0] = s[0] ^ s[3];
    s[2] = s[2] ^ t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Flottant dans [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Entier dans [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
}
