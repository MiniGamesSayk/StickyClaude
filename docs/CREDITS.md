# Crédits

## Assets

Phase 1 : **aucun asset repris**. Les visuels de développement sont des rectangles et des traits dessinés par code (Pixi) ; il n'y a ni son, ni musique, ni image, ni police embarquée. Les deux arènes de test (`packages/shared/arenas/*.json`) sont créées pour ce projet.

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
