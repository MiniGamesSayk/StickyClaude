import {
  AUTOSTART_MS,
  EMOTE_COOLDOWN_MS,
  IDLE_LOBBY_MS,
  IDLE_PLAYING_MS,
  RECONNECT_GRACE_MS,
  SNAPSHOT_HZ_DEFAULT,
  TICK_HZ,
  VOTE_MS_DEFAULT,
} from '@stickyclaude/shared';

export interface ServerConfig {
  port: number;
  host: string;
  production: boolean;
  tickHz: number;
  snapshotHz: number;
  maxRooms: number;
  maxConnections: number;
  maxConnPerIp: number;
  /** Créations de salon par minute et par IP. */
  createPerMin: number;
  /** Essais de code de salon (échecs) par minute et par IP. */
  codeTriesPerMin: number;
  roomIdleTtlSec: number;
  /** Intervalle des pings WebSocket (ms) ; déconnexion après 3 pings sans réponse. */
  heartbeatMs: number;
  /** Outils de développement : réglage en direct des constantes, enregistrement exposé. */
  devTools: boolean;
  /** Origine publique autorisée pour le WebSocket (ex. https://stickyclaude.sayk.fr). */
  publicOrigin: string;
  /** En production, accepter les connexions sans en-tête Origin (outils de charge). */
  allowNoOrigin: boolean;
  staticDir: string;
  /** Si défini, chaque salle écrit son enregistrement d'entrées dans ce dossier. */
  recordDir: string;
  /**
   * Proxys de confiance dont on croit l'en-tête `X-Forwarded-For` : `caddy` (réseaux privés,
   * dont celui de Docker) ou une liste d'adresses et de CIDR séparés par des virgules.
   * Vide : l'en-tête est ignoré.
   */
  trustedProxy: string;
  /**
   * `/metrics` : jeton `Authorization: Bearer <jeton>` (accepté de partout) ; sans jeton, seules
   * les requêtes internes (réseau privé, sans en-tête de proxy) sont acceptées.
   */
  metricsToken: string;
  /** Service de comptes sayk.fr, joint en interne (ex. http://auth:3000) ; vide : jeu anonyme. */
  authUrl: string;
  /** Clé de ce jeu auprès du service de comptes (GAME_KEYS côté `auth`). */
  authKey: string;
  /** Origine publique de l'API de comptes, autorisée par la CSP pour que la page la contacte. */
  authApiOrigin: string;
  /** Niveau des journaux pino (trace, debug, info, warn, error, fatal, silent). */
  logLevel: string;
  /** Arrêt propre (SIGTERM) : délai avant de fermer les connexions restantes (ms). */
  shutdownGraceMs: number;
  /** Délai de reconnexion d'un joueur (ms). */
  reconnectGraceMs: number;
  /** Lancement automatique d'un salon public, une fois 2 joueurs prêts (ms). */
  autostartMs: number;
  /** Inactivité : en manche → spectateur ; en attente → déconnexion (ms). */
  idlePlayingMs: number;
  idleLobbyMs: number;
  /** Durée du podium avant le retour au salon (ms). */
  matchEndMs: number;
  /** Durée du vote de carte avant chaque manche (ms). */
  voteMs: number;
  /** Vote de carte activé par défaut dans les nouveaux salons (l'hôte peut le changer). */
  voteDefault: boolean;
  /** Délai minimal entre deux emotes d'un joueur (ms). */
  emoteCooldownMs: number;
  /** Messages de contrôle JSON acceptés par seconde et par connexion. */
  controlPerSec: number;
}

function int(v: string | undefined, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function loadConfig(
  env: Record<string, string | undefined>,
  defaultStaticDir: string,
): ServerConfig {
  const production = env.NODE_ENV === 'production';
  return {
    port: int(env.PORT, 3000, 0, 65535),
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    production,
    tickHz: int(env.TICK_HZ, TICK_HZ, TICK_HZ, TICK_HZ), // la simulation est à 60 Hz fixe
    snapshotHz: int(env.SNAPSHOT_HZ, SNAPSHOT_HZ_DEFAULT, 20, 60),
    maxRooms: int(env.MAX_ROOMS, 40, 1, 10_000),
    maxConnections: int(env.MAX_CONNECTIONS, 400, 1, 100_000),
    maxConnPerIp: int(env.MAX_CONN_PER_IP, 8, 1, 10_000),
    createPerMin: int(env.CREATE_PER_MIN, 3, 1, 100_000),
    codeTriesPerMin: int(env.CODE_TRIES_PER_MIN, 10, 1, 100_000),
    roomIdleTtlSec: int(env.ROOM_IDLE_TTL_SEC, 300, 0, 86_400),
    heartbeatMs: int(env.HEARTBEAT_MS, 10_000, 20, 600_000),
    devTools: env.DEV_TOOLS === '1',
    publicOrigin: env.PUBLIC_ORIGIN ?? '',
    allowNoOrigin: env.ALLOW_NO_ORIGIN === '1',
    staticDir: env.STATIC_DIR ?? defaultStaticDir,
    recordDir: env.RECORD_DIR ?? '',
    trustedProxy: env.TRUSTED_PROXY ?? '',
    metricsToken: env.METRICS_TOKEN ?? '',
    authUrl: (env.SAYK_AUTH_URL ?? '').replace(/\/$/, ''),
    authKey: env.SAYK_AUTH_KEY ?? '',
    authApiOrigin: env.SAYK_API_ORIGIN ?? '',
    logLevel: env.LOG_LEVEL ?? 'info',
    shutdownGraceMs: int(env.SHUTDOWN_GRACE_SEC, 30, 0, 300) * 1000,
    reconnectGraceMs: int(env.RECONNECT_GRACE_MS, RECONNECT_GRACE_MS, 0, 600_000),
    autostartMs: int(env.AUTOSTART_MS, AUTOSTART_MS, 0, 600_000),
    idlePlayingMs: int(env.IDLE_PLAYING_MS, IDLE_PLAYING_MS, 1000, 3_600_000),
    idleLobbyMs: int(env.IDLE_LOBBY_MS, IDLE_LOBBY_MS, 1000, 86_400_000),
    matchEndMs: int(env.MATCH_END_MS, 12_000, 0, 120_000),
    voteMs: int(env.VOTE_MS, VOTE_MS_DEFAULT, 500, 120_000),
    voteDefault: env.VOTE_DEFAULT !== '0',
    emoteCooldownMs: int(env.EMOTE_COOLDOWN_MS, EMOTE_COOLDOWN_MS, 0, 60_000),
    controlPerSec: int(env.CONTROL_PER_SEC, 20, 1, 1000),
  };
}

/**
 * Origine acceptée pour le WebSocket. En production : `PUBLIC_ORIGIN` ; sans elle, seule l'origine
 * qui correspond à l'en-tête `Host` de la requête (même site). Hors production : aussi localhost.
 */
export function originAllowed(
  origin: string | undefined,
  cfg: ServerConfig,
  host?: string,
): boolean {
  if (!origin) return !cfg.production || cfg.allowNoOrigin;
  if (cfg.publicOrigin !== '' && origin === cfg.publicOrigin) return true;
  if (cfg.production) {
    if (cfg.publicOrigin !== '' || !host) return false;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
}
