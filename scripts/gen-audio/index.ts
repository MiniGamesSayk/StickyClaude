// Génère tous les sons et musiques du jeu (analyse §1.10) : synthèse par script, aucun son repris.
//
//   npm run gen-audio            écrit packages/client/public/audio/{sfx,music}/*.opus et manifest.json
//   npm run gen-audio -- --check vérifie que les fichiers committés sont à jour (octet pour octet)
//
// Budget : moins de 1,5 Mo au total, chargé après le premier écran.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR } from './dsp.ts';
import { renderTrack, TRACK_NAMES } from './music.ts';
import { encodeOggOpus } from './ogg.ts';
import { renderSfx, SFX_NAMES } from './sfx.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../packages/client/public/audio');
const check = process.argv.includes('--check');
const BUDGET = 1_500_000;

interface Entry {
  file: string;
  bytes: number;
  seconds: number;
  bpm?: number;
}

const manifest: { sfx: Record<string, Entry>; music: Record<string, Entry>; bytes: number } = {
  sfx: {},
  music: {},
  bytes: 0,
};
let stale = 0;

function emit(rel: string, data: Buffer): void {
  const path = join(outDir, rel);
  if (check) {
    if (!existsSync(path) || !readFileSync(path).equals(data)) {
      console.error(`obsolète : ${rel}`);
      stale++;
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

for (const name of SFX_NAMES) {
  const pcm = renderSfx(name);
  const data = encodeOggOpus(pcm, { bitrate: 28000 });
  manifest.sfx[name] = {
    file: `sfx/${name}.opus`,
    bytes: data.length,
    seconds: +(pcm.length / SR).toFixed(3),
  };
  manifest.bytes += data.length;
  emit(`sfx/${name}.opus`, data);
}
for (const name of TRACK_NAMES) {
  const t = renderTrack(name);
  const data = encodeOggOpus(t.pcm, { bitrate: 40000 });
  manifest.music[name] = {
    file: `music/${name}.opus`,
    bytes: data.length,
    seconds: +t.seconds.toFixed(3),
    bpm: t.bpm,
  };
  manifest.bytes += data.length;
  emit(`music/${name}.opus`, data);
}
emit('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));

console.log(
  `${SFX_NAMES.length} effets, ${TRACK_NAMES.length} musiques, ${(manifest.bytes / 1000).toFixed(0)} Ko (budget ${BUDGET / 1000} Ko)`,
);
if (manifest.bytes > BUDGET) {
  console.error('budget audio dépassé');
  process.exit(1);
}
if (check && stale > 0) {
  console.error(`${stale} fichier(s) à régénérer : npm run gen-audio`);
  process.exit(1);
}
