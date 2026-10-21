import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    // Certaines dépendances CJS (ws) utilisent require() dans un bundle ESM.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  legalComments: 'none',
});
console.log('server built: dist/index.js');
