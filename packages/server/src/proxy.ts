import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

const PRIVATE_V4: [string, number][] = [
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];
const PRIVATE_V6: [string, number][] = [
  ['::1', 128],
  ['fc00::', 7],
];

function privateList(): BlockList {
  const list = new BlockList();
  for (const [a, n] of PRIVATE_V4) list.addSubnet(a, n, 'ipv4');
  for (const [a, n] of PRIVATE_V6) list.addSubnet(a, n, 'ipv6');
  return list;
}

const PRIVATE = privateList();

export function normalizeIp(addr: string | undefined): string {
  if (!addr) return 'unknown';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

function inList(list: BlockList, ip: string): boolean {
  const kind = isIP(ip);
  return kind !== 0 && list.check(ip, kind === 4 ? 'ipv4' : 'ipv6');
}

/** Adresse de loopback ou de réseau privé (dont les réseaux Docker). */
export function isPrivateIp(ip: string): boolean {
  return inList(PRIVATE, ip);
}

/** Lit `TRUSTED_PROXY` : `caddy` (réseaux privés) ou une liste d'adresses et de CIDR. */
export function parseTrustedProxy(spec: string): BlockList | null {
  const items = spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (items.length === 0) return null;
  const list = new BlockList();
  for (const item of items) {
    if (item === 'caddy' || item === 'docker' || item === 'private') {
      for (const [a, n] of PRIVATE_V4) list.addSubnet(a, n, 'ipv4');
      for (const [a, n] of PRIVATE_V6) list.addSubnet(a, n, 'ipv6');
      continue;
    }
    const [addr, bits] = item.split('/');
    const kind = isIP(addr);
    if (kind === 0) throw new Error(`TRUSTED_PROXY : « ${item} » n'est pas une adresse ou un CIDR`);
    const family = kind === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) list.addAddress(addr, family);
    else {
      const n = Number(bits);
      if (!Number.isInteger(n) || n < 0 || n > (kind === 4 ? 32 : 128)) {
        throw new Error(`TRUSTED_PROXY : préfixe invalide dans « ${item} »`);
      }
      list.addSubnet(addr, n, family);
    }
  }
  return list;
}

export interface ClientAddress {
  ip: string;
  /** La requête porte des en-têtes de proxy qu'on n'a pas crus (proxy non déclaré). */
  ignoredForwarded: boolean;
}

/**
 * Adresse du client. `X-Forwarded-For` n'est lu que si la connexion vient d'un proxy de confiance ;
 * on remonte alors la chaîne depuis la droite jusqu'à la première adresse qui n'est pas un proxy.
 */
export function clientAddress(req: IncomingMessage, trusted: BlockList | null): ClientAddress {
  const peer = normalizeIp(req.socket.remoteAddress);
  const header = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(header) ? header.join(',') : header;
  if (trusted === null || !inList(trusted, peer) || !forwarded) {
    return { ip: peer, ignoredForwarded: forwarded !== undefined && forwarded !== '' };
  }
  const chain = forwarded
    .split(',')
    .map((s) => normalizeIp(s.trim()))
    .filter((s) => isIP(s) !== 0);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!inList(trusted, chain[i])) return { ip: chain[i], ignoredForwarded: false };
  }
  return { ip: chain.length > 0 ? chain[0] : peer, ignoredForwarded: false };
}

const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded'];

/** Requête venue de l'intérieur (réseau privé ou loopback) et qui n'a pas traversé un proxy. */
export function isInternalRequest(req: IncomingMessage): boolean {
  if (!isPrivateIp(normalizeIp(req.socket.remoteAddress))) return false;
  return PROXY_HEADERS.every((h) => req.headers[h] === undefined);
}
