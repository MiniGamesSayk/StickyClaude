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
