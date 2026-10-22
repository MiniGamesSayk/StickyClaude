# StickyClaude : architecture

Vue d'ensemble de ce qui est **construit et déployé**. Le « pourquoi » des grands choix est dans `ANALYSE.md`, les écarts dans `DECISIONS.md`, le protocole réseau dans `NETCODE.md`, la mise en production dans `DEPLOIEMENT.md`.

## 1. En production

```
 navigateur ──https/wss──►  Caddy (~/apps/caddy, TLS)  ──http/ws, réseau Docker « web »──►  conteneur stickyclaude
                              │                                                              │
                              │  stickyclaude.sayk.fr → stickyclaude:3000                     │  node packages/server/dist/index.js
                              │                                                              │   ├─ HTTP : client statique, /healthz, /api/rooms, /metrics
 hub sayk.fr ──/status/stickyclaude──► rewrite /healthz ───────────────────────────────────────┘   ├─ WebSocket /ws : salons, entrées, snapshots
                                                                                                    └─ boucle de ticks unique (60 Hz)
```

- **Un dépôt = un conteneur = un sous-domaine** : la commande `games` de la plateforme (dépôt goldmine) clone le dépôt, construit `deploy/Dockerfile`, génère le `docker-compose.yml` (512 Mo, 1 CPU, `init: true`, 512 processus, journaux 3 × 10 Mo) et la section du `Caddyfile`.
- **Un seul processus Node**, un seul fil : le conteneur n'a qu'un CPU. Tout l'état (salons, parties) est en mémoire ; rien n'est écrit sur le disque (le conteneur peut tourner en lecture seule). Un redémarrage coupe les parties en cours (voir l'arrêt propre, §5).
- **Pas de base de données, pas de compte, pas de cookie.** La personnalisation et les options sont dans le `localStorage` du joueur.

## 2. Les quatre paquets

```
shared  ◄──  sim  ◄──  server
   ▲          ▲
   └──────────┴────────  client
```

| Paquet   | Rôle                                                                                                                                                            | Dépend de       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `shared` | constantes, mouvement, combat, armes, modes, réglages, cosmétiques (**un fichier de données par sujet**), RNG, codecs binaires, schémas zod, arènes JSON        | rien (zod)      |
| `sim`    | simulation **pure et déterministe** : joueurs, combat, armes, objets, terrain, manches, modes, fantômes, analyse d'accessibilité des arènes, relecture          | `shared`        |
| `server` | HTTP + WebSocket, salons, boucle de ticks, entrées, snapshots, compensation de latence, sécurité, métriques                                                     | `shared`, `sim` |
| `client` | réseau (prédiction, horloge, interpolation), rendu Pixi « encre et carnet », interface Preact, entrées, audio, i18n, éditeur d'arènes et planche de style (dev) | `shared`, `sim` |

`sim` n'a ni E/S, ni DOM, ni horloge, ni `Math.random` (règles ESLint), et n'alloue rien dans `step`. **Le serveur et le client appellent la même fonction** `step(world, inputs)` : le serveur fait autorité, le client prédit et rejoue.

## 3. Serveur (`packages/server/src`)

| Fichier                                   | Rôle                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ts`                                 | Point d'entrée : configuration, journaux, signaux (`SIGTERM` → arrêt propre), erreurs fatales (journal puis code 1 : Docker relance)                                                          |
| `config.ts`                               | **Toutes** les variables d'environnement, avec bornes et valeurs par défaut sûres ; règle de l'`Origin`                                                                                       |
| `httpServer.ts`                           | Routes HTTP, mise à niveau WebSocket, heartbeat, arrêt propre (`shutdown`)                                                                                                                    |
| `static.ts`                               | Fichiers statiques : index établi au démarrage (pas de traversée de répertoire), variantes `.br`/`.gz` précompressées, `ETag`/304, `immutable` pour `/assets/*`, `no-cache` pour `index.html` |
| `security.ts`                             | CSP stricte, `Permissions-Policy`, `nosniff`, `Referrer-Policy`, COOP/CORP, HSTS (si `PUBLIC_ORIGIN` est en https)                                                                            |
| `proxy.ts`                                | IP réelle (`X-Forwarded-For` lu **seulement** depuis un proxy de confiance), requêtes « internes » pour `/metrics`                                                                            |
| `logger.ts`                               | Journaux JSON (pino), adresses IP tronquées                                                                                                                                                   |
| `gameServer.ts`                           | Connexions, routage des messages, limites de débit, création/jonction de salon, partie rapide, annonce d'arrêt                                                                                |
| `room.ts`                                 | Un salon : membres, réglages, équipes, spectateurs, reconnexion, partie, snapshots, compensation de latence                                                                                   |
| `loop.ts`                                 | Boucle de ticks unique pour toutes les salles (horloge monotone, accumulateur, 4 ticks de rattrapage au plus)                                                                                 |
| `metrics.ts`, `recorder.ts`               | Mesures (durée de tick, octets, retard de boucle…) ; enregistrement des entrées d'un salon (dev)                                                                                              |
| `rateLimit.ts`, `names.ts`, `badwords.ts` | Limites de débit, normalisation des pseudos, filtre de mots                                                                                                                                   |

### Cycle d'une requête

1. **HTTP** (`GET`/`HEAD` seulement) : `/healthz`, `/api/rooms`, `/metrics` (interne ou jeton), sinon le fichier statique ou `404`.
2. **WebSocket** (`/ws`) : contrôle de l'`Origin`, adresse du client (`proxy.ts`), plafonds de connexions (global et par IP) ; le client envoie des messages JSON de salon (`create`, `join`, `quick`, `resume`…, validés par zod) et des paquets binaires d'entrées (≤ 1 Ko, décodeur à bornes vérifiées). 20 messages invalides → déconnexion.
3. **Boucle** : à chaque tick (60 Hz) chaque salon active consomme ses entrées, appelle `step`, puis envoie à chaque client un snapshot toutes les `60 / SNAPSHOT_HZ` ticks (30 Hz par défaut), échelonnés d'un client à l'autre pour lisser la charge.

## 4. Client (`packages/client/src`)

| Dossier   | Rôle                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `net/`    | `client.ts` (protocole, prédiction/réconciliation avec `predictor.ts`, `clock.ts`, `interpolation.ts`), `transport.ts` (WebSocket, simulateur `?lag=&jitter=&loss=`)                 |
| `app/`    | `online.ts` (connexion, reconnexion, maintenance), `solo.ts` (entraînement : la vraie simulation en local), `source.ts` (**source de scène** lue par le rendu), `store.ts` (signaux) |
| `render/` | Pixi v8 : papier, terrain à l'encre, stickmen (squelette, IK, line boiling), effets, ragdoll, caméra, qualité adaptative                                                             |
| `ui/`     | Preact : accueil, personnalisation, salon, HUD, podium, options, écrans de connexion perdue et de maintenance                                                                        |
| `input/`  | Clavier (par `event.code`), manette, tactile                                                                                                                                         |
| `audio/`  | Moteur Web Audio, sons générés par script (`scripts/gen-audio`), chargement paresseux                                                                                                |
| `i18n/`   | FR et EN, clés typées                                                                                                                                                                |

Pixi est importé avec `pixi.js/unsafe-eval` : la CSP de production interdit `eval`.

## 5. Arrêt propre

`docker stop` envoie `SIGTERM`. Le serveur :

1. **refuse** les nouvelles connexions et créations de salon (`/healthz` répond `503`) ;
2. **annonce** à chaque client `{"t":"shutdown","inMs":…}` : le client affiche « le serveur redémarre pour une mise à jour dans N s » ;
3. **attend** que tout le monde soit parti, au plus `SHUTDOWN_GRACE_SEC` (30 s par défaut) ; les manches continuent normalement pendant ce temps ;
4. **ferme** les connexions restantes avec le code **1012** (« Service Restart »), écrit les enregistrements éventuels et sort avec le code 0.

Le client qui reçoit 1012 passe sur l'écran de maintenance et tente de reprendre sa place (jeton) pendant 90 s, avec un délai croissant. Les salons ne survivent pas au redémarrage : après une mise à jour, le jeton est inconnu et le joueur revient à l'accueil avec un message clair.

`docker stop` ne laisse que **10 s** par défaut : voir `DEPLOIEMENT.md` (§ délai d'arrêt) pour régler `SHUTDOWN_GRACE_SEC` en conséquence.

## 6. Construction

- **Client** : `vite build` (budget de 400 Ko gzip vérifié par `scripts/check-bundle.mjs`), puis `scripts/precompress.mjs` (brotli niveau 11 et gzip niveau 9 à côté de chaque fichier compressible).
- **Serveur** : `esbuild` produit **un seul fichier** (`packages/server/dist/index.js`) avec `ws` et `pino` embarqués : l'image finale n'a besoin d'aucune dépendance.
- **Image** (`deploy/Dockerfile`) : étape de construction (`node:22-alpine` avec les devDependencies), puis Alpine nu + binaire de Node allégé + `dist` du serveur et du client. Utilisateur `node`, `HEALTHCHECK` sur `/healthz`, `--max-old-space-size=320`.

## 7. Où regarder quand ça ne va pas

| Symptôme                       | Où                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Le site ne répond pas          | `games list` (état du conteneur), `games logs stickyclaude`, `curl http://stickyclaude:3000/healthz` depuis un autre conteneur |
| « Connexion perdue » en boucle | `Origin` refusé (journaux Caddy / `PUBLIC_ORIGIN`), `server busy` (plafonds), IP partagée (`TRUSTED_PROXY`)                    |
| Jeu saccadé pour tout le monde | `tick overrun` dans les journaux, `/metrics` (`tickMs`, `eventLoopDelayMs`, `cpu*`)                                            |
| Message « server full »        | `MAX_ROOMS`, `MAX_CONNECTIONS` ; les salons vides restent `ROOM_IDLE_TTL_SEC` (5 min)                                          |
