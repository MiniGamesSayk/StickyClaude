# Crédits

## Assets

Phases 1 et 2 : **aucun asset repris**. Les visuels de développement (stickmen, armes, objets, effets, interface) sont des rectangles, des traits et des textes dessinés par code (Pixi et DOM) ; il n'y a ni son, ni musique, ni image, ni police embarquée. Les arènes (`packages/shared/arenas/*.json` : les 10 arènes de la rotation, l'arène d'entraînement et les deux arènes de test), les noms et les motifs des armes, des modes et des objets, la liste de mots refusés des pseudos (`packages/server/src/badwords.ts`) et les textes de l'interface sont écrits pour ce projet. Les noms des armes et des modes viennent de l'analyse du projet (`docs/ANALYSE.md`) et ne reprennent aucun nom de Stick Fight ni d'un autre jeu.

La feuille de style cite la police _Patrick Hand_ (licence OFL) en première famille ; elle n'est **pas** encore hébergée dans le dépôt, le navigateur retombe sur une police cursive du système. Elle sera ajoutée en phase 3 (woff2 réduit aux caractères latins) avec sa licence.

Aucun nom, visuel ni son de Stick Fight ou d'un autre jeu n'est utilisé.

## Logiciels libres utilisés

| Projet                                                                                 | Licence    |
| -------------------------------------------------------------------------------------- | ---------- |
| [ws](https://github.com/websockets/ws)                                                 | MIT        |
| [zod](https://github.com/colinhacks/zod)                                               | MIT        |
| [PixiJS](https://pixijs.com/)                                                          | MIT        |
| [Vite](https://vite.dev/), [Vitest](https://vitest.dev/)                               | MIT        |
| [esbuild](https://esbuild.github.io/)                                                  | MIT        |
| [fast-check](https://fast-check.dev/)                                                  | MIT        |
| [TypeScript](https://www.typescriptlang.org/)                                          | Apache-2.0 |
| [ESLint](https://eslint.org/), [typescript-eslint](https://typescript-eslint.io/)      | MIT        |
| [Prettier](https://prettier.io/)                                                       | MIT        |
| [tsx](https://tsx.is/), [concurrently](https://github.com/open-cli-tools/concurrently) | MIT        |
| [Playwright](https://playwright.dev/) (`playwright-core`)                              | Apache-2.0 |

Le générateur de nombres pseudo-aléatoires est un xoshiro128\*\* (domaine public, D. Blackman et S. Vigna), initialisé par splitmix32.
