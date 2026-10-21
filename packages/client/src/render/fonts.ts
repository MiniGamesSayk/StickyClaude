/**
 * Attend les polices hébergées (Patrick Hand, Bangers) avant de dessiner du texte dans un canvas
 * ou avec Pixi : sans cela, le premier rendu utiliserait la police de repli. Ne bloque jamais plus
 * de `timeoutMs` (réseau lent) : le jeu démarre alors avec la police de repli.
 */
export async function loadFonts(timeoutMs = 3000): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const load = Promise.all([
    document.fonts.load('18px "Patrick Hand"'),
    document.fonts.load('40px "Bangers"'),
  ]).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  try {
    await Promise.race([load, timeout]);
  } catch {
    /* police indisponible : repli */
  }
}
