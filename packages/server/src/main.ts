import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { startServer } from './httpServer.ts';
import { createLogger } from './logger.ts';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig(process.env, resolve(here, '../../client/dist'));
const log = createLogger(config.logLevel);

process.on('uncaughtException', (err) => {
  log({ level: 'fatal', msg: 'uncaught exception', err: err.stack ?? String(err) });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log({ level: 'fatal', msg: 'unhandled rejection', err: String(reason) });
  process.exit(1);
});

const running = await startServer(config, log);

let stopping = false;
const shutdown = (signal: string): void => {
  if (stopping) {
    log({ level: 'warn', msg: 'second signal, forcing exit', signal });
    process.exit(1);
  }
  stopping = true;
  log({ level: 'info', msg: 'shutting down', signal, graceMs: config.shutdownGraceMs });
  running.shutdown(config.shutdownGraceMs).then(
    () => process.exit(0),
    (err: unknown) => {
      log({ level: 'error', msg: 'shutdown failed', err: String(err) });
      process.exit(1);
    },
  );
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
