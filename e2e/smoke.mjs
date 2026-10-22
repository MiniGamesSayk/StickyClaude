// Test de fumée (CI, après « docker run ») : le jeu construit se charge, deux clients entrent dans
// un salon, la partie démarre et dure quelques secondes, sans AUCUNE erreur ni avertissement dans
// la console (la CSP stricte, le WebSocket et le rendu sont donc exercés pour de vrai).
//
//   node e2e/smoke.mjs --url http://127.0.0.1:3000 [--chrome chemin] [--seconds 8]
//
// Le serveur visé doit tourner avec AUTOSTART_MS=0 (sinon la partie démarre toute seule),
// CREATE_PER_MIN, CODE_TRIES_PER_MIN et MAX_CONN_PER_IP assez hauts pour les enchaînements de CI.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
    }
    return acc;
  }, []),
);
const base = args.url ?? 'http://127.0.0.1:3000';
const seconds = Number(args.seconds ?? 8);
const chromePath =
  args.chrome ??
  process.env.CHROME ??
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);

const health = await fetch(`${base}/healthz`).then((r) => r.json());
assert.equal(health.ok, true, '/healthz doit répondre ok');

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];
const pages = [];

async function open(label) {
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      problems.push(`[${label}] ${m.type()}: ${m.text()} (${m.location().url})`);
    }
  });
  page.on('pageerror', (e) => problems.push(`[${label}] exception: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${label}] requête échouée : ${r.url()}`));
  pages.push(page);
  return page;
}

const ready = async (page) => {
  await page.waitForFunction(() => window.__stickyclaude?.renderer !== undefined, null, {
    timeout: 30000,
  });
  await page.evaluate(() => document.fonts.ready);
};

let failure = null;
try {
  const a = await open('A');
  const b = await open('B');
  const response = await a.goto(base);
  const csp = response.headers()['content-security-policy'] ?? '';
  assert.ok(csp.includes("default-src 'self'"), `CSP absente ou trop souple : ${csp}`);
  await ready(a);
  await a.getByLabel('Ton pseudo').fill('Alice');
  await a.getByRole('button', { name: 'Créer un salon' }).click();
  await a.locator('.panel .code').waitFor({ timeout: 20000 });
  const code = (await a.locator('.panel .code').innerText()).trim();
  assert.match(code, /^[A-Z0-9]{4,8}$/, `code de salon inattendu : ${code}`);

  await b.goto(`${base}/?salon=${code}`);
  await ready(b);
  await b.getByLabel('Ton pseudo').fill('Bob');
  await b.getByRole('button', { name: 'Rejoindre', exact: true }).click();
  await b.locator('.panel .code').waitFor({ timeout: 20000 });
  await a.getByText('Bob').first().waitFor({ timeout: 20000 });

  await b.getByRole('button', { name: 'Prêt', exact: true }).click();
  await a.getByText('Tout le monde est prêt').waitFor({ timeout: 20000 });
  await a.getByRole('button', { name: 'Lancer la partie' }).click();

  // la manche démarre : le HUD de partie apparaît chez les deux joueurs
  for (const p of [a, b]) {
    await p.waitForFunction(() => document.querySelector('.hud-top') !== null, null, {
      timeout: 30000,
    });
  }
  // quelques secondes de jeu avec des entrées
  await a.keyboard.down('ArrowRight');
  await b.keyboard.down('ArrowLeft');
  for (let i = 0; i < seconds; i++) {
    await a.keyboard.press('Space');
    await b.keyboard.press('KeyJ');
    await a.waitForTimeout(1000);
  }
  await a.keyboard.up('ArrowRight');
  await b.keyboard.up('ArrowLeft');

  const tick = await a.evaluate(() => window.__stickyclaude.source?.world?.tick ?? 0);
  assert.ok(tick > 0, 'la simulation locale doit avoir avancé');
  const after = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.ok(after.players >= 2, `le serveur doit voir 2 joueurs (${JSON.stringify(after)})`);
} catch (e) {
  failure = e;
  for (const [i, p] of pages.entries()) {
    await p.screenshot({ path: `smoke-echec-${i}.png` }).catch(() => undefined);
  }
}
await browser.close();

if (problems.length > 0) {
  console.error(`${problems.length} message(s) dans la console :`);
  for (const p of problems) console.error(`  ${p}`);
}
if (failure || problems.length > 0) {
  if (failure) console.error(`✘ smoke : ${failure instanceof Error ? failure.message : failure}`);
  process.exit(1);
}
console.log('✔ smoke : deux clients, une partie, aucune erreur dans la console');
