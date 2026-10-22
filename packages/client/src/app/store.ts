import { signal } from '@preact/signals';
import type {
  ArenaData,
  LobbyView,
  Look,
  PublicRoom,
  RoomSettings,
  RoundInfo,
  VoteOption,
} from '@stickyclaude/shared';
import type { ResultsMessage, ScoresMessage } from '../net/client.ts';
import { loadLevels } from './levels.ts';

/**
 * État partagé de l'interface (signaux Preact) : écran courant, connexion, salon, HUD, podium,
 * entraînement. Le jeu (`app.ts`) écrit dedans ; les composants le lisent et appellent `actions`.
 */

export type Mode = 'menu' | 'online' | 'solo';
export type Screen = 'home' | 'customize';
export type Overlay = 'options' | 'credits' | 'help' | 'pause' | 'creator' | null;
export type NetStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'maintenance';

export const mode = signal<Mode>('menu');
export const screen = signal<Screen>('home');
export const overlay = signal<Overlay>(null);

export interface NetState {
  status: NetStatus;
  /** Message d'erreur affiché sur l'accueil (clé de message ou texte du serveur). */
  error: string | null;
}
export const net = signal<NetState>({ status: 'idle', error: null });

/** Code de salon venu de l'adresse (`?salon=CODE`), pour préremplir l'accueil. */
export const urlCode = signal('');

export const lobby = signal<LobbyView | null>(null);
export const selfSlot = signal(-1);
export const round = signal<RoundInfo | null>(null);
export const rooms = signal<PublicRoom[]>([]);

/** Vote de carte en cours : cartes, votes de chacun, échéance (horloge de la page), mon choix. */
export interface VoteState {
  round: number;
  options: VoteOption[];
  counts: number[];
  endsAt: number;
  mine: number;
  /** Carte retenue une fois le vote clos (affichée un instant), -1 tant qu'il est ouvert. */
  picked: number;
}
export const vote = signal<VoteState | null>(null);

/** Niveaux créés par le joueur, gardés dans le navigateur. */
export const levels = signal<ArenaData[]>(loadLevels());

/** Ce que le HUD affiche, rafraîchi quelques fois par seconde. */
export interface HudData {
  phase: number;
  phaseTick: number;
  mode: number;
  modeData: number[];
  hp: number;
  weapon: number;
  ammo: number;
  ghost: boolean;
  ghostCd: number;
  dead: boolean;
  inMatch: boolean;
  rttMs: number;
  fps: number;
  /** Sauts, vies : numéro de manche courante. */
  round: number;
}

export const EMPTY_HUD: HudData = {
  phase: 0,
  phaseTick: 0,
  mode: 0,
  modeData: [],
  hp: 100,
  weapon: 0,
  ammo: 0,
  ghost: false,
  ghostCd: 0,
  dead: false,
  inMatch: false,
  rttMs: 0,
  fps: 60,
  round: 0,
};
export const hud = signal<HudData>(EMPTY_HUD);

/** Gros texte au centre (décompte, « manche gagnée »…). `key` change à chaque nouveau message. */
export interface Banner {
  key: number;
  text: string;
  sub: string;
}
export const banner = signal<Banner | null>(null);

export interface FeedItem {
  id: number;
  text: string;
  color: number;
}
export const killFeed = signal<FeedItem[]>([]);

export const podium = signal<ResultsMessage | null>(null);
export const lastScores = signal<ScoresMessage | null>(null);
export const toast = signal<{ id: number; text: string } | null>(null);

/** Joueurs hors cadre, indications d'équipes : nom et couleur d'encre par emplacement. */
export interface RosterEntry {
  name: string;
  color: number;
  team: number;
}
export const roster = signal<RosterEntry[]>([]);

// --- Entraînement solo --------------------------------------------------------------------------

export interface Objective {
  id: string;
  done: boolean;
  /** Avancement affiché (« 2 / 3 »), 0 si l'objectif est binaire. */
  progress: number;
  goal: number;
}
export const training = signal<Objective[] | null>(null);
/** Essai d'un niveau du créateur en cours : le bouton de sortie ramène à l'éditeur. */
export const testingLevel = signal(false);

/** Instant (ms, `performance.now`) où l'on pourra de nouveau faire une emote. */
export const emoteReadyAt = signal(0);

// --- Actions (branchées par l'application) ----------------------------------------------------------

export interface Actions {
  quick(): void;
  create(isPublic: boolean): void;
  join(code: string): void;
  solo(): void;
  leave(): void;
  ready(ready: boolean): void;
  start(): void;
  settings(patch: Partial<RoomSettings>): void;
  teams(opts: { assign?: number[]; shuffle?: boolean }): void;
  kick(slot: number): void;
  look(look: Look): void;
  /** Vote de carte (indice dans la liste proposée). */
  vote(pick: number): void;
  /** Propose un niveau au salon ; retire un niveau du salon. */
  sendLevel(arena: ArenaData): void;
  deleteLevel(id: string): void;
  /** Teste un niveau créé par le joueur dans l'entraînement (depuis l'accueil). */
  testLevel(arena: ArenaData): void;
  emote(id: number): void;
  copyLink(): void;
  /** Aperçu du stickman de l'accueil et de la personnalisation. */
  preview(look: Look, emote: number, victory: number): void;
  resetTraining(): void;
  /** Reprise de la partie en pause (menu pause du mode solo et mobile). */
  resume(): void;
  /** Quitte l'entraînement solo. */
  quitSolo(): void;
  /** Annule la reconnexion en cours. */
  cancelReconnect(): void;
  /** La prochaine touche pressée est transmise à `cb` (reconfiguration des touches). */
  captureKey(cb: ((code: string) => void) | null): void;
}

const noop = (): void => undefined;
export const actions: Actions = {
  quick: noop,
  create: noop,
  join: noop,
  solo: noop,
  leave: noop,
  ready: noop,
  start: noop,
  settings: noop,
  teams: noop,
  kick: noop,
  look: noop,
  vote: noop,
  sendLevel: noop,
  deleteLevel: noop,
  testLevel: noop,
  emote: noop,
  copyLink: noop,
  preview: noop,
  resetTraining: noop,
  resume: noop,
  quitSolo: noop,
  cancelReconnect: noop,
  captureKey: noop,
};

let toastId = 0;
/** Message bref en bas de l'écran. */
export function say(text: string): void {
  toastId++;
  toast.value = { id: toastId, text };
}
