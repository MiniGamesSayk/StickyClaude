import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { startServer } from './httpServer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(process.env, resolve(here, '../../client/dist'));

const log = (o: Record<string, unknown>): void => {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...o }));
};

const running = await startServer(config, log);

const shutdown = (signal: string): void => {
  log({ level: 'info', msg: 'shutting down', signal });
  void running.stop().then(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
