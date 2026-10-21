import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BinType,
  createSnapshot,
  decodeSnapshot,
  encodeInput,
  Input,
  PROTOCOL_VERSION,
} from '@stickyclaude/shared';
import type { ServerMessage, Snapshot } from '@stickyclaude/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { loadConfig, startServer } from '../src/index.ts';
import type { RunningServer } from '../src/index.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class TestClient {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  lastSnapshot: Snapshot | null = null;
  snapshotCount = 0;
  closedWith: number | null = null;
  slot = -1;
  private timer: NodeJS.Timeout | undefined;
  mask = 0;
  private readonly buf = new Uint8Array(16);

  constructor(url: string, origin?: string) {
    this.ws = new WebSocket(url, origin ? { origin } : undefined);
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (data[0] === BinType.SNAPSHOT) {
          const s = createSnapshot();
          decodeSnapshot(data, s);
          this.lastSnapshot = s;
          this.snapshotCount++;
        }
      } else {
        const m = JSON.parse(data.toString('utf8')) as ServerMessage;
        this.messages.push(m);
        if (m.t === 'joined') this.slot = m.slot;
      }
    });
    this.ws.on('close', (code) => {
      this.closedWith = code;
    });
    this.ws.on('error', () => {});
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) =>
        reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
  }

  sendJson(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  async waitFor<T extends ServerMessage['t']>(
    t: T,
    ms = 2000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const m = this.messages.find((x) => x.t === t);
      if (m) return m as Extract<ServerMessage, { t: T }>;
      await sleep(5);
    }
    throw new Error(`timeout waiting for ${t}`);
  }

  /** Envoie des entrées à 60 Hz avec une avance de 3 ticks sur le dernier snapshot reçu. */
  startInputs(): void {
    let label = 0;
    this.timer = setInterval(() => {
      const snap = this.lastSnapshot;
      if (!snap) return;
      label = Math.max(label + 1, snap.tick + 4);
      const n = encodeInput(this.buf, label, 0, 25, [this.mask, this.mask, this.mask], 3);
      this.ws.send(this.buf.slice(0, n));
    }, 1000 / 60);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.ws.close();
  }
}

let staticDir = '';
let srv: RunningServer;
let base = '';

beforeAll(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'sc-static-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(staticDir, 'app.js'), 'console.log(1)');
  const cfg = loadConfig({ PORT: '0', DEV_TOOLS: '1', STATIC_DIR: staticDir }, staticDir);
  srv = await startServer(cfg);
  base = `127.0.0.1:${srv.port}`;
});

afterAll(async () => {
  await srv.stop();
});

describe('HTTP', () => {
  it('/healthz répond ok avec le nombre de salons et de joueurs', async () => {
    const res = await fetch(`http://${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, rooms: 0, players: 0 });
  });

  it('/metrics expose les mesures du serveur', async () => {
    const res = await fetch(`http://${base}/metrics`);
    const m = (await res.json()) as Record<string, unknown>;
    expect(m).toHaveProperty('tickMs');
    expect(m).toHaveProperty('eventLoopDelayMs');
    expect(m).toHaveProperty('heapUsedMB');
  });

  it('sert le client construit, avec index.html en no-cache', async () => {
    const res = await fetch(`http://${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>t</title>');
    const js = await fetch(`http://${base}/app.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(js.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('refuse la traversée de répertoire et répond 404 sinon', async () => {
    for (const p of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd']) {
      const res = await fetch(`http://${base}${p}`);
      expect([400, 403, 404]).toContain(res.status);
    }
    expect((await fetch(`http://${base}/nope.txt`)).status).toBe(404);
    expect((await fetch(`http://${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('WebSocket', () => {
  it('8 clients jouent dans le même salon et se voient mutuellement', async () => {
    const clients = Array.from({ length: 8 }, () => new TestClient(`ws://${base}/ws`));
    await Promise.all(clients.map((c) => c.open()));
    clients[0].sendJson({ t: 'create', v: PROTOCOL_VERSION, name: 'Hôte' });
    const joined = await clients[0].waitFor('joined');
    expect(joined.slot).toBe(0);
    for (let i = 1; i < 8; i++) {
      clients[i].sendJson({
        t: 'join',
        v: PROTOCOL_VERSION,
        name: `Joueur${i}`,
        code: joined.code,
      });
    }
    await Promise.all(clients.slice(1).map((c) => c.waitFor('joined')));
    expect(clients.map((c) => c.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    for (const c of clients) c.startInputs();
    await sleep(500);
    // Tout le monde court vers la droite pendant 1 s
    for (const c of clients) c.mask = Input.RIGHT;
    await sleep(1000);
    for (const c of clients) c.mask = 0;
    await sleep(500);

    for (const c of clients) {
      const s = c.lastSnapshot!;
      expect(s).not.toBeNull();
      expect(s.playerCount).toBe(8);
      expect(s.hasOwn).toBe(true);
      expect(c.snapshotCount).toBeGreaterThan(40);
      expect(s.own.vx).toBe(0);
    }
    // Un joueur voit les autres au même endroit que le serveur
    const s0 = clients[0].lastSnapshot!;
    const s7 = clients[7].lastSnapshot!;
    const seen0of3 = s0.players.find((p, i) => i < s0.playerCount && p.slot === 3)!;
    const seen7of3 = s7.players.find((p, i) => i < s7.playerCount && p.slot === 3)!;
    expect(Math.abs(seen0of3.x - seen7of3.x)).toBeLessThan(1);
    expect(seen0of3.x).toBeGreaterThan(0);

    const health = (await (await fetch(`http://${base}/healthz`)).json()) as {
      rooms: number;
      players: number;
    };
    expect(health.players).toBeGreaterThanOrEqual(8);

    for (const c of clients) c.stop();
    await sleep(100);
  }, 15_000);

  it('retire un joueur du salon à la déconnexion et prévient les autres', async () => {
    const a = new TestClient(`ws://${base}/ws`);
    const b = new TestClient(`ws://${base}/ws`);
    await Promise.all([a.open(), b.open()]);
    a.sendJson({ t: 'create', v: PROTOCOL_VERSION, name: 'Alice' });
    const { code } = await a.waitFor('joined');
    b.sendJson({ t: 'join', v: PROTOCOL_VERSION, name: 'Bobby', code });
    await b.waitFor('joined');
    b.ws.close();
    await sleep(150);
    const rosters = a.messages.filter((m) => m.t === 'roster');
    const last = rosters[rosters.length - 1];
    expect(last.players).toHaveLength(1);
    a.stop();
  });

  it('ferme une connexion qui envoie un message de plus de 1 Ko', async () => {
    const c = new TestClient(`ws://${base}/ws`);
    await c.open();
    c.ws.send('x'.repeat(2000));
    await sleep(200);
    expect(c.closedWith).toBe(1009);
  });

  it('refuse les chemins WebSocket inconnus', async () => {
    const c = new TestClient(`ws://${base}/autre`);
    await expect(c.open()).rejects.toBeTruthy();
  });
});

describe('Origin en production', () => {
  it('accepte uniquement l origine publique', async () => {
    const cfg = loadConfig(
      {
        PORT: '0',
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://stickyclaude.sayk.fr',
        HOST: '127.0.0.1',
      },
      staticDir,
    );
    const prod = await startServer(cfg);
    try {
      const url = `ws://127.0.0.1:${prod.port}/ws`;
      const bad = new TestClient(url, 'https://evil.example');
      await expect(bad.open()).rejects.toBeTruthy();
      const none = new TestClient(url);
      await expect(none.open()).rejects.toBeTruthy();
      const ok = new TestClient(url, 'https://stickyclaude.sayk.fr');
      await ok.open();
      ok.stop();
    } finally {
      await prod.stop();
    }
  });
});
