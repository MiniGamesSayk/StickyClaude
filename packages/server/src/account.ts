import type { ServerConfig } from './config.ts';
import type { LogFn } from './logger.ts';

/**
 * Compte sayk.fr (connexion Discord). Le service `auth` pose un cookie de session partagé par les
 * sous-domaines ; ici le serveur de jeu le montre au service (réseau Docker, clé du jeu) pour
 * savoir qui se connecte, puis lui envoie les statistiques de fin de partie. Sans `SAYK_AUTH_URL`
 * tout est inactif et le jeu reste anonyme.
 */

export interface AccountService {
  /** Identifiant du compte pour l'en-tête `Cookie` d'une requête, null si anonyme ou injoignable. */
  resolve(cookieHeader: string | undefined): Promise<string | null>;
  /** Ajoute (`add`) ou garde le meilleur (`max`) de compteurs ; n'attend pas, n'échoue jamais. */
  report(userId: string, add: Record<string, number>, max: Record<string, number>): void;
}

const COOKIE_RE = /(?:^|;\s*)sayk_session=([0-9a-f]{64})(?:;|$)/;
const TIMEOUT_MS = 1500;

export function createAccountService(cfg: ServerConfig, log: LogFn): AccountService | null {
  if (cfg.authUrl === '' || cfg.authKey === '') return null;
  const headers = { Authorization: `Bearer ${cfg.authKey}`, 'Content-Type': 'application/json' };

  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${cfg.authUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  return {
    async resolve(cookieHeader) {
      const token = cookieHeader === undefined ? undefined : COOKIE_RE.exec(cookieHeader)?.[1];
      if (token === undefined) return null;
      try {
        const res = await post('/internal/resolve', { token });
        if (!res.ok) return null;
        const data = (await res.json()) as { user: { id?: unknown } | null };
        return typeof data.user?.id === 'string' ? data.user.id : null;
      } catch (err) {
        log({ level: 'warn', msg: 'auth resolve failed', err: String(err) });
        return null;
      }
    },

    report(userId, add, max) {
      post('/internal/stats', { userId, add, max }).then(
        (res) => {
          if (!res.ok) log({ level: 'warn', msg: 'auth stats rejected', status: res.status });
        },
        (err: unknown) => log({ level: 'warn', msg: 'auth stats failed', err: String(err) }),
      );
    },
  };
}
