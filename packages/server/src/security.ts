import type { IncomingMessage } from 'node:http';
import type { ServerConfig } from './config.ts';

/** Seule forme de `Host` acceptée dans une directive CSP (évite l'injection d'un en-tête forgé). */
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** Origine WebSocket de la page : `wss://hôte` (HTTPS) ou `ws://hôte` (HTTP), pour `connect-src`. */
function websocketOrigin(cfg: ServerConfig, req: IncomingMessage): string | null {
  if (cfg.publicOrigin !== '') {
    try {
      const u = new URL(cfg.publicOrigin);
      return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`;
    } catch {
      return null;
    }
  }
  const host = req.headers.host;
  return host !== undefined && HOST_RE.test(host) ? `ws://${host}` : null;
}

/**
 * Politique de sécurité du contenu (analyse §2.9) : tout vient de l'origine du jeu, aucun script
 * ni style en ligne ; le WebSocket est autorisé vers l'origine publique.
 * `style-src-attr` autorise les attributs `style=""` posés par l'interface (jamais un `<style>`).
 */
export function contentSecurityPolicy(cfg: ServerConfig, req: IncomingMessage): string {
  const ws = websocketOrigin(cfg, req);
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src 'self'${ws ? ` ${ws}` : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];
  if (cfg.publicOrigin.startsWith('https://')) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/**
 * Fonctions du navigateur : manette, plein écran et lecture audio seulement, le reste est coupé.
 * La vibration (`navigator.vibrate`) n'est pas contrôlée par cet en-tête : elle reste permise.
 */
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=(self)',
  'camera=()',
  'display-capture=()',
  'fullscreen=(self)',
  'gamepad=(self)',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
].join(', ');

/** En-têtes de sécurité de toutes les réponses HTTP. */
export function securityHeaders(
  cfg: ServerConfig,
  req: IncomingMessage,
  isDocument: boolean,
): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (cfg.publicOrigin.startsWith('https://')) {
    h['Strict-Transport-Security'] = 'max-age=31536000';
  }
  if (isDocument) {
    h['Content-Security-Policy'] = contentSecurityPolicy(cfg, req);
    h['Permissions-Policy'] = PERMISSIONS_POLICY;
    h['Cross-Origin-Opener-Policy'] = 'same-origin';
    h['X-Frame-Options'] = 'DENY';
  }
  return h;
}
