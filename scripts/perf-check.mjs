// Mesure de performance du client dans Chromium (analyse §2.8) : images par seconde en émulation
// mobile (CPU ralenti) et allocations de la boucle de rendu (profileur d'échantillonnage du tas).
//
//   npm run build && npm start                       (serveur sur :3000, client servi par le serveur)
//   node scripts/perf-check.mjs --cpu 4 --seconds 20 --size 851x393 --dpr 2.75
//
// Options : --url http://127.0.0.1:3000/?solo=1  --chrome chemin/vers/chrome  --cpu 4  --seconds 20
//           --warmup 7  --size 851x393  --dpr 2.75  --quality auto|low|medium|high  --json
//           --noheap (sans profileur de tas : fps non perturbés, pas de mesure d'allocations)
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
    }
    return acc;
  }, []),
);
const url = args.url ?? 'http://127.0.0.1:3000/?solo=1';
const cpu = Number(args.cpu ?? 4);
const seconds = Number(args.seconds ?? 20);
const warmup = Number(args.warmup ?? 7);
const [vw, vh] = (args.size ?? '851x393').split('x').map(Number);
const dpr = Number(args.dpr ?? 2.75);
const chrome =
  args.chrome ??
  process.env.CHROME ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : '/usr/bin/chromium');

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--enable-precise-memory-info',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const ctx = await browser.newContext({
  viewport: { width: vw, height: vh },
  deviceScaleFactor: dpr,
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await page.goto(url, { waitUntil: 'load' });
if (args.quality) {
  await page.evaluate((q) => {
    const o = JSON.parse(localStorage.getItem('stickyclaude.options') ?? '{}');
    o.quality = q;
    localStorage.setItem('stickyclaude.options', JSON.stringify(o));
  }, args.quality);
  await page.reload({ waitUntil: 'load' });
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
await page.waitForTimeout(1500);

// Enregistre les durées d'images dans la page (rAF), à partir de la fin de l'échauffement.
await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(warmup * 1000);
const level = await page.evaluate(() => window.__stickyclaude.renderer.stats.level);
await page.evaluate(() => {
  window.__frames.length = 0;
  // tas JS : on compte les baisses brusques (ramasse-miettes)
  window.__heap = { last: performance.memory.usedJSHeapSize, gcs: 0, dropBytes: 0, max: 0 };
  setInterval(() => {
    const h = window.__heap;
    const now = performance.memory.usedJSHeapSize;
    if (h.last - now > 200_000) {
      h.gcs++;
      h.dropBytes += h.last - now;
    }
    h.max = Math.max(h.max, now);
    h.last = now;
  }, 25);
});

const cpuProf = args.cpuprofile !== undefined;
if (cpuProf) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
}
const heapProf = args.noheap === undefined;
if (heapProf) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 256,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
}

// Jeu : on court, on saute, on frappe, on pare, pendant `seconds` secondes.
const t0 = Date.now();
const keys = ['ArrowRight', 'ArrowLeft'];
let k = 0;
while (Date.now() - t0 < seconds * 1000) {
  const dir = keys[k++ % 2];
  await page.keyboard.down(dir);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(250);
  await page.keyboard.up(dir);
}
const profile = heapProf
  ? (await cdp.send('HeapProfiler.stopSampling')).profile
  : { head: { children: [] } };
let cpuTop = [];
if (cpuProf) {
  const { profile: cp } = await cdp.send('Profiler.stop');
  const self = new Map();
  const total = cp.samples.length;
  const byId = new Map(cp.nodes.map((n) => [n.id, n]));
  for (const id of cp.samples) {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || '(anonyme)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + 1);
  }
  cpuTop = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([k, v]) => [k, +((v / total) * 100).toFixed(1)]);
}
const frames = await page.evaluate(() => window.__frames.slice());
const stats = await page.evaluate(() => ({ ...window.__stickyclaude.renderer.stats }));
const heap = await page.evaluate(() => window.__heap);

// Octets alloués par seconde, par fonction (les 8 plus gros), pour toute la durée mesurée.
const by = new Map();
let total = 0;
(function walk(n) {
  const self = n.selfSize ?? 0;
  if (self > 0) {
    const f = n.callFrame;
    const key = `${f.functionName || '(anonyme)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
    by.set(key, (by.get(key) ?? 0) + self);
    total += self;
  }
  for (const c of n.children ?? []) walk(c);
})(profile.head);
const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

const sorted = frames.slice().sort((a, b) => a - b);
const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
const worst = sorted[sorted.length - 1] ?? 0;
const result = {
  cpuSlowdown: cpu,
  viewport: `${vw}x${vh} @${dpr}`,
  qualityLevelAfterWarmup: level,
  frames: frames.length,
  fps: +(1000 / avg).toFixed(1),
  p95FrameMs: +p95.toFixed(1),
  worstFrameMs: +worst.toFixed(1),
  framesOver20ms: frames.filter((f) => f > 20).length,
  longFramesAt: (() => {
    let t = 0;
    const out = [];
    for (const f of frames) {
      t += f;
      if (f > 50) out.push(`${(t / 1000).toFixed(1)}s:${Math.round(f)}ms`);
    }
    return out;
  })(),
  allocatedKBPerSecond: +(total / 1024 / seconds).toFixed(1),
  allocatedBytesPerFrame: Math.round(total / Math.max(1, frames.length)),
  renderStats: stats,
  gcPerSecond: +(heap.gcs / seconds).toFixed(2),
  heapMaxMB: +(heap.max / 1048576).toFixed(1),
  consoleErrors: errors.length,
};
if (args.json) console.log(JSON.stringify(result));
else {
  console.log(result);
  console.log('Allocations par fonction (Ko sur la durée mesurée) :');
  for (const [name, bytes] of top)
    console.log(`  ${(bytes / 1024).toFixed(1).padStart(8)}  ${name}`);
  if (cpuTop.length > 0) {
    console.log('Temps CPU par fonction (% des échantillons) :');
    for (const [name, pct] of cpuTop) console.log(`  ${String(pct).padStart(5)} %  ${name}`);
  }
  if (errors.length > 0) console.log('Erreurs :', errors.slice(0, 5));
}
await browser.close();
