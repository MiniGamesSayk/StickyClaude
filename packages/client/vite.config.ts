import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const server = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';

/**
 * L'éditeur d'arènes n'existe qu'en développement : `/editor` est servi par le serveur de Vite et
 * la page n'est pas une entrée de la version construite (voir `docs/ARENES.md`).
 */
const editorRoute = (): Plugin => ({
  name: 'stickyclaude-editor-route',
  apply: 'serve',
  configureServer(s) {
    s.middlewares.use((req, _res, next) => {
      if (req.url === '/editor' || req.url?.startsWith('/editor?')) req.url = '/editor/index.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [editorRoute()],
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
