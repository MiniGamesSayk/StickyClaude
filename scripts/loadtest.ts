// Test de charge : de faux clients (entrées réalistes à 60 Hz) contre un serveur construit.
//
//   npm run loadtest -- --rooms 25 --players 8 --duration 120
//
// Par défaut le script construit puis lance `packages/server/dist/index.js` (en production, avec
// --max-old-space-size=320, épinglé sur 1 cœur si `taskset` existe). Avec `--url ws://hôte:port/ws`
// (et `--metrics http://hôte:port`) il vise un serveur déjà lancé, par exemple dans Docker.
//
// Il compare les mesures aux budgets de l'analyse (§2.8) et sort avec le code 1 si l'un est dépassé.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { createServer } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { resolve } from 'node:path';
import {
  BinType,
  createSnapshot,
  decodeSnapshot,
  encodeInput,
  encodePing,
  Input,
  PROTOCOL_VERSION,
  Rng,
  TICK_MS,
} from '@stickyclaude/shared';
import type { ServerMessage, Snapshot } from '@stickyclaude/shared';
import WebSocket from 'ws';

const argv = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const ROOMS = Number(opt('rooms', '25'));
const PLAYERS = Number(opt('players', '8'));
const DURATION = Number(opt('duration', '120'));
const WARMUP = Number(opt('warmup', '5'));
const EXTERNAL_URL = opt('url', '');
const ORIGIN = 'http://loadtest.local';
const LEAD = 4;

const root = resolve(import.meta.dirname, '..');

// --- Budgets (analyse §2.8) --------------------------------------------------------------------
const BUDGET = {
  roomStepP99Ms: 0.5,
  roomStepP50Ms: 0.15,
  cpuPct: 60,
  heapMB: 250,
  loopP99Ms: 10,
  downKBsPerClient: 20,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });
}

interface Started {
  baseHttp: string;
  wsUrl: string;
  child: ChildProcess | null;
}

async function startServer(): Promise<Started> {
  if (EXTERNAL_URL) {
    const http = opt('metrics', EXTERNAL_URL.replace(/^ws/, 'http').replace(/\/ws$/, ''));
    return { baseHttp: http, wsUrl: EXTERNAL_URL, child: null };
  }
  const dist = resolve(root, 'packages/server/dist/index.js');
  if (flag('build') || !existsSync(dist)) {
    console.log('construction du serveur…');
    const r = spawnSync('npm', ['run', 'build', '-w', '@stickyclaude/server'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error('build du serveur échoué');
  }
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    PUBLIC_ORIGIN: ORIGIN,
    MAX_ROOMS: String(ROOMS + 5),
    MAX_CONNECTIONS: String(ROOMS * PLAYERS + 50),
    MAX_CONN_PER_IP: String(ROOMS * PLAYERS + 50),
    CREATE_PER_MIN: '100000',
    CODE_TRIES_PER_MIN: '100000',
  };
  const node = ['--max-old-space-size=320', dist];
  const pin = opt('cpu', String(Math.max(0, cpus().length - 1)));
  const hasTaskset = spawnSync('which', ['taskset']).status === 0 && !flag('no-pin');
  const cmd = hasTaskset ? 'taskset' : process.execPath;
  const args = hasTaskset ? ['-c', pin, process.execPath, ...node] : node;
  const child = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(
    `serveur lancé (pid ${child.pid}, port ${port}${hasTaskset ? `, cœur ${pin}` : ', non épinglé'})`,
  );
  const baseHttp = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${baseHttp}/healthz`);
      if (r.ok) return { baseHttp, wsUrl: `ws://127.0.0.1:${port}/ws`, child };
    } catch {
      /* pas encore prêt */
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('le serveur ne répond pas');
}

// --- Faux client -------------------------------------------------------------------------------

class FakeClient {
  ws!: WebSocket;
  joined = false;
  code = '';
  slot = -1;
  lastSnap: Snapshot | null = null;
  snapshots = 0;
  bytesIn = 0;
  lateSignals = 0;
  marginSum = 0;
  marginCount = 0;
  label = 0;
  private readonly snap = createSnapshot();
  private readonly buf = new Uint8Array(32);
  private readonly rng: Rng;
  private mask = 0;
  private hold = 0;
  private pings = 0;
  measuring = false;

  constructor(
    readonly id: number,
    private readonly url: string,
    private readonly onError: (e: Error) => void,
  ) {
    this.rng = new Rng(1000 + id);
  }

  connect(first: (c: FakeClient) => void): Promise<void> {
    return new Promise((resolveOpen, rejectOpen) => {
      this.ws = new WebSocket(this.url, { headers: { Origin: ORIGIN }, perMessageDeflate: false });
      this.ws.binaryType = 'nodebuffer';
      this.ws.on('open', () => {
        first(this);
        resolveOpen();
      });
      this.ws.on('error', (e) => {
        this.onError(e);
        rejectOpen(e);
      });
      this.ws.on('message', (data: Buffer, isBinary: boolean) => this.onMessage(data, isBinary));
    });
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (this.measuring) this.bytesIn += data.length;
    if (!isBinary) {
      const m = JSON.parse(data.toString('utf8')) as ServerMessage;
      if (m.t === 'joined') {
        this.joined = true;
        this.code = m.code;
        this.slot = m.slot;
        this.label = m.tick + LEAD;
      } else if (m.t === 'error') {
        this.onError(new Error(`erreur serveur : ${m.code}`));
      }
      return;
    }
    if (data[0] === BinType.SNAPSHOT) {
      decodeSnapshot(data, this.snap);
      this.snapshots++;
      this.lastSnap = this.snap;
      if (this.measuring && this.snap.margin < 100) {
        this.marginSum += this.snap.margin;
        this.marginCount++;
        if (this.snap.margin < 0) this.lateSignals++;
      }
      // Garde l'avance visée sur le tick serveur reçu (sans prédiction : on ne simule pas).
      const target = this.snap.tick + LEAD;
      if (this.label < target - 1) this.label = target;
    }
  }

  sendJson(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  /** Une entrée par tick, comme un vrai client ; ping toutes les 2 s environ. */
  tick(): void {
    if (!this.joined || this.ws.readyState !== WebSocket.OPEN) return;
    if (--this.hold <= 0) {
      this.hold = 3 + this.rng.int(50);
      const r = this.rng.float();
      let m = 0;
      if (r < 0.4) m |= Input.RIGHT;
      else if (r < 0.8) m |= Input.LEFT;
      if (this.rng.float() < 0.35) m |= Input.JUMP;
      if (this.rng.float() < 0.1) m |= Input.DOWN;
      this.mask = m;
    }
    this.label++;
    const masks = [this.mask, this.mask, this.mask, this.mask];
    const n = encodeInput(this.buf, this.label, 0, 25, masks, 4);
    this.ws.send(this.buf.slice(0, n));
    if (++this.pings % 120 === 0) {
      const p = encodePing(this.buf, Math.floor(performance.now()));
      this.ws.send(this.buf.slice(0, p));
    }
  }
}

// --- Mesures serveur ---------------------------------------------------------------------------

interface ServerMetrics {
  rooms: number;
  players: number;
  tickMs: { p50: number; p99: number; max: number };
  roomStepMs: { p50: number; p99: number; max: number };
  heapUsedMB: number;
  rssMB: number;
  eventLoopDelayMs: { p50: number; p99: number; max: number };
  cpuUserUs: number;
  cpuSystemUs: number;
  bytesOut: number;
  snapshotsSent: number;
  snapshotsSkipped: number;
  inputsLate: number;
  inputsMissed: number;
  inputPackets: number;
  tickOverruns: number;
  invalidMessages: number;
}

async function metrics(base: string, reset = false): Promise<ServerMetrics> {
  const r = await fetch(`${base}/metrics${reset ? '?reset=1' : ''}`);
  if (!r.ok) throw new Error(`/metrics: HTTP ${r.status}`);
  return (await r.json()) as ServerMetrics;
}

// --- Travailleurs (générateur de charge réparti sur plusieurs threads) ---------------------------

interface WorkerData {
  wsUrl: string;
  roomOffset: number;
  rooms: number;
  players: number;
}

interface WorkerStats {
  clients: number;
  bytesIn: number;
  snapshots: number;
  marginSum: number;
  marginCount: number;
  lateSignals: number;
  loopLagP99Ms: number;
  errors: string[];
}

/** Dans un thread : héberge `rooms` salons de faux clients et pilote leurs entrées à 60 Hz. */
async function runWorker(d: WorkerData): Promise<void> {
  const port = parentPort!;
  const errors: string[] = [];
  const onError = (e: Error): void => {
    if (errors.length < 5) errors.push(e.message);
  };
  const clients: FakeClient[] = [];
  for (let r = 0; r < d.rooms; r++) {
    const room = d.roomOffset + r;
    const first = new FakeClient(room * d.players, d.wsUrl, onError);
    clients.push(first);
    await first.connect((c) =>
      c.sendJson({
        t: 'create',
        v: PROTOCOL_VERSION,
        name: `Bot${c.id}`,
        arena: room % 2 === 0 ? 'test-flat' : 'test-tower',
      }),
    );
    for (let t = 0; t < 400 && !first.joined; t++) await sleep(10);
    if (!first.joined) throw new Error('salon non créé');
    const rest: Promise<void>[] = [];
    for (let p = 1; p < d.players; p++) {
      const c = new FakeClient(room * d.players + p, d.wsUrl, onError);
      clients.push(c);
      rest.push(
        c.connect((x) =>
          x.sendJson({ t: 'join', v: PROTOCOL_VERSION, name: `Bot${x.id}`, code: first.code }),
        ),
      );
    }
    await Promise.all(rest);
  }
  for (let t = 0; t < 500 && clients.some((c) => !c.joined); t++) await sleep(20);
  if (clients.some((c) => !c.joined)) throw new Error(`clients non joints (${errors.join('; ')})`);

  const loopLag = monitorEventLoopDelay({ resolution: 10 });
  loopLag.enable();
  let next = performance.now() + TICK_MS;
  let stop = false;
  const pump = (): void => {
    if (stop) return;
    const now = performance.now();
    let n = 0;
    while (now >= next && n < 4) {
      for (const c of clients) c.tick();
      next += TICK_MS;
      n++;
    }
    if (now >= next) next = now + TICK_MS;
    setTimeout(pump, Math.max(0, Math.floor(next - performance.now())));
  };
  pump();
  port.postMessage({ type: 'ready', clients: clients.length });

  port.on('message', (m: { type: 'measure' | 'stop' }) => {
    if (m.type === 'measure') {
      loopLag.reset();
      for (const c of clients) {
        c.measuring = true;
        c.bytesIn = 0;
        c.snapshots = 0;
        c.marginSum = 0;
        c.marginCount = 0;
        c.lateSignals = 0;
      }
    } else {
      stop = true;
      loopLag.disable();
      const stats: WorkerStats = {
        clients: clients.length,
        bytesIn: clients.reduce((s, c) => s + c.bytesIn, 0),
        snapshots: clients.reduce((s, c) => s + c.snapshots, 0),
        marginSum: clients.reduce((s, c) => s + c.marginSum, 0),
        marginCount: clients.reduce((s, c) => s + c.marginCount, 0),
        lateSignals: clients.reduce((s, c) => s + c.lateSignals, 0),
        loopLagP99Ms: Math.max(0, loopLag.percentile(99) / 1e6 - 10),
        errors,
      };
      for (const c of clients) c.ws.terminate();
      port.postMessage({ type: 'stats', stats });
    }
  });
}

// --- Programme ---------------------------------------------------------------------------------

async function main(): Promise<void> {
  const workersCount = Math.max(1, Math.min(Number(opt('workers', '4')), ROOMS));
  console.log(
    `test de charge : ${ROOMS} salons × ${PLAYERS} joueurs = ${ROOMS * PLAYERS} clients, ${DURATION} s (+ ${WARMUP} s de chauffe), ${workersCount} threads générateurs`,
  );
  const srv = await startServer();
  const workers: Worker[] = [];
  let ok: boolean;
  try {
    // Répartit les salons sur les threads.
    let offset = 0;
    const ready: Promise<number>[] = [];
    for (let w = 0; w < workersCount; w++) {
      const rooms = Math.floor(ROOMS / workersCount) + (w < ROOMS % workersCount ? 1 : 0);
      const data: WorkerData = { wsUrl: srv.wsUrl, roomOffset: offset, rooms, players: PLAYERS };
      offset += rooms;
      const worker = new Worker(new URL(import.meta.url), { workerData: data });
      workers.push(worker);
      ready.push(
        new Promise((res, rej) => {
          worker.once('error', rej);
          worker.on('message', (m: { type: string; clients?: number }) => {
            if (m.type === 'ready') res(m.clients ?? 0);
          });
        }),
      );
    }
    const total = (await Promise.all(ready)).reduce((a, b) => a + b, 0);
    console.log(`${total} clients connectés`);

    await sleep(WARMUP * 1000);
    const m0 = await metrics(srv.baseHttp, true);
    for (const w of workers) w.postMessage({ type: 'measure' });
    const t0 = performance.now();
    const polls: ServerMetrics[] = [];
    const end = t0 + DURATION * 1000;
    let lastPrint = t0;
    while (performance.now() < end) {
      await sleep(2000);
      const m = await metrics(srv.baseHttp);
      polls.push(m);
      if (performance.now() - lastPrint >= 10_000) {
        lastPrint = performance.now();
        console.log(
          `  t+${Math.round((lastPrint - t0) / 1000)}s : pas salle p99 ${m.roomStepMs.p99} ms · tick p99 ${m.tickMs.p99} ms · tas ${m.heapUsedMB} Mo · boucle p99 ${m.eventLoopDelayMs.p99} ms`,
        );
      }
    }
    const m1 = await metrics(srv.baseHttp);
    const elapsed = (performance.now() - t0) / 1000;
    const stats = await Promise.all(
      workers.map(
        (w) =>
          new Promise<WorkerStats>((res) => {
            w.on('message', (m: { type: string; stats?: WorkerStats }) => {
              if (m.type === 'stats' && m.stats) res(m.stats);
            });
            w.postMessage({ type: 'stop' });
          }),
      ),
    );
    const nClients = stats.reduce((s, x) => s + x.clients, 0);
    const errors = stats.flatMap((x) => x.errors);

    // --- Rapport ---
    const cpuPct =
      ((m1.cpuUserUs + m1.cpuSystemUs - m0.cpuUserUs - m0.cpuSystemUs) / 1e6 / elapsed) * 100;
    const worst = <K extends 'roomStepMs' | 'tickMs'>(k: K, f: 'p50' | 'p99' | 'max'): number =>
      Math.max(...polls.map((p) => p[k][f]));
    const roomP50 =
      polls.map((p) => p.roomStepMs.p50).sort((a, b) => a - b)[Math.floor(polls.length / 2)] ?? 0;
    const tickP50 =
      polls.map((p) => p.tickMs.p50).sort((a, b) => a - b)[Math.floor(polls.length / 2)] ?? 0;
    const heapMax = Math.max(...polls.map((p) => p.heapUsedMB));
    const rssMax = Math.max(...polls.map((p) => p.rssMB));
    const loopP99 = m1.eventLoopDelayMs.p99;
    const downKBs = stats.reduce((s, x) => s + x.bytesIn, 0) / nClients / elapsed / 1024;
    const snapRate = stats.reduce((s, x) => s + x.snapshots, 0) / nClients / elapsed;
    const margin =
      stats.reduce((s, x) => s + x.marginSum, 0) /
      Math.max(
        1,
        stats.reduce((s, x) => s + x.marginCount, 0),
      );
    const sent = Math.max(1, m1.inputPackets);
    const genLag = Math.max(...stats.map((x) => x.loopLagP99Ms));

    const rows: [string, string, string, boolean][] = [
      [
        'pas de simulation d’une salle (p50)',
        `${roomP50.toFixed(3)} ms`,
        `< ${BUDGET.roomStepP50Ms} ms`,
        roomP50 < BUDGET.roomStepP50Ms,
      ],
      [
        'pas de simulation d’une salle (p99, pire)',
        `${worst('roomStepMs', 'p99').toFixed(3)} ms`,
        `< ${BUDGET.roomStepP99Ms} ms`,
        worst('roomStepMs', 'p99') < BUDGET.roomStepP99Ms,
      ],
      [
        'tick complet, toutes salles (p50 / p99)',
        `${tickP50.toFixed(3)} / ${worst('tickMs', 'p99').toFixed(3)} ms`,
        '—',
        true,
      ],
      [
        'CPU du serveur (1 cœur)',
        `${cpuPct.toFixed(1)} %`,
        `< ${BUDGET.cpuPct} %`,
        cpuPct < BUDGET.cpuPct,
      ],
      [
        'tas JS (max)',
        `${heapMax.toFixed(0)} Mo (RSS ${rssMax.toFixed(0)} Mo)`,
        `< ${BUDGET.heapMB} Mo`,
        heapMax < BUDGET.heapMB,
      ],
      [
        'retard de boucle d’événements (p99)',
        `${loopP99.toFixed(2)} ms`,
        `< ${BUDGET.loopP99Ms} ms`,
        loopP99 < BUDGET.loopP99Ms,
      ],
      [
        'débit descendant par client',
        `${downKBs.toFixed(1)} Ko/s (${snapRate.toFixed(0)} snapshots/s)`,
        `< ${BUDGET.downKBsPerClient} Ko/s`,
        downKBs < BUDGET.downKBsPerClient,
      ],
      ['dépassements de la boucle de ticks', String(m1.tickOverruns), '0', m1.tickOverruns === 0],
      [
        'snapshots sautés (contre-pression)',
        String(m1.snapshotsSkipped),
        '0',
        m1.snapshotsSkipped === 0,
      ],
      [
        'entrées en retard / manquantes',
        `${((m1.inputsLate / sent) * 100).toFixed(2)} % / ${m1.inputsMissed}`,
        '—',
        true,
      ],
      ['messages invalides', String(m1.invalidMessages), '0', m1.invalidMessages === 0],
    ];
    console.log(
      `\nSalons ${m1.rooms}, joueurs ${m1.players}, marge d'entrée moyenne ${margin.toFixed(1)} ticks`,
    );
    console.log('─'.repeat(100));
    for (const [name, value, budget, pass] of rows) {
      console.log(`${pass ? '✓' : '✗'} ${name.padEnd(46)} ${value.padEnd(34)} ${budget}`);
    }
    console.log('─'.repeat(100));
    console.log(
      `retard de boucle des threads générateurs (p99, pire) : ${genLag.toFixed(2)} ms ${genLag > 10 ? '⚠ le générateur sature, mesures peu fiables' : ''}`,
    );
    if (errors.length > 0) console.log(`erreurs client : ${errors.join('; ')}`);
    ok = rows.every((r) => r[3]) && errors.length === 0;
    console.log(ok ? '\n✓ budgets tenus' : '\n✗ budgets dépassés');
  } finally {
    for (const w of workers) void w.terminate();
    srv.child?.kill('SIGTERM');
  }
  process.exit(ok ? 0 : 1);
}

if (isMainThread) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
} else {
  runWorker(workerData as WorkerData).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
