import {
  cloneSettings,
  DEFAULT_LOOK,
  DEFAULT_SETTINGS,
  LOBBY_ARENA_ID,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
} from '@stickyclaude/shared';
import type { ServerMessage } from '@stickyclaude/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OnlineModule from '../src/app/online.ts';
import type * as StoreModule from '../src/app/store.ts';

/** WebSocket simulé : le test décide de l'ouverture, des messages et de la fermeture. */
class FakeWebSocket {
  static readonly OPEN = 1;
  static all: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = '';
  closeCalls = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closeCalls++;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function joinedMessage(): Extract<ServerMessage, { t: 'joined' }> {
  return {
    t: 'joined',
    v: PROTOCOL_VERSION,
    slot: 0,
    id: 1,
    token: 'ab'.repeat(16),
    code: 'ABCDE',
    tickHz: 60,
    snapshotHz: 30,
    tick: 0,
    ev: 0,
    devTools: false,
    lobby: {
      code: 'ABCDE',
      host: 0,
      settings: cloneSettings(DEFAULT_SETTINGS),
      players: [
        {
          slot: 0,
          name: 'Alice',
          look: { ...DEFAULT_LOOK },
          ready: false,
          team: -1,
          connected: true,
          ping: 0,
        },
      ],
      spectators: [],
      phase: 0,
      custom: [],
      autostartMs: -1,
      round: 0,
      scores: new Array<number>(8).fill(0),
    },
    round: {
      arena: LOBBY_ARENA_ID,
      seed: 1,
      mode: 0,
      round: 0,
      rows: null,
      teams: new Array<number>(8).fill(-1),
      suddenAfterTicks: 0,
      ghosts: false,
      weapons: false,
      friendlyFire: false,
      commonWeapon: 0,
    },
  };
}

let online: OnlineModule.Online;
let store: typeof StoreModule;
let CLOSE_REPLACED: number;

beforeEach(async () => {
  vi.useFakeTimers();
  FakeWebSocket.all = [];
  const storage = new Map<string, string>();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { search: '', protocol: 'http:', host: 'localhost' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.resetModules();
  const mod = await import('../src/app/online.ts');
  store = await import('../src/app/store.ts');
  CLOSE_REPLACED = mod.CLOSE_REPLACED;
  // le rendu n'est pas l'objet de ces tests : toute méthode est un no-op
  const renderer = new Proxy({}, { get: () => () => {} });
  online = new mod.Online({
    renderer: renderer as never,
    onEnter: () => {},
    onExit: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Ouvre la dernière socket et y fait « entrer » le client dans un salon. */
function enterRoom(): FakeWebSocket {
  const ws = FakeWebSocket.all.at(-1)!;
  ws.open();
  ws.receive(joinedMessage());
  expect(store.net.value.status).toBe('joined');
  return ws;
}

const look = { ...DEFAULT_LOOK };

describe('quitter un salon', () => {
  it('la WebSocket est fermée au retour au menu', () => {
    online.create('Alice', look, true);
    const ws = enterRoom();
    ws.receive({ t: 'left', reason: 'kicked' });
    expect(ws.closeCalls).toBe(1);
    expect(online.client).toBeNull();
    expect(store.net.value.status).toBe('idle');
  });

  it("annuler la reprise ferme aussi la socket en cours d'essai", () => {
    online.create('Alice', look, true);
    const ws = enterRoom();
    ws.drop();
    vi.advanceTimersByTime(500);
    const retry = FakeWebSocket.all.at(-1)!;
    expect(retry).not.toBe(ws);
    online.cancelResume();
    expect(retry.closeCalls).toBe(1);
  });

  it('quitter et rejoindre plusieurs fois ne laisse aucune socket ouverte', () => {
    for (let i = 0; i < 5; i++) {
      online.create('Alice', look, true);
      const ws = enterRoom();
      ws.receive({ t: 'left', reason: 'left' });
    }
    const open = FakeWebSocket.all.filter((w) => w.closeCalls === 0 && w.readyState !== 3);
    expect(open).toHaveLength(0);
  });
});

describe('reconnexion', () => {
  it('la première tentative attend un instant', () => {
    online.create('Alice', look, true);
    const ws = enterRoom();
    const before = FakeWebSocket.all.length;
    ws.drop();
    expect(store.net.value.status).toBe('reconnecting');
    expect(FakeWebSocket.all).toHaveLength(before);
    vi.advanceTimersByTime(450);
    expect(FakeWebSocket.all).toHaveLength(before + 1);
  });

  it('un refus autre que bad_token (limite de débit) est réessayé, sans rester bloqué', () => {
    online.create('Alice', look, true);
    enterRoom().drop();
    vi.advanceTimersByTime(450);
    const first = FakeWebSocket.all.at(-1)!;
    first.open();
    first.receive({ t: 'error', code: 'rate_limited' });
    expect(first.closeCalls).toBe(1);
    // la fermeture de cette socket ne déclenche pas une seconde reprise en plus de la planifiée
    first.drop();
    const count = FakeWebSocket.all.length;
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.all).toHaveLength(count + 1);
    const second = FakeWebSocket.all.at(-1)!;
    second.open();
    second.receive(joinedMessage());
    expect(store.net.value.status).toBe('joined');
  });

  it('les essais cessent quand la grâce est écoulée', () => {
    online.create('Alice', look, true);
    enterRoom().drop();
    for (let i = 0; i < 400 && store.net.value.status === 'reconnecting'; i++) {
      vi.advanceTimersByTime(500);
      const ws = FakeWebSocket.all.at(-1)!;
      if (ws.readyState === 0) {
        ws.open();
        ws.receive({ t: 'error', code: 'rate_limited' });
      }
    }
    vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(store.net.value.status).toBe('idle');
    expect(store.net.value.error).not.toBeNull();
  });

  it('une socket évincée par un autre onglet (4000) ne relance pas la reprise', () => {
    online.create('Alice', look, true);
    const ws = enterRoom();
    const before = FakeWebSocket.all.length;
    ws.drop(CLOSE_REPLACED);
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.all).toHaveLength(before);
    expect(store.net.value.status).toBe('idle');
  });
});

describe('protocole', () => {
  it('un joined d une autre version renvoie au menu avec un message', () => {
    online.create('Alice', look, true);
    const ws = FakeWebSocket.all.at(-1)!;
    ws.open();
    ws.receive({ ...joinedMessage(), v: PROTOCOL_VERSION + 1 });
    expect(store.net.value.status).toBe('idle');
    expect(store.net.value.error).toMatch(/recharge|reload/);
    expect(ws.closeCalls).toBe(1);
  });
});
