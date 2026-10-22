import pino from 'pino';

export type LogFn = (o: Record<string, unknown>) => void;

/**
 * Journaux JSON, une ligne par événement, sur la sortie standard (pino, sans transport).
 * Les adresses IP ne sont jamais journalisées en entier : voir `truncateIp`.
 */
export function createLogger(level: string, destination?: pino.DestinationStream): LogFn {
  const base = pino(
    {
      level,
      base: { service: 'stickyclaude' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
  return (o) => {
    const { level: lv, msg, ...rest } = o;
    const name = typeof lv === 'string' && lv in base ? lv : 'info';
    (base as unknown as Record<string, (obj: object, m?: string) => void>)[name](
      rest,
      typeof msg === 'string' ? msg : undefined,
    );
  };
}

/** Masque la fin d'une adresse IP (RGPD) : 203.0.113.42 → 203.0.113.0, 2001:db8:1:2::3 → 2001:db8:1::. */
export function truncateIp(ip: string): string {
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::';
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : 'unknown';
}
