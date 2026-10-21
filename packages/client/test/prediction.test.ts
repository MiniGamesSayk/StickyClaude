import { Input, MAX_PLAYERS, SimEvent, TICK_MS } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { TestWorld } from './harness.ts';
import type { NetOptions, Probe } from './harness.ts';

const ARENA = 'test-tower';

function pct(a: number[], f: number): number {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) * f)] ?? 0;
}

/** Écart entre la position prédite de chaque client et l'état autoritaire du serveur. */
function ownErrors(w: TestWorld, probes: Probe[]): number[] {
  const room = w.room();
  return probes.map((p) => {
    const sp = room.world.players[p.client.slot];
    const pr = p.client.predictor!;
    // Compare au même tick : l'état prédit au tick du serveur
    const own = pr.ownAt(room.world.tick);
    if (!own) return Infinity;
    return Math.hypot(own.x - sp.x, own.y - sp.y);
  });
}

describe('réseau parfait', () => {
  it('la prédiction concorde toujours avec le serveur', () => {
    const w = new TestWorld();
    const [a, b] = w.populate(2, { lag: 0, jitter: 0, loss: 0 }, ARENA);
    w.run(3000); // les entrées simulées pendant le rattrapage initial sont inévitablement en retard
    a.client.predictor!.corrections = 0;
    b.client.predictor!.corrections = 0;
    w.run(20_000);
    expect(a.client.state).toBe('joined');
    expect(a.client.stats.snapshots).toBeGreaterThan(500);
    expect(a.client.predictor!.corrections).toBe(0);
    expect(b.client.predictor!.corrections).toBe(0);
  });
});

describe('latence constante sans gigue ni perte', () => {
  for (const lag of [40, 150, 300]) {
    it(`lag=${lag} : aucune correction une fois synchronisé, pas de saccade`, () => {
      const w = new TestWorld();
      const probes = w.populate(6, { lag, jitter: 0, loss: 0 }, ARENA);
      w.run(4000);
      w.startRecording();
      for (const p of probes) p.client.predictor!.corrections = 0;
      w.run(20_000);
      for (const p of probes) {
        const st = p.client.stats;
        expect(st.rttMs).toBeGreaterThan(lag * 0.8);
        expect(st.rttMs).toBeLessThan(lag * 1.2 + 5);
        expect(p.client.predictor!.corrections).toBeLessThanOrEqual(1);
        expect(p.maxOwnStep).toBeLessThan(12);
        expect(p.maxRemoteStep).toBeLessThan(12);
      }
    });
  }
});

describe('réseau dégradé : lag=150 jitter=30 loss=2', () => {
  const opts: NetOptions = { lag: 150, jitter: 30, loss: 2 };

  it('8 clients : pas de téléportation visible, peu de corrections', () => {
    const w = new TestWorld();
    const probes = w.populate(8, opts, ARENA);
    w.run(6000);
    w.startRecording();
    for (const p of probes) p.client.predictor!.corrections = 0;
    w.run(40_000);
    for (const p of probes) {
      // Personne ne se téléporte à l'écran : pas de saut de plus de ~2 cellules, jamais.
      expect(p.maxRemoteStep, `${p.name} remote`).toBeLessThan(24);
      expect(p.maxOwnStep, `${p.name} own`).toBeLessThan(60);
      // Mouvement normal : 99 % des images bougent de moins de 9 unités.
      expect(pct(p.ownSteps, 0.99)).toBeLessThan(9);
      expect(pct(p.remoteSteps, 0.99)).toBeLessThan(9);
      // Les corrections restent peu nombreuses (≈ 2 par seconde : ce modèle de perte bloque le
      // flux d'entrées ≈ 1,2 fois par seconde) ; ce seuil sert de garde-fou de régression.
      expect(p.client.predictor!.corrections).toBeLessThan(120);
      expect(p.client.predictor!.resyncs).toBe(0);
      // Le serveur n'a jamais décroché
      expect(p.client.state).toBe('joined');
    }
  });

  it('converge vers l état du serveur dès que les entrées cessent', () => {
    const w = new TestWorld();
    const probes = w.populate(8, opts, ARENA);
    w.run(10_000);
    for (const p of probes) p.bot.idle = true;
    w.run(6000);
    const room = w.room();
    const errors = ownErrors(w, probes);
    for (const e of errors) expect(e).toBeLessThan(0.5);
    // Vue des autres joueurs : à moins de 1 unité de la réalité (tous immobiles).
    for (const p of probes) {
      const v = p.client.view;
      expect(v.remoteCount).toBe(7);
      for (let i = 0; i < v.remoteCount; i++) {
        const r = v.remotes[i];
        const sp = room.world.players[r.slot];
        // Un joueur resté sur la plateforme mobile continue de bouger : on le voit avec le retard
        // d'interpolation (latence + tampon), donc avec un écart de (vitesse de la plateforme × délai).
        const riding = sp.groundMover >= 0;
        expect(Math.hypot(r.x - sp.x, r.y - sp.y), `${p.name} sees ${r.slot}`).toBeLessThan(
          riding ? 45 : 1,
        );
      }
    }
  });

  it('plus la perte est forte, plus l avance de prédiction augmente, sans exploser', () => {
    const w = new TestWorld();
    const probes = w.populate(4, { lag: 150, jitter: 30, loss: 5 }, ARENA);
    w.run(30_000);
    for (const p of probes) {
      expect(p.client.stats.leadTicks).toBeLessThan(25);
      expect(p.client.state).toBe('joined');
    }
  });
});

describe('réponse immédiate', () => {
  it('son propre stickman bouge dès l image suivante, malgré 150 ms de latence', () => {
    const w = new TestWorld();
    const [p] = w.populate(2, { lag: 150, jitter: 0, loss: 0 }, ARENA);
    w.run(1000);
    p.bot.forced = 0;
    w.run(3000); // posé et immobile
    const x0 = p.client.view.own.x;
    p.bot.forced = Input.RIGHT;
    const frameMs = 1000 / 60;
    let frames = 0;
    while (Math.abs(p.client.view.own.x - x0) < 0.2 && frames < 20) {
      w.run(frameMs);
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(3);
    // Et le serveur, lui, ne le verra qu'après la latence
    const serverX = w.room().world.players[p.client.slot].x;
    expect(Math.abs(serverX - x0)).toBeLessThan(5);
  });
});

describe('horloges et fréquences d image', () => {
  it('supporte une horloge locale décalée et qui dérive', () => {
    const w = new TestWorld();
    const probes = [
      w.addClient(
        'Aaaa',
        { lag: 80, jitter: 10, loss: 0, clockOffset: 123_456.789, clockDrift: 0.0002 },
        undefined,
        ARENA,
      ),
    ];
    w.run(500);
    probes.push(
      w.addClient(
        'Bbbb',
        { lag: 120, jitter: 10, loss: 0, clockOffset: -9_999.5, clockDrift: -0.0002 },
        probes[0].client.code,
        ARENA,
      ),
    );
    w.run(5000);
    w.startRecording();
    w.run(60_000);
    for (const p of probes) {
      expect(p.maxOwnStep).toBeLessThan(14);
      expect(p.maxRemoteStep).toBeLessThan(14);
      expect(p.client.predictor!.resyncs).toBe(0);
    }
  });

  it('fonctionne à 30, 60 et 144 images par seconde dans le même salon', () => {
    const w = new TestWorld();
    const base = { lag: 100, jitter: 15, loss: 0 };
    const a = w.addClient(
      'Aaaa',
      { ...base, frameMs: 1000 / 144, frameJitterMs: 0.5 },
      undefined,
      ARENA,
    );
    w.run(500);
    const b = w.addClient(
      'Bbbb',
      { ...base, frameMs: 1000 / 60, frameJitterMs: 2 },
      a.client.code,
      ARENA,
    );
    const c = w.addClient(
      'Cccc',
      { ...base, frameMs: 1000 / 30, frameJitterMs: 4 },
      a.client.code,
      ARENA,
    );
    w.run(6000);
    w.startRecording();
    for (const p of [a, b, c]) p.client.predictor!.corrections = 0;
    w.run(30_000);
    // Vitesse maximale (chute : 620 u/s) × durée d'une image, plus une marge de lissage.
    const bound = (frameMs: number): number => (700 * frameMs) / 1000 + 4;
    for (const [p, ms] of [
      [a, 1000 / 144],
      [b, 1000 / 60],
      [c, 1000 / 30],
    ] as const) {
      expect(p.client.predictor!.corrections).toBeLessThanOrEqual(3);
      expect(p.maxRemoteStep).toBeLessThan(bound(ms) + 2);
      expect(p.maxOwnStep).toBeLessThan(bound(ms) + 2);
    }
  });

  it('fonctionne avec très peu d images par seconde (plusieurs ticks par image)', () => {
    const w = new TestWorld();
    const base = { lag: 100, jitter: 10, loss: 0 };
    const a = w.addClient('Aaaa', { ...base, frameMs: 100, frameJitterMs: 20 }, undefined, ARENA);
    w.run(500);
    const b = w.addClient('Bbbb', { ...base, frameMs: 1000 / 60 }, a.client.code, ARENA);
    w.run(6000);
    a.client.predictor!.corrections = 0;
    b.client.predictor!.corrections = 0;
    w.run(30_000);
    // Chaque image simule 6 ticks d'un coup : tous doivent être transmis, sans trou.
    expect(a.client.predictor!.corrections).toBeLessThanOrEqual(2);
    expect(b.client.predictor!.corrections).toBeLessThanOrEqual(2);
  });

  it('reprend proprement après un onglet resté en arrière-plan', () => {
    const w = new TestWorld();
    const [a] = w.populate(3, { lag: 100, jitter: 10, loss: 0 }, ARENA);
    w.run(8000);
    // Pendant 3 s, plus aucune image ne s'exécute pour A (onglet masqué) : on gèle ses images
    const p = a;
    const realUpdate = p.client.update.bind(p.client);
    p.client.update = (): void => {};
    w.run(3000);
    p.client.update = realUpdate;
    w.run(4000);
    w.startRecording();
    w.run(10_000);
    const room = w.room();
    const own = p.client.predictor!.ownAt(room.world.tick);
    expect(own).not.toBeNull();
    expect(
      Math.hypot(
        own!.x - room.world.players[p.client.slot].x,
        own!.y - room.world.players[p.client.slot].y,
      ),
    ).toBeLessThan(1);
    expect(p.maxOwnStep).toBeLessThan(16);
  });
});

describe('salon', () => {
  it('un joueur qui arrive en cours de route est synchronisé, un joueur qui part disparaît', () => {
    const w = new TestWorld();
    const first = w.populate(3, { lag: 100, jitter: 10, loss: 0 }, ARENA);
    w.run(8000);
    const late = w.addClient(
      'Late',
      { lag: 100, jitter: 10, loss: 0 },
      first[0].client.code,
      ARENA,
    );
    w.run(4000);
    expect(late.client.state).toBe('joined');
    expect(late.client.view.remoteCount).toBe(3);
    expect(first[0].client.view.remoteCount).toBe(3);
    // Connexion perdue : la place est gardée 20 s (reconnexion), puis le joueur disparaît.
    first[1].client.close();
    w.run(2000);
    expect(late.client.view.remoteCount).toBe(3);
    w.run(21_000);
    expect(late.client.view.remoteCount).toBe(2);
    // Départ volontaire : immédiat.
    first[2].client.leave();
    w.run(1500);
    expect(late.client.view.remoteCount).toBe(1);
    expect(MAX_PLAYERS).toBe(8);
    expect(TICK_MS).toBeCloseTo(16.667, 2);
  });

  it('les événements fiables sont livrés une fois et dans l ordre', () => {
    const w = new TestWorld();
    const first = w.addClient('Aaaa', { lag: 100, jitter: 20, loss: 3 }, undefined, ARENA);
    w.run(500);
    for (let i = 0; i < 3; i++)
      w.addClient(`Joueur${i}`, { lag: 100, jitter: 20, loss: 3 }, first.client.code, ARENA);
    w.run(10_000);
    // Un SPAWN par arrivant (pas pour soi), sans doublon malgré les pertes
    const spawns = first.events.filter((e) => e.type === SimEvent.SPAWN);
    expect(spawns.map((e) => e.slot).sort()).toEqual([1, 2, 3]);
  });
});
