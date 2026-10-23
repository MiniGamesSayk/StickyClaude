# Prompt à donner à Claude Sonnet 5.5 : correctifs qualité (synchro, bugs, fluidité)

> Un seul prompt, à coller **en entier** dans une nouvelle session Claude Code ouverte sur ce dépôt (`MiniGamesSayk/StickyClaude`, branche `main`).
> Il vient de l'audit qualité du 2026-10-23 (6 audits du code + 1 audit du VPS). Les points marqués ✓ ont été revérifiés dans le code et sont toujours présents au commit `2e072b6` ; les autres sont à confirmer avant de corriger.

---

Tu es un ingénieur senior en jeux multijoueur temps réel (netcode, simulation, serveur Node, client navigateur). Tu travailles sur **StickyClaude**, un jeu de combat de stickmen en ligne (2 à 8 joueurs, WebSocket, Pixi v8, Preact), en production sur `https://stickyclaude.sayk.fr` dans un conteneur limité à 512 Mo et 1 CPU.

Ta mission : **corriger les bugs et défauts listés ci-dessous**, avec un test pour chacun, puis **pousser sur `main`**.

## Cadre

- Lis d'abord `docs/NETCODE.md`, `docs/DECISIONS.md` et `docs/ARCHITECTURE.md` en diagonale, puis le code concerné par chaque point. Les numéros de ligne datent de l'audit (commit `3f66483`) et ont bougé depuis (arsenal de 22 armes, lave, scie, trampoline…) : retrouve le code par son contenu. Pense aussi aux nouvelles armes et aux nouveaux objets : D1, D2 et D7 s'appliquent sans doute à eux.
- **Vérifie chaque bug avant de le corriger.** Écris d'abord un test qui échoue (Vitest, dans le `test/` du package concerné), puis corrige, puis vérifie qu'il passe. Si un point se révèle faux ou voulu, ne le corrige pas : note-le dans ton compte rendu avec la preuve.
- **`packages/sim` reste pur** : il dépend seulement de `shared` et n'a ni E/S, ni DOM, ni horloge système, ni `Math.random`. Il n'alloue rien dans `step` et reste **déterministe** (même hash client/serveur). Tout nouveau champ d'état qui influe sur la passe 1 doit entrer dans le hash (`sim/src/state.ts`).
- Ne change **pas le format binaire** du protocole sans bumper `PROTOCOL_VERSION` (`shared/src/constants.ts`) et mettre à jour `docs/NETCODE.md`. Évite de le changer tout court si une autre solution existe.
- Écris du code qui ressemble au code autour : même densité de commentaires, même langue de commentaires (le français), même nommage. Pas de dépendance nouvelle.
- Corrige au plus juste : pas de refactor opportuniste, pas de reformatage de fichiers entiers.
- **Workflow git** : travaille directement sur `main` (`git pull` d'abord). Fais **un commit par lot** (A, B, C, D, F ci-dessous), au format des commits existants (`fix(serveur): …`, `fix(client): …`, `fix(sim): …`, `docs: …`). `npm run check` (lint + types + tests + audio) doit être **vert avant chaque commit**. Pousse sur `origin main` à la fin de chaque lot vert. Ne pousse jamais un `check` rouge, n'utilise jamais `--force`, et ne crée pas de pull request.
- **Ne touche pas au VPS** : pas de SSH, pas de `games update`, pas de déploiement. Le lot E se limite à de la documentation.
- Ne modifie aucun autre dépôt du dossier parent.

## Lot A : robustesse serveur (`packages/server`)

1. ✓ **Une exception tue tous les salons.** `gameServer.ts` `tick()` (~l.483) appelle `room.tick(nowMs)` sans protection, et `main.ts:11-18` fait `process.exit(1)` sur `uncaughtException`. `writeRecording` (`httpServer.ts:89`, `writeFileSync` synchrone) est appelé par `onRoomClosed`, donc depuis la boucle.
   → Entoure `room.tick` d'un `try/catch` qui journalise (`level: 'error'`, code du salon, pile) et ferme **seulement ce salon** (les clients reçoivent un code 1011). Fais de même dans `onMessage`/`onControl` (fermer la connexion fautive en 1011, pas le process). Entoure `writeRecording` d'un `try/catch` qui journalise.
   → Test : un salon dont `tick` lève ne bloque pas les autres salons, qui continuent d'avancer.
2. ✓ **Salon gelé quand tous les joueurs sont rétrogradés.** `room.ts` `demote()` (~l.895), appelé par `stepMembers` (~l.988) quand le joueur est inactif depuis `IDLE_PLAYING_MS` (60 s), peut rétrograder le dernier joueur. Ensuite `playerCount === 0` et `gameServer.tick` saute le salon : plus de fin de manche.
   → Ne jamais rétrograder le dernier joueur actif (`if (this.playerCount <= 1) return;`, à confirmer avec la logique de fin de manche par forfait). Vérifie aussi que `demote` respecte `MAX_SPECTATORS`.
   → Test : 2 joueurs inactifs 61 s en combat, le salon continue d'avancer et la manche se termine.
3. ✓ **Reprise refusée tant que le serveur garde l'ancienne socket.** `gameServer.ts` (~l.433) répond `bad_token` si `m.client` est encore attaché. Le serveur ne voit l'ancienne socket morte qu'après 3 pings manqués (30 à 40 s), alors que la grâce de reconnexion est de 20 s.
   → Dans le chemin de reprise, si le jeton est valide et que `m.client` existe encore, évince l'ancienne connexion (`old.member = null; m.client = null;` puis fermeture en `4000, 'replaced'`) et poursuis la reprise. Le jeton seul authentifie déjà.
   → Test : reprise avec l'ancienne socket encore ouverte, qui réussit.
4. ✓ **Les sockets hors salon ne sont jamais fermées par le serveur.** Après `left` (`room.ts:347-351`), la connexion reste ouverte et compte dans `MAX_CONNECTIONS` (120 en prod) et `MAX_CONN_PER_IP` (40). Voir aussi B1, côté client.
   → Ferme une connexion restée sans `member` au-delà d'un délai raisonnable (par exemple 60 s, constante nommée), dans `housekeeping`. Ne casse pas le flux normal : se connecter, consulter la liste publique, puis créer ou rejoindre un salon.
   → Test : une connexion sans salon depuis plus de 60 s est fermée, et une connexion qui rejoint dans les temps ne l'est pas.
5. ✓ **`invalidCount` jamais remis à zéro** (`client.ts:72`, `gameServer.ts:521`) : 20 messages invalides sur toute une session ferment la connexion en 1008.
   → Fenêtre glissante (par exemple 20 par minute), en réutilisant le limiteur existant si possible.
6. ✓ **Salon de spectateurs seuls fermé comme vide.** `housekeeping` (~l.497) teste `playerCount === 0` alors qu'ailleurs on utilise `isEmpty`. → Utilise `isEmpty`.
7. **Diffusion du lobby non limitée.** `flushLobby` (`room.ts` ~l.440) est appelé directement par `setReady`, `setLook`, `setSettings`, `setTeams`, `castVote`, ce qui contourne le throttle de 500 ms du tick.
   → Les setters appellent `markLobby()` seulement, et le tick flushe avec le throttle. Garde un flush immédiat quand l'UX l'exige (début de décompte) et justifie-le en commentaire.
8. **`lastActiveAt` non mis à jour par les réglages de l'hôte** : un hôte qui configure son salon pendant 10 min est éjecté pour inactivité. → Mets-le à jour dans les setters de contrôle.
9. **`closeConn` rappelé en boucle** (`room.ts` ~l.1120, `gameServer.ts` ~l.519) sur une connexion déjà en fermeture, ce qui crée une minuterie à chaque fois. → Drapeau `closing` sur la connexion.

## Lot B : netcode client (`packages/client/src/net`, `app/online.ts`)

1. ✓ **La WebSocket n'est jamais fermée en quittant un salon.** `online.ts` `backToMenu()` (~l.406) fait `this.client = null` sans `close()`. Chaque cycle quitter/rejoindre laisse une socket et ses handlers.
   → `const old = this.client; this.client = null; old?.close();`. C'est sûr car les callbacks sont gardés par `this.client !== c`. Vérifie aussi `cancelResume` et `OnlineSource.dispose` (jamais appelé).
2. **Pas de détection de socket à moitié ouverte.** Après une bascule Wi-Fi/4G, `onclose` peut mettre des minutes à arriver, et le jeu reste figé.
   → Mémorise `lastPongAt` dans `onPong` (`client.ts` ~l.586). Dans `update`, si l'état est `joined`, que `now − lastPongAt > 6000` et que l'image courante n'est pas une reprise après onglet masqué (`frameMs < 1000`), ferme le transport pour déclencher la reconnexion existante.
3. **Reconnexion fragile.** (a) Une erreur de reprise autre que `bad_token` (par exemple `rate_limited`) laisse l'overlay affiché indéfiniment. (b) La première tentative part immédiatement (`online.ts` ~l.383).
   → Sur erreur pendant une reconnexion : ferme ce socket et appelle `scheduleResume()` tant que la grâce n'est pas écoulée. Attends environ 400 ms avant la première tentative. Avec A3, `bad_token` ne doit plus arriver pour une simple socket fantôme.
4. ✓ **Saut de rattrapage inachevé** (`client.ts` ~l.750) : `target = target - 1 + 1;` ne fait rien. `jumpTo` avance le tick sans simuler, et la prédiction reste figée jusqu'à une grosse correction, avec une téléportation visible.
   → Mémorise le dernier `snap.own` reçu et redémarre la prédiction dessus (`pred.start(...)` ou équivalent) au lieu d'un saut à l'aveugle. Supprime la ligne no-op.
5. **Rejeu sans contrôle de l'historique** (`predictor.ts` ~l.249) : la boucle de rejeu lit `hist[t & MASK].mask` sans vérifier `.tick === t`. → Si un slot de la plage n'est pas valide, renvoie `Skipped` (ou resynchronise, voir B6) au lieu de rejouer des masques périmés.
6. **Plus aucune correction quand l'écart dépasse l'historique** (`predictor.ts` ~l.229, `PREDICTION_HISTORY = 128`). Avec un RTT de 1,6 à 2 s, chaque snapshot est ignoré jusqu'à la fin de la manche.
   → Extrais la branche `Resynced` en méthode `resyncFrom(tick, own, game)` et appelle-la quand un snapshot est plus vieux que l'historique.
   → Test : convergence sous un lag simulé de 2 s.
7. **Interpolation sur l'OWD brut** (`client.ts` ~l.872) alors que la prédiction utilise `owdUsed`, qui est lissé : le temps de rendu des autres joueurs saute à chaque pong. → Utilise `owdUsed`.
8. **Slot d'interpolation non réinitialisé** (`client.ts` ~l.877-928) : `keptValid[s]` n'est pas remis à 0 quand le joueur disparaît, donc il glisse depuis son ancienne position à la réapparition.
9. **Snapshot rejeté qui écrase le tampon** (`interpolation.ts` ~l.99-110) : `next()` réserve le slot avant de savoir si le snapshot est valide. → Lis le tick dans l'en-tête et rejette avant de réserver le slot.
10. **DecodeError avalée en silence** (`client.ts` ~l.455). → Compte les échecs consécutifs ; au-delà d'un seuil (par exemple 30), affiche le message existant de désynchro/rechargement. Côté serveur, vérifie `Number.isFinite` avant d'écrire un f32 dans le snapshot.
11. **Version de protocole non vérifiée sur `joined`** : le client ne lit jamais `joined.v`. → Si la version diffère, affiche « Nouvelle version, recharge la page » (réutilise `msg.server_restarted` ou ajoute une clé FR/EN).
12. `sendBuf.slice(0, n)` alloue jusqu'à 60 fois par seconde (`client.ts` ~l.781-821) → `subarray`, si le transport copie bien de façon synchrone (vérifie `LagTransport`).

## Lot C : entrées, UI et fluidité (`packages/client`)

1. ✓ **Touche collée après pause, options ou saisie.** `input/keyboard.ts` (~l.122) : `if (!this.enabled) return;` est placé avant le traitement du keyup, donc une touche relâchée pendant la pause reste dans `held`.
   → Traite toujours les keyup (effacer le bit) avant les gardes `enabled` et focus. Remets aussi `held` à zéro quand `enabled` repasse à `true`.
   → Test unitaire sur la classe clavier.
2. **Attaque collée si le clic est relâché hors du canvas** (`keyboard.ts` ~l.129) : le `pointerup` est filtré sur `HTMLCanvasElement`. → Filtre la cible seulement sur `pointerdown`.
3. ✓ **Le plafond « 30 FPS » fait tomber la qualité auto en « basse »**, sans charge réelle. `render/quality.ts` compare à `FPS_THRESHOLD = 50`, et `renderer.ts` ~l.437 appelle `quality.frame(rawDt)`.
   → Passe le plafond à `frame(dtMs, cap)` et utilise `cap > 0 ? Math.min(FPS_THRESHOLD, cap * 0.9) : FPS_THRESHOLD`.
4. **Double envoi.** `ui/Home.tsx` : `join` ne teste pas `busy`, et Entrée ne filtre pas `e.repeat` (~l.128-182). `ui/Lobby.tsx` : « Lancer » et « Prêt » n'ont pas d'état d'envoi (~l.164-173). → Gardes `busy || e.repeat` et `disabled` pendant l'attente.
5. **Rejoindre un salon plein** (`Home.tsx` ~l.216) : désactive le bouton quand `players >= maxPlayers`.
6. **Taps rapides perdus à la manette** (`input/gamepad.ts` ~l.99-107) : un front montant doit être accepté immédiatement ; le délai de 350 ms ne s'applique qu'à la répétition. `void playEffect(...)` (~l.117) : ajoute un `.catch`.
7. **Peinture fantôme dans le créateur** (`ui/Creator.tsx` ~l.544 et 748) : `if (e.buttons === 0) { painting.current = false; return; }` en tête de `onMove`, et `onLostPointerCapture`/`onPointerCancel` branchés sur `onUp`. Le bouton « Auto spawns » (~l.790) ne doit s'appliquer que si le brouillon n'a pas changé entre-temps.
8. **Écouteurs tactiles** : `TouchControls.tsx`, réinitialise les bits au démontage (`useEffect(() => resetTouch, [])`). Le libellé du joystick est `touch.jump` (~l.77) → ajoute une clé « Déplacer / viser » en FR et EN. Taille tactile minimale de 44 px pour `.tsmall .btn` et les boutons ramasser/dash (`style.css` ~l.365 et 1129).
9. **Resize et DPR** (`render/renderer.ts` ~l.438) : au resize, appelle `applyQuality()` pour recalculer la résolution, au lieu de `layout()` + `configureTerrain()` seuls.
10. **Mélange ancien/nouveau terrain au changement d'arène** (`renderer.ts` ~l.328, `terrainLayer.ts`) : masque le calque terrain (`alpha = 0`) tant que `pending > 0` quand `animate` est faux.
11. **Traînées de projectiles qui écrasent les étincelles d'impact** (`renderer.ts` ~l.1086, `fx.ts`) : émets-les sur un accumulateur de 1/60 s, indépendamment du FPS, ou dans un pool séparé.
12. **Audio** (`audio/engine.ts`) : en tête de `play()`, `if (ctx.state !== 'running') void ctx.resume();`. Mémorise la promesse de `preload()` pour ne pas la relancer à chaque frappe. Ajoute `src.onended = () => { src.disconnect(); gain.disconnect(); pan?.disconnect(); }` (hygiène du graphe audio).
13. Hover collé sur tactile : enveloppe l'animation `.btn:hover` (`style.css` ~l.371) dans `@media (hover: hover)`.

## Lot D : gameplay (`packages/sim`) — attention au déterminisme

1. ✓ **Les objets sont frappés à chaque tick actif d'une attaque.** `combat.ts` ~l.497-506 : contrairement aux joueurs (`hitMask`), aucune mémoire par attaque. Un coup accroupi casse une caisse de 20 PV en un seul appui, et `kickBall` réécrit la vitesse du ballon à chaque tick.
   → Ajoute un identifiant de swing par joueur, incrémenté au début de la phase active, et un tampon par objet (ou un masque de slots par objet). Chaque objet n'est touché qu'une fois par swing. Ajoute ce champ au hash s'il influe sur la passe 1.
   → Test : un seul appui sur une caisse inflige exactement un coup.
2. **La gomme** (`projectiles.ts` ~l.203-211) traverse les objets en les touchant à chaque tick, et touche aussi le joueur caché derrière. → Même marqueur qu'en D1, et un objet plus proche que le joueur bloque le coup sur le joueur.
3. ✓ **Manche de ballon sans fin si le ballon n'existe pas** (`game.ts` ~l.546) : le `return` intervient avant le contrôle `roundTick >= ballMaxTicks`. → Fais le contrôle du temps avant ce `return`, et réserve le slot du ballon avant de créer les props (`objects.ts` ~l.82, `MAX_OBJECTS = 32`).
4. **Score du mode ballon avec 3 ou 4 équipes** (`game.ts` ~l.317 `team & 1`, ~l.574-591) : vérifie qui marque. Si plusieurs équipes ou tous les joueurs d'un camp en FFA marquent pour un seul but, corrige-le pour qu'un but rapporte au camp concerné. Si c'est voulu, documente-le dans `DECISIONS.md`.
5. **Hash de déterminisme incomplet** (`state.ts` ~l.266-359) : ajoute les champs qui influencent la simulation (flaques, `team`, `side`, `inMatch`, `marks`…). Ne mets pas les stats d'affichage pur.
6. **Événements tronqués sans signal** (`world.ts` ~l.697, maximum 128) : ajoute au moins un compteur de dépassement visible dans les métriques serveur, et un test qui le déclenche.
7. **`removePlayer` laisse les mines et projectiles du slot** (`spawn.ts` ~l.142) : un nouvel occupant du slot en hérite. → Désactive-les ou remets leur propriétaire à -1.
8. **L'explosion de la patate est créditée au porteur mort** (`game.ts` ~l.656) → `killer = -1`.
9. **Schéma d'arène** (`shared/src/schemas.ts` ~l.10-16, 43) : coordonnées en `max(GRID_W - 1)`/`max(GRID_H - 1)` (off-by-one), `period` des plateformes mobiles avec un minimum (par exemple `.min(1)` seconde). Vérifie que les 10 arènes livrées passent toujours.

## Lot E : infrastructure (documentation uniquement, ne rien appliquer)

Ajoute dans `docs/DEPLOIEMENT.md` une section « Correctifs VPS proposés (audit du 2026-10-23) », **à appliquer par l'utilisateur** :

- **502 à chaque `games update`** : 27 erreurs Caddy `connection refused` ou `lookup stickyclaude: i/o timeout` aux heures de déploiement. Bloc à mettre dans le **template du générateur `games`** (le Caddyfile est généré, ne pas le modifier à la main) :
  ```
  reverse_proxy stickyclaude:3000 {
      lb_try_duration 8s
      lb_try_interval 250ms
      health_uri /healthz
      health_interval 5s
      stream_close_delay 5m
  }
  ```
- **TCP** (`/etc/sysctl.d/90-realtime.conf`, avec sudo) : `net.core.default_qdisc=fq`, `net.ipv4.tcp_congestion_control=bbr`, `net.ipv4.tcp_slow_start_after_idle=0`, `net.ipv4.tcp_notsent_lowat=16384`. Vérifier d'abord que `bbr` figure dans `tcp_available_congestion_control`.
- **Disque** : `docker builder prune` (environ 24 Go de cache récupérable). Mise à jour Docker en attente, à faire hors heures de jeu.
- **CLAUDE.md du serveur périmé** : il mentionne Debian 12 et `apps/goldmine ./update.sh` ; la machine est en Debian 13 et les jeux sont gérés par `games`.

## Lot F : documentation et cohérence

1. **`docs/NETCODE.md`** :
   - Table du masque d'entrée : la visée est aux bits 8-11 avec le drapeau au bit 12, le dash au bit 13 et le retard aux bits 14-15.
   - `maxPayload` est à 8192 dans le code, pas 1024.
   - Recalcule la taille des snapshots.
   - Compensation de latence plafonnée à **12 ticks** (2 bits × 4), alors que la doc et `DECISIONS.md` D26 annoncent 15 ticks / 250 ms. Choisis : soit aligner la doc sur 12, soit passer `REWIND_STEP` à 5. Ce second choix touche le format des enregistrements : à justifier dans `DECISIONS.md`.
2. **`DECISIONS.md`** : taille de l'état propre (69 octets dans la doc, 71 dans le code), cooldown des emotes (1/s dans la doc, 3000 ms dans le code).
3. **`.env.example`** : le commentaire de `SHUTDOWN_GRACE_SEC` (8) contredit la valeur (30) et la prod (30, avec `stop_grace_period` à 35 s). Aligne-le sur 30.
4. **`SNAPSHOT_HZ`** : une valeur qui ne divise pas 60 annonce une fréquence fausse au client. Limite `config.ts` à 10, 12, 15, 20, 30 et 60, ou annonce la fréquence réelle (`60 / intervalle`).
5. Ajoute une entrée dans `DECISIONS.md` pour chaque choix non trivial fait pendant ces correctifs.

## Vérification finale

1. `npm run check` vert.
2. `npm run build`, puis `npm run e2e` (Chromium : `/usr/bin/chromium`). Pour les relances locales répétées, lance le serveur avec `CREATE_PER_MIN=1000 MAX_CONN_PER_IP=1000`. Pour tuer le serveur, utilise `fuser -k 3000/tcp`, jamais `pkill -f`.
3. `npm run loadtest` : compare le p99 du tick et la bande passante par client avec les valeurs de `docs/DEPLOIEMENT.md`. Aucune régression n'est acceptée.
4. Test manuel de non-régression avec `?lag=150&jitter=30&loss=2` sur 2 onglets :
   - quitter puis rejoindre 5 fois (le nombre de connexions dans `/metrics` doit rester stable) ;
   - mettre en pause en maintenant une touche ;
   - couper le réseau 10 s puis le rétablir (le joueur reprend sans retour au menu) ;
   - frapper une caisse.

## Compte rendu attendu

Pour chaque point (A1 à F5) : **corrigé** (commit, test ajouté), **non reproduit ou voulu** (preuve), ou **reporté** (raison). Ajoute ensuite les chiffres du loadtest avant/après, les décisions prises et les questions ouvertes. Rappelle enfin que le déploiement (`games update stickyclaude`) et le lot E restent à faire par l'utilisateur.
