import {
  SR,
  bandpass,
  bell,
  decay,
  fade,
  finish,
  highpass,
  lowpass,
  makeRng,
  midiToHz,
  mixInto,
  noise,
  pluck,
  saw,
  secs,
  shape,
  sine,
  square,
  whistle,
} from './dsp.ts';

/**
 * Les effets sonores (analyse §1.10). Chaque fonction rend un son mono de 48 kHz, entièrement
 * synthétisé : bruit filtré, sinus, cordes pincées, sifflements. Noms = clés du moteur audio.
 */

type Recipe = () => Float32Array;

/** Bruit filtré en bande avec une enveloppe exponentielle. */
function burst(
  seed: number,
  dur: number,
  fc: number,
  tau: number,
  q = 1.1,
  attack = 0.002,
): Float32Array {
  const x = bandpass(noise(secs(dur), makeRng(seed)), fc, q);
  return shape(x, (t) => decay(t, attack, tau));
}

/** Bruit dont la bande balaie de `f0` à `f1` (souffle, whoosh). */
function sweepNoise(seed: number, dur: number, f0: number, f1: number, peak = 0.5): Float32Array {
  const n = secs(dur);
  const src = noise(n, makeRng(seed));
  const out = new Float32Array(n);
  const chunk = 256;
  for (let s = 0; s < n; s += chunk) {
    const e = Math.min(n, s + chunk);
    const seg = bandpass(src.slice(s, e), f0 + ((f1 - f0) * s) / n, 1.4);
    out.set(seg, s);
  }
  return shape(out, (t) => {
    const k = t / dur;
    return Math.sin(Math.PI * Math.min(1, k) ** peak) * 1.1;
  });
}

function thump(f0: number, f1: number, dur: number, tau: number, amp = 1): Float32Array {
  const n = secs(dur);
  const out = sine(n, (t) => f1 + (f0 - f1) * Math.exp(-t / (dur * 0.35)), amp);
  return shape(out, (t) => decay(t, 0.001, tau));
}

function mix(...parts: [Float32Array, number][]): Float32Array {
  const len = Math.max(...parts.map(([p]) => p.length));
  const out = new Float32Array(len);
  for (const [p, g] of parts) mixInto(out, p, 0, g);
  return out;
}

/** Crépitement : impulsions éparses (papier déchiré, bois qui craque). */
function crackle(seed: number, dur: number, density: number, fc: number): Float32Array {
  const rng = makeRng(seed);
  const n = secs(dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (rng() < density) out[i] = (rng() * 2 - 1) * (0.5 + rng() * 0.5);
  }
  return shape(bandpass(out, fc, 0.8), (t) => decay(t, 0.001, dur * 0.45));
}

const R: Record<string, Recipe> = {
  // --- Déplacements ---
  step: () =>
    shape(
      highpass(noise(secs(0.07), makeRng(11)), 1400),
      (t) => decay(t, 0.002, 0.018) * (0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 95)),
    ),
  jump: () => {
    const x = sine(secs(0.16), (t) => 280 + 2600 * t, 0.9);
    return shape(x, (t) => decay(t, 0.004, 0.07));
  },
  double_jump: () => {
    const x = sine(secs(0.2), (t) => 420 + 3300 * t + (t > 0.08 ? 300 : 0), 0.85);
    return shape(x, (t) => decay(t, 0.003, 0.08));
  },
  wall_jump: () => {
    const x = square(secs(0.14), (t) => 950 + 3000 * t + Math.sin(t * 90) * 40, 0.35, 0.3);
    return mix([shape(x, (t) => decay(t, 0.003, 0.05)), 1], [burst(12, 0.05, 2600, 0.012), 0.6]);
  },
  land: () =>
    mix([thump(120, 55, 0.12, 0.04, 0.9), 1], [lowpass(burst(13, 0.08, 900, 0.03), 1400), 0.5]),
  drop: () => sweepNoise(14, 0.12, 1800, 700, 0.8),
  swing: () => sweepNoise(15, 0.13, 700, 2600, 0.9),
  // --- Combat ---
  hit: () => mix([thump(190, 80, 0.14, 0.05, 0.9), 1], [burst(16, 0.12, 1800, 0.035), 0.9]),
  hit_heavy: () =>
    mix(
      [thump(130, 42, 0.3, 0.12, 1), 1],
      [burst(17, 0.22, 1500, 0.09, 0.8), 0.9],
      [crackle(18, 0.18, 0.06, 2600), 0.7],
    ),
  block: () =>
    mix(
      [
        shape(
          sine(secs(0.1), () => 720),
          (t) => decay(t, 0.001, 0.025),
        ),
        0.8,
      ],
      [burst(19, 0.07, 3200, 0.015, 1.6), 0.7],
    ),
  parry: () => {
    const b = bell(1318, 0.8);
    const click = burst(20, 0.04, 4200, 0.008, 2);
    return mix([b, 0.9], [click, 0.6]);
  },
  ko: () => {
    // rature : gribouillis de bruit qui part dans tous les sens, puis un « womp » descendant
    const n = secs(0.5);
    const scribble = new Float32Array(n);
    const rng = makeRng(21);
    let p = 0;
    for (let i = 0; i < secs(0.36); i++) {
      if (i % 700 === 0) p = 2200 + rng() * 2600;
      scribble[i] = Math.sin((i / SR) * 2 * Math.PI * p) * 0.25 + (rng() * 2 - 1) * 0.35;
    }
    const sc = shape(
      highpass(scribble, 1500),
      (t) => (t < 0.36 ? 1 - t / 0.5 : 0) * (0.6 + 0.4 * Math.sin(t * 150)),
    );
    const womp = shape(
      sine(n, (t) => 520 * Math.exp(-t * 2.4) + 90),
      (t) => decay(t, 0.01, 0.2),
    );
    return mix([sc, 0.8], [womp, 0.8]);
  },
  // --- Armes ---
  shot_pistol: () =>
    mix([burst(22, 0.14, 1500, 0.03, 0.9), 0.9], [thump(380, 110, 0.1, 0.03, 0.7), 0.7]),
  shot_shotgun: () =>
    mix(
      [lowpass(burst(23, 0.34, 800, 0.15, 0.7), 1800), 1],
      [thump(150, 50, 0.3, 0.1, 0.9), 0.9],
      [crackle(24, 0.2, 0.05, 1800), 0.4],
    ),
  shot_blow: () =>
    mix([burst(25, 0.12, 1300, 0.04, 0.8), 0.8], [thump(520, 260, 0.06, 0.02, 0.4), 0.5]),
  shot_plane: () =>
    mix(
      [sweepNoise(26, 0.26, 400, 1800, 0.7), 0.7],
      [
        shape(
          sine(secs(0.2), (t) => 600 + 1500 * t),
          (t) => decay(t, 0.01, 0.06),
        ),
        0.25,
      ],
    ),
  shot_bazooka: () =>
    mix(
      [thump(110, 38, 0.45, 0.16, 1), 1],
      [sweepNoise(27, 0.45, 600, 200, 0.5), 0.8],
      [lowpass(burst(28, 0.2, 1200, 0.07), 1500), 0.5],
    ),
  explosion: () => {
    const body = shape(lowpass(noise(secs(0.75), makeRng(29)), 650), (t) => decay(t, 0.012, 0.22));
    const low = thump(90, 30, 0.7, 0.28, 1);
    const splash = new Float32Array(secs(0.75));
    const rng = makeRng(30);
    for (let k = 0; k < 9; k++) {
      const f = 380 + rng() * 520;
      const blip = shape(
        sine(secs(0.07), (t) => f * (1 + t * 4)),
        (t) => decay(t, 0.003, 0.02),
      );
      mixInto(splash, blip, secs(0.05 + rng() * 0.45), 0.35);
    }
    return mix([body, 1], [low, 0.9], [splash, 0.6]);
  },
  terrain: () =>
    mix([crackle(31, 0.32, 0.12, 2400), 1], [lowpass(burst(32, 0.2, 700, 0.07), 900), 0.5]),
  eraser: () => {
    const x = bandpass(noise(secs(0.26), makeRng(33)), 3000, 0.9);
    return shape(x, (t) => decay(t, 0.01, 0.12) * (0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 17)));
  },
  grapple: () =>
    mix(
      [sweepNoise(34, 0.3, 900, 3600, 0.9), 0.6],
      [shape(bell(2100, 0.3), (t) => decay(t, 0.002, 0.1)), 0.3],
    ),
  throw: () => sweepNoise(35, 0.14, 800, 1900, 0.85),
  stamp: () =>
    mix([thump(95, 40, 0.35, 0.12, 1), 1], [lowpass(burst(36, 0.25, 900, 0.09), 1100), 0.7]),
  crate: () =>
    mix(
      [crackle(37, 0.28, 0.1, 1700), 1],
      [thump(160, 70, 0.18, 0.06, 0.8), 0.8],
      [burst(38, 0.1, 900, 0.03), 0.5],
    ),
  pickup: () => {
    const a = shape(
      sine(secs(0.07), () => 660),
      (t) => decay(t, 0.002, 0.04),
    );
    const b = shape(
      sine(secs(0.09), () => 990),
      (t) => decay(t, 0.002, 0.05),
    );
    const out = new Float32Array(secs(0.16));
    mixInto(out, a, 0, 0.8);
    mixInto(out, b, secs(0.06), 0.8);
    return out;
  },
  weapon_spawn: () => {
    // un crayon qui gratte : bruit modulé, fréquence qui flotte
    const n = secs(0.55);
    const rng = makeRng(39);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = rng() * 2 - 1;
    const f = highpass(bandpass(x, 2600, 0.7), 900);
    return shape(
      f,
      (t) =>
        Math.min(1, t / 0.03) *
        Math.min(1, (0.55 - t) / 0.1) *
        (0.5 + 0.5 * Math.abs(Math.sin(t * 2 * Math.PI * 11))),
    );
  },
  emote: () =>
    shape(
      sine(secs(0.12), (t) => 520 + 3200 * t),
      (t) => decay(t, 0.002, 0.04),
    ),
  spawn: () =>
    mix(
      [lowpass(burst(40, 0.2, 1000, 0.07, 0.6), 1400), 0.7],
      [
        shape(
          sine(secs(0.18), (t) => 300 + 600 * t),
          (t) => decay(t, 0.004, 0.06),
        ),
        0.4,
      ],
    ),
  goal: () => {
    const out = new Float32Array(secs(0.9));
    const rng = makeRng(41);
    [55, 59, 62, 67].forEach((m, i) =>
      mixInto(out, pluck(midiToHz(m), 0.8, rng, 0.45), secs(i * 0.045), 0.5),
    );
    mixInto(out, whistle(1318, 1568, 0.4, rng), secs(0.12), 0.4);
    return out;
  },
  // --- Page et décompte ---
  page_turn: () => {
    const n = secs(0.5);
    const flutter = bandpass(noise(n, makeRng(42)), 1800, 0.5);
    const a = shape(flutter, (t) => Math.min(1, t / 0.15) * Math.exp(-t * 2.3) * 0.7);
    const slap = shape(burst(43, 0.1, 1100, 0.03, 0.6), (t) => t);
    const out = new Float32Array(n);
    mixInto(out, a, 0, 1);
    mixInto(out, slap, secs(0.3), 0.7);
    return out;
  },
  count_tick: () =>
    mix(
      [
        shape(
          sine(secs(0.12), () => 1000),
          (t) => decay(t, 0.001, 0.03),
        ),
        0.7,
      ],
      [burst(44, 0.04, 2800, 0.01, 1.8), 0.5],
    ),
  count_go: () => {
    const rng = makeRng(45);
    const out = new Float32Array(secs(0.4));
    mixInto(out, whistle(880, 880, 0.12, rng), 0, 0.8);
    mixInto(out, whistle(1320, 1320, 0.26, rng), secs(0.13), 0.8);
    return out;
  },
  victory: () => {
    const rng = makeRng(46);
    const out = new Float32Array(secs(1.5));
    [60, 64, 67, 72].forEach((m, i) =>
      mixInto(out, pluck(midiToHz(m), 1.2, rng, 0.5), secs(i * 0.12), 0.55),
    );
    mixInto(out, whistle(1046, 1568, 0.5, rng), secs(0.5), 0.5);
    return out;
  },
  sudden: () => {
    const n = secs(0.95);
    const horn = saw(n, () => 110, 0.5);
    const horn2 = saw(n, () => 165, 0.3);
    const x = lowpass(mix([horn, 1], [horn2, 0.7]), 900);
    return shape(x, (t) => Math.min(1, t / 0.2) * Math.min(1, (0.95 - t) / 0.25));
  },
  // --- Interface ---
  ui_hover: () =>
    shape(
      sine(secs(0.05), () => 1800),
      (t) => decay(t, 0.001, 0.012),
    ),
  ui_click: () =>
    mix(
      [
        shape(
          sine(secs(0.09), (t) => 900 - 3200 * t),
          (t) => decay(t, 0.001, 0.02),
        ),
        0.8,
      ],
      [burst(47, 0.04, 3000, 0.008, 1.5), 0.6],
    ),
};

export const SFX_NAMES = Object.keys(R);

/** Rend un effet : mono, 48 kHz, normalisé, sans claquement aux bords. */
export function renderSfx(name: string): Float32Array {
  const make = R[name];
  if (!make) throw new Error(`effet inconnu : ${name}`);
  return fade(finish(make(), 0.8, 1.1), 1, 6);
}
