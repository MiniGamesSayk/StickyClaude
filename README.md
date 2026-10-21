# StickyClaude

Jeu de combat de stickmen en ligne dans le navigateur, de 2 à 8 joueurs, au thème « encre et carnet ». Serveur autoritaire en Node, simulation partagée avec le client (prédiction et réconciliation), rendu PixiJS.

> **État : phase 2 sur 4** (gameplay complet). Toutes les règles du jeu sont jouables de bout en bout : combat, 12 armes, objets, terrain destructible, manches et mort subite, équipes, 6 modes bonus, fantômes-crayons, 10 arènes, salons complets (privé, public, partie rapide, spectateurs, reconnexion). Les graphismes sont encore des formes de développement, sans son ni habillage « encre et carnet » (phase 3) ; pas encore d'image Docker ni de mise en production (phase 4). Voir `docs/ANALYSE.md` pour la feuille de route.

## Démarrage rapide

Prérequis : Node 22 ou plus.

```bash
npm install
npm run dev
```

Ouvre <http://localhost:5173>. Deux façons de jouer :

- **Partie rapide** : te place dans le salon public le plus rempli, sinon en crée un.
- **Créer un salon** : donne un code de 5 caractères (et un lien « Copier le lien ») ; un deuxième onglet le rejoint avec ce code. Dans le salon, on peut déjà sauter, se battre et ramasser des armes (les dégâts n'y comptent pas) ; chacun se déclare « Prêt », l'hôte règle la partie (mode, équipes, tir ami, manches à gagner, arènes, armes, mort subite, modes bonus, fantômes, salon public) et la lance.

`npm run dev` lance le serveur (port 3000, avec les outils de développement) et Vite (port 5173, qui relaie `/ws` et `/api`).

**Touches** : flèches ou WASD/ZQSD pour bouger et viser (8 directions), Espace pour sauter (deux fois : double saut ; contre un mur : saut mural), ↓ + Espace sur une plateforme fine pour la traverser, **J** frapper (enchaînement de 3 coups, maintenu : coup chargé, ↓ en l'air : coup de pied plongeant ; avec une arme : l'utiliser), **K** parer (une parade parfaite annule le coup et étourdit l'attaquant), **L** ramasser ou lancer (↓ + L : lâcher), **1 à 9** emotes, F3 graphe réseau. Manette : stick ou croix, A saut, X attaque, B parade, Y ramasser. Éliminé, on devient un fantôme-crayon : J pose un trait, K une goutte d'encre.

**Tester un mauvais réseau** : ajoute `?lag=150&jitter=30&loss=2` à l'adresse (latence aller-retour 150 ms, gigue ± 30 ms, 2 % de pertes). Plusieurs onglets dans le même salon suffisent pour voir le résultat.

## Scripts

| Commande                          | Effet                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | serveur (3000) + Vite (5173), outils de développement activés ; l'éditeur d'arènes est à `/editor`                                                  |
| `npm run build`                   | client (`packages/client/dist`) puis serveur (`packages/server/dist/index.js`)                                                                      |
| `npm start`                       | lance le serveur construit, qui sert aussi le client                                                                                                |
| `npm run check`                   | lint, formatage, types et tests (à garder vert avant chaque push)                                                                                   |
| `npm test` / `npm run test:watch` | tests Vitest                                                                                                                                        |
| `npm run simulate`                | déterminisme (deux mondes, hash comparé), mouvement seul puis parties enchaînées, et coût d'un pas ; `-- --replay fichier.json`                     |
| `npm run loadtest`                | faux clients qui se battent contre un serveur construit : `-- --rooms 25 --players 8 --duration 120` ; `-- --no-combat` pour les déplacements seuls |
| `node scripts/browser-check.mjs`  | N onglets Chromium dans un salon, avec réseau dégradé (`--clients 8 --lag 150 …`)                                                                   |

## Structure

```
packages/
  shared/   constantes, mouvement, combat, armes, modes, réglages, cosmétiques (fichiers de données uniques), RNG, codecs binaires, schémas zod, arènes JSON
  sim/      simulation pure et déterministe : joueurs, combat, armes, objets, terrain, manches, modes, fantômes, analyse des arènes, relecture
  server/   HTTP + WebSocket, salons, boucle de ticks, entrées, snapshots, compensation de latence, sécurité, métriques
  client/   réseau (prédiction, interpolation), rendu Pixi de développement, interface en DOM, éditeur d'arènes (dev), outils de développement
scripts/    simulate, loadtest, browser-check
docs/       ANALYSE.md, ARENES.md, NETCODE.md, DECISIONS.md, CREDITS.md, PROMPTS_SONNET.md
```

`sim` ne dépend que de `shared` : ni E/S, ni DOM, ni horloge système, ni `Math.random` (règles appliquées par ESLint), et aucune allocation dans `step` (mesuré par `npm run simulate`). Il fait deux passes : le mouvement et les actions de chaque joueur (prédits par le client), puis la résolution des coups, des objets et de la partie (serveur seulement). Voir `docs/NETCODE.md`.

## Outils de développement

- **Éditeur d'arènes** : `npm run dev` puis <http://localhost:5173/editor> (absent de la version construite) : peindre la grille, poser apparitions, objets et zones des modes, tester la vraie simulation dans la page, valider (schéma + accessibilité par simulation) et exporter le JSON. Voir `docs/ARENES.md`.
- **Réglage en direct** des 26 constantes de mouvement (`packages/shared/src/movement.ts`) : panneau en bas à droite du build de développement ; les changements sont appliqués à toute la salle.
- **Enregistrement et relecture** : `GET /dev/recording/CODE` (serveur lancé avec `DEV_TOOLS=1`) renvoie les entrées et les opérations du salon ; `?replay=/dev/recording/CODE` les rejoue dans le navigateur, `npm run simulate -- --replay fichier.json` les rejoue en ligne de commande et vérifie le hash.
- **Graphe réseau** (`F3`) : RTT, débit, corrections de prédiction, tampon d'interpolation, avance.

## Mesures

Simulation d'un salon de 8 joueurs en combat (armes, modes, fantômes) : **6 µs par pas** au p50, 15 µs au p99 (budget 150 µs). Débit par client en combat à 8 : **8,7 Ko/s** (budget 20). Charge à 25 salons × 8 joueurs avec combat actif : voir `docs/NETCODE.md` §10 — mesurée ici sous Windows, où même les déplacements seuls dépassent les budgets de CPU et de boucle ; la vérification à retenir est celle du conteneur `--cpus 1` sous Linux (phase 4). Phase 1 (Linux, un cœur) : 47 % de CPU, retard de boucle 3 ms.

## Documentation

- `docs/ANALYSE.md` : analyse fonctionnelle et technique (source de vérité)
- `docs/ARENES.md` : format des arènes, éditeur, comment en ajouter une
- `docs/NETCODE.md` : protocole, formats binaires, délais, compensation de latence, mesures
- `docs/DECISIONS.md` : choix qui précisent ou s'écartent de l'analyse
- `docs/CREDITS.md` : assets et licences
