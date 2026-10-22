# StickyClaude : déploiement

Mise en production sur `https://stickyclaude.sayk.fr` avec la **plateforme multi-jeux** du VPS (dépôt goldmine, `deploy/platform/README.md`) : un dépôt GitHub = un conteneur = un sous-domaine. Caddy fait le HTTPS, le DNS `*.sayk.fr` pointe déjà sur le serveur : **aucun réglage DNS ni Caddy à la main**.

Ce document suffit pour déployer, vérifier, mettre à jour, revenir en arrière et lire les journaux sans autre aide. L'organisation du code est dans `ARCHITECTURE.md`.

## 1. Ce qu'il faut avoir

| Quoi                        | Détail                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Le VPS                      | Debian, Docker, la commande `games` (`~/apps/bin/games`), Caddy dans `~/apps/caddy`, réseau Docker `web`. 4 Go de RAM, 2 vCPU dans l'état actuel                   |
| Un accès SSH                | `ssh sayk@163.5.141.47`                                                                                                                                            |
| Le dépôt lisible par le VPS | `MiniGamesSayk/StickyClaude` (le jeton **en lecture seule** de `~/apps/.env` suffit, il est déjà en place)                                                         |
| La branche à déployer       | **`main`** une fois la phase 4 fusionnée. Avant cela, `phase-4-prod` (elle contient les phases 2, 3 et 4) : remplacer `main` par `phase-4-prod` dans les commandes |

## 2. Première installation, pas à pas

Sur le VPS, en tant que `sayk` :

```bash
ssh sayk@163.5.141.47
games list                      # le jeu n'y est pas encore
```

**1. Enregistrer le jeu** : clone le dépôt, construit l'image (`deploy/Dockerfile`), génère le `docker-compose.yml`, le lance et ajoute le sous-domaine à Caddy.

```bash
games add stickyclaude MiniGamesSayk/StickyClaude stickyclaude.sayk.fr 3000 main
```

Arguments : nom, dépôt, sous-domaine, **port du conteneur (3000)**, branche. La construction prend 1 à 2 minutes la première fois. En cas d'échec, `games` annule tout (y compris le dossier du jeu) : relire l'erreur, corriger, recommencer.

**2. Créer le `.env`** du jeu (hors du dépôt cloné, donc conservé par les mises à jour). Partir de `.env.example` du dépôt :

```bash
cp ~/apps/games/stickyclaude/src/.env.example ~/apps/games/stickyclaude/.env
chmod 600 ~/apps/games/stickyclaude/.env
nano ~/apps/games/stickyclaude/.env
```

Valeurs à vérifier pour le VPS :

```
MEM_LIMIT=512m
CPUS=1.0
MAX_ROOMS=12
MAX_CONNECTIONS=120
SNAPSHOT_HZ=30
TRUSTED_PROXY=caddy
PUBLIC_ORIGIN=https://stickyclaude.sayk.fr
SHUTDOWN_GRACE_SEC=8
```

`TRUSTED_PROXY=caddy` est **indispensable** : sans lui, tous les joueurs ont l'adresse de Caddy et partagent les limites par IP (8 connexions en tout). Le serveur le signale dans les journaux (`X-Forwarded-For ignored`). `SHUTDOWN_GRACE_SEC=8` s'explique en § 7.

**3. Appliquer le `.env`** (recrée le conteneur) :

```bash
games update stickyclaude
```

## 3. Vérifier

```bash
games list                                   # stickyclaude | MiniGamesSayk/StickyClaude | stickyclaude.sayk.fr | 3000 | main ; conteneur « healthy »
curl -s https://stickyclaude.sayk.fr/healthz # {"ok":true,"rooms":0,"players":0}
curl -sI https://stickyclaude.sayk.fr/       # Content-Security-Policy, X-Content-Type-Options, Strict-Transport-Security…
curl -s -o /dev/null -w '%{http_code}\n' https://stickyclaude.sayk.fr/metrics   # 404 : /metrics n'est pas public
games logs stickyclaude                      # une ligne JSON « listening » ; Ctrl+C pour quitter
```

Puis, dans un navigateur, ouvrir le site : l'accueil s'affiche, « Entraînement » marche, « Créer un salon » donne un code, un deuxième onglet rejoint avec ce code. Dans la console du navigateur : aucune erreur.

Lire les métriques (depuis le VPS, par le réseau interne : la requête ne passe pas par Caddy) :

```bash
docker exec stickyclaude-stickyclaude-1 node -e "fetch('http://127.0.0.1:3000/metrics').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,1)))"
```

On y lit les salons, les joueurs, la durée d'un tick (`tickMs`, `roomStepMs`), le retard de la boucle d'événements (`eventLoopDelayMs`), la mémoire (`heapUsedMB`, `rssMB`), les octets émis, les dépassements de tick (`tickOverruns`).

## 4. Mettre à jour

```bash
games update stickyclaude
```

Tire la branche, reconstruit l'image, **recrée le conteneur** (donc arrêt propre, § 7) et recharge Caddy. Les joueurs en ligne voient « le serveur redémarre pour une mise à jour dans N s », leur partie continue jusqu'à la fin du délai, puis l'écran « Mise à jour du serveur » se reconnecte tout seul. **Les salons ne survivent pas à la mise à jour** : mieux vaut mettre à jour quand `players` vaut 0 (`curl -s https://stickyclaude.sayk.fr/healthz`).

## 5. Revenir en arrière

`games update` se cale toujours sur le bout de la branche (`origin/main`). Deux façons de revenir à une version précédente :

- **Propre** : annuler le commit fautif sur GitHub (`git revert`, push sur la branche déployée), puis `games update stickyclaude`.
- **Tout de suite**, sans toucher à GitHub :

```bash
cd ~/apps/games/stickyclaude
git -C src log --oneline -5                 # repérer le commit sain
git -C src checkout -q <sha>                # se placer dessus
docker compose up -d --build                # reconstruit et relance cette version
```

Attention : le prochain `games update` remettra la branche à jour (et donc la version fautive). Pour garder la version sûre, il faut corriger la branche sur GitHub.

Pour déployer une autre branche : changer la 5ᵉ colonne de la ligne `stickyclaude` dans `~/apps/games.conf`, puis `games update stickyclaude`.

## 6. Lire les journaux

```bash
games logs stickyclaude                                   # les 100 dernières lignes, en continu
docker logs --since 1h stickyclaude-stickyclaude-1        # la dernière heure
docker logs --since 24h stickyclaude-stickyclaude-1 | grep '"level":"warn"'   # les avertissements
```

Chaque ligne est un objet JSON (`level`, `time`, `msg`, + champs) :

| `msg`                                  | Sens                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `listening`                            | démarrage : port, origine publique, proxy de confiance, nombre de fichiers servis                                 |
| `tick overrun`                         | la boucle de ticks a pris du retard (`count`, `worstLagMs`, au plus une ligne toutes les 5 s) : serveur surchargé |
| `X-Forwarded-For ignored…`             | `TRUSTED_PROXY` manque ou est faux : tous les joueurs apparaissent avec la même adresse                           |
| `ws error`                             | erreur sur une connexion WebSocket                                                                                |
| `shutting down`, `draining`, `drained` | arrêt propre en cours                                                                                             |
| `uncaught exception`                   | niveau `fatal` : le serveur s'arrête (code 1) et Docker le relance                                                |

Docker garde 3 fichiers de 10 Mo (`json-file`) : quelques jours de journaux. **Aucune adresse IP complète n'est journalisée** (elles sont tronquées) et rien n'est écrit sur le disque par le jeu.

## 7. Délai d'arrêt (`stop_grace_period`)

L'arrêt propre (`ARCHITECTURE.md` § 5) laisse `SHUTDOWN_GRACE_SEC` secondes (30 par défaut) aux joueurs, puis ferme les connexions avec le code 1012. L'analyse demande que `docker stop` accorde **au moins 35 s**.

**Vérifié le 22/10/2026 : ce n'est pas le cas.** Le `docker-compose.yml` généré par `games` n'a pas de `stop_grace_period` ; Docker applique donc **10 s** puis envoie `SIGKILL`.

- **Solution actuelle (sans toucher à goldmine)** : `SHUTDOWN_GRACE_SEC=8` dans le `.env`. Le serveur ferme proprement à 8 s, avant le `SIGKILL`.
- **Solution complète (changement à faire dans le dépôt goldmine, non fait ici)** : dans `deploy/platform/games`, fonction `render_compose`, ajouter une ligne après `pids_limit: 512` :

```diff
     cpus: \${CPUS:-1.0}
     pids_limit: 512
+    stop_grace_period: \${STOP_GRACE_PERIOD:-35s}
     env_file:
```

Cela vaut pour tous les jeux sans rien leur coûter (un arrêt rapide reste rapide). Une fois le générateur à jour et `games update all` passé, remplacer `SHUTDOWN_GRACE_SEC=8` par `SHUTDOWN_GRACE_SEC=30`.

## 8. Variables d'environnement

Toutes sont facultatives et ont une valeur par défaut sûre ; `.env.example` les reprend. Lues par `packages/server/src/config.ts` (les valeurs hors bornes sont ramenées dans les bornes).

**Plateforme** (lues par `games`, pas par le jeu) : `MEM_LIMIT` (`512m`), `CPUS` (`1.0`).

| Variable             | Défaut (code)          | Sens                                                                                                                                                                                           |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`           | `production` (image)   | `production` : en-têtes de sécurité complets, `Origin` strict, hôte `0.0.0.0`                                                                                                                  |
| `PORT`               | `3000`                 | port d'écoute (doit correspondre à la colonne « port » de `games.conf`)                                                                                                                        |
| `HOST`               | `0.0.0.0`              | adresse d'écoute (`127.0.0.1` hors production)                                                                                                                                                 |
| `PUBLIC_ORIGIN`      | vide                   | origine publique (`https://stickyclaude.sayk.fr`) : seule origine acceptée pour le WebSocket, et utilisée dans la CSP et HSTS. Vide : l'origine de la page doit être celle de l'en-tête `Host` |
| `TRUSTED_PROXY`      | vide                   | proxys dont on croit `X-Forwarded-For` : `caddy` (réseaux privés dont Docker) ou une liste d'adresses et de CIDR. Vide : en-tête ignoré                                                        |
| `METRICS_TOKEN`      | vide                   | jeton `Authorization: Bearer …` pour lire `/metrics` depuis l'extérieur. Vide : lisible seulement depuis l'intérieur (réseau privé, sans proxy)                                                |
| `LOG_LEVEL`          | `info`                 | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`                                                                                                                                   |
| `SHUTDOWN_GRACE_SEC` | `30` (0 à 300)         | arrêt propre : délai donné aux joueurs après `SIGTERM` (§ 7)                                                                                                                                   |
| `MAX_ROOMS`          | `40`                   | salons simultanés ; au-delà : « serveur plein »                                                                                                                                                |
| `MAX_CONNECTIONS`    | `400`                  | connexions simultanées (joueurs et spectateurs)                                                                                                                                                |
| `MAX_CONN_PER_IP`    | `8`                    | connexions simultanées par adresse                                                                                                                                                             |
| `SNAPSHOT_HZ`        | `30` (20 à 60)         | instantanés par seconde envoyés à chaque joueur                                                                                                                                                |
| `TICK_HZ`            | `60`                   | fixé à 60 (la simulation est à pas fixe)                                                                                                                                                       |
| `CREATE_PER_MIN`     | `3`                    | créations de salon par minute et par IP                                                                                                                                                        |
| `CODE_TRIES_PER_MIN` | `10`                   | essais de code de salon ratés par minute et par IP                                                                                                                                             |
| `ROOM_IDLE_TTL_SEC`  | `300`                  | durée de vie d'un salon vide                                                                                                                                                                   |
| `HEARTBEAT_MS`       | `10000`                | intervalle des pings WebSocket ; déconnexion après 3 pings sans réponse                                                                                                                        |
| `RECONNECT_GRACE_MS` | `20000`                | délai de reconnexion d'un joueur                                                                                                                                                               |
| `AUTOSTART_MS`       | `20000`                | lancement automatique d'un salon public quand 2 joueurs sont prêts (0 : jamais)                                                                                                                |
| `IDLE_PLAYING_MS`    | `60000`                | inactivité en manche : le joueur devient spectateur                                                                                                                                            |
| `IDLE_LOBBY_MS`      | `600000`               | inactivité dans le salon : déconnexion                                                                                                                                                         |
| `MATCH_END_MS`       | `12000`                | durée du podium avant le retour au salon                                                                                                                                                       |
| `EMOTE_COOLDOWN_MS`  | `1000`                 | délai minimal entre deux emotes                                                                                                                                                                |
| `CONTROL_PER_SEC`    | `20`                   | messages de contrôle (JSON) acceptés par seconde et par connexion                                                                                                                              |
| `STATIC_DIR`         | `packages/client/dist` | dossier du client construit (l'image le fixe déjà)                                                                                                                                             |

**Développement seulement (ne jamais mettre en production)** : `DEV_TOOLS=1` (réglage en direct, enregistrement exposé), `RECORD_DIR` (enregistrement des entrées de chaque salon), `ALLOW_NO_ORIGIN=1` (accepte les connexions WebSocket sans `Origin`, pour les outils de charge).

## 9. Ce que fait le serveur de production

- **Statique** : `index.html` en `no-cache`, `/assets/*` (noms hachés) en `public, max-age=31536000, immutable`, le reste en `max-age=3600`. Brotli et gzip **précompressés au build** (`scripts/precompress.mjs`), choisis selon `Accept-Encoding`, `ETag` et réponses 304.
- **En-têtes** : CSP stricte (`default-src 'self'`, pas de script ni de style en ligne, `connect-src` limité à l'origine du jeu, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (manette, plein écran et audio seulement), COOP/CORP, `X-Frame-Options`, HSTS quand `PUBLIC_ORIGIN` est en https.
- **WebSocket** : `Origin` vérifié, 1 Ko par message au plus, 20 messages invalides → déconnexion, limites de débit par IP.
- **Aucun secret** dans l'image ni dans le dépôt ; l'image tourne sous l'utilisateur `node` et fonctionne **en lecture seule** (`docker run --read-only`).
- **Image** : Alpine + binaire de Node allégé + `dist` ; **123 Mo** décompressés (≈ 50 Mo en transfert).

## 10. Charge en conditions réelles

**Protocole.** Image construite par `docker build -f deploy/Dockerfile`, lancée avec `docker run --init --read-only --memory 512m --cpus 1 --cpuset-cpus 1` sur le VPS (Xeon Gold 6140 à 2,3 GHz, 2 vCPU KVM, 4 Go, partagé avec Caddy, goldmine, OpenClaude, au repos pendant les mesures), puis `scripts/loadtest.ts` (faux clients qui se battent : coups, parades, ramassages, armes, mort subite ; entrées à 60 Hz). Le générateur tourne sur un poste distant (20 cœurs) et joint le conteneur par un tunnel SSH dont le processus est épinglé sur l'autre cœur (`ssh -L`, `taskset -cp 0`) ; le conteneur est en réseau `host` pour éviter le proxy de ports de Docker. Fenêtre de mesure : 60 s après 30 s de chauffe. Les valeurs sont celles lues dans `/metrics` du conteneur (CPU du processus Node, tick, boucle d'événements).

| Joueurs | Salons × joueurs | CPU (1 cœur) | Pas de salle p50 / p99 | Tick complet p50 / p99 | Boucle d'événements p99 | Débit par joueur                        | RSS / tas  | Verdict                          |
| ------: | ---------------- | -----------: | ---------------------- | ---------------------- | ----------------------: | --------------------------------------- | ---------- | -------------------------------- |
|      64 | 8 × 8            |     **40 %** | 0,037 / 0,212 ms       | 1,56 / 6,13 ms         |             **8,05 ms** | 9,0 Ko/s                                | 97 / 22 Mo | budgets tenus                    |
|      96 | 12 × 8           |     **50 %** | 0,026 / 0,176 ms       | 1,83 / 6,61 ms         |            **10,58 ms** | 8,7 Ko/s                                | 96 / 23 Mo | limite (boucle 0,6 ms au-dessus) |
|     200 | 25 × 8           |     **74 %** | 0,017 / 0,068 ms       | 3,08 / 15,7 ms         |            **16,34 ms** | 5,7 Ko/s (18 snapshots/s au lieu de 30) | 98 / 24 Mo | **budgets non tenus**            |

Budgets de l'analyse (§ 2.8) : pas de simulation d'une salle p50 < 0,15 ms et p99 < 0,5 ms ; CPU < 60 % ; tas < 250 Mo ; retard de boucle p99 < 10 ms ; moins de 20 Ko/s par client. **Même charge (25 × 8) sur un poste de bureau** (Node natif épinglé sur un cœur, générateur sain) : CPU 48 %, boucle p99 7,6 ms, 30 snapshots/s, budgets tenus.

**Lecture.**

- La **simulation** (pas de salle, tick complet), la **mémoire** (98 Mo de RSS pour 512 Mo) et la **bande passante** sont très en dessous des budgets à toutes les charges. Le coût est dans les **entrées-sorties** : 200 joueurs, c'est 12 000 paquets d'entrées reçus et 6 000 instantanés envoyés par seconde, soit à peu près autant de temps système (appels `read`/`write`, lourds dans une machine virtuelle) que de JavaScript (profil `--cpu-prof` : 41 % du temps occupé à envoyer les instantanés, 20 % à recevoir les entrées, 13 % pour `step`).
- Sur ce VPS, **les budgets tiennent jusqu'à ≈ 64 à 96 joueurs simultanés**. À 200, la boucle prend du retard (le serveur envoie 18 instantanés par seconde au lieu de 30) : le jeu reste jouable mais saccade.
- **Les valeurs de production sont donc plafonnées** : `MAX_ROOMS=12` et `MAX_CONNECTIONS=120`. Au-delà, le serveur répond « serveur plein » plutôt que de dégrader les parties en cours. Le code garde les valeurs de l'analyse (40 et 400) pour une machine plus grande.
- Ce qui n'est **pas** compté : le CPU de Caddy (chiffrement TLS de chaque connexion), qui se partage les mêmes 2 cœurs. Avec du vrai trafic, la capacité sera un peu plus basse.
- Une mesure sous Windows (phase 3) donnait déjà des dépassements ; la machine de bureau Linux, plus rapide, tient les budgets : le facteur est bien le coût par appel système du VPS.

**Leviers pour monter en charge** (non faits : ils touchent au réseau de jeu et demandent un essai en conditions réelles) :

1. envoyer les entrées à 30 Hz au lieu de 60 (le client en envoie déjà 4 par paquet) : divise par deux les paquets reçus, mais impose d'augmenter d'un tick la marge visée (`MARGIN_*`) ;
2. `SNAPSHOT_HZ=20` : un tiers d'envois en moins, au prix d'une interpolation plus grossière ;
3. un VPS avec plus de cœurs et un second processus par groupe de salons.

**Refaire la mesure.** Le générateur existe aussi en conteneur (`deploy/Dockerfile.loadtest`) pour tourner à côté du serveur sans tunnel, mais sur un VPS de 2 cœurs il se bat alors pour le même processeur (le test de charge dit alors « le générateur sature ») ; préférer un autre poste.

```bash
# poste distant : tunnel vers un conteneur de test en réseau host (port 3100, PUBLIC_ORIGIN=http://loadtest.local, plafonds par IP relevés)
ssh -f -N -L 3100:127.0.0.1:3100 sayk@163.5.141.47
npm run loadtest -- --url ws://127.0.0.1:3100/ws --rooms 12 --players 8 --duration 60 --warmup 30
```

Le conteneur de test doit tourner avec `-e PUBLIC_ORIGIN=http://loadtest.local -e MAX_CONN_PER_IP=1000 -e CREATE_PER_MIN=100000 -e CODE_TRIES_PER_MIN=100000` (toutes les connexions viennent de la même adresse), et être redémarré entre deux essais (les salons vides restent 5 minutes).

## 11. Le hub `sayk.fr`

Le dépôt `ClaudeGame` n'est **pas** modifié ici. Les trois morceaux à y ajouter sont dans `deploy/hub/` :

1. `deploy/hub/games.json.stickyclaude.json` : l'entrée à ajouter au tableau de `site/games.json` ;
2. `deploy/hub/stickyclaude.svg` : à copier dans `site/img/stickyclaude.svg` ;
3. `deploy/hub/Caddyfile.stickyclaude` : le bloc `handle /status/stickyclaude` à ajouter dans `deploy/caddy/Caddyfile`, à côté de ceux de goldmine et d'OpenClaude.

Puis redéployer le hub (selon la procédure de ClaudeGame). Le statut du jeu y apparaît « en ligne » tant que `/healthz` répond 200 (il répond 503 pendant un arrêt propre).

## 12. Dépannage

| Symptôme                                                                  | Cause probable et remède                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games add` échoue à la construction                                      | lire la fin de la sortie ; reproduire en local : `docker build -f deploy/Dockerfile .`                                                                      |
| Le site répond 502 par Caddy                                              | le conteneur est arrêté ou « unhealthy » : `games list`, `games logs stickyclaude`                                                                          |
| Les joueurs n'arrivent pas à se connecter (« Connexion perdue » aussitôt) | `PUBLIC_ORIGIN` ne correspond pas à l'adresse du site (le serveur répond 403 à la mise à niveau WebSocket)                                                  |
| « Serveur plein » alors que le jeu est vide                               | `MAX_CONN_PER_IP` atteint parce que `TRUSTED_PROXY` manque (tous les joueurs ont la même adresse), ou salons vides pas encore expirés (`ROOM_IDLE_TTL_SEC`) |
| `tick overrun` fréquents                                                  | serveur surchargé : voir `/metrics`, § 10 ; baisser `MAX_ROOMS`                                                                                             |
| Les joueurs sont coupés à chaque mise à jour sans annonce                 | `SHUTDOWN_GRACE_SEC` supérieur au délai d'arrêt de Docker (10 s) : voir § 7                                                                                 |
