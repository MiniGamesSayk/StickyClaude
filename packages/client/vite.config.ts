import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const server = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';

/**
 * L'éditeur d'arènes (`/editor`) et la planche de référence du style (`/sheet`) n'existent qu'en
 * développement : ils sont servis par Vite et ne sont pas des entrées de la version construite
 * (voir `docs/ARENES.md` et `docs/DIRECTION_ARTISTIQUE.md`).
 */
const devPages = (): Plugin => ({
  name: 'stickyclaude-dev-pages',
  apply: 'serve',
  configureServer(s) {
    s.middlewares.use((req, _res, next) => {
      for (const page of ['editor', 'sheet']) {
        if (req.url === `/${page}` || req.url?.startsWith(`/${page}?`)) {
          req.url = `/${page}/index.html${req.url.slice(page.length + 1)}`;
        }
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [devPages()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
      '/healthz': server,
      '/api': server,
      '/metrics': server,
      '/dev': server,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // Une seule entrée : jamais l'éditeur (editor/index.html) dans la version de production.
    rollupOptions: { input: 'index.html' },
  },
});
