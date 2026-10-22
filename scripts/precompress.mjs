// Précompresse le client construit (brotli et gzip) pour que le serveur n'ait rien à compresser :
// chaque `fichier.js` gagne un `fichier.js.br` et un `fichier.js.gz`, servis selon Accept-Encoding
// (voir packages/server/src/static.ts). N'écrit une variante que si elle est plus petite.
//
//   node scripts/precompress.mjs [--dir packages/client/dist]
import { readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const argv = process.argv.slice(2);
const i = argv.indexOf('--dir');
const dir = resolve(
  i >= 0
    ? argv[i + 1]
    : join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'client', 'dist'),
);
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.ico']);

/** @returns {string[]} */
function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let raw = 0;
let br = 0;
let gz = 0;
let n = 0;
for (const file of walk(dir)) {
  if (file.endsWith('.br') || file.endsWith('.gz')) {
    rmSync(file); // reste d'une construction précédente
    continue;
  }
  if (!COMPRESSIBLE.has(extname(file).toLowerCase())) continue;
  const buf = readFileSync(file);
  if (buf.length < 256) continue;
  const b = brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  const g = gzipSync(buf, { level: 9 });
  raw += buf.length;
  n++;
  if (b.length < buf.length) {
    writeFileSync(`${file}.br`, b);
    br += b.length;
  } else br += buf.length;
  if (g.length < buf.length) {
    writeFileSync(`${file}.gz`, g);
    gz += g.length;
  } else gz += buf.length;
}
const ko = (v) => `${(v / 1000).toFixed(1)} Ko`;
console.log(`precompress : ${n} fichiers, ${ko(raw)} -> brotli ${ko(br)}, gzip ${ko(gz)}`);
