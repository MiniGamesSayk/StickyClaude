/**
 * Bruit déterministe pour le trait « à main levée » : tout est une fonction pure de (x, y, graine),
 * donc un morceau de terrain redessiné donne exactement le même tracé que son voisin.
 */

/** Mélange de bits (type murmur) : entier 32 bits non signé pour (x, y, seed). */
export function hash2(x: number, y: number, seed: number): number {
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) ^
      Math.imul(y | 0, 0x165667b1) ^
      Math.imul(seed | 0, 0x9e3779b1)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Valeur dans [0, 1). */
export function rand2(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) / 4294967296;
}

/** Valeur dans [-1, 1). */
export function srand2(x: number, y: number, seed: number): number {
  return rand2(x, y, seed) * 2 - 1;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bruit de valeur lisse en 2D, dans [-1, 1]. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = srand2(x0, y0, seed);
  const b = srand2(x0 + 1, y0, seed);
  const c = srand2(x0, y0 + 1, seed);
  const d = srand2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Graine d'une chaîne (identifiant d'arène, texte de décor). */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Table de décalages pour le line boiling : `VARIANTS` jeux de `size` couples (dx, dy) dans
 * [-1, 1], précalculés une fois. `boil(i, variant)` ne coûte qu'une lecture.
 */
export const BOIL_VARIANTS = 3;
export const BOIL_SIZE = 256;
export const BOIL_HZ = 12;

const boilTable = new Float32Array(BOIL_VARIANTS * BOIL_SIZE * 2);
for (let v = 0; v < BOIL_VARIANTS; v++) {
  for (let i = 0; i < BOIL_SIZE; i++) {
    boilTable[(v * BOIL_SIZE + i) * 2] = srand2(i, v, 0xb011);
    boilTable[(v * BOIL_SIZE + i) * 2 + 1] = srand2(i, v + 17, 0xb012);
  }
}

/** Décalage x du sommet `i` pour la variante `variant` (dans [-1, 1]). */
export function boilX(i: number, variant: number): number {
  return boilTable[(variant * BOIL_SIZE + (i & (BOIL_SIZE - 1))) * 2];
}

/** Décalage y du sommet `i` pour la variante `variant` (dans [-1, 1]). */
export function boilY(i: number, variant: number): number {
  return boilTable[(variant * BOIL_SIZE + (i & (BOIL_SIZE - 1))) * 2 + 1];
}

/**
 * Variante courante du line boiling à l'instant `ms` : change `BOIL_HZ` fois par seconde et cycle
 * sur 3 variantes (A B C), en deux temps sur trois images de dessin animé « à la main ».
 */
export function boilVariant(ms: number): number {
  return Math.floor((ms * BOIL_HZ) / 1000) % BOIL_VARIANTS;
}
