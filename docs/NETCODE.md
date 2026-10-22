# StickyClaude : netcode

Ce document décrit le protocole réseau **tel qu'il est implémenté** (version 2, phase 2) : le flux, les formats binaires octet par octet, les messages de contrôle, les délais et le comportement en cas de perte. Source de vérité du modèle : `docs/ANALYSE.md` §2.4. Les choix qui s'en écartent sont dans `docs/DECISIONS.md`.

## 1. Principes

- **Serveur autoritaire.** Le client n'envoie que des _entrées_ (un masque de touches) et des intentions de salon. Aucun message ne fixe une position, des PV, des dégâts ou un score.
- **Une seule simulation, en deux passes.** Serveur et client appellent la même fonction `step(world, inputs)` (`packages/sim`), à **60 Hz** fixes, pure et déterministe (pas d'horloge, pas de `Math.random`, aucune allocation par pas).
  - **Passe 1** (tous les mondes) : mouvement et machine à états des actions de chaque joueur (enchaînement de coups, charge, parade, coup de pied, tir, lancer, munitions). Elle ne dépend que du joueur, de ses entrées et du décor : c'est ce que le client **prédit**.
  - **Passe 2** (`world.auth`, serveur seulement) : résolution des coups et des tirs, objets, projectiles, explosions, terrain, règles de manche et de partie. Le client la reçoit : PV, projections, étourdissements, ramassages et éliminations arrivent par le bloc « own » et les événements fiables.
- **Entrées étiquetées par tick.** Chaque entrée porte le numéro du tick serveur où elle doit s'exécuter. Le client se cale sur l'horloge du serveur et vise un tick _légèrement dans le futur_ : l'entrée arrive juste avant d'être consommée.
- **Prédiction + réconciliation.** Le client simule son propre stickman (mouvement, attaque, parade, charge, munitions) avec la même fonction. À chaque snapshot, il compare sa prédiction à l'état exact du serveur ; en cas d'écart il restaure cet état et rejoue ses entrées.
- **Interpolation.** Les autres joueurs, les objets et les projectiles sont affichés dans le passé (latence + 100 à 300 ms), interpolés entre deux snapshots.
- **Compensation de latence** de la mêlée et des tirs instantanés (§7).
- **WebSocket (TCP), messages binaires** pour le jeu, `permessage-deflate` désactivé. Les messages de salon sont en JSON validé par zod.

## 2. Flux

```
   CLIENT                                                  SERVEUR (boucle unique, 60 Hz)
   ──────                                                  ──────────────────────────────
   create / join / quick / resume (JSON) ─────────────────► salon, emplacement (ou spectateur)
                      ◄──────────────────────────────────── joined (JSON : slot, jeton, salon, manche, terrain)
   PING (5 o) ────────────────────────────────────────────► (6 pings à 80 ms, puis toutes les 2 s)
                      ◄──────────────────────────────────── PONG (10 o : écho, tick + fraction)
        │ horloge synchronisée après 3 pongs
        ▼
   à chaque image : tick visé = tick serveur estimé
                    + latence aller + avance (≈ 2 ticks) + durée d'image
   simule les ticks dus avec ses touches (même step, passe 1)
   INPUT (9 à 15 o) ──────────────────────────────────────► anneau d'entrées par joueur, par étiquette
     tick, ack, rewind,                                     tick T : entrée étiquetée T, sinon répétée
     4 entrées (redondance)                                 step(world) : passes 1 et 2, puis à 30 Hz par client :
                      ◄──────────────────────────────────── SNAPSHOT (≈ 280 o)
                                                              joueurs, objets, projectiles, état de partie,
                                                              état exact du destinataire (69 o), événements fiables
   compare snapshot.own et la phase de partie à son historique
     identique → rien
     différent → restaure l'état serveur, rejoue S+1…
   applique les événements fiables au terrain, joue les effets
   interpole les autres joueurs, les objets, les projectiles
                      ◄──────────────────────────────────── lobby / round / scores / results (JSON, au fil de la partie)
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

Tout est en **little-endian**. Le premier octet est toujours le type. Client → serveur : types 1 à 15. Serveur → client : types 16 à 31. Les codecs sont dans `packages/shared/src/codec/` ; chaque décodeur vérifie les bornes (lecture hors limites, compteurs, octets en trop, valeurs hors énumération) et lève `DecodeError`.

### Masque d'entrées (u16)

| Bit   | Valeur | Action                                                                         |
| ----- | ------ | ------------------------------------------------------------------------------ |
| 0     | `0x01` | gauche                                                                         |
| 1     | `0x02` | droite                                                                         |
| 2     | `0x04` | haut (visée)                                                                   |
| 3     | `0x08` | bas (accroupi, chute rapide, traversée, coup de pied, lâcher avec `ramasser`)  |
| 4     | `0x10` | saut                                                                           |
| 5     | `0x20` | attaque (maintenu : coup chargé ; tir en continu avec une arme à tir)          |
| 6     | `0x40` | parade                                                                         |
| 7     | `0x80` | ramasser / lancer                                                              |
| 8–11  |        | réservés                                                                       |
| 12–15 |        | retard de compensation de latence en ticks (0 à 15), **ajouté par le serveur** |

Le serveur ne lit que les 8 bits de poids faible d'un paquet (`INPUT_MASK_USED`) : un client ne peut pas se donner une compensation de latence qu'il n'a pas. Le curseur du fantôme-crayon utilise les mêmes bits (directions pour le déplacer, attaque pour poser un trait, parade pour une goutte d'encre).

### `INPUT` (client → serveur) : 9 à 15 octets

| Offset | Type  | Champ    | Description                                                                                            |
| ------ | ----- | -------- | ------------------------------------------------------------------------------------------------------ |
| 0      | u8    | type     | `1`                                                                                                    |
| 1      | u16   | `tick`   | étiquette de l'entrée la plus récente (16 bits de poids faible)                                        |
| 3      | u16   | `ack`    | dernier événement fiable appliqué (contigu)                                                            |
| 5      | u8    | `rewind` | durée entre l'entrée et ce que le joueur voit des autres, en pas de 4 ms (compensation de latence, §7) |
| 6      | u8    | `count`  | nombre d'entrées, 1 à 4                                                                                |
| 7      | u16[] | `masks`  | `count` masques, du plus récent (`tick`) au plus ancien (`tick − count + 1`)                           |

Le serveur reconstitue l'étiquette complète : la valeur 32 bits la plus proche de `world.tick + 1` dont les 16 bits de poids faible valent `tick`. Longueur exacte exigée : `7 + 2 × count`. Un spectateur envoie le même paquet (un masque nul, toutes les 100 ms) pour accuser les événements fiables : sans accusé, le serveur le déconnecte quand il a plus de 120 événements de retard.

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

### `SNAPSHOT` (serveur → client) : 17 + 18·J + 13·O + 13·P + 2·M (+ 69) + événements

Un snapshot par client : l'en-tête, le bloc `own`, les événements et la liste d'objets lui sont propres (les mines adverses armées sont invisibles : elles n'apparaissent pas dans la liste de leurs ennemis).

| Offset | Type  | Champ         | Description                                                                                                                                                                        |
| ------ | ----- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | u8    | type          | `17`                                                                                                                                                                               |
| 1      | u32   | `tick`        | tick simulé                                                                                                                                                                        |
| 5      | i8    | `margin`      | plus petite avance d'entrée depuis le dernier snapshot (ticks ; 127 = aucune)                                                                                                      |
| 6      | u8    | `flags`       | bit 0 : bloc `own` présent (joueur, pas spectateur) ; autres bits : interdits                                                                                                      |
| 7      | u8    | `playerCount` | J, 0 à 8                                                                                                                                                                           |
| 8      | u8    | `eventCount`  | 0 à 24                                                                                                                                                                             |
| 9      | u8    | `objectCount` | O, 0 à 32                                                                                                                                                                          |
| 10     | u8    | `projCount`   | P, 0 à 64                                                                                                                                                                          |
| 11     | u8    | `phase`       | `GamePhase` : 0 salon, 1 décompte, 2 combat, 3 fin de manche, 4 fin de partie                                                                                                      |
| 12     | u16   | `phaseTick`   | ticks depuis le début de la phase (plafonné à 65 535)                                                                                                                              |
| 14     | u8    | `round`       | numéro de manche                                                                                                                                                                   |
| 15     | u8    | `mode`        | `ModeId` de la manche (0 chacun pour soi, 1 équipes, 2 colline, 3 boulette-ball, 4 encre montante, 5 patate, 6 gravité lunaire, 7 même arme)                                       |
| 16     | u8    | `modeCount`   | M, 0 à 8 : nombre de valeurs de `modeData`                                                                                                                                         |
| 17     |       | joueurs       | J × 18 octets                                                                                                                                                                      |
| …      |       | objets        | O × 13 octets                                                                                                                                                                      |
| …      |       | projectiles   | P × 13 octets                                                                                                                                                                      |
| …      | u16[] | `modeData`    | M valeurs propres au mode (colline : temps tenu par équipe ; boulette-ball : buts des deux camps et délai de remise en jeu ; patate : porteur + 1, mèche, pause avant la suivante) |
| …      |       | `own`         | 69 octets si `flags & 1`                                                                                                                                                           |
| …      |       | événements    | `eventCount` × (4 + `len`) octets                                                                                                                                                  |

**Joueur (18 octets).** Positions et vitesses quantifiées au **1/8 d'unité** (i16, soit ±4 095 unités ; la page fait 1 024 × 576). Un fantôme-crayon est un joueur dont `anim` vaut `GHOST` et dont `x`, `y` sont ceux de son curseur.

| Offset | Type | Champ      | Description                                                                                                                             |
| ------ | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | u8   | `slot`     | emplacement 0 à 7                                                                                                                       |
| 1      | u16  | `flags`    | voir ci-dessous                                                                                                                         |
| 3      | i16  | `x`        | centre horizontal                                                                                                                       |
| 5      | i16  | `y`        | pieds                                                                                                                                   |
| 7      | i16  | `vx`       | vitesse horizontale (unités/s)                                                                                                          |
| 9      | i16  | `vy`       | vitesse verticale                                                                                                                       |
| 11     | u8   | `aim`      | direction de visée 0 à 7, dans le sens horaire depuis la droite                                                                         |
| 12     | u8   | `hp`       | points de vie (0 à 100)                                                                                                                 |
| 13     | u8   | `weapon`   | arme tenue (`WeaponId`, 0 = poings)                                                                                                     |
| 14     | u8   | `ammo`     | munitions (ou solidité du bouclier)                                                                                                     |
| 15     | u8   | `anim`     | état de la machine à états (`PlayerState` : repos, course, saut, chute, mur, accroupi, attaque, charge, parade, étourdi, mort, fantôme) |
| 16     | u8   | `animProg` | ticks passés dans l'état (attaque : dans la phase ; parade : depuis l'appui), plafonné à 255                                            |
| 17     | u8   | `variant`  | attaque : `AttackKind` (bits 0–3) et phase `AtkPhase` (bits 4–5) ; charge : ticks de charge                                             |

Drapeaux de joueur (u16) : bit 0 vivant · 1 tourné à droite · 2 au sol · 3 accroupi · 4 glissade murale · 5 double saut utilisé · 6 en montée · 7 posé sur une plateforme mobile · bits 8 à 10 : indice de cette plateforme · 11 vient d'être touché · 12 protégé après l'apparition · 13 porte la bombe · 14 bouclier levé · 15 réservé (une parade parfaite est annoncée par l'événement `BLOCKED`).

**Objet (13 octets).** `u16 uid, u8 type, i16 x, y, vx, vy, u8 a, u8 b`. `type` : 1 arme, 2 caisse, 3 ballon, 4 punaise, 5 mine, 6 boule. `x` est le centre, `y` le bas. `a` : arme (objet arme) ou points de vie (caisse, ballon) ; pour une mine, 1 si elle est armée. `b` : munitions (arme) ; équipe du propriétaire (mine). L'`uid` permet d'interpoler le même objet d'un snapshot à l'autre.

**Projectile (13 octets).** `u16 uid, u8 type, i16 x, y, vx, vy, u8 owner, u8 a`. `type` : 1 boulette, 2 avion en papier, 3 roquette, 4 gomme, 5 objet lancé. `x`, `y` sont le centre, `owner` le tireur (255 aucun), `a` l'arme d'origine.

**Bloc `own` (69 octets).** L'état _exact_ de prédiction du destinataire : tout ce qui influence l'évolution future de sa simulation. Flottants 32 bits (l'arrondi vaut moins de 10⁻⁴ unité). Ordre des champs (`OWN_FIELDS`, `packages/shared/src/codec/snapshot.ts`) :

| Octets | Type | Champs                                                                                                                                                                                                                                                                                                                               |
| ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0–31   | f32  | `x`, `y`, `vx`, `vy`, `grappleX`, `grappleY`, `ghostX`, `ghostY`                                                                                                                                                                                                                                                                     |
| 32–37  | u8   | `flags` (bit 0 au sol · 1 accroupi · 2 double saut disponible · 3 saut en cours · 4 tourné à droite), `coyote`, `jumpBuffer`, `wallLock`, `wallCoyote`, `dropTimer`                                                                                                                                                                  |
| 38–39  | i8   | `wallDir` (−1, 0, 1), `groundMover` (indice de plateforme mobile, −1 sinon)                                                                                                                                                                                                                                                          |
| 40–60  | u8   | `hp`, `weapon`, `ammo`, `stun`, `hitLock`, `invuln` (plafonné à 255), `atkPhase`, `atkKind`, `atkTicks`, `combo`, `comboWindow`, `chargeTicks`, `attackHeld`, `blockTicks`, `blockCd`, `atkBuffer`, `pickupCd`, `aim`, `grappleTicks`, `status` (bit 0 fantôme · 1 mort · 2 porte la bombe · 3 coup de pied plongeant), `stunImmune` |
| 61–68  | u16  | `prevInput`, `respawns`, `respawnTimer`, `ghostCd`                                                                                                                                                                                                                                                                                   |

**Événement fiable (4 + `len` octets).**

| Offset | Type | Champ     | Description                                                       |
| ------ | ---- | --------- | ----------------------------------------------------------------- |
| 0      | u16  | `id`      | identifiant, croissant, avec retour à zéro                        |
| 2      | u8   | `type`    | `SimEvent` (tableau ci-dessous)                                   |
| 3      | u8   | `len`     | longueur de la charge utile : `1 + 2 × arguments` (3 à 13 octets) |
| 4      | u8[] | `payload` | `u8 slot`, puis un entier de 16 bits par argument                 |

Chaque argument est `p` (position, i16 au 1/8 d'unité), `i` (i16) ou `u` (u16) ; le format de chaque type est dans `EVENT_SPECS` (`packages/shared/src/types.ts`) :

| Type | Nom            | `slot`  | Arguments                                                                                                |
| ---- | -------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| 5    | `SPAWN`        | joueur  | `p x`, `p y`                                                                                             |
| 8    | `HIT`          | victime | `p x`, `p y`, `i attaquant` (255 aucun), `i dégâts`, `i drapeaux` (1 fort · 2 paré · 4 mortel)           |
| 9    | `KO`           | victime | `p x`, `p y`, `i tueur` (255 aucun), `i cause` (`Cause`), `p vx`, `p vy`                                 |
| 10   | `BLOCKED`      | parant  | `p x`, `p y`, `i attaquant`, `i parfaite` (0/1)                                                          |
| 13   | `SHOT`         | tireur  | `p` bouche x y, `p` fin x y, `i arme`                                                                    |
| 14   | `PICKUP`       | —       | `i joueur`, `i arme`, `u uid`                                                                            |
| 15   | `THROW`        | —       | `i joueur`, `i arme`                                                                                     |
| 16   | `WEAPON_SPAWN` | —       | `p x`, `p y`, `i arme`, `u uid`                                                                          |
| 18   | `EXPLOSION`    | —       | `p x`, `p y`, `i rayon`, `i sorte` (0 roquette · 1 mine · 2 ballon · 3 patate · 4 caisse)                |
| 19   | `TERRAIN`      | —       | `i cellule x`, `i cellule y`, `i rayon en dixièmes de cellule`                                           |
| 20   | `EMOTE`        | joueur  | `i numéro`                                                                                               |
| 21   | `GHOST_DRAW`   | fantôme | `i sorte` (0 trait · 1 goutte), `i cellule x`, `i cellule y`, `u tick de pose` (poids faible, puis fort) |
| 22   | `PUDDLE`       | —       | `p x`, `p y`, `p largeur`, `u tick de pose` (poids faible, puis fort)                                    |
| 23   | `STAMP`        | —       | `p x`, `p y`                                                                                             |
| 24   | `GRAPPLE`      | joueur  | `p x`, `p y` d'ancrage, `i joueur attiré`                                                                |
| 25   | `CRATE_BREAK`  | —       | `p x`, `p y`                                                                                             |
| 28   | `GOAL`         | —       | `i camp`, `p x`, `p y`                                                                                   |
| 29   | `SUDDEN_DEATH` | —       | `i sorte` (0 encre · 1 déchirure)                                                                        |

Les événements de mouvement (`JUMP`, `DOUBLE_JUMP`, `WALL_JUMP`, `LAND`, `DROP_THROUGH`) et le début d'un coup (`SWING`) **ne sont jamais transmis** : le client les recalcule pour son propre joueur (sons et effets immédiats) ; ceux des autres se déduisent de leur état d'animation. `ROUND_START`, `ROUND_END` et `MATCH_END` restent dans le salon, qui les annonce en JSON.

Les événements qui **changent le monde** sont appliqués par le client à son propre monde dès leur réception, par les mêmes fonctions entières que le serveur : `TERRAIN` (`destroyCircle`), `GHOST_DRAW` (`placeMark` : l'expiration est `tick de pose + durée`, donc identique), `PUDDLE`. Les autres ne servent qu'aux effets : ils sont rejoués à l'écran quand le tick de leur snapshot est atteint par l'interpolation (≈ 100 à 300 ms après leur réception), pour rester synchrones avec ce que l'on voit des autres joueurs.

Taille typique à 8 joueurs en combat : 17 + 8 × 18 + 69 + une dizaine d'objets et de projectiles + 1 à 3 événements ≈ **280 octets**, soit **8,7 Ko/s** par client à 30 Hz avec les messages de salon (mesuré, §10). Maximum théorique : `SNAPSHOT_MAX_BYTES`.

### Messages de contrôle (JSON, texte)

Client → serveur (validés par zod : types stricts, longueurs bornées, énumérations, clés inconnues refusées, 1 Ko maximum, 20 messages par seconde) :

| Message                                                      | Effet                                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"t":"create","v":2,"name":"…","look":{…},"isPublic":true}` | crée un salon (`arena` : arène d'attente, `DEV_TOOLS=1` seulement)                                                                                   |
| `{"t":"join","v":2,"name":"…","look":{…},"code":"ABCDE"}`    | rejoint un salon (joueur en attente, spectateur en cours de partie)                                                                                  |
| `{"t":"quick","v":2,"name":"…","look":{…}}`                  | partie rapide : le salon public le plus rempli, sinon un nouveau                                                                                     |
| `{"t":"resume","v":2,"token":"…32 hex…","code":"ABCDE"}`     | reprend sa place avec le jeton (§8)                                                                                                                  |
| `{"t":"leave"}`                                              | quitte le salon                                                                                                                                      |
| `{"t":"ready","ready":true}`                                 | se déclare prêt (salon d'attente)                                                                                                                    |
| `{"t":"start"}`                                              | lance la partie (hôte ; au moins 2 joueurs, tous prêts)                                                                                              |
| `{"t":"settings","settings":{…}}`                            | réglages de l'hôte, partiels : mode, équipes, tir ami, manches, arènes, armes, mort subite, modes bonus, fréquence des bonus, fantômes, salon public |
| `{"t":"teams","assign":[…],"shuffle":true}`                  | équipes (hôte, mode équipes)                                                                                                                         |
| `{"t":"kick","slot":3}`                                      | expulse un joueur (hôte)                                                                                                                             |
| `{"t":"look","look":{…}}`                                    | change d'apparence : couleur, trait, chapeau, emote de victoire                                                                                      |
| `{"t":"emote","id":2}`                                       | emote prédéfinie (1 par seconde)                                                                                                                     |
| `{"t":"tune","k":"runSpeed","val":200}`                      | réglage d'une constante de mouvement (`DEV_TOOLS=1` seulement)                                                                                       |

Serveur → client (`packages/shared/src/messages.ts`) :

| Message    | Contenu                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `joined`   | emplacement (−1 : spectateur), identifiant, **jeton de reconnexion**, code, fréquences, tick, dernier événement fiable, `lobby`, `round` (avec le terrain courant)                                           |
| `lobby`    | joueurs (pseudo, apparence, prêt, équipe, connecté, ping), hôte, réglages, spectateurs, phase, lancement automatique, manche, scores                                                                         |
| `round`    | nouvelle manche ou retour au salon : arène, graine, mode, équipes, mort subite, règles, arme commune ; `ev` est le dernier événement émis, point de départ du client                                         |
| `scores`   | fin de manche : gagnant (équipe ou emplacement, −1 si personne), scores, dernière manche de la partie ou non                                                                                                 |
| `results`  | fin de partie : gagnant, podium, scores, équipes, statistiques (KO, morts, dégâts, plus long combo, mort la plus bête)                                                                                       |
| `error`    | `version`, `bad_request`, `bad_name`, `not_found`, `full`, `server_full`, `rate_limited`, `already_joined`, `not_joined`, `forbidden`, `not_host`, `not_enough_players`, `not_ready`, `in_game`, `bad_token` |
| `tune`     | constante de mouvement modifiée (dev)                                                                                                                                                                        |
| `left`     | `left`, `kicked`, `closed` ou `idle`                                                                                                                                                                         |
| `shutdown` | arrêt propre annoncé (mise à jour) : `{"t":"shutdown","inMs":8000}`, le serveur ferme les connexions restantes dans `inMs` ms avec le code 1012 (§8)                                                         |

`GET /api/rooms` renvoie la liste des salons publics : `{code, players, maxPlayers, spectators, mode, phase: 'lobby' | 'playing', host}`.

## 4. Délais et paramètres

| Quoi                                  | Valeur                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Simulation                            | 60 Hz (16,667 ms), pas fixe                                                                                                                                                    |
| Entrées client → serveur              | 1 paquet par image qui simule ≥ 1 tick (jusqu'à 3 si plusieurs ticks d'un coup), 4 entrées chacun                                                                              |
| Snapshots serveur → client            | 30 Hz par client (`SNAPSHOT_HZ`, 20 à 60), **décalés d'un tick d'un client à l'autre** du salon                                                                                |
| Marge visée de l'entrée               | 1 à 4 ticks (cible 2), avance client adaptative de 1 à 30 ticks                                                                                                                |
| Fenêtre d'entrées acceptées           | de `world.tick + 1` à `+ 24` ticks ; anneau de 64 entrées par joueur                                                                                                           |
| Compensation de latence               | historique de 16 ticks ; au plus 15 ticks (250 ms) remontés ; `rewind` = RTT + avance + interpolation                                                                          |
| Retard d'interpolation                | `max(100, 2 × 33 + 3 × gigue)` ms, borné à 300 ; glisse vers sa cible (+2 / −0,5 ms par snapshot)                                                                              |
| Délai visuel des autres joueurs       | demi-RTT + retard d'interpolation                                                                                                                                              |
| Extrapolation si le snapshot manque   | 6 ticks (100 ms) puis arrêt de l'image                                                                                                                                         |
| Lissage visuel d'une correction (soi) | décroissance exponentielle, τ = 40 ms + 2 ms par unité d'écart (une grosse correction glisse au lieu de sauter) ; écart limité à 4 cellules, le surplus est appliqué d'un coup |
| Lissage des autres joueurs            | zone morte de 4 unités, τ = 40 ms, saut direct au-delà de 96 unités                                                                                                            |
| Historique de prédiction              | 128 ticks (2,1 s)                                                                                                                                                              |
| Ping applicatif                       | 6 × à 80 ms, puis toutes les 2 s ; au plus 10 par seconde accepté                                                                                                              |
| Heartbeat WebSocket                   | ping toutes les 10 s, déconnexion après 3 pings sans réponse (`HEARTBEAT_MS`)                                                                                                  |
| Reconnexion                           | place gardée 20 s (`RECONNECT_GRACE_MS`)                                                                                                                                       |
| Inactivité                            | 60 s sans entrée en manche → spectateur ; 10 min en salon d'attente → déconnexion                                                                                              |
| Lancement automatique                 | salon public : 20 s après que 2 joueurs ou plus sont prêts                                                                                                                     |
| Podium                                | 12 s (`MATCH_END_MS`) puis retour au salon                                                                                                                                     |
| Débit d'entrées toléré                | 70 paquets/s par client, le surplus est ignoré                                                                                                                                 |
| Messages de contrôle                  | 20 par seconde par connexion (`CONTROL_PER_SEC`)                                                                                                                               |
| Emotes                                | 1 par seconde et par joueur                                                                                                                                                    |
| Taille maximale d'un message client   | 1 024 octets (`maxPayload` de `ws`, vérifié aussi par le décodeur)                                                                                                             |
| Messages invalides                    | 20 → déconnexion (code 1008)                                                                                                                                                   |
| Contre-pression                       | `bufferedAmount` > 64 Ko : snapshots sautés ; > 1 Mo : déconnexion                                                                                                             |

## 5. Pertes, retards et blocages

TCP ne perd pas de paquets : il les **retarde**, et bloque tout ce qui suit (blocage en tête de file). Le simulateur de lag du client reproduit exactement cela (voir §9).

**Entrées.**

- _Redondance_ : chaque paquet contient les 4 dernières entrées ; un paquet isolé retardé n'ôte rien.
- _Entrée en retard_ (étiquette déjà exécutée) : jetée. Le serveur **répète la dernière entrée** utilisée (les touches tenues restent tenues), et la marge négative remonte au client, qui augmente son avance. Une entrée répétée ne produit jamais d'appui frais : elle ne peut pas déclencher un nouveau coup, un saut ou une parade.
- _Silence prolongé_ : au-delà de 20 ticks (333 ms) sans entrée, le serveur passe à l'entrée neutre (un joueur dont la connexion tombe ne court pas indéfiniment). Pendant la reconnexion, son stickman reste immobile.
- _Après un blocage_ : une rafale d'entrées en retard arrive d'un coup ; elles sont ignorées, la correction de prédiction fait le reste.

**Snapshots.**

- Un snapshot perdu ou sauté n'est pas retransmis : le suivant contient l'état complet (pas de delta), l'interpolation continue entre ceux qui restent.
- Si le client ne reçoit rien pendant un moment, ses autres joueurs sont extrapolés 100 ms puis figés ; à la reprise, l'écart est rattrapé en quelques images (lissage) au lieu d'une téléportation.
- Les **événements fiables** (terrain, éliminations, coups, tirs, emotes…) sont répétés dans chaque snapshot jusqu'à l'accusé de réception (`ack`) du client ; appliqués une seule fois, dans l'ordre. Un client en retard de plus de 120 événements est déconnecté (`desync`, code 1008). Les snapshots sautés par contre-pression ne les perdent donc pas. Au changement de manche, les événements non acquittés d'avant sont abandonnés : le message `round` porte l'identifiant du dernier événement émis, d'où repart le client.

**Prédiction.** Quand le serveur a dû deviner une entrée (retard, répétition), l'état prédit diverge légèrement : la réconciliation corrige, de façon invisible dans la quasi-totalité des cas (voir §6).

## 6. Réconciliation

À la réception d'un snapshot de tick `S` avec bloc `own` :

1. Avant la première image de prédiction, ou tant que le client n'a pas rattrapé le serveur : il se contente de **suivre** l'état reçu.
2. Sinon, si `S` est dans l'historique (128 derniers ticks) : comparaison de `own` à l'état prédit au tick `S` (positions à 0,02 unité, vitesses à 0,05, **tous** les autres champs exactement : compteurs, drapeaux, état d'attaque, PV, munitions) **et** de la phase de partie (phase, ticks dans la phase). Un joueur mort n'évolue plus côté client : seuls son statut et son compteur de réapparitions comptent.
3. **Identique** → rien. **Différent** → `setTick(S)`, restauration de l'état exact du serveur (et de la phase de partie), puis **rejeu** des entrées enregistrées de `S + 1` au tick courant. La différence de position avant/après est ajoutée à un décalage visuel qui décroît en ≈ 100 ms. Le client compte les restaurations (`corrections`) et, à part, celles qui ont déplacé le joueur de plus de 0,5 unité (`visibleCorrections`).
4. Si le serveur est _en avance_ sur le client (`S` > tick prédit) : resynchronisation directe, comptée à part (devrait rester à 0).

Comme la simulation est déterministe et que `own` contient tout l'état qui influence le futur, **une prédiction dont les entrées sont arrivées à temps ne se corrige jamais** tant que rien d'extérieur ne l'atteint (vérifié : 0 correction sur 40 s à 0, 40, 150 et 300 ms de latence constante, avec 30 ms de gigue, et à 144 images/s). Ce qui vient d'ailleurs **est** une correction, attendue : un coup reçu (PV, projection, étourdissement), un ramassage, une réapparition, un changement de phase. Ces corrections sont invisibles (`visibleCorrections` ne monte pas) : la restauration replace le joueur là où il était déjà.

Les corrections de position qui restent viennent des blocages TCP du flux d'entrées : pendant un blocage de 300 ms, le serveur répète la dernière entrée (puis passe au neutre après 20 ticks) pendant que le client continue de bouger ; quand le flux reprend, l'écart (jusqu'à ≈ 20 unités à 2 % de pertes) est résorbé par le lissage visuel.

**Ce que le client ne prédit pas** : les dégâts (aucun nombre n'est affiché avant l'événement `HIT`), les ramassages, les tirs (le projectile apparaît avec le snapshot suivant ; le recul et l'animation du tireur, eux, sont prédits), le terrain détruit par ses propres roquettes (il arrive par `TERRAIN`). Si le serveur contredit un coup (il n'a pas touché), aucun effet de touche n'est affiché.

## 7. Compensation de latence

Sans elle, il faudrait viser là où l'adversaire _sera_ : ce que le tireur voit date de `RTT/2 + retard d'interpolation`, et son tir ne s'exécute que `RTT/2 + avance` plus tard. Le serveur remonte donc le temps pour la mêlée et les tirs instantanés :

1. Il conserve les positions (x, y, hauteur) de chaque joueur sur les **16 derniers ticks**.
2. Chaque client annonce, dans le champ `rewind` de ses paquets, la durée qui sépare ses entrées de ce qu'il voit des autres : `RTT + (avance + durée d'une image) × 16,7 ms + retard d'interpolation`, en pas de 4 ms.
3. Le serveur borne ce retard à **15 ticks (250 ms)**, le place dans les bits 12 à 15 du masque d'entrées du joueur et, pour chaque coup de mêlée ou tir instantané, teste les cibles à leur position d'il y a `rewind` ticks (`rewoundBox`).
4. L'aide à la visée (±8° vers la cible la plus proche dans le cône) est calculée avec les mêmes positions passées, pour tous les appareils.

Les projectiles lents (boulettes, avions, roquettes, gomme) **ne sont pas compensés** : ils sont simulés sur le serveur et apparaissent chez les autres à leur place du moment. Une parade parfaite se juge elle aussi sur le serveur, au tick où le coup arrive (fenêtre de 100 ms après l'appui). Au-delà de 250 ms de retard annoncé, la compensation est partielle : un joueur très lent doit viser un peu devant.

Le champ `rewind` ne vient que du client, mais il est borné, et ne peut servir qu'à tester des positions que le serveur a réellement eues : le pire qu'un tricheur obtienne est un coup contre une position vieille de 250 ms.

## 8. Salons, spectateurs, reconnexion

- **Jeton.** `joined` porte un jeton de 128 bits (hexadécimal). Le client le garde en `localStorage` avec l'heure de la dernière vie de la connexion.
- **Reconnexion.** À la perte de la connexion, le joueur garde sa place **20 s** : son stickman reste immobile (entrées neutres) et le salon l'affiche « en reconnexion ». Si c'était l'hôte, le plus ancien joueur connecté le devient tout de suite. Le client rouvre une connexion et envoie `resume` avec le jeton (délais croissants de 0,4 à 2,5 s, jusqu'à 20 s) ; un rechargement de la page dans les 17 s tente la même chose. Le serveur répond par un nouveau `joined` complet (terrain courant compris). Un jeton déjà utilisé ou périmé donne `bad_token`, et les essais comptent dans la limite d'essais de code. Le délai écoulé : en salon d'attente ou entre deux manches, le joueur est retiré ; en manche, il est éliminé et retiré à la fin de la manche.
- **Spectateurs.** 4 au plus. Quiconque arrive pendant une partie est spectateur ; il reçoit les mêmes snapshots (sans bloc `own`, avec **toutes** les mines), accuse les événements fiables, et prend une place de joueur à la fin de la manche en cours s'il en reste une. Un joueur inactif depuis 60 s devient spectateur jusqu'à la fin de la partie.
- **Changement de manche.** Le serveur envoie `round` avant le premier snapshot de la manche : le client vide ses tampons d'interpolation, charge la nouvelle arène et redémarre sa prédiction au premier snapshot reçu. `scores` suit chaque fin de manche, `results` la fin de partie, puis le salon rejoue l'arène d'entraînement.

- **Arrêt propre du serveur (mise à jour).** Sur `SIGTERM`, le serveur n'accepte plus de connexion (les nouveaux venus sont fermés avec le code **1012**), envoie `shutdown` à chaque client connecté, laisse les manches continuer pendant `SHUTDOWN_GRACE_SEC` (30 s par défaut), puis ferme les connexions restantes avec **1012** (« Service Restart ») et sort. Le client affiche l'annonce, puis, à la fermeture 1012, l'écran de maintenance, et tente `resume` pendant 90 s (délais de 0,4 à 4 s). Les salons étant en mémoire, ils ne survivent pas au redémarrage : le serveur neuf répond `bad_token` et le client revient à l'accueil avec le message « le serveur vient d'être mis à jour ». Voir `docs/ARCHITECTURE.md` §5 et `docs/DEPLOIEMENT.md` §7.

## 9. Outils

- **Simulateur de réseau** : `?lag=150&jitter=30&loss=2`. `lag` = latence **aller-retour** ajoutée (moitié dans chaque sens), `jitter` = ± ms par sens, `loss` = % de messages « perdus ». L'ordre est conservé comme en TCP : un message perdu est retransmis après `max(200 ms, 2 × lag)` et retarde tous les suivants. Code : `packages/client/src/net/transport.ts`.
- **Graphe réseau** (`F3` ou `?debug=1`) : RTT, débit montant et descendant, corrections par seconde, retard d'interpolation, avance, tick prédit et estimé, marge, tampon, gigue. Le fantôme rouge est le dernier état confirmé par le serveur pour son propre stickman.
- **Panneau de réglage** (build de développement seulement, serveur lancé avec `DEV_TOOLS=1`, ce que fait `npm run dev`) : les 26 constantes de `packages/shared/src/movement.ts`, appliquées en direct à la salle entière.
- **Enregistrement / relecture** : avec `DEV_TOOLS=1` (ou `RECORD_DIR=dossier`), chaque salle enregistre ses entrées **et les opérations du salon** (arrivées, départs, lancement de partie avec ses règles, retour au salon, éliminations par abandon, réglages), dans l'ordre où le serveur les a exécutées (format `Recording` version 3). `GET /dev/recording/CODE` renvoie le JSON. Relecture visuelle : `?replay=/dev/recording/CODE` (espace : pause, `[` et `]` : vitesse) ; relecture headless et vérification du hash : `npm run simulate -- --replay fichier.json`. Une partie complète rejouée donne exactement le même état final.
- **`npm run simulate`** : déterminisme sur 60 000 ticks (deux mondes, hash comparé tous les 1 000 ticks) en mouvement seul, puis en parties enchaînées avec combat, armes, modes bonus et fantômes ; et coût d'un pas.
- **`npm run loadtest`** : voir §10. `-- --no-combat` mesure les déplacements seuls.
- **`node scripts/browser-check.mjs`** : N onglets Chromium dans le même salon avec réseau dégradé.
- **Éditeur d'arènes** : `/editor` en développement, voir `docs/ARENES.md`.

## 10. Mesures

### Phase 2 : combat actif

**Simulation** (`npm run simulate`, 8 joueurs, 60 000 ticks, un monde qui enchaîne les parties sur les 10 arènes avec armes, modes bonus, fantômes) : **6,3 µs par pas** au p50, **14,9 µs** au p99 (budget : 150 µs), contre 4,4 µs au p50 en mouvement seul ; déterministe (hash identique sur 60 points de contrôle). Le tas ne bouge que de 188 Ko sur l'ensemble (les tirages d'arène et de mode, une fois par manche) : aucune allocation par pas.

**Charge** (`npm run loadtest -- --rooms 25 --players 8 --duration 120`, 200 clients, 4 threads générateurs). Les salons enchaînent des parties (3 manches à gagner, mort subite à 20 s, un mode bonus toutes les 3 manches) et les faux clients se battent : coups, parades, ramassages ; armes, projectiles, explosions, terrain détruit et fantômes sont actifs.

Machine de mesure : **Windows 11, Node 24, 20 cœurs, serveur non épinglé** (pas de `taskset`, ni de Docker) ; la mesure de la phase 1 avait été faite sous Linux avec un cœur épinglé. Les deux séries ci-dessous sont donc comparables entre elles, pas avec le tableau de la phase 1.

| Mesure                                      | Combat actif              | Déplacements seuls (`--no-combat`) | Budget (§2.8)     |
| ------------------------------------------- | ------------------------- | ---------------------------------- | ----------------- |
| Pas de simulation d'une salle (p50 / p99)   | 0,027 ms / 0,181 ms       | 0,026 ms / 0,262 ms                | < 0,15 / < 0,5 ms |
| Tick complet, 25 salles (p50 / p99)         | 7,3 ms / 14,5 ms          | 7,4 ms / 14,3 ms                   | —                 |
| CPU du serveur                              | 66 %                      | 59 %                               | < 60 %            |
| Tas JS / RSS                                | 32 Mo / 108 Mo            | 30 Mo / 105 Mo                     | < 250 Mo          |
| Retard de boucle d'événements (p99)         | 27,9 ms                   | 26,8 ms                            | < 10 ms           |
| Débit descendant par client                 | 8,7 Ko/s (30 snapshots/s) | 8,6 Ko/s                           | < 20 Ko/s         |
| Dépassements de la boucle, snapshots sautés | 9, 0                      | 1, 0                               | 0                 |

Lecture honnête :

- **Le combat ne coûte presque rien en JavaScript** (le pas de salle est identique, 1 % de plus de bande passante) : il coûte ≈ 7 points de CPU de plus, en messages de salon et en événements.
- **Sur cette machine, les budgets de CPU et de boucle ne sont pas tenus, même sans combat** : le tick complet médian y est de 7,3 ms contre 2,7 ms sous Linux en phase 1, la différence venant du coût des appels système réseau sous Windows (une écriture par snapshot et par client, 6 000 par seconde) et de la granularité de 15,6 ms des minuteries. Le même scénario à 5 salons × 8 joueurs reste dans tous les budgets (CPU 14 %, boucle p99 9 ms). **La vérification qui compte est celle de la phase 4**, dans le conteneur `--memory 512m --cpus 1` sous Linux ; avec le surcoût mesuré ici (+12 % de CPU par rapport au déplacement seul) la marge de la phase 1 (47 % → 60 %) suffit sur le papier, sans l'avoir mesuré. Si la mesure en conteneur dépasse, la piste est déjà notée : un paquet d'entrées tous les 2 ticks (D23).
- Les 25 parties lancées n'en terminent aucune en 125 s (il faut au moins 3 manches de 25 s) : la mesure porte sur des manches en cours, des changements de manche et des salons d'attente, pas sur des podiums.

### Phase 1 : réseau dégradé (inchangé)

Machine de développement Linux (20 cœurs, Node 22), serveur épinglé sur **un seul cœur**.

**Simulation** (déplacements seuls, 8 joueurs, 300 000 ticks) : **0,7 à 0,8 µs par pas** au p50, 1,3 µs au p99.

**Charge** (25 salles × 8 joueurs, 120 s, déplacements seuls) :

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

**Réseau dégradé** (banc d'essai en temps virtuel : vrai serveur, vrais clients, salon de 8 joueurs sur l'arène `test-tower`, 40 s mesurées après 8 s de chauffe ; `packages/client/test/prediction.test.ts`, repris en protocole v2 sans changer les seuils). Un pas normal de l'affichage est de 3 u/image en course et jusqu'à 10 u/image en chute (60 images/s).

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

## 11. Limites connues

- **Compensation de latence plafonnée à 250 ms** : au-delà (RTT > ≈ 100 ms avec 100 ms d'interpolation), le tireur doit viser un peu devant. Les projectiles lents ne sont pas compensés.
- **Pas de collision entre joueurs** : voir `DECISIONS.md` (D4). Elle rendrait la prédiction dépendante des autres joueurs.
- **Corrections après blocage TCP** : l'écart maximal observé est de ≈ 20 unités à 2 % de pertes (jusqu'à ≈ 60 à 5 %). Reprendre les entrées arrivées en retard pour ré-simuler un seul joueur n'est plus possible depuis que le combat lie les joueurs entre eux.
- **Salles d'attente à 60 Hz** : l'optimisation « 30 Hz, 15 snapshots/s » de §2.5 reste repoussée : tous les salons coûtent la même chose, ce qui est le pire cas mesuré.
- **Joueur distant sur une plateforme mobile** : il est recollé à la plateforme à l'écran (indice transmis dans `flags`), mais sa position reste celle d'un instant passé.
- **Marques et flaques d'un arrivant** : un joueur qui entre en cours de manche reçoit le terrain courant (blocs détruits) mais pas les traits de fantômes ni les flaques d'encre déjà posés (quelques secondes de vie au plus).
- `/metrics` n'est pas encore restreint au réseau interne (phase 4) ; protégé par `METRICS_TOKEN` si défini.
