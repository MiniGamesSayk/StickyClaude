# Prompts à donner à Claude Sonnet 5.5

> Quatre prompts, **un par phase**, à lancer **l'un après l'autre**, chacun dans une nouvelle session Claude Code ouverte sur ce dépôt (`MiniGamesSayk/StickyClaude`). Ne lance la phase suivante qu'une fois la précédente mergée sur `main` et vérifiée.
>
> Pour chaque phase : copier le **bloc commun** puis le **bloc de la phase**, dans le même message.

---

## Bloc commun (à coller en tête de chaque phase)

Tu es un ingénieur senior en jeux multijoueur temps réel (netcode, simulation, rendu WebGL). Tu travailles sur **StickyClaude**, un jeu de combat de stickmen en ligne dans le navigateur (2 à 8 joueurs), au thème « encre et carnet », qui sera hébergé sur `https://stickyclaude.sayk.fr` dans un conteneur Docker limité à **512 Mo et 1 CPU**.

**Cadre :**

- **Source de vérité : `docs/ANALYSE.md`.** Lis-le en entier avant toute chose. Si ton code le contredit, c'est ton code qui a tort. Si un point manque ou ne tient pas techniquement, choisis le défaut le plus simple, **note-le dans `docs/DECISIONS.md`** (date, contexte, choix, alternative) et continue.
- Respecte la stack, le découpage (`shared`, `sim`, `server`, `client`) et les budgets de performance de l'analyse (§2.1, §2.2, §2.8). Toute dépendance nouvelle doit être justifiée dans `DECISIONS.md` (taille, licence, raison).
- **`packages/sim` reste pur** : il ne dépend que de `shared`, n'a ni E/S, ni DOM, ni horloge système, ni `Math.random`, et n'alloue rien dans `step`.
- Travaille sur la branche indiquée dans le bloc de la phase. Fais des commits petits et descriptifs, et pousse régulièrement. **Ne crée pas de pull request** sauf demande explicite. Ne modifie **aucun autre dépôt** du dossier parent (goldmine, ClaudeGame, OpenClaude) : s'il faut y toucher, écris la modification proposée dans ton compte rendu.
- Langue : interface et documentation en **français**, code, identifiants et commentaires en anglais.
- **Aucun asset copié** : tous les visuels, sons, musiques et polices sont créés par toi ou sous licence libre compatible (OFL, CC0), et listés dans `docs/CREDITS.md`. Pas de nom, de visuel ni de son repris de Stick Fight ou d'un autre jeu.
- `npm run check` (lint + types + tests) doit être vert avant chaque push.
- **Méthode** : 1) lis l'analyse et le code existant ; 2) propose un **plan court** (jalons, risques, ce que tu ne feras pas) ; 3) avance jalon par jalon, en lançant les tests à chaque fois ; 4) mesure au lieu de deviner pour tout ce qui touche à la performance ; 5) à la fin, un **compte rendu** : ce qui est fait, testé et mesuré (avec les chiffres), ce qui reste, les décisions prises et les questions ouvertes.
- Ne t'arrête pas pour des détails. Pose une question seulement si un choix est irréversible ou contredit l'analyse.

---

## Phase 1 : fondations, simulation et netcode

**Branche : `phase-1-netcode`.**

Objectif : un squelette de jeu où **jusqu'à 8 joueurs se déplacent ensemble de façon fluide**, même avec une mauvaise connexion. Pas encore de combat ni de beaux graphismes : le cœur doit être juste et rapide, car tout le reste repose dessus.

1. **Monorepo** : npm workspaces `packages/{shared,sim,server,client}`, TypeScript strict, ESLint + Prettier, Vitest, et les scripts `dev`, `build`, `start`, `check`, `test`, `simulate`, `loadtest`. `npm run dev` lance le serveur (port 3000) et Vite (port 5173), qui relaie `/ws`. Un README de démarrage.
2. **`shared`** : constantes (tick, tailles, physique, **toutes les constantes de mouvement dans un seul fichier**), types, RNG à graine, codecs binaires (entrées, snapshots, événements fiables) avec vérification des bornes, schémas zod des messages de contrôle, format et schéma des arènes (§2.6), et 2 arènes de test en JSON.
3. **`sim`** : le monde (§2.3) avec la grille, les joueurs et leur machine à états, et tous les **déplacements** de §1.2 (course, saut variable, coyote, buffer, double saut, wall-slide et wall-jump, accroupi, sens unique, chute rapide), les plateformes mobiles et les événements. `step(world, inputs)` sans allocation.
4. **`server`** : HTTP (statique + `/healthz`) et WebSocket ; des salles minimales (créer avec un code, rejoindre, quitter) ; la boucle de ticks unique (§2.5) ; les tampons d'entrées (§2.4) ; les snapshots binaires à 30 Hz, avec des événements fiables accusés ; la contre-pression ; le heartbeat ; les limites de base.
5. **`client`** : Pixi v8 avec des rectangles et des traits simples ; les entrées clavier et manette ; la **prédiction et réconciliation** de son propre joueur, l'**interpolation** adaptative des autres et le lissage des corrections ; une UI minimale (pseudo, créer ou rejoindre par code).
6. **Outils** : le simulateur `?lag=&jitter=&loss=`, le **graphe réseau** en surimpression (RTT, octets par seconde, corrections, tampon), un panneau de réglage en direct des constantes de mouvement (en dev seulement), l'enregistrement et la relecture des entrées d'une salle.
7. **Tests** : déplacements et collisions (y compris sans effet tunnel à grande vitesse), propriétés fast-check (jamais dans un bloc plein), **déterminisme** (même hash sur 10 000 ticks), aller-retour et fuzzing des codecs, convergence de la réconciliation sous lag simulé, et intégration avec 8 clients.
8. **`npm run loadtest`** (§2.8) : de faux clients, avec un rapport sur la durée d'un tick (p50, p99), la bande passante par client, la mémoire et le retard de la boucle d'événements.

Rédige `docs/NETCODE.md` : le schéma du flux, les formats binaires octet par octet, les délais et le comportement en cas de perte.

**Critères d'acceptation** : 8 onglets avec `?lag=150&jitter=30&loss=2` se déplacent sans saccade ni téléportation visible ; son propre stickman répond sans délai ; le loadtest à 25 salles × 8 joueurs respecte les budgets de §2.8 ; `npm run check` est vert.

---

## Phase 2 : gameplay complet

**Branche : `phase-2-gameplay`** (depuis `main`, qui contient la phase 1).

Objectif : **toutes les règles du jeu** de §1.2 à §1.8, jouables de bout en bout, avec encore des graphismes de développement (des formes simples, mais lisibles).

1. **Combat** : enchaînement de 3 coups, coup chargé, coup de pied vers le bas, parade et parade parfaite, étourdissement, PV, knockback, toutes les causes de mort, et la **compensation de latence** de la mêlée et des tirs instantanés (§2.4).
2. **Armes et objets** (§1.3) : les 12 armes dans **un seul fichier de données**, l'apparition dessinée (seulement l'événement à ce stade), ramasser, lancer, lâcher, les munitions, la disparition ; les caisses, les ballons, les punaises ; le **terrain destructible** (bazooka, gomme), synchronisé par événements fiables.
3. **Manches et partie** : le déroulé de §1.1, la mort subite, le score, les stats de fin de partie.
4. **Modes** (§1.5) : chacun pour soi, équipes (avec ou sans tir ami), les 6 modes bonus en rotation, et **« Les morts dessinent »** (fantôme-crayon).
5. **Arènes** : l'**éditeur de dev** (§1.4, route `/editor` en dev seulement, absente du build de prod) et les **10 arènes** de l'analyse, toutes validées par le test d'accessibilité (§2.6).
6. **Salons complets** (§1.7) : privé ou public, la liste publique, **partie rapide** avec lancement automatique, les réglages de l'hôte, l'hôte qui change automatiquement, l'expulsion, l'état « prêt », les équipes, 8 joueurs + 4 spectateurs, l'entrée en cours de manche, la **reconnexion** par jeton (20 s), l'inactivité, les emotes avec limite de débit, l'**arène d'entraînement** dans le salon (sans dégâts qui comptent).
7. **Personnalisation** : le modèle de données et la validation côté serveur (§1.8), même si l'affichage reste sommaire.
8. **Sécurité** (§2.9) : validation, limites de débit (création, essais de code, emotes, connexions par IP), filtrage des pseudos, vérification de l'Origin.
9. **Tests** : chaque arme, chaque mode, chaque fin de manche, les fantômes, la destruction du terrain, et en intégration : partie complète à 2, 4 et 8, reconnexion, hôte qui part, spectateur, partie rapide, tentatives de triche. Le loadtest doit **toujours** tenir les budgets avec le combat et les armes actifs.

Rédige `docs/ARENES.md` (format, éditeur, comment ajouter une arène) et complète `NETCODE.md` et `DECISIONS.md`.

**Critères d'acceptation** : une partie complète à 2, 4 et 8 joueurs se joue dans chaque mode, du salon au podium, sans erreur ; aucun message forgé ne peut modifier la position, les PV ou le score ; le loadtest est dans les budgets ; `npm run check` est vert.

---

## Phase 3 : rendu, thème « encre et carnet » et sensations

**Branche : `phase-3-rendu`** (depuis `main`).

Objectif : le jeu devient **beau, original et agréable**, sur PC comme sur mobile, sans dépasser les budgets client. Relis §1.9 à §1.12 et §2.7 en entier. Le style doit faire **dessiné à la main au stylo bille sur une page de cahier**, cohérent partout (jeu, menus, transitions, curseurs, boutons).

1. **Direction artistique d'abord** : avant de coder, écris dans `docs/DIRECTION_ARTISTIQUE.md` la palette (papier, 12 encres, interface), les épaisseurs de trait, les polices (libres, hébergées dans le dépôt), les règles d'animation (le « en deux » à 12 i/s du line boiling) et une planche de référence (une page HTML de dev qui montre tous les éléments).
2. **Rendu du monde** : le papier et le décor mis en cache (marching squares, déformation à main levée, hachures, morceaux redessinés à la destruction), le décor propre à chaque arène, l'arène qui se dessine et la page qui se tourne.
3. **Stickmen** : le squelette, les poses-clés et le mélange, l'IK des pieds et des mains, le **line boiling**, les styles de trait, les accessoires, les motifs pour daltoniens, le contour de son propre stickman, et le **ragdoll Verlet** puis la rature à la mort (§2.7).
4. **Effets et sensations** : les taches d'encre persistantes, les onomatopées, les éclats de papier, les traînées, le hit-stop et le tremblement **visuels**, le flash de parade parfaite, la caméra dynamique, l'apparition des armes dessinées en direct, et le fantôme-crayon.
5. **Interface complète** en Preact (§1.9) : l'accueil, la personnalisation, le salon, le HUD dans la marge, le podium et les stats, les options, les écrans de déconnexion et de maintenance, et l'**entraînement solo** avec les mannequins et les objectifs (la simulation tourne en local, sans serveur).
6. **Contrôles** : la reconfiguration, AZERTY et QWERTY, la manette (avec vibration), les **contrôles tactiles** (§1.6 : paysage, safe areas, taille réglable, plein écran, vibration).
7. **Audio** (§1.10) : les sons générés par script (`scripts/gen-audio`), la musique, le mixeur, le chargement paresseux. Rien de téléchargé.
8. **i18n FR + EN** avec des clés typées, et l'**accessibilité** (§1.11).
9. **Performance** : la qualité adaptative, aucune allocation par frame dans la boucle de rendu (vérifiée au profiler), le DPR plafonné, le pool de particules, et un budget du bundle **vérifié dans la CI** (le build échoue au-delà de 400 Ko gzip, hors audio). Mesure les FPS en émulation mobile (Chromium, CPU ralenti 4×) et note les chiffres.
10. **Tests E2E** Playwright : une partie à 2 onglets, aucune erreur dans la console, et des captures d'écran de chaque écran (dans `docs/screenshots/`).

**Critères d'acceptation** : les captures d'écran montrent un style cohérent et original ; 60 FPS en émulation mobile (CPU ×4) en qualité auto ; le jeu est jouable entièrement au tactile et à la manette ; le mode mouvement réduit coupe le tremblement, le boiling et le hit-stop ; FR et EN sont complets ; le budget du bundle est tenu ; `npm run check` est vert.

---

## Phase 4 : mise en production

**Branche : `phase-4-prod`** (depuis `main`).

Objectif : le jeu tourne sur `https://stickyclaude.sayk.fr` via la plateforme multi-jeux existante (§2.10). Lis `../goldmine/deploy/platform/README.md` et `../goldmine/deploy/goldmine/Dockerfile` pour reprendre exactement les conventions (lecture seule, ne modifie pas ces dépôts).

1. **`deploy/Dockerfile`** multi-étapes (§2.10) : `node:22-alpine`, `USER node`, `HEALTHCHECK` sur `/healthz`, `--max-old-space-size=320`, et une image de moins de 150 Mo.
2. **Serveur de prod** : les assets précompressés (brotli et gzip) et le cache `immutable`, `index.html` en `no-cache`, les **en-têtes de sécurité** et la CSP stricte (§2.9), l'Origin, le proxy de confiance, `/metrics` interne uniquement, les journaux pino en JSON, l'**arrêt propre sur SIGTERM** (annonce, 30 s, fermeture avec un code dédié, reconnexion automatique côté client).
3. **Configuration** : toutes les variables d'environnement documentées (`docs/DEPLOIEMENT.md`), avec des valeurs par défaut sûres, et un `.env.example` dans le dépôt.
4. **Charge en conditions réelles** : construis l'image, lance-la avec `docker run --memory 512m --cpus 1`, puis passe le loadtest à 25 salles × 8 joueurs. Note les chiffres dans `docs/DEPLOIEMENT.md`. Si les budgets ne tiennent pas, optimise (profil `--cpu-prof`) avant de continuer.
5. **CI GitHub Actions** : `npm ci`, `check`, `build`, le budget du bundle, `docker build`, et le smoke Playwright.
6. **Docs** : un README complet (présentation, captures, lancement local, scripts, structure, déploiement), `ARCHITECTURE.md`, `DEPLOIEMENT.md` (la procédure pas à pas avec `games add stickyclaude MiniGamesSayk/StickyClaude stickyclaude.sayk.fr 3000 main`, le `.env` à créer, comment vérifier, mettre à jour, revenir en arrière et lire les journaux), et `CREDITS.md` à jour.
7. **Hub `sayk.fr`** : **ne modifie pas le dépôt ClaudeGame**. Fournis dans ton compte rendu le bloc exact à ajouter à `site/games.json`, le fichier `img/stickyclaude.svg` (créé dans `deploy/hub/` de ce dépôt) et le bloc `handle /status/stickyclaude` pour son Caddyfile (§2.10).
8. **Vérifie** que le `docker-compose.yml` généré par `games` laisse ≥ 35 s pour l'arrêt propre. Sinon, décris le changement à faire dans le générateur (dans le dépôt goldmine).

**Critères d'acceptation** : `docker build` puis `docker run` en local servent un jeu jouable sur `localhost:3000` avec `/healthz` au vert ; le loadtest en conteneur limité tient les budgets ; la CI est verte ; `DEPLOIEMENT.md` permet à quelqu'un d'autre de déployer sans aide ; les blocs pour le hub sont prêts à coller.
