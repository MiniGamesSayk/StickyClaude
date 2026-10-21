// Contrôle en vrai navigateur (Chromium) : N onglets dans le même salon, réseau dégradé, entrées
// aléatoires. Mesure ce que le joueur voit : sauts d'affichage, corrections, latence.
//
//   npm run build && npm start        (serveur sur :3000, client servi par le serveur)
//   node scripts/browser-check.mjs --clients 8 --lag 150 --jitter 30 --loss 2 --seconds 30
//
// Options : --url http://127.0.0.1:3000  --chrome /usr/bin/chromium  --shots dossier  --size 320x180
//
// Le rendu est logiciel (SwiftShader) : on garde de petits viewports et on mesure des vitesses
// d'affichage (unités/s), indépendantes de la cadence réelle des images.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--'))
      acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
    return acc;
  }, []),
);
const url = args.url ?? 'http://127.0.0.1:3000';
const clients = Number(args.clients ?? 8);
const lag = Number(args.lag ?? 150);
const jitter = Number(args.jitter ?? 30);
const loss = Number(args.loss ?? 2);
const seconds = Number(args.seconds ?? 30);
const arena = args.arena ?? 'test-tower';
const shots = args.shots;
const [vw, vh] = (args.size ?? '320x180').split('x').map(Number);
/** Au-delà de cette vitesse d'affichage (u/s), on parle de téléportation (la chute max est de 820). */
const TELEPORT_SPEED = 1500;

const browser = await chromium.launch({
  executablePath:
    args.chrome ??
    process.env.CHROME ??
    (process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : '/usr/bin/chromium'),
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

/** Dans la page : échantillonne à chaque image ce qui est affiché. */
function installSampler() {
  const s = {
    frames: 0,
    ownMax: 0,
    remoteMax: 0,
    big: 0,
    errors: [],
    own: null,
    remote: {},
    steps: [],
    last: 0,
  };
  window.__samples = s;
  window.addEventListener('error', (e) => s.errors.push(String(e.message)));
  const tick = () => {
    const c = window.__stickyclaude?.client;
    if (c && c.state === 'joined') {
      const v = c.view;
      const now = performance.now();
      const dt = s.last ? Math.max(1, now - s.last) : 0;
      s.last = now;
      s.frames++;
      if (v.own.visible) {
        if (s.own && dt) {
          const sp = (Math.hypot(v.own.x - s.own[0], v.own.y - s.own[1]) / dt) * 1000;
          s.ownMax = Math.max(s.ownMax, sp);
          s.steps.push(sp);
          if (sp > window.__teleportSpeed) s.big++;
        }
        s.own = [v.own.x, v.own.y];
      }
      for (let i = 0; i < v.remoteCount; i++) {
        const r = v.remotes[i];
        const last = s.remote[r.slot];
        if (last && dt) {
          const sp = (Math.hypot(r.x - last[0], r.y - last[1]) / dt) * 1000;
          s.remoteMax = Math.max(s.remoteMax, sp);
          if (sp > window.__teleportSpeed) s.big++;
        }
        s.remote[r.slot] = [r.x, r.y];
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const net = `lag=${lag}&jitter=${jitter}&loss=${loss}`;
const pages = [];
const consoleErrors = [];
for (let i = 0; i < clients; i++) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[P${i}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[P${i}] ${e.message}`));
  const code = pages[0] ? await pages[0].evaluate(() => window.__stickyclaude.client.code) : null;
  const q = `${net}&debug=1&auto=1&name=Joueur${i + 1}&arena=${arena}${code ? `&salon=${code}` : ''}`;
  await page.goto(`${url}/?${q}`);
  await page.waitForFunction(() => window.__stickyclaude?.client?.state === 'joined', null, {
    timeout: 15000,
  });
  await page.evaluate((v) => {
    window.__teleportSpeed = v;
  }, TELEPORT_SPEED);
  await page.evaluate(installSampler);
  pages.push(page);
}
console.log(
  `salon ${await pages[0].evaluate(() => window.__stickyclaude.client.code)} : ${clients} clients (${net})`,
);

// Pilotes d'entrées : appuis tenus pendant 100 à 800 ms.
const keys = ['KeyA', 'KeyD', 'Space', 'KeyS'];
const stops = [];
for (const page of pages) {
  let stopped = false;
  stops.push(() => (stopped = true));
  (async () => {
    const held = new Set();
    while (!stopped) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      if (held.has(k)) {
        await page.keyboard.up(k);
        held.delete(k);
      } else {
        await page.keyboard.down(k);
        held.add(k);
      }
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 700));
    }
    for (const k of held) await page.keyboard.up(k).catch(() => {});
  })().catch(() => {});
}

await new Promise((r) => setTimeout(r, 8000)); // laisse l'avance et l'interpolation se stabiliser
for (const page of pages) {
  await page.evaluate(() => {
    const s = window.__samples;
    s.frames = 0;
    s.ownMax = 0;
    s.remoteMax = 0;
    s.big = 0;
    s.own = null;
    s.remote = {};
    s.steps = [];
    s.last = 0;
    s.c0 = window.__stickyclaude.client.stats.corrections;
  });
}
if (shots) {
  mkdirSync(shots, { recursive: true });
}
const half = Math.floor((seconds * 1000) / 2);
await new Promise((r) => setTimeout(r, half));
if (shots) await pages[0].screenshot({ path: join(shots, 'jeu-8-onglets.png') });
await new Promise((r) => setTimeout(r, seconds * 1000 - half));
for (const stop of stops) stop();

const rows = [];
for (const [i, page] of pages.entries()) {
  const r = await page.evaluate(() => {
    const s = window.__samples;
    const c = window.__stickyclaude.client;
    const steps = s.steps.slice().sort((a, b) => a - b);
    return {
      fps: s.frames,
      ownMax: s.ownMax,
      ownP99: steps[Math.floor(steps.length * 0.99)] ?? 0,
      remoteMax: s.remoteMax,
      big: s.big,
      corrections: c.stats.corrections - s.c0,
      resyncs: c.stats.resyncs,
      rtt: c.stats.rttMs,
      lead: c.stats.leadTicks,
      interp: c.stats.interpMs,
      remotes: c.view.remoteCount,
      errors: s.errors.length,
    };
  });
  rows.push(r);
  console.log(
    `P${i + 1}: ${(r.fps / seconds).toFixed(0)}img/s rtt=${r.rtt.toFixed(0)}ms avance=${r.lead.toFixed(1)}t interp=${r.interp.toFixed(0)}ms ` +
      `vitMax(soi)=${r.ownMax.toFixed(0)} p99=${r.ownP99.toFixed(0)} vitMax(autres)=${r.remoteMax.toFixed(0)}u/s ` +
      `téléportations=${r.big} corrections=${r.corrections} resync=${r.resyncs} vus=${r.remotes}`,
  );
}
const health = await (await fetch(`${url}/healthz`)).json();
console.log('healthz', JSON.stringify(health));
console.log(
  consoleErrors.length === 0
    ? 'console : aucune erreur'
    : `console : ${consoleErrors.length} erreur(s)\n${consoleErrors.slice(0, 10).join('\n')}`,
);
await browser.close();

const bad = rows.filter((r) => r.big > 0 || r.remotes !== clients - 1 || r.errors > 0);
process.exit(bad.length === 0 && consoleErrors.length === 0 ? 0 : 1);
