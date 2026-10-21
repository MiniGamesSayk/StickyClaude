import { getArena, PlayerFlag } from '@stickyclaude/shared';
import type { ErrorCode, RosterEntry } from '@stickyclaude/shared';
import { GamepadInput } from './input/gamepad.ts';
import { KeyboardInput } from './input/keyboard.ts';
import { GameClient } from './net/client.ts';
import { LagTransport, parseLagOptions, WebSocketTransport } from './net/transport.ts';
import type { Transport } from './net/transport.ts';
import { Renderer } from './render/renderer.ts';
import type { DrawPlayer } from './render/renderer.ts';
import { startReplay } from './replay.ts';
import { Ui } from './ui.ts';
import { NetGraph } from './dev/netgraph.ts';

const ERRORS: Record<ErrorCode, string> = {
  version: 'Version du jeu incompatible : recharge la page.',
  bad_request: 'Requête invalide.',
  bad_name: 'Pseudo invalide (2 à 16 caractères).',
  not_found: 'Aucun salon avec ce code.',
  full: 'Ce salon est plein.',
  server_full: 'Le serveur est plein, réessaie dans un instant.',
  rate_limited: 'Trop d’essais, patiente un peu.',
  already_joined: 'Tu es déjà dans un salon.',
  not_joined: 'Tu n’es dans aucun salon.',
  forbidden: 'Action interdite.',
};

function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} manquant`);
  return e as T;
}

/** Point d'entrée de l'application : rendu, entrées, interface, réseau. */
export async function startApp(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const renderer = new Renderer();
  await renderer.init(byId('game'));
  const hud = byId('hud');
  const menu = byId('menu');

  const replayUrl = params.get('replay');
  if (replayUrl) {
    menu.hidden = true;
    hud.hidden = false;
    hud.textContent = 'Chargement…';
    await startReplay(replayUrl, renderer, (t) => {
      hud.textContent = t;
    });
    return;
  }

  const keyboard = new KeyboardInput(window);
  const gamepad = new GamepadInput();
  const lagOptions = parseLagOptions(location.search);
  const graphCanvas = byId<HTMLCanvasElement>('netgraph');
  let client: GameClient | null = null;
  let graph: NetGraph | null = null;
  let debug = params.get('debug') === '1';
  let fps = 60;
  let hudAt = 0;

  const ui: Ui = new Ui(menu, hud, {
    onCreate: (name) => connect((c) => c.create(name, params.get('arena') ?? undefined)),
    onJoin: (name, code) => connect((c) => c.join(name, code)),
    onLeave: () => client?.leave(),
    onCopyLink: () => {
      if (!client) return;
      const url = `${location.origin}${location.pathname}?salon=${client.code}`;
      void navigator.clipboard.writeText(url);
    },
  });

  const wsUrl = (): string =>
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function connect(action: (c: GameClient) => void): void {
    client?.close();
    let transport: Transport = new WebSocketTransport(wsUrl());
    if (lagOptions) transport = new LagTransport(transport, lagOptions);
    const c = new GameClient(transport, {
      onJoined: (m) => {
        const arena = getArena(m.arena);
        if (arena) renderer.setArena(arena);
        ui.hideMenu();
        if (import.meta.env.DEV && m.devTools) {
          void import('./dev/tuning.ts').then((t) => t.mountTuning(byId('tuning'), c));
        }
        graph = new NetGraph(graphCanvas, c);
        graphCanvas.hidden = !debug;
      },
      onError: (code, msg) => ui.showError(ERRORS[code] + (msg ? ` (${msg})` : '')),
      onLeft: () => {
        graphCanvas.hidden = true;
        byId('tuning').hidden = true;
        ui.showMenu();
      },
      onClosed: () => {
        if (client === c) ui.showDisconnected();
      },
    });
    client = c;
    (window as unknown as { __stickyclaude: unknown }).__stickyclaude = { client: c, renderer };
    action(c);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      debug = !debug;
      graphCanvas.hidden = !debug || !client || client.state !== 'joined';
    }
  });

  const players: DrawPlayer[] = [];
  const ghost = { x: 0, y: 0, visible: false };

  renderer.ticker.add((t) => {
    fps += (t.FPS - fps) * 0.05;
    const c = client;
    if (!c || c.state !== 'joined' || !c.predictor) return;
    c.update(keyboard.sample() | gamepad.sample());

    const names = new Map<number, RosterEntry>();
    for (const r of c.roster) names.set(r.slot, r);
    players.length = 0;
    const v = c.view;
    const params2 = c.predictor.world.params;
    for (let i = 0; i < v.remoteCount; i++) {
      const r = v.remotes[i];
      const info = names.get(r.slot);
      players.push({
        slot: r.slot,
        x: r.x,
        y: r.y,
        facing: (r.flags & PlayerFlag.FACING_RIGHT) !== 0 ? 1 : -1,
        crouching: (r.flags & PlayerFlag.CROUCHING) !== 0,
        flags: r.flags,
        state: r.anim,
        self: false,
        name: info?.name ?? '',
        color: info?.color ?? r.slot,
      });
    }
    if (v.own.visible) {
      const info = names.get(c.slot);
      players.push({
        slot: c.slot,
        x: v.own.x,
        y: v.own.y,
        facing: v.own.facing,
        crouching: v.own.crouching,
        flags: 0,
        state: v.own.state,
        self: true,
        name: info?.name ?? '',
        color: info?.color ?? c.slot,
      });
    }
    ghost.x = v.ghostX;
    ghost.y = v.ghostY;
    ghost.visible = v.ghostVisible;
    renderer.render({
      players,
      movers: c.predictor.world.movers,
      moverCount: c.predictor.world.moverCount,
      moverTick: v.moverTick,
      remoteTick: v.remoteTick,
      params: params2,
      ghost,
      debug,
    });

    const now = performance.now();
    graph?.update(now);
    if (now - hudAt > 250) {
      hudAt = now;
      ui.updateHud({
        code: c.code,
        roster: c.roster,
        selfSlot: c.slot,
        host: c.host,
        rttMs: c.stats.rttMs,
        fps,
      });
    }
  });

  // Préremplissage depuis l'URL : ?salon=CODE (et ?auto=1&name=… pour entrer directement).
  const salon = params.get('salon');
  if (salon) ui.prefillCode(salon);
  const name = params.get('name');
  if (name) ui.prefillName(name);
  if (params.get('auto') === '1') {
    if (salon) connect((c) => c.join(name ?? 'Joueur', salon));
    else connect((c) => c.create(name ?? 'Joueur', params.get('arena') ?? undefined));
  }
}
