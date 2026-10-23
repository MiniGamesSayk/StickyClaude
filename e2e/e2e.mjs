// Tests de bout en bout dans Chromium (Playwright) : le vrai serveur, le vrai client construit.
//
//   npm run build && npm run e2e
//
// Le script lance lui-même le serveur (port libre), puis :
//   1. parcourt les écrans de l'accueil (personnalisation, options, aide, anglais) ;
//   2. fait un tour d'entraînement solo, au clavier puis à la manette (simulée) ;
//   3. joue une partie complète à 2 onglets (salon, prêt, décompte, combat, podium) ;
//   4. rejoue l'entraînement en émulation mobile, aux contrôles tactiles ;
//   5. simule une maintenance puis coupe le serveur (écrans de connexion) ;
//   6. échoue s'il y a la moindre erreur dans la console d'un onglet.
// Chaque écran est capturé dans docs/screenshots/.
//
// Options : --url http://127.0.0.1:3000 (serveur déjà lancé)  --chrome chemin/vers/chrome
//           --shots dossier  --headed  --sheet (capture aussi la fiche de style, via Vite)
//           --only motif (n'exécute que les étapes dont le nom contient ce motif)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
    }
    return acc;
  }, []),
);
const shotsDir = resolve(root, args.shots ?? 'docs/screenshots');
mkdirSync(shotsDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const log = (msg) => console.log(msg);

async function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

// --- Serveur ---------------------------------------------------------------------------------------

let server = null;
let base = args.url;
if (!base) {
  const dist = join(root, 'packages/server/dist/index.js');
  assert.ok(
    existsSync(dist),
    'packages/server/dist/index.js manquant : lance « npm run build » d’abord.',
  );
  const port = await freePort();
  server = spawn(process.execPath, [dist], {
    cwd: root,
    env: {
      ...process.env,
      // comme en production : en-têtes de sécurité, CSP stricte et vérification de l'Origin
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      // pas de limites de débit pour les tests, pas de lancement automatique de la partie
      CREATE_PER_MIN: '1000',
      CODE_TRIES_PER_MIN: '1000',
      MAX_CONN_PER_IP: '50',
      AUTOSTART_MS: '0',
      MATCH_END_MS: '15000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[serveur] ${d}`));
  base = `http://127.0.0.1:${port}`;
}
for (let i = 0; ; i++) {
  try {
    const r = await fetch(`${base}/healthz`);
    if (r.ok) break;
  } catch {
    /* pas encore prêt */
  }
  assert.ok(i < 100, 'le serveur ne répond pas');
  await sleep(100);
}
log(`serveur : ${base}`);

// --- Navigateur ------------------------------------------------------------------------------------

const chromePath =
  args.chrome ??
  process.env.CHROME ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : '/usr/bin/chromium');
const browser = await chromium.launch({
  executablePath: existsSync(chromePath) ? chromePath : undefined,
  headless: args.headed === undefined,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

const consoleErrors = [];
const openPages = new Map();
let expectingDisconnect = false;

async function open(label, opts = {}) {
  const ctx = await browser.newContext({ locale: 'fr-FR', ...opts });
  const page = await ctx.newPage();
  openPages.set(label, page);
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Après la coupure volontaire du serveur, les échecs de reconnexion sont normaux.
    if (expectingDisconnect && /WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) {
      return;
    }
    consoleErrors.push(`[${label}] ${m.type()}: ${m.text()} (${m.location().url})`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] exception: ${e.message}`));
  return { ctx, page };
}

async function shot(page, name) {
  await page.screenshot({ path: join(shotsDir, `${name}.jpg`), type: 'jpeg', quality: 88 });
  log(`  capture : ${name}.jpg`);
}

async function step(name, fn) {
  if (args.only && !new RegExp(args.only, 'i').test(name)) return;
  const t0 = Date.now();
  try {
    await fn();
    log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failures.push(`${name} : ${e instanceof Error ? e.message : String(e)}`);
    for (const [label, page] of openPages) {
      const path = join(tmpdir(), `e2e-echec-${label}.png`);
      await page.screenshot({ path }).then(
        () => log(`  diagnostic : ${path}`),
        () => undefined,
      );
    }
    log(`✘ ${name} : ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Attend que le jeu soit chargé (polices, rendu) et laisse l'aperçu s'animer un instant. */
async function ready(page, settleMs = 1200) {
  await page.waitForFunction(() => window.__stickyclaude?.renderer !== undefined, null, {
    timeout: 20000,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settleMs);
}

const VIEW = { width: 1280, height: 720 };

// --- 1. Accueil et écrans annexes ----------------------------------------------------------------

await step('accueil, personnalisation, options, aide, anglais', async () => {
  const { page } = await open('accueil', { viewport: VIEW });
  await page.goto(base);
  await ready(page, 1800);
  await page.getByRole('button', { name: 'Créer un salon' }).waitFor();
  await shot(page, '01-accueil');

  await page.getByRole('button', { name: 'Personnaliser' }).click();
  await page.getByRole('heading', { name: 'Mon stickman' }).waitFor();
  await page.getByRole('button', { name: 'Danser' }).click();
  await page.waitForTimeout(900);
  await shot(page, '02-personnalisation');
  await page.getByRole('button', { name: 'Terminé' }).click();

  await page.getByRole('button', { name: 'Options' }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(300);
  await shot(page, '03-options-controles');
  await page.getByRole('tab', { name: 'Accessibilité' }).click();
  await page.waitForTimeout(200);
  await shot(page, '04-options-accessibilite');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Comment jouer' }).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(300);
  await shot(page, '05-aide');
  await page.keyboard.press('Escape');

  // anglais : tout l'écran doit changer de langue
  await page.getByLabel('Langue / Language').click(); // le bouton bascule FR ↔ EN
  await page.getByRole('button', { name: 'Create a room' }).waitFor();
  await shot(page, '06-accueil-en');
  await page.getByLabel('Langue / Language').click();
  await page.getByRole('button', { name: 'Créer un salon' }).waitFor();
  await page.context().close();
});

// --- 2. Entraînement solo ---------------------------------------------------------------------------

await step('entraînement solo (clavier)', async () => {
  const { page } = await open('solo', { viewport: VIEW });
  await page.goto(base);
  await ready(page);
  await page.getByRole('button', { name: /Entraînement/ }).click();
  await page.getByRole('complementary', { name: /Carnet d.entraînement/ }).waitFor();
  const x0 = await page.evaluate(() => window.__stickyclaude.source.world.players[0].x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => window.__stickyclaude.source.world.players[0].x);
  assert.ok(x1 > x0 + 50, `le joueur n'avance pas (${x0} → ${x1})`);
  await page.keyboard.press('Digit1'); // emote
  await page.waitForTimeout(700);
  await shot(page, '07-entrainement');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Pause' }).waitFor();
  await shot(page, '08-pause');
  await page.getByRole('button', { name: 'Quitter', exact: true }).click();
  await page.getByRole('button', { name: 'Créer un salon' }).waitFor();
  await page.context().close();
});

// --- 2 bis. Manette (simulée : Chromium sans manette branchée) ------------------------------------

await step('manette : menus, jeu, pause, salon', async () => {
  const { ctx, page } = await open('manette', { viewport: VIEW });
  await ctx.addInitScript(() => {
    window.__pad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      connected: true,
      id: 'Manette simulée',
      index: 0,
      mapping: 'standard',
      timestamp: 0,
    };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  });
  const set = (button, on) =>
    page.evaluate(([b, v]) => (window.__pad.buttons[b].pressed = v), [button, on]);
  /** Un appui bref dans un menu : plus court que la répétition (350 ms), puis une pause. */
  const tap = async (button) => {
    await set(button, true);
    await page.waitForTimeout(90);
    await set(button, false);
    await page.waitForTimeout(450);
  };
  /**
   * Un appui tenu jusqu'à ce que `fn` soit vrai dans la page : en jeu le rendu logiciel est lent et
   * irrégulier, un appui bref pourrait tomber entre deux images (et un appui par front, comme
   * Start, ne se répète pas : tenir plus longtemps est sans danger).
   */
  const hold = async (button, fn, what) => {
    await set(button, true);
    await page.waitForFunction(fn, null, { timeout: 8000 }).catch(() => {
      throw new Error(what);
    });
    await set(button, false);
    await page.waitForTimeout(450);
  };
  const focused = () =>
    page.evaluate(() => (document.activeElement?.textContent ?? '').trim().slice(0, 60));
  const pos = () =>
    page.evaluate(() => {
      const p = window.__stickyclaude.source.world.players[0];
      return { x: p.x, y: p.y };
    });
  const BTN = { A: 0, B: 1, X: 2, START: 9, DOWN: 13 };

  await page.goto(base);
  await ready(page);
  // accueil : la croix descend jusqu'à « Entraînement », A l'active
  let found = false;
  for (let i = 0; i < 20 && !found; i++) {
    await tap(BTN.DOWN);
    const f = await focused();
    if (process.env.E2E_DEBUG) log(`    focus : ${f}`);
    found = /Entraînement/.test(f);
  }
  assert.ok(found, 'la croix n’atteint pas « Entraînement »');
  await tap(BTN.A);
  await page.waitForFunction(() => window.__stickyclaude.source?.world, null, { timeout: 5000 });

  // jeu : stick à droite, A saute, X frappe. On attend l'effet dans la simulation (le rendu
  // logiciel est lent et irrégulier : la durée d'un appui ne dit pas combien de pas ont tourné).
  const until = (fn, arg, what) =>
    page.waitForFunction(fn, arg, { timeout: 8000 }).catch(() => {
      throw new Error(what);
    });
  const x0 = (await pos()).x;
  await page.evaluate(() => (window.__pad.axes[0] = 1));
  await until(
    (x) => window.__stickyclaude.source.world.players[0].x > x + 50,
    x0,
    'le stick ne déplace pas le joueur',
  );
  await page.evaluate(() => (window.__pad.axes[0] = 0));
  await until(
    () => window.__stickyclaude.source.world.players[0].state === 0,
    null,
    'le joueur ne s’arrête pas',
  );
  const y0 = (await pos()).y;
  await set(BTN.A, true);
  await until(
    (y) => window.__stickyclaude.source.world.players[0].y < y - 5,
    y0,
    'A ne fait pas sauter',
  );
  await set(BTN.A, false);
  await until(
    () => window.__stickyclaude.source.world.players[0].state === 0,
    null,
    'le joueur ne retombe pas',
  );
  await set(BTN.X, true);
  await until(
    () => window.__stickyclaude.source.world.players[0].state !== 0,
    null,
    'X ne déclenche pas de coup',
  );
  await set(BTN.X, false);

  // Start ouvre la pause ; la croix et A atteignent « Quitter »
  await hold(
    BTN.START,
    () => window.__stickyclaude.overlay.value === 'pause',
    'Start n’ouvre pas la pause',
  );
  let quit = false;
  for (let i = 0; i < 8 && !quit; i++) {
    await tap(BTN.DOWN);
    quit = (await focused()) === 'Quitter';
  }
  assert.ok(quit, 'la croix n’atteint pas « Quitter » dans la pause');
  await tap(BTN.A);
  await page.getByRole('button', { name: 'Créer un salon' }).waitFor({ timeout: 5000 });

  // salon : Start donne la main au panneau, B la rend au jeu
  await page.goto(`${base}/?auto=1&name=Manette`);
  await page.locator('.panel .code').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await hold(
    BTN.START,
    () => !!document.activeElement?.closest('.panel'),
    'Start ne donne pas la main au panneau du salon',
  );
  await hold(BTN.B, () => document.activeElement === document.body, 'B ne rend pas la main au jeu');
  await ctx.close();
});

// --- 3. Une partie complète à deux onglets -------------------------------------------------------

/** Pilote simple : va vers l'adversaire, saute quand il est plus haut, frappe quand il est près. */
function startDriver(page, name) {
  const stop = { v: false };
  const keys = new Set();
  const set = async (key, on) => {
    if (on === keys.has(key)) return;
    if (on) {
      keys.add(key);
      await page.keyboard.down(key);
    } else {
      keys.delete(key);
      await page.keyboard.up(key);
    }
  };
  const done = (async () => {
    let n = 0;
    while (!stop.v) {
      n++;
      const s = await page
        .evaluate(() => {
          const v = window.__stickyclaude.client?.view;
          if (!v || !v.own.visible || v.own.dead || v.own.ghost || v.remoteCount === 0) return null;
          const r = v.remotes[0];
          return { dx: r.x - v.own.x, dy: r.y - v.own.y };
        })
        .catch(() => null);
      if (!s) {
        for (const k of [...keys]) await set(k, false);
        await sleep(150);
        continue;
      }
      await set('ArrowRight', s.dx > 70);
      await set('ArrowLeft', s.dx < -70);
      await set('Space', (s.dy < -60 && n % 4 === 0) || n % 23 === 0);
      await set('KeyJ', Math.abs(s.dx) < 110 && Math.abs(s.dy) < 90 && n % 2 === 0);
      await sleep(90);
    }
    for (const k of [...keys]) await set(k, false).catch(() => undefined);
  })().catch((e) => log(`[pilote ${name}] ${e.message}`));
  return {
    stop: async () => {
      stop.v = true;
      await done;
    },
  };
}

let pageA = null;
let pageB = null;
await step('partie à 2 onglets : salon → combat → podium', async () => {
  const a = await open('A', { viewport: VIEW });
  const b = await open('B', { viewport: { width: 960, height: 540 } });
  pageA = a.page;
  pageB = b.page;
  await pageA.goto(base);
  await ready(pageA);
  await pageA.getByLabel('Ton pseudo').fill('Alice');
  await pageA.getByRole('button', { name: 'Créer un salon' }).click();
  await pageA.locator('.panel .code').waitFor({ timeout: 15000 });
  const code = (await pageA.locator('.panel .code').innerText()).trim();
  assert.match(code, /^[A-Z0-9]{4,8}$/, `code de salon inattendu : ${code}`);
  log(`  salon ${code}`);

  await pageB.goto(`${base}/?salon=${code}`);
  await ready(pageB);
  await pageB.getByLabel('Ton pseudo').fill('Bob');
  await pageB.getByRole('button', { name: 'Rejoindre', exact: true }).first().click();
  await pageB.locator('.panel .code').waitFor();
  await pageA.getByText('Bob').first().waitFor();
  await pageA.waitForTimeout(1500);
  await shot(pageA, '09-salon');

  // réglages : parties courtes, sans mode bonus (la boulette-ball, par exemple, ne se gagne pas
  // en se frappant : les pilotes ne jouent pas au ballon)
  await pageA.getByLabel('Mode bonus').selectOption({ label: 'jamais' });
  await pageA.getByLabel('Manches à gagner').selectOption('3');
  await pageA.getByLabel('Délai (s)').fill('20');
  await pageA.getByLabel('Délai (s)').blur();
  await pageB.getByRole('button', { name: 'Prêt', exact: true }).click();
  await pageA.getByText('Tout le monde est prêt').waitFor();
  await pageA.getByRole('button', { name: 'Lancer la partie' }).click();

  // vote de la carte : une capture, puis chacun vote
  await pageA.locator('.vote').waitFor({ timeout: 15000 });
  await pageB.locator('.vote').waitFor({ timeout: 15000 });
  await pageA.waitForTimeout(500);
  await shot(pageA, '10a-vote');
  await pageA.locator('.vote-option').first().click();
  await pageB.locator('.vote-option').nth(1).click();

  // décompte
  // le décompte « écrit à la main » : on attend le chiffre 2 (le 3 passe pendant la page qui se tourne)
  // (sondage par minuterie : le sondage par image, lent en rendu logiciel, peut rater un chiffre)
  // (en rendu logiciel chargé, le chiffre peut passer entre deux sondages : la capture est alors
  // simplement omise, la partie vérifiée plus bas n'en dépend pas)
  const counted = await pageA
    .waitForFunction(
      () => /^[12]$/.test(document.querySelector('.hud-banner .bt')?.textContent ?? ''),
      null,
      { polling: 40, timeout: 15000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (counted) {
    await pageA.waitForTimeout(350); // le chiffre se trace en un instant
    await shot(pageA, '10-decompte');
  } else log('  décompte manqué (capture 10 omise)');

  const driverA = startDriver(pageA, 'A');
  const driverB = startDriver(pageB, 'B');
  // On attend le podium en capturant les meilleurs moments du combat.
  let best = 0;
  let lastShot = 0;
  let roundShot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 420_000) {
    if (await pageA.getByRole('dialog', { name: 'Podium' }).count()) break;
    const st = await pageA
      .evaluate(() => ({ ...window.__stickyclaude.renderer.stats }))
      .catch(() => null);
    if (st && Date.now() - lastShot > 2500) {
      const activity = st.particles + st.ragdolls * 20;
      if (activity > best && activity >= 12) {
        best = activity;
        lastShot = Date.now();
        await shot(pageA, '11-combat');
      }
    }
    if (
      !roundShot &&
      (await pageA.locator('.hud-banner .bt', { hasText: /gagne la manche|nulle/ }).count())
    ) {
      roundShot = true;
      await pageA.waitForTimeout(350);
      await shot(pageA, '12-fin-de-manche');
    }
    await sleep(200);
  }
  await driverA.stop();
  await driverB.stop();
  await pageA.getByRole('dialog', { name: 'Podium' }).waitFor({ timeout: 5000 });
  await pageA.waitForTimeout(1200);
  await shot(pageA, '13-podium');
  await shot(pageB, '13-podium-b');
  // le tableau des stats : Alice et Bob y figurent
  const table = await pageA.locator('.table').innerText();
  assert.match(table, /Alice/);
  assert.match(table, /Bob/);
  // retour au salon après le podium
  await pageA.locator('.panel .code').waitFor({ timeout: 20000 });
});

// --- 4. Mobile : entraînement aux contrôles tactiles -----------------------------------------------

await step('mobile : entraînement au tactile', async () => {
  const { ctx, page } = await open('mobile', {
    viewport: { width: 851, height: 393 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(base);
  await ready(page, 1800);
  await shot(page, '14-mobile-accueil');
  await page.getByRole('button', { name: /Entraînement/ }).tap();
  await page.locator('.stickzone').waitFor();
  await page.waitForTimeout(800);
  const centre = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })),
    });
  const pos = () => page.evaluate(() => window.__stickyclaude.source.world.players[0].x);
  const stick = await centre('.stickzone');
  const x0 = await pos();
  await touch('touchStart', [[stick[0] + 45, stick[1]]]);
  await page.waitForTimeout(700);
  const atk = await centre('.tbtn.attack');
  // joystick tenu + bouton de coup en même temps
  await touch('touchStart', [
    [stick[0] + 45, stick[1]],
    [atk[0], atk[1]],
  ]);
  await page.waitForTimeout(400);
  await shot(page, '15-mobile-entrainement');
  await touch('touchEnd', []);
  const x1 = await pos();
  assert.ok(x1 > x0 + 50, `le joystick tactile ne déplace pas le joueur (${x0} → ${x1})`);
  // le carnet est replié, un toucher le déplie
  await page.getByRole('button', { name: 'Ouvrir le carnet' }).tap();
  await page.waitForTimeout(300);
  await shot(page, '16-mobile-carnet');
  await ctx.close();
});

// --- 5. Connexion : maintenance simulée, puis coupure du serveur ----------------------------------

await step('maintenance et connexion perdue', async () => {
  assert.ok(pageA, 'la partie à 2 onglets doit avoir réussi');
  // état d'interface seul : ce que le joueur voit pendant un redémarrage du serveur
  await pageA.evaluate(() => {
    window.__stickyclaude.net.value = { status: 'maintenance', error: null };
  });
  await pageA.getByText('Mise à jour du serveur').waitFor();
  await pageA.waitForTimeout(500);
  await shot(pageA, '17-maintenance');
  await pageA.evaluate(() => {
    window.__stickyclaude.net.value = { status: 'joined', error: null };
  });
  if (server) {
    expectingDisconnect = true;
    // arrêt brutal (le serveur s'arrête sans prévenir) : l'arrêt propre, lui, est annoncé puis
    // fermé avec le code 1012 (écran de maintenance), voir packages/server/test/prod.test.ts
    server.kill('SIGKILL');
    await pageA.getByText('Connexion perdue').waitFor({ timeout: 15000 });
    await pageA.waitForTimeout(500);
    await shot(pageA, '18-connexion-perdue');
  }
});

// --- 6. Fiche de style (Vite, développement) ---------------------------------------------------------

if (args.sheet !== undefined) {
  await step('fiche de style', async () => {
    const port = await freePort();
    const vite = spawn(
      process.execPath,
      [
        join(root, 'node_modules/vite/bin/vite.js'),
        '--port',
        String(port),
        '--strictPort',
        '--host',
        '127.0.0.1',
      ],
      { cwd: join(root, 'packages/client'), stdio: 'ignore' },
    );
    try {
      for (let i = 0; ; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/sheet`)).ok) break;
        } catch {
          /* pas prêt */
        }
        assert.ok(i < 150, 'Vite ne répond pas');
        await sleep(200);
      }
      const { page } = await open('fiche', { viewport: { width: 1440, height: 1560 } });
      await page.goto(`http://127.0.0.1:${port}/sheet`);
      await page
        .waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 })
        .catch(() => undefined);
      await page.waitForTimeout(2500);
      await shot(page, '19-fiche-de-style');
      await page.context().close();
    } finally {
      vite.kill();
    }
  });
}

await browser.close();
server?.kill();

if (consoleErrors.length > 0) {
  failures.push(
    `erreurs dans la console (${consoleErrors.length}) :\n  ${consoleErrors.slice(0, 10).join('\n  ')}`,
  );
}
if (failures.length > 0) {
  console.error(`\n${failures.length} échec(s) :\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
log('\nE2E : tout est passé, console propre.');
