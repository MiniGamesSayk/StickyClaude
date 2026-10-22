import { SimEvent, WeaponId } from '@stickyclaude/shared';
import type { AudioSink } from '../app/source.ts';
import type { GameEvent } from '../net/client.ts';

/**
 * Moteur audio (analyse §1.10) : Web Audio, sons synthétisés par `scripts/gen-audio` (Opus, moins
 * de 400 Ko). Déverrouillé à la première interaction, coupé quand l'onglet est caché, hauteur
 * variée de ±5 % contre la répétition, 16 voix au plus, stéréo selon la position x, mixeur
 * (général, effets, musique), chargement paresseux après le premier écran.
 */

export const MAX_VOICES = 16;
export const PITCH_VARIATION = 0.05;
/** Largeur de la page, pour la stéréo. */
const PAGE_W = 1024;

/** Nom d'un effet (clé du manifeste). */
export type SfxName =
  | 'step'
  | 'jump'
  | 'double_jump'
  | 'wall_jump'
  | 'land'
  | 'drop'
  | 'swing'
  | 'hit'
  | 'hit_heavy'
  | 'block'
  | 'parry'
  | 'ko'
  | 'shot_pistol'
  | 'shot_shotgun'
  | 'shot_blow'
  | 'shot_plane'
  | 'shot_bazooka'
  | 'explosion'
  | 'terrain'
  | 'eraser'
  | 'grapple'
  | 'throw'
  | 'stamp'
  | 'crate'
  | 'pickup'
  | 'weapon_spawn'
  | 'emote'
  | 'spawn'
  | 'goal'
  | 'page_turn'
  | 'count_tick'
  | 'count_go'
  | 'victory'
  | 'sudden'
  | 'ui_hover'
  | 'ui_click';

/** Priorité : une voix plus importante prend la place d'une moins importante quand c'est plein. */
const PRIORITY: Partial<Record<SfxName, number>> = {
  ko: 5,
  explosion: 5,
  victory: 5,
  goal: 5,
  sudden: 5,
  parry: 4,
  hit_heavy: 4,
  shot_bazooka: 4,
  hit: 3,
  block: 3,
  count_go: 4,
  count_tick: 3,
  page_turn: 3,
  step: 1,
  ui_hover: 1,
};

export type MusicName = 'menu' | 'combat1' | 'combat2' | 'tension';
export type Mood = 'silent' | 'menu' | 'training' | 'combat' | 'tension';

interface Manifest {
  sfx: Record<string, { file: string }>;
  music: Record<string, { file: string }>;
}

interface Voice {
  src: AudioBufferSourceNode;
  end: number;
  prio: number;
}

/** Ce que le moteur demande au navigateur : de quoi tester sans lui. */
export interface AudioDeps {
  createContext: () => AudioContext;
  fetchBytes: (url: string) => Promise<ArrayBuffer>;
  random: () => number;
  baseUrl: string;
}

const defaultDeps = (): AudioDeps => ({
  createContext: () =>
    new (
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )(),
  fetchBytes: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} : ${r.status}`);
    return r.arrayBuffer();
  },
  random: Math.random,
  baseUrl: '/audio/',
});

/** Pas de course : un « pas » toutes les 30 unités parcourues. */
const STEP_DISTANCE = 30;

export class AudioEngine implements AudioSink {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private manifest: Manifest | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Set<string>();
  private voices: Voice[] = [];
  private broken = false;
  private unlocked = false;
  private vol = { master: 0.8, sfx: 1, music: 0.6 };
  private music: { name: MusicName; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantMusic: MusicName | null = null;
  private tension = false;
  private lastStepX = Number.NaN;
  private stepAcc = 0;
  private lastPlayed = new Map<string, number>();
  private duckUntil = 0;
  /** Effets joués (tests, mesures). */
  played = 0;

  constructor(private readonly deps: AudioDeps = defaultDeps()) {}

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get activeVoices(): number {
    this.prune();
    return this.voices.length;
  }

  get currentMusic(): MusicName | null {
    return this.music?.name ?? null;
  }

  private ensure(): AudioContext | null {
    if (this.broken) return null;
    if (this.ctx) return this.ctx;
    try {
      const ctx = this.deps.createContext();
      const master = ctx.createGain();
      const sfx = ctx.createGain();
      const music = ctx.createGain();
      sfx.connect(master);
      music.connect(master);
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.sfxBus = sfx;
      this.musicBus = music;
      this.applyVolumes();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!this.ctx) return;
          if (document.hidden) void this.ctx.suspend();
          else if (this.unlocked) void this.ctx.resume();
        });
      }
    } catch {
      this.broken = true;
      return null;
    }
    return this.ctx;
  }

  /** Premier geste de l'utilisateur : le navigateur autorise enfin le son. */
  unlock(): void {
    // pas de geste de l'utilisateur encore : le navigateur refuserait (et avertirait) ; le premier clic ou la première touche relancera
    const ua = typeof navigator === 'undefined' ? undefined : navigator.userActivation;
    if (ua && !ua.hasBeenActive) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.unlocked = true;
    void ctx.resume();
    void this.preload();
    this.startWanted();
  }

  /** Volumes du mixeur (0 à 1) : général, effets, musique. Courbe carrée pour l'oreille. */
  setVolumes(master: number, sfx: number, music: number): void {
    this.vol = { master, sfx, music };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    this.master.gain.value = this.vol.master ** 2;
    this.sfxBus.gain.value = this.vol.sfx ** 2;
    this.musicBus.gain.value = this.vol.music ** 2 * 0.55;
  }

  // --- Chargement paresseux ---------------------------------------------------------------------

  /** Charge le manifeste puis les effets (≈ 50 Ko) ; les musiques à la demande. */
  async preload(): Promise<void> {
    const ctx = this.ensure();
    if (!ctx || this.manifest) return;
    try {
      this.manifest = JSON.parse(
        new TextDecoder().decode(await this.deps.fetchBytes(`${this.deps.baseUrl}manifest.json`)),
      ) as Manifest;
    } catch {
      return;
    }
    await Promise.all(Object.keys(this.manifest.sfx).map((n) => this.load('sfx', n)));
    this.startWanted();
  }

  private async load(kind: 'sfx' | 'music', name: string): Promise<AudioBuffer | null> {
    const key = `${kind}/${name}`;
    const have = this.buffers.get(key);
    if (have) return have;
    const entry = this.manifest?.[kind][name];
    const ctx = this.ctx;
    if (!entry || !ctx || this.loading.has(key) || this.broken) return null;
    this.loading.add(key);
    try {
      const bytes = await this.deps.fetchBytes(`${this.deps.baseUrl}${entry.file}`);
      const buf = await ctx.decodeAudioData(bytes);
      this.buffers.set(key, buf);
      return buf;
    } catch {
      // format non pris en charge ou réseau : on joue sans ce son
      return null;
    } finally {
      this.loading.delete(key);
    }
  }

  // --- Effets -------------------------------------------------------------------------------------

  private prune(): void {
    const now = this.ctx?.currentTime ?? 0;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  /** Joue un effet. `x` : position (monde) pour la stéréo ; `vol` : 0 à 1. */
  play(name: SfxName, opts: { x?: number; vol?: number; pitch?: number } = {}): boolean {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.unlocked) return false;
    const buf = this.buffers.get(`sfx/${name}`);
    if (!buf) return false;
    // limite par effet : jamais deux fois le même en moins de 30 ms (rafales)
    const last = this.lastPlayed.get(name) ?? -1;
    if (ctx.currentTime - last < 0.03) return false;
    this.prune();
    const prio = PRIORITY[name] ?? 2;
    if (this.voices.length >= MAX_VOICES) {
      let victim = -1;
      let low = prio;
      for (let i = 0; i < this.voices.length; i++) {
        if (this.voices[i].prio < low || (this.voices[i].prio === low && victim < 0)) {
          low = this.voices[i].prio;
          victim = i;
        }
      }
      if (victim < 0) return false;
      try {
        this.voices[victim].src.stop();
      } catch {
        /* déjà arrêtée */
      }
      this.voices.splice(victim, 1);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const variation = (this.deps.random() * 2 - 1) * PITCH_VARIATION;
    src.playbackRate.value = (opts.pitch ?? 1) * (1 + variation);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, opts.vol ?? 1));
    src.connect(gain);
    if (opts.x !== undefined && typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, ((opts.x - PAGE_W / 2) / (PAGE_W / 2)) * 0.8));
      gain.connect(pan);
      pan.connect(bus);
    } else {
      gain.connect(bus);
    }
    src.start();
    this.lastPlayed.set(name, ctx.currentTime);
    this.voices.push({ src, end: ctx.currentTime + buf.duration / src.playbackRate.value, prio });
    this.played++;
    return true;
  }

  /** Raccourci pour l'interface, le décompte et les transitions. */
  cue(name: SfxName, vol = 1): void {
    this.play(name, { vol });
  }

  /** Événement de la simulation (réseau ou local) : le bon son, à la bonne place. */
  event(e: GameEvent, own: number): void {
    const a = e.a;
    switch (e.type) {
      case SimEvent.HIT: {
        const flags = a[4] ?? 0;
        if ((flags & 2) !== 0) this.play('block', { x: a[0] });
        else if ((flags & 1) !== 0 || (a[3] ?? 0) >= 12) this.play('hit_heavy', { x: a[0] });
        else this.play('hit', { x: a[0], vol: 0.85 });
        break;
      }
      case SimEvent.KO:
        this.play('ko', { x: a[0] });
        break;
      case SimEvent.BLOCKED:
        this.play((a[3] ?? 0) === 1 ? 'parry' : 'block', { x: a[0] });
        break;
      case SimEvent.SHOT: {
        const w = a[4] ?? 0;
        const name: SfxName =
          w === WeaponId.SHOTGUN
            ? 'shot_shotgun'
            : w === WeaponId.BLOWGUN
              ? 'shot_blow'
              : w === WeaponId.PLANE_LAUNCHER
                ? 'shot_plane'
                : w === WeaponId.BAZOOKA
                  ? 'shot_bazooka'
                  : 'shot_pistol';
        this.play(name, { x: a[0] });
        break;
      }
      case SimEvent.EXPLOSION:
        this.play((a[3] ?? 0) === 4 ? 'crate' : 'explosion', { x: a[0] });
        break;
      case SimEvent.TERRAIN:
        this.play('terrain', { x: ((a[0] ?? 0) + 0.5) * 16 });
        break;
      case SimEvent.WEAPON_SPAWN:
        this.play('weapon_spawn', { x: a[0], vol: 0.8 });
        break;
      case SimEvent.PICKUP:
        this.play('pickup', { vol: (a[0] ?? -1) === own ? 1 : 0.6 });
        break;
      case SimEvent.HEAL:
        this.play('pickup', { x: a[0], vol: e.slot === own ? 1 : 0.55 });
        break;
      case SimEvent.THROW:
        this.play('throw', { vol: (a[0] ?? -1) === own ? 1 : 0.7 });
        break;
      case SimEvent.SPAWN:
        this.play('spawn', { x: a[0], vol: e.slot === own ? 1 : 0.6 });
        break;
      case SimEvent.EMOTE:
        this.play('emote', { vol: 0.8 });
        break;
      case SimEvent.GRAPPLE:
        this.play('grapple', { x: a[0] });
        break;
      case SimEvent.CRATE_BREAK:
        this.play('crate', { x: a[0] });
        break;
      case SimEvent.STAMP:
        this.play('stamp', { x: a[0] });
        break;
      case SimEvent.GOAL:
        this.play('goal', { x: a[1] });
        break;
      case SimEvent.SUDDEN_DEATH:
        this.play('sudden');
        this.tension = true;
        this.refreshMusic();
        break;
      case SimEvent.GHOST_DRAW:
        this.play('eraser', { vol: 0.45 });
        break;
      default:
        break;
    }
  }

  /** Mouvements du joueur local : saut, double saut, saut mural, atterrissage, début de coup. */
  local(type: number, x: number, _y: number, arg: number): void {
    switch (type) {
      case SimEvent.JUMP:
        this.play('jump', { x, vol: 0.7 });
        break;
      case SimEvent.DOUBLE_JUMP:
        this.play('double_jump', { x, vol: 0.7 });
        break;
      case SimEvent.WALL_JUMP:
        this.play('wall_jump', { x, vol: 0.75 });
        break;
      case SimEvent.LAND:
        this.play('land', { x, vol: Math.max(0.3, Math.min(1, arg / 600)) });
        break;
      case SimEvent.DROP_THROUGH:
        this.play('drop', { x, vol: 0.6 });
        break;
      case SimEvent.SWING:
        this.play('swing', { x, vol: 0.6 });
        break;
      default:
        break;
    }
  }

  /** À appeler à chaque image où le joueur local court : un pas toutes les 30 unités. */
  footstep(x: number, speed: number): void {
    if (Number.isNaN(this.lastStepX)) this.lastStepX = x;
    this.stepAcc += Math.abs(x - this.lastStepX);
    this.lastStepX = x;
    if (speed < 20) {
      this.stepAcc = 0;
      return;
    }
    if (this.stepAcc >= STEP_DISTANCE) {
      this.stepAcc = 0;
      this.play('step', { x, vol: 0.45 });
    }
  }

  // --- Musique ---------------------------------------------------------------------------------------

  /**
   * Choisit la musique selon l'ambiance : menu, entraînement, combat (deux boucles qui alternent
   * selon la manche), tension (mort subite). Fondu enchaîné de 0,8 s.
   */
  setMood(mood: Mood, round = 0): void {
    if (mood !== 'tension' && mood !== 'combat') this.tension = false;
    if (mood === 'combat' && this.tension) mood = 'tension';
    let next: MusicName | null;
    switch (mood) {
      case 'silent':
        next = null;
        break;
      case 'menu':
      case 'training':
        next = 'menu';
        break;
      case 'tension':
        next = 'tension';
        break;
      default:
        next = round % 2 === 0 ? 'combat1' : 'combat2';
    }
    if (next === this.wantMusic) return;
    this.wantMusic = next;
    this.startWanted();
  }

  /** Nouvelle manche : la tension de la précédente retombe. */
  newRound(): void {
    this.tension = false;
  }

  private refreshMusic(): void {
    if (this.wantMusic === 'combat1' || this.wantMusic === 'combat2') {
      this.wantMusic = 'tension';
      this.startWanted();
    }
  }

  /** Atténue la musique quelques secondes (fin de manche, victoire). */
  duck(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    this.duckUntil = ctx.currentTime + seconds;
    const g = this.music.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0.3, ctx.currentTime, 0.1);
    g.setTargetAtTime(1, ctx.currentTime + seconds, 0.4);
  }

  private startWanted(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || !this.unlocked) return;
    const want = this.wantMusic;
    const cur = this.music;
    if (cur && want === cur.name) return;
    if (cur) {
      const g = cur.gain.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
      const old = cur.src;
      setTimeout(() => {
        try {
          old.stop();
        } catch {
          /* déjà arrêtée */
        }
      }, 900);
      this.music = null;
    }
    if (!want) return;
    void this.load('music', want).then((buf) => {
      if (!buf || this.wantMusic !== want || this.music) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.8);
      src.connect(gain);
      gain.connect(bus);
      src.start();
      this.music = { name: want, src, gain };
    });
  }
}
