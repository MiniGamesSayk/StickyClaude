import { SimEvent, WeaponId } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { AudioEngine, MAX_VOICES, PITCH_VARIATION } from '../src/audio/engine.ts';
import type { AudioDeps, SfxName } from '../src/audio/engine.ts';

/** Faux Web Audio : suffisant pour vérifier les décisions du moteur. */
class FakeParam {
  value = 1;
  cancelScheduledValues(): void {}
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
}
class FakeNode {
  gain = new FakeParam();
  pan = new FakeParam();
  disconnected = 0;
  connect(n: unknown): unknown {
    return n;
  }
  disconnect(): void {
    this.disconnected++;
  }
}
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  onended: (() => void) | null = null;
  playbackRate = new FakeParam();
  started = 0;
  stopped = 0;
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}
class FakeContext {
  currentTime = 0;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  state = 'suspended';
  nodes: FakeNode[] = [];
  createGain(): FakeNode {
    const n = new FakeNode();
    this.nodes.push(n);
    return n;
  }
  createStereoPanner(): FakeNode {
    return new FakeNode();
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  decodeAudioData(): Promise<{ duration: number }> {
    return Promise.resolve({ duration: 0.5 });
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

const MANIFEST = {
  sfx: Object.fromEntries(
    [
      'hit',
      'hit_heavy',
      'block',
      'parry',
      'ko',
      'step',
      'jump',
      'land',
      'explosion',
      'shot_pistol',
      'shot_shotgun',
      'count_tick',
      'victory',
    ].map((n) => [n, { file: `sfx/${n}.opus` }]),
  ),
  music: Object.fromEntries(
    ['menu', 'combat1', 'combat2', 'tension'].map((n) => [n, { file: `music/${n}.opus` }]),
  ),
};

async function make(
  random = () => 0.5,
  fetches: string[] = [],
): Promise<{ audio: AudioEngine; ctx: FakeContext }> {
  const ctx = new FakeContext();
  const deps: AudioDeps = {
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: (url) => {
      fetches.push(url);
      return Promise.resolve(
        url.endsWith('manifest.json')
          ? new TextEncoder().encode(JSON.stringify(MANIFEST)).buffer
          : new ArrayBuffer(8),
      );
    },
    random,
    baseUrl: '/audio/',
  };
  const audio = new AudioEngine(deps);
  audio.unlock();
  await audio.preload();
  return { audio, ctx };
}

const ev = (type: number, slot: number, ...a: number[]) => ({ tick: 0, type, slot, a });

describe('AudioEngine', () => {
  it('ne joue rien avant le premier geste de l’utilisateur', () => {
    const audio = new AudioEngine({
      createContext: () => new FakeContext() as unknown as AudioContext,
      fetchBytes: () => Promise.reject(new Error('non')),
      random: () => 0.5,
      baseUrl: '/audio/',
    });
    expect(audio.play('hit')).toBe(false);
    expect(audio.isUnlocked).toBe(false);
  });

  it('après déverrouillage et chargement, joue les effets', async () => {
    const { audio, ctx } = await make();
    expect(audio.isUnlocked).toBe(true);
    expect(ctx.state).toBe('running');
    expect(audio.play('hit')).toBe(true);
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0].started).toBe(1);
  });

  it('un contexte suspendu est relancé au prochain son', async () => {
    const { audio, ctx } = await make();
    ctx.state = 'suspended';
    audio.play('hit');
    expect(ctx.state).toBe('running');
  });

  it('un geste de plus ne relance pas le chargement', async () => {
    const fetches: string[] = [];
    const { audio } = await make(() => 0.5, fetches);
    const n = fetches.length;
    audio.unlock();
    audio.unlock();
    await audio.preload();
    expect(fetches).toHaveLength(n);
  });

  it('le graphe audio se démonte à la fin du son', async () => {
    const { audio, ctx } = await make();
    audio.play('hit', { x: 100 });
    const src = ctx.sources[0];
    const gain = ctx.nodes.at(-1)!;
    expect(src.disconnected).toBe(0);
    src.onended?.();
    expect(src.disconnected).toBe(1);
    expect(gain.disconnected).toBe(1);
  });

  it('un effet inconnu ou non chargé est ignoré sans erreur', async () => {
    const { audio } = await make();
    expect(audio.play('pickup')).toBe(false);
  });

  it('la hauteur varie de ±5 % au plus', async () => {
    const lo = await make(() => 0);
    lo.audio.play('hit');
    expect(lo.ctx.sources[0].playbackRate.value).toBeCloseTo(1 - PITCH_VARIATION, 5);
    const hi = await make(() => 0.9999999);
    hi.audio.play('hit');
    expect(hi.ctx.sources[0].playbackRate.value).toBeLessThanOrEqual(1 + PITCH_VARIATION);
    expect(hi.ctx.sources[0].playbackRate.value).toBeGreaterThan(1);
  });

  it('jamais deux fois le même effet en moins de 30 ms (rafales)', async () => {
    const { audio, ctx } = await make();
    expect(audio.play('hit')).toBe(true);
    expect(audio.play('hit')).toBe(false);
    ctx.currentTime += 0.05;
    expect(audio.play('hit')).toBe(true);
  });

  it(`au plus ${MAX_VOICES} voix : une voix importante prend la place d’une voix anodine`, async () => {
    const { audio, ctx } = await make();
    const names: SfxName[] = [
      'hit',
      'block',
      'jump',
      'land',
      'step',
      'count_tick',
      'shot_pistol',
      'shot_shotgun',
    ];
    // remplit les voix avec des effets de priorité basse, un par 20 ms
    for (let i = 0; i < MAX_VOICES; i++) {
      ctx.currentTime += 0.02;
      expect(audio.play(names[i % names.length])).toBe(true);
    }
    expect(audio.activeVoices).toBe(MAX_VOICES);
    ctx.currentTime += 0.02;
    expect(audio.play('ko')).toBe(true);
    expect(audio.activeVoices).toBeLessThanOrEqual(MAX_VOICES);
    // un effet plus faible que tout le monde est refusé quand c'est plein de priorités hautes
    for (let i = 0; i < MAX_VOICES; i++) {
      ctx.currentTime += 0.02;
      audio.play('ko');
      ctx.currentTime += 0.02;
      audio.play('explosion');
    }
    expect(audio.play('step')).toBe(false);
  });

  it('les événements de la simulation donnent le bon son', async () => {
    const { audio, ctx } = await make();
    const played = (): number => ctx.sources.length;
    audio.event(ev(SimEvent.HIT, 1, 100, 100, 0, 22, 1), 0);
    expect(played()).toBe(1); // coup fort
    ctx.currentTime += 0.1;
    audio.event(ev(SimEvent.HIT, 1, 100, 100, 0, 5, 2), 0);
    expect(played()).toBe(2); // paré
    ctx.currentTime += 0.1;
    audio.event(ev(SimEvent.BLOCKED, 1, 100, 100, 0, 1), 0);
    expect(played()).toBe(3);
    ctx.currentTime += 0.1;
    audio.event(ev(SimEvent.SHOT, 1, 10, 10, 90, 10, WeaponId.SHOTGUN), 0);
    expect(played()).toBe(4);
    ctx.currentTime += 0.1;
    audio.event(ev(SimEvent.KO, 1, 100, 100, 0, 1), 0);
    expect(played()).toBe(5);
  });

  it('les mouvements locaux : saut, atterrissage (volume selon la vitesse)', async () => {
    const { audio, ctx } = await make();
    audio.local(SimEvent.JUMP, 300, 400, 0);
    expect(ctx.sources.length).toBe(1);
    ctx.currentTime += 0.1;
    audio.local(SimEvent.LAND, 300, 400, 620);
    expect(ctx.sources.length).toBe(2);
  });

  it('les pas : un toutes les 30 unités parcourues, jamais à l’arrêt', async () => {
    const { audio, ctx } = await make();
    let n = 0;
    for (let x = 0; x < 300; x += 3) {
      ctx.currentTime += 0.02;
      audio.footstep(x, 190);
      n = ctx.sources.length;
    }
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(11);
    const before = ctx.sources.length;
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.05;
      audio.footstep(300, 0);
    }
    expect(ctx.sources.length).toBe(before);
  });

  it('la musique suit l’ambiance : menu, combat qui alterne, tension, silence', async () => {
    const { audio, ctx } = await make();
    audio.setMood('menu');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.currentMusic).toBe('menu');
    audio.setMood('combat', 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.currentMusic).toBe('combat2');
    audio.setMood('combat', 2);
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.currentMusic).toBe('combat1');
    audio.event(ev(SimEvent.SUDDEN_DEATH, 0, 0), 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.currentMusic).toBe('tension');
    audio.newRound();
    audio.setMood('combat', 3);
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.currentMusic).toBe('combat2');
    audio.setMood('silent');
    await new Promise((r) => setTimeout(r, 0));
    expect(audio.currentMusic).toBeNull();
    // les boucles bouclent
    expect(ctx.sources.some((s) => s.loop)).toBe(true);
  });

  it('un navigateur sans Web Audio ne fait pas planter le jeu', () => {
    const audio = new AudioEngine({
      createContext: () => {
        throw new Error('pas de Web Audio');
      },
      fetchBytes: () => Promise.reject(new Error('non')),
      random: () => 0.5,
      baseUrl: '/audio/',
    });
    audio.unlock();
    expect(audio.play('hit')).toBe(false);
    audio.setMood('combat', 1);
    audio.event(ev(SimEvent.KO, 0, 1, 1), 0);
  });
});
