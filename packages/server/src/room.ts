import { randomBytes, randomInt } from 'node:crypto';
import {
  ARENAS,
  Cause,
  CUSTOM_ARENA_PREFIX,
  closestFreeColor,
  createSnapshot,
  decodeEventPayload,
  DEFAULT_LOOK,
  encodeEventPayload,
  encodeSnapshot,
  GamePhase,
  getArena,
  gridToRows,
  INPUT_RING,
  isNetworkEvent,
  LAG_COMP_TICKS,
  LOBBY_ARENA_ID,
  MAX_CUSTOM_ARENAS,
  MAX_EVENT_PAYLOAD,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  normalizeSettings,
  PROTOCOL_VERSION,
  ROTATION_ARENA_IDS,
  sanitizeLook,
  SimEvent,
  SNAPSHOT_MAX_BYTES,
  TICK_MS,
  withRewind,
  cloneSettings,
  DEFAULT_SETTINGS,
  createDecodedEvent,
} from '@stickyclaude/shared';
import type {
  ArenaData,
  CustomArenaInfo,
  ErrorCode,
  LobbyView,
  Look,
  PlayerInfo,
  PlayerStats,
  PublicRoom,
  RoomSettings,
  RoundInfo,
  ServerMessage,
  Snapshot,
  VoteOption,
} from '@stickyclaude/shared';
import {
  addPlayer,
  analyzeArena,
  applyStart,
  createWorld,
  exportOwn,
  fillGameSnap,
  fillObjects,
  fillPlayerSnap,
  fillProjectiles,
  hashWorld,
  hasHiddenMines,
  killPlayer,
  removePlayer,
  resolveVote,
  returnToLobby,
  rulesFromSettings,
  step,
} from '@stickyclaude/sim';
import type { World } from '@stickyclaude/sim';
import type { ClientState } from './client.ts';
import { Member } from './client.ts';
import type { ServerConfig } from './config.ts';
import type { Metrics } from './metrics.ts';
import type { RoomRecorder } from './recorder.ts';
import { ReliableLog } from './reliable.ts';
import { isOffensive } from './badwords.ts';

/** Au-delà de ce nombre de ticks sans entrée, on arrête de répéter la dernière entrée. */
const MISS_NEUTRAL_AFTER = 20;
const BACKPRESSURE_SKIP = 64 * 1024;
const BACKPRESSURE_CLOSE = 1024 * 1024;
/** Un vote de carte ouvert : cartes proposées, votes par participant, délais. */
interface VoteSession {
  options: VoteOption[];
  votes: Map<number, number>;
  endsAt: number;
  /** Pas de clôture anticipée avant cet instant (le temps de voir les cartes). */
  earliest: number;
  round: number;
}

/** Un niveau créé par un joueur du salon. */
interface CustomArena {
  arena: ArenaData;
  by: string;
  /** Identifiant du membre auteur (pour retirer son niveau). */
  owner: number;
}

/** Durée minimale d'affichage du vote, même si tout le monde a déjà voté (ms). */
const VOTE_MIN_MS = 1500;

/** Ce dont un salon a besoin du serveur qui l'héberge. */
export interface RoomIO {
  readonly config: ServerConfig;
  readonly metrics: Metrics;
  /** Un snapshot toutes les `snapshotInterval` ticks par client. */
  readonly snapshotInterval: number;
  readonly scratch: Uint8Array;
  sendJson(c: ClientState, msg: ServerMessage): void;
  sendRaw(c: ClientState, data: Uint8Array | string): void;
  closeConn(c: ClientState, code: number, reason: string): void;
  reportStats(userId: string, add: Record<string, number>, max: Record<string, number>): void;
}

export type LeaveReason = 'left' | 'kicked' | 'closed' | 'idle';

/** Un salon : participants, réglages, partie en cours (monde de simulation) et diffusion. */
export class Room {
  readonly world: World;
  readonly slots: (Member | null)[] = new Array<Member | null>(MAX_PLAYERS).fill(null);
  readonly spectators: Member[] = [];
  /** Emplacements inutilisables jusqu'à la fin de la partie (un joueur parti en cours de partie). */
  readonly retired = new Uint8Array(MAX_PLAYERS);
  readonly reliable = new ReliableLog();
  readonly snap: Snapshot = createSnapshot();
  private readonly inputs = new Uint16Array(MAX_PLAYERS);
  private readonly payload = new Uint8Array(MAX_EVENT_PAYLOAD);
  private readonly decoded = createDecodedEvent();
  settings: RoomSettings;
  host = -1;
  /** Horodatage (ms) du moment où le salon est devenu vide, sinon null. */
  emptySince: number | null = null;
  readonly lobbyArena: ArenaData;
  private memberSeq = 0;
  private joinCounter = 0;
  private tickCount = 0;
  private lobbyDirty = false;
  private lastLobbyAt = 0;
  private autostartAt: number | null = null;
  private matchEndAt: number | null = null;
  /** Équipe de chaque emplacement pendant la partie (-1 absent), pour le podium. */
  private readonly matchTeams = new Int8Array(MAX_PLAYERS).fill(-1);
  private readonly matchNames: string[] = new Array<string>(MAX_PLAYERS).fill('');
  private lastRoundWinner = -1;
  private readonly custom = new Map<string, CustomArena>();
  private customSeq = 0;
  private vote: VoteSession | null = null;

  constructor(
    private readonly io: RoomIO,
    readonly code: string,
    lobbyArenaId: string,
    readonly seed: number,
    private readonly recorder: RoomRecorder | null,
    createdAt: number,
    isPublic = true,
  ) {
    this.lobbyArena = getArena(lobbyArenaId) ?? ARENAS[LOBBY_ARENA_ID];
    this.settings = cloneSettings(DEFAULT_SETTINGS);
    this.settings.isPublic = isPublic;
    this.settings.voteMaps = io.config.voteDefault;
    this.world = createWorld(this.lobbyArena, seed);
    this.world.rules = rulesFromSettings(this.settings);
    this.recorder?.op({ tick: 0, op: 'rules', rules: this.world.rules });
    this.emptySince = createdAt;
  }

  // --- Lecture ------------------------------------------------------------------------------

  get playerCount(): number {
    let n = 0;
    for (const m of this.slots) if (m) n++;
    return n;
  }

  get connectedPlayers(): number {
    let n = 0;
    for (const m of this.slots) if (m?.client) n++;
    return n;
  }

  get phase(): number {
    return this.world.game.phase;
  }

  get recording(): RoomRecorder | null {
    return this.recorder;
  }

  get isEmpty(): boolean {
    return this.playerCount === 0 && this.spectators.length === 0;
  }

  /** Premier emplacement de joueur utilisable. */
  freeSlot(): number {
    for (let s = 0; s < MAX_PLAYERS; s++) if (!this.slots[s] && this.retired[s] === 0) return s;
    return -1;
  }

  hasRoom(): boolean {
    if (this.phase === GamePhase.LOBBY && this.freeSlot() >= 0) return true;
    return this.spectators.length < MAX_SPECTATORS;
  }

  hostName(): string {
    const m = this.host >= 0 ? this.slots[this.host] : null;
    return m?.name ?? '';
  }

  toPublic(): PublicRoom {
    return {
      code: this.code,
      players: this.playerCount,
      maxPlayers: MAX_PLAYERS,
      spectators: this.spectators.length,
      mode: this.settings.mode,
      phase: this.phase === GamePhase.LOBBY ? 'lobby' : 'playing',
      host: this.hostName(),
    };
  }

  findByToken(token: string): Member | null {
    for (const m of this.slots) if (m && m.token === token) return m;
    for (const m of this.spectators) if (m.token === token) return m;
    return null;
  }

  private playersByJoin(): Member[] {
    const out: Member[] = [];
    for (const m of this.slots) if (m) out.push(m);
    return out.sort((a, b) => a.joinSeq - b.joinSeq);
  }

  roundInfo(withRows: boolean): RoundInfo {
    const w = this.world;
    const g = w.game;
    const teams: number[] = [];
    for (let s = 0; s < MAX_PLAYERS; s++) {
      teams.push(this.slots[s] ? w.team[s] : -1);
    }
    return {
      arena: w.arena.id,
      seed: this.seed,
      mode: g.mode,
      round: g.round,
      rows: withRows ? gridToRows(w.cells) : null,
      teams,
      suddenAfterTicks: w.rules.suddenAfterTicks,
      ghosts: w.rules.ghosts,
      weapons: w.rules.weapons,
      friendlyFire: w.rules.friendlyFire,
      commonWeapon: g.commonWeapon,
    };
  }

  lobbyView(now: number): LobbyView {
    const players: PlayerInfo[] = [];
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const m = this.slots[s];
      if (!m) continue;
      players.push({
        slot: s,
        name: m.name,
        look: m.look,
        ready: m.ready,
        team: this.settings.mode === 'teams' ? m.team : -1,
        connected: m.connected,
        ping: Math.round(m.client?.conn.rttMs ?? 0),
      });
    }
    return {
      code: this.code,
      host: this.host,
      settings: this.settings,
      players,
      spectators: this.spectators.map((m) => ({ id: m.id, name: m.name })),
      phase: this.phase as LobbyView['phase'],
      custom: this.customInfo(),
      autostartMs: this.autostartAt === null ? -1 : Math.max(0, Math.round(this.autostartAt - now)),
      round: this.world.game.round,
      scores: Array.from(this.world.game.scores),
    };
  }

  // --- Arrivée et départ ----------------------------------------------------------------------

  /** Ajoute un participant (joueur en salle d'attente, sinon spectateur) ; null si le salon est plein. */
  addMember(client: ClientState, name: string, rawLook: unknown, now: number): Member | null {
    let slot = -1;
    if (this.phase === GamePhase.LOBBY) slot = this.freeSlot();
    if (slot < 0 && this.spectators.length >= MAX_SPECTATORS) return null;

    const m = new Member(++this.memberSeq, this);
    m.name = name;
    m.userId = client.conn.userId ?? '';
    m.look = sanitizeLook(rawLook, DEFAULT_LOOK);
    m.look.color = closestFreeColor(m.look.color, this.usedColors(null));
    m.token = randomBytes(16).toString('hex');
    m.joinSeq = ++this.joinCounter;
    m.lastActiveAt = now;
    m.client = client;
    client.member = m;
    this.emptySince = null;
    if (slot >= 0) this.seat(m, slot, false);
    else this.spectators.push(m);
    // L'arrivant naît dans l'état du snapshot : il ne reçoit pas son propre SPAWN.
    m.ackedEvent = this.reliable.lastId;
    this.assignTeams(false);
    this.sendJoined(m, now);
    this.markLobby();
    this.flushLobby(now);
    return m;
  }

  private seat(m: Member, slot: number, inMatch: boolean): void {
    m.slot = slot;
    this.slots[slot] = m;
    if (this.host < 0) this.host = slot;
    this.recorder?.op({ tick: this.world.tick, op: 'join', slot, inMatch });
    addPlayer(this.world, slot);
    this.world.inMatch[slot] = inMatch ? 1 : 0;
    this.drainEvents(0);
  }

  private usedColors(except: Member | null): Set<number> {
    const used = new Set<number>();
    for (const m of this.slots) if (m && m !== except) used.add(m.look.color);
    return used;
  }

  /** Retire définitivement un participant (départ, expulsion, fin du délai de reconnexion). */
  removeMember(m: Member, reason: LeaveReason, now: number): void {
    const client = m.client;
    if (m.slot >= 0) {
      if (this.slots[m.slot] !== m) return;
      this.slots[m.slot] = null;
      this.recorder?.op({ tick: this.world.tick, op: 'leave', slot: m.slot });
      removePlayer(this.world, m.slot);
      if (this.phase !== GamePhase.LOBBY) this.retired[m.slot] = 1;
      m.slot = -1;
    } else {
      const i = this.spectators.indexOf(m);
      if (i < 0) return;
      this.spectators.splice(i, 1);
    }
    if (client) {
      client.member = null;
      m.client = null;
      this.io.sendJson(client, { t: 'left', reason });
    }
    if (this.host >= 0 && this.slots[this.host] === null) this.pickHost();
    else if (this.host >= 0 && this.slots[this.host]?.client === null) this.pickHost();
    this.assignTeams(false);
    if (this.isEmpty) this.emptySince = now;
    this.markLobby();
    this.flushLobby(now);
  }

  /** L'hôte part : le plus ancien joueur connecté devient hôte. */
  private pickHost(): void {
    let best: Member | null = null;
    for (const m of this.slots) {
      if (m?.client && (!best || m.joinSeq < best.joinSeq)) best = m;
    }
    this.host = best ? best.slot : -1;
  }

  /** La connexion d'un participant est tombée. */
  onDisconnect(m: Member, now: number): void {
    m.client = null;
    if (m.slot < 0 || this.io.config.reconnectGraceMs === 0) {
      m.client = null;
      this.removeMember(m, 'closed', now);
      return;
    }
    m.disconnectedAt = now;
    m.resetInputs();
    if (this.host === m.slot) this.pickHost();
    if (this.connectedPlayers === 0 && this.spectators.every((s) => !s.client)) {
      // personne de connecté : le délai court quand même
    }
    this.markLobby();
    this.flushLobby(now);
  }

  /** Un client revient avec son jeton. */
  resume(m: Member, client: ClientState, now: number): void {
    m.client = client;
    client.member = m;
    m.disconnectedAt = null;
    m.resetInputs();
    m.ackedEvent = this.reliable.lastId;
    m.lastActiveAt = now;
    if (this.host < 0) this.host = m.slot;
    this.sendJoined(m, now);
    this.markLobby();
    this.flushLobby(now);
  }

  sendJoined(m: Member, now: number): void {
    const c = m.client;
    if (!c) return;
    // Les niveaux de joueurs d'abord : la manche en cours peut se jouer sur l'un d'eux.
    for (const e of this.custom.values()) this.io.sendJson(c, { t: 'arena', arena: e.arena });
    this.io.sendJson(c, {
      t: 'joined',
      v: PROTOCOL_VERSION,
      slot: m.slot,
      id: m.id,
      token: m.token,
      code: this.code,
      tickHz: this.io.config.tickHz,
      snapshotHz: this.io.config.snapshotHz,
      tick: this.world.tick,
      ev: this.reliable.lastId,
      devTools: this.io.config.devTools,
      lobby: this.lobbyView(now),
      round: this.roundInfo(true),
    });
    const v = this.vote;
    if (v) {
      this.io.sendJson(c, {
        t: 'vote',
        round: v.round,
        options: v.options,
        endsInMs: Math.max(0, Math.round(v.endsAt - now)),
        counts: this.voteCounts(v),
      });
    }
  }

  // --- Salon : réglages, équipes, prêt, apparence -------------------------------------------

  private markLobby(): void {
    this.lobbyDirty = true;
  }

  /**
   * Envoie l'état du salon à tous les participants connectés. Les réglages, l'état « prêt » et
   * l'apparence se contentent de `markLobby` : le tick envoie dès que 500 ms se sont écoulées
   * depuis le dernier envoi (donc sans attendre pour un clic isolé), ce qui borne le débit d'un
   * client qui bascule en rafale. Arrivées, départs, niveaux et débuts de manche restent
   * immédiats : rares, et l'état affiché doit changer tout de suite.
   */
  flushLobby(now: number): void {
    if (!this.lobbyDirty) return;
    this.lobbyDirty = false;
    this.lastLobbyAt = now;
    const msg: ServerMessage = { t: 'lobby', lobby: this.lobbyView(now) };
    const text = JSON.stringify(msg);
    for (const m of this.slots) if (m?.client) this.io.sendRaw(m.client, text);
    for (const m of this.spectators) if (m.client) this.io.sendRaw(m.client, text);
  }

  setReady(m: Member, ready: boolean, now: number): boolean {
    if (this.phase !== GamePhase.LOBBY || m.slot < 0) return false;
    m.ready = ready;
    m.lastActiveAt = now;
    this.markLobby();
    return true;
  }

  setLook(m: Member, raw: unknown, now: number): void {
    const look: Look = sanitizeLook(raw, m.look);
    look.color = closestFreeColor(look.color, this.usedColors(m));
    m.look = look;
    m.lastActiveAt = now;
    this.markLobby();
  }

  /** Réglages de l'hôte (partie en attente seulement). */
  setSettings(m: Member, patch: Partial<RoomSettings>, now: number): 'ok' | 'not_host' | 'in_game' {
    if (m.slot !== this.host) return 'not_host';
    if (this.phase !== GamePhase.LOBBY) return 'in_game';
    this.settings = normalizeSettings(patch, this.settings, this.knownArenaIds());
    this.setLobbyRules();
    this.assignTeams(false);
    m.lastActiveAt = now;
    this.markLobby();
    return 'ok';
  }

  /** Règles du salon d'attente (armes d'entraînement…) : enregistrées pour la relecture. */
  private setLobbyRules(): void {
    this.world.rules = rulesFromSettings(this.settings);
    this.recorder?.op({ tick: this.world.tick, op: 'rules', rules: this.world.rules });
  }

  setTeams(
    m: Member,
    assign: number[] | undefined,
    shuffle: boolean | undefined,
    now: number,
  ): 'ok' | 'not_host' | 'in_game' | 'bad_request' {
    if (m.slot !== this.host) return 'not_host';
    if (this.phase !== GamePhase.LOBBY) return 'in_game';
    if (this.settings.mode !== 'teams') return 'bad_request';
    if (shuffle) this.assignTeams(true);
    if (assign) {
      for (let s = 0; s < Math.min(assign.length, MAX_PLAYERS); s++) {
        const t = assign[s];
        const mem = this.slots[s];
        if (mem && t >= 0 && t < this.settings.teams) mem.team = t;
      }
    }
    m.lastActiveAt = now;
    this.markLobby();
    return 'ok';
  }

  /** Répartition équilibrée en équipes (ou retrait en chacun pour soi). */
  private assignTeams(reshuffle: boolean): void {
    const players = this.playersByJoin();
    if (this.settings.mode !== 'teams') {
      for (const m of players) m.team = -1;
      return;
    }
    const n = this.settings.teams;
    if (reshuffle) {
      const order = players.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        const t = order[i];
        order[i] = order[j]!;
        order[j] = t;
      }
      order.forEach((m, i) => (m.team = i % n));
      return;
    }
    const counts = new Array<number>(n).fill(0);
    for (const m of players) {
      if (m.team >= 0 && m.team < n) counts[m.team]++;
      else m.team = -1;
    }
    for (const m of players) {
      if (m.team >= 0) continue;
      let best = 0;
      for (let t = 1; t < n; t++) if (counts[t] < counts[best]) best = t;
      m.team = best;
      counts[best]++;
    }
  }

  kick(m: Member, slot: number, now: number): 'ok' | 'not_host' | 'bad_request' {
    if (m.slot !== this.host) return 'not_host';
    const target = this.slots[slot];
    if (!target || target === m) return 'bad_request';
    m.lastActiveAt = now;
    this.removeMember(target, 'kicked', now);
    return 'ok';
  }

  emote(m: Member, id: number, now: number): boolean {
    if (m.slot < 0) return false;
    if (now - m.lastEmoteAt < this.io.config.emoteCooldownMs) return false;
    m.lastEmoteAt = now;
    this.pushNet(SimEvent.EMOTE, m.slot, [id]);
    return true;
  }

  // --- Partie ---------------------------------------------------------------------------------

  /** L'hôte lance la partie. `force` (lancement automatique) ignore l'état « prêt ». */
  startMatch(
    m: Member | null,
    now: number,
    force = false,
  ): 'ok' | 'not_host' | 'in_game' | 'not_enough_players' | 'not_ready' {
    if (m && m.slot !== this.host) return 'not_host';
    if (this.phase !== GamePhase.LOBBY) return 'in_game';
    if (m) m.lastActiveAt = now;
    // Les absents (reconnexion en cours) ne participent pas.
    for (const p of this.playersByJoin()) {
      if (!p.client) this.removeMember(p, 'closed', now);
    }
    const players = this.playersByJoin();
    if (players.length < 2) return 'not_enough_players';
    if (!force && players.some((p) => p !== m && !p.ready && p.slot !== this.host)) {
      return 'not_ready';
    }
    this.retired.fill(0);
    this.assignTeams(false);
    const inMatch = new Array<number>(MAX_PLAYERS).fill(0);
    const teams: number[] = [];
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const p = this.slots[s];
      inMatch[s] = p ? 1 : 0;
      const team = p && this.settings.mode === 'teams' ? p.team : s;
      teams.push(team);
      this.matchTeams[s] = p ? team : -1;
      this.matchNames[s] = p?.name ?? '';
    }
    const ids =
      this.settings.arenas.length > 0
        ? this.settings.arenas
        : [...ROTATION_ARENA_IDS, ...this.custom.keys()];
    const arenas: ArenaData[] = [];
    const used: string[] = [];
    for (const id of ids) {
      const a = this.arenaById(id);
      if (a) {
        arenas.push(a);
        used.push(id);
      }
    }
    const rules = rulesFromSettings(this.settings);
    const custom = arenas.filter((a) => this.custom.has(a.id));
    this.recorder?.op({
      tick: this.world.tick,
      op: 'start',
      rules,
      arenas: used,
      ...(custom.length > 0 ? { custom } : {}),
      inMatch,
      teams,
    });
    this.vote = null;
    applyStart(this.world, { rules, arenas, inMatch, teams });
    for (const p of players) p.ready = false;
    this.autostartAt = null;
    this.io.metrics.matchesStarted++;
    this.drainEvents(now);
    this.markLobby();
    this.flushLobby(now);
    return 'ok';
  }

  // --- Niveaux de joueurs ---------------------------------------------------------------------

  private knownArenaIds(): Set<string> {
    return new Set([...ROTATION_ARENA_IDS, ...this.custom.keys()]);
  }

  private arenaById(id: string): ArenaData | undefined {
    return this.custom.get(id)?.arena ?? getArena(id);
  }

  private customInfo(): CustomArenaInfo[] {
    return [...this.custom.entries()].map(([id, e]) => ({ id, name: e.arena.name.fr, by: e.by }));
  }

  /**
   * Un joueur propose un niveau (en salle d'attente). Le schéma a déjà été validé par zod ; on
   * rejoue ici les contrôles de cases (apparitions debout, zones des modes, plateformes dans la
   * page), on impose un identifiant à nous, on retire le décor libre et on filtre les noms.
   */
  addCustomArena(m: Member, raw: ArenaData, now: number): 'ok' | { code: ErrorCode; msg?: string } {
    if (m.slot < 0 || this.phase !== GamePhase.LOBBY) return { code: 'in_game' };
    if (now - m.lastArenaAt < 2000) return { code: 'rate_limited' };
    m.lastArenaAt = now;
    m.lastActiveAt = now;
    if (this.custom.size >= MAX_CUSTOM_ARENAS) return { code: 'too_many_arenas' };
    const names = [raw.name.fr, raw.name.en].map((n) =>
      n
        .normalize('NFKC')
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .trim(),
    );
    if (names.some((n) => n === '' || isOffensive(n))) {
      return { code: 'bad_arena', msg: 'name' };
    }
    // contrôles légers seulement : l'accessibilité (plusieurs secondes de simulation) a été
    // vérifiée par le créateur de niveau, et un salon peut retirer le niveau d'un tricheur
    const report = analyzeArena(raw, { reach: false });
    if (report.errors.length > 0) return { code: 'bad_arena', msg: report.errors[0] };
    const id = `${CUSTOM_ARENA_PREFIX}${++this.customSeq}`;
    const arena: ArenaData = {
      ...structuredClone(raw),
      id,
      name: { fr: names[0], en: names[1] },
      decor: [],
    };
    this.custom.set(id, { arena, by: m.name, owner: m.id });
    if (this.settings.arenas.length > 0) this.settings.arenas.push(id);
    this.sendAll({ t: 'arena', arena });
    this.markLobby();
    this.flushLobby(now);
    return 'ok';
  }

  /** L'auteur ou l'hôte retire un niveau. */
  removeCustomArena(m: Member, id: string, now: number): void {
    const e = this.custom.get(id);
    if (!e || this.phase !== GamePhase.LOBBY) return;
    if (e.owner !== m.id && m.slot !== this.host) return;
    m.lastActiveAt = now;
    this.custom.delete(id);
    this.settings.arenas = this.settings.arenas.filter((a) => a !== id);
    this.sendAll({ t: 'arena_del', id });
    this.markLobby();
    this.flushLobby(now);
  }

  // --- Vote de la carte -----------------------------------------------------------------------

  private voteCounts(v: VoteSession): number[] {
    const counts = new Array<number>(v.options.length).fill(0);
    for (const pick of v.votes.values()) counts[pick]++;
    return counts;
  }

  /** Un joueur vote pour une des cartes proposées (il peut changer d'avis jusqu'à la clôture). */
  castVote(m: Member, pick: number, now: number): void {
    const v = this.vote;
    if (!v || m.slot < 0 || pick >= v.options.length) return;
    m.lastActiveAt = now;
    v.votes.set(m.id, pick);
    this.sendAll({ t: 'votes', counts: this.voteCounts(v) });
  }

  private openVote(now: number): void {
    const w = this.world;
    const options: VoteOption[] = [];
    for (let i = 0; i < w.voteCount; i++) {
      const a = w.arenaPool[w.voteOptions[i]];
      if (a) options.push({ id: a.id, name: a.name });
    }
    const ms = this.io.config.voteMs;
    const v: VoteSession = {
      options,
      votes: new Map(),
      endsAt: now + ms,
      earliest: now + Math.min(VOTE_MIN_MS, ms),
      round: w.game.round + 1,
    };
    this.vote = v;
    this.sendAll({
      t: 'vote',
      round: v.round,
      options,
      endsInMs: ms,
      counts: this.voteCounts(v),
    });
  }

  private stepVote(now: number): void {
    const v = this.vote;
    if (!v) {
      if (this.world.voteHold) this.openVote(now);
      return;
    }
    if (!this.world.voteHold) {
      // clos par la simulation (garde-fou) : rien d'autre à faire
      this.vote = null;
      return;
    }
    let everyone = true;
    for (const m of this.slots) if (m?.client && !v.votes.has(m.id)) everyone = false;
    if (now >= v.endsAt || (everyone && now >= v.earliest)) this.closeVote(v);
  }

  /** Dépouille le vote : la carte la plus votée, les égalités et l'absence de vote au sort. */
  private closeVote(v: VoteSession): void {
    const counts = this.voteCounts(v);
    const best = Math.max(...counts);
    const top: number[] = [];
    counts.forEach((c, i) => {
      if (c === best) top.push(i);
    });
    const pick = top[randomInt(top.length)];
    this.recorder?.op({ tick: this.world.tick, op: 'vote', choice: pick });
    resolveVote(this.world, pick);
    this.vote = null;
    this.sendAll({ t: 'voteEnd', pick });
  }

  private sendAll(msg: ServerMessage): void {
    const text = JSON.stringify(msg);
    for (const m of this.slots) if (m?.client) this.io.sendRaw(m.client, text);
    for (const m of this.spectators) if (m.client) this.io.sendRaw(m.client, text);
  }

  /** Une nouvelle manche (ou le salon d'attente) commence : on annonce l'arène et on repart propre. */
  private announceRound(): void {
    this.sendAll({ t: 'round', round: this.roundInfo(false), ev: this.reliable.lastId });
    // Les événements d'avant le changement d'arène n'ont plus de sens pour les clients.
    for (const m of this.slots) if (m) m.ackedEvent = this.reliable.lastId;
    for (const m of this.spectators) m.ackedEvent = this.reliable.lastId;
  }

  private onRoundEnd(winner: number, round: number, matchWinner: number, now: number): void {
    this.lastRoundWinner = winner;
    this.sendAll({
      t: 'scores',
      round,
      winner,
      scores: Array.from(this.world.game.scores),
      final: matchWinner >= 0,
    });
    // Ceux qui sont arrivés en cours de manche entrent à la suivante ; ceux qui sont partis s'effacent.
    for (const m of this.playersByJoin()) {
      if (m.leaving) this.removeMember(m, 'closed', now);
    }
    if (matchWinner < 0) this.promoteSpectators(true, now);
    this.markLobby();
    this.flushLobby(now);
  }

  private onMatchEnd(now: number): void {
    const w = this.world;
    const g = w.game;
    const present = new Set<number>();
    for (let s = 0; s < MAX_PLAYERS; s++)
      if (this.matchTeams[s] >= 0) present.add(this.matchTeams[s]);
    const podium = [...present].sort((a, b) => g.scores[b] - g.scores[a] || a - b);
    const stats: PlayerStats[] = [];
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (this.matchTeams[s] < 0) continue;
      stats.push({
        slot: s,
        kos: w.stats.kos[s],
        deaths: w.stats.deaths[s],
        damage: w.stats.damage[s],
        bestCombo: w.stats.bestCombo[s],
        silly: w.stats.silly[s],
      });
    }
    this.sendAll({
      t: 'results',
      winner: g.matchWinner,
      podium,
      scores: Array.from(g.scores),
      teams: Array.from(this.matchTeams),
      stats,
    });
    this.io.metrics.matchesCompleted++;
    this.reportAccountStats(stats, g.matchWinner);
    this.matchEndAt = now + this.io.config.matchEndMs;
  }

  /** Envoie au service de comptes le bilan de chaque joueur connecté à un compte sayk.fr. */
  private reportAccountStats(stats: PlayerStats[], matchWinner: number): void {
    const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
    for (const s of stats) {
      const m = this.slots[s.slot];
      if (!m || m.userId === '') continue;
      const won = matchWinner >= 0 && this.matchTeams[s.slot] === matchWinner;
      this.io.reportStats(
        m.userId,
        {
          matches: 1,
          wins: won ? 1 : 0,
          kos: whole(s.kos),
          deaths: whole(s.deaths),
          damage: whole(s.damage),
        },
        { bestCombo: whole(s.bestCombo) },
      );
    }
  }

  /** Retour au salon d'attente : tout le monde réapparaît, les spectateurs deviennent joueurs. */
  backToLobby(now: number): void {
    this.matchEndAt = null;
    this.retired.fill(0);
    for (const m of this.playersByJoin()) {
      if (m.leaving || !m.client) this.removeMember(m, 'closed', now);
    }
    this.recorder?.op({ tick: this.world.tick, op: 'lobby' });
    returnToLobby(this.world, this.lobbyArena);
    this.setLobbyRules();
    for (const m of this.slots) if (m) m.ready = false;
    this.promoteSpectators(false, now);
    this.assignTeams(false);
    this.drainEvents(now);
    this.announceRound();
    this.markLobby();
    this.flushLobby(now);
  }

  /** Les spectateurs prennent les places libres (par ordre d'arrivée). */
  private promoteSpectators(inMatch: boolean, now: number): void {
    for (const m of this.spectators.slice()) {
      if (!m.client || (inMatch && !m.wantsToPlay)) continue;
      const slot = this.freeSlot();
      if (slot < 0) break;
      this.spectators.splice(this.spectators.indexOf(m), 1);
      this.seat(m, slot, inMatch);
      m.ackedEvent = this.reliable.lastId;
      m.wantsToPlay = true;
      if (inMatch) {
        this.matchTeams[slot] = this.settings.mode === 'teams' ? this.smallestTeam() : slot;
        this.matchNames[slot] = m.name;
        this.world.team[slot] = this.matchTeams[slot]!;
        m.team = this.settings.mode === 'teams' ? this.matchTeams[slot] : -1;
      }
      m.lastActiveAt = now;
      this.sendJoined(m, now);
    }
  }

  private smallestTeam(): number {
    const counts = new Array<number>(this.settings.teams).fill(0);
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const t = this.matchTeams[s];
      if (this.slots[s] && t >= 0 && t < counts.length) counts[t]++;
    }
    let best = 0;
    for (let t = 1; t < counts.length; t++) if (counts[t] < counts[best]) best = t;
    return best;
  }

  /** Un joueur inactif devient spectateur jusqu'à la fin de la partie. */
  private demote(m: Member, now: number): void {
    const slot = m.slot;
    if (slot < 0 || !m.client) return;
    // Jamais le dernier joueur connecté : sans joueur, le salon ne tournerait plus (plus de fin de manche).
    if (this.connectedPlayers <= 1) return;
    // Plus de place chez les spectateurs : il quitte le salon plutôt que de dépasser le plafond.
    if (this.spectators.length >= MAX_SPECTATORS) {
      this.removeMember(m, 'idle', now);
      return;
    }
    this.recorder?.op({ tick: this.world.tick, op: 'leave', slot });
    this.slots[slot] = null;
    removePlayer(this.world, slot);
    this.retired[slot] = 1;
    m.slot = -1;
    m.wantsToPlay = false;
    m.ready = false;
    this.spectators.push(m);
    if (this.host === slot) this.pickHost();
    this.sendJoined(m, now);
    this.markLobby();
    this.flushLobby(now);
  }

  // --- Événements de la simulation ------------------------------------------------------------

  /** Enregistre un événement fiable (réseau). */
  pushNet(type: number, slot: number, args: ArrayLike<number>): void {
    const n = encodeEventPayload(this.payload, type, slot, args);
    if (n > 0) this.reliable.push(type, this.payload, n);
  }

  /** Traite les événements émis par la simulation (pas, ou appel direct comme `startMatch`). */
  private drainEvents(now: number): void {
    const ev = this.world.events;
    const n = ev.count;
    ev.count = 0;
    if (ev.dropped > 0) {
      this.io.metrics.eventsDropped += ev.dropped;
      ev.dropped = 0;
    }
    let roundStart = false;
    let roundEnd = -1;
    let matchEnd = false;
    let endWinner = -1;
    let endRound = 0;
    let endMatchWinner = -1;
    for (let i = 0; i < n; i++) {
      const type = ev.type[i];
      const o = i * 6;
      if (isNetworkEvent(type)) {
        this.pushNet(type, ev.slot[i], ev.v.subarray(o, o + 6));
      } else if (type === SimEvent.ROUND_START) {
        roundStart = true;
      } else if (type === SimEvent.ROUND_END) {
        roundEnd = i;
        endWinner = ev.v[o]!;
        endRound = ev.v[o + 2]!;
        endMatchWinner = ev.v[o + 3]!;
      } else if (type === SimEvent.MATCH_END) {
        matchEnd = true;
      }
    }
    if (roundStart) {
      this.announceRound();
      this.markLobby();
    }
    if (roundEnd >= 0) this.onRoundEnd(endWinner, endRound, endMatchWinner, now);
    if (matchEnd) this.onMatchEnd(now);
  }

  // --- Tick -----------------------------------------------------------------------------------

  /** Avance la simulation d'un pas avec les entrées étiquetées pour ce tick, puis diffuse. */
  tick(now: number): void {
    this.tickCount++;
    const w = this.world;
    this.stepMembers(now);
    this.gatherInputs(now);
    const t0 = performance.now();
    step(w, this.inputs);
    this.io.metrics.roomStepMs.add(performance.now() - t0);
    this.drainEvents(now);
    this.stepVote(now);
    this.stepLobby(now);
    this.sendSnapshots();
    if (this.lobbyDirty || (this.tickCount % 180 === 0 && this.hasConnected())) {
      this.lobbyDirty = true;
      if (now - this.lastLobbyAt >= 500) this.flushLobby(now);
    }
  }

  private hasConnected(): boolean {
    return this.connectedPlayers > 0 || this.spectators.some((m) => m.client);
  }

  /** Reconnexions expirées et inactivité (vérifiées une fois par seconde). */
  private stepMembers(now: number): void {
    if (this.tickCount % 60 !== 0) return;
    const cfg = this.io.config;
    for (const m of this.playersByJoin()) {
      if (m.disconnectedAt !== null && !m.leaving) {
        if (now - m.disconnectedAt >= cfg.reconnectGraceMs) this.expire(m, now);
      } else if (m.client && this.phase === GamePhase.PLAYING) {
        if (now - m.lastActiveAt >= cfg.idlePlayingMs) this.demote(m, now);
      } else if (m.client && this.phase === GamePhase.LOBBY) {
        if (now - m.lastActiveAt >= cfg.idleLobbyMs) this.removeMember(m, 'idle', now);
      }
    }
  }

  /** Fin du délai de reconnexion : éliminé pour la manche, retiré à la fin de la manche. */
  private expire(m: Member, now: number): void {
    const phase = this.phase;
    if (
      phase === GamePhase.LOBBY ||
      phase === GamePhase.MATCH_END ||
      phase === GamePhase.ROUND_END
    ) {
      this.removeMember(m, 'closed', now);
      return;
    }
    m.leaving = true;
    const p = this.world.players[m.slot];
    if (phase === GamePhase.PLAYING && !p.dead && !p.ghost) {
      this.recorder?.op({ tick: this.world.tick, op: 'kill', slot: m.slot });
      killPlayer(this.world, m.slot, -1, Cause.NONE);
      this.drainEvents(now);
    }
  }

  private gatherInputs(now: number): void {
    const w = this.world;
    const label = w.tick + 1;
    const idx = label & (INPUT_RING - 1);
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const m = this.slots[s];
      if (!m) {
        this.inputs[s] = 0;
        continue;
      }
      let mask: number;
      if (!m.client) {
        mask = 0;
        m.lastMask = 0;
      } else if (m.ringTick[idx] === label) {
        mask = m.ringMask[idx]!;
        m.ringTick[idx] = -1;
        m.missStreak = 0;
      } else {
        m.missStreak++;
        this.io.metrics.inputsMissed++;
        mask = m.missStreak > MISS_NEUTRAL_AFTER ? 0 : m.lastMask;
      }
      if (mask !== 0 || mask !== m.lastMask) m.lastActiveAt = now;
      m.lastMask = mask;
      const packed = withRewind(mask, m.rewindTicks);
      this.inputs[s] = packed;
      this.recorder?.input(label, s, packed);
    }
  }

  private stepLobby(now: number): void {
    const phase = this.phase;
    if (phase === GamePhase.MATCH_END && this.matchEndAt !== null && now >= this.matchEndAt) {
      this.backToLobby(now);
      return;
    }
    if (phase !== GamePhase.LOBBY) {
      this.autostartAt = null;
      return;
    }
    if (!this.settings.isPublic) {
      this.autostartAt = null;
      return;
    }
    let ready = 0;
    for (const m of this.slots) if (m?.client && m.ready) ready++;
    if (ready < 2) {
      if (this.autostartAt !== null) {
        this.autostartAt = null;
        this.markLobby();
      }
      return;
    }
    if (this.autostartAt === null) {
      this.autostartAt = now + this.io.config.autostartMs;
      this.markLobby();
    } else if (now >= this.autostartAt) {
      this.startMatch(null, now, true);
    }
  }

  // --- Snapshots ------------------------------------------------------------------------------

  private sendSnapshots(): void {
    const w = this.world;
    const interval = this.io.snapshotInterval;
    let due = false;
    for (let s = 0; s < MAX_PLAYERS && !due; s++) {
      const m = this.slots[s];
      if (m?.client && (w.tick + s) % interval === 0) due = true;
    }
    for (let k = 0; k < this.spectators.length && !due; k++) {
      const m = this.spectators[k];
      if (m.client && (w.tick + MAX_PLAYERS + k) % interval === 0) due = true;
    }
    if (!due) return;
    const snap = this.snap;
    snap.tick = w.tick;
    let n = 0;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const p = w.players[s];
      if (p.active) fillPlayerSnap(w, s, snap.players[n++]);
    }
    snap.playerCount = n;
    fillGameSnap(w, snap.game);
    snap.projCount = fillProjectiles(w, snap.projectiles);
    const hidden = hasHiddenMines(w);
    if (!hidden) snap.objectCount = fillObjects(w, snap.objects, -1);

    for (let s = 0; s < MAX_PLAYERS; s++) {
      const m = this.slots[s];
      if (m?.client && (w.tick + s) % interval === 0) this.sendTo(m, hidden);
    }
    for (let k = 0; k < this.spectators.length; k++) {
      const m = this.spectators[k];
      if (m.client && (w.tick + MAX_PLAYERS + k) % interval === 0) this.sendTo(m, false);
    }
  }

  private sendTo(m: Member, hidden: boolean): void {
    const c = m.client!;
    if (c.closing) return;
    const snap = this.snap;
    const w = this.world;
    const buffered = c.conn.bufferedAmount;
    if (buffered > BACKPRESSURE_CLOSE) {
      this.io.closeConn(c, 1013, 'backpressure');
      return;
    }
    if (buffered > BACKPRESSURE_SKIP) {
      this.io.metrics.snapshotsSkipped++;
      return;
    }
    if (hidden) snap.objectCount = fillObjects(w, snap.objects, m.slot);
    snap.margin = m.minMargin;
    m.minMargin = 127;
    snap.hasOwn = m.slot >= 0;
    if (snap.hasOwn) exportOwn(w, m.slot, snap.own);
    const count = this.reliable.fill(snap, m.ackedEvent);
    if (count < 0) {
      this.io.closeConn(c, 1008, 'desync');
      return;
    }
    snap.eventCount = count;
    const len = encodeSnapshot(this.io.scratch, snap);
    this.io.metrics.snapshotsSent++;
    this.io.sendRaw(c, this.io.scratch.slice(0, len));
  }

  stateHash(): number {
    return hashWorld(this.world);
  }

  /** Décodage d'un événement fiable pour les tests et les outils. */
  decodeEvent(type: number, data: Uint8Array, len: number): ReturnType<typeof createDecodedEvent> {
    decodeEventPayload(type, data, len, this.decoded);
    return this.decoded;
  }

  /** Borne la compensation de latence annoncée par un client. */
  static rewindFromWire(units4ms: number): number {
    const ticks = Math.round((units4ms * 4) / TICK_MS);
    return Math.max(0, Math.min(LAG_COMP_TICKS, ticks));
  }

  /** Taille maximale d'un snapshot (dimensionnement du tampon d'envoi). */
  static readonly scratchBytes = SNAPSHOT_MAX_BYTES;
}
