/** Messages en français : ce fichier fixe la liste des clés (`MessageKey`). */
export const fr = {
  'app.title': 'StickyClaude',
} as const;

export type MessageKey = keyof typeof fr;
