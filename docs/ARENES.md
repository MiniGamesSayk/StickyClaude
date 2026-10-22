# StickyClaude : arènes

Une arène est un fichier JSON de `packages/shared/arenas/`, validé par un schéma zod (`packages/shared/src/schemas.ts`) et par une analyse d'accessibilité qui rejoue la vraie simulation (`packages/sim/src/reach.ts`). Ce document décrit le format, l'éditeur de développement et la marche à suivre pour en ajouter une. Source de vérité du cadre : `docs/ANALYSE.md` §1.4 et §2.6.

## 1. Les arènes du jeu

| Identifiant         | Nom (fr)                      | Thème (`theme`)    | Mort subite     | Plateformes mobiles |
| ------------------- | ----------------------------- | ------------------ | --------------- | ------------------- |
| `maths-quadrille`   | Interro de maths              | `graph-paper`      | encre qui monte | 1                   |
| `partition`         | Feuille de partition          | `staff-paper`      | bords déchirés  | 1                   |
| `brouillon`         | Cahier de brouillon           | `scratch-paper`    | encre qui monte | 0                   |
| `carte-tresor`      | Carte au trésor               | `treasure-map`     | bords déchirés  | 1                   |
| `bd-cases`          | Page de BD                    | `comic-page`       | encre qui monte | 0                   |
| `page-de-garde`     | Page de garde                 | `cover-page`       | bords déchirés  | 0                   |
| `millimetre`        | Feuille millimétrée           | `millimeter-paper` | encre qui monte | 1                   |
| `dictionnaire`      | Page de dictionnaire          | `dictionary-page`  | encre qui monte | 0                   |
| `marge-gribouillis` | Marge pleine de gribouillis   | `doodle-margin`    | bords déchirés  | 2                   |
| `double-page`       | Double page (reliure, vide)   | `spread`           | encre qui monte | 1                   |
| `entrainement`      | Page d'entraînement (salon)   | `practice`         | —               | 0                   |
| `test-flat`         | Terrain de test (mouvement)   | `graph-paper`      | —               | 2                   |
| `test-tower`        | La tour (mouvement et réseau) | `ruled-paper`      | —               | 1                   |

- Les **10 premières** forment la rotation des manches (`ROTATION_ARENA_IDS`, `packages/shared/src/arenas.ts`). L'hôte peut en retenir une partie dans ses réglages.
- `entrainement` est l'arène du **salon d'attente** : on y saute, on s'y bat et on y ramasse des armes pendant l'attente ; les dégâts n'y comptent pas (les joueurs « éliminés » réapparaissent au bout d'une seconde).
- `test-flat` et `test-tower` ne sont jamais tirées au sort : ce sont les arènes des tests de mouvement et de réseau.
- Chaque arène de la rotation déclare une **colline** et deux **cages** : tous les modes bonus y sont jouables.

## 2. Format

```jsonc
{
  "id": "maths-quadrille", // a-z, 0-9 et tirets, 40 caractères au plus ; égal au nom du fichier
  "name": { "fr": "Interro de maths", "en": "Math Test" },
  "theme": "graph-paper", // fond, couleur du papier, décor (phase 3)
  "size": [64, 36], // toujours 64 × 36 cellules de 16 unités
  "grid": ["....", "…"], // 36 chaînes de 64 caractères parmi . # p - ^
  "spawns": {
    "players": [[x, y], …], // 8 au moins, 32 au plus
    "weapons": [[x, y], …]
  },
  "movers": [
    { "rect": [x, y, w, h], "path": [[x, y], [x, y]], "period": 4.0 }
  ],
  "props": [{ "type": "crate", "at": [x, y] }],
  "modes": {
    "koth": { "zone": [x, y, w, h] },
    "ball": { "goals": [[x, y, w, h], [x, y, w, h]], "spawn": [x, y] }
  },
  "decor": [{ "type": "equation", "at": [x, y], "text": "x² + 1" }],
  "suddenDeath": "ink-rise" // ou "tear-edges"
}
```

### Grille

Un caractère par cellule, `grid[y][x]` avec `y` vers le bas :

| Caractère | Cellule                  | Comportement                                             |
| --------- | ------------------------ | -------------------------------------------------------- |
| `.`       | vide                     |                                                          |
| `#`       | bloc plein               | indestructible                                           |
| `p`       | bloc de papier           | plein, **destructible** (bazooka, gomme)                 |
| `-`       | plateforme à sens unique | on atterrit dessus par le haut ; ↓ + saut pour descendre |
| `^`       | danger                   | traversable ; dégâts et rebond (encre, punaises)         |

Hors de la grille, les côtés comptent comme pleins, le haut comme vide (un joueur projeté trop haut est éliminé), et le bas comme vide (on tombe, puis on est éliminé).

### Apparitions

- `spawns.players` : cellule où le joueur **se tient debout** (ses pieds sont en bas de la cellule). Elle et celle du dessus sont libres, la cellule en dessous est un appui. Au moins 8 points, tous distincts. À chaque manche les joueurs reçoivent un point différent, tirés au sort avec le RNG de la partie.
- `spawns.weapons` : cellule libre au-dessus d'un appui ; l'arme y tombe, elle ne doit pas finir dans le vide. Une arme apparaît toutes les 6 à 10 s, 3 au plus au sol.

### Plateformes mobiles

`rect` donne la position de départ (`rect[0..1]` égal à `path[0]`) et la taille en cellules ; `path` est la liste des points visités (coin haut-gauche, en cellules), en **aller-retour** avec adoucissement à chaque point ; `period` est la durée de l'aller-retour en secondes. La position est une fonction du tick : rien à synchroniser. Elles sont **pleines** : on se pose dessus et elle nous porte, on se cogne la tête dessous, on ne les traverse pas par le côté (on peut s'y accrocher pour un saut mural) et, quand elles viennent sur un joueur, elles le repoussent. Seule la traversée vers le bas (↓) les laisse passer. Au plus 8 par arène, dans la page. **Elles ne doivent jamais être nécessaires** pour atteindre un point : l'analyse les ignore.

### Objets (`props`)

`crate` (caisse-carton : se pousse, se lance, se casse), `balloon` (ballon gonflé : flotte, explose), `tack` (punaise : piège au sol). Posés en bas de leur cellule au début de la manche.

### Modes

- `modes.koth.zone` : la colline, `[x, y, largeur, hauteur]` en cellules. Elle doit contenir au moins une position debout.
- `modes.ball.goals` : les deux cages (camp 0 puis camp 1). Chaque cage doit être à moitié libre au moins. `spawn` (facultatif) est la cellule d'apparition de la boule, par défaut entre les deux cages.
- Une arène sans `koth` ou sans `ball` est écartée des manches de ce mode.

### Décor

`decor` ne change rien au jeu : ce sont des indications pour le rendu de la phase 3 (équations, notes, croix, gribouillis, vagues, autocollants, onomatopées…). `type` est une chaîne libre (20 caractères au plus), `text` facultatif. Types utilisés aujourd'hui : `note`, `equation`, `cross`, `sticker`, `onomatopoeia`, `scribble`, `wave`, `spiral`, `axes`, `bubble`, `compass`, `binding`, `arrow`, `ruler`, `clef`.

### Mort subite

Après 75 s par défaut (réglable de 20 à 180 s) : `ink-rise` fait monter l'encre depuis le bas (14 unités/s, mortelle en une demi-seconde au contact), `tear-edges` déchire les bords gauche et droit de la page à la même vitesse. En « encre montante » (mode bonus), l'encre monte dès 5 s. Une manche dure au plus 300 s même sans mort subite.

## 3. Validation

Deux niveaux, exécutés par `npm test` pour chaque arène embarquée et, à la demande, dans l'éditeur :

1. **Schéma zod** (`arenaSchema`) : dimensions, caractères de la grille, bornes de tous les nombres, clés inconnues refusées. Le serveur échoue au démarrage si une arène embarquée n'est pas valide.
2. **Analyse par simulation** (`analyzeArena`, `packages/sim/src/reach.ts`). Elle part de chaque position où l'on peut se tenir debout, rejoue avec la **vraie fonction `step`** des séquences d'entrées types (course, saut plein ou court, double saut à plusieurs instants, saut mural, traversée d'une plateforme à sens unique) et note où l'on retombe : cela donne un graphe de positions atteignables. Elle vérifie ensuite :
   - chaque point d'apparition de joueur peut accueillir un joueur debout, et il y en a au moins 8, sans doublon ;
   - chaque point d'apparition d'arme est libre et l'arme atterrit sur un appui ;
   - tous les points d'apparition de joueurs, d'armes, et la colline sont **atteignables depuis chaque point d'apparition** (aucune impasse) ;
   - les cages, la boule et la colline sont dans la page et utilisables ;
   - les plateformes mobiles et les objets restent dans la page.

L'analyse coûte ≈ 100 ms par arène.

## 4. Niveaux de joueurs et vote de la carte

- **Créateur de niveau** (bouton « Créer un niveau » de l'accueil et du salon, `packages/client/src/ui/Creator.tsx`, modèle pur `creator/model.ts`) : peindre blocs pleins, papier, plateformes traversables (au pinceau, en rectangle ou au **seau**, la gomme vidant une case, un rectangle ou une zone : c'est ainsi qu'on met du vide) ; fond réel du thème, repère du centre de la page, **symétrie** gauche ↔ droite, haut ↕ bas ou les deux (blocs, rectangles, seau, gomme, plateformes mobiles, cages ; les apparitions et objets ne se reflètent que gauche ↔ droite), annulation qui ne retient que les vraies modifications (gommer du vide n'ajoute rien), objets dessinés comme dans le jeu, **Ctrl+Z / Ctrl+Y** ; plateformes mobiles (glisser un rectangle puis cliquer l'arrivée) ; pièges (danger, punaise) et objets (ballon, caisse) ; fond de la carte (les 12 thèmes) ; **origine de la mort subite** (l'encre monte ou les bords se déchirent) ; zones des modes (colline, cages) facultatives. Les apparitions de joueurs et d'armes se placent automatiquement (`suggestSpawns` : positions atteignables dans les deux sens). L'analyse d'accessibilité complète tourne dans un **worker** (elle prend plusieurs secondes sur un terrain très ouvert) ; « Enregistrer » et « Tester » exigent un niveau valide. Les niveaux sont gardés dans `localStorage` (12 au plus).
- **Envoi au salon** : message `arena` (JSON jusqu'à 8 Ko, seul message dépassant 1 Ko). Le serveur valide le schéma zod, refuse les noms injurieux, applique les contrôles légers d'`analyzeArena(arena, { reach: false })` (apparitions debout, armes, zones, plateformes : pas de simulation d'accessibilité, trop coûteuse pour le fil du serveur), impose l'identifiant `custom-N`, retire le décor libre et diffuse le niveau (`arena`) à tout le salon et aux nouveaux venus (avant `joined`). 6 niveaux au plus par salon, un envoi toutes les 2 s par joueur, en salle d'attente seulement ; l'auteur ou l'hôte peut le retirer (`arena_del`). Sans choix explicite d'arènes, la réserve de la partie est la rotation + tous les niveaux de joueurs.
- **Vote** : avant chaque manche, y compris la première, la simulation (`planVote`, RNG de la partie) choisit le mode de la manche puis jusqu'à 4 cartes compatibles (sans celle qui vient d'être jouée) et attend (`world.voteHold`, phase `ROUND_END`). Le salon recueille les votes (`vote` → `votes`), clôt à `VOTE_MS` ou dès que tous ont voté (1,5 s au moins), tire au sort en cas d'égalité ou d'absence de vote, enregistre l'opération `vote` pour la relecture et appelle `resolveVote`. Garde-fou : la simulation tranche seule 30 s après la fin de manche. Réglage `voteMaps` de l'hôte ; `VOTE_DEFAULT=0` côté serveur le coupe par défaut.

## 5. Éditeur de développement

```bash
npm run dev
```

puis <http://localhost:5173/editor>. La page n'existe **qu'en développement** : c'est le serveur de Vite qui la sert (`packages/client/editor/index.html`), elle n'est pas une entrée de la version construite (`packages/client/vite.config.ts`) et le serveur de production n'a aucune route `/editor`.

- **Peindre** : choisir un outil à gauche (vide, bloc plein, papier, plateforme à sens unique, danger), puis cliquer ou glisser. Clic droit : gomme.
- **Poser** : apparition de joueur, d'arme, caisse, ballon, punaise, départ de la boule (un clic pose, un second clic au même endroit retire). La colline et les cages se tracent en glissant un rectangle.
- **Charger** une arène existante dans la liste, ou repartir d'une arène neuve (cadre plein, 8 apparitions, colline et cages).
- **Plateformes mobiles et décor** : champs JSON.
- **Validation** : le panneau de droite affiche en continu les erreurs de schéma, puis celles de l'analyse (« ✓ valide · 60 positions debout, 60 atteignables »).
- **Tester ici** : lance la vraie simulation dans la page avec un stickman (flèches ou WASD, Espace, J, E, L) et un mannequin à frapper.
- **Exporter** : « Copier le JSON » ou « Télécharger le JSON » ; **importer** en collant un JSON.

Le modèle de l'éditeur (`packages/client/src/editor/model.ts`) est pur et testé : importer puis exporter une arène existante ne change rien.

## 5. Ajouter une arène

1. Dessiner l'arène dans l'éditeur, jusqu'à « ✓ valide ». Compter 8 apparitions au moins, des armes sur des appuis, et une colline et deux cages.
2. Enregistrer le JSON dans `packages/shared/arenas/<identifiant>.json` (l'identifiant du fichier est celui du champ `id`), puis `npx prettier --write` dessus.
3. Dans `packages/shared/src/arenas.ts` : ajouter l'`import`, l'entrée de `ARENAS` et, pour qu'elle entre dans la rotation, son identifiant dans `ROTATION_ARENA_IDS`.
4. Lancer `npm test` : les tests de `packages/shared/test/arenas.test.ts` (schéma, grille, apparitions, plateformes) et `packages/sim/test/arenas.test.ts` (accessibilité, colline et cages, thème et nom distincts) parcourent la liste. Le test « dix arènes aux thèmes distincts » est à ajuster si la rotation passe à onze.
5. Jouer quelques manches avec `npm run dev` pour juger de l'équilibre : l'analyse garantit que tout est atteignable, pas que c'est amusant.

L'équilibre se règle à la main : un bloc de papier destructible mal placé ouvre ou ferme un chemin en cours de manche, et l'analyse (faite sur la grille d'origine) ne le voit pas. Pour les chutes mortelles, laisser toujours un moyen de remonter (plateforme à sens unique ou mur).
