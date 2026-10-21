/**
 * Mots refusés dans les pseudos (français et anglais). Comparaison après normalisation : minuscules,
 * accents retirés, substitutions courantes (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s), séparateurs
 * retirés. Les entrées de 4 lettres ou plus sont cherchées n'importe où dans le pseudo ; les plus
 * courtes doivent former un mot entier.
 */
export const BAD_WORDS: readonly string[] = [
  // français
  'merde',
  'putain',
  'pute',
  'salope',
  'salaud',
  'connard',
  'connasse',
  'conne',
  'enculer',
  'encule',
  'enfoire',
  'batard',
  'bordel',
  'branleur',
  'bite',
  'couille',
  'chier',
  'nique',
  'niquer',
  'pd',
  'pedophile',
  'pedo',
  'nazi',
  'hitler',
  'negre',
  'bougnoule',
  'raton',
  'tapette',
  'tarlouze',
  'suceur',
  'cul',
  // anglais
  'fuck',
  'fucker',
  'fucking',
  'shit',
  'bitch',
  'bastard',
  'asshole',
  'dick',
  'cock',
  'pussy',
  'cunt',
  'whore',
  'slut',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'rape',
  'rapist',
  'nazi',
  'kkk',
  'penis',
  'vagina',
  'porn',
  'sex',
];

/**
 * Mots qui sont aussi des morceaux de mots innocents (technique, fichier, connecteur…) : ils ne
 * sont refusés que seuls. À l'inverse, certains mots courts ne se cachent dans aucun mot anodin
 * et sont refusés n'importe où dans le pseudo.
 */
const EXACT_ONLY: ReadonlySet<string> = new Set(['nique', 'chier', 'conne', 'negre', 'raton']);
const ALWAYS_SUBSTRING: ReadonlySet<string> = new Set(['fuck']);

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '€': 'e',
};

function normalize(s: string): string {
  const folded = s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  let out = '';
  for (const ch of folded) out += LEET[ch] ?? ch;
  return out;
}

/** Vrai si le pseudo contient un mot refusé. */
export function isOffensive(name: string): boolean {
  const norm = normalize(name);
  // mots séparés (pour les entrées courtes), puis chaîne sans séparateurs (pour les autres)
  const tokens = norm.split(/[^a-z]+/u).filter((t) => t.length > 0);
  const squashed = norm.replace(/[^a-z]/gu, '');
  for (const bad of BAD_WORDS) {
    const anywhere = ALWAYS_SUBSTRING.has(bad) || (bad.length >= 5 && !EXACT_ONLY.has(bad));
    if (anywhere) {
      if (squashed.includes(bad)) return true;
    } else if (tokens.includes(bad) || squashed === bad) return true;
  }
  return false;
}
