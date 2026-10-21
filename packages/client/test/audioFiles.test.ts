import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpusScript from 'opusscript';
import { describe, expect, it } from 'vitest';
import { SR } from '../../../scripts/gen-audio/dsp.ts';
import { renderTrack } from '../../../scripts/gen-audio/music.ts';
import { encodeOggOpus, parseOgg } from '../../../scripts/gen-audio/ogg.ts';
import { renderSfx, SFX_NAMES } from '../../../scripts/gen-audio/sfx.ts';
import type { SfxName } from '../src/audio/engine.ts';

const dir = fileURLToPath(new URL('../public/audio/', import.meta.url));
interface Entry {
  file: string;
  bytes: number;
  seconds: number;
}
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
  sfx: Record<string, Entry>;
  music: Record<string, Entry>;
  bytes: number;
};

describe('sons générés (scripts/gen-audio)', () => {
  it('le budget total tient dans 1,5 Mo', () => {
    let total = 0;
    for (const e of [...Object.values(manifest.sfx), ...Object.values(manifest.music)]) {
      total += readFileSync(join(dir, e.file)).length;
    }
    expect(total).toBe(manifest.bytes);
    expect(total).toBeLessThan(1_500_000);
  });

  it('le manifeste décrit exactement les fichiers présents', () => {
    const onDisk = new Set<string>();
    for (const sub of ['sfx', 'music']) {
      for (const f of readdirSync(join(dir, sub))) onDisk.add(`${sub}/${f}`);
    }
    const listed = new Set([
      ...Object.values(manifest.sfx).map((e) => e.file),
      ...Object.values(manifest.music).map((e) => e.file),
    ]);
    expect(onDisk).toEqual(listed);
    for (const f of listed) expect(existsSync(join(dir, f))).toBe(true);
  });

  it('chaque effet que le moteur sait jouer existe', () => {
    const wanted: SfxName[] = [
      'step',
      'jump',
      'double_jump',
      'wall_jump',
      'land',
      'drop',
      'swing',
      'hit',
      'hit_heavy',
      'block',
      'parry',
      'ko',
      'shot_pistol',
      'shot_shotgun',
      'shot_blow',
      'shot_plane',
      'shot_bazooka',
      'explosion',
      'terrain',
      'eraser',
      'grapple',
      'throw',
      'stamp',
      'crate',
      'pickup',
      'weapon_spawn',
      'emote',
      'spawn',
      'goal',
      'page_turn',
      'count_tick',
      'count_go',
      'victory',
      'sudden',
      'ui_hover',
      'ui_click',
    ];
    for (const n of wanted) expect(manifest.sfx[n], n).toBeDefined();
    expect(Object.keys(manifest.music).sort()).toEqual(['combat1', 'combat2', 'menu', 'tension']);
  });

  it('chaque fichier est un Ogg Opus valide : CRC, durée, paquets décodables et non muets', () => {
    const dec = new OpusScript(SR, 1, OpusScript.Application.AUDIO);
    for (const [name, e] of [...Object.entries(manifest.sfx), ...Object.entries(manifest.music)]) {
      const ogg = parseOgg(readFileSync(join(dir, e.file)));
      expect(ogg.crcOk, name).toBe(true);
      expect(ogg.channels).toBe(1);
      expect(ogg.sampleRate).toBe(SR);
      const seconds = (Number(ogg.granule) - ogg.preSkip) / SR;
      expect(seconds, name).toBeCloseTo(e.seconds, 2);
      let peak = 0;
      let count = 0;
      for (const p of ogg.packets) {
        const pcm = dec.decode(Buffer.from(p));
        for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
        count++;
      }
      expect(count).toBeGreaterThan(0);
      expect(peak, name).toBeGreaterThan(2000);
    }
    dec.delete();
  });

  it('les effets sont courts (≤ 1,5 s) et ne claquent pas aux bords', () => {
    for (const name of SFX_NAMES) {
      const pcm = renderSfx(name);
      expect(pcm.length / SR, name).toBeLessThanOrEqual(1.5);
      expect(Math.abs(pcm[0]), name).toBeLessThan(0.05);
      expect(Math.abs(pcm[pcm.length - 1]), name).toBeLessThan(0.05);
    }
  });

  it('la génération est déterministe : mêmes octets que les fichiers committés', () => {
    for (const name of ['hit', 'parry', 'ko']) {
      const data = encodeOggOpus(renderSfx(name), { bitrate: 28000 });
      expect(data.equals(readFileSync(join(dir, manifest.sfx[name].file))), name).toBe(true);
    }
  });

  it('les boucles de musique sont sans couture : début et fin se raccordent', () => {
    for (const name of ['menu', 'combat1', 'combat2', 'tension']) {
      const t = renderTrack(name);
      // l'écart entre le dernier et le premier échantillon est de l'ordre d'un pas normal du signal
      let maxStep = 0;
      for (let i = 1; i < 2000; i++) maxStep = Math.max(maxStep, Math.abs(t.pcm[i] - t.pcm[i - 1]));
      const seam = Math.abs(t.pcm[0] - t.pcm[t.pcm.length - 1]);
      expect(seam, name).toBeLessThanOrEqual(Math.max(0.35, maxStep * 1.5));
      expect(t.seconds).toBeGreaterThan(10);
      expect(t.seconds).toBeLessThan(30);
    }
  });
});
