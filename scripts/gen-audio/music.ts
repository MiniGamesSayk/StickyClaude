import {
  SR,
  bandpass,
  decay,
  finish,
  lowpass,
  makeRng,
  midiToHz,
  mixLoop,
  noise,
  pluck,
  secs,
  shape,
  sine,
  whistle,
} from './dsp.ts';

/**
 * La musique (analyse §1.10) : l'ambiance d'une salle de classe. Un ukulélé (cordes pincées de
 * Karplus-Strong), un sifflement et des percussions sur une table, séquencés ici et rendus en
 * boucles **sans couture** : les notes qui dépassent la fin reviennent au début (`mixLoop`).
 */

type Chord = number[];
const CH: Record<string, Chord> = {
  C: [55, 60, 64, 72],
  Am: [57, 60, 64, 69],
  F: [53, 57, 60, 65],
  G: [55, 59, 62, 67],
  Em: [52, 55, 59, 64],
  D: [50, 54, 57, 62],
  Dm: [50, 53, 57, 62],
  Bb: [58, 62, 65, 70],
  A: [57, 61, 64, 69],
};
const ROOT: Record<string, number> = {
  C: 36,
  Am: 33,
  F: 41,
  G: 43,
  Em: 40,
  D: 38,
  Dm: 38,
  Bb: 34,
  A: 33,
};

interface Strum {
  /** Case (croche ou double-croche) dans la mesure. */
  slot: number;
  down: boolean;
  gain: number;
}

interface Hit {
  slot: number;
  gain: number;
}

interface Note {
  /** Temps depuis le début de la boucle, en noires. */
  beat: number;
  midi: number;
  len: number;
}

interface Spec {
  name: string;
  bpm: number;
  progression: string[];
  /** Divisions par mesure : 8 (croches) ou 16 (doubles). */
  slots: number;
  strums: Strum[];
  thumps: Hit[];
  taps: Hit[];
  slaps: Hit[];
  bass: boolean;
  /** Mélodie sifflée, en notes (temps, hauteur, durée). */
  melody: Note[];
  muted: boolean;
  gliss?: { from: number; to: number; beat: number; len: number };
  seed: number;
  gain: number;
}

const bar = (b: number, beat: number, len: number, midi: number): Note => ({
  beat: b * 4 + beat,
  midi,
  len,
});

const SPECS: Spec[] = [
  {
    name: 'menu',
    bpm: 92,
    progression: ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'],
    slots: 8,
    strums: [
      { slot: 0, down: true, gain: 1 },
      { slot: 2, down: true, gain: 0.7 },
      { slot: 3, down: false, gain: 0.55 },
      { slot: 5, down: false, gain: 0.6 },
      { slot: 6, down: true, gain: 0.8 },
      { slot: 7, down: false, gain: 0.5 },
    ],
    thumps: [{ slot: 0, gain: 0.5 }],
    taps: [
      { slot: 2, gain: 0.45 },
      { slot: 6, gain: 0.45 },
    ],
    slaps: [],
    bass: false,
    muted: false,
    melody: [
      bar(4, 0, 2, 76),
      bar(4, 2, 1, 79),
      bar(4, 3, 1, 81),
      bar(5, 0, 1.5, 79),
      bar(5, 1.5, 0.5, 76),
      bar(5, 2, 2, 74),
      bar(6, 0, 2, 72),
      bar(6, 2, 1, 76),
      bar(6, 3, 1, 77),
      bar(7, 0, 1.5, 79),
      bar(7, 1.5, 0.5, 77),
      bar(7, 2, 2, 74),
      bar(1, 2, 1, 72),
      bar(1, 3, 1, 74),
      bar(3, 2, 2, 71),
    ],
    seed: 101,
    gain: 0.9,
  },
  {
    name: 'combat1',
    bpm: 128,
    progression: ['Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D'],
    slots: 8,
    strums: [
      { slot: 0, down: true, gain: 1 },
      { slot: 1, down: false, gain: 0.5 },
      { slot: 2, down: true, gain: 0.8 },
      { slot: 3, down: false, gain: 0.5 },
      { slot: 4, down: true, gain: 0.95 },
      { slot: 5, down: false, gain: 0.5 },
      { slot: 6, down: true, gain: 0.8 },
      { slot: 7, down: false, gain: 0.55 },
    ],
    thumps: [
      { slot: 0, gain: 0.9 },
      { slot: 4, gain: 0.8 },
    ],
    taps: [{ slot: 5, gain: 0.35 }],
    slaps: [
      { slot: 2, gain: 0.7 },
      { slot: 6, gain: 0.7 },
    ],
    bass: false,
    muted: false,
    melody: [
      bar(2, 0, 0.5, 79),
      bar(2, 0.5, 0.5, 83),
      bar(2, 1, 1, 86),
      bar(2, 2, 2, 83),
      bar(3, 0, 1, 81),
      bar(3, 1, 1, 79),
      bar(3, 2, 2, 78),
      bar(6, 0, 0.5, 79),
      bar(6, 0.5, 0.5, 83),
      bar(6, 1, 1, 86),
      bar(6, 2, 1, 88),
      bar(6, 3, 1, 86),
      bar(7, 0, 2, 83),
      bar(7, 2, 2, 81),
    ],
    seed: 202,
    gain: 0.95,
  },
  {
    name: 'combat2',
    bpm: 138,
    progression: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
    slots: 8,
    strums: [
      { slot: 0, down: true, gain: 1 },
      { slot: 2, down: true, gain: 0.75 },
      { slot: 3, down: false, gain: 0.55 },
      { slot: 4, down: true, gain: 0.9 },
      { slot: 6, down: true, gain: 0.75 },
      { slot: 7, down: false, gain: 0.55 },
    ],
    thumps: [
      { slot: 0, gain: 0.85 },
      { slot: 3, gain: 0.5 },
      { slot: 4, gain: 0.75 },
    ],
    taps: [
      { slot: 2, gain: 0.4 },
      { slot: 6, gain: 0.4 },
      { slot: 7, gain: 0.3 },
    ],
    slaps: [{ slot: 4, gain: 0.45 }],
    bass: true,
    muted: false,
    melody: [
      bar(1, 0, 1, 81),
      bar(1, 1, 1, 84),
      bar(1, 2, 2, 88),
      bar(3, 0, 1, 86),
      bar(3, 1, 1, 83),
      bar(3, 2, 2, 79),
      bar(5, 0, 1, 81),
      bar(5, 1, 1, 84),
      bar(5, 2, 1, 88),
      bar(5, 3, 1, 91),
      bar(7, 0, 2, 90),
      bar(7, 2, 2, 83),
    ],
    seed: 303,
    gain: 0.95,
  },
  {
    name: 'tension',
    bpm: 150,
    progression: ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Bb', 'A'],
    slots: 16,
    strums: Array.from({ length: 16 }, (_, i) => ({
      slot: i,
      down: i % 2 === 0,
      gain: i % 4 === 0 ? 1 : i % 2 === 0 ? 0.65 : 0.4,
    })),
    thumps: [
      { slot: 0, gain: 0.9 },
      { slot: 6, gain: 0.7 },
      { slot: 8, gain: 0.9 },
      { slot: 14, gain: 0.7 },
    ],
    taps: Array.from({ length: 8 }, (_, i) => ({ slot: i * 2 + 1, gain: 0.35 })),
    slaps: [
      { slot: 4, gain: 0.8 },
      { slot: 12, gain: 0.8 },
    ],
    bass: true,
    muted: true,
    melody: [
      bar(0, 0, 0.5, 86),
      bar(0, 1, 0.5, 86),
      bar(0, 2, 0.5, 89),
      bar(2, 0, 0.5, 89),
      bar(2, 1, 0.5, 89),
      bar(2, 2, 0.5, 91),
      bar(4, 0, 0.5, 86),
      bar(4, 1, 0.5, 86),
      bar(4, 2, 0.5, 89),
      bar(6, 0, 0.5, 91),
      bar(6, 1, 0.5, 90),
      bar(6, 2, 0.5, 89),
    ],
    gliss: { from: 74, to: 98, beat: 20, len: 10 },
    seed: 404,
    gain: 0.95,
  },
];

export const TRACK_NAMES = SPECS.map((s) => s.name);

function tapSounds(seed: number): { thump: Float32Array; tap: Float32Array; slap: Float32Array } {
  const thump = shape(
    lowpass(
      sine(secs(0.2), (t) => 62 + 90 * Math.exp(-t * 28)).map(
        (v, i) => v + noise(1, makeRng(seed + i))[0] * 0.05,
      ),
      400,
    ),
    (t) => decay(t, 0.001, 0.07),
  );
  const tap = shape(
    bandpass(noise(secs(0.06), makeRng(seed + 1)), 2400, 1.4).map(
      (v, i) => v + Math.sin((i / SR) * 2 * Math.PI * 950) * 0.4,
    ),
    (t) => decay(t, 0.001, 0.016),
  );
  const slap = shape(bandpass(noise(secs(0.12), makeRng(seed + 2)), 1300, 0.9), (t) =>
    decay(t, 0.001, 0.035),
  );
  return { thump, tap, slap };
}

export interface RenderedTrack {
  name: string;
  bpm: number;
  pcm: Float32Array;
  seconds: number;
}

export function renderTrack(name: string): RenderedTrack {
  const spec = SPECS.find((s) => s.name === name);
  if (!spec) throw new Error(`musique inconnue : ${name}`);
  const beat = 60 / spec.bpm;
  const bars = spec.progression.length;
  const n = Math.round(bars * 4 * beat * SR);
  const out = new Float32Array(n);
  const rng = makeRng(spec.seed);
  const drums = tapSounds(spec.seed);
  const slotLen = (4 * beat * SR) / spec.slots;
  const at = (b: number, slot: number): number => Math.round(b * 4 * beat * SR + slot * slotLen);

  for (let b = 0; b < bars; b++) {
    const chord = CH[spec.progression[b]];
    const root = ROOT[spec.progression[b]];
    for (const s of spec.strums) {
      const order = s.down ? [0, 1, 2, 3] : [3, 2, 1, 0];
      order.forEach((k, i) => {
        const dur = spec.muted ? 0.16 : 0.7;
        const note = pluck(
          midiToHz(chord[k]),
          dur,
          rng,
          spec.muted ? 0.3 : 0.5,
          spec.muted ? 0.975 : 0.9955,
        );
        mixLoop(out, note, at(b, s.slot) + Math.round(i * 0.011 * SR), 0.2 * s.gain);
      });
    }
    for (const h of spec.thumps) mixLoop(out, drums.thump, at(b, h.slot), 0.9 * h.gain);
    for (const h of spec.taps) mixLoop(out, drums.tap, at(b, h.slot), 0.5 * h.gain);
    for (const h of spec.slaps) mixLoop(out, drums.slap, at(b, h.slot), 0.7 * h.gain);
    if (spec.bass) {
      for (let q = 0; q < 4; q++) {
        const note = pluck(midiToHz(root + (q === 2 ? 7 : 0)), 0.35, rng, 0.25, 0.992);
        mixLoop(out, note, Math.round((b * 4 + q) * beat * SR), 0.4);
      }
    }
  }
  for (const m of spec.melody) {
    const w = whistle(midiToHz(m.midi), midiToHz(m.midi), Math.max(0.12, m.len * beat * 0.92), rng);
    mixLoop(out, w, Math.round(m.beat * beat * SR), 0.34);
  }
  if (spec.gliss) {
    const g = spec.gliss;
    const w = whistle(midiToHz(g.from), midiToHz(g.to), g.len * beat, rng, 0.006);
    mixLoop(out, w, Math.round(g.beat * beat * SR), 0.2);
  }
  finish(out, 0.8 * spec.gain, 1.15);
  return { name: spec.name, bpm: spec.bpm, pcm: out, seconds: n / SR };
}
