import {
  BinType,
  createSnapshot,
  decodeSnapshot,
  encodeInput,
  GamePhase,
  Input,
  PROTOCOL_VERSION,
} from '@stickyclaude/shared';
import type { ServerMessage, Snapshot } from '@stickyclaude/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig, startServer } from '../src/index.ts';
import type { RunningServer } from '../src/index.ts';

/** Intégration avec un vrai serveur HTTP + WebSocket sur un port libre, et de vrais clients `ws`. */

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

class Peer {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  readonly snaps: Snapshot[] = [];
  closeCode: number | null = null;
  private readonly open: Promise<void>;
  private ticking: NodeJS.Timeout | null = null;
  /** Masque envoyé à chaque tick (étiquette = dernier tick reçu + avance). */
  mask = 0;
  lastTick = 0;
  lastEvent = 0;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers, perMessageDeflate: false });
    this.ws.binaryType = 'nodebuffer';
    this.open = new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
      this.ws.once('unexpected-response', (_req, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    });
    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        this.messages.push(JSON.parse(data.toString('utf8')) as ServerMessage);
        return;
      }
      if (data[0] === BinType.SNAPSHOT) {
        const s = createSnapshot();
        decodeSnapshot(data, s);
        this.lastTick = s.tick;
        if (s.eventCount > 0) this.lastEvent = s.events[s.eventCount - 1].id;
        this.snaps.push(s);
        if (this.snaps.length > 600) this.snaps.splice(0, 300);
      }
    });
    this.ws.on('close', (code) => {
      this.closeCode = code;
      this.stopInputs();
    });
  }

  ready(): Promise<void> {
    return this.open;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Envoie des entrées à 60 Hz, étiquetées juste devant le tick serveur. */
  startInputs(): void {
    if (this.ticking) return;
    const buf = new Uint8Array(16);
    this.ticking = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN || this.lastTick === 0) return;
      const masks = [this.mask, this.mask, this.mask, this.mask];
      const n = encodeInput(buf, this.lastTick + 6, this.lastEvent, 25, masks, 4);
      this.ws.send(buf.slice(0, n));
    }, 1000 / 60);
  }

  stopInputs(): void {
    if (this.ticking) clearInterval(this.ticking);
    this.ticking = null;
  }

  last<T extends ServerMessage['t']>(t: T): Msg<T> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].t === t) return this.messages[i] as Msg<T>;
    }
    return undefined;
  }

  all<T extends ServerMessage['t']>(t: T): Msg<T>[] {
    return this.messages.filter((m) => m.t === t) as Msg<T>[];
  }

  async until(cond: () => boolean, ms = 8000, what = 'condition'): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`délai dépassé : ${what}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  close(): void {
    this.stopInputs();
    this.ws.terminate();
  }
}

let servers: RunningServer[] = [];
let peers: Peer[] = [];

async function boot(
  env: Record<string, string> = {},
): Promise<{ srv: RunningServer; url: string }> {
  const cfg = loadConfig(
    {
      NODE_ENV: 'test',
      PORT: '0',
      HOST: '127.0.0.1',
      MATCH_END_MS: '500',
      CODE_TRIES_PER_MIN: '1000',
      CREATE_PER_MIN: '1000',
      MAX_CONN_PER_IP: '100',
      ...env,
    },
    '/nonexistent',
  );
  const srv = await startServer(cfg);
  servers.push(srv);
  return { srv, url: `ws://127.0.0.1:${srv.port}/ws` };
}

function peer(url: string, headers?: Record<string, string>): Peer {
  const p = new Peer(url, headers);
  peers.push(p);
  return p;
}

afterEach(async () => {
  for (const p of peers) p.close();
  peers = [];
  for (const s of servers) await s.stop();
  servers = [];
});

const V = PROTOCOL_VERSION;

describe('HTTP', () => {
  it('/healthz et /api/rooms', async () => {
    const { srv } = await boot();
    const base = `http://127.0.0.1:${srv.port}`;
    const h = (await (await fetch(`${base}/healthz`)).json()) as { ok: boolean; rooms: number };
    expect(h.ok).toBe(true);
    expect(h.rooms).toBe(0);
    expect(await (await fetch(`${base}/api/rooms`)).json()).toEqual([]);
    expect((await fetch(`${base}/inconnu`)).status).toBe(404);
  });
});

describe('du salon à la manche, avec de vrais sockets', () => {
  it('crée, rejoint, règle, lance : décompte puis combat, snapshots complets', async () => {
    const { url } = await boot();
    const a = peer(url);
    const b = peer(url);
    await Promise.all([a.ready(), b.ready()]);
    a.send({ t: 'create', v: V, name: 'Alice' });
    await a.until(() => a.last('joined') !== undefined, 4000, 'joined');
    const code = a.last('joined')!.code;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    b.send({ t: 'join', v: V, name: 'Bob', code });
    await b.until(() => b.last('joined') !== undefined, 4000, 'joined B');
    expect(b.last('joined')!.slot).toBe(1);
    await a.until(() => (a.last('lobby')?.lobby.players.length ?? 0) === 2, 4000, 'lobby à 2');

    a.startInputs();
    b.startInputs();
    a.send({ t: 'settings', settings: { roundsToWin: 3, suddenDeathSec: 20, weapons: true } });
    b.send({ t: 'ready', ready: true });
    await a.until(
      () => a.last('lobby')!.lobby.players.find((p) => p.slot === 1)?.ready === true,
      4000,
      'B prêt',
    );
    a.send({ t: 'start' });
    await a.until(() => a.last('round')?.round.round === 1, 4000, 'manche 1');
    await b.until(() => b.last('round')?.round.round === 1, 4000, 'manche 1 (B)');
    expect(a.last('round')!.round.arena).toBe(b.last('round')!.round.arena);

    await a.until(
      () => a.snaps.some((s) => s.game.phase === GamePhase.COUNTDOWN),
      4000,
      'décompte',
    );
    await a.until(() => a.snaps.some((s) => s.game.phase === GamePhase.PLAYING), 9000, 'combat');
    const s = a.snaps[a.snaps.length - 1];
    expect(s.hasOwn).toBe(true);
    expect(s.playerCount).toBe(2);
    expect(s.players.every((p, i) => i >= s.playerCount || p.hp === 100)).toBe(true);
    // Chacun voit le même état de partie (même manche, même mode)
    const sb = b.snaps[b.snaps.length - 1];
    expect(sb.game.round).toBe(1);
    expect(sb.game.mode).toBe(s.game.mode);
    expect(a.messages.filter((m) => m.t === 'error')).toEqual([]);
  }, 25_000);

  it('partie rapide : deux joueurs arrivent dans le même salon public', async () => {
    const { srv, url } = await boot();
    const a = peer(url);
    const b = peer(url);
    await Promise.all([a.ready(), b.ready()]);
    a.send({ t: 'quick', v: V, name: 'Alice' });
    await a.until(() => a.last('joined') !== undefined, 4000, 'A');
    b.send({ t: 'quick', v: V, name: 'Bob' });
    await b.until(() => b.last('joined') !== undefined, 4000, 'B');
    expect(b.last('joined')!.code).toBe(a.last('joined')!.code);
    const list = (await (await fetch(`http://127.0.0.1:${srv.port}/api/rooms`)).json()) as {
      code: string;
      players: number;
      phase: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0].players).toBe(2);
    expect(list[0].phase).toBe('lobby');
  });
});

describe('reconnexion avec un vrai socket', () => {
  it('une coupure brutale garde la place ; le jeton la rend ; l’hôte reste hôte', async () => {
    const { url } = await boot();
    const a = peer(url);
    const b = peer(url);
    await Promise.all([a.ready(), b.ready()]);
    a.send({ t: 'create', v: V, name: 'Alice' });
    await a.until(() => a.last('joined') !== undefined, 4000, 'A');
    const { code, token, slot } = a.last('joined')!;
    b.send({ t: 'join', v: V, name: 'Bob', code });
    await b.until(() => b.last('joined') !== undefined, 4000, 'B');

    a.close(); // coupure sans « leave »
    await b.until(
      () => b.last('lobby')?.lobby.players.find((p) => p.slot === slot)?.connected === false,
      4000,
      'A déconnecté',
    );
    const a2 = peer(url);
    await a2.ready();
    a2.send({ t: 'resume', v: V, token, code });
    await a2.until(() => a2.last('joined') !== undefined, 4000, 'reprise');
    expect(a2.last('joined')!.slot).toBe(slot);
    await b.until(
      () => b.last('lobby')?.lobby.players.find((p) => p.slot === slot)?.connected === true,
      4000,
      'A de retour',
    );
    // Le même jeton ne sert qu'une fois tant que la connexion est vivante
    const a3 = peer(url);
    await a3.ready();
    a3.send({ t: 'resume', v: V, token, code });
    await a3.until(() => a3.last('error') !== undefined, 4000, 'refus');
    expect(a3.last('error')!.code).toBe('bad_token');
  });

  it('après le délai, la place est perdue', async () => {
    const { url } = await boot({ RECONNECT_GRACE_MS: '1000' });
    const a = peer(url);
    const b = peer(url);
    await Promise.all([a.ready(), b.ready()]);
    a.send({ t: 'create', v: V, name: 'Alice' });
    await a.until(() => a.last('joined') !== undefined, 4000, 'A');
    const { code, token } = a.last('joined')!;
    b.send({ t: 'join', v: V, name: 'Bob', code });
    await b.until(() => b.last('joined') !== undefined, 4000, 'B');
    a.close();
    await b.until(() => (b.last('lobby')?.lobby.players.length ?? 2) === 1, 8000, 'A retiré');
    const a2 = peer(url);
    await a2.ready();
    a2.send({ t: 'resume', v: V, token, code });
    await a2.until(() => a2.last('error') !== undefined, 4000, 'refus');
    expect(a2.last('error')!.code).toBe('bad_token');
    // Bob est devenu l'hôte
    expect(b.last('lobby')!.lobby.host).toBe(b.last('joined')!.slot);
  }, 15_000);
});

describe('tentatives de triche', () => {
  it('aucun message ne peut fixer position, PV ou score', async () => {
    const { srv, url } = await boot();
    const a = peer(url);
    const b = peer(url);
    await Promise.all([a.ready(), b.ready()]);
    a.send({ t: 'create', v: V, name: 'Alice' });
    await a.until(() => a.last('joined') !== undefined, 4000, 'A');
    const code = a.last('joined')!.code;
    b.send({ t: 'join', v: V, name: 'Bob', code });
    await b.until(() => b.last('joined') !== undefined, 4000, 'B');
    const room = srv.game.rooms.get(code)!;
    const w = room.world;
    const before = { x: w.players[1].x, y: w.players[1].y, hp: w.players[1].hp };
    // Messages forgés : position, PV, score, tick dans un message JSON, champs en trop, mauvais types
    for (const forged of [
      { t: 'move', x: 5, y: 5 },
      { t: 'ready', ready: true, hp: 1000 },
      { t: 'settings', settings: { roundsToWin: 1 } },
      { t: 'look', look: { color: 99999, hat: -3 } },
      { t: 'emote', id: 99 },
      { t: 'kick', slot: 0 },
      { t: 'start' },
      { t: 'teams', assign: [9, 9] },
      { t: 'tune', k: 'runSpeed', val: 99999 },
    ]) {
      b.send(forged);
    }
    // Entrée binaire forgée : étiquette absurde, masque avec les bits réservés de compensation
    const buf = new Uint8Array(16);
    const n = encodeInput(buf, 0xfffe, 0xffff, 255, [0xffff, 0xf0f0, 0xf0f0, 0xf0f0], 4);
    b.ws.send(buf.slice(0, n));
    await new Promise((r) => setTimeout(r, 600));
    expect(w.players[1].hp).toBe(before.hp);
    expect(Math.abs(w.players[1].x - before.x)).toBeLessThan(2);
    expect(Math.abs(w.players[1].y - before.y)).toBeLessThan(2);
    expect(w.game.scores.every((s) => s === 0)).toBe(true);
    // Le non-hôte n'a ni lancé la partie, ni expulsé l'hôte, ni changé les réglages
    expect(room.phase).toBe(GamePhase.LOBBY);
    expect(room.slots[0]).not.toBeNull();
    expect(room.settings.roundsToWin).toBe(5);
    expect(b.all('error').map((e) => e.code)).toEqual(expect.arrayContaining(['not_host']));
    expect(b.closeCode).toBeNull();
  });

  it('inonder de messages invalides coupe la connexion ; un message énorme aussi', async () => {
    const { url } = await boot();
    const flood = peer(url);
    await flood.ready();
    for (let i = 0; i < 40; i++) flood.ws.send('pas du json');
    await flood.until(() => flood.closeCode !== null, 4000, 'coupure du flood');
    expect(flood.closeCode).toBe(1008);

    const big = peer(url);
    await big.ready();
    big.ws.send(JSON.stringify({ t: 'create', v: V, name: 'x'.repeat(5000) }));
    await big.until(() => big.closeCode !== null, 4000, 'coupure du message énorme');
    expect(big.closeCode).toBe(1009);
  });

  it('essais de code en rafale : limités ; code faux : not_found', async () => {
    const { url } = await boot({ CODE_TRIES_PER_MIN: '5' });
    const p = peer(url);
    await p.ready();
    for (let i = 0; i < 12; i++) p.send({ t: 'join', v: V, name: 'Mallory', code: `ZZZ${i}A` });
    await p.until(() => p.all('error').length >= 12, 4000, 'réponses');
    const codes = p.all('error').map((e) => e.code);
    expect(codes.slice(0, 5)).toEqual(Array(5).fill('not_found'));
    expect(codes.slice(6)).toContain('rate_limited');
  });

  it('pseudo : filtré, borné, normalisé', async () => {
    const { url } = await boot();
    const p = peer(url);
    await p.ready();
    p.send({ t: 'create', v: V, name: 'A' });
    await p.until(() => p.last('error') !== undefined, 4000, 'refus pseudo trop court');
    expect(p.last('error')!.code).toBe('bad_name');
    p.send({ t: 'create', v: V, name: '‮<img src=x onerror=1>' });
    await p.until(
      () => p.all('error').length >= 2 || p.last('joined') !== undefined,
      4000,
      'pseudo',
    );
    const joined = p.last('joined');
    if (joined) {
      // Si accepté, le texte est nettoyé des caractères de contrôle et d'inversion
      const name = joined.lobby.players[0].name;
      expect(name).not.toContain('‮');
    }
  });
});

describe('origine', () => {
  it('en production, seule l’origine publique est acceptée', async () => {
    const { url } = await boot({
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'https://jeu.example',
      STATIC_DIR: '/nonexistent',
    });
    const good = peer(url, { Origin: 'https://jeu.example' });
    await good.ready();
    const bad = peer(url, { Origin: 'https://evil.example' });
    await expect(bad.ready()).rejects.toThrow('403');
    const none = peer(url);
    await expect(none.ready()).rejects.toThrow('403');
  });
});

export { Input };
