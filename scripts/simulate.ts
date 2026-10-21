// Simulation headless : déterminisme, coût d'un pas, relecture d'enregistrements.
//
//   npm run simulate                                  soak 8 joueurs, 60 000 ticks, 2 arènes
//   npm run simulate -- --ticks 600000 --players 8 --arena test-tower
//   npm run simulate -- --replay recordings/room-ABCDE-123.json
import { readFileSync } from 'node:fs';
import { getArena, MAX_PLAYERS, Rng } from '@stickyclaude/shared';
import type { Recording } from '@stickyclaude/shared';
import { addPlayer, createWorld, hashWorld, replayRecording, step } from '@stickyclaude/sim';

const argv = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function replay(file: string): void {
  const rec = JSON.parse(readFileSync(file, 'utf8')) as Recording;
  const arena = getArena(rec.arenaId);
  if (rec.version !== 3 || !arena) fail('enregistrement invalide');
  const t0 = performance.now();
  const world = replayRecording(rec, arena);
  const ms = performance.now() - t0;
  const hash = hashWorld(world);
  console.log(`relecture de ${file}`);
  console.log(
    `  arène ${rec.arenaId}, graine ${rec.seed}, ${world.tick} ticks en ${ms.toFixed(0)} ms`,
  );
  console.log(
    `  hash final ${hash.toString(16)}${rec.finalHash !== undefined ? ` (attendu ${rec.finalHash.toString(16)})` : ''}`,
  );
  world.players.forEach((p, i) => {
    if (p.active)
      console.log(
        `  joueur ${i} : x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} vx=${p.vx.toFixed(1)} vy=${p.vy.toFixed(1)}`,
      );
  });
  if (rec.finalHash !== undefined && rec.finalHash !== hash)
    fail('le hash ne correspond pas : la simulation a divergé');
  console.log('✓ relecture identique');
}

/** Entrées « réalistes » : appuis tenus plusieurs ticks. */
class Bot {
  private readonly cur = new Uint16Array(MAX_PLAYERS);
  private readonly hold = new Int32Array(MAX_PLAYERS);
  constructor(private readonly rng: Rng) {}
  next(out: Uint16Array, n: number): void {
    for (let s = 0; s < n; s++) {
      if (this.hold[s] <= 0) {
        this.hold[s] = 3 + this.rng.int(50);
        const r = this.rng.nextU32();
        this.cur[s] = r & 0x1f & ~((r >>> 8) & 0x10 ? 0 : 0);
      }
      this.hold[s] = this.hold[s] - 1;
      out[s] = this.cur[s]!;
    }
  }
}

function soak(arenaId: string, players: number, ticks: number, seed: number): void {
  const arena = getArena(arenaId);
  if (!arena) fail(`arène inconnue : ${arenaId}`);
  const a = createWorld(arena, seed);
  const b = createWorld(arena, seed);
  for (let s = 0; s < players; s++) {
    addPlayer(a, s);
    addPlayer(b, s);
  }
  const botA = new Bot(new Rng(seed + 1));
  const botB = new Bot(new Rng(seed + 1));
  const inA = new Uint16Array(MAX_PLAYERS);
  const inB = new Uint16Array(MAX_PLAYERS);

  // Déterminisme : deux mondes, mêmes entrées, hash identique à chaque point de contrôle.
  let checkpoints = 0;
  for (let t = 1; t <= ticks; t++) {
    botA.next(inA, players);
    botB.next(inB, players);
    step(a, inA);
    step(b, inB);
    if (t % 1000 === 0) {
      checkpoints++;
      if (hashWorld(a) !== hashWorld(b)) fail(`divergence au tick ${t}`);
    }
  }

  // Coût d'un pas : mesure par lots de 100 pas, sans allocation dans la boucle mesurée.
  const batches: number[] = [];
  const bot = new Bot(new Rng(seed + 2));
  const inputs = new Uint16Array(MAX_PLAYERS);
  const c = createWorld(arena, seed);
  for (let s = 0; s < players; s++) addPlayer(c, s);
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < Math.max(200, Math.floor(ticks / 100)); i++) {
    bot.next(inputs, players);
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) step(c, inputs);
    batches.push(((performance.now() - t0) / 100) * 1000);
  }
  gc?.();
  const heapDelta = process.memoryUsage().heapUsed - heap0;
  batches.sort((x, y) => x - y);
  const p = (f: number): number => batches[Math.floor((batches.length - 1) * f)];
  console.log(
    `✓ ${arenaId} · ${players} joueurs · ${ticks} ticks : déterministe (${checkpoints} points de contrôle) · ` +
      `pas p50 ${p(0.5).toFixed(1)} µs, p99 ${p(0.99).toFixed(1)} µs (budget 150 µs)` +
      (gc ? ` · tas Δ ${(heapDelta / 1024).toFixed(0)} Ko` : ''),
  );
  if (p(0.99) > 500) fail('pas de simulation trop lent (p99 > 500 µs)');
}

const replayFile = opt('replay', '');
if (replayFile) replay(replayFile);
else {
  const players = Math.min(MAX_PLAYERS, Math.max(1, Number(opt('players', '8'))));
  const ticks = Number(opt('ticks', '60000'));
  const seed = Number(opt('seed', '42'));
  const arenas = opt('arena', '') ? [opt('arena', '')] : ['test-flat', 'test-tower'];
  for (const id of arenas) soak(id, players, ticks, seed);
}
