import {
  Cause,
  getArena,
  INK_COLORS,
  PlayerFlag,
  PlayerState,
  RECONNECT_GRACE_MS,
  SimEvent,
} from '@stickyclaude/shared';
import type { LobbyView, Look, PlayerInfo, PublicRoom } from '@stickyclaude/shared';
import type { World } from '@stickyclaude/sim';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { GameClient } from '../net/client.ts';
import type { GameEvent, ResultsMessage, ScoresMessage } from '../net/client.ts';
import { LagTransport, parseLagOptions, WebSocketTransport } from '../net/transport.ts';
import type { Transport } from '../net/transport.ts';
import type { ObjView, ProjView } from '../net/interpolation.ts';
import type { Renderer } from '../render/renderer.ts';
import type { Scene } from '../render/types.ts';
import { TEAM_COLORS } from '../render/palette.ts';
import { createScene } from './scene.ts';
import { nullAudio, nullHaptics } from './source.ts';
import type { AudioSink, Haptics, RenderSource } from './source.ts';
import {
  banner,
  hud,
  killFeed,
  lobby,
  net,
  podium,
  lastScores,
  rooms,
  round,
  say,
  selfSlot,
  roster,
} from './store.ts';
import type { HudData } from './store.ts';

const SESSION_KEY = 'stickyclaude.session';
/** Code de fermeture WebSocket « Service Restart » : le serveur redémarre (mise à jour). */
export const CLOSE_SERVICE_RESTART = 1012;
/** Durée de reconnexion tolérée pendant une mise à jour du serveur (ms). */
const MAINTENANCE_GRACE_MS = 90_000;

interface SavedSession {
  token: string;
  code: string;
  at: number;
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    if (typeof s.token === 'string' && typeof s.code === 'string' && typeof s.at === 'number') {
      return s;
    }
  } catch {
    /* illisible */
  }
  return null;
}

function saveSession(s: SavedSession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* stockage indisponible */
  }
}

export interface OnlineDeps {
  renderer: Renderer;
  audio?: AudioSink;
  haptics?: Haptics;
  /** Utile à l'application : on est entré dans un salon, ou on en est sorti. */
  onEnter: () => void;
  onExit: () => void;
  /** Affiche l'accueil avec un message (clé de message). */
  onError?: (key: MessageKey | null, raw?: string) => void;
}

const ERROR_KEYS: Record<string, MessageKey> = {
  version: 'err.version',
  bad_request: 'err.bad_request',
  bad_name: 'err.bad_name',
  not_found: 'err.not_found',
  full: 'err.full',
  server_full: 'err.server_full',
  rate_limited: 'err.rate_limited',
  already_joined: 'err.already_joined',
  not_joined: 'err.not_joined',
  forbidden: 'err.forbidden',
  not_host: 'err.not_host',
  not_enough_players: 'err.not_enough_players',
  not_ready: 'err.not_ready',
  in_game: 'err.in_game',
  bad_token: 'err.bad_token',
};

const CAUSE_KEYS: Record<number, MessageKey> = {
  [Cause.NONE]: 'cause.none',
  [Cause.MELEE]: 'cause.melee',
  [Cause.KICK]: 'cause.kick',
  [Cause.WEAPON_MELEE]: 'cause.weapon_melee',
  [Cause.BULLET]: 'cause.bullet',
  [Cause.PROJECTILE]: 'cause.projectile',
  [Cause.EXPLOSION]: 'cause.explosion',
  [Cause.THROWN]: 'cause.thrown',
  [Cause.HAZARD]: 'cause.hazard',
  [Cause.FALL]: 'cause.fall',
  [Cause.INK]: 'cause.ink',
  [Cause.MINE]: 'cause.mine',
  [Cause.POTATO]: 'cause.potato',
  [Cause.BALLOON]: 'cause.balloon',
  [Cause.GHOST]: 'cause.ghost',
  [Cause.TACK]: 'cause.tack',
};

/** Le jeu en ligne : connexion, reconnexion, état du salon dans le store, source de scène. */
export class Online {
  client: GameClient | null = null;
  source: OnlineSource | null = null;
  private leaving = false;
  private reconnect: {
    until: number;
    attempt: number;
    token: string;
    code: string;
    maintenance: boolean;
  } | null = null;
  private teamsMode = false;
  private winners = 0;
  private feedId = 0;
  private bannerKey = 0;
  private sessionAt = 0;
  private hudAt = 0;
  private readonly lag = parseLagOptions(location.search);
  private readonly audio: AudioSink;
  private readonly haptics: Haptics;
  private names: { name: string; color: number; team: number }[] = [];

  constructor(private readonly d: OnlineDeps) {
    this.audio = d.audio ?? nullAudio;
    this.haptics = d.haptics ?? nullHaptics;
  }

  get slot(): number {
    return this.client?.slot ?? -1;
  }

  get active(): boolean {
    return this.client !== null && this.client.state === 'joined';
  }

  // --- Entrées de l'accueil -------------------------------------------------------------------

  quick(name: string, look: Look): void {
    this.connect((c) => c.quick(name, look));
  }

  create(name: string, look: Look, isPublic: boolean, arena?: string): void {
    this.connect((c) => c.create(name, { arena, isPublic, look }));
  }

  join(name: string, code: string, look: Look): void {
    this.connect((c) => c.join(name, code.trim().toUpperCase(), look));
  }

  /** Reprise de sa place après un rechargement de la page. Retourne vrai si une reprise est tentée. */
  tryResumeSaved(): boolean {
    const saved = loadSession();
    if (saved && Date.now() - saved.at < RECONNECT_GRACE_MS - 3000) {
      this.reconnect = {
        until: performance.now() + RECONNECT_GRACE_MS - (Date.now() - saved.at),
        attempt: 0,
        token: saved.token,
        code: saved.code,
        maintenance: false,
      };
      net.value = { status: 'reconnecting', error: null };
      this.tryResume();
      return true;
    }
    if (saved) saveSession(null);
    return false;
  }

  cancelResume(): void {
    this.reconnect = null;
    this.backToMenu(null);
  }

  leave(): void {
    this.leaving = true;
    this.client?.leave();
  }

  // --- Connexion ------------------------------------------------------------------------------

  private wsUrl(): string {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  private connect(action: (c: GameClient) => void): void {
    const previous = this.client;
    let transport: Transport = new WebSocketTransport(this.wsUrl());
    if (this.lag) transport = new LagTransport(transport, this.lag);
    net.value = { status: this.reconnect ? net.value.status : 'connecting', error: null };
    let wasJoined = false;
    const c: GameClient = new GameClient(transport, {
      onJoined: (m) => {
        if (this.client !== c) return;
        wasJoined = true;
        this.reconnect = null;
        const arena = getArena(m.round.arena);
        const r = this.d.renderer;
        if (arena) r.setArena(arena);
        r.reset();
        r.setColorSource((slot) => this.colorOfSlot(slot));
        r.setSelf(m.slot);
        this.winners = 0;
        this.setRoster(m.lobby.players);
        this.teamsMode = m.lobby.settings.mode === 'teams';
        lobby.value = m.lobby;
        selfSlot.value = m.slot;
        round.value = m.round;
        net.value = { status: 'joined', error: null };
        podium.value = null;
        this.persist(c);
        this.source = new OnlineSource(c, this);
        this.d.onEnter();
      },
      onLobby: (l) => {
        if (this.client !== c) return;
        this.setRoster(l.players);
        this.teamsMode = l.settings.mode === 'teams';
        lobby.value = l;
        if (l.phase === 0) podium.value = null;
      },
      onRound: (r, arena) => {
        if (this.client !== c) return;
        const rr = this.d.renderer;
        // la page se tourne entre deux manches, puis la nouvelle arène se dessine
        if (r.round > 0) {
          rr.turnPage();
          this.audio.cue('page_turn');
        }
        this.audio.newRound();
        rr.setArena(arena, r.round > 0);
        rr.reset();
        this.winners = 0;
        round.value = r;
        banner.value = null;
        killFeed.value = [];
        if (r.round > 0) podium.value = null;
      },
      onScores: (m) => {
        if (this.client !== c) return;
        this.winners = 0;
        if (m.winner >= 0 && c.round) {
          for (let sl = 0; sl < 8; sl++) {
            const tm = c.round.teams[sl];
            if (tm >= 0 && (this.teamsMode ? tm === m.winner : sl === m.winner)) {
              this.winners |= 1 << sl;
            }
          }
        }
        lastScores.value = m;
        this.roundBanner(m);
        if (m.winner >= 0) this.audio.cue('victory', 0.8);
        this.audio.duck(3.5);
      },
      onResults: (m) => {
        if (this.client !== c) return;
        podium.value = m;
      },
      onEvent: (e) => {
        if (this.client !== c) return;
        this.d.renderer.addEvent(e);
        this.audio.event(e, c.slot);
        this.onGameEvent(e, c.slot);
      },
      onLocalEvent: (e) => {
        if (this.client !== c) return;
        this.audio.local(e.type, e.x, e.y, e.arg);
      },
      onError: (code, msg) => {
        if (this.client !== c) return;
        const key = ERROR_KEYS[code] ?? 'err.bad_request';
        if (this.reconnect && code === 'bad_token') {
          // Après une mise à jour du serveur, les salons n'existent plus : pas un délai dépassé.
          this.backToMenu(this.reconnect.maintenance ? 'msg.server_restarted' : key);
        } else if (c.state === 'joined') {
          say(t(key) + (msg ? ` (${msg})` : ''));
        } else if (!this.reconnect) {
          net.value = { status: 'idle', error: t(key) + (msg ? ` (${msg})` : '') };
        }
      },
      onLeft: (reason) => {
        if (this.client !== c) return;
        const key: MessageKey | null =
          reason === 'kicked'
            ? 'msg.kicked'
            : reason === 'idle'
              ? 'msg.idle'
              : reason === 'closed' && !this.leaving
                ? 'msg.closed'
                : null;
        this.backToMenu(key);
      },
      onShutdown: (inMs) => {
        if (this.client !== c) return;
        say(t('msg.shutdown', { s: Math.max(1, Math.round(inMs / 1000)) }));
      },
      onClosed: (code) => {
        if (this.client !== c) return;
        const restart = code === CLOSE_SERVICE_RESTART;
        if (this.reconnect) {
          if (restart) this.reconnect.maintenance = true;
          this.scheduleResume();
        } else if (wasJoined && !this.leaving) {
          this.beginReconnect(c, restart);
        } else if (!wasJoined) {
          net.value = { status: 'idle', error: t('err.unreachable') };
        }
      },
    });
    this.client = c;
    previous?.close();
    action(c);
  }

  private persist(c: GameClient): void {
    if (c.token) saveSession({ token: c.token, code: c.code, at: Date.now() });
  }

  private beginReconnect(c: GameClient, maintenance: boolean): void {
    if (!c.token) {
      this.backToMenu('msg.connection_lost');
      return;
    }
    this.reconnect = {
      until: performance.now() + (maintenance ? MAINTENANCE_GRACE_MS : RECONNECT_GRACE_MS),
      attempt: 0,
      token: c.token,
      code: c.code,
      maintenance,
    };
    net.value = { status: maintenance ? 'maintenance' : 'reconnecting', error: null };
    this.tryResume();
  }

  private scheduleResume(): void {
    const r = this.reconnect;
    if (!r) return;
    const delay = Math.min(r.maintenance ? 4000 : 2500, 400 * 2 ** Math.min(r.attempt, 3));
    setTimeout(() => this.tryResume(), delay);
  }

  private tryResume(): void {
    const r = this.reconnect;
    if (!r) return;
    if (performance.now() > r.until) {
      this.backToMenu('msg.resume_failed');
      return;
    }
    r.attempt++;
    net.value = { status: r.maintenance ? 'maintenance' : 'reconnecting', error: null };
    this.connect((c) => c.resume(r.token, r.code));
  }

  /** Retour à l'accueil : salon quitté, expulsé ou reprise impossible. */
  backToMenu(key: MessageKey | null): void {
    this.reconnect = null;
    this.leaving = false;
    saveSession(null);
    this.source = null;
    this.client = null;
    lobby.value = null;
    selfSlot.value = -1;
    round.value = null;
    podium.value = null;
    banner.value = null;
    killFeed.value = [];
    hud.value = { ...hud.value, inMatch: false, phase: 0 };
    net.value = { status: 'idle', error: key ? t(key) : null };
    this.d.renderer.reset();
    this.d.onExit();
  }

  // --- Salons publics ---------------------------------------------------------------------------

  async refreshRooms(): Promise<void> {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) rooms.value = (await res.json()) as PublicRoom[];
    } catch {
      /* serveur injoignable : la liste reste telle quelle */
    }
  }

  // --- Événements -------------------------------------------------------------------------------

  private setRoster(players: PlayerInfo[]): void {
    for (const p of players) {
      this.names[p.slot] = {
        name: p.name,
        color: INK_COLORS[p.look.color % INK_COLORS.length],
        team: p.team,
      };
    }
    roster.value = [...this.names];
  }

  nameOf(slot: number): string {
    return this.names[slot]?.name ?? t('player.n', { n: slot + 1 });
  }

  colorOfSlot(slot: number): number {
    const info = lobby.value?.players.find((p) => p.slot === slot);
    return INK_COLORS[(info?.look.color ?? slot) % INK_COLORS.length];
  }

  winnerMask(): number {
    return this.winners;
  }

  private pushFeed(text: string, color: number): void {
    this.feedId++;
    const id = this.feedId;
    killFeed.value = [{ id, text, color }, ...killFeed.value].slice(0, 6);
    setTimeout(() => {
      killFeed.value = killFeed.value.filter((f) => f.id !== id);
    }, 6000);
  }

  private onGameEvent(e: GameEvent, own: number): void {
    if (e.type === SimEvent.KO) {
      const killer = e.a[2] ?? 255;
      const cause = e.a[3] ?? 0;
      this.pushFeed(this.koText(e.slot, killer, cause), this.colorOfSlot(e.slot));
    } else if (e.type === SimEvent.HIT && e.slot === own && own >= 0) {
      const dmg = e.a[3] ?? 0;
      if (dmg > 0) this.haptics.hit(Math.min(1, dmg / 25));
    }
  }

  koText(victim: number, killer: number, cause: number): string {
    const v = this.nameOf(victim);
    const c = t(CAUSE_KEYS[cause] ?? 'cause.none');
    if (killer === 255 || killer === victim) {
      if (cause === Cause.FALL) return t('feed.fell', { victim: v });
      return killer === victim
        ? t('feed.self_ko', { victim: v, cause: c })
        : t('feed.ko_unknown', { victim: v, cause: c });
    }
    return t('feed.ko', { killer: this.nameOf(killer), victim: v, cause: c });
  }

  private roundBanner(m: ScoresMessage): void {
    this.bannerKey++;
    const label = (idx: number): string =>
      this.teamsMode ? t('team.name', { n: idx + 1 }) : this.nameOf(idx);
    if (m.winner < 0) {
      banner.value = { key: this.bannerKey, text: t('round.draw'), sub: t('round.nobody') };
    } else {
      banner.value = {
        key: this.bannerKey,
        text: t('round.won', { who: label(m.winner) }),
        sub: m.final ? t('round.match_won') : t('round.n', { n: m.round }),
      };
    }
  }

  /** Rafraîchit les données du HUD (quelques fois par seconde) et la session sauvegardée. */
  pulse(nowMs: number, fps: number): void {
    const c = this.client;
    if (!c || c.state !== 'joined' || !c.world) return;
    if (Date.now() - this.sessionAt > 2000) {
      this.sessionAt = Date.now();
      this.persist(c);
    }
    if (nowMs - this.hudAt < 100) return;
    this.hudAt = nowMs;
    const o = c.view.own;
    const h: HudData = {
      phase: c.game.phase,
      phaseTick: c.game.phaseTick,
      mode: c.game.mode,
      modeData: Array.from(c.game.modeData.subarray(0, c.game.modeCount)),
      hp: o.hp,
      weapon: o.weapon,
      ammo: o.ammo,
      ghost: o.ghost,
      ghostCd: o.ghostCd,
      dead: o.dead,
      inMatch: c.game.phase !== 0,
      rttMs: c.stats.rttMs,
      fps,
      round: c.game.round,
    };
    hud.value = h;
  }

  get teamColors(): readonly number[] | null {
    return this.teamsMode ? TEAM_COLORS : null;
  }

  get inTeams(): boolean {
    return this.teamsMode;
  }
}

/** Informations d'un joueur du salon (boucle : pas de fonction anonyme par image). */
function infoOf(lob: LobbyView | null, slot: number): PlayerInfo | undefined {
  if (!lob) return undefined;
  for (let i = 0; i < lob.players.length; i++)
    if (lob.players[i].slot === slot) return lob.players[i];
  return undefined;
}

/** Construit la scène à dessiner à partir du client réseau (prédiction + interpolation). */
export class OnlineSource implements RenderSource {
  readonly scene: Scene;

  constructor(
    private readonly client: GameClient,
    private readonly online: Online,
  ) {
    this.scene = createScene(client.world as World);
  }

  get self(): number {
    return this.client.slot;
  }

  /** Remplit un joueur de la scène : identité (salon) et pose (réseau ou prédiction). */
  private put(
    n: number,
    slot: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    facing: number,
    crouching: boolean,
    flags: number,
    state: number,
    animProg: number,
    variant: number,
    hp: number,
    weapon: number,
    ammo: number,
    aim: number,
    self: boolean,
  ): void {
    const d = this.scene.players[n];
    const info = infoOf(this.client.lobby, slot);
    d.slot = slot;
    d.x = x;
    d.y = y;
    d.vx = vx;
    d.vy = vy;
    d.facing = facing;
    d.crouching = crouching;
    d.flags = flags;
    d.state = state;
    d.animProg = animProg;
    d.variant = variant;
    d.hp = hp;
    d.weapon = weapon;
    d.ammo = ammo;
    d.aim = aim;
    d.self = self;
    d.name = info?.name ?? '';
    d.color = info?.look.color ?? slot;
    d.team = this.online.inTeams ? (info?.team ?? -1) : -1;
    d.stroke = info?.look.stroke ?? 0;
    d.hat = info?.look.hat ?? 0;
    d.victory = info?.look.victory ?? 0;
    d.mannequin = false;
  }

  update(input: number): void {
    const c = this.client;
    if (c.state !== 'joined' || !c.world) return;
    c.update(input);
    const sc = this.scene;
    const world = c.world;
    sc.world = world;
    const v = c.view;
    let n = 0;
    for (let i = 0; i < v.remoteCount; i++) {
      const r = v.remotes[i];
      this.put(
        n++,
        r.slot,
        r.x,
        r.y,
        r.vx,
        r.vy,
        (r.flags & PlayerFlag.FACING_RIGHT) !== 0 ? 1 : -1,
        (r.flags & PlayerFlag.CROUCHING) !== 0,
        r.flags,
        r.anim,
        r.animProg,
        r.variant,
        r.hp,
        r.weapon,
        r.ammo,
        r.aim,
        false,
      );
    }
    const o = v.own;
    if (o.visible || o.ghost) {
      this.put(
        n++,
        c.slot,
        o.ghost ? o.cursorX : o.x,
        o.ghost ? o.cursorY : o.y,
        o.vx,
        o.vy,
        o.facing,
        o.crouching,
        o.flags,
        o.ghost ? PlayerState.GHOST : o.state,
        o.animProg,
        o.variant,
        o.hp,
        o.weapon,
        o.ammo,
        o.aim,
        true,
      );
    }
    sc.playerCount = n;
    sc.objectCount = v.objectCount;
    for (let i = 0; i < v.objectCount; i++) copyObj(sc.objects[i], v.objects[i]);
    sc.projCount = v.projCount;
    for (let i = 0; i < v.projCount; i++) copyProj(sc.projectiles[i], v.projectiles[i]);
    sc.moverTick = v.moverTick;
    sc.remoteTick = v.remoteTick;
    sc.params = world.params;
    sc.game.phase = c.game.phase;
    sc.game.mode = c.game.mode;
    sc.game.modeData = c.game.modeData;
    sc.ghost.x = v.ghostX;
    sc.ghost.y = v.ghostY;
    sc.ghost.visible = v.ghostVisible;
    sc.teamColors = this.online.teamColors;
    sc.winners = this.online.winnerMask();
  }

  dispose(): void {
    this.client.close();
  }
}

export function copyObj(d: ObjView, s: ObjView): void {
  d.uid = s.uid;
  d.type = s.type;
  d.x = s.x;
  d.y = s.y;
  d.vx = s.vx;
  d.vy = s.vy;
  d.a = s.a;
  d.b = s.b;
}

export function copyProj(d: ProjView, s: ProjView): void {
  d.uid = s.uid;
  d.type = s.type;
  d.x = s.x;
  d.y = s.y;
  d.vx = s.vx;
  d.vy = s.vy;
  d.owner = s.owner;
  d.a = s.a;
}

export type { ResultsMessage };
