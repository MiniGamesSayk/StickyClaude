import { defineConfig } from 'vite';

const server = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
      '/healthz': server,
      '/metrics': server,
      '/dev': server,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
