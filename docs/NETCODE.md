# StickyClaude : netcode

Ce document décrit le protocole réseau **tel qu'il est implémenté** (phase 1) : le flux, les formats binaires octet par octet, les délais et le comportement en cas de perte. Source de vérité du modèle : `docs/ANALYSE.md` §2.4. Les choix qui s'en écartent sont dans `docs/DECISIONS.md`.

## 1. Principes

- **Serveur autoritaire.** Le client n'envoie que des _entrées_ (un masque de touches). Aucun message ne fixe une position, des PV ou des dégâts.
- **Une seule simulation.** Serveur et client appellent la même fonction `step(world, inputs)` (`packages/sim`), à **60 Hz** fixes. Elle est pure et déterministe (pas d'horloge, pas de `Math.random`, aucune allocation).
- **Entrées étiquetées par tick.** Chaque entrée porte le numéro du tick serveur où elle doit s'exécuter. Le client se cale sur l'horloge du serveur et vise un tick _légèrement dans le futur_ : l'entrée arrive juste avant d'être consommée. Le serveur n'a pas de file d'attente à vider ni de décalage à rattraper.
- **Prédiction + réconciliation.** Le client simule son propre stickman avec la même fonction et ses entrées (réponse immédiate). À chaque snapshot, il compare sa prédiction à l'état du serveur ; en cas d'écart il restaure l'état exact du serveur et rejoue ses entrées.
- **Interpolation.** Les autres joueurs sont affichés dans le passé (latence + 100 à 300 ms), interpolés entre deux snapshots.
- **WebSocket (TCP), messages binaires**, `permessage-deflate` désactivé. Les messages de salon sont en JSON validé par zod ; les messages de jeu sont binaires.

## 2. Flux

```
   CLIENT                                                  SERVEUR (boucle unique, 60 Hz)
   ──────                                                  ──────────────────────────────
   create/join (JSON) ────────────────────────────────────► salon, emplacement, point d'apparition
                      ◄──────────────────────────────────── joined (JSON : slot, arène, graine, tick…)
   PING (5 o) ────────────────────────────────────────────► (6 pings à 80 ms, puis toutes les 2 s)
                      ◄──────────────────────────────────── PONG (10 o : écho, tick + fraction)
        │ horloge synchronisée après 3 pongs
        ▼
   à chaque image : tick visé = tick serveur estimé
                    + latence aller + avance (≈ 2 ticks) + durée d'image
   simule les ticks dus avec ses touches (même step)
   INPUT (9 à 15 o) ──────────────────────────────────────► anneau d'entrées par joueur, par étiquette
     tick, ack, interp,                                     tick T : entrée étiquetée T, sinon répétée
     4 entrées (redondance)                                 step(world) puis, à 30 Hz par client :
                      ◄──────────────────────────────────── SNAPSHOT (≈ 175 o)
                                                              état de tous les joueurs + état exact du
                                                              destinataire + événements fiables non acquittés
   compare snapshot.own au tick S de son historique
     identique → rien
     différent → restaure l'état serveur, rejoue S+1…
   interpole les autres joueurs à (maintenant − latence − tampon)
```

### Le tick comme référence de temps

`world.tick` est le nombre de pas déjà simulés. Une entrée d'étiquette `L` est consommée par le pas qui fait passer le monde de `L-1` à `L`. Le snapshot du tick `S` contient l'état _après_ ce pas ; un client compare donc son état prédit après avoir appliqué l'entrée `S`.

Les plateformes mobiles sont une fonction pure du tick (voir `moverPosition`) : pour qu'elles concordent, le client doit exécuter l'entrée `L` _avec `world.tick = L`_. C'est la raison d'être des entrées étiquetées plutôt que numérotées.

### Marge et avance adaptative

Le serveur mesure, pour chaque client, l'**avance de la dernière entrée reçue** : `marge = étiquette − (world.tick + 1)`. `0` = juste à temps, négatif = en retard (entrée jetée). Il renvoie la plus petite marge observée depuis le dernier snapshot (`margin`, i8 ; 127 = aucune mesure).

Le client garde cette marge entre **1 et 4 ticks** (cible 2) :

| Marge reçue           | Action                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `< 1` (en retard)     | avance `+= min(1, 2 − marge)` ticks, par snapshot (hausse plafonnée : une rafale de retard TCP ne la fait pas exploser) |
| `> 4` (trop d'avance) | avance `−= 0,25` tick, au plus toutes les 100 ms                                                                        |
| 1 à 4                 | rien                                                                                                                    |

L'avance est bornée à `[1, 30]` ticks. S'ajoute la **durée moyenne d'une image** (en ticks, au plus 8) : à 10 images/s, un tour de boucle simule 6 ticks d'un coup et le plus ancien doit lui aussi arriver à temps.

### Horloge

`serverMs = localMs + offset`, avec `serverMs = (tick + fraction) × 16,667 ms`. Pour chaque pong : `rtt` mesuré avec l'horloge locale, `échantillon = serverMs_du_pong − (maintenant − rtt/2)`. On retient l'échantillon au **RTT le plus faible** des 8 derniers ; `offset` glisse vers lui (au plus 10 % de l'écart, 0,5 ms minimum par pong) pour ne jamais faire sauter l'affichage. Le RTT affiché est la **médiane** de la fenêtre (un pong très en retard ne la fausse pas). L'horloge n'est déclarée synchronisée qu'après **3 pongs**.

Le client n'a besoin d'aucune hypothèse sur son horloge locale (décalage quelconque, dérive de 200 ppm : testés).

## 3. Formats binaires

Tout est en **little-endian**. Le premier octet est toujours le type. Client → serveur : types 1 à 15. Serveur → client : types 16 à 31. Les codecs sont dans `packages/shared/src/codec/` ; chaque décodeur vérifie les bornes (lecture hors limites, compteurs, octets en trop) et lève `DecodeError`.

### Masque d'entrées (u16)

| Bit  | Valeur | Action                                  |
| ---- | ------ | --------------------------------------- |
| 0    | `0x01` | gauche                                  |
| 1    | `0x02` | droite                                  |
| 2    | `0x04` | haut (visée, sans effet en phase 1)     |
| 3    | `0x08` | bas (accroupi, chute rapide, traversée) |
| 4    | `0x10` | saut                                    |
| 5    | `0x20` | attaque (phase 2)                       |
| 6    | `0x40` | parade (phase 2)                        |
| 7    | `0x80` | ramasser / lancer (phase 2)             |
| 8–15 |        | réservés (emotes, curseur fantôme…)     |

### `INPUT` (client → serveur) : 9 à 15 octets

| Offset | Type  | Champ    | Description                                                                               |
| ------ | ----- | -------- | ----------------------------------------------------------------------------------------- |
| 0      | u8    | type     | `1`                                                                                       |
| 1      | u16   | `tick`   | étiquette de l'entrée la plus récente (16 bits de poids faible)                           |
| 3      | u16   | `ack`    | dernier événement fiable appliqué (contigu)                                               |
| 5      | u8    | `interp` | retard d'interpolation courant, en pas de 4 ms (pour la compensation de latence, phase 2) |
| 6      | u8    | `count`  | nombre d'entrées, 1 à 4                                                                   |
| 7      | u16[] | `masks`  | `count` masques, du plus récent (`tick`) au plus ancien (`tick − count + 1`)              |

Le serveur reconstitue l'étiquette complète : la valeur 32 bits la plus proche de `world.tick + 1` dont les 16 bits de poids faible valent `tick`. Longueur exacte exigée : `7 + 2 × count`.

### `PING` (client → serveur) : 5 octets

| Offset | Type | Champ  | Description                       |
| ------ | ---- | ------ | --------------------------------- |
| 0      | u8   | type   | `2`                               |
| 1      | u32  | `time` | horloge locale en ms (modulo 2³²) |

### `PONG` (serveur → client) : 10 octets

| Offset | Type | Champ  | Description                                             |
| ------ | ---- | ------ | ------------------------------------------------------- |
| 0      | u8   | type   | `18`                                                    |
| 1      | u32  | `time` | écho de l'horloge client                                |
| 5      | u32  | `tick` | tick du salon au moment de la réponse                   |
| 9      | u8   | `frac` | fraction de tick écoulée depuis le dernier tick (1/256) |

### `SNAPSHOT` (serveur → client) : 9 + 17·n (+ 28) + événements

Un snapshot par client : l'en-tête, le bloc `own` et les événements lui sont propres.

| Offset | Type | Champ         | Description                                                                   |
| ------ | ---- | ------------- | ----------------------------------------------------------------------------- |
| 0      | u8   | type          | `17`                                                                          |
| 1      | u32  | `tick`        | tick simulé                                                                   |
| 5      | i8   | `margin`      | plus petite avance d'entrée depuis le dernier snapshot (ticks ; 127 = aucune) |
| 6      | u8   | `flags`       | bit 0 : bloc `own` présent ; autres bits : interdits                          |
| 7      | u8   | `playerCount` | 0 à 8                                                                         |
| 8      | u8   | `eventCount`  | 0 à 24                                                                        |
| 9      |      | joueurs       | `playerCount` × 17 octets                                                     |
| …      |      | `own`         | 28 octets si `flags & 1`                                                      |
| …      |      | événements    | `eventCount` × (4 + `len`) octets                                             |

**Joueur (17 octets).** Positions et vitesses quantifiées au **1/8 d'unité** (i16, soit ±4 095 unités ; la page fait 1 024 × 576).

| Offset | Type | Champ      | Description                                            |
| ------ | ---- | ---------- | ------------------------------------------------------ |
| 0      | u8   | `slot`     | emplacement 0 à 7                                      |
| 1      | u16  | `flags`    | voir ci-dessous                                        |
| 3      | i16  | `x`        | centre horizontal                                      |
| 5      | i16  | `y`        | pieds                                                  |
| 7      | i16  | `vx`       | vitesse horizontale (unités/s)                         |
| 9      | i16  | `vy`       | vitesse verticale                                      |
| 11     | u8   | `aim`      | direction de visée (0 = droite, 4 = gauche en phase 1) |
| 12     | u8   | `hp`       | points de vie                                          |
| 13     | u8   | `weapon`   | arme (phase 2)                                         |
| 14     | u8   | `ammo`     | munitions (phase 2)                                    |
| 15     | u8   | `anim`     | état de la machine à états (`PlayerState`)             |
| 16     | u8   | `animProg` | ticks passés dans l'état, plafonné à 255               |

Drapeaux de joueur (u16) : bit 0 vivant · 1 tourné à droite · 2 au sol · 3 accroupi · 4 glissade murale · 5 double saut utilisé · 6 en montée · 7 posé sur une plateforme mobile · bits 8 à 10 : indice de cette plateforme.

**Bloc `own` (28 octets).** L'état _exact_ de prédiction du destinataire : tout ce qui influence l'évolution future de sa simulation. Flottants 32 bits (l'arrondi vaut moins de 10⁻⁴ unité).

| Offset | Type | Champ         | Description                                                                                |
| ------ | ---- | ------------- | ------------------------------------------------------------------------------------------ |
| 0      | f32  | `x`           |                                                                                            |
| 4      | f32  | `y`           |                                                                                            |
| 8      | f32  | `vx`          |                                                                                            |
| 12     | f32  | `vy`          |                                                                                            |
| 16     | u8   | `flags`       | bit 0 au sol · 1 accroupi · 2 double saut disponible · 3 saut en cours · 4 tourné à droite |
| 17     | u8   | `coyote`      | ticks de coyote time restants                                                              |
| 18     | u8   | `jumpBuffer`  | ticks de mémoire du saut restants                                                          |
| 19     | u8   | `wallLock`    | ticks de blocage horizontal après un saut mural                                            |
| 20     | u8   | `wallCoyote`  | ticks de coyote time mural restants                                                        |
| 21     | u8   | `dropTimer`   | ticks de traversée d'une plateforme à sens unique restants                                 |
| 22     | i8   | `wallDir`     | dernier côté de mur touché (−1, 0, 1)                                                      |
| 23     | i8   | `groundMover` | indice de la plateforme mobile qui porte le joueur, −1 sinon                               |
| 24     | u16  | `prevInput`   | dernier masque appliqué (détection des fronts)                                             |
| 26     | u16  | `respawns`    | compteur de réapparitions (choix déterministe du point)                                    |

**Événement fiable (4 + `len` octets).**

| Offset | Type | Champ     | Description                                   |
| ------ | ---- | --------- | --------------------------------------------- |
| 0      | u16  | `id`      | identifiant, croissant, avec retour à zéro    |
| 2      | u8   | `type`    | `1` SPAWN, `2` FELL                           |
| 3      | u8   | `len`     | longueur de la charge utile (0 à 16)          |
| 4      | u8[] | `payload` | SPAWN et FELL : `u8 slot, i16 x, i16 y` (5 o) |

Taille typique avec 8 joueurs : 9 + 8 × 17 + 28 = **173 octets**, soit **5,2 Ko/s** par client à 30 Hz (mesuré : 5,1 Ko/s).

### Messages de contrôle (JSON, texte)

Client → serveur (validés par zod, longueurs bornées, énumérations strictes, 1 Ko maximum) :

| Message                                               | Effet                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `{"t":"create","v":1,"name":"…","arena":"test-flat"}` | crée un salon (`arena` facultatif)                             |
| `{"t":"join","v":1,"name":"…","code":"ABCDE"}`        | rejoint un salon                                               |
| `{"t":"leave"}`                                       | quitte le salon                                                |
| `{"t":"tune","k":"runSpeed","val":200}`               | réglage d'une constante de mouvement (`DEV_TOOLS=1` seulement) |

Serveur → client : `joined` (emplacement, code, hôte, arène, graine, fréquences, tick, dernier id d'événement fiable, liste des joueurs), `roster`, `error` (`version`, `bad_request`, `bad_name`, `not_found`, `full`, `server_full`, `rate_limited`, `already_joined`, `not_joined`, `forbidden`), `tune`, `left`. Types dans `packages/shared/src/messages.ts`.

## 4. Délais et paramètres

| Quoi                                  | Valeur                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Simulation                            | 60 Hz (16,667 ms), pas fixe                                                                                                                                                    |
| Entrées client → serveur              | 1 paquet par image qui simule ≥ 1 tick (jusqu'à 3 si plusieurs ticks d'un coup), 4 entrées chacun                                                                              |
| Snapshots serveur → client            | 30 Hz par client (`SNAPSHOT_HZ`, 20 à 60), **décalés d'un tick d'un client à l'autre** du salon                                                                                |
| Marge visée de l'entrée               | 1 à 4 ticks (cible 2), avance client adaptative de 1 à 30 ticks                                                                                                                |
| Fenêtre d'entrées acceptées           | de `world.tick + 1` à `+ 24` ticks ; anneau de 64 entrées par joueur                                                                                                           |
| Retard d'interpolation                | `max(100, 2 × 33 + 3 × gigue)` ms, borné à 300 ; glisse vers sa cible (+2 / −0,5 ms par snapshot)                                                                              |
| Délai visuel des autres joueurs       | demi-RTT + retard d'interpolation                                                                                                                                              |
| Extrapolation si le snapshot manque   | 6 ticks (100 ms) puis arrêt de l'image                                                                                                                                         |
| Lissage visuel d'une correction (soi) | décroissance exponentielle, τ = 40 ms + 2 ms par unité d'écart (une grosse correction glisse au lieu de sauter) ; écart limité à 4 cellules, le surplus est appliqué d'un coup |
| Lissage des autres joueurs            | zone morte de 4 unités, τ = 40 ms, saut direct au-delà de 96 unités                                                                                                            |
| Historique de prédiction              | 128 ticks (2,1 s)                                                                                                                                                              |
| Ping applicatif                       | 6 × à 80 ms, puis toutes les 2 s ; au plus 10 par seconde accepté                                                                                                              |
| Heartbeat WebSocket                   | ping toutes les 10 s, déconnexion après 3 pings sans réponse (`HEARTBEAT_MS`)                                                                                                  |
| Débit d'entrées toléré                | 70 paquets/s par client, le surplus est ignoré                                                                                                                                 |
| Taille maximale d'un message client   | 1 024 octets (`maxPayload` de `ws`)                                                                                                                                            |
| Messages invalides                    | 20 → déconnexion                                                                                                                                                               |
| Contre-pression                       | `bufferedAmount` > 64 Ko : snapshots sautés ; > 1 Mo : déconnexion                                                                                                             |

## 5. Pertes, retards et blocages

TCP ne perd pas de paquets : il les **retarde**, et bloque tout ce qui suit (blocage en tête de file). Le simulateur de lag du client reproduit exactement cela (voir §7).

**Entrées.**

- _Redondance_ : chaque paquet contient les 4 dernières entrées ; un paquet isolé retardé n'ôte rien.
- _Entrée en retard_ (étiquette déjà exécutée) : jetée. Le serveur **répète la dernière entrée** utilisée (les touches tenues restent tenues), et la marge négative remonte au client, qui augmente son avance.
- _Silence prolongé_ : au-delà de 20 ticks (333 ms) sans entrée, le serveur passe à l'entrée neutre (un joueur dont la connexion tombe ne court pas indéfiniment).
- _Après un blocage_ : une rafale d'entrées en retard arrive d'un coup ; elles sont ignorées, la correction de prédiction fait le reste.

**Snapshots.**

- Un snapshot perdu ou sauté n'est pas retransmis : le suivant contient l'état complet (pas de delta), l'interpolation continue entre ceux qui restent.
- Si le client ne reçoit rien pendant un moment, ses autres joueurs sont extrapolés 100 ms puis figés ; à la reprise, l'écart est rattrapé en quelques images (lissage) au lieu d'une téléportation.
- Les **événements fiables** (arrivée, chute) sont répétés dans chaque snapshot jusqu'à l'accusé de réception (`ack`) du client ; appliqués une seule fois, dans l'ordre. Un client en retard de plus de 120 événements est déconnecté (`desync`). Les snapshots sautés par contre-pression ne les perdent donc pas.

**Prédiction.** Quand le serveur a dû deviner une entrée (retard, répétition), l'état prédit diverge légèrement : la réconciliation corrige, de façon invisible dans la quasi-totalité des cas (voir §6).

## 6. Réconciliation

À la réception d'un snapshot de tick `S` avec bloc `own` :

1. Avant la première image de prédiction, ou tant que le client n'a pas rattrapé le serveur : il se contente de **suivre** l'état reçu.
2. Sinon, si `S` est dans l'historique (128 derniers ticks) : comparaison de `own` à l'état prédit au tick `S` (positions à 0,02 unité, vitesses à 0,05, tous les compteurs et drapeaux exactement).
3. **Identique** → rien. **Différent** → `setTick(S)`, restauration de l'état exact du serveur, puis **rejeu** des entrées enregistrées de `S + 1` au tick courant. La différence de position avant/après est ajoutée à un décalage visuel qui décroît en ≈ 100 ms.
4. Si le serveur est _en avance_ sur le client (`S` > tick prédit) : resynchronisation directe, comptée à part (devrait rester à 0).

Comme la simulation est déterministe et que `own` contient tout l'état qui influence le futur, **une prédiction dont les entrées sont arrivées à temps ne se corrige jamais** (vérifié : 0 correction sur 40 s à 0, 40, 150 et 300 ms de latence constante, avec 30 ms de gigue, et à 144 images/s ; au plus 1 à 30 images/s et 3 à 10 images/s).

Les corrections qui restent viennent des blocages TCP du flux d'entrées : pendant un blocage de 300 ms, le serveur répète la dernière entrée (puis passe au neutre après 20 ticks) pendant que le client continue de bouger ; quand le flux reprend, l'écart (jusqu'à ≈ 20 unités à 2 % de pertes) est résorbé par le lissage visuel.

## 7. Outils

- **Simulateur de réseau** : `?lag=150&jitter=30&loss=2`. `lag` = latence **aller-retour** ajoutée (moitié dans chaque sens), `jitter` = ± ms par sens, `loss` = % de messages « perdus ». L'ordre est conservé comme en TCP : un message perdu est retransmis après `max(200 ms, 2 × lag)` et retarde tous les suivants. Code : `packages/client/src/net/transport.ts`.
- **Graphe réseau** (`F3` ou `?debug=1`) : RTT, débit montant et descendant, corrections par seconde, retard d'interpolation, avance, tick prédit et estimé, marge, tampon, gigue. Le fantôme rouge est le dernier état confirmé par le serveur pour son propre stickman.
- **Panneau de réglage** (build de développement seulement, serveur lancé avec `DEV_TOOLS=1`, ce que fait `npm run dev`) : les 26 constantes de `packages/shared/src/movement.ts`, appliquées en direct à la salle entière.
- **Enregistrement / relecture** : avec `DEV_TOOLS=1` (ou `RECORD_DIR=dossier`), chaque salle enregistre ses entrées (changements de masque, arrivées, départs, réglages). `GET /dev/recording/CODE` renvoie le JSON. Relecture visuelle : `?replay=/dev/recording/CODE` (espace : pause, `[` et `]` : vitesse) ; relecture headless et vérification du hash : `npm run simulate -- --replay fichier.json`.
- **`npm run simulate`** : déterminisme sur 60 000 ticks (deux mondes, hash comparé tous les 1 000 ticks) et coût d'un pas.
- **`npm run loadtest`** : voir §8.
- **`node scripts/browser-check.mjs`** : N onglets Chromium dans le même salon avec réseau dégradé.

## 8. Mesures (phase 1)

Machine de développement (20 cœurs, Node 22), serveur épinglé sur **un seul cœur**.

**Simulation** (`npm run simulate`, 8 joueurs, 300 000 ticks) : **0,7 à 0,8 µs par pas** au p50, 1,3 µs au p99 (budget : 150 µs) ; variation du tas de 95 Ko sur 2,4 millions de pas-joueurs, c'est-à-dire aucune allocation dans `step`.

**Charge** (`npm run loadtest -- --rooms 25 --players 8 --duration 120`, 200 clients, 4 threads générateurs) :

| Mesure                                                         | Résultat                  | Budget (§2.8)     |
| -------------------------------------------------------------- | ------------------------- | ----------------- |
| Pas de simulation d'une salle (p50 / p99)                      | 0,009 ms / 0,029 ms       | < 0,15 / < 0,5 ms |
| Tick complet, 25 salles (p50 / p99)                            | 2,7 ms / 4,1 ms           | —                 |
| CPU du serveur (1 cœur)                                        | 47 %                      | < 60 %            |
| Tas JS / RSS                                                   | 26 Mo / 109 Mo            | < 250 Mo          |
| Retard de boucle d'événements (p99)                            | 3,0 ms                    | < 10 ms           |
| Débit descendant par client                                    | 5,1 Ko/s (30 snapshots/s) | < 20 Ko/s         |
| Dépassements de la boucle, snapshots sautés, entrées en retard | 0, 0, 0                   | 0                 |

Le profil (`--cpu-prof`) montre que le JavaScript du serveur est peu chargé (simulation + encodage + décodage < 3 % du temps échantillonné) : le CPU part dans les appels système réseau (`writev`, lectures), un par message avec `ws`. Les 12 000 paquets d'entrées par seconde (60 Hz × 200 clients) en sont la moitié environ ; passer à un paquet tous les 2 ticks (4 entrées, donc sans perte d'information) libérerait de la marge si la mesure en conteneur à 1 CPU (phase 4) l'exigeait.

**Réseau dégradé** (banc d'essai en temps virtuel : vrai serveur, vrais clients, salon de 8 joueurs sur l'arène `test-tower`, 40 s mesurées après 8 s de chauffe ; `packages/client/test/prediction.test.ts`). Un pas normal de l'affichage est de 3 u/image en course et jusqu'à 10 u/image en chute (60 images/s).

| Condition                                | Corrections par client et par seconde | Écart max d'une correction | Plus grand pas affiché, soi / autres |
| ---------------------------------------- | ------------------------------------- | -------------------------- | ------------------------------------ |
| Réseau parfait                           | 0                                     | —                          | 8,7 u / 8,2 u                        |
| 40, 150 et 300 ms constants              | 0                                     | —                          | 8,7 u / 8,1 u                        |
| 150 ms ± 30 ms de gigue                  | 0                                     | —                          | 9,5 u / 8,2 u                        |
| 150 ms ± 30 ms, **2 % de pertes**        | ≈ 2 (11 à 87 sur 40 s)                | 20 u                       | 25 u / 15 u                          |
| 300 ms ± 60 ms, 5 % de pertes (extrême)  | ≈ 7                                   | 21 u                       | 59 u / 32 u                          |
| 144 images/s, 150 ms ± 30 ms (4 joueurs) | 0                                     | —                          | 4,4 u / 4,1 u                        |
| 30 images/s, 150 ms ± 30 ms              | ≤ 0,03                                | 6 u                        | 15 u / 14 u (une image = 33 ms)      |
| 10 images/s, 150 ms ± 30 ms              | ≤ 0,07                                | 6 u                        | 38 u / 39 u (une image = 100 ms)     |

Sans le lissage d'affichage des autres joueurs, la reprise après un blocage TCP fait sauter un joueur distant de ≈ 45 u (près de 3 cellules) dans une même image ; avec, le plus grand saut est de 15 u à 2 % de pertes. Tous les clients **convergent** exactement vers l'état du serveur dès que les entrées cessent.

**Navigateur réel** (`scripts/browser-check.mjs`, Chromium headless en rendu logiciel, 8 onglets, `lag=150&jitter=30&loss=2`, 25 s) : aucune téléportation (> 1 500 u/s), aucune erreur de console, 0 resynchronisation, les 8 joueurs se voient tous.

## 9. Limites connues

- **Compensation de latence** (mêlée, tirs instantanés) : le champ `interp` est déjà transmis, mais l'historique de positions n'est pas encore exploité (phase 2).
- **Pas de collision entre joueurs** : voir `DECISIONS.md`. Elle rendrait la prédiction dépendante des autres joueurs.
- **Reconnexion** : une connexion perdue retire le joueur du salon (phase 2 : jeton et délai de 20 s).
- **Salles d'attente à 60 Hz** : l'optimisation « 30 Hz, 15 snapshots/s » de §2.5 est repoussée à la phase 2, quand les salons auront un état de partie.
- **Joueur distant sur une plateforme mobile** : il est recollé à la plateforme à l'écran (indice transmis dans `flags`), mais sa position reste celle d'un instant passé.
- `/metrics` n'est pas encore restreint au réseau interne (phase 4) ; protégé par `METRICS_TOKEN` si défini.
