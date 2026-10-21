# Crédits

## Assets

**Aucun asset n'est repris d'un autre jeu.** Tout ce qui se voit et s'entend a été créé pour ce projet, ou vient d'une police libre listée ci-dessous.

- **Visuels** : stickmen, armes, objets, projectiles, effets, papiers, décors des arènes, taches d'encre, curseurs et icônes sont **dessinés par code** (Pixi, Canvas 2D, SVG intégré dans la feuille de style) ; aucune image n'est embarquée. Les textures du stylo (traits, bouts, anneaux, éclats) sont générées sur un canvas au démarrage (`packages/client/src/render/pen.ts`). Les formes sont des polylignes écrites à la main (`render/shapes.ts`). Les arènes (`packages/shared/arenas/*.json`), les noms et les motifs des armes, des modes et des objets, la liste de mots refusés des pseudos et tous les textes sont écrits pour ce projet. Les noms des armes et des modes viennent de l'analyse du projet (`docs/ANALYSE.md`) et ne reprennent aucun nom de Stick Fight ni d'un autre jeu.
- **Sons et musiques** : **synthétisés par script** (`scripts/gen-audio/`, `npm run gen-audio`) : cordes pincées (Karplus-Strong), sifflets, percussions de table et bruits filtrés ; aucun échantillon, aucun fichier téléchargé. Les 36 effets et 4 musiques de `packages/client/public/audio/` sont le résultat exact de ce script (`npm run audio:check` le vérifie). Les mélodies et les rythmes sont composés pour ce projet. Licence : celle du projet.
- **Polices** (dans `packages/client/src/assets/fonts/`, woff2 réduit au latin, licence à côté de chaque fichier) :

| Police                                                         | Auteur                      | Licence     | Usage                                      |
| -------------------------------------------------------------- | --------------------------- | ----------- | ------------------------------------------ |
| [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) | Patrick Wagesreiter         | SIL OFL 1.1 | interface, noms, bulles, écriture du décor |
| [Bangers](https://fonts.google.com/specimen/Bangers)           | The Bangers Project Authors | SIL OFL 1.1 | titres, décompte, bannières, onomatopées   |

Quelques pictogrammes de l'interface (✏️ ✊ 🛡 ✋ ⛶) sont des caractères Unicode affichés par la police d'emoji du système : rien n'est embarqué. Les glyphes qui manquent au sous-ensemble latin (★ ♥ ☺ ♪ ♫ ♩) sont dessinés en vectoriel, pas écrits. Les polices sont servies par le jeu lui-même, jamais par un serveur tiers.

Aucun nom, visuel ni son de Stick Fight ou d'un autre jeu n'est utilisé.

## Logiciels libres utilisés

| Projet                                                                                               | Licence      |
| ---------------------------------------------------------------------------------------------------- | ------------ |
| [ws](https://github.com/websockets/ws)                                                               | MIT          |
| [zod](https://github.com/colinhacks/zod)                                                             | MIT          |
| [PixiJS](https://pixijs.com/)                                                                        | MIT          |
| [Preact](https://preactjs.com/), [@preact/signals](https://github.com/preactjs/signals)              | MIT          |
| [Vite](https://vite.dev/), [Vitest](https://vitest.dev/)                                             | MIT          |
| [esbuild](https://esbuild.github.io/)                                                                | MIT          |
| [fast-check](https://fast-check.dev/)                                                                | MIT          |
| [TypeScript](https://www.typescriptlang.org/)                                                        | Apache-2.0   |
| [ESLint](https://eslint.org/), [typescript-eslint](https://typescript-eslint.io/)                    | MIT          |
| [Prettier](https://prettier.io/)                                                                     | MIT          |
| [tsx](https://tsx.is/), [concurrently](https://github.com/open-cli-tools/concurrently)               | MIT          |
| [Playwright](https://playwright.dev/) (`playwright-core`)                                            | Apache-2.0   |
| [opusscript](https://github.com/abalabahaha/opusscript) (génération des sons seulement, hors du jeu) | MIT          |
| [libopus](https://opus-codec.org/) (compilé dans opusscript)                                         | BSD-3-Clause |

Le générateur de nombres pseudo-aléatoires est un xoshiro128\*\* (domaine public, D. Blackman et S. Vigna), initialisé par splitmix32.
