// Budget du premier chargement (analyse §2.8) : JS + CSS + polices du client construit, en gzip,
// hors audio. Échoue (code 1) au-delà de la limite.
//
//   node scripts/check-bundle.mjs [--dir packages/client/dist] [--limit 400000]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const dir = resolve(args.dir ?? 'packages/client/dist');
const limit = Number(args.limit ?? 400_000);
const COUNTED = new Set(['.js', '.mjs', '.css', '.woff2', '.woff', '.html', '.svg']);

/** @returns {string[]} */
function walk(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) {
      if (name === 'audio') continue;
      out.push(...walk(p));
    } else out.push(p);
  }
  return out;
}

const rows = [];
let total = 0;
for (const file of walk(dir)) {
  const ext = extname(file);
  if (!COUNTED.has(ext)) continue;
  const buf = readFileSync(file);
  // Les polices woff2 sont déjà compressées : gzip n'y change presque rien.
  const gz = gzipSync(buf, { level: 9 }).length;
  total += gz;
  rows.push([relative(dir, file).split(sep).join('/'), buf.length, gz]);
}
rows.sort((a, b) => b[2] - a[2]);
const kb = (n) => `${(n / 1000).toFixed(1)} Ko`;
for (const [name, raw, gz] of rows) {
  console.log(`${name.padEnd(52)} ${kb(raw).padStart(10)} ${kb(gz).padStart(10)} gzip`);
}
console.log(
  `${'TOTAL'.padEnd(52)} ${''.padStart(10)} ${kb(total).padStart(10)} gzip (limite ${kb(limit)})`,
);
if (total > limit) {
  console.error(`Budget du bundle dépassé : ${kb(total)} > ${kb(limit)}`);
  process.exit(1);
}
