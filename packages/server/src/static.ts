import { createReadStream, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';

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
  '.opus': 'audio/ogg; codecs=opus',
  '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Extensions qui valent la peine d'être compressées (les autres le sont déjà). */
export const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.ico',
]);

interface Variant {
  path: string;
  size: number;
}

interface Entry {
  path: string;
  size: number;
  etag: string;
  type: string;
  /** Fichier au nom haché (`/assets/`) : ne change jamais, donc cache `immutable`. */
  immutable: boolean;
  isIndex: boolean;
  br?: Variant;
  gz?: Variant;
}

/**
 * Fichiers statiques du client construit. L'index est établi au démarrage (aucun accès au disque
 * pour résoudre un chemin, donc pas de traversée de répertoire possible) ; les variantes
 * précompressées `fichier.br` et `fichier.gz` (voir `scripts/precompress.mjs`) sont servies selon
 * `Accept-Encoding`. Hors production, l'index est relu quand un fichier manque (client reconstruit).
 */
export class StaticSite {
  private entries = new Map<string, Entry>();
  private lastScan = 0;

  constructor(
    private readonly root: string,
    private readonly rescan: boolean,
  ) {
    this.scan();
  }

  get size(): number {
    return this.entries.size;
  }

  private scan(): void {
    const files = new Map<string, number>();
    const walk = (dir: string, prefix: string): void => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, `${prefix}${name}/`);
        else files.set(`${prefix}${name}`, st.size);
      }
    };
    walk(this.root, '/');
    const next = new Map<string, Entry>();
    for (const [url, size] of files) {
      if (url.endsWith('.br') || url.endsWith('.gz')) {
        if (files.has(url.slice(0, -3))) continue;
      }
      const path = join(this.root, ...url.split('/').filter(Boolean));
      const mtime = statSync(path).mtimeMs;
      const e: Entry = {
        path,
        size,
        etag: `"${size.toString(16)}-${Math.floor(mtime).toString(16)}"`,
        type: MIME[extname(url).toLowerCase()] ?? 'application/octet-stream',
        immutable: url.startsWith('/assets/'),
        isIndex: url === '/index.html',
      };
      const br = files.get(`${url}.br`);
      const gz = files.get(`${url}.gz`);
      if (br !== undefined) e.br = { path: `${path}.br`, size: br };
      if (gz !== undefined) e.gz = { path: `${path}.gz`, size: gz };
      next.set(url, e);
    }
    this.entries = next;
    this.lastScan = Date.now();
  }

  private find(pathname: string): Entry | undefined {
    const url = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    let e = this.entries.get(url);
    if (!e && this.rescan && Date.now() - this.lastScan > 1000) {
      this.scan();
      e = this.entries.get(url);
    }
    return e;
  }

  /** Sert le fichier (GET ou HEAD) ; retourne faux s'il n'existe pas. */
  serve(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    headers: (isDocument: boolean) => Record<string, string>,
  ): boolean {
    let url: string;
    try {
      url = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400).end();
      return true;
    }
    if (url.includes('\0')) {
      res.writeHead(400).end();
      return true;
    }
    const e = this.find(url);
    if (!e) return false;

    const accept = String(req.headers['accept-encoding'] ?? '');
    let variant: Variant | undefined;
    let encoding: string | undefined;
    if (e.br && /\bbr\b/.test(accept)) {
      variant = e.br;
      encoding = 'br';
    } else if (e.gz && /\bgzip\b/.test(accept)) {
      variant = e.gz;
      encoding = 'gzip';
    }
    const etag = encoding ? e.etag.slice(0, -1) + `-${encoding}"` : e.etag;
    const h: Record<string, string | number> = {
      ...headers(e.isIndex),
      'Content-Type': e.type,
      ETag: etag,
      'Cache-Control': e.immutable
        ? 'public, max-age=31536000, immutable'
        : e.isIndex
          ? 'no-cache'
          : 'public, max-age=3600',
    };
    if (e.br || e.gz) h.Vary = 'Accept-Encoding';
    if (encoding) h['Content-Encoding'] = encoding;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, h).end();
      return true;
    }
    h['Content-Length'] = variant ? variant.size : e.size;
    res.writeHead(200, h);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = createReadStream(variant ? variant.path : e.path);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  }
}
