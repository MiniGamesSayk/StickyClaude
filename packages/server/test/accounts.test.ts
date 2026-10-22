import { GamePhase } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { createAccountService } from '../src/account.ts';
import { loadConfig } from '../src/index.ts';
import { Bot, harness } from './helpers.ts';

describe('comptes sayk.fr : bilan de fin de partie', { timeout: 300_000 }, () => {
  it("n'envoie que les joueurs connectés, avec victoire et meilleur enchaînement", () => {
    const h = harness({ MATCH_END_MS: '500' });
    const reports: { id: string; add: Record<string, number>; max: Record<string, number> }[] = [];
    h.server.reportStats = (id, add, max) => reports.push({ id, add, max });

    const host = h.connect('10.0.0.1');
    Object.assign(host, { userId: '111' });
    const guest = h.connect('10.0.0.2'); // anonyme
    const code = h.create(host, 'Hôte');
    h.join(guest, code, 'Invité');
    h.settings(host, { roundsToWin: 1, suddenDeathSec: 20, bonusEvery: 0, mode: 'ffa' });
    h.startMatch(host, [guest]);
    const room = h.room(code);
    const bots = [host, guest].map((c, i) => new Bot(h, c, 100 + i, null));
    for (let i = 0; i < 120_000 && room.phase !== GamePhase.MATCH_END; i++) {
      for (const b of bots) b.act(code);
      h.advance(1);
    }
    expect(room.phase).toBe(GamePhase.MATCH_END);

    expect(reports).toHaveLength(1);
    const [r] = reports;
    expect(r.id).toBe('111');
    expect(r.add.matches).toBe(1);
    const results = host.lastOf('results')!;
    const slot = h.slotOf(host);
    expect(r.add.wins).toBe(results.winner === results.teams[slot] ? 1 : 0);
    for (const v of [...Object.values(r.add), ...Object.values(r.max)]) {
      expect(Number.isInteger(v) && v >= 0).toBe(true);
    }
  });
});

describe('service de comptes', () => {
  const cfg = loadConfig(
    { NODE_ENV: 'test', SAYK_AUTH_URL: 'http://auth:3000/', SAYK_AUTH_KEY: 'k' },
    '/x',
  );
  const log = (): void => undefined;

  it('est inactif sans configuration', () => {
    expect(createAccountService(loadConfig({ NODE_ENV: 'test' }, '/x'), log)).toBeNull();
  });

  it('ne contacte le service que pour un cookie de session bien formé', async () => {
    const svc = createAccountService(cfg, log)!;
    expect(await svc.resolve(undefined)).toBeNull();
    expect(await svc.resolve('a=b; sayk_session=nope')).toBeNull();
  });

  it("interroge le service avec la clé du jeu et lit l'identifiant", async () => {
    const token = 'a'.repeat(64);
    const calls: { url: string; auth: string; body: unknown }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string),
      });
      return Promise.resolve(Response.json({ game: 'stickyclaude', user: { id: '42' } }));
    }) as typeof fetch;
    try {
      const svc = createAccountService(cfg, log)!;
      expect(await svc.resolve(`x=1; sayk_session=${token}`)).toBe('42');
      expect(calls[0]).toEqual({
        url: 'http://auth:3000/internal/resolve',
        auth: 'Bearer k',
        body: { token },
      });
    } finally {
      globalThis.fetch = real;
    }
  });

  it('reste anonyme si le service est injoignable', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('down'));
    try {
      const svc = createAccountService(cfg, log)!;
      expect(await svc.resolve(`sayk_session=${'b'.repeat(64)}`)).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
  });
});
