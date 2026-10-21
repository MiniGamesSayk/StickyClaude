/** Limiteur à fenêtre fixe, par clé (adresse IP). Nettoyage périodique via `sweep`. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Enregistre un essai ; retourne faux si la limite est dépassée. */
  hit(key: string, now: number): boolean {
    let e = this.hits.get(key);
    if (!e || now - e.start >= this.windowMs) {
      e = { start: now, count: 0 };
      this.hits.set(key, e);
    }
    e.count++;
    return e.count <= this.limit;
  }

  /** Vrai si la limite est déjà atteinte, sans compter un nouvel essai. */
  blocked(key: string, now: number): boolean {
    const e = this.hits.get(key);
    return !!e && now - e.start < this.windowMs && e.count >= this.limit;
  }

  sweep(now: number): void {
    for (const [k, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(k);
  }

  get size(): number {
    return this.hits.size;
  }
}
