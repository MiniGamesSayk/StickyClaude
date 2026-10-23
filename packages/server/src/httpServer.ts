import { writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { parseArena } from '@stickyclaude/shared/schemas';
import { ARENAS, MAX_ARENA_MESSAGE_BYTES } from '@stickyclaude/shared';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { originAllowed } from './config.ts';
import type { ServerConfig } from './config.ts';
import type { Connection } from './connection.ts';
import { GameServer } from './gameServer.ts';
import { startLoop } from './loop.ts';
import type { LogFn } from './logger.ts';
import { truncateIp } from './logger.ts';
import { createAccountService } from './account.ts';
import { clientAddress, isInternalRequest, parseTrustedProxy } from './proxy.ts';
import type { Room } from './room.ts';
import { securityHeaders } from './security.ts';
import { StaticSite } from './static.ts';

/** Déconnexion après 3 pings WebSocket sans réponse (30 s avec l'intervalle par défaut de 10 s). */
const HEARTBEAT_MAX_MISSED = 3;

class WsConnection implements Connection {
  rttMs = 0;
  userId?: string;
  private closing = false;
  constructor(
    readonly id: number,
    readonly ip: string,
    private readonly ws: WebSocket,
  ) {}

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  send(data: Uint8Array | string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(data, { binary: typeof data !== 'string', compress: false });
  }

  close(code: number, reason: string): void {
    if (this.closing) return;
    this.closing = true;
    this.ws.close(code, reason);
    // Un client bloqué ne répond pas à la fermeture : on coupe après un court délai.
    setTimeout(() => this.ws.terminate(), 2000).unref();
  }
}

export interface RunningServer {
  http: Server;
  game: GameServer;
  port: number;
  /** Arrêt immédiat. */
  stop(): Promise<void>;
  /**
   * Arrêt propre : n'accepte plus de connexion, annonce l'arrêt aux joueurs, attend qu'ils soient
   * partis (au plus `graceMs`), ferme le reste avec le code 1012 (le client se reconnecte seul).
   */
  shutdown(graceMs: number): Promise<void>;
}

/** Code de fermeture WebSocket « Service Restart » : le serveur redémarre (mise à jour). */
export const CLOSE_SERVICE_RESTART = 1012;

function toBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return new Uint8Array(data);
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...extra,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** Écrit l'enregistrement d'un salon fermé ; une erreur (disque plein…) est journalisée, jamais levée. */
export function writeRecording(cfg: ServerConfig, room: Room, log: LogFn = () => {}): void {
  const rec = room.recording;
  if (!rec || cfg.recordDir === '' || room.world.tick === 0) return;
  try {
    mkdirSync(cfg.recordDir, { recursive: true });
    const file = join(cfg.recordDir, `room-${room.code}-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(rec.toRecording(room.world.tick, room.stateHash())));
  } catch (e) {
    log({ level: 'error', msg: 'recording failed', room: room.code, err: String(e) });
  }
}

export function startServer(cfg: ServerConfig, log: LogFn = () => {}): Promise<RunningServer> {
  // Les arènes embarquées doivent être valides : on échoue au démarrage sinon.
  for (const a of Object.values(ARENAS)) parseArena(a);

  const trusted = parseTrustedProxy(cfg.trustedProxy);
  const site = new StaticSite(cfg.staticDir, !cfg.production);
  const accounts = createAccountService(cfg, log);
  const game = new GameServer(cfg, {
    onRoomClosed: (room) => writeRecording(cfg, room, log),
    log,
    onMatchStats: accounts ? (id, add, max) => accounts.report(id, add, max) : undefined,
  });
  let warnedForwarded = false;

  /** Adresse du client ; avertit une fois si un proxy non déclaré est détecté en production. */
  const addressOf = (req: IncomingMessage): string => {
    const a = clientAddress(req, trusted);
    if (a.ignoredForwarded && cfg.production && !warnedForwarded) {
      warnedForwarded = true;
      log({
        level: 'warn',
        msg: 'X-Forwarded-For ignored: the peer is not in TRUSTED_PROXY, all clients share its address',
        peer: truncateIp(req.socket.remoteAddress ?? ''),
      });
    }
    return a.ip;
  };

  const metricsAllowed = (req: IncomingMessage): boolean =>
    (cfg.metricsToken !== '' && req.headers.authorization === `Bearer ${cfg.metricsToken}`) ||
    isInternalRequest(req);

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sec = securityHeaders(cfg, req, false);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...sec, Allow: 'GET, HEAD' }).end();
      return;
    }
    if (url.pathname === '/healthz') {
      if (game.isDraining) json(res, 503, { ok: false, draining: true }, sec);
      else json(res, 200, { ok: true, rooms: game.rooms.size, players: game.playerCount }, sec);
      return;
    }
    if (url.pathname === '/api/rooms') {
      json(res, 200, game.publicRooms(), sec);
      return;
    }
    if (url.pathname === '/metrics') {
      if (!metricsAllowed(req)) {
        res.writeHead(404, sec).end();
        return;
      }
      const snapshot = game.metrics.snapshot(game.stats());
      if (url.searchParams.get('reset') === '1') game.metrics.resetWindow();
      json(res, 200, snapshot, sec);
      return;
    }
    if (cfg.devTools && url.pathname.startsWith('/dev/recording/')) {
      const room = game.rooms.get(url.pathname.slice('/dev/recording/'.length).toUpperCase());
      const rec = room?.recording;
      if (!room || !rec) {
        res.writeHead(404, sec).end();
        return;
      }
      json(res, 200, rec.toRecording(room.world.tick, room.stateHash()), sec);
      return;
    }
    const served = site.serve(req, res, url.pathname, (isDocument) =>
      securityHeaders(cfg, req, isDocument),
    );
    if (!served) {
      res.writeHead(404, { ...sec, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  };

  const server = createServer(handler);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_ARENA_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const missed = new WeakMap<WebSocket, number>();
  let nextId = 1;

  const reject = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void onUpgrade(req, socket, head);
  });

  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return reject(socket, '404 Not Found');
    if (!originAllowed(req.headers.origin, cfg, req.headers.host)) {
      return reject(socket, '403 Forbidden');
    }
    const ip = addressOf(req);
    // Compte sayk.fr éventuel : vérifié avant l'upgrade (au plus 1,5 s, anonyme en cas d'échec).
    const userId = accounts ? await accounts.resolve(req.headers.cookie) : null;
    if (socket.destroyed) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = new WsConnection(nextId++, ip, ws);
      if (userId !== null) conn.userId = userId;
      if (!game.onConnect(conn)) {
        ws.close(game.isDraining ? CLOSE_SERVICE_RESTART : 1013, 'server busy');
        return;
      }
      missed.set(ws, 0);
      ws.on('pong', (payload: Buffer) => {
        missed.set(ws, 0);
        // La charge du ping est l'horloge d'envoi : on en déduit la latence aller-retour.
        const sent = Number(payload.toString('utf8'));
        if (Number.isFinite(sent)) conn.rttMs = Math.max(0, performance.now() - sent);
      });
      ws.on('message', (data: RawData, isBinary: boolean) => {
        const bytes = toBytes(data);
        game.onMessage(conn, isBinary ? bytes : Buffer.from(bytes).toString('utf8'), isBinary);
      });
      ws.on('close', () => game.onClose(conn));
      ws.on('error', (err) => log({ level: 'warn', msg: 'ws error', err: err.message }));
    });
  };

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const n = missed.get(ws) ?? 0;
      if (n >= HEARTBEAT_MAX_MISSED) {
        ws.terminate();
        continue;
      }
      missed.set(ws, n + 1);
      ws.ping(String(performance.now()));
    }
  }, cfg.heartbeatMs);
  heartbeat.unref();

  // Un serveur en retard le reste en rafale : un seul journal toutes les 5 s, avec le total.
  let overruns = 0;
  let worstLag = 0;
  let lastOverrunLog = 0;
  const loop = startLoop(game, cfg.tickHz, (lag) => {
    overruns++;
    worstLag = Math.max(worstLag, lag);
    const now = performance.now();
    if (now - lastOverrunLog < 5000) return;
    lastOverrunLog = now;
    log({ level: 'warn', msg: 'tick overrun', count: overruns, worstLagMs: Math.round(worstLag) });
    overruns = 0;
    worstLag = 0;
  });

  const stop = (): Promise<void> =>
    new Promise<void>((done) => {
      clearInterval(heartbeat);
      loop.stop();
      for (const ws of wss.clients) ws.close(1001, 'server stopping');
      for (const room of game.rooms.values()) writeRecording(cfg, room, log);
      game.stop();
      wss.close();
      server.closeAllConnections();
      server.close(() => done());
    });

  const shutdown = async (graceMs: number): Promise<void> => {
    game.drain();
    game.announceShutdown(graceMs);
    log({ level: 'info', msg: 'draining', graceMs, connections: game.connectionCount });
    const deadline = performance.now() + graceMs;
    while (game.connectionCount > 0 && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const left = game.connectionCount;
    for (const ws of wss.clients) ws.close(CLOSE_SERVICE_RESTART, 'server restarting');
    // Laisse partir les trames de fermeture avant de couper les sockets.
    if (left > 0) await new Promise((r) => setTimeout(r, 300));
    log({ level: 'info', msg: 'drained', closed: left });
    await stop();
  };

  return new Promise((resolve, reject2) => {
    server.once('error', reject2);
    server.listen(cfg.port, cfg.host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
      log({
        level: 'info',
        msg: 'listening',
        host: cfg.host,
        port,
        production: cfg.production,
        devTools: cfg.devTools,
        staticFiles: site.size,
        publicOrigin: cfg.publicOrigin,
        trustedProxy: cfg.trustedProxy,
      });
      resolve({ http: server, game, port, stop, shutdown });
    });
  });
}
