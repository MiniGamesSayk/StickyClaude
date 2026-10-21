# Décisions

Journal des choix qui précisent ou s'écartent de `docs/ANALYSE.md`. Une entrée par décision : date, contexte, choix, alternative écartée. Les entrées les plus récentes sont en bas de chaque phase.

## Phase 1 : fondations, simulation et netcode (21/10/2026)

### D1. Entrées étiquetées par tick plutôt que numérotées

- **Contexte.** L'analyse (§2.4) décrit une séquence d'entrée (`u16`) et un tampon de gigue côté serveur (2 à 4 ticks). Or les plateformes mobiles sont une fonction pure du tick (§2.3) : pour que la prédiction concorde avec le serveur, le client doit exécuter l'entrée _au même tick_ que lui. Avec une simple file, le tick d'exécution dépend de la gigue et la prédiction diverge dès qu'un joueur est sur une plateforme.
- **Choix.** Chaque entrée porte le numéro de tick serveur où elle doit s'exécuter (`INPUT.tick`, 16 bits de poids faible). Le client vise `tick serveur estimé + latence aller + avance`, le serveur place l'entrée dans un anneau de 64 cases et la consomme au bon tick, en répétant la dernière si elle manque. Le serveur renvoie la marge (avance réelle des entrées reçues) et le client règle son avance (1 à 4 ticks de marge). Voir `NETCODE.md` §2.
- **Alternative.** File d'entrées avec tampon de gigue fixe : plus simple, mais la prédiction n'est exacte que sans plateforme mobile, et la latence ajoutée est constante au lieu d'être adaptée à la connexion.

### D2. Bloc « état exact » dans chaque snapshot, pour la réconciliation

- **Contexte.** L'analyse prévoit position, vitesse, drapeaux et « dernière séquence traitée ». Pour _rejouer_ des entrées après une correction, il faut aussi les compteurs cachés (coyote, mémoire du saut, blocage mural, traversée, `prevInput`…) ; sans eux, chaque correction en provoque une autre.
- **Choix.** Un bloc de 28 octets propre au destinataire (flottants 32 bits, compteurs, `prevInput`) : l'état de prédiction complet. Le snapshot du tick `S` contient aussi `S` : plus besoin d'un champ « séquence traitée ». Coût : 28 octets sur ≈ 173, soit 0,8 Ko/s.
- **Alternative.** Restaurer position et vitesse seulement et laisser le jeu « se rattraper » : fonctionne en vol libre mais fausse les sauts bufferisés et les sauts muraux.

### D3. Envoi des snapshots décalé par client

- **Contexte.** Le test de charge (200 clients) montrait des rafales : tous les clients d'une salle recevaient leur snapshot sur le même tick (une centaine d'envois d'un coup, ≈ 2 ms), d'où un retard de boucle de plus de 10 ms au p99.
- **Choix.** Un client reçoit son snapshot quand `(tick + slot) % intervalle == 0` : chacun garde 30 snapshots/s, mais les envois se répartissent sur tous les ticks. Tick complet p99 : 9,5 ms → 4,1 ms (mesuré avec, en même temps, un générateur de charge multi-thread moins rafaleux).
- **Alternative.** Décaler par salle seulement (déjà le cas par construction) : insuffisant à 8 joueurs par salle.

### D4. Pas de collision entre joueurs

- **Contexte.** L'analyse ne la demande pas (« chaos physique », knockback). Une collision rendrait la prédiction de chaque joueur dépendante des autres, ce qui est incompatible avec le choix d'un monde de prédiction à un seul joueur actif.
- **Choix.** Les stickmen se traversent. Le combat (phase 2) passe par des hitbox, pas par la physique des corps.
- **Alternative.** Collisions douces : demanderait de prédire les autres joueurs et d'accepter des corrections fréquentes.

### D5. Plateformes mobiles : à sens unique, position = fonction du tick

- **Contexte.** « Boîtes cinématiques à trajectoire paramétrée par le tick » (§2.3). Une plateforme pleine oblige à gérer l'écrasement et la poussée latérale, sans bénéfice en phase 1.
- **Choix.** Les plateformes mobiles se comportent comme des plateformes à sens unique (on atterrit dessus par le haut, on les traverse par le bas et les côtés, bas + saut pour descendre). Trajet aller-retour avec adoucissement (smoothstep) à chaque point ; `period` = durée de l'aller-retour. Le déplacement du tick `t` est `pos(t) − pos(t−1)` ; les joueurs qui y sont posés sont entraînés. L'indice de la plateforme est transmis dans les drapeaux de joueur pour recoller les joueurs distants à l'écran.
- **Alternative.** Plateformes pleines : à reprendre si une arène en a besoin.

### D6. Format de la grille d'arène : tableau de 36 chaînes

- **Contexte.** L'analyse propose « base64 ou chaîne RLE », un caractère par cellule.
- **Choix.** `grid` est un tableau de 36 chaînes de 64 caractères parmi `.#p-^`. Lisible et facile à comparer dans git ; 2,3 Ko non compressés, négligeable. Validé par zod (`packages/shared/src/schemas.ts`) au démarrage du serveur et dans les tests.
- **Alternative.** RLE : plus compact, illisible à la main (l'éditeur de la phase 2 pourra l'exporter dans le format de son choix).

### D7. Traversée d'une plateforme à sens unique : bas + saut

- **Contexte.** « S'accroupir ; traverser vers le bas une plateforme à sens unique » (§1.2), sans préciser la commande. Bas seul sert déjà à s'accroupir et à la chute rapide.
- **Choix.** Bas + appui sur saut, debout sur une plateforme à sens unique (et non sur un bloc plein) : le joueur tombe à travers pendant 14 ticks. Fonctionne au clavier, à la manette et au tactile (joystick bas + bouton).
- **Alternative.** Maintenir bas pendant 0,2 s : ambigu avec l'accroupi.

### D8. Les touches Haut/Z/W ne sautent pas

- **Contexte.** Le tableau §1.6 donne Espace pour sauter ; `UP` sert à viser (8 directions).
- **Choix.** Saut = Espace (manette : A). Les touches sont lues par `event.code` (position physique) : WASD sur QWERTY et ZQSD sur AZERTY fonctionnent sans détection de disposition. La reconfiguration complète reste en phase 3.

### D9. Saut à hauteur variable par facteur de coupure

- **Choix.** Au relâchement du saut en montée, la vitesse verticale est multipliée par `jumpCut` (0,45) une seule fois. Saut tenu : ≈ 3,2 cellules ; appui d'un tick : moins d'une cellule. Coyote time et mémoire du saut : 6 ticks (100 ms). Le double saut exige un appui frais (une mémoire de saut expirée ne le déclenche pas) et passe après le saut au sol et le saut mural.
- **Alternative.** Gravité renforcée quand le bouton est relâché : plus souple, mais la hauteur minimale dépend du moment du relâchement.

### D10. Collisions : balayage exact par axe, grille hors cadre

- **Choix.** Le mouvement est balayé axe par axe contre les colonnes/rangées traversées : aucun effet tunnel, quelle que soit la vitesse (testé jusqu'à 50 000 u/s). Une tolérance de 10⁻³ unité absorbe les erreurs d'arrondi quand une arête tombe sur une frontière de cellule. Hors de la grille, les côtés et le haut comptent comme pleins/vides respectivement (`x` hors cadre : plein ; `y < 0` : vide ; `y ≥ 36` : vide, donc on peut tomber). Sous 3 cellules en dessous de la page, le joueur réapparaît (placeholder des morts de la phase 2).

### D11. Un seul monde de prédiction à un joueur actif

- **Choix.** Le client crée un `World` complet (mêmes arène et graine) mais n'y active que son propre joueur ; les autres sont interpolés. Le monde de prédiction reste donc indépendant des snapshots des autres joueurs.

### D12. Entrée manquante : répétition 20 ticks, puis neutre

- **Contexte.** Si aucune entrée n'arrive pour un tick, répéter la dernière est le bon choix pour des touches tenues ; mais pour une connexion tombée, le joueur courrait jusqu'au heartbeat.
- **Choix.** Répétition jusqu'à 20 ticks (333 ms), puis entrée neutre.

### D13. Salles d'attente à 60 Hz en phase 1

- **Contexte.** §2.5 prévoit 30 Hz et 15 snapshots/s pour les salles d'attente. Les salons n'ont pas encore d'état de partie ; une simulation à 30 Hz changerait le modèle de prédiction pour rien.
- **Choix.** Toutes les salles sont à 60 Hz, 30 snapshots/s par client. Les budgets sont tenus dans ce pire cas. L'optimisation viendra avec les salons complets (phase 2).

### D14. Salles vides conservées 300 s

- **Choix.** Une salle sans joueur n'est plus simulée mais survit `ROOM_IDLE_TTL_SEC` (300 s) : un joueur qui recharge la page peut retrouver son code. Elle compte dans `MAX_ROOMS`.

### D15. Limites configurables par l'environnement

- **Choix.** En plus de §2.5 : `CREATE_PER_MIN` (3), `CODE_TRIES_PER_MIN` (10), `HEARTBEAT_MS` (10 000), `RECORD_DIR`, `METRICS_TOKEN`, `PUBLIC_ORIGIN`, `ALLOW_NO_ORIGIN`, `DEV_TOOLS`, `STATIC_DIR`. Les défauts sont ceux de l'analyse ; le test de charge relève les limites par IP (200 clients depuis une seule adresse). Heartbeat : ping toutes les 10 s, déconnexion après 3 pings sans réponse (30 s).

### D16. `/metrics` : retard de boucle = valeur de l'histogramme − 10 ms

- **Contexte.** `perf_hooks.monitorEventLoopDelay` compte la période de sondage dans chaque mesure (une boucle inactive affiche 10,2 ms avec une résolution de 10 ms). Sans correction, le budget « retard de boucle p99 < 10 ms » était impossible à tenir.
- **Choix.** On retranche la période de sondage (`LOOP_RESOLUTION_MS`) ; `GET /metrics?reset=1` remet les fenêtres de mesure à zéro (utilisé par `loadtest`). Même correction côté générateur de charge.

### D17. Simulateur de lag : `lag` = aller-retour, perte = retransmission TCP

- **Choix.** `?lag=150` ajoute 150 ms d'aller-retour (75 ms par sens). `?loss=2` ne supprime pas de messages (TCP n'en perd pas) : 2 % des messages sont retransmis après `max(200 ms, 2 × lag)` et retardent tous les suivants. C'est le scénario le plus dur pour un jeu temps réel sur WebSocket.

### D18. Rendu de développement et UI minimale en DOM

- **Choix.** Phase 1 : rectangles et traits Pixi, menu et panneau de salon en DOM sans framework. Preact arrive en phase 3 avec l'interface complète : il serait inutile avant. Pas de police embarquée (la pile `font-family` cite _Patrick Hand_ qui sera hébergée en phase 3).

### D19. Zod hors du bundle client

- **Choix.** `@stickyclaude/shared` (constantes, types, codecs, arènes) n'importe pas zod ; les schémas sont dans `@stickyclaude/shared/schemas`, importé par le serveur et les tests seulement. Le client valide les messages du serveur par typage, pas à l'exécution. Gain mesuré : ≈ 90 Ko gzip (zod 4 minifié).

### D20. Serveur HTTP natif et `esbuild`

- **Choix.** `node:http` + `ws` (en mode `noServer`) plutôt que Fastify : le serveur ne sert que le statique, `/healthz` et `/metrics`. Le build produit un unique `packages/server/dist/index.js` (ws et zod inclus, 935 Ko non minifié) avec esbuild ; l'image de la phase 4 n'aura besoin que de ce fichier et du client construit.

### D21. TypeScript 5.9 et `noUncheckedIndexedAccess` désactivé

- **Contexte.** `typescript-eslint` ne prend pas encore en charge TypeScript 7 ; on reste sur 5.9. `noUncheckedIndexedAccess` obligerait à écrire `!` à chaque accès à un tableau typé dans la simulation (chemin chaud, indices maîtrisés par construction).
- **Choix.** Mode `strict` complet, sans cette option. `eslint --fix` retire les assertions superflues.

### D22. Dépendances

| Dépendance                                              | Rôle                                   | Taille / licence                               | Justification                                             |
| ------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `ws` 8                                                  | WebSocket serveur (et clients de test) | ≈ 130 Ko, MIT                                  | Imposé par l'analyse ; `uWebSockets.js` exclu (musl)      |
| `zod` 4                                                 | validation des messages et des arènes  | ≈ 90 Ko gzip, MIT (serveur et tests)           | Imposé par l'analyse ; absent du client                   |
| `pixi.js` 8                                             | rendu WebGL                            | client complet : 174 Ko gzip (budget 400), MIT | Imposé par l'analyse                                      |
| `vite` 8, `esbuild`                                     | build client, bundle serveur           | dev, MIT                                       | Comme goldmine                                            |
| `vitest` 5, `fast-check` 4                              | tests                                  | dev, MIT                                       | Imposé par l'analyse                                      |
| `typescript`, `eslint`, `typescript-eslint`, `prettier` | qualité                                | dev, Apache-2.0 / MIT                          | `npm run check`                                           |
| `tsx`, `concurrently`                                   | scripts, `npm run dev`                 | dev, MIT                                       | Exécuter TypeScript sans build ; lancer serveur + Vite    |
| `playwright-core` 1.56                                  | `scripts/browser-check.mjs`            | dev, Apache-2.0 (sans navigateur embarqué)     | Contrôle en vrai Chromium (réutilisé pour l'E2E, phase 3) |

Aucune dépendance de production dans le client en dehors de Pixi ; aucune dans `shared` en dehors de zod (schémas) ; aucune dans `sim`.

### D23. Questions ouvertes pour la phase 2

- **Compensation de latence** : `interp` est déjà transmis ; reste à conserver 200 ms d'historique de positions et à rembobiner pour la mêlée et les tirs instantanés (§2.4). Le serveur répète les entrées manquantes pendant 20 ticks : à surveiller quand une attaque peut être répétée.
- **Corrections après blocage TCP** : l'écart maximal observé est de ≈ 20 unités à 2 % de pertes (jusqu'à ≈ 60 à 5 %). Une piste si cela gêne en jeu : reprendre les entrées arrivées en retard pour ré-simuler _un seul joueur_ côté serveur (possible tant que rien ne dépend d'autrui, donc pas avec le combat).
- **CPU** : 47 % d'un cœur à 200 joueurs (budget 60 %), dominé par les appels système. Si la mesure en conteneur à 1 CPU (phase 4) dépasse, passer à un paquet d'entrées tous les 2 ticks.

Suite : la compensation de latence est faite (D26) ; l'enregistrement des entrées est devenu un enregistrement d'opérations (D37) ; le « ré-simuler un seul joueur » n'est plus possible avec le combat (D24) ; le CPU reste à vérifier en conteneur (D45).

## Phase 2 : gameplay complet (21/10/2026)

### D24. Les règles du jeu vivent dans `sim`, derrière le même `step`, en deux passes

- **Contexte.** Le client doit prédire ses propres actions (§2.4), mais ni les dégâts, ni les ramassages, ni les scores : ils dépendent des autres joueurs, que le client n'a que dans le passé.
- **Choix.** `step(world, inputs)` fait deux passes. **Passe 1**, pour tous les mondes : minuteries, mouvement et machine à états des actions de chaque joueur (enchaînement de coups, charge, parade, coup de pied, tir, lancer, munitions), qui ne dépendent que de lui, de ses entrées et du décor. **Passe 2**, si `world.auth` (serveur, entraînement hors ligne) : résolution des coups et des tirs, objets, projectiles, explosions, terrain, manches. Le monde de prédiction du client n'exécute que la passe 1 (`world.auth = false`) et avance seulement les compteurs de phase de partie (`stepGameClient`). Toutes les valeurs de combat sont dans `shared/src/combat.ts`, `weapons.ts`, `modes.ts`.
- **Alternative.** Deux simulations distinctes (client et serveur) : plus simple à écrire, mais elles divergeraient ; ou prédire aussi les coups reçus, ce qui exigerait de prédire les autres joueurs.

### D25. Compensation de latence dans le masque d'entrées, posée par le serveur

- **Choix.** Le masque d'entrées fait 16 bits : les bits 0 à 7 sont les boutons, les bits 12 à 15 portent le retard de compensation en ticks. Le serveur ne lit des paquets que les 8 premiers bits (`INPUT_MASK_USED`) et ajoute lui-même le retard borné avant d'appeler `step` : la simulation reste une fonction pure de `(état, masques)`, et un client ne peut pas se donner de compensation.
- **Alternative.** Un second tableau d'arguments à `step` : même effet, mais l'enregistrement et la relecture devraient le transporter à part.

### D26. Historique de 250 ms au lieu de 200, et `rewind` = RTT + avance + interpolation

- **Contexte.** L'analyse (§2.4) remonte au « tick de l'entrée moins le retard d'interpolation ». Mais les entrées sont étiquetées _dans le futur_ (D1) : ce que le tireur voit date de `RTT/2 + interpolation` avant l'instant où il tire, et son entrée s'exécute `RTT/2 + avance` après. Il faut donc remonter du tick d'exécution de `RTT + avance + interpolation`, soit jusqu'à 230 ms pour 100 ms de RTT.
- **Choix.** Le serveur garde 16 ticks de positions (`HISTORY_TICKS`) et remonte au plus de 15 ticks (250 ms, `LAG_COMP_MS`). Le client annonce la durée totale (champ `rewind` des paquets d'entrées, pas de 4 ms), bornée par le serveur ; elle sert à la mêlée, aux tirs instantanés et à l'aide à la visée (±8°, identique pour tous les appareils). Les projectiles lents ne sont pas compensés (§2.4). Au-delà de 250 ms, la compensation est partielle.
- **Alternative.** 200 ms comme dans l'analyse : le tireur au-dessus de ≈ 70 ms de RTT n'aurait déjà plus été compensé en entier.

### D27. Les coups d'un tick sont mis en file, puis appliqués ensemble

- **Contexte.** Si le premier joueur traité frappe et que son adversaire est étourdi ou projeté avant d'avoir frappé, l'ordre des emplacements décide du vainqueur.
- **Choix.** `resolveMelee` et `resolveActions` détectent d'abord tous les coups du tick (`queueHit`), puis `applyHits` les applique dans l'ordre de détection : deux coups simultanés se touchent tous les deux. Un coup détecté ne dépend pas de l'état que ceux du même tick vont produire. La parade (70 % de dégâts en moins de face, parfaite dans les 6 premiers ticks) se juge à l'application.
- **Alternative.** Appliquer chaque coup tout de suite : plus simple, mais l'emplacement 0 aurait un avantage systématique.

### D28. Bloc « état exact » de 69 octets

- **Contexte.** D2 : 28 octets suffisaient pour le mouvement. La rejouabilité du combat demande aussi les compteurs d'attaque, de charge, de parade, d'étourdissement, les munitions, le grappin, le curseur fantôme.
- **Choix.** 41 champs, 69 octets, flottants 32 bits pour les positions (`OWN_FIELDS`). C'est ≈ 2 Ko/s par client ; le snapshot de 8 joueurs en combat fait ≈ 280 octets et le total mesuré 8,7 Ko/s (budget 20). Tout le bloc est comparé à la prédiction (D40) : une divergence sur un seul champ restaure l'état et rejoue.
- **Alternative.** Ne restaurer que le mouvement et « laisser rattraper » le combat : une parade ou un coup chargé en cours se décalerait d'un tick à chaque correction.

### D29. Événements fiables génériques

- **Choix.** Un événement = `u8 slot` puis un entier 16 bits par argument ; le format de chaque type est un seul tableau (`EVENT_SPECS`, un caractère par argument : position au 1/8 d'unité, entier signé ou non). Au plus 24 par snapshot, 13 octets de charge. Les événements restent dans le journal de la salle (128) jusqu'à l'accusé du client ; un client en retard de plus de 120 est déconnecté. Les événements de mouvement ne sont pas transmis (le client les recalcule pour lui-même, et lit l'état d'animation des autres).
- **Côté client.** Les événements qui changent le monde (terrain, traits de fantôme, flaques) sont appliqués dès leur réception, par les mêmes fonctions entières que le serveur ; les effets (coups, explosions, éliminations) attendent que l'interpolation atteigne le tick de leur snapshot, pour coller à ce que l'on voit des autres joueurs.
- **Alternative.** Une charge utile propre à chaque type de message : plus compacte, mais un décodeur et un test de plus par événement.

### D30. Terrain destructible : un entier par cellule, calcul identique des deux côtés

- **Choix.** Une destruction est `(cellule x, cellule y, rayon en dixièmes de cellule)` ; `destroyCircle` n'utilise que des entiers, donc serveur et client obtiennent le même terrain. Les blocs détruits ne reviennent pas pendant la manche. Un arrivant reçoit le terrain courant (`rows`, 36 chaînes) dans `joined`. Les traits des fantômes expirent à `tick de pose + durée`, donc à l'instant exact du serveur même si l'événement arrive en retard. Les traits et flaques déjà posés ne sont pas envoyés à un arrivant (quelques secondes de vie).
- **Alternative.** Renvoyer la grille entière à chaque destruction : 2,3 Ko par explosion.

### D31. Les mines adverses armées sont invisibles : snapshots filtrés par destinataire

- **Choix.** Une mine armée n'apparaît pas dans la liste d'objets de ses ennemis (équipe différente, ou joueur seul contre tous) ; les spectateurs voient tout. La liste d'objets n'est recalculée par destinataire que lorsqu'une mine armée existe (`hasHiddenMines`) : le cas courant partage une seule liste entre tous les clients.
- **Alternative.** Envoyer la mine et la masquer au rendu : un client modifié la verrait.

### D32. Fantôme-crayon : le curseur est prédit, la pose est une décision du serveur

- **Choix.** Un joueur éliminé devient un fantôme (si « Les morts dessinent » est activé et que le mode n'est pas à réapparition). Son curseur (`ghostX`, `ghostY`) et son délai (`ghostCd`) sont dans l'état exact, donc prédits ; poser un trait (attaque : 3 cellules à sens unique, 4 s) ou une goutte (parade : 1 cellule de danger, 5 s) est décidé par le serveur, qui émet `GHOST_DRAW`. Délai de 2 s après l'élimination, puis 8 s entre deux poses. Au plus 16 marques simultanées. Un fantôme ne compte plus dans la fin de manche.
- **Alternative.** Prédire aussi la pose : le fantôme verrait son trait avant le serveur, mais il faudrait annuler un trait refusé (cellule prise entre-temps).

### D33. Fin de manche, mort subite et plafonds

- **Choix.** La manche s'arrête quand il reste 0 ou 1 équipe debout. Une manche sans survivant, ou une égalité à la colline ou à la boulette-ball, n'est attribuée à personne. Mort subite à 75 s par défaut (20 à 180 s), avançant à 14 unités/s ; une manche dure au plus 300 s même sans mort subite ; colline et boulette-ball durent au plus 150 s (sans encre). Pour qu'une partie finisse toujours, elle est **tranchée au score** après `(2 × manches à gagner − 1) × 3` manches (15 pour 3 manches à gagner) sans vainqueur.
- **Alternative.** Aucun plafond de manches : une partie de boulette-ball entre joueurs incapables de marquer ne finirait jamais (c'était le cas avec des bots aléatoires).

### D34. Modes bonus : tirage compatible, réapparitions, arme commune

- **Choix.** Le tirage d'une manche bonus se fait parmi les modes autorisés que **au moins une arène du pool** sait jouer (une zone de colline, des cages), puis l'arène parmi celles qui le supportent, différente de la précédente si possible. Les 10 arènes déclarent toutes colline et cages. Colline et boulette-ball sont des modes à réapparition (3 s et 2 s) : pas de fantômes. « Même arme pour tous » tire l'arme avec le RNG de la partie et désactive l'apparition d'armes. La boule de papier est un objet comme un autre (coups, projectiles, explosions la poussent).
- **Alternative.** Imposer ces zones à toutes les arènes futures par le schéma : trop rigide pour des arènes spéciales.

### D35. Salons : places, hôte, spectateurs, reconnexion, partie rapide

- **Choix.**
  - 8 joueurs et 4 spectateurs. Qui arrive pendant une partie est spectateur et prend une place à la fin de la manche en cours (ou du podium) ; un joueur resté 60 s sans rien faire en manche le devient jusqu'à la fin de la partie ; 10 min d'inactivité en salon d'attente : retiré.
  - **Reconnexion** : jeton de 128 bits, place gardée 20 s, stickman immobile. L'hôte passe tout de suite au plus ancien joueur connecté (on ne bloque pas un salon pour 20 s) ; il ne le redevient pas au retour. Délai écoulé : retiré en salon, éliminé puis retiré en manche. Un jeton déjà utilisé ou périmé est refusé et compte dans la limite d'essais de code.
  - **Partie rapide** : le salon public non plein au meilleur score (100 points s'il attend, plus le nombre de joueurs), sinon un nouveau salon public. Un salon public se lance seul 20 s après que 2 joueurs sont prêts ; un salon privé n'a pas de lancement automatique.
  - Les réglages de l'hôte sont normalisés par liste blanche (`normalizeSettings`) : toute valeur invalide est remplacée par l'ancienne.
- **Alternative.** Garder l'hôte pendant la reconnexion : un hôte qui ferme son onglet bloquerait le salon.

### D36. L'arène d'entraînement est le salon d'attente

- **Choix.** Le salon est une partie en phase `LOBBY` sur l'arène `entrainement` : on saute, frappe, ramasse et lance des armes (selon les réglages) ; les coups projettent mais **ne retirent aucun PV**, et un joueur qui tombe de la page réapparaît aussitôt (une seconde après une élimination). Elle est simulée à 60 Hz comme une manche (D13 : pire cas mesuré).
- **Alternative.** Un mode sans combat : le salon serait moins vivant et on n'y apprendrait rien.

### D37. Enregistrement d'opérations et d'entrées (version 3)

- **Contexte.** Rejouer une partie ne se réduit plus à des entrées : arrivées, départs, lancement (règles, arènes, équipes), retour au salon, éliminations par abandon et changements de règles modifient le monde.
- **Choix.** `Recording` v3 : `ops` (ordonnées, appliquées quand `world.tick === tick`), `inputs` (changements de masque, avec la compensation de latence), `tunes`, hash final. La relecture (`ReplayCursor`) est la même fonction côté serveur et côté outil ; une partie complète rejouée redonne exactement le même état.
- **Alternative.** Enregistrer des snapshots : volumineux et sans valeur de test (on veut rejouer la _simulation_).

### D38. Accessibilité des arènes par simulation

- **Choix.** `analyzeArena` ne raisonne pas sur des formules de saut : elle rejoue la vraie `step` depuis chaque position debout avec des séquences d'entrées types et construit le graphe des atterrissages (≈ 100 ms par arène). Les plateformes mobiles sont ignorées (jamais nécessaires). On exige que tout point d'apparition, d'arme et la colline soit atteignable depuis **chaque** point d'apparition (aucune impasse). L'analyse porte sur la grille d'origine : un bloc de papier détruit en cours de manche peut ouvrir ou fermer un chemin sans qu'elle le sache.
- **Alternative.** Formules de portée de saut : fausses dès qu'on touche à une constante de mouvement.

### D39. Sécurité et limites de la phase 2

- **Choix.** Messages JSON : 20 par seconde et par connexion (au-delà : comptés comme invalides), 1 Ko, schémas stricts (clés inconnues refusées) ; 20 messages invalides ferment la connexion (1008). Entrées : 70 paquets/s, étiquette bornée à 24 ticks d'avance, masque filtré. Pseudos : NFKC, caractères de contrôle, de largeur nulle et d'inversion retirés, 2 à 16 caractères, filtre de mots (FR et EN, `badwords.ts`). Création de salon (3/min/IP), essais de code (10/min/IP, les échecs seulement), emotes (1/s), connexions par IP (8), origine du WebSocket vérifiée en production. L'arène d'attente à la création et le réglage des constantes de mouvement sont réservés à `DEV_TOOLS=1`.
- **Alternative.** Aucune pour ces valeurs : ce sont celles de §2.9, rendues configurables par variables d'environnement.

### D40. Le client prédit dans un monde non autoritaire et compare tout, phase comprise

- **Choix.** Le client crée un `World` par salon (terrain, plateformes, règles, mode) avec `auth = false` ; le prédicteur n'y fait vivre que son joueur. L'historique garde, pour chaque tick, le bloc « own » et la phase de partie (phase et ticks dans la phase) : la comparaison avec le snapshot porte sur tous les champs. Toute divergence (un coup reçu, un ramassage, une réapparition, un changement de phase) restaure et rejoue ; `visibleCorrections` ne compte que celles qui ont déplacé le joueur de plus de 0,5 unité. Un joueur mort n'évolue plus : seuls son statut et son compteur de réapparitions sont comparés. L'expiration des traits et des flaques, qui est dans la passe d'autorité, est appelée par le prédicteur après chaque pas (`stepMarks`, `stepPuddles`). Les bornes de `invuln` (255 en réseau, 270 en jeu) font au plus une ou deux corrections de plus au début d'une manche.
- **Alternative.** Ne comparer que le mouvement : les compteurs de combat dériveraient sans bruit.

### D41. Spectateurs : un accusé toutes les 100 ms

- **Choix.** Un spectateur n'a pas d'entrées, mais le serveur répète les événements fiables jusqu'à leur accusé et coupe un client qui a 120 événements de retard. Il envoie donc le même paquet `INPUT` avec un masque nul, 10 fois par seconde. Il reçoit les snapshots sans bloc « own » et voit **toutes** les mines (D31).

### D42. Reconnexion automatique du client

- **Choix.** Une coupure inattendue ouvre une nouvelle connexion et envoie `resume` (délais de 0,4 à 2,5 s, au plus 20 s), sous un écran « Connexion perdue » ; le dernier rendu reste derrière. Le jeton et le code sont gardés en `localStorage` avec l'heure de la dernière activité ; un rechargement de la page dans les 17 s tente la reprise. Un `bad_token` ou le délai écoulé ramène à l'accueil avec un message. `leave`, l'expulsion ou la fermeture du salon effacent le jeton.

### D43. Éditeur d'arènes : développement seulement, hors du bundle

- **Choix.** `packages/client/editor/index.html` est servi par Vite (`/editor`, via un plugin `apply: 'serve'`), n'est pas une entrée du build (`rollupOptions.input: 'index.html'`) et le serveur de production n'a aucune route `/editor` : vérifié en construisant (aucune trace de l'éditeur dans `dist`, `/editor/` répond 404). Son modèle est pur et testé ; il importe zod et l'analyse d'accessibilité lui-même, ce qui n'alourdit pas le client du jeu (D19).
- **Alternative.** Un mode `?editor=1` du client : l'éditeur serait dans le bundle de production.

### D44. Le retour au salon remet les manches et les scores à zéro

- **Contexte.** Le salon d'attente n'est pas une manche ; `LobbyView.round` vaut 0 en attente (types). Le monde gardait pourtant le dernier numéro de manche et les scores.
- **Choix.** `returnToLobby` remet `round`, `scores` et `matchWinner` à zéro. La relecture d'un enregistrement fait le même appel, donc reste identique.

### D45. Mesure de charge avec combat actif, et ce qu'elle ne prouve pas

- **Choix.** `npm run loadtest` fait par défaut tourner des parties en boucle (3 manches à gagner, mort subite à 20 s, un bonus toutes les 3 manches) avec des faux clients qui frappent, parent et ramassent ; `--no-combat` mesure les déplacements seuls. Il échoue si moins d'une partie par salon a démarré (une mesure sans combat ne vaut rien). `npm run simulate` fait aussi tourner un monde de parties enchaînées et vérifie son déterminisme.
- **Résultats** (voir `NETCODE.md` §10) : le coût du pas de salle est de 6 µs au p50 en combat (15 µs au p99, budget 150) ; la mesure complète à 25 × 8 a été faite sous Windows, non épinglée, où même les déplacements seuls dépassent le CPU et le retard de boucle des budgets (appels système réseau plus chers, minuteries de 15,6 ms). Le combat y ajoute 12 % de CPU. **Les budgets du conteneur à 1 CPU sont à vérifier en phase 4**, sous Linux ; la piste « un paquet d'entrées tous les 2 ticks » reste la première à essayer.

### D46. Dépendances

Aucune dépendance nouvelle en phase 2 (client, serveur, `shared`, `sim`).

### D47. Questions ouvertes pour la phase 3 et 4

- **Rendu** : les armes sont « dessinées » (événement `WEAPON_SPAWN`, 0,8 s avant d'apparaître) ; la phase 3 doit en faire l'animation. Le HUD, le podium et les écrans de la phase 2 sont en DOM brut et en français seulement.
- **Équilibre** : les valeurs de `combat.ts`, `weapons.ts` et des arènes n'ont été validées que par simulation (bots) ; elles demandent des parties à plusieurs humains.
- **Compensation au-delà de 250 ms** : un joueur à plus de ≈ 100 ms de RTT n'est plus compensé en entier. Allonger l'historique coûte 12 octets par joueur et par tick ; à décider avec des mesures réelles.
- **Salles d'attente** à 60 Hz : toujours le pire cas (D13).
- **Traits des fantômes pour un arrivant** : non transmis (D30).

## Phase 3 : rendu, thème « encre et carnet » et sensations (21/10/2026)

### D48. Base de la phase et outillage

- **Base.** La phase 2 avait été fusionnée dans `main` en avance rapide (vérifié : `origin/main` et `origin/phase-2-gameplay` pointaient sur le même commit) ; `phase-3-rendu` part donc de `main`, comme l'indique le prompt.
- **`.gitattributes` (`* text=auto eol=lf`).** Sous Windows Git convertissait les fichiers en CRLF et Prettier (`endOfLine: lf`) échouait sur tout le dépôt. Les fins de ligne sont en LF partout, y compris dans la copie de travail. _Alternative :_ `endOfLine: auto`, qui accepte un dépôt mélangé.
- **`npm run dev -w @stickyclaude/server`** utilise `tsx watch --env-file=dev.env` (fichier `packages/server/dev.env` : `DEV_TOOLS=1`) au lieu de `DEV_TOOLS=1 tsx watch …`, une syntaxe que `cmd` et PowerShell ne comprennent pas. _Alternative :_ `cross-env`, une dépendance de plus pour une variable.
- **`npm run check`** exécute aussi `npm run audio:check` : les sons committés doivent être exactement ceux que le générateur produit (3 s).

### D49. Dépendances de la phase 3

| Dépendance                                              | Où                  | Pourquoi                                                                                                                                                                                                                              | Poids                             |
| ------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `preact` 11 et `@preact/signals`                        | client              | L'interface complète (accueil, salon, HUD, podium, options, i18n réactive, focus, transitions) n'est pas tenable en DOM brut. Preact est l'équivalent compatible de React le plus léger ; les signaux évitent un gestionnaire d'état. | ≈ 8 Ko gzip (mesuré avec esbuild) |
| Polices **Patrick Hand** et **Bangers** (OFL), en woff2 | `src/assets/fonts/` | Le style (analyse §1.9) demande une écriture à la main et une police d'affiche. Réduites au latin, hébergées dans le dépôt (jamais chargées depuis un serveur tiers), licences à côté.                                                | 24 Ko chacune                     |
| `opusscript` (MIT, **devDependency** de la racine)      | `scripts/gen-audio` | Encodeur Opus en WebAssembly, pour fabriquer les `.opus` sans `ffmpeg` installé. Hors du bundle et du serveur.                                                                                                                        | 0 (génération seulement)          |

Aucune bibliothèque audio (Howler, Tone) : l'API Web Audio suffit (D54). Aucun `@playwright/test` : `playwright-core` est déjà là depuis la phase 2 et le script E2E n'a besoin que de `node:assert` (D57). Pas de `cross-env` (D48).

### D50. Les traits : un atlas, un `ParticleContainer`, aucune allocation par image

- **Choix.** Tout ce qui se dessine à chaque image (stickmen, armes, objets, effets) passe par `render/pen.ts` : une particule Pixi par segment ou par bout arrondi, toutes prises dans **un seul atlas** généré sur un canvas au démarrage (aucun fichier image : corps et bouts des 4 styles, anneaux de tête, anneau, disque, éclat, taches, lueur). Un `ParticleContainer` = un appel de dessin ; les particules sont réutilisées (pool `used`/`prevUsed`) et la teinte est écrite directement dans `Particle.color` (BGR + alpha dans l'octet haut), sans objet `Color`.
- **Pourquoi pas des `Sprite`/`Graphics`.** Mesuré : `sprite.tint` alloue un `Color` à chaque affectation et `Graphics` reconstruit sa géométrie ; la version à base de `Sprite` n'atteignait que ≈ 44 FPS en qualité auto à CPU ×4 (D56). Mettre `length = 0` au tableau des particules libère son stockage (il est réalloué à chaque image) : on ne le raccourcit jamais, les particules en trop deviennent transparentes.
- **Ce qui reste.** Voir D56 : ≈ 15 Ko par image de nombres flottants que V8 « boîte » quand un calcul est passé en argument à une fonction non inlinée (cinématique inverse, appels vers Pixi). `poly`, `segAt` et `capAt` lisent leurs coordonnées dans des tableaux au lieu de les recevoir en arguments (de ≈ 24 à ≈ 15 Ko/image).

### D51. Le terrain : morceaux en Canvas2D, pas de `RenderTexture`

- **Choix.** La grille (64 × 36 cellules) est découpée en 4 × 3 morceaux de 16 × 12 cellules, chacun dessiné dans un canvas 2D (contour par _marching squares_ sur une grille ×2, sommets déformés à main levée par un bruit de valeur, hachures croisées, blocs de papier) et posé comme texture Pixi. Chaque morceau a de 1 à 3 **variantes de tremblé** précalculées (le terrain « bout » à 12 Hz en alternant A B C B). Une destruction de terrain ne redessine que les morceaux touchés. Les encres sont opaques (pas de couture visible entre deux morceaux) et la résolution est un multiple de 0,25 pixel par unité, selon le niveau de qualité (D52).
- **Alternative.** Des `RenderTexture` Pixi : on redessinerait avec `Graphics`, plus lent à construire et sans le contrôle du bruit pixel par pixel dont les hachures ont besoin. Un seul grand canvas : tout serait redessiné à chaque destruction.

### D52. Qualité adaptative, mouvement réduit et flashs

- **Qualité.** Trois profils (`render/quality.ts`) : 0 (DPR ≤ 1, pas de tremblé, particules ×0,5), 1 (DPR ≤ 1,5, traits qui tremblent, terrain à une variante, particules ×0,75), 2 (DPR ≤ 2, tout). En « auto », le jeu démarre au niveau 2 (au niveau 1 sur un appareil tactile), mesure les images par seconde sur des fenêtres de 5 puis de 6 s et baisse d'un niveau sous 50 FPS ; il **ne remonte jamais** (éviter les oscillations visibles). L'option force un niveau.
- **Mouvement réduit** (option « selon le système », « oui » ou « non », sur `prefers-reduced-motion`) : ni tremblement d'écran, ni line boiling, ni hit-stop ; page qui se tourne et arène qui se dessine remplacées par un fondu de 150 ms ; transitions et animations CSS coupées. Vérifié en navigateur (`renderer.stats.boil === 0` avec `reducedMotion: 'reduce'`, contre 0,55 sans) ; le tremblement de caméra coupé est couvert par `camera.test.ts`.
- **Flashs.** Un limiteur global (`render/limiter.ts`) espace deux flashs d'au moins 340 ms (≤ 3 par seconde, analyse §1.11), quel que soit le nombre d'événements.
- **Hit-stop visuel.** Les deux protagonistes d'un gros coup figent la pose et la position _affichées_ 50 à 90 ms, puis rattrapent en ≈ 60 ms ; la simulation et le réseau ne s'arrêtent pas (la prédiction reste intacte).

### D53. L'entraînement solo : la vraie simulation, dans le navigateur, sans serveur

- **Choix.** `SoloSource` fait tourner le même `step` de `sim` que le serveur (pas fixe de 60 Hz, rattrapage borné à 6 pas) sur l'arène d'entraînement (D36), avec `world.auth = true` : le joueur est en slot 0, trois mannequins (immobile, patrouilleur, boxeur) sont de vrais joueurs pilotés par `mannequinInput` ; les dégâts n'y comptent pas (salle d'attente), donc ils « ne meurent pas ». 16 objectifs (courir, double saut, saut mural, descente de plateforme, coups, coup chargé, coup de pied plongeant, parade, parade parfaite, ramasser, tirer, lancer, emote…) sont cochés par un `TrainingTracker` pur et testé, enregistrés dans `localStorage`.
- **Pourquoi.** Apprendre sans serveur ni adversaires, et faire de l'entraînement le banc de mesure de performance (même rendu, aucun réseau). La boucle de rendu ne connaît qu'une `RenderSource` : `OnlineSource` (réseau), `SoloSource` et `PreviewSource` (accueil et personnalisation) se remplacent sans toucher au rendu.
- **Sur téléphone** le carnet est replié en une ligne (le prochain objectif) et se déplie d'un toucher ; le bouton « Quitter » passe dans le menu pause.

### D54. Audio : synthétisé par script, Ogg Opus, moteur Web Audio maison

- **Choix.** `npm run gen-audio` fabrique **36 effets et 4 musiques** par synthèse (cordes pincées de Karplus-Strong pour l'ukulélé, sifflet, percussions de table, bruit filtré pour les souffles et les chocs de papier) : aucun son repris, rien de téléchargé. Les sons sont encodés en **Ogg Opus mono 48 kHz** (28 kbit/s les effets, 40 kbit/s les musiques) avec `opusscript` et un multiplexeur Ogg écrit à la main (CRC32, en-tête `OpusHead` avec _pre-skip_ 312) ; les boucles musicales sont rendues en mélange circulaire pour boucler sans clic. Total : **374 Ko** pour un budget de 1,5 Mo, chargé _après_ le premier écran (hors budget du bundle), à la première interaction (une `AudioContext` n'est créée qu'après un geste, sinon Chrome l'avertit). `npm run audio:check` vérifie que les fichiers sont à jour octet pour octet ; un test décode les 40 fichiers (granule et durée du manifeste) et Chrome les décode tous.
- **Moteur** (`audio/engine.ts`) : 16 voix au plus avec priorités, hauteur variée de ±5 %, spatialisation stéréo selon la position horizontale, volume réduit pour les actions des autres joueurs, trois curseurs (général, effets, musique), ambiance musicale selon l'écran et la tension (menu, entraînement, combat 1 ou 2, mort subite) avec fondu enchaîné, atténuation (_ducking_) de la musique en fin de manche. Il reçoit ses dépendances (`createContext`, `fetchBytes`, `random`) : testé sans navigateur.
- **Limite connue.** L'Ogg Opus n'est lu par Safari qu'à partir de la version 18.4 ; avant, le décodage échoue, le moteur l'ignore et **le jeu reste jouable en silence**. _Alternative :_ doubler les fichiers en AAC (poids ×2, un encodeur propriétaire à installer). À décider en phase 4 si le public visé a de vieux iPhone.

### D55. Interface : Preact et signaux, i18n typée, entrées

- **i18n.** `i18n/fr.ts` fixe la liste des clés (`MessageKey`) ; `en.ts` est un `Record<MessageKey, string>` : une clé oubliée en anglais ne compile pas. `t(clé, { paramètres })`, pluriels évités par la formulation (« manche(s) »). La langue est celle du navigateur au premier lancement (`navigator.language`), puis l'option du joueur.
- **Entrées.** Touches reliées par `event.code` (pas par caractère : AZERTY et QWERTY partagent les emplacements), disposition détectée par `navigator.keyboard.getLayoutMap()` quand elle existe ; deux touches par action, rebattables et validées ; manette (stick, croix, A X B Y, navigation dans les menus au plus proche voisin, vibration) ; tactile (joystick à 8 directions, boutons dans les `safe-area-inset`, taille et côté réglables, vibration).
- **Accessibilité.** Contraste WCAG AA testé pour toutes les paires texte/fond de l'interface, motif de poitrine par encre et par équipe pour les daltoniens, focus visible, navigation complète au clavier et à la manette, région `aria-live` pour la manche et la bannière, texte réglable de 90 à 130 %, lien « Aller au contenu ». Les contrôles tactiles et le mode paysage sont vérifiés en émulation mobile.
- **Prise de test.** `window.__stickyclaude` expose le rendu, la connexion, les actions et quelques signaux pour les tests E2E et les mesures ; elle ne sert pas au jeu.
- **Bug trouvé par l'E2E :** le champ « Rejoindre » ne reprenait pas le code d'un lien `?salon=CODE`, parce que le paramètre était lu après le premier rendu. Corrigé et couvert par l'E2E (le 2ᵉ onglet rejoint par ce lien).

### D56. Mesures de performance, et ce qu'elles prouvent

- **Protocole** (`scripts/perf-check.mjs`) : Chrome 155 sur Windows 11 (Core i5-12450H, 16 Go), rendu logiciel SwiftShader (pas de GPU), émulation d'un téléphone 851 × 393 à DPR 2,75 (écran tactile, agent utilisateur Android), **CPU ralenti ×4** par le protocole DevTools, build de production servi par le vrai serveur, entraînement solo avec des appuis de touches (courir, sauter, frapper, parer) pendant 20 s après 8 s d'échauffement.
- **Résultats** (`--cpu 4`, 20 s, 1 200 images) : qualité **auto** (démarre au niveau 1 sur mobile) **59,7 et 59,8 FPS**, 95ᵉ centile d'image 16,8 ms (une image de vsync), 4 à 5 images > 20 ms ; qualité haute (DPR 2) 59,9 FPS, 3 images > 20 ms ; qualité basse 59,9 FPS. Avant l'atlas de particules et la réduction des allocations de `poly`/`segAt` : ≈ 44 FPS en auto (le contrôleur descendait au niveau 0 ou 1). Aucune erreur dans la console.
- **Allocations** (profil d'échantillonnage du tas de V8, objets ramassés compris) : aucun tableau, objet ni fermeture créé par image dans le code de rendu (relecture et profil) ; reste **≈ 15 Ko par image** (≈ 900 Ko/s), attribués aux fonctions de calcul (squelette, cinématique inverse, ragdoll, Pixi) et cohérents avec des nombres flottants boxés par V8 (`HeapNumber`) ; ≈ 0,7 ramasse-miettes mineur par seconde, tas de 12 Mo au plus, aucune image perdue à cause d'eux. Tendre vers zéro demanderait de passer tous les calculs par des `Float64Array` ; le gain ne se voit pas dans les mesures, nous ne l'avons pas fait.
- **Ce que cela ne prouve pas.** Un vrai téléphone a un autre rapport entre CPU et GPU : le rendu logiciel mesure surtout notre code JavaScript et la bande passante de remplissage, pas le GPU mobile. À refaire sur un appareil réel (phase 4) avant de promettre « 60 FPS sur téléphone ». Le budget du bundle est tenu : **325,7 Ko gzip** pour 400 Ko (JS, CSS, polices, HTML ; hors audio), vérifié par `scripts/check-bundle.mjs` à chaque `npm run build` et donc en CI.

### D57. Tests E2E sans `@playwright/test`

- **Choix.** `npm run e2e` (`e2e/e2e.mjs`) lance le serveur construit sur un port libre, pilote Chromium avec `playwright-core` et vérifie avec `node:assert` : le parcours des écrans de l'accueil (FR et EN), l'entraînement au clavier, **la manette** (simulée : `navigator.getGamepads` est remplacé par une manette que le test pilote ; menus à la croix, stick, A, X, Start pour la pause, main rendue au panneau du salon), **une partie complète à 2 onglets** (création du salon, lien rejoint, « Prêt », réglages, décompte, combat piloté, fin de manche, podium et statistiques, retour au salon), l'entraînement au toucher (joystick et bouton en même temps, via le protocole tactile de DevTools), la maintenance (état d'interface) puis la coupure du serveur (écran « Connexion perdue »). Il échoue à la moindre erreur ou alerte de console. Les captures (JPEG, `docs/screenshots/`) en sont des sous-produits. Navigateur : `CHROME`, `--chrome` ou le chemin par défaut du système ; à défaut, celui que Playwright installe.
- **Alternative.** `@playwright/test` : une dépendance lourde pour un seul scénario, et un autre exécuteur à côté de Vitest.
- **Durée.** 4 à 6 min, dont 2,5 à 4,5 min pour la partie (deux pilotes qui se cherchent au hasard des arènes, rendu logiciel) ; la partie a un délai de 7 min. `--only motif` n'exécute qu'une étape, `--sheet` capture aussi la planche de référence (démarre Vite).

### D58. Questions ouvertes pour la phase 4

- **Performance sur appareil réel** : voir D56. Le budget de FPS mobile n'est vérifié qu'en rendu logiciel.
- **Safari ancien** : sons muets avant 18.4 (D54) ; à trancher.
- **Onomatopées et textes de l'arène** sont en français dans les données d'arène (`decor`) ; seule l'interface est traduite. Les arènes ont des noms FR/EN, pas leur décor écrit.
- **Manette** : testée avec une manette simulée (tests) et la navigation de menus ; pas avec du matériel réel ni de vibration vérifiée.
- **Équilibre** et **compensation de latence au-delà de 250 ms** : inchangés (D47).
- **Photosensibilité** : au plus 3 flashs par seconde et mouvement réduit, mais pas d'avis d'un spécialiste.
