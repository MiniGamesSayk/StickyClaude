/**
 * Synthèse sonore minimale pour `gen-audio` : oscillateurs, enveloppes, bruit, filtres, corde
 * pincée (Karplus-Strong), sifflement. Tout est déterministe (bruit à graine) : régénérer les
 * fichiers donne les mêmes octets. Aucun échantillon n'est repris : tout est calculé ici.
 */

export const SR = 48000;

export function secs(n: number): number {
  return Math.max(1, Math.round(n * SR));
}

/** Générateur à graine (mulberry32) : valeurs dans [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Enveloppe exponentielle décroissante après une attaque linéaire courte. */
export function decay(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / tau);
}

/** Filtre passe-bas à un pôle : `fc` en Hz. Modifie et retourne `x`. */
export function lowpass(x: Float32Array, fc: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] = y;
  }
  return x;
}

export function highpass(x: Float32Array, fc: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] -= y;
  }
  return x;
}

/** Passe-bande biquad (RBJ) centré sur `fc`, facteur de qualité `q`. */
export function bandpass(x: Float32Array, fc: number, q = 1.2): Float32Array {
  const w = (2 * Math.PI * fc) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w);
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

/** Bruit blanc de `n` échantillons. */
export function noise(n: number, rng: () => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Applique une enveloppe `f(t)` (t en secondes). */
export function shape(x: Float32Array, f: (t: number) => number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= f(i / SR);
  return x;
}

/** Sinus de fréquence variable : `freq(t)` en Hz. */
export function sine(n: number, freq: (t: number) => number, amp = 1): Float32Array {
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * freq(i / SR)) / SR;
    out[i] = Math.sin(ph) * amp;
  }
  return out;
}

export function square(n: number, freq: (t: number) => number, amp = 1, duty = 0.5): Float32Array {
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += freq(i / SR) / SR;
    ph -= Math.floor(ph);
    out[i] = (ph < duty ? 1 : -1) * amp;
  }
  return out;
}

export function saw(n: number, freq: (t: number) => number, amp = 1): Float32Array {
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += freq(i / SR) / SR;
    ph -= Math.floor(ph);
    out[i] = (ph * 2 - 1) * amp;
  }
  return out;
}

/** Corde pincée (ukulélé) : Karplus-Strong avec amortissement et brillance réglables. */
export function pluck(
  freq: number,
  dur: number,
  rng: () => number,
  bright = 0.5,
  damp = 0.9965,
): Float32Array {
  const n = secs(dur);
  const out = new Float32Array(n);
  const len = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(len);
  // bruit initial adouci : moins de brillance = plus de rondeur
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const v = rng() * 2 - 1;
    prev += (v - prev) * bright;
    line[i] = prev;
  }
  let idx = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    out[i] = cur;
    const next = (cur + last) * 0.5 * damp;
    line[idx] = next;
    last = cur;
    idx = (idx + 1) % len;
  }
  // attaque : petit adoucissement des deux premières millisecondes
  const a = secs(0.002);
  for (let i = 0; i < a && i < n; i++) out[i] *= i / a;
  return out;
}

/** Sifflement : sinus avec vibrato qui s'installe, souffle, attaque et relâchement doux. */
export function whistle(
  f0: number,
  f1: number,
  dur: number,
  rng: () => number,
  vib = 0.012,
): Float32Array {
  const n = secs(dur);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = dur > 0 ? t / dur : 0;
    const base = f0 + (f1 - f0) * k;
    const v = 1 + vib * Math.sin(2 * Math.PI * 5.6 * t) * Math.min(1, t / 0.18);
    ph += (2 * Math.PI * base * v) / SR;
    const e = Math.min(1, t / 0.025) * Math.min(1, (dur - t) / 0.06);
    out[i] =
      (Math.sin(ph) * 0.9 + Math.sin(ph * 2) * 0.06 + (rng() * 2 - 1) * 0.025) * Math.max(0, e);
  }
  return out;
}

/** Cloche : partiels inharmoniques à décroissances différentes. */
export function bell(freq: number, dur: number): Float32Array {
  const n = secs(dur);
  const out = new Float32Array(n);
  const partials: [number, number, number][] = [
    [1, 1, 0.55],
    [2.76, 0.6, 0.3],
    [5.4, 0.35, 0.17],
    [8.93, 0.18, 0.09],
  ];
  for (const [ratio, amp, tau] of partials) {
    const w = (2 * Math.PI * freq * ratio) / SR;
    for (let i = 0; i < n; i++) out[i] += Math.sin(w * i) * amp * Math.exp(-(i / SR) / tau);
  }
  return out;
}

/** Ajoute `src` dans `dst` à `at` (échantillons), avec un gain. Les débordements sont ignorés. */
export function mixInto(dst: Float32Array, src: Float32Array, at: number, gain = 1): void {
  for (let i = 0; i < src.length; i++) {
    const j = at + i;
    if (j < 0 || j >= dst.length) continue;
    dst[j] += src[i] * gain;
  }
}

/** Comme `mixInto`, mais le débordement revient au début : boucle sans couture. */
export function mixLoop(dst: Float32Array, src: Float32Array, at: number, gain = 1): void {
  const n = dst.length;
  for (let i = 0; i < src.length; i++) {
    const j = (((at + i) % n) + n) % n;
    dst[j] += src[i] * gain;
  }
}

/** Écrête doucement (tanh) puis normalise le pic à `peak`. */
export function finish(x: Float32Array, peak = 0.85, drive = 1.2): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive);
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  const k = max > 0 ? peak / max : 1;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/** Fondu d'entrée et de sortie de `ms` millisecondes (évite les claquements aux bords). */
export function fade(x: Float32Array, inMs = 1, outMs = 8): Float32Array {
  const a = Math.round((inMs * SR) / 1000);
  const b = Math.round((outMs * SR) / 1000);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}
