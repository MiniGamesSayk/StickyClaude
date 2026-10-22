import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  clientAddress,
  contentSecurityPolicy,
  CLOSE_SERVICE_RESTART,
  isInternalRequest,
  loadConfig,
  originAllowed,
  parseTrustedProxy,
  startServer,
  truncateIp,
} from '../src/index.ts';
import type { RunningServer } from '../src/index.ts';

/** Couche de production : proxy de confiance, Origin, en-têtes, statique précompressé, arrêt propre. */

function fakeReq(peer: string, headers: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress: peer }, headers } as unknown as IncomingMessage;
}

describe('proxy de confiance', () => {
  it('ignore X-Forwarded-For sans proxy déclaré', () => {
    const a = clientAddress(fakeReq('172.18.0.5', { 'x-forwarded-for': '9.9.9.9' }), null);
    expect(a).toEqual({ ip: '172.18.0.5', ignoredForwarded: true });
  });

  it('croit X-Forwarded-For venu de Caddy (réseau privé)', () => {
    const t = parseTrustedProxy('caddy');
    const a = clientAddress(fakeReq('172.18.0.5', { 'x-forwarded-for': '203.0.113.7' }), t);
    expect(a.ip).toBe('203.0.113.7');
  });

  it('ne croit pas X-Forwarded-For venu d’une adresse publique', () => {
    const t = parseTrustedProxy('caddy');
    const a = clientAddress(fakeReq('198.51.100.1', { 'x-forwarded-for': '1.1.1.1' }), t);
    expect(a.ip).toBe('198.51.100.1');
  });

  it('prend la première adresse qui n’est pas un proxy, en partant de la droite', () => {
    const t = parseTrustedProxy('10.0.0.0/8');
    // le client a forgé « 1.1.1.1 » ; Caddy a ajouté la vraie adresse
    const a = clientAddress(
      fakeReq('10.1.2.3', { 'x-forwarded-for': '1.1.1.1, 203.0.113.9, 10.9.9.9' }),
      t,
    );
    expect(a.ip).toBe('203.0.113.9');
  });

  it('accepte IPv6 et ::ffff: ; rejette une configuration invalide', () => {
    const t = parseTrustedProxy('fd00::/8,127.0.0.1');
    expect(
      clientAddress(fakeReq('::ffff:127.0.0.1', { 'x-forwarded-for': '2001:db8::1' }), t).ip,
    ).toBe('2001:db8::1');
    expect(() => parseTrustedProxy('pas-une-ip')).toThrow();
    expect(() => parseTrustedProxy('10.0.0.0/99')).toThrow();
    expect(parseTrustedProxy('')).toBeNull();
  });

  it('requête interne : réseau privé et aucun en-tête de proxy', () => {
    expect(isInternalRequest(fakeReq('127.0.0.1'))).toBe(true);
    expect(isInternalRequest(fakeReq('172.18.0.2'))).toBe(true);
    expect(isInternalRequest(fakeReq('172.18.0.2', { 'x-forwarded-for': '1.2.3.4' }))).toBe(false);
    expect(isInternalRequest(fakeReq('198.51.100.1'))).toBe(false);
  });

  it('tronque les adresses dans les journaux', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0');
    expect(truncateIp('2001:db8:1:2::3')).toBe('2001:db8:1::');
  });
});

describe('Origin', () => {
  const prod = loadConfig(
    { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://stickyclaude.sayk.fr' },
    '',
  );
  const bare = loadConfig({ NODE_ENV: 'production' }, '');

  it('production avec PUBLIC_ORIGIN : seule cette origine', () => {
    expect(originAllowed('https://stickyclaude.sayk.fr', prod)).toBe(true);
    expect(originAllowed('https://evil.example', prod, 'stickyclaude.sayk.fr')).toBe(false);
    expect(originAllowed('http://localhost:5173', prod)).toBe(false);
    expect(originAllowed(undefined, prod)).toBe(false);
  });

  it('production sans PUBLIC_ORIGIN : même site que l’en-tête Host', () => {
    expect(originAllowed('http://localhost:3000', bare, 'localhost:3000')).toBe(true);
    expect(originAllowed('https://evil.example', bare, 'localhost:3000')).toBe(false);
    expect(originAllowed('http://localhost:3000', bare)).toBe(false);
  });
});

describe('CSP', () => {
  it('stricte, sans unsafe-inline ni unsafe-eval pour les scripts', () => {
    const cfg = loadConfig(
      { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://stickyclaude.sayk.fr' },
      '',
    );
    const csp = contentSecurityPolicy(cfg, fakeReq('127.0.0.1'));
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self' wss://stickyclaude.sayk.fr");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp.match(/script-src[^;]*/)?.[0]).not.toContain('unsafe-inline');
  });

  it('refuse un en-tête Host qui injecterait une directive', () => {
    const cfg = loadConfig({ NODE_ENV: 'production' }, '');
    const csp = contentSecurityPolicy(cfg, fakeReq('127.0.0.1', { host: 'x; script-src *' }));
    expect(csp).not.toContain('script-src *');
  });
});

// --- Serveur réel -----------------------------------------------------------------------------

let dir = '';
let srv: RunningServer | null = null;

const JS = 'console.log("x");'.repeat(100);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), JS);
  writeFileSync(join(dir, 'assets', 'app-abc123.js.br'), brotliCompressSync(JS));
  writeFileSync(join(dir, 'assets', 'app-abc123.js.gz'), gzipSync(JS));
  mkdirSync(join(dir, 'audio'));
  writeFileSync(join(dir, 'audio', 'a.opus'), 'opus');
});

afterEach(async () => {
  await srv?.stop();
  srv = null;
  rmSync(dir, { recursive: true, force: true });
});

async function boot(env: Record<string, string> = {}): Promise<string> {
  const cfg = loadConfig({ NODE_ENV: 'production', PORT: '0', HOST: '127.0.0.1', ...env }, dir);
  srv = await startServer(cfg);
  return `http://127.0.0.1:${srv.port}`;
}

/** `fetch` ne laisse pas choisir Accept-Encoding ni décompresse sans le dire : requête brute. */
function get(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HTTP de production', () => {
  it('en-têtes de sécurité sur la page, cache no-cache', async () => {
    const base = await boot({ PUBLIC_ORIGIN: 'https://stickyclaude.sayk.fr' });
    const r = await get(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['permissions-policy']).toContain('gamepad=(self)');
    expect(r.headers['strict-transport-security']).toContain('max-age=');
  });

  it('assets hachés : immutable, brotli puis gzip selon Accept-Encoding, 304', async () => {
    const base = await boot();
    const url = `${base}/assets/app-abc123.js`;
    const br = await get(url, { 'accept-encoding': 'gzip, br' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(br.headers.vary).toBe('Accept-Encoding');
    expect(br.body.equals(brotliCompressSync(JS))).toBe(true);

    const gz = await get(url, { 'accept-encoding': 'gzip' });
    expect(gz.headers['content-encoding']).toBe('gzip');

    const raw = await get(url);
    expect(raw.headers['content-encoding']).toBeUndefined();
    expect(raw.body.toString()).toBe(JS);

    const again = await get(url, {
      'accept-encoding': 'br',
      'if-none-match': String(br.headers.etag),
    });
    expect(again.status).toBe(304);
  });

  it('fichiers non hachés : cache court ; les variantes .br/.gz ne sont pas exposées', async () => {
    const base = await boot();
    expect((await get(`${base}/audio/a.opus`)).headers['cache-control']).toBe(
      'public, max-age=3600',
    );
    expect((await get(`${base}/assets/app-abc123.js.br`)).status).toBe(404);
  });

  it('pas de traversée de répertoire, 404 propre, méthodes limitées', async () => {
    const base = await boot();
    expect((await get(`${base}/..%2f..%2fetc%2fpasswd`)).status).toBe(404);
    expect((await get(`${base}/%00`)).status).toBe(400);
    const r = await get(`${base}/inconnu`);
    expect(r.status).toBe(404);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('/metrics : interne seulement, ou avec le jeton', async () => {
    const base = await boot({ METRICS_TOKEN: 'secret' });
    expect((await get(`${base}/metrics`)).status).toBe(200); // loopback, sans proxy
    expect((await get(`${base}/metrics`, { 'x-forwarded-for': '203.0.113.1' })).status).toBe(404);
    expect(
      (
        await get(`${base}/metrics`, {
          'x-forwarded-for': '203.0.113.1',
          authorization: 'Bearer secret',
        })
      ).status,
    ).toBe(200);
  });

  it('WebSocket : Origin du même site accepté, autre site refusé', async () => {
    const base = await boot();
    const host = base.replace('http://', '');
    const open = (origin: string): Promise<'open' | number> =>
      new Promise((res) => {
        const ws = new WebSocket(`ws://${host}/ws`, { headers: { origin } });
        ws.once('open', () => {
          ws.close();
          res('open');
        });
        ws.once('unexpected-response', (_q, r) => res(r.statusCode ?? 0));
        ws.once('error', () => undefined);
      });
    expect(await open(`http://${host}`)).toBe('open');
    expect(await open('https://evil.example')).toBe(403);
  });
});

describe('arrêt propre', () => {
  const connect = (
    base: string,
  ): Promise<{ ws: WebSocket; msgs: string[]; closed: Promise<number> }> =>
    new Promise((resolve, reject) => {
      const host = base.replace('http://', '');
      const ws = new WebSocket(`ws://${host}/ws`, { headers: { origin: `http://${host}` } });
      const msgs: string[] = [];
      const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
      ws.on('message', (d: Buffer, bin: boolean) => {
        if (!bin) msgs.push(d.toString('utf8'));
      });
      ws.once('open', () => resolve({ ws, msgs, closed }));
      ws.once('error', reject);
    });

  it('annonce, refuse les nouveaux, ferme avec 1012 après le délai', async () => {
    const base = await boot();
    const c = await connect(base);
    const t0 = performance.now();
    const done = srv!.shutdown(600);
    // le temps d'envoyer l'annonce
    await new Promise((r) => setTimeout(r, 100));
    expect(c.msgs.map((m) => JSON.parse(m) as { t: string; inMs?: number })).toContainEqual({
      t: 'shutdown',
      inMs: 600,
    });
    // /healthz passe au rouge, un nouveau venu est refusé avec le même code
    const h = await get(`${base}/healthz`);
    expect(h.status).toBe(503);
    const late = await connect(base);
    expect(await late.closed).toBe(CLOSE_SERVICE_RESTART);

    expect(await c.closed).toBe(CLOSE_SERVICE_RESTART);
    await done;
    srv = null;
    const took = performance.now() - t0;
    expect(took).toBeGreaterThanOrEqual(550);
    expect(took).toBeLessThan(3000);
  });

  it('sort tout de suite quand plus personne n’est connecté', async () => {
    await boot();
    const t0 = performance.now();
    await srv!.shutdown(30_000);
    srv = null;
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it('sort dès que les joueurs sont partis, sans attendre la fin du délai', async () => {
    const base = await boot();
    const c = await connect(base);
    const t0 = performance.now();
    const done = srv!.shutdown(30_000);
    await new Promise((r) => setTimeout(r, 100));
    c.ws.close();
    await done;
    srv = null;
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
