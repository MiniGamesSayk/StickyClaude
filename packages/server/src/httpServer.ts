import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { parseArena } from '@stickyclaude/shared/schemas';
import { ARENAS } from '@stickyclaude/shared';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { originAllowed } from './config.ts';
import type { ServerConfig } from './config.ts';
import type { Connection } from './connection.ts';
import { GameServer } from './gameServer.ts';
import { startLoop } from './loop.ts';
import type { Room } from './room.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const HEARTBEAT_MS = 10_000;

class WsConnection implements Connection {
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
    this.ws.close(code, reason);
    // Un client bloqué ne répond pas à la fermeture : on coupe après un court délai.
    setTimeout(() => this.ws.terminate(), 2000).unref();
  }
}

export interface RunningServer {
  http: Server;
  game: GameServer;
  port: number;
  stop(): Promise<void>;
}

function clientIp(req: IncomingMessage): string {
  const a = req.socket.remoteAddress ?? 'unknown';
  return a.startsWith('::ffff:') ? a.slice(7) : a;
}

function toBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return new Uint8Array(data);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function serveStatic(
  cfg: ServerConfig,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400).end();
    return;
  }
  const root = normalize(cfg.staticDir);
  let file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const ext = extname(file).toLowerCase();
  const isIndex = file.endsWith(`${sep}index.html`);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

function writeRecording(cfg: ServerConfig, room: Room): void {
  const rec = room.recording;
  if (!rec || cfg.recordDir === '' || room.world.tick === 0) return;
  mkdirSync(cfg.recordDir, { recursive: true });
  const file = join(cfg.recordDir, `room-${room.code}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(rec.toRecording(room.world.tick, room.stateHash())));
}

export function startServer(
  cfg: ServerConfig,
  log: (o: Record<string, unknown>) => void = () => {},
): Promise<RunningServer> {
  // Les arènes embarquées doivent être valides : on échoue au démarrage sinon.
  for (const a of Object.values(ARENAS)) parseArena(a);

  const game = new GameServer(cfg, { onRoomClosed: (room) => writeRecording(cfg, room) });

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (url.pathname === '/healthz') {
      json(res, 200, { ok: true, rooms: game.rooms.size, players: game.playerCount });
      return;
    }
    if (url.pathname === '/metrics') {
      if (cfg.metricsToken !== '' && req.headers.authorization !== `Bearer ${cfg.metricsToken}`) {
        res.writeHead(401).end();
        return;
      }
      json(res, 200, game.metrics.snapshot(game.stats()));
      return;
    }
    if (cfg.devTools && url.pathname.startsWith('/dev/recording/')) {
      const room = game.rooms.get(url.pathname.slice('/dev/recording/'.length).toUpperCase());
      const rec = room?.recording;
      if (!room || !rec) {
        res.writeHead(404).end();
        return;
      }
      json(res, 200, rec.toRecording(room.world.tick, room.stateHash()));
      return;
    }
    serveStatic(cfg, req, res, url.pathname);
  };

  const server = createServer(handler);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const alive = new WeakMap<WebSocket, boolean>();
  let nextId = 1;

  const reject = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return reject(socket, '404 Not Found');
    if (!originAllowed(req.headers.origin, cfg)) return reject(socket, '403 Forbidden');
    const ip = clientIp(req);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = new WsConnection(nextId++, ip, ws);
      if (!game.onConnect(conn)) {
        ws.close(1013, 'server busy');
        return;
      }
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      ws.on('message', (data: RawData, isBinary: boolean) => {
        const bytes = toBytes(data);
        game.onMessage(conn, isBinary ? bytes : Buffer.from(bytes).toString('utf8'), isBinary);
      });
      ws.on('close', () => game.onClose(conn));
      ws.on('error', (err) => log({ level: 'warn', msg: 'ws error', err: err.message }));
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const loop = startLoop(game, cfg.tickHz, (lag) =>
    log({ level: 'warn', msg: 'tick overrun', lagMs: Math.round(lag) }),
  );

  return new Promise((resolve, reject2) => {
    server.once('error', reject2);
    server.listen(cfg.port, cfg.host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
      log({ level: 'info', msg: 'listening', host: cfg.host, port, devTools: cfg.devTools });
      resolve({
        http: server,
        game,
        port,
        stop: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            loop.stop();
            for (const ws of wss.clients) ws.close(1001, 'server stopping');
            for (const room of game.rooms.values()) writeRecording(cfg, room);
            game.stop();
            wss.close();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
