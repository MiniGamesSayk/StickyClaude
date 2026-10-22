import { effect, signal } from '@preact/signals';
import { NAME_MAX } from '@stickyclaude/shared';
import { options, profile, sanitizeOptions, setOptions, setProfile } from './options.ts';
import type { Options } from './options.ts';

/**
 * Compte sayk.fr (connexion Discord). Le service `api.sayk.fr` pose un cookie de session partagé
 * par les sous-domaines ; connecté, les options, le pseudo et l'apparence suivent le joueur d'un
 * appareil à l'autre, et ses statistiques (écrites par le serveur de jeu) sont lisibles ici.
 * Hors de sayk.fr (développement local) ou si le service ne répond pas, le jeu reste anonyme et
 * tout se passe dans `localStorage`, comme avant.
 */

const GAME = 'stickyclaude';
const PUSH_DELAY_MS = 800;

/** Options qui suivent le compte ; le reste (tactile, qualité, FPS…) dépend de l'appareil. */
export const SYNCED_OPTIONS = [
  'lang',
  'master',
  'sfx',
  'music',
  'reducedMotion',
  'textScale',
  'showStats',
  'layout',
  'bindings',
] as const satisfies readonly (keyof Options)[];

export interface Account {
  id: string;
  name: string;
  avatar: string | null;
}

export const account = signal<Account | null>(null);
/** Statistiques du compte pour ce jeu (null tant que non chargées). */
export const stats = signal<Record<string, number> | null>(null);
/** Dernière erreur de connexion renvoyée par le service (`?login_error=`), à afficher une fois. */
export const loginError = signal<string | null>(null);

export function apiBase(): string | null {
  const configured = (import.meta.env as Record<string, string | undefined>).VITE_SAYK_API;
  if (configured) return configured.replace(/\/$/, '');
  return /(^|\.)sayk\.fr$/.test(location.hostname) ? 'https://api.sayk.fr' : null;
}

/** Adresse du bouton « Se connecter avec Discord » : revient sur la page courante. */
export function loginUrl(): string | null {
  const base = apiBase();
  if (base === null) return null;
  const back = new URL(location.href);
  back.searchParams.delete('login_error');
  return `${base}/auth/login?return=${encodeURIComponent(back.toString())}`;
}

export function pickSynced(o: Options): Partial<Options> {
  const out: Record<string, unknown> = {};
  for (const k of SYNCED_OPTIONS) out[k] = o[k];
  return out;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(6000),
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

let ready = false;
let started = false;
const lastPushed = { settings: '', profile: '' };
const timers: Record<'settings' | 'profile', ReturnType<typeof setTimeout> | undefined> = {
  settings: undefined,
  profile: undefined,
};

const settingsBody = (): string => JSON.stringify(pickSynced(options.value));
const profileBody = (): string =>
  JSON.stringify({ name: profile.value.name, look: profile.value.look });

function schedulePush(kind: 'settings' | 'profile'): void {
  clearTimeout(timers[kind]);
  timers[kind] = setTimeout(() => {
    const body = kind === 'settings' ? settingsBody() : profileBody();
    if (!ready || body === lastPushed[kind]) return;
    lastPushed[kind] = body;
    call(`/api/games/${GAME}/${kind}`, { method: 'PUT', body }).catch(() => {
      // Échec réseau : on réessaiera à la prochaine modification.
      lastPushed[kind] = '';
    });
  }, PUSH_DELAY_MS);
}

async function pull(user: Account): Promise<void> {
  const res = await call(`/api/games/${GAME}/data`);
  if (!res.ok) return;
  const data = (await res.json()) as {
    settings: Record<string, unknown> | null;
    profile: { name?: unknown; look?: unknown } | null;
    stats: Record<string, number>;
  };

  if (data.settings) {
    // Le compte fait foi ; sanitizeOptions écarte tout ce qui n'est pas valide.
    const merged = sanitizeOptions({ ...options.value, ...data.settings }, options.value);
    setOptions(pickSynced(merged));
  }

  if (data.profile) {
    const patch: Partial<typeof profile.value> = {};
    if (typeof data.profile.name === 'string' && [...data.profile.name].length >= 2) {
      patch.name = [...data.profile.name].slice(0, NAME_MAX).join('');
    }
    if (data.profile.look) patch.look = data.profile.look as typeof profile.value.look;
    setProfile(patch);
  } else if (/^Joueur\d{3}$/.test(profile.value.name)) {
    // Première connexion : le pseudo Discord remplace le pseudo tiré au hasard.
    const name = [...user.name].slice(0, NAME_MAX).join('');
    if ([...name].length >= 2) setProfile({ name });
  }

  stats.value = data.stats;
  // Ce qu'on vient d'appliquer est l'état du serveur : on n'a rien à renvoyer, sauf ce qu'il n'avait pas.
  lastPushed.settings = data.settings ? settingsBody() : '';
  lastPushed.profile = data.profile ? profileBody() : '';
  ready = true;
  if (!data.settings) schedulePush('settings');
  if (!data.profile) schedulePush('profile');
}

/** À appeler une fois au démarrage : lit la session et lance la synchronisation. */
export async function initAccount(): Promise<void> {
  if (started || apiBase() === null) return;
  started = true;

  const params = new URLSearchParams(location.search);
  const err = params.get('login_error');
  if (err !== null) {
    loginError.value = err;
    params.delete('login_error');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }

  effect(() => {
    void options.value;
    if (ready) schedulePush('settings');
  });
  effect(() => {
    void profile.value;
    if (ready) schedulePush('profile');
  });

  try {
    const res = await call('/api/me');
    if (!res.ok) return;
    const { user } = (await res.json()) as { user: Account | null };
    if (!user) return;
    account.value = user;
    await pull(user);
  } catch {
    // Service injoignable : on reste anonyme.
  }
}

export async function logout(): Promise<void> {
  ready = false;
  account.value = null;
  stats.value = null;
  await call('/auth/logout', { method: 'POST' }).catch(() => undefined);
}
