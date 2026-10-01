# T-48 — EXTERNAL FAIL-SAFE FOR A TEMPORARY REFUND WINDOW

> **STATUT : OPEN — conception documentée, implémentation NON faite.**
> Ce ticket **bloque toute future fenêtre financière** `REFUNDS_ENABLED=true`, y compris
> une répétition Claims capable de déclencher un vrai remboursement Stripe TEST.
> Il ne bloque **pas** l'implémentation de Claims (rédigé le 2026-09-10, batch Claims 1).

## 0 · Pourquoi ce ticket existe

La revue adversariale de la clôture du train refund (2026-09-09) a trouvé un défaut
**BLOQUANT** que l'implémenteur n'avait pas vu : la fenêtre de remboursement ne se
re-gelait que si le processus **atteignait** son bloc `finally`. Le correctif livré
(`scripts/server/phase2-refund-gate.js`) arme un re-gel **synchrone** sur `SIGINT`,
`SIGTERM`, `SIGHUP`, `SIGQUIT`, `SIGBREAK`, `uncaughtException` et `unhandledRejection`.

C'est une protection **PROCESS-LOCALE**. Un processus ne peut pas garantir son propre
nettoyage **après avoir cessé d'exister**. Il reste donc une classe de pannes non
couverte, et il serait malhonnête de décrire le re-gel actuel comme « inconditionnel ».

## 1 · Bloc de conception demandé

**THREAT MODEL**
L'actif protégé n'est pas un secret mais un **état** : `REFUNDS_ENABLED=true` dans
`.env.local` + un process Passenger qui l'a chargé. Tant que cet état dure, la route
`POST /api/admin/refunds/run` accepte un appel authentifié et **déplace de l'argent
réel**. L'adversaire n'est pas nécessairement humain : c'est surtout **la panne** —
tout événement qui détruit le processus ouvreur avant qu'il n'ait refermé. S'y ajoute
un adversaire opportuniste : quiconque détient le token interne (secret GitHub, jetons
hébergeur) et découvre une fenêtre restée ouverte. La fenêtre est donc une **surface
d'attaque à durée de vie**, et la seule mitigation acceptable est que cette durée de vie
ne dépende pas de la survie d'un processus.

**FAILURE CASES**
| Cas | Couvert aujourd'hui | Conséquence si non couvert |
|---|---|---|
| Fin normale (refund observé ou TTL atteint) | OUI — `finally` | — |
| `Ctrl-C`, `SIGTERM`, coupure SSH (`SIGHUP`) | OUI — re-gel synchrone armé | — |
| Exception non capturée / rejet non géré | OUI — handlers dédiés | — |
| **`SIGKILL` (`kill -9`, OOM killer)** | **NON** | porte laissée OUVERTE |
| **Crash / redémarrage de l'hôte, coupure courant** | **NON** | porte laissée OUVERTE |
| **Mort du processus Passenger pendant la fenêtre** | **NON** | porte laissée OUVERTE |
| **Perte réseau entre l'opérateur et l'app** | partiel — le fichier est réécrit, mais la preuve HTTP `403` échoue | état non prouvé |
| Disque plein / `.env.local` non inscriptible au moment du re-gel | partiel — bannière `HUMAN ACTION REQUIRED` | porte OUVERTE + humain alerté |

**PROCESS-LOCAL PROTECTION**
`armedRefreeze` + `writeFlag`/`touchRestart` **synchrones**, armés AVANT l'écriture
`true` et désarmés seulement une fois `false` réellement sur disque ; plus le `finally`
inconditionnel. Prouvé par `tests/phase2-refund-gate-emergency-refreeze.test.ts` (7/7).
**Ce n'est pas** une garantie de fermeture ; c'est une garantie de *meilleur effort du
vivant du processus*.

**EXTERNAL PROTECTION (à implémenter — non fait)**
Option retenue pour conception : un **bail expirant appliqué par l'APPLICATION**, pas par
l'opérateur. Le kill-switch cesserait de se lire « le drapeau est-il true ? » pour se lire
« existe-t-il un bail **non expiré** ? » :
- l'opérateur écrit `REFUNDS_WINDOW_UNTIL=<ISO8601>` **en même temps** que le drapeau ;
- `isRefundsEnabled()` renvoie true **seulement si** `REFUNDS_ENABLED=true` **ET**
  `now < REFUNDS_WINDOW_UNTIL` **ET** l'échéance est ≤ un plafond dur compilé
  (ex. 30 min) — une échéance absente, illisible, passée ou aberrante ⇒ **false** ;
- la fermeture devient donc l'**absence d'action** : si le monde entier s'arrête, la
  fenêtre se ferme quand même, parce que le temps passe. Aucun watchdog à surveiller.
Alternative écartée pour l'instant : un cron hébergeur de re-gel armé AVANT l'ouverture
(dépend du démon cron, donc d'un autre processus qui peut lui aussi mourir, et laisse une
fenêtre entre deux minutes de cron).

**LEASE / WATCHDOG AUTHORITY**
L'autorité serait **l'application elle-même**, à chaque requête, sur son horloge. Pas
d'agent externe, donc rien de neuf à superviser. L'opérateur ne peut que *raccourcir* la
fenêtre (re-gel anticipé), jamais la prolonger au-delà du plafond compilé.

**MAXIMUM OPEN WINDOW**
Proposition : **15 min** par défaut (la valeur déjà utilisée), **30 min** de plafond dur
non dépassable par configuration. Une demande supérieure ⇒ refus de l'opérateur.

**FAIL-CLOSED STATE**
`REFUNDS_ENABLED` effectif **false** ⇒ `POST /api/admin/refunds/run` répond `403
{gated:true}` **avant toute authentification**. Toute ambiguïté (drapeau illisible, bail
absent/illisible/expiré, horloge suspecte) doit retomber sur cet état, jamais sur « ouvert ».

**WHAT HAPPENS ON SIGKILL**
Aujourd'hui : le drapeau reste `true`, la porte reste OUVERTE jusqu'à intervention
humaine. Aucun gestionnaire ne peut intercepter `SIGKILL` — **ne jamais prétendre le
contraire, ne jamais écrire un faux gestionnaire `SIGKILL`**. Avec le bail : la porte se
ferme d'elle-même à l'échéance, sans que personne n'agisse.

**WHAT HAPPENS ON HOST RESTART**
Aujourd'hui : `.env.local` survit avec `true` ; au redémarrage Passenger **recharge** un
drapeau ouvert — c'est le pire cas, la fenêtre peut rouvrir toute seule et durer
indéfiniment. Avec le bail : le drapeau rechargé est inerte, car l'échéance est dépassée.

**WHAT HAPPENS IF WATCHDOG FAILS**
Il n'y a pas de watchdog dans l'option retenue — c'est précisément l'argument. Si l'on
retenait un cron : sa panne laisserait la fenêtre ouverte, donc il faudrait *en plus* un
bail. Le bail seul est strictement plus sûr et plus simple.

## 2 · Ce qui est explicitement NON revendiqué

- Le re-gel actuel n'est **pas** inconditionnel : il ne couvre ni `SIGKILL`, ni un crash
  hôte, ni une coupure de courant.
- Rien ici n'est implémenté. `T-48 = OPEN`.
- La répétition Claims du batch 1 n'a **pas** besoin de T-48 : l'opérateur
  `scripts/server/phase2-claims-gate.js` n'ouvre que `CLAIMS_ENABLED`, refuse de démarrer
  si la porte refund n'est pas mesurée fermée, re-vérifie qu'elle le reste pendant toute
  la fenêtre, et **refuse explicitement** `PHASE2_CLAIMS_WITH_REFUNDS=1` en citant T-48.
  Avec REFUNDS fermé, une réclamation approuvée se repose en `approved` sans argent.

## 3 · Conditions de clôture

1. `isRefundsEnabled()` applique le bail (drapeau **et** échéance **et** plafond compilé),
   fail-closed sur toute ambiguïté ;
2. l'opérateur de fenêtre écrit l'échéance au moment de l'ouverture et ne peut pas
   dépasser le plafond ;
3. tests : échéance passée ⇒ fermé ; échéance absente/illisible ⇒ fermé ; échéance
   aberrante ⇒ fermé ; redémarrage simulé avec `true` + échéance passée ⇒ fermé ;
   fenêtre normale ⇒ ouverte puis fermée par le seul écoulement du temps ;
4. le tout prouvé **hors argent** (harnais non financier), jamais en ouvrant une vraie
   fenêtre de remboursement pour tester T-48.
