import {
  getArena,
  INK_COLORS,
  PlayerFlag,
  PlayerState,
  RECONNECT_GRACE_MS,
  SimEvent,
} from '@stickyclaude/shared';
import type { Look, PlayerInfo, PublicRoom } from '@stickyclaude/shared';
import { GamepadInput } from './input/gamepad.ts';
import { KeyboardInput } from './input/keyboard.ts';
import { GameClient } from './net/client.ts';
import type { GameEvent } from './net/client.ts';
import { LagTransport, parseLagOptions, WebSocketTransport } from './net/transport.ts';
import type { Transport } from './net/transport.ts';
import { loadFonts } from './render/fonts.ts';
import { Renderer } from './render/renderer.ts';
import type { DrawPlayer } from './render/renderer.ts';
import { startReplay } from './replay.ts';
import { NetGraph } from './dev/netgraph.ts';
import { button, byId, el, storeGet, storeRemove, storeSet } from './ui/dom.ts';
import { Hud } from './ui/hud.ts';
import type { HudState } from './ui/hud.ts';
import { LobbyPanel, TEAM_COLORS } from './ui/lobby.ts';
import { Menu } from './ui/menu.ts';
import { ERRORS } from './ui/texts.ts';

const SESSION_KEY = 'stickyclaude.session';

interface SavedSession {
  token: string;
  code: string;
  /** Dernier instant (ms, horloge murale) où la connexion était vivante. */
  at: number;
}

function loadSession(): SavedSession | null {
  const raw = storeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SavedSession;
    if (typeof s.token === 'string' && typeof s.code === 'string' && typeof s.at === 'number')
      return s;
  } catch {
    /* illisible */
  }
  return null;
}

/** Point d'entrée de l'application : rendu, entrées, interface, réseau. */
export async function startApp(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const renderer = new Renderer();
  await loadFonts();
  await renderer.init(byId('game'));
  const hudEl = byId('hud');
  const menuEl = byId('menu');

  const replayUrl = params.get('replay');
  if (replayUrl) {
    menuEl.hidden = true;
    hudEl.hidden = false;
    hudEl.textContent = 'Chargement…';
    await startReplay(replayUrl, renderer, (t) => {
      hudEl.textContent = t;
    });
    return;
  }

  const keyboard = new KeyboardInput(window);
  const gamepad = new GamepadInput();
  const lagOptions = parseLagOptions(location.search);
  const graphCanvas = byId<HTMLCanvasElement>('netgraph');
  const overlayEl = byId('overlay');
  let client: GameClient | null = null;
  let graph: NetGraph | null = null;
  let debug = params.get('debug') === '1';
  let fps = 60;
  let hudAt = 0;
  let sessionAt = 0;
  let leaving = false;
  let reconnect: { until: number; attempt: number; token: string; code: string } | null = null;
  let teamsMode = false;
  /** Emplacements gagnants de la manche (masque de bits) : ils font leur emote de victoire. */
  let winnersMask = 0;

  // --- Interface --------------------------------------------------------------------------------

  const menu: Menu = new Menu(menuEl, {
    onQuick: (name, look) => connect((c) => c.quick(name, look)),
    onCreate: (name, look, isPublic) =>
      connect((c) => c.create(name, { arena: params.get('arena') ?? undefined, isPublic, look })),
    onJoin: (name, code, look) => connect((c) => c.join(name, code, look)),
  });

  const hud = new Hud(hudEl);

  const lobbyPanel = new LobbyPanel(
    byId('lobby'),
    {
      onLeave: () => {
        leaving = true;
        client?.leave();
      },
      onCopyLink: () => {
        if (!client) return;
        const url = `${location.origin}${location.pathname}?salon=${client.code}`;
        void navigator.clipboard.writeText(url);
        hud.say('Lien copié', client.code, 1500);
      },
      onReady: (r) => client?.ready(r),
      onStart: () => client?.start(),
      onSettings: (p) => client?.settings(p),
      onTeams: (o) => client?.teams(o),
      onKick: (slot) => client?.kick(slot),
      onLook: (look: Look) => client?.setLook(look),
      onEmote: (id) => client?.emote(id),
    },
    menu.lookValue,
  );
  lobbyPanel.hide();

  function showOverlay(title: string, text: string, actions: HTMLElement[] = []): void {
    overlayEl.hidden = false;
    overlayEl.replaceChildren(
      el(
        'div',
        { class: 'card' },
        el('h1', {}, title),
        el('p', { class: 'sub' }, text),
        ...actions,
      ),
    );
  }

  function hideOverlay(): void {
    overlayEl.hidden = true;
    overlayEl.replaceChildren();
  }

  /** Retour à l'accueil : salon quitté, expulsé ou reprise impossible. */
  function backToMenu(message?: string): void {
    reconnect = null;
    leaving = false;
    storeRemove(SESSION_KEY);
    hideOverlay();
    hud.hide();
    lobbyPanel.hide();
    renderer.reset();
    graphCanvas.hidden = true;
    byId('tuning').hidden = true;
    menu.show();
    if (message) menu.showError(message);
  }

  // --- Connexion et reconnexion -------------------------------------------------------------------

  const wsUrl = (): string =>
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function connect(action: (c: GameClient) => void): GameClient {
    const previous = client;
    let transport: Transport = new WebSocketTransport(wsUrl());
    if (lagOptions) transport = new LagTransport(transport, lagOptions);
    let wasJoined = false;
    const c: GameClient = new GameClient(transport, {
      onJoined: (m) => {
        if (client !== c) return;
        wasJoined = true;
        reconnect = null;
        hideOverlay();
        const arena = getArena(m.round.arena);
        if (arena) renderer.setArena(arena);
        renderer.reset();
        renderer.setColorSource((slot) => colorOfSlot(slot));
        renderer.setSelf(m.slot);
        menu.hide();
        hud.show();
        hud.hidePodium();
        hud.setRoster(m.lobby.players);
        teamsMode = m.lobby.settings.mode === 'teams';
        lobbyPanel.update(m.lobby, m.slot);
        lobbyPanel.syncLook(m.lobby.players.find((p) => p.slot === m.slot)?.look ?? menu.lookValue);
        setLobbyVisible(m.lobby.phase === 0);
        persistSession(c);
        if (import.meta.env.DEV && m.devTools) {
          void import('./dev/tuning.ts').then((t) => t.mountTuning(byId('tuning'), c));
        }
        graph = new NetGraph(graphCanvas, c);
        graphCanvas.hidden = !debug;
      },
      onLobby: (l) => {
        if (client !== c) return;
        hud.setRoster(l.players);
        teamsMode = l.settings.mode === 'teams';
        lobbyPanel.update(l, c.slot);
        const inLobby = l.phase === 0;
        setLobbyVisible(inLobby);
        if (inLobby) hud.hidePodium();
      },
      onRound: (r, arena) => {
        if (client !== c) return;
        renderer.setArena(arena);
        renderer.reset();
        winnersMask = 0;
        hud.clearBanner();
        if (r.round > 0) hud.hidePodium();
      },
      onScores: (m) => {
        if (client !== c) return;
        winnersMask = 0;
        if (m.winner >= 0 && c.round) {
          for (let sl = 0; sl < 8; sl++) {
            const t = c.round.teams[sl];
            if (t >= 0 && (teamsMode ? t === m.winner : sl === m.winner)) winnersMask |= 1 << sl;
          }
        }
        hud.roundEnd(m, teamsMode);
      },
      onResults: (m) => {
        if (client !== c) return;
        hud.showPodium(m);
      },
      onEvent: (e) => {
        if (client !== c) return;
        onGameEvent(e);
      },
      onError: (code, msg) => {
        if (client !== c) return;
        const text = ERRORS[code] + (msg ? ` (${msg})` : '');
        if (reconnect && code === 'bad_token') {
          backToMenu(text);
        } else if (c.state === 'joined') {
          hud.say(text, '', 2600);
        } else if (!reconnect) {
          menu.showError(text);
        }
      },
      onLeft: (reason) => {
        if (client !== c) return;
        const msg =
          reason === 'kicked'
            ? 'Tu as été expulsé du salon.'
            : reason === 'idle'
              ? 'Tu as été retiré du salon pour inactivité.'
              : reason === 'closed' && !leaving
                ? 'Le salon a été fermé.'
                : undefined;
        backToMenu(msg);
      },
      onClosed: () => {
        if (client !== c) return;
        if (reconnect) {
          scheduleResume();
        } else if (wasJoined && !leaving) {
          beginReconnect(c);
        } else if (!wasJoined) {
          menu.showError('Serveur injoignable. Réessaie dans un instant.');
        }
      },
    });
    client = c;
    previous?.close();
    (window as unknown as { __stickyclaude: unknown }).__stickyclaude = {
      client: c,
      renderer,
      hud,
    };
    action(c);
    return c;
  }

  function persistSession(c: GameClient): void {
    if (!c.token) return;
    const s: SavedSession = { token: c.token, code: c.code, at: Date.now() };
    storeSet(SESSION_KEY, JSON.stringify(s));
  }

  function beginReconnect(c: GameClient): void {
    if (!c.token) return backToMenu('Connexion perdue.');
    reconnect = {
      until: performance.now() + RECONNECT_GRACE_MS,
      attempt: 0,
      token: c.token,
      code: c.code,
    };
    showOverlay('Connexion perdue', 'Reconnexion en cours…');
    tryResume();
  }

  function scheduleResume(): void {
    const r = reconnect;
    if (!r) return;
    const delay = Math.min(2500, 400 * 2 ** Math.min(r.attempt, 3));
    setTimeout(tryResume, delay);
  }

  function tryResume(): void {
    const r = reconnect;
    if (!r) return;
    if (performance.now() > r.until) {
      backToMenu('Impossible de reprendre ta place : le délai est dépassé.');
      return;
    }
    r.attempt++;
    connect((c) => c.resume(r.token, r.code));
  }

  function setLobbyVisible(visible: boolean): void {
    if (visible) lobbyPanel.show();
    else lobbyPanel.hide();
  }

  // --- Événements de jeu --------------------------------------------------------------------------

  function infoOf(slot: number): PlayerInfo | undefined {
    return client?.lobby?.players.find((p) => p.slot === slot);
  }

  function colorOfSlot(slot: number): number {
    const info = infoOf(slot);
    return INK_COLORS[(info?.look.color ?? slot) % INK_COLORS.length];
  }

  function onGameEvent(e: GameEvent): void {
    renderer.addEvent(e);
    if (e.type === SimEvent.KO) {
      hud.feed(hud.koText(e.slot, e.a[2] ?? 255, e.a[3] ?? 0), colorOfSlot(e.slot));
    }
  }

  // --- Clavier : emotes et graphe réseau ------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing =
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement;
    if (e.code === 'F3') {
      e.preventDefault();
      debug = !debug;
      graphCanvas.hidden = !debug || !client || client.state !== 'joined';
      return;
    }
    if (typing || e.repeat) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && client?.state === 'joined' && client.slot >= 0) client.emote(Number(m[1]) - 1);
  });

  // --- Boucle de rendu ----------------------------------------------------------------------------

  const players: DrawPlayer[] = [];
  const ghost = { x: 0, y: 0, visible: false };

  renderer.ticker.add((t) => {
    fps += (t.FPS - fps) * 0.05;
    const c = client;
    if (!c || c.state !== 'joined' || !c.world) return;
    c.update(keyboard.sample() | gamepad.sample());

    const world = c.world;
    const v = c.view;
    const lobby = c.lobby;
    const byslot = new Map<number, PlayerInfo>();
    if (lobby) for (const p of lobby.players) byslot.set(p.slot, p);
    players.length = 0;
    for (let i = 0; i < v.remoteCount; i++) {
      const r = v.remotes[i];
      const info = byslot.get(r.slot);
      players.push({
        slot: r.slot,
        x: r.x,
        y: r.y,
        vx: r.vx,
        vy: r.vy,
        facing: (r.flags & PlayerFlag.FACING_RIGHT) !== 0 ? 1 : -1,
        crouching: (r.flags & PlayerFlag.CROUCHING) !== 0,
        flags: r.flags,
        state: r.anim,
        animProg: r.animProg,
        variant: r.variant,
        hp: r.hp,
        weapon: r.weapon,
        ammo: r.ammo,
        aim: r.aim,
        self: false,
        name: info?.name ?? '',
        color: info?.look.color ?? r.slot,
        team: teamsMode ? (info?.team ?? -1) : -1,
        stroke: info?.look.stroke ?? 0,
        hat: info?.look.hat ?? 0,
        victory: info?.look.victory ?? 0,
        mannequin: false,
      });
    }
    const o = v.own;
    if (o.visible || o.ghost) {
      const info = byslot.get(c.slot);
      players.push({
        slot: c.slot,
        x: o.ghost ? o.cursorX : o.x,
        y: o.ghost ? o.cursorY : o.y,
        vx: o.vx,
        vy: o.vy,
        facing: o.facing,
        crouching: o.crouching,
        flags: o.flags,
        state: o.ghost ? PlayerState.GHOST : o.state,
        animProg: o.animProg,
        variant: o.variant,
        hp: o.hp,
        weapon: o.weapon,
        ammo: o.ammo,
        aim: o.aim,
        self: true,
        name: info?.name ?? '',
        color: info?.look.color ?? c.slot,
        team: teamsMode ? (info?.team ?? -1) : -1,
        stroke: info?.look.stroke ?? 0,
        hat: info?.look.hat ?? 0,
        victory: info?.look.victory ?? 0,
        mannequin: false,
      });
    }
    ghost.x = v.ghostX;
    ghost.y = v.ghostY;
    ghost.visible = v.ghostVisible;
    renderer.render({
      world,
      players,
      objects: v.objects,
      objectCount: v.objectCount,
      projectiles: v.projectiles,
      projCount: v.projCount,
      moverTick: v.moverTick,
      remoteTick: v.remoteTick,
      params: world.params,
      game: c.game,
      ghost,
      debug,
      teamColors: teamsMode ? TEAM_COLORS : null,
      winners: winnersMask,
    });

    const now = performance.now();
    graph?.update(now);
    if (Date.now() - sessionAt > 2000) {
      sessionAt = Date.now();
      persistSession(c);
    }
    if (now - hudAt > 100) {
      hudAt = now;
      const state: HudState = {
        phase: c.game.phase,
        phaseTick: c.game.phaseTick,
        mode: c.game.mode,
        modeData: c.game.modeData,
        round: c.round,
        lobby,
        selfSlot: c.slot,
        hp: o.hp,
        weapon: o.weapon,
        ammo: o.ammo,
        ghost: o.ghost,
        ghostCd: o.ghostCd,
        dead: o.dead,
        rttMs: c.stats.rttMs,
        fps,
        inMatch: c.game.phase !== 0,
        teamsMode,
      };
      hud.update(state);
      lobbyPanel.setStat(`${Math.round(c.stats.rttMs)} ms · ${Math.round(fps)} FPS`);
    }
  });

  // --- Salons publics et démarrage ------------------------------------------------------------------

  async function refreshRooms(): Promise<void> {
    if (menuEl.hidden) return;
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) menu.setRooms((await res.json()) as PublicRoom[]);
    } catch {
      /* serveur injoignable : la liste reste telle quelle */
    }
  }
  void refreshRooms();
  setInterval(() => void refreshRooms(), 3000);

  // Préremplissage depuis l'URL : ?salon=CODE (et ?auto=1&name=… pour entrer directement).
  const salon = params.get('salon');
  if (salon) menu.prefillCode(salon);
  const name = params.get('name');
  if (name) menu.prefillName(name);
  if (params.get('auto') === '1') {
    if (salon) connect((c) => c.join(name ?? 'Joueur', salon));
    else connect((c) => c.create(name ?? 'Joueur', { arena: params.get('arena') ?? undefined }));
    return;
  }

  // Page rechargée peu après une coupure : on tente de reprendre sa place.
  const saved = loadSession();
  if (saved && Date.now() - saved.at < RECONNECT_GRACE_MS - 3000 && !salon) {
    reconnect = {
      until: performance.now() + RECONNECT_GRACE_MS - (Date.now() - saved.at),
      attempt: 0,
      token: saved.token,
      code: saved.code,
    };
    showOverlay('Reprise de la partie', 'Reconnexion en cours…', [
      button('Annuler', () => backToMenu(), { secondary: true }),
    ]);
    tryResume();
  } else if (saved) {
    storeRemove(SESSION_KEY);
  }
}
