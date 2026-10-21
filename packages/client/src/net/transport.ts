/** Canal de messages client ↔ serveur (WebSocket réel, ou simulé en test). */
export interface Transport {
  readonly bufferedAmount: number;
  send(data: Uint8Array | string): void;
  close(): void;
  onOpen: (() => void) | null;
  onMessage: ((data: Uint8Array | string) => void) | null;
  onClose: ((code: number) => void) | null;
}

export class WebSocketTransport implements Transport {
  onOpen: (() => void) | null = null;
  onMessage: ((data: Uint8Array | string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  private readonly ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = (): void => this.onOpen?.();
    this.ws.onmessage = (ev: MessageEvent<ArrayBuffer | string>): void => {
      const d = ev.data;
      this.onMessage?.(typeof d === 'string' ? d : new Uint8Array(d));
    };
    this.ws.onclose = (ev: CloseEvent): void => this.onClose?.(ev.code);
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  send(data: Uint8Array | string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }
}

export interface LagOptions {
  /** Latence ajoutée aller-retour, en ms (la moitié dans chaque sens). */
  lag: number;
  /** Gigue ajoutée par sens, en ms (± uniforme). */
  jitter: number;
  /** Pourcentage de paquets « perdus » (retransmis après un délai, façon TCP). */
  loss: number;
}

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

export const realScheduler: Scheduler = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

/** Lit `?lag=&jitter=&loss=` dans une chaîne de requête ; null si aucun réglage. */
export function parseLagOptions(search: string): LagOptions | null {
  const q = new URLSearchParams(search);
  const num = (k: string): number => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const o = { lag: num('lag'), jitter: num('jitter'), loss: Math.min(50, num('loss')) };
  return o.lag > 0 || o.jitter > 0 || o.loss > 0 ? o : null;
}

/**
 * Simulateur de réseau dégradé autour d'un transport. Comme TCP, l'ordre est conservé : une
 * « perte » est une retransmission tardive qui retarde aussi tous les messages suivants
 * (blocage en tête de file). Les deux sens sont simulés indépendamment.
 */
export class LagTransport implements Transport {
  onOpen: (() => void) | null = null;
  onMessage: ((data: Uint8Array | string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  private outReady = 0;
  private inReady = 0;

  constructor(
    private readonly inner: Transport,
    private readonly opts: LagOptions,
    private readonly sched: Scheduler = realScheduler,
    private readonly random: () => number = Math.random,
  ) {
    inner.onOpen = (): void => this.onOpen?.();
    inner.onClose = (code): void => this.onClose?.(code);
    inner.onMessage = (data): void => {
      this.inReady = this.schedule(this.inReady, () => this.onMessage?.(data));
    };
  }

  get bufferedAmount(): number {
    return this.inner.bufferedAmount;
  }

  send(data: Uint8Array | string): void {
    // Copie : l'appelant réutilise ses tampons.
    const copy = typeof data === 'string' ? data : data.slice();
    this.outReady = this.schedule(this.outReady, () => this.inner.send(copy));
  }

  close(): void {
    this.inner.close();
  }

  /** Programme `fn` et retourne l'instant de livraison (pour garder l'ordre). */
  private schedule(prevReady: number, fn: () => void): number {
    const o = this.opts;
    const now = this.sched.now();
    let delay = o.lag / 2 + (this.random() * 2 - 1) * o.jitter;
    if (delay < 0) delay = 0;
    if (o.loss > 0 && this.random() * 100 < o.loss) delay += Math.max(200, o.lag * 2);
    const at = Math.max(now + delay, prevReady);
    this.sched.setTimeout(fn, at - now);
    return at;
  }
}
