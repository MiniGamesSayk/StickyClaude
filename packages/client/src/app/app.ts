import { effect } from '@preact/signals';
import { GamePhase, getArena, INK_COLORS, TICK_HZ } from '@stickyclaude/shared';
import { COUNTDOWN_TICKS } from '@stickyclaude/sim';
import type { ArenaData, Look } from '@stickyclaude/shared';
import { h, render } from 'preact';
import { AudioEngine } from '../audio/engine.ts';
import type { Mood } from '../audio/engine.ts';
import { NetGraph } from '../dev/netgraph.ts';
import { setLang, t } from '../i18n/index.ts';
import { loadLayoutMap } from '../input/bindings.ts';
import { InputManager } from '../input/manager.ts';
import { isTouchDevice, resetTouch, vibrate } from '../input/touch.ts';
import { loadFonts } from '../render/fonts.ts';
import { Renderer } from '../render/renderer.ts';
import { startReplay } from '../replay.ts';
import { padNavigate } from '../ui/padnav.ts';
import { App } from '../ui/App.tsx';
import { touchActive } from '../ui/device.ts';
import { enterFullscreen } from '../ui/TouchControls.tsx';
import { Online } from './online.ts';
import { options, profile } from './options.ts';
import type { Options } from './options.ts';
import { MENU_ARENA_ID, PREVIEW_CAMERA, PreviewSource } from './preview.ts';
import { SoloSource } from './solo.ts';
import type { Haptics, RenderSource } from './source.ts';
import {
  actions,
  EMPTY_HUD,
  hud,
  lobby,
  mode,
  net,
  overlay,
  podium,
  roster,
  say,
  screen,
  training,
  urlCode,
} from './store.ts';

/** Mouvement réduit effectif : l'option, ou le réglage du système si elle est sur « auto ». */
export function reducedMotion(o: Options): boolean {
  return (
    o.reducedMotion === 'on' ||
    (o.reducedMotion === 'auto' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

/** Point d'entrée de l'application : rendu, entrées, son, interface, réseau. */
export async function startApp(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  const mobile = isTouchDevice();
  await Promise.all([loadFonts(), loadLayoutMap()]);

  const renderer = new Renderer();
  await renderer.init(document.getElementById('game') as HTMLElement, {
    quality: options.value.quality,
    reducedMotion: reducedMotion(options.value),
    mobile,
  });

  const replayUrl = params.get('replay');
  if (replayUrl) {
    const info = document.createElement('div');
    info.style.cssText =
      'position:fixed;left:8px;top:8px;background:#fbf7ea;padding:4px 8px;z-index:20';
    document.body.append(info);
    await startReplay(replayUrl, renderer, (text) => {
      info.textContent = text;
    });
    return;
  }

  const input = new InputManager();
  const audio = new AudioEngine();
  const haptics: Haptics = {
    hit: (strength) => {
      input.gamepad.rumble(strength, 120 + strength * 120);
      if (options.value.vibration) vibrate(Math.round(20 + strength * 40));
    },
  };

  const menuArena = getArena(MENU_ARENA_ID) as ArenaData;
  const preview = new PreviewSource(profile.value.look, profile.value.name);
  let source: RenderSource = preview;
  let solo: SoloSource | null = null;
  let graph: NetGraph | null = null;
  let debug = params.get('debug') === '1';
  const graphCanvas = document.getElementById('netgraph') as HTMLCanvasElement;
  let fps = 60;
  let hudAt = 0;
  let lastNow = performance.now();

  const showMenu = (): void => {
    mode.value = 'menu';
    source = preview;
    renderer.setArena(menuArena);
    renderer.reset();
    renderer.setSelf(-1);
    renderer.setCameraOverride(PREVIEW_CAMERA);
    renderer.setColorSource(
      (slot) => INK_COLORS[(slot === 0 ? profile.value.look.color : slot) % 12],
    );
    graphCanvas.hidden = true;
    document.getElementById('tuning')?.setAttribute('hidden', '');
    graph = null;
    hud.value = EMPTY_HUD;
    resetTouch();
  };

  // --- Réseau -----------------------------------------------------------------------------------

  const online = new Online({
    renderer,
    audio,
    haptics,
    onEnter: () => {
      mode.value = 'online';
      overlay.value = null;
      source = online.source as RenderSource;
      renderer.setCameraOverride(null);
      const c = online.client;
      if (c) {
        graph = new NetGraph(graphCanvas, c);
        graphCanvas.hidden = !debug;
        if (import.meta.env.DEV && c.devTools) {
          void import('../dev/tuning.ts').then((m) =>
            m.mountTuning(document.getElementById('tuning') as HTMLElement, c),
          );
        }
      }
    },
    onExit: showMenu,
  });

  // --- Actions de l'interface --------------------------------------------------------------------

  const cleanName = (): string => profile.value.name.trim();
  const goFullscreen = (): void => {
    if (options.value.autoFullscreen && touchActive()) enterFullscreen();
  };

  Object.assign(actions, {
    quick: () => {
      goFullscreen();
      audio.unlock();
      online.quick(cleanName(), profile.value.look);
    },
    create: (isPublic: boolean) => {
      goFullscreen();
      audio.unlock();
      online.create(cleanName(), profile.value.look, isPublic, params.get('arena') ?? undefined);
    },
    join: (code: string) => {
      goFullscreen();
      audio.unlock();
      online.join(cleanName(), code, profile.value.look);
    },
    leave: () => online.leave(),
    ready: (r: boolean) => online.client?.ready(r),
    start: () => online.client?.start(),
    settings: (p: Parameters<typeof actions.settings>[0]) => online.client?.settings(p),
    teams: (o: Parameters<typeof actions.teams>[0]) => online.client?.teams(o),
    kick: (slot: number) => online.client?.kick(slot),
    look: (look: Look) => online.client?.setLook(look),
    emote: (id: number) => {
      if (solo) solo.emote(id);
      else online.client?.emote(id);
    },
    copyLink: () => {
      const c = online.client;
      if (!c) return;
      const url = `${location.origin}${location.pathname}?salon=${c.code}`;
      void navigator.clipboard?.writeText(url).catch(() => undefined);
      say(t('lobby.copied'));
    },
    preview: (look: Look, emote: number, victory: number) => {
      preview.setLook(look, profile.value.name);
      if (emote > 0) renderer.playEmote(0, emote);
      if (victory >= 0) preview.celebrate(performance.now());
    },
    solo: () => {
      goFullscreen();
      audio.unlock();
      const look = profile.value.look;
      solo = new SoloSource({
        name: profile.value.name,
        look,
        audio,
        onEvent: (e) => renderer.addEvent(e),
        onObjectives: (list, done) => {
          training.value = list;
          if (done.length > 0) say(t('train.done'));
        },
        onHit: (s) => haptics.hit(s),
      });
      mode.value = 'solo';
      source = solo;
      renderer.setArena(solo.world.arena);
      renderer.reset();
      renderer.setSelf(0);
      renderer.setCameraOverride(null);
      renderer.setColorSource((slot) => (slot === 0 ? INK_COLORS[look.color % 12] : 0x6b7280));
      roster.value = [{ name: profile.value.name, color: INK_COLORS[look.color % 12], team: -1 }];
      hud.value = { ...EMPTY_HUD };
    },
    quitSolo: () => {
      solo?.dispose();
      solo = null;
      training.value = null;
      overlay.value = null;
      showMenu();
    },
    resetTraining: () => solo?.resetProgress(),
    resume: () => undefined,
    cancelReconnect: () => online.cancelResume(),
    captureKey: (cb: ((code: string) => void) | null) => input.keyboard.capture(cb),
  });

  // --- Options appliquées en continu ----------------------------------------------------------------

  effect(() => {
    const o = options.value;
    setLang(o.lang);
    root.style.setProperty('--text-scale', String(o.textScale / 100));
    root.style.setProperty('--touch-size', String(o.touchSize));
    const reduced = reducedMotion(o);
    root.dataset.motion = reduced ? 'reduced' : 'full';
    renderer.setOptions({ quality: o.quality, reducedMotion: reduced, mobile });
    renderer.ticker.maxFPS = o.fpsCap;
    input.apply(o);
    audio.setVolumes(o.master, o.sfx, o.music);
  });
  effect(() => {
    // l'entraînement s'arrête quand une fenêtre est ouverte (pause)
    if (solo) solo.paused = overlay.value !== null;
    root.dataset.touch = touchActive() ? 'on' : 'off';
    root.dataset.playing = mode.value === 'menu' ? 'off' : 'on';
    input.keyboard.enabled = mode.value !== 'menu' && overlay.value === null;
  });
  effect(() => {
    // l'aperçu suit le profil
    const p = profile.value;
    preview.setLook(p.look, p.name);
  });

  // --- Clavier : emotes, pause, graphe réseau -----------------------------------------------------------

  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  const clickable = 'button, [role="radio"], [role="tab"], select, summary, a[href]';
  document.addEventListener(
    'pointerover',
    (e) => {
      if (e.target instanceof Element && e.target.closest(clickable)) audio.cue('ui_hover', 0.45);
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof Element && e.target.closest(clickable)) audio.cue('ui_click', 0.7);
    },
    true,
  );
  window.addEventListener('keydown', (e) => {
    audio.unlock();
    const tg = e.target;
    const typing =
      tg instanceof HTMLInputElement ||
      tg instanceof HTMLTextAreaElement ||
      tg instanceof HTMLSelectElement;
    if (e.code === 'F3') {
      e.preventDefault();
      debug = !debug;
      graphCanvas.hidden = !debug || mode.value !== 'online';
      return;
    }
    if (typing || e.repeat) return;
    if (e.code === 'Escape') {
      if (overlay.value !== null) return; // la fenêtre ouverte gère Échap elle-même
      if (mode.value !== 'menu') overlay.value = 'pause';
      else if (screen.value === 'customize') screen.value = 'home';
      return;
    }
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && mode.value !== 'menu' && overlay.value === null) {
      if (mode.value === 'solo' || (online.client?.state === 'joined' && online.slot >= 0)) {
        actions.emote(Number(m[1]) - 1);
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetTouch();
  });

  // --- Boucle de rendu ---------------------------------------------------------------------------------

  const sessionKeep = (): void => online.pulse(performance.now(), fps);
  /** Ambiance musicale selon l'écran et la phase de la partie. */
  const moodOf = (): [Mood, number] => {
    if (mode.value === 'menu') return ['menu', 0];
    if (mode.value === 'solo') return ['training', 0];
    const h = hud.value;
    if (!h.inMatch || h.phase === GamePhase.LOBBY) return ['menu', 0];
    return ['combat', h.round];
  };
  let moodAt = 0;
  let padFocus = false;
  let lastCount = -1;
  let wentGo = false;
  renderer.ticker.add((tk) => {
    const now = performance.now();
    const dt = now - lastNow;
    lastNow = now;
    fps += (tk.FPS - fps) * 0.05;
    // Manette : dans les menus, la croix et A naviguent ; en jeu, Start ouvre la pause (dans le
    // salon, il donne la main au panneau : croix et A, puis B ou Start pour revenir au jeu).
    // `navigate` est appelé à chaque image pour garder à jour la détection des appuis.
    const lobbyOpen =
      mode.value === 'online' && online.active && lobby.value?.phase === GamePhase.LOBBY;
    if (!lobbyOpen) padFocus = false;
    const menuMode =
      mode.value === 'menu' ||
      overlay.value !== null ||
      (online.client !== null && !online.active) ||
      podium.value !== null ||
      padFocus;
    const nav = input.gamepad.navigate(now);
    if (nav) {
      if (menuMode) {
        if (padFocus && overlay.value === null && (nav.menu || nav.back)) {
          padFocus = false;
          (document.activeElement as HTMLElement | null)?.blur();
        } else padNavigate(nav);
      } else if (nav.menu) {
        if (lobbyOpen) {
          padFocus = true;
          padNavigate({ dx: 0, dy: 1, confirm: false, back: false, menu: false });
        } else overlay.value = 'pause';
      }
    }
    const playing =
      mode.value !== 'menu' && overlay.value === null && !padFocus && podium.value === null;
    const mask = playing ? input.sample() : 0;
    if (!playing) input.sample();
    source.update(mask, now, dt);
    renderer.render(source.scene);
    if (now - moodAt > 250) {
      moodAt = now;
      const [mood, rd] = moodOf();
      audio.setMood(mood, rd);
    }
    if (mode.value === 'online') {
      // décompte 3-2-1-Go : un tic par chiffre, un sifflement au départ
      const h = hud.value;
      if (h.phase === GamePhase.COUNTDOWN) {
        const left = Math.ceil((COUNTDOWN_TICKS - h.phaseTick) / TICK_HZ);
        if (left !== lastCount && left > 0) audio.cue('count_tick');
        lastCount = left;
        wentGo = false;
      } else {
        if (h.phase === GamePhase.PLAYING && lastCount > 0 && !wentGo) {
          audio.cue('count_go');
          wentGo = true;
        }
        if (h.phase !== GamePhase.PLAYING) lastCount = -1;
      }
      sessionKeep();
      graph?.update(now);
    } else if (now - hudAt > 250) {
      hudAt = now;
      hud.value = { ...hud.value, fps };
    }
  });

  // --- Démarrage -------------------------------------------------------------------------------------------

  // Le code du lien (?salon=) est connu avant le premier rendu : le champ « Rejoindre » le reprend.
  const salon = params.get('salon');
  if (salon) urlCode.value = salon.toUpperCase();
  const name = params.get('name');
  if (name) profile.value = { ...profile.value, name };

  showMenu();
  const html = document.documentElement;
  html.lang = options.value.lang;
  render(h(App, {}), document.getElementById('ui') as HTMLElement);
  // Prise pour les tests (E2E, mesures de performance) : ne sert pas au jeu lui-même.
  (window as unknown as { __stickyclaude: unknown }).__stickyclaude = {
    renderer,
    online,
    actions,
    net,
    overlay,
    get client() {
      return online.client;
    },
    get source() {
      return source;
    },
  };

  void online.refreshRooms();
  setInterval(() => {
    if (mode.value === 'menu' && !document.hidden) void online.refreshRooms();
  }, 3000);

  if (params.get('solo') === '1') {
    actions.solo();
  } else if (params.get('auto') === '1') {
    if (salon) actions.join(salon);
    else actions.create(false);
  } else if (!salon && !online.tryResumeSaved()) {
    net.value = { status: 'idle', error: null };
  }
}
