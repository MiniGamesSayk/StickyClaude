# StickyClaude : direction artistique « encre et carnet »

Ce document fixe, **avant** le code du rendu, tout ce qui fait le style du jeu : palette, traits, polices, règles d'animation, éléments à dessiner. Il est la référence de `packages/client/src/render/`, de `packages/client/src/style.css` et de la planche de référence (`/sheet`, en développement). Cadre : `docs/ANALYSE.md` §0, §1.9, §1.10, §1.11 et §2.7.

## 1. Principe

Tout le jeu a l'air **dessiné au stylo bille sur une page de cahier**. Cinq règles, du jeu aux menus :

1. **Un seul outil : le stylo.** Des traits d'encre sur du papier. Pas de dégradé lisse, pas de bord net en dehors du trait : même les cartes de menu ont un contour tremblé et une ombre « crayonnée » décalée.
2. **Les traits vivent.** Tout ce qui est dessiné au trait « bout » : les sommets sont décalés par un bruit qui change 12 fois par seconde (§5). C'est la signature du jeu.
3. **Le papier est le fond de tout.** Quadrillé, ligné, millimétré… selon la page ; il y a toujours un grain, un vignettage doux et, quand le thème s'y prête, la marge rouge.
4. **Les couleurs sont des encres.** 12 encres de joueur, une encre de décor (bleu nuit), le rouge « correcteur » pour le danger. Une surface n'est jamais remplie à plat : elle est **hachurée** (traits parallèles ou croisés).
5. **Ce qui compte se lit d'abord.** Le décor est tracé en encre pâle (transparence 55 %), les joueurs en encre pleine avec un trait plus épais, et son propre stickman est cerclé de blanc. La lisibilité à 8 joueurs prime sur le style.

## 2. Palette

### 2.1 Papier

Chaque arène déclare un `theme` ; le tableau donne le papier de chaque page. Valeurs dans `render/palette.ts` (`THEMES`).

| Thème (`theme`)    | Papier    | Ombre (bords) | Réglure                                                         | Marge rouge |
| ------------------ | --------- | ------------- | --------------------------------------------------------------- | ----------- |
| `graph-paper`      | `#f8f4e6` | `#e6dcc0`     | petits carreaux bleus (`#cfdcf1`, un carreau = une cellule × ½) | oui         |
| `ruled-paper`      | `#f8f4e6` | `#e6dcc0`     | lignes Seyès bleues (`#bccdea`), espacées d'une cellule         | oui         |
| `practice`         | `#faf7ec` | `#e8e0c6`     | grands carreaux d'une cellule (`#d4dff2`)                       | non         |
| `staff-paper`      | `#f9f5e8` | `#e5dbbd`     | portées de 5 lignes noires (`#6b6f86`), un jeu tous les 4 rangs | non         |
| `scratch-paper`    | `#f2eee2` | `#ddd5bb`     | carreaux gris (`#d9d9d6`) et plis froissés                      | non         |
| `treasure-map`     | `#efdcae` | `#cfb67a`     | quadrillage sépia (`#cdb98b`), bords brûlés                     | non         |
| `comic-page`       | `#fbf8ee` | `#e9e2cc`     | fond uni, trame de points `#e1d8bd`                             | non         |
| `cover-page`       | `#e6edf3` | `#cbd6e0`     | uni, légère texture de carton                                   | non         |
| `millimeter-paper` | `#f6f0d8` | `#e2d8b0`     | millimétré orange (`#efb98a`, trait fort tous les 5)            | non         |
| `dictionary-page`  | `#f2e8c6` | `#d9c995`     | deux colonnes de filets (`#d8c99a`), papier bible               | non         |
| `doodle-margin`    | `#f8f4e6` | `#e6dcc0`     | lignes bleues, marge rouge très large                           | oui (large) |
| `spread`           | `#f8f4e6` | `#e6dcc0`     | petits carreaux, **reliure** au centre (ombre + coutures)       | non         |

Grain : une tuile 256 × 256 de bruit (`#8b7f5c`, alpha 5 %) répétée sur toute la page. Vignettage : ombre radiale du papier vers `edge` (`#cdbf97`) sur les 6 % extérieurs. Fond du navigateur autour de la page (bandes noires d'un écran qui n'est pas en 16:9) : `#e7dfc8`, comme le dessous d'un cahier posé sur une table.

### 2.2 Encres

Les **12 encres de joueur** sont celles de `INK_COLORS` (`packages/shared/src/constants.ts`), toutes lisibles sur le papier crème :

| N°  | Encre    | Hex       | N°  | Encre         | Hex       |
| --- | -------- | --------- | --- | ------------- | --------- |
| 0   | bleu Bic | `#1f4fd1` | 6   | rose          | `#e5579a` |
| 1   | rouge    | `#d6322e` | 7   | brun          | `#7a4a2b` |
| 2   | vert     | `#1f9d55` | 8   | turquoise     | `#12a6a6` |
| 3   | noir     | `#22262e` | 9   | gris graphite | `#6b7280` |
| 4   | violet   | `#7b3fb5` | 10  | or            | `#c9a227` |
| 5   | orange   | `#e8801a` | 11  | bleu nuit     | `#1b2a5e` |

Encres de jeu (hors joueurs) :

| Usage                                             | Hex                               |
| ------------------------------------------------- | --------------------------------- |
| Contour du terrain, hachures, décor de la page    | `#1b2a5e` (bleu nuit)             |
| Hachures : alpha 0,55 ; décor : alpha 0,55        |                                   |
| Bloc de papier (remplissage ; contour au crayon)  | `#e7d6a4` ; `#8a6a2b`             |
| Danger (pointes, encre qui monte, bords déchirés) | `#d6322e` (rouge correcteur)      |
| Plateforme à sens unique, plateformes mobiles     | `#1f4fd1` (bleu Bic)              |
| Parade parfaite, éclat de victoire, colline       | `#c9a227` (or)                    |
| Encre qui monte                                   | `#1b2a5e`, alpha 0,6              |
| Mannequin d'entraînement                          | `#6b7280` (graphite), cible rouge |

**Équipes** (motif et liseré en plus de la couleur) : bleu `#1f4fd1`, rouge `#d6322e`, vert `#1f9d55`, or `#c9a227`.

### 2.3 Interface

Tokens CSS (`:root` de `style.css`) ; chaque paire texte/fond est testée à **WCAG AA** (≥ 4,5 : 1 pour le texte normal, ≥ 3 : 1 pour le grand texte et les contours), voir `render/palette.ts` (`UI`) et son test.

| Jeton        | Hex              | Usage                                              |
| ------------ | ---------------- | -------------------------------------------------- |
| `--paper`    | `#fbf7ea`        | fond des cartes                                    |
| `--paper-2`  | `#f1ead3`        | fond des champs, des lignes alternées              |
| `--ink`      | `#1b2a5e`        | texte et contours (contraste ≈ 12 : 1 sur `paper`) |
| `--ink-soft` | `#44507f`        | texte secondaire (≈ 7 : 1)                         |
| `--accent`   | `#1f4fd1`        | boutons principaux (texte `#ffffff`, ≈ 6,6 : 1)    |
| `--danger`   | `#b82a26`        | erreurs, expulsions (≈ 5,8 : 1)                    |
| `--ok`       | `#17734a`        | « prêt », succès (≈ 5,6 : 1)                       |
| `--gold`     | `#8a6a00`        | podium, texte or sur papier (≈ 4,9 : 1)            |
| `--focus`    | `#1f4fd1`        | anneau de focus (3 px, décalage 2 px)              |
| `--shadow`   | `#1b2a5e` à 22 % | ombre « crayonnée » des cartes                     |

Le texte d'interface est en bleu nuit sur crème. La taille de base est réglable (réglage « taille du texte » : 90 / 100 / 115 / 130 %).

## 3. Épaisseurs de trait

Unités de **monde** (la page fait 1 024 × 576 ; 1 cellule = 16) pour le rendu Pixi, **pixels CSS** pour l'interface.

| Élément                                       | Épaisseur            |
| --------------------------------------------- | -------------------- |
| Contour du terrain (plein)                    | 2,6                  |
| Hachures du terrain                           | 1,1 (pas 5, 45°)     |
| Contour d'un bloc de papier                   | 1,8 (crayon)         |
| Plateforme à sens unique                      | 2,2 (double trait)   |
| Décor de la page                              | 1,4                  |
| Stickman, **stylo bille**                     | 2,4                  |
| Stickman, **feutre**                          | 4,2                  |
| Stickman, **crayon**                          | 2,9 (grain)          |
| Stickman, **pinceau**                         | 1,8 à 4,6 (variable) |
| Contour blanc de son propre stickman          | + 2,6 de chaque côté |
| Armes et objets                               | 2,0                  |
| Effets (anneaux, lignes de vitesse)           | 1,6 à 2,4            |
| Rature de mort                                | 2,4                  |
| Interface : contour des cartes et des boutons | 2,5 px               |
| Interface : champs, séparateurs               | 2 px, 1 px           |

Bout des traits : toujours **arrondi** ; jonctions arrondies. Le trait n'a jamais une largeur parfaitement constante : ±8 % le long d'un segment (bille et crayon).

## 4. Polices

Deux polices libres (licence **OFL**), **hébergées dans le dépôt** en woff2 réduit au latin (`packages/client/src/assets/fonts/`, licences à côté), jamais chargées depuis un serveur tiers :

| Police           | Usage                                                                                   | Poids |
| ---------------- | --------------------------------------------------------------------------------------- | ----- |
| **Patrick Hand** | toute l'interface, les noms, les bulles d'emote, le décor écrit (équations, notes)      | 24 Ko |
| **Bangers**      | titres, décompte, bannières, onomatopées (BAM, POW, CRAC, ZIP, SPLAT), scores de manche | 24 Ko |

Repli : `'Comic Sans MS', 'Segoe Print', cursive`. Les glyphes absents du sous-ensemble latin (★ ♥ ☺ ♪ ♫ ♩) sont **dessinés** (formes vectorielles) et non écrits.

## 5. Règles d'animation

- **Line boiling, « en deux » à 12 i/s.** Les sommets de chaque trait sont décalés d'un bruit qui change **12 fois par seconde**, en cyclant sur **3 variantes précalculées** (A B C B…). Amplitude : 0,55 unité sur les stickmen, 0,8 sur le terrain, 0,35 sur l'interface (CSS `steps()`). Aucun coût par image : les variantes sont une table, ou trois rendus en cache. Désactivé en mouvement réduit et en qualité basse.
- **Les corps restent fluides.** Les positions suivent la simulation à la cadence de l'écran (60, 120, 144 Hz). Seuls le tremblé et les effets secondaires (étincelles, éclats) sont « en deux ».
- **Poses-clés mélangées en 80 à 120 ms.** Chaque état (garde, course, saut, chute, mur, accroupi, coups 1-2-3, charge, parade, étourdi, emote) est une pose-clé ; on passe de l'une à l'autre par un mélange exponentiel (τ = 40 ms ≈ 100 ms pour 90 %). Anticipation avant un coup (recul du bras, 2 ticks) et retombée après (repli).
- **Pieds et mains par IK à 2 os** : les pieds se posent sur le sol réel (pentes, bords), les mains tiennent l'arme à deux mains si besoin.
- **Hit-stop visuel de 50 à 90 ms** sur les gros coups (la simulation ne s'arrête pas) : les deux protagonistes figent leur pose et leur position affichées, puis rattrapent en ≈ 60 ms. Tremblement d'écran proportionnel (amplitude 2 à 7 unités, 180 ms, amorti).
- **Page qui se tourne** entre les manches (0,7 s), **arène qui se dessine** trait par trait (0,8 s), décompte « écrit à la main » (chiffre qui se trace, 0,5 s).
- **Effets** : taches d'encre persistantes (au plus 48 par manche), onomatopées sur les gros coups (pop-in avec dépassement de 12 %, 450 ms), éclats de papier (au plus 300), traînées, flash de parade parfaite (or, 120 ms).
- **Interface** : apparition d'une carte = « dessinée » par un fondu + déplacement de 6 px en 140 ms ; survol d'un bouton = contour qui re-tremble ; jamais plus de 200 ms.
- **Flashs** : jamais plus de 3 par seconde (limiteur global, §11 de l'analyse).
- **Mouvement réduit** (`prefers-reduced-motion` ou option) : ni tremblement d'écran, ni line boiling, ni hit-stop ; page qui se tourne et arène qui se dessine deviennent un fondu de 150 ms ; les transitions d'interface sont instantanées.

## 6. Éléments à dessiner

### 6.1 Le stickman

Squelette de **13 points** : tête, cou, épaules (×1 centrale), coudes (×2), mains (×2), bassin, genoux (×2), pieds (×2). Proportions (corps debout de 28,8 unités : 1,8 cellule) : tête = rond de 5,2 de rayon ; cou à 9 % de la hauteur sous le haut de la tête ; torse 30 % ; cuisses et jambes 25 % chacune ; bras 17 % + 17 %. Segments épais à extrémités arrondies, dans le style de trait choisi (§3). Style de trait : **stylo bille** (fin, régulier), **feutre** (épais, plat), **crayon** (grainé, un peu transparent), **pinceau** (largeur qui varie selon la vitesse du membre).

- **Contour de son propre stickman** : le même squelette redessiné en blanc, + 2,6 de chaque côté, sous le trait coloré.
- **Daltoniens** : chaque encre a un **motif** de poitrine (12 motifs : points, rayures, damier, zigzag, croix, anneau, triangle, losange, étoile, vagues, spirale, cœur) ; en équipes, les stickmen portent le motif de leur **équipe** (4) et un liseré à sa couleur.
- **Accessoires** (12) : aucun, casquette, haut-de-forme, bandeau de ninja, couronne en papier, chapeau de sorcier, antennes, lunettes, nœud, casque de chantier, cornet de glace, auréole : tracés au même stylo, accrochés à la tête.
- **Emote de victoire** (4) : poings levés, saut périlleux, salut, danse ; **emotes** du stickman : salut, danse, rire.
- **Mort** : ragdoll de Verlet (13 points, contraintes de distance et de flexion) puis **rature** (un gribouillis en zigzag par-dessus) à 1,2 s, qui s'efface.
- **Fantôme-crayon** : un crayon (et non un stickman) avec un cône de visée, tracé en gris graphite à 70 %.
- **Mannequin** (entraînement) : stickman gris graphite, tête sans visage, **cible** rouge sur le torse.

### 6.2 Armes et objets

Les 12 armes + la caisse portée, les objets (caisse-carton, ballon, punaise, mine, boulette-ball) et les projectiles (boulette, avion, roquette, gomme, objet lancé) sont des **polylignes** tracées au stylo (`render/shapes.ts`), en alpha 100 %, encre noire ou couleur propre à l'arme. Une arme **apparaît dessinée en direct** : un crayon la trace en 0,8 s (l'événement `WEAPON_SPAWN`), puis elle tombe.

### 6.3 Page et décor

- **Terrain** : contours par marching squares (grille sur-échantillonnée ×2), sommets déformés à main levée (bruit de valeur, ± 1,2 unité), hachures à 45° dans les blocs pleins (plus denses près du bord), **blocs de papier** en papier froissé (pli en diagonale, contour au crayon), **plateformes à sens unique** en double trait bleu, **dangers** en pointes de stylo rouges.
- **Décor** de la page (champ `decor` de l'arène) : `equation`, `note`, `cross`, `sticker`, `onomatopoeia`, `scribble`, `wave`, `spiral`, `axes`, `bubble`, `compass`, `binding`, `arrow`, `ruler`, `clef`, tous dessinés par code (ou écrits en Patrick Hand), à 55 % d'encre.
- **Encre qui monte** : une nappe d'encre bleu nuit à bord ondulé, bulles. **Bords déchirés** : lisière en dents de papier arraché.

### 6.4 Effets

| Effet                    | Rendu                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Taches d'encre           | éclaboussure (disque irrégulier + gouttes) de la couleur de la victime, persistante                                |
| Onomatopées              | BAM, POW (coups), CRAC (terrain, caisse), ZIP (tirs), SPLAT (explosion d'encre) en Bangers dans une bulle dentelée |
| Éclats de papier         | petits quadrilatères blancs qui tournent, depuis les blocs de papier et les caisses                                |
| Traînées                 | traits qui s'estompent derrière avion, roquette, gomme, boulette                                                   |
| Lignes de vitesse        | 3 à 5 traits derrière un coup chargé ou une chute rapide                                                           |
| Flash de parade parfaite | cercle or qui s'élargit + 4 éclats                                                                                 |
| Étincelles de coup       | 5 à 8 petits traits en étoile                                                                                      |
| Bulles d'emote           | bulle de BD blanche (Patrick Hand), queue vers le joueur                                                           |

## 7. Interface

- **Carte** : fond `--paper`, contour de 2,5 px, **rayons asymétriques** (`255px 15px 225px 15px / 15px 225px 15px 255px`) qui donnent le trait de main levée, ombre décalée de (5, 6) px à 22 %.
- **Bouton** : plein bleu Bic (principal) ou papier (secondaire), même contour tremblé ; au survol, le contour « re-bout » (deux variantes de rayons alternées toutes les 83 ms) ; au clic, il s'enfonce de 2 px.
- **Champs** : fond `--paper-2`, contour de 2 px ; focus = anneau de 3 px `--focus`.
- **HUD dans la marge** : scores du bord gauche en **bâtons de comptage** (groupes de 4 traits barrés par un 5ᵉ), minuteur de mort subite griffonné en haut, barre de vie et munitions en petits traits au-dessus des stickmen (elle s'efface 2 s après le dernier dégât), flèche au bord de l'écran pour un joueur hors cadre.
- **Curseur** : un **crayon** (SVG intégré, 24 × 24 px, pointe en bas à gauche) sur toute la page ; main (stylo plume) sur les éléments cliquables.
- **Transitions d'écran** : la carte se « dessine » (fondu + 6 px de glissement, 140 ms), jamais de glissement d'un bord à l'autre.

## 8. Accessibilité

Mouvement réduit (§5), motifs pour les daltoniens (§6.1), contraste AA des menus (§2.3, testé), taille du texte réglable (90 à 130 %), focus visible sur tout (anneau de 3 px), navigation complète au clavier et à la manette, flashs ≤ 3 par seconde.

## 9. Planche de référence

`npm run dev`, puis <http://localhost:5173/sheet> : une page **de développement seulement** (comme `/editor`, absente du build de production) qui affiche tous les éléments ci-dessus avec les vrais modules de rendu : palette du papier et des encres, épaisseurs de trait, polices, les 12 stickmen (poses, styles de trait, motifs, accessoires), les 13 armes et objets, les effets, le décor de chaque arène et les composants d'interface. Les captures de `docs/screenshots/` (dont `sheet.png`) viennent de la suite E2E (`npm run e2e`).
