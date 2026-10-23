# StickyClaude : analyse fonctionnelle et technique

> Document de référence du projet. Les prompts de `docs/PROMPTS_SONNET.md` renvoient ici : **si le code contredit ce fichier, c'est le code qui a tort** (ou ce fichier doit être mis à jour, avec une entrée dans `docs/DECISIONS.md`).

## 0. Résumé

**StickyClaude** est un jeu de combat de stickmen **multijoueur en ligne, dans le navigateur**, de 2 à 8 joueurs. Esprit « chaos physique » : manches courtes, armes qui apparaissent dans l'arène, décor destructible, le dernier debout gagne la manche, le premier à N manches gagne la partie.

Signature visuelle : **encre et carnet**. Tout le jeu a l'air dessiné au stylo bille sur une page de cahier quadrillée : traits qui « vibrent » (line boiling), taches d'encre, ratures, onomatopées de BD, page qui se tourne entre les manches.

| Choix de cadrage (validés) | Valeur |
|---|---|
| Style de combat | Chaos physique (inspiration Stick Fight), avec un léger knockback |
| Physique | **Hybride** : le serveur simule des corps simples ; le client anime un squelette procédural et fait un ragdoll purement visuel |
| Joueurs par partie | 2 à 8, plus 4 spectateurs au maximum |
| Comptes | Aucun : pseudo + cosmétiques en `localStorage`, pas de base de données |
| Thème | Encre et carnet |
| Modes v1 | Chacun pour soi, Équipes, Modes bonus en rotation (**pas de bots**) |
| Salons | Code ou lien privé, liste publique, bouton « Partie rapide » |
| Appareils | PC (clavier), manette, mobile tactile, tous dans les mêmes parties |
| Ressources prod | Conteneur à **512 Mo / 1 CPU** |
| Audio | Effets sonores + musique, créés (rien de copié) |
| Personnalisation | Cosmétiques, tous débloqués d'office |
| Langues | FR (par défaut) + EN |
| Communication | Emotes prédéfinies uniquement |
| Arènes | Faites main en JSON, avec un éditeur de dev (non exposé en prod) |
| Spectateurs | Oui : rejoindre en cours de manche = spectateur jusqu'à la manche suivante |

---

## 1. Fonctionnalités

### 1.1 Boucle de jeu

1. **Arrivée** : page d'accueil, pseudo (prérempli s'il est déjà connu), aperçu de son stickman.
2. **Salon** : on attend les autres dans une **arène d'entraînement jouable** (on peut sauter, se taper, ramasser des armes pendant l'attente ; les dégâts n'y comptent pas). Chacun se déclare « Prêt ». L'hôte règle la partie et la lance.
3. **Manche** : la page se tourne et l'arène est « dessinée » en 0,8 s. Décompte 3-2-1 (écrit à la main). Combat. La manche s'arrête quand il reste 0 ou 1 joueur (ou une seule équipe) debout.
4. **Fin de manche** : arrêt sur image de 0,6 s sur le dernier KO (ralenti visuel côté client), le gagnant fait son emote, puis un écran de score dans la marge (bâtons de comptage). Une nouvelle arène est tirée dans la sélection.
5. **Fin de partie** : podium dessiné, stats amusantes, boutons « Revanche » (même salon) et « Quitter ».

Durée cible : 30 à 90 s par manche, 5 à 10 min par partie.

### 1.2 Le stickman (déplacements et combat)

**Déplacements** (le gameplay doit « sentir bon » avant tout le reste) :

- Course avec accélération et décélération ; contrôle réduit en l'air.
- Saut à hauteur variable (relâcher le bouton coupe la montée), **coyote time** (100 ms) et **mémoire du saut** (100 ms).
- **Double saut** (un par contact avec le sol).
- **Glissade et saut contre un mur** (wall-slide et wall-jump).
- S'accroupir ; traverser vers le bas une plateforme à sens unique.
- Chute rapide (bas en l'air).

**Combat** :

- **Mains nues** : enchaînement de 3 coups (le 3e projette), coups légers selon la direction (tacle, coup vers le haut, balayages aériens, spike), spécial chargeable au clic droit, mode défense orientable (voir D78).
- **Parade** : maintenir le bouton bloque 70 % des dégâts de face ; une **parade parfaite** (100 ms après l'appui) annule le coup, renvoie les projectiles lents et étourdit l'attaquant 0,4 s. Temps de recharge de 0,5 s pour éviter le spam.
- **Ramasser, lancer, lâcher** une arme. Une arme vide se lance (petits dégâts et projection).
- **Points de vie** : 100. **Knockback** proportionnel aux dégâts et légèrement plus fort quand on a peu de PV (le mélange avec l'esprit Smash).
- **Mort** : PV à 0, sortie de l'arène (chute hors de la page, projection hors du cadre), danger du décor. Le corps devient un ragdoll visuel puis il est **raturé** (gribouillé) et s'efface.
- **Étourdissement** court après les gros coups (et cumul limité pour éviter les blocages en boucle).
- **Visée** : voir 1.6. Elle est la même pour tous les appareils, pour l'équité.

### 1.3 Armes et objets

Les armes **sont dessinées en direct** dans l'arène : un trait de crayon trace l'arme, puis elle tombe. Elles apparaissent toutes les 6 à 10 s à des points d'apparition définis par l'arène. Il y en a 3 au maximum en même temps au sol ; une arme oubliée s'efface après 20 s.

Liste v1 (12 armes, toutes paramétrées dans un **fichier de données unique**, jamais en dur dans la logique) :

| Arme | Type | Idée |
|---|---|---|
| Règle | Mêlée | Allonge, coups rapides, projection moyenne |
| Compas | Mêlée | Estoc qui traverse la parade normale |
| Marteau-tampon | Mêlée lourde | Lent, énorme projection, laisse un tampon d'encre au sol |
| Pistolet griffonné | Tir | Précis, 8 balles |
| Fusil à pompe gribouillé | Tir | Dispersion, recul qui pousse le tireur |
| Sarbacane à boulettes | Tir | Boulettes de papier rebondissantes |
| Lance-avions en papier | Tir | Avion lent, guidé faiblement vers la cible la plus proche |
| Bazooka à encre | Explosif | Explosion qui **détruit le décor** et laisse une flaque glissante |
| Gomme | Lancer | Rebondit, et **efface** les blocs de papier qu'elle touche |
| Trombone-grappin | Mobilité | S'accroche au décor et tire le joueur (ou attire un adversaire) |
| Tache d'encre (mine) | Piège | Posée au sol, invisible pour les adversaires après 1 s, explose au contact |
| Taille-crayon (bouclier) | Défense | Bloque les tirs de face, mais ralentit |

Munitions limitées, pas de rechargement : on jette et on en cherche une autre (c'est ce qui crée le chaos).

**Objets de décor dynamiques** : caisses-carton (on les pousse, on les lance, elles se cassent), ballons gonflés (ils flottent et explosent), punaises (pièges au sol).

### 1.4 Arènes

- **10 arènes à la sortie**, chacune sur une « page » au thème propre : page quadrillée de maths (avec des équations en décor), page de partition (les lignes de portée sont des plateformes), cahier de brouillon raturé, carte au trésor, page de BD avec des cases, page de garde avec des stickers, feuille millimétrée, page de dictionnaire, marge pleine de gribouillis, double page avec la reliure au milieu (un vide au centre).
- **Taille** : une grille de 64 × 36 cellules (ratio 16:9). La caméra cadre dynamiquement les joueurs vivants.
- **Éléments** : blocs pleins (indestructibles, tracés à l'encre), **blocs de papier destructibles**, plateformes à sens unique, plateformes mobiles (trajet + durée), dangers (encre bouillonnante, punaises, taille-crayon géant, bord déchiré), points d'apparition des joueurs (8 au minimum) et des armes, zones spéciales selon les modes (colline, cages de foot).
- **Mort subite** : après 75 s (réglable), l'encre monte depuis le bas de la page (ou les bords se déchirent) pour forcer la fin de la manche.
- **Format** : JSON validé par un schéma zod (`packages/shared/arenas/*.json`). Voir 2.6.
- **Éditeur de dev** : une page servie uniquement par `npm run dev` (route `/editor`, absente du build de prod). Elle sert à peindre la grille, poser les éléments, tester en local et exporter le JSON.

### 1.5 Modes de jeu

Réglages communs de l'hôte : manches à gagner (3 / 5 / 7, **5 par défaut**), sélection d'arènes (toutes, ou une liste), armes activées ou non, mort subite (oui ou non, délai), modificateurs.

| Mode | Règle |
|---|---|
| **Chacun pour soi** | Le dernier debout gagne la manche. Une manche sans survivant (double KO) n'est attribuée à personne. |
| **Équipes** | 2 à 4 équipes (2v2, 3v3, 4v4, 2v2v2v2…). L'hôte assigne les équipes ou les mélange. Tir ami activable (désactivé par défaut). La dernière équipe debout gagne la manche. |
| **Modes bonus** (en rotation, activés par l'hôte) | Une manche sur trois (réglable) est remplacée par un mode bonus tiré au hasard. |

Modes bonus v1 :

- **Roi de la colline** : une zone entourée au crayon ; il faut y rester 15 s cumulées. Réapparition après 3 s.
- **Boulette-ball** : une boule de papier, deux cages. Il faut 3 buts. Réapparition après 2 s.
- **Encre montante** : l'encre monte dès le début ; le dernier vivant gagne.
- **Patate d'encre** : une bombe passe de joueur en joueur au contact et explose au bout de 15 s.
- **Gravité lunaire** : gravité réduite, sauts géants.
- **Même arme pour tous** : tout le monde commence avec la même arme, tirée au hasard, et rien d'autre n'apparaît.

**Mécanique signature : « Les morts dessinent »** (activable, activée par défaut). Un joueur éliminé devient un **fantôme-crayon** : il contrôle un curseur et peut, toutes les 8 s, poser **un petit trait** (une plateforme temporaire de 3 cellules qui dure 4 s) **ou une goutte d'encre** (petit danger). Les éliminés restent ainsi dans la partie jusqu'à la fin de la manche, ce qui compte avec 8 joueurs. Côté serveur, le coût est minime (1 entrée de plus par joueur mort).

### 1.6 Contrôles

| Action | Clavier (par défaut) | Manette (mapping standard) | Mobile |
|---|---|---|---|
| Déplacer / viser | ZQSD ou WASD (selon la disposition) / flèches | Stick gauche ou croix | Joystick virtuel à gauche |
| Sauter | Espace | A / Croix | Bouton |
| Dash | Maj (gauche ou droite) | LB / RB | Bouton |
| Attaquer / tirer | J (ou clic gauche) | X / Carré, gâchette droite | Bouton |
| Parer | E | B / Rond, gâchette gauche | Bouton |
| Ramasser / lancer | L | Y / Triangle | Bouton |
| Emote | 1 à 6 | Croix directionnelle | Roue d'emotes |
| Fantôme : poser | Attaquer / parer | Idem | Glisser + bouton |

- **Visée** : on vise dans la direction du déplacement, sur **8 directions**, avec une **aide à la visée légère** (côté serveur, identique pour tout le monde : correction de ±8° vers la cible la plus proche dans le cône). Cette visée est la même au clavier, à la manette et au tactile, pour que les joueurs mobile ne soient pas désavantagés. Pas de visée à la souris (décision validée, voir §5).
- **Touches reconfigurables** (sauvegardées en local), détection AZERTY/QWERTY via `navigator.keyboard.getLayoutMap()` quand c'est disponible, sinon choix dans les options.
- **Manette** : Gamepad API, détection à chaud, vibration (`vibrationActuator`) sur les gros impacts, désactivable.
- **Mobile** : paysage imposé (message « tourne ton téléphone » sinon), boutons semi-transparents placés dans les `safe-area-inset`, taille et position réglables, vibration via `navigator.vibrate` (désactivable), plein écran au lancement de la partie.

### 1.7 Salons et parcours

- **Créer un salon** : code de 5 caractères tirés d'un alphabet sans caractères ambigus (pas de `0/O`, `1/I/L`), et lien `https://stickyclaude.sayk.fr/?salon=CODE`. Public par défaut (D73) ; l'hôte peut le rendre privé.
- **Rejoindre** : par code, par lien ou depuis la **liste des salons publics** (nom, nombre de joueurs, mode, en jeu ou en attente). La liste se met à jour toutes les 3 s.
- **Partie rapide** : place le joueur dans le salon public le plus rempli qui n'est pas plein (de préférence en attente), sinon crée un salon public avec les réglages par défaut. Un salon public en attente se lance tout seul 20 s après que 2 joueurs ou plus sont prêts.
- **Capacité** : 8 joueurs + 4 spectateurs. Au-delà, le salon est plein.
- **En cours de partie** : celui qui arrive est spectateur pendant la manche en cours et entre à la manche suivante, s'il reste une place de joueur.
- **Hôte** : il règle la partie, lance, expulse, change les équipes. S'il part, l'hôte passe automatiquement au joueur le plus ancien.
- **Reconnexion** : un jeton de session (en `localStorage`) permet de retrouver sa place pendant 20 s ; pendant ce délai, le stickman reste immobile. Après le délai : éliminé pour la manche, et retiré du salon à la fin de la manche.
- **Inactivité** : 60 s sans aucune entrée en jeu, le joueur devient spectateur. 10 min en salon d'attente, il est déconnecté.
- **Emotes** : 6 bulles de BD prédéfinies et traduites (« Bien joué ! », « Oups », « Revanche ! », « Hé hé », « Aïe », « GG »), plus une emote animée du stickman (salut, danse, rire). Limite : 1 emote toutes les 3 s par joueur (délai aussi appliqué côté client). Pas de chat libre, donc rien à modérer.

### 1.8 Personnalisation (locale, tout débloqué)

- **Couleur d'encre** parmi 12 couleurs lisibles sur papier (bleu Bic, rouge correcteur, vert, noir, violet, orange, rose, brun, turquoise, gris graphite, or, bleu nuit). Chaque couleur est unique dans un salon : en cas de conflit, le serveur attribue la plus proche qui est libre.
- **Trait** : stylo bille, feutre (épais), crayon (grainé), pinceau (largeur variable).
- **Couvre-chef ou accessoire** (12 au choix) : aucun, casquette, haut-de-forme, bandeau de ninja, couronne en papier, chapeau de sorcier, antennes, lunettes, nœud, casque de chantier, cornet de glace, auréole.
- **Emote de victoire** (4 au choix).
- Pour les daltoniens, **chaque joueur a aussi un motif ou un symbole** sur la tête ou le torse en plus de la couleur ; en équipes, un motif par équipe.
- Le serveur valide tous les choix contre une liste blanche (indices dans des tables connues) ; tout le reste est ignoré.

### 1.9 Écrans et interface

- **Accueil** : logo animé, pseudo, aperçu du perso (avec le bouton « Personnaliser »), « Partie rapide », « Créer un salon », « Rejoindre », salons publics, « Entraînement », options, crédits.
- **Personnalisation** : le stickman en grand, qui réagit (il essaie son chapeau, fait son emote).
- **Salon** : arène d'entraînement en fond, liste des joueurs (pseudo, couleur, prêt, ping, hôte), code et bouton « Copier le lien », réglages (en lecture seule pour les non-hôtes), panneau des équipes.
- **En jeu (HUD minimal)** : barre de PV et munitions sous forme de petits traits au-dessus de chaque stickman (s'efface quand on ne prend pas de dégâts), scores dans la **marge gauche** de la page en bâtons de comptage, minuteur de mort subite griffonné en haut, flèche dans le bord de l'écran pour un joueur hors du cadre.
- **Entraînement solo** : une arène avec des **mannequins** (cibles immobiles ou qui oscillent, pas des bots) et une liste d'objectifs pour apprendre les mouvements (double saut, wall-jump, parade parfaite…). C'est aussi ce que voit un joueur seul en ligne. Ça tourne **entièrement en local** (la même simulation dans le navigateur), sans le serveur.
- **Options** : contrôles (reconfiguration, disposition clavier, taille des boutons tactiles), audio (général, effets, musique), graphismes (qualité auto / basse / haute, 30-60-illimité FPS), accessibilité (voir 1.11), langue, afficher le ping et les FPS.
- **Fin de partie** : podium, et stats (KO, morts, dégâts infligés, plus long combo, « mort la plus bête » : chute, tir ami, sa propre mine…).
- **Écran de déconnexion ou de maintenance** : message clair et reconnexion automatique.

### 1.10 Audio

- **Effets** : pas (crayon qui gratte), saut, coup, coup fort, parade, parade parfaite (« ting »), tir par arme, explosion d'encre, papier déchiré, gomme, KO (rature), page qui tourne, décompte, victoire, interface (survol, clic).
- **Musique** : un thème de menu et 2 ou 3 boucles de combat légères (ukulélé, sifflement, percussions sur une table : l'ambiance d'une salle de classe), et une montée en tension pendant la mort subite.
- **Création** : soit synthétisés par script (générateur de type sfxr, puis exportés en Opus), soit composés avec un petit séquenceur en Web Audio. **Aucun son téléchargé.** Budget total < 1,5 Mo, en chargement paresseux après le premier écran.
- Web Audio API : les sons sont déverrouillés à la première interaction, coupés quand l'onglet est caché, avec une variation de hauteur ±5 % pour éviter la répétition, 16 voix au maximum en même temps, et une spatialisation stéréo selon la position x.

### 1.11 Accessibilité et confort

- **Mouvement réduit** (`prefers-reduced-motion` + une option) : pas de tremblement d'écran, de line boiling ni de hit-stop, et des transitions simplifiées.
- Motifs pour les daltoniens (1.8), contraste de l'interface suffisant (WCAG AA sur les menus), taille du texte de l'interface réglable.
- Menus utilisables entièrement au clavier et à la manette, focus visible.
- Les flashs et les éclairs de l'écran restent sous 3 par seconde.

### 1.12 Langues

- FR par défaut, EN si `navigator.language` ne commence pas par `fr`, et un sélecteur dans les options.
- Un fichier par langue (`i18n/fr.ts`, `i18n/en.ts`), avec des clés typées : une clé qui manque est une erreur de compilation. Les onomatopées (BAM, POW) sont des éléments graphiques, communs aux deux langues.

### 1.13 Hors périmètre v1 (idées pour plus tard)

Bots IA, multijoueur local sur un même écran, classement, comptes, éditeur public d'arènes, replays partageables, tournois, chat texte, WebTransport.

---

## 2. Architecture technique

### 2.1 Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | **TypeScript strict** partout, ESM | Comme les autres jeux du dépôt ; types partagés client et serveur |
| Monorepo | npm workspaces | Comme goldmine |
| Simulation | Code maison, **pur et sans dépendance** (`packages/sim`) | Partagé entre le serveur (autorité) et le client (prédiction, entraînement hors ligne) ; aucun moteur physique lourd sur le serveur |
| Serveur | Node 22 + **`ws`** (WebSocket), HTTP natif ou Fastify pour le statique et `/healthz` | Léger ; `uWebSockets.js` est exclu car il ne tourne pas sur Alpine (musl) |
| Rendu | **PixiJS v8** (WebGL2, repli WebGL1) | Rapide sur mobile, batching, RenderTexture pour les taches d'encre et le décor mis en cache |
| Interface (menus) | **Preact** + signals, DOM/CSS par-dessus le canvas | API React mais 4 Ko ; les menus en DOM sont accessibles et faciles à traduire |
| Build | Vite | Comme goldmine |
| Validation | zod (messages de contrôle JSON, fichiers d'arènes) ; décodeur binaire maison avec vérification des bornes | |
| Tests | Vitest + fast-check, Playwright pour les tests de bout en bout | Comme goldmine |
| Qualité | ESLint + Prettier, `npm run check` = lint + types + tests | Comme goldmine |
| Journaux | pino (JSON sur une ligne) | Journaux Docker limités à 3 × 10 Mo |

### 2.2 Découpage du dépôt

```
StickyClaude/
  packages/
    shared/    constantes, types, protocole (codecs binaires), schémas zod, données (armes, arènes, cosmétiques), i18n des messages d'erreur
    sim/       simulation déterministe : monde, physique, joueurs, armes, modes, règles de manche ; aucune E/S, ni DOM ni réseau
    server/    HTTP + WebSocket, salons, boucle de ticks, file d'entrées, snapshots, sécurité, métriques
    client/    réseau (prédiction, réconciliation, interpolation), rendu Pixi, animation, audio, entrées, UI Preact, éditeur (dev)
  scripts/     simulate (headless), loadtest (faux clients), gen-audio, build-sprites, smoke (Playwright)
  deploy/      Dockerfile (+ notes Caddy et hub)
  docs/        ANALYSE.md, ARCHITECTURE.md, DECISIONS.md, NETCODE.md, ARENES.md, CREDITS.md, PROMPTS_SONNET.md
```

**Règle d'or** : `sim` ne dépend de rien d'autre que `shared`. Le serveur et le client appellent la même fonction `step(world, inputs) → events`.

### 2.3 Simulation (`packages/sim`)

- **Pas de temps fixe : 60 Hz** (`DT = 1/60`). Le serveur avance par ticks entiers ; le client aussi, et son rendu interpole entre deux états.
- **Déterminisme pratique** : RNG à graine injectée (xorshift128+ ou PCG), jamais `Math.random`, ordre d'itération stable (tableaux indexés par slot, pas d'itération sur des `Map` dont l'ordre dépend des insertions réseau), et pas d'horloge système dans la simulation. Il n'y a pas besoin de virgule fixe : le serveur fait autorité et le client se recale. Un test vérifie que **même graine + même suite d'entrées = même hash d'état**.
- **Monde** :
  - **Terrain en grille** (64 × 36, cellules de 16 unités) : `Uint8Array` de types (vide, plein, papier destructible, sens unique, danger). Les collisions entre boîtes et grille sont très peu coûteuses ; une destruction est un événement `{cellules modifiées}`.
  - **Joueurs** : boîte englobante (≈ 0,8 × 1,8 cellule, 1,1 accroupi), vitesse, état (machine à états : `idle`, `run`, `jump`, `fall`, `wallSlide`, `crouch`, `attack(n)`, `charge`, `block`, `stun`, `dead`, `ghost`), PV, arme, munitions, compteurs (coyote, buffer, recharges).
  - **Objets dynamiques** (armes au sol, caisses, ballons, boule) : boîtes avec gravité, rebond, friction ; 32 au maximum.
  - **Projectiles** : rayon balayé contre la grille et les boîtes des joueurs (pas d'effet tunnel) ; 64 au maximum, réservés à l'avance dans un tableau.
  - **Plateformes mobiles** : boîtes cinématiques à trajectoire paramétrée par le tick, donc sans état à synchroniser au-delà du tick.
- **Mêlée** : hitbox en secteur (arc) ou en capsule, évaluée **une fois par frame active** de l'attaque, avec une liste de « déjà touchés » par attaque.
- **Aucune allocation dans `step`** : pools d'objets, tableaux réservés, vecteurs en scalaires. Objectif : **< 0,15 ms par tick pour une salle de 8 joueurs** sur un cœur de VPS.
- **Événements émis** (pour le rendu, le son, les stats et le journal) : `Hit`, `Blocked`, `PerfectParry`, `Ko`, `WeaponSpawned`, `Pickup`, `Throw`, `Shot`, `Explosion`, `TerrainChanged`, `GhostDraw`, `RoundStart`, `RoundEnd`, `Score`, `Emote`…
- **Le ragdoll n'existe pas dans la simulation** : un KO émet `Ko {joueur, position, impulsion, cause}`, et le client en fait un ragdoll Verlet visuel. Le serveur n'a donc rien de coûteux à simuler.

### 2.4 Netcode

Modèle : **serveur autoritaire + prédiction côté client + interpolation des autres joueurs**.

- **Transport** : WebSocket (`wss://stickyclaude.sayk.fr/ws`), messages **binaires** (`ArrayBuffer`), `permessage-deflate` **désactivé** (coût CPU et latence). Caddy fait passer l'upgrade WebSocket sans réglage particulier. Les messages de contrôle (salon, réglages, emotes) sont en JSON validé par zod ; les messages de jeu (entrées, snapshots) sont en binaire.
- **Entrées client → serveur** : 60 fois par seconde, un masque de 16 bits (gauche, droite, haut, bas, saut, attaque, parade, ramasser…) + un numéro de séquence + les **3 entrées précédentes** (redondance contre les pertes et les retards TCP). Environ 12 octets par paquet. Le curseur fantôme est envoyé seulement quand le joueur est fantôme.
- **Côté serveur** : un tampon d'entrées par joueur (gigue tolérée : 2 à 4 ticks). Sans entrée pour un tick, la dernière est répétée. Les entrées trop anciennes ou trop en avance sont jetées. Au-delà de 70 entrées par seconde, on limite.
- **Snapshots serveur → client** : **30 Hz** par défaut (`SNAPSHOT_HZ`, réglable entre 20 et 60) :
  - En-tête : tick (u32), dernière séquence d'entrée traitée pour ce client (u16).
  - Joueurs (≈ 18 octets chacun) : slot (u8), drapeaux d'état (u16), x et y (i16 quantifiés au 1/8 d'unité), vx et vy (i16), visée (u8), PV (u8), arme (u8), munitions (u8), état d'animation + avancement (2 × u8).
  - Objets et projectiles (≈ 8 octets chacun).
  - **Événements fiables** (KO, terrain, scores…) : numérotés, répétés dans chaque snapshot jusqu'à ce que le client en accuse réception.
  - Taille typique : 300 à 600 octets, soit **≈ 10 à 18 Ko/s par client**.
  - Optimisation possible plus tard (seulement si les mesures le justifient) : compression delta par rapport au dernier snapshot reçu par le client.
- **Prédiction locale** : le client simule **son propre stickman** avec la même fonction `step` et ses entrées, puis à chaque snapshot il **revient à l'état du serveur et rejoue** les entrées pas encore confirmées. Les petites erreurs sont lissées visuellement en 100 ms (pas de téléportation sous 2 cellules d'écart).
- **Interpolation** : les autres joueurs et les objets sont affichés **≈ 100 ms dans le passé** (`INTERP_DELAY`, adaptatif selon la gigue mesurée), entre deux snapshots. Si le snapshot suivant manque, on extrapole sur 100 ms au maximum, puis on fige.
- **Compensation de latence** : pour les tirs instantanés et la mêlée, le serveur garde un historique de **200 ms** des positions des joueurs et **revient en arrière** au moment où le tireur a vu la scène (temps du tick de l'entrée moins le retard d'interpolation annoncé par le client, plafonné). Les projectiles lents ne sont pas compensés : ils sont simulés sur le serveur et apparaissent tout de suite chez le tireur (effet visuel prédit, puis recalé).
- **Retour immédiat** : le client joue tout de suite l'animation, le son et l'effet de « hit » prédit ; les dégâts et le KO réels arrivent par le serveur. Si le serveur contredit (le coup n'a pas touché), aucun dégât n'est affiché.
- **Horloge** : ping/pong toutes les 2 s (RTT, estimation du tick serveur). Le ping s'affiche dans le salon et en option en jeu.
- **Outils de dev obligatoires** : un simulateur de **latence, gigue et perte** dans le client de dev (`?lag=150&jitter=30&loss=2`), un **graphe réseau** en surimpression (RTT, taille des snapshots, corrections de prédiction, tampon d'interpolation), et un enregistrement et une relecture des entrées d'une salle (fichier JSON) pour reproduire un bug.

### 2.5 Serveur (`packages/server`)

- **Un seul processus Node** (le conteneur n'a qu'1 CPU, des workers n'apporteraient rien). Il est découpé pour pouvoir passer plus tard à `worker_threads` si on monte en ressources.
- **Boucle de ticks unique** pour toutes les salles : horloge `process.hrtime.bigint()`, accumulateur, `setTimeout` réglé sur le prochain tick, au plus 4 ticks de rattrapage puis on lâche (et on journalise). Les salles **vides ou en pause** ne coûtent rien (elles ne sont pas simulées).
- **Salles d'attente** : simulées aussi (c'est l'arène d'entraînement), mais à 30 Hz et 15 snapshots/s pour économiser.
- **Contre-pression** : si `ws.bufferedAmount` d'un client dépasse 64 Ko, on saute des snapshots pour lui (le dernier état suffit) ; au-delà de 1 Mo, on le déconnecte.
- **Limites (variables d'environnement)** : `MAX_ROOMS` (40), `MAX_CONNECTIONS` (400), `MAX_CONN_PER_IP` (8), `SNAPSHOT_HZ` (30), `TICK_HZ` (60), `ROOM_IDLE_TTL_SEC` (300).
- **Arrêt propre (SIGTERM)** : plus aucune nouvelle salle, une annonce « mise à jour du serveur dans 30 s » aux clients, on laisse au plus 30 s aux manches en cours, puis on ferme les connexions avec un code dédié. Le client affiche alors « reconnexion… » et réessaie avec un délai croissant. `docker stop` doit avoir un `stop_grace_period` ≥ 35 s.
- **Routes HTTP** :
  - `GET /` et `/assets/*` : le client construit. Les assets ont un nom avec hash, servis avec `Cache-Control: public, max-age=31536000, immutable`, en brotli et gzip **précompressés au build**. `index.html` est en `no-cache`.
  - `GET /healthz` → `200 {"ok":true,"rooms":n,"players":n}` (utilisé par le `HEALTHCHECK` Docker et par le hub via `/status/stickyclaude`).
  - `GET /api/rooms` : la liste des salons publics (ou via le WebSocket, au choix, à documenter).
  - `GET /metrics` : **uniquement en interne** (refusée si la requête passe par Caddy, ou protégée par un jeton dans le `.env`). On y trouve : salles, joueurs, durée d'un tick (p50, p99), octets émis par seconde, snapshots sautés, mémoire du tas, retard de la boucle d'événements.
- **Mémoire** : Node lancé avec `--max-old-space-size=320` (le conteneur a 512 Mo). Une salle doit tenir en moins de 1 Mo.

### 2.6 Format des arènes (résumé, détails dans `docs/ARENES.md`)

```jsonc
{
  "id": "maths-quadrille",
  "name": { "fr": "Interro de maths", "en": "Math Test" },
  "theme": "graph-paper",         // fond, couleur du papier, décor
  "size": [64, 36],
  "grid": "base64 ou chaîne RLE",  // 1 caractère par cellule : . vide, # plein, p papier, - sens unique, ^ danger
  "spawns": { "players": [[x,y], ...8+], "weapons": [[x,y], ...] },
  "movers": [{ "rect": [x,y,w,h], "path": [[x,y],...], "period": 4.0 }],
  "props": [{ "type": "crate", "at": [x,y] }],
  "modes": { "koth": { "zone": [x,y,w,h] }, "ball": { "goals": [[...],[...]] } },
  "decor": [{ "type": "equation", "at": [x,y], "text": "x² + 1" }],
  "suddenDeath": "ink-rise"        // ou "tear-edges"
}
```

Toutes les arènes sont validées au build (zod) et chargées par un test qui vérifie : les points d'apparition sont libres et accessibles, au moins 8 points d'apparition, aucune cellule pleine sous un point d'apparition d'arme, et les zones des modes sont définies si l'arène les déclare.

### 2.7 Client (`packages/client`)

**Boucle** : `requestAnimationFrame`, qui suit le taux de l'écran (60, 120 ou 144 Hz). La simulation locale avance par ticks fixes et le rendu interpole (`alpha`). Les entrées sont lues à chaque frame et échantillonnées au tick.

**Rendu « encre et carnet »** :

- **Papier** : fond quadrillé ou ligné selon l'arène, avec la marge rouge, une texture de grain (petite texture répétée) et un léger vignettage, rendus **une seule fois** dans une RenderTexture.
- **Décor** : les contours de la grille sont calculés en **marching squares**, puis légèrement déformés par du bruit (trait « à main levée »), avec des hachures pour remplir les blocs pleins, et tout est mis en cache dans une RenderTexture **découpée en morceaux** (on ne redessine que les morceaux touchés par une destruction).
- **Stickmen** : un squelette de 13 points (tête, cou, épaules, coudes, mains, bassin, genoux, pieds) dessiné en segments épais avec des extrémités arrondies, selon le style de trait choisi.
  - **Line boiling** : les sommets des traits sont décalés par un petit bruit qui change **12 fois par seconde** (animation « en deux »), sur 3 variantes précalculées pour que ça ne coûte rien. C'est la signature visuelle. Désactivé en mouvement réduit et en qualité basse.
- **Animation procédurale** : des poses-clés par état (garde, course, saut, chute, wall-slide, attaques 1-2-3, charge, parade, étourdi, emote), mélangées en 80 à 120 ms, avec un **IK à 2 os** pour poser les pieds au sol (sur les pentes et les bords) et tenir l'arme à deux mains, un balancement de la course calé sur la vitesse, une respiration au repos, et l'anticipation et la retombée sur les attaques.
- **Ragdoll visuel** (client seulement) : particules Verlet (13 points) et contraintes de distance et d'angle, collisions contre la grille, impulsion initiale donnée par l'événement `Ko`. Au bout de 1,2 s, le corps est **raturé** (un gribouillis dessiné par-dessus), puis il s'efface. 8 ragdolls au maximum en même temps.
- **Effets** :
  - **Taches d'encre** de la couleur de la victime, **persistantes** pendant la manche (accumulées dans une RenderTexture, au plus N par manche).
  - **Onomatopées** BD (BAM, POW, CRAC, ZIP, SPLAT) sur les gros coups.
  - Lignes de vitesse, éclats de papier (particules en pool, 300 au maximum), traînée des projectiles, flash de parade parfaite.
  - **Hit-stop** de 50 à 90 ms sur les gros coups et tremblement d'écran, **visuels seulement** (la simulation ne s'arrête pas).
  - Pour les transitions : la page qui se tourne (un shader, ou un maillage déformé), et l'arène qui se dessine trait par trait (on dévoile les contours un par un).
- **Caméra** : elle englobe les joueurs vivants avec une marge, zoom lissé (minimum et maximum), bornée à l'arène, et un peu plus serrée sur mobile.
- **Qualité adaptative** : on mesure les FPS pendant les 5 premières secondes. Si la moyenne tombe sous 50, on baisse la résolution interne (`devicePixelRatio` plafonné entre 1 et 1,5), on coupe le line boiling et on divise les particules par deux. Le joueur peut forcer la qualité dans les options.
- **Polices** : une police manuscrite libre (OFL, par exemple *Patrick Hand* ou *Caveat*), **hébergée dans le dépôt** en woff2 et réduite aux caractères latins. Pas d'appel à Google Fonts en prod.
- **Sprites** : les accessoires et les armes sont dessinés en SVG dans le dépôt, puis rastérisés en un atlas au build (`scripts/build-sprites`).

### 2.8 Budgets de performance (critères mesurés)

| Mesure | Cible |
|---|---|
| Simulation serveur, salle de 8 en combat | < 0,15 ms par tick (p99 < 0,5 ms) |
| Serveur, 25 salles × 8 joueurs (200 joueurs) | CPU du conteneur < 60 %, tas < 250 Mo, retard de boucle p99 < 10 ms |
| Bande passante descendante par client | < 20 Ko/s en combat |
| Client, téléphone de milieu de gamme (Android 2021) | 60 FPS stables en qualité auto |
| Client, PC | 144 FPS si l'écran le permet |
| Premier chargement (JS + CSS + police, hors audio) | < 400 Ko gzip |
| Temps avant de pouvoir cliquer « Partie rapide » | < 2 s en 4G |
| Latence ressentie sur ses propres actions | 0 frame (prédiction) |

Un script `npm run loadtest -- --rooms 25 --players 8 --duration 120` lance de faux clients (des entrées aléatoires réalistes) contre un serveur construit et affiche ces mesures. **Il doit passer avec `docker run --memory 512m --cpus 1`.**

### 2.9 Sécurité et triche

- Serveur autoritaire : le client n'envoie **que des entrées** (bits de touches) et des intentions de salon. Aucun message ne fixe une position, des PV ou des dégâts.
- Décodeur binaire avec vérification des bornes. Taille maximale d'un message : 1 Ko (client → serveur). Un message invalide est jeté, et 20 messages invalides font déconnecter.
- Messages JSON validés par zod (types stricts, longueurs bornées, énumérations).
- **Pseudo** : 2 à 16 caractères, normalisé en Unicode NFKC, caractères de contrôle et zéro-largeur retirés, un filtre de mots offensants simple (une liste FR et EN dans le dépôt), et du texte seulement à l'affichage (pas de `innerHTML`).
- **Limites de débit** : création de salle (3 par minute et par IP), essais de code de salon (10 par minute et par IP, contre la recherche par force brute), emotes (1 toutes les 3 s), connexions par IP.
- **IP réelle** : lire `X-Forwarded-For` **uniquement** si la requête vient du réseau Docker de Caddy (proxy de confiance configurable).
- WebSocket : vérification de l'`Origin` (`https://stickyclaude.sayk.fr`, plus `localhost` en dev), heartbeat (ping toutes les 10 s, déconnexion après 30 s sans réponse).
- En-têtes HTTP : `Content-Security-Policy` stricte (`default-src 'self'`, `connect-src 'self' wss://stickyclaude.sayk.fr`, pas d'`unsafe-inline` pour les scripts), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (vibration et gamepad autorisés, le reste coupé).
- Aucun secret dans le dépôt. Le conteneur tourne sous l'utilisateur `node`, avec un système de fichiers en lecture seule si possible.
- RGPD : pas de cookie, pas de traceur, pas de données personnelles stockées côté serveur (les IP ne sont gardées qu'en mémoire pour les limites de débit, et les journaux ne les gardent pas plus de 7 jours, ou les tronquent).

### 2.10 Déploiement (VPS, conteneur, sous-domaine)

Le projet suit la **plateforme multi-jeux** déjà en place (voir `goldmine/deploy/platform/README.md`) : un dépôt = un conteneur = un sous-domaine. Caddy fait le TLS et le reverse proxy sur le réseau Docker `web`, et le DNS `*.sayk.fr` pointe déjà sur le VPS.

1. **`deploy/Dockerfile`** (contexte = racine du dépôt), sur le modèle de goldmine :
   - `node:22-alpine`, en multi-étapes (build avec les devDependencies, puis une image finale avec seulement `dist` et les dépendances de prod).
   - `ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0`, `USER node`, `EXPOSE 3000`.
   - `HEALTHCHECK` sur `http://127.0.0.1:3000/healthz`.
   - `CMD ["node", "--max-old-space-size=320", "packages/server/dist/index.js"]`.
   - Une image finale de moins de 150 Mo.
2. **Sur le VPS** :

   ```bash
   games add stickyclaude MiniGamesSayk/StickyClaude stickyclaude.sayk.fr 3000 main
   ```

   puis `~/apps/games/stickyclaude/.env` (`chmod 600`) :

   ```
   MEM_LIMIT=512m
   CPUS=1.0
   MAX_ROOMS=40
   MAX_CONNECTIONS=400
   SNAPSHOT_HZ=30
   TRUSTED_PROXY=caddy
   PUBLIC_ORIGIN=https://stickyclaude.sayk.fr
   ```

   Pour les mises à jour : `games update stickyclaude`.
3. **Vérifier** que le `docker-compose.yml` généré par `games` laisse assez de temps à l'arrêt propre (`stop_grace_period: 35s`). Sinon, il faut ajouter l'option au générateur dans le dépôt goldmine (à signaler, **ne pas modifier un autre dépôt sans accord**).
4. **Hub `sayk.fr`** (dépôt ClaudeGame, à faire dans ce dépôt-là, avec accord) :
   - une entrée dans `site/games.json` (`id: "stickyclaude"`, `url`, `status: "/status/stickyclaude"`, l'icône, une image SVG `img/stickyclaude.svg`, une couleur, des tags « Combat », « 2 à 8 joueurs », « Multijoueur ») ;
   - une route `handle /status/stickyclaude` dans `deploy/caddy/Caddyfile` qui réécrit vers `/healthz` sur `stickyclaude:3000`.
5. **CI GitHub Actions** : `npm ci`, `npm run check`, `npm run build`, `docker build`, et un test de fumée Playwright (une partie à 2 clients sans erreur dans la console).

### 2.11 Tests

| Niveau | Contenu |
|---|---|
| Unitaires `sim` | Déplacements (coyote, buffer, wall-jump, double saut, plateformes à sens unique), collisions avec la grille (pas d'effet tunnel à grande vitesse), chaque arme, parade et parade parfaite, knockback, mort par chaque cause, destruction du terrain, chaque mode et chaque fin de manche, réapparitions, mort subite, fantômes |
| Propriétés (fast-check) | Un joueur n'est jamais dans un bloc plein ; les PV restent dans [0, 100] ; une manche se termine toujours (grâce à la mort subite) ; les pools ne débordent jamais |
| Déterminisme | Même graine + mêmes entrées → même hash, sur 10 000 ticks |
| Protocole | Aller-retour des codecs (encoder puis décoder = identité, à la quantification près) ; rejet des messages tronqués ou hors bornes (fuzzing) |
| Netcode | Avec une latence, une gigue et des pertes simulées : la réconciliation converge ; l'erreur de prédiction reste sous un seuil en mouvement normal |
| Intégration serveur | 8 clients simulés : salon, lancement, manches, fin de partie ; reconnexion ; hôte qui part ; spectateur qui entre ; partie rapide ; tentatives de triche (message forgé, flood, code faux) |
| Arènes | Validation et accessibilité de toutes les arènes |
| E2E (Playwright) | Partie à 2 onglets, aucune erreur dans la console, et des captures d'écran pour la doc |
| Charge | `loadtest` (voir 2.8) |

---

## 3. Phases de réalisation

| Phase | Contenu | Fin de phase quand… |
|---|---|---|
| **1. Fondations et netcode** | Monorepo, `shared`, `sim` (déplacements et terrain), serveur (salles, boucle, entrées, snapshots), client minimal (rectangles), prédiction, réconciliation, interpolation, outils de lag et graphe réseau, loadtest | 8 clients à 150 ms de latence simulée bougent de façon fluide ; tests et déterminisme au vert ; loadtest dans les budgets |
| **2. Gameplay complet** | Combat, armes, objets, terrain destructible, manches, modes (chacun pour soi, équipes, bonus), fantômes, arènes JSON + éditeur de dev + 10 arènes, salons complets (public, partie rapide, réglages, spectateurs, reconnexion, hôte), emotes | Une partie complète à 2, 4 et 8 joueurs, dans chaque mode, se joue de bout en bout (encore avec des graphismes de développement) |
| **3. Rendu, thème, sensations** | Papier, décor à la main, squelette, IK, ragdoll, line boiling, effets, caméra, UI complète (Preact), personnalisation, entraînement solo, audio, i18n, manette, tactile, accessibilité, qualité adaptative | Le jeu est beau, lisible et agréable sur PC et sur mobile ; les budgets client sont tenus |
| **4. Mise en prod** | Dockerfile, arrêt propre, en-têtes de sécurité, limites, métriques, journaux, CI, loadtest en conteneur, docs (README, ARCHITECTURE, NETCODE, ARENES, CREDITS), entrée du hub, procédure de déploiement | `games add` fonctionne, et le jeu tourne sur `stickyclaude.sayk.fr` dans les budgets |

---

## 4. Risques et parades

| Risque | Parade |
|---|---|
| Le jeu « ne sent pas bon » (mouvements mous) | Phase 1 consacrée aux déplacements et à la prédiction ; toutes les constantes dans un fichier, et un panneau de réglage en direct en dev |
| Lag ressenti sur les coups | Prédiction de sa propre animation et de l'effet, compensation de latence sur les tirs instantanés et la mêlée, hit-stop visuel |
| WebSocket (TCP) : blocage en tête de file lors d'une perte | Redondance des entrées, interpolation adaptative, snapshots sautés si le tampon déborde ; WebTransport en v2 si besoin |
| Serveur saturé | Plafonds `MAX_ROOMS` et `MAX_CONNECTIONS`, salles vides non simulées, loadtest dans la CI ou avant chaque déploiement |
| Peu de joueurs en ligne au lancement (pas de bots) | Arène d'entraînement jouable dans le salon, mode entraînement solo, partie rapide qui regroupe les joueurs, lien de salon facile à partager |
| Mobile moins performant | Qualité adaptative, DPR plafonné, cache des RenderTextures, pas d'allocation par frame |
| Lisibilité à 8 joueurs | Couleurs et motifs distincts, contour blanc autour de son propre stickman, caméra qui dézoome, HUD minimal |

## 5. Décisions validées (21/10/2026)

1. **Visée** : 8 directions + une aide légère, **identique pour tous les appareils** (clavier, manette, tactile). Pas de visée à la souris, pour l'équité face au mobile.
2. **Manches à gagner par défaut** : 5 (l'hôte peut choisir 3 ou 7).
3. **Nom et couleur dans le hub** : « StickyClaude », couleur bleu Bic `#1f4fd1`, icône ✏️.
4. **Dépôt GitHub** : privé ; `games` le clone avec le jeton en lecture seule déjà prévu.
5. **Musique** : des fichiers Opus courts en boucle, créés par script, et chargés en différé.
