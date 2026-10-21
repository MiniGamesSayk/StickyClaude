# StickyClaude

Jeu de combat de stickmen en ligne dans le navigateur, de 2 à 8 joueurs, au thème « encre et carnet ». Serveur autoritaire en Node, simulation partagée avec le client (prédiction et réconciliation), rendu PixiJS.

> **État : phase 1 sur 4** (fondations, simulation et netcode). Les 8 joueurs se déplacent ensemble de façon fluide, même avec une mauvaise connexion. Pas encore de combat, d'armes, de modes ni de vrais graphismes : voir `docs/ANALYSE.md` pour la feuille de route.

## Démarrage rapide

Prérequis : Node 22 ou plus.

```bash
npm install
npm run dev
```

Ouvre <http://localhost:5173>, crée un salon, puis ouvre un deuxième onglet et rejoins-le avec le code (ou le lien « Copier le lien »). `npm run dev` lance le serveur (port 3000, avec les outils de développement) et Vite (port 5173, qui relaie `/ws`).

**Touches** : flèches ou WASD/ZQSD pour bouger, Espace pour sauter (deux fois : double saut ; contre un mur : saut mural), ↓ + Espace sur une plateforme fine pour la traverser, F3 pour le graphe réseau. Manette : stick ou croix, A pour sauter.

**Tester un mauvais réseau** : ajoute `?lag=150&jitter=30&loss=2` à l'adresse (latence aller-retour 150 ms, gigue ± 30 ms, 2 % de pertes). Plusieurs onglets dans le même salon suffisent pour voir le résultat.

## Scripts

| Commande                          | Effet                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`                     | serveur (3000) + Vite (5173), outils de développement activés                          |
| `npm run build`                   | client (`packages/client/dist`) puis serveur (`packages/server/dist/index.js`)         |
| `npm start`                       | lance le serveur construit, qui sert aussi le client                                   |
| `npm run check`                   | lint, formatage, types et tests (à garder vert avant chaque push)                      |
| `npm test` / `npm run test:watch` | tests Vitest                                                                           |
| `npm run simulate`                | déterminisme (deux mondes, hash comparé) et coût d'un pas ; `-- --replay fichier.json` |
| `npm run loadtest`                | faux clients contre un serveur construit : `-- --rooms 25 --players 8 --duration 120`  |
| `node scripts/browser-check.mjs`  | N onglets Chromium dans un salon, avec réseau dégradé (`--clients 8 --lag 150 …`)      |

## Structure

```
packages/
  shared/   constantes, mouvement (un seul fichier), RNG, codecs binaires, schémas zod, arènes JSON
  sim/      simulation pure et déterministe : monde, déplacements, plateformes mobiles, relecture
  server/   HTTP + WebSocket, salons, boucle de ticks, entrées, snapshots, métriques
  client/   réseau (prédiction, interpolation), rendu Pixi, entrées, interface, outils de développement
scripts/    simulate, loadtest, browser-check
docs/       ANALYSE.md, NETCODE.md, DECISIONS.md, CREDITS.md, PROMPTS_SONNET.md
```

`sim` ne dépend que de `shared` : ni E/S, ni DOM, ni horloge système, ni `Math.random` (règles appliquées par ESLint), et aucune allocation dans `step` (mesuré par `npm run simulate`).

## Outils de développement

- **Réglage en direct** des 25 constantes de mouvement (`packages/shared/src/movement.ts`) : panneau en bas à droite du build de développement ; les changements sont appliqués à toute la salle.
- **Enregistrement et relecture** : `GET /dev/recording/CODE` (serveur lancé avec `DEV_TOOLS=1`) renvoie les entrées de la salle ; `?replay=/dev/recording/CODE` les rejoue dans le navigateur, `npm run simulate -- --replay fichier.json` les rejoue en ligne de commande et vérifie le hash.
- **Graphe réseau** (`F3`) : RTT, débit, corrections de prédiction, tampon d'interpolation, avance.

## Mesures

À 25 salons × 8 joueurs (200 clients, serveur sur un seul cœur) : **47 % de CPU, 26 Mo de tas, retard de boucle 3 ms, 5 Ko/s par client**, tous les budgets de l'analyse (§2.8) tenus. Détail et méthode dans `docs/NETCODE.md` §8.

## Documentation

- `docs/ANALYSE.md` : analyse fonctionnelle et technique (source de vérité)
- `docs/NETCODE.md` : protocole, formats binaires, délais, comportement en cas de perte, mesures
- `docs/DECISIONS.md` : choix qui précisent ou s'écartent de l'analyse
- `docs/CREDITS.md` : assets et licences
