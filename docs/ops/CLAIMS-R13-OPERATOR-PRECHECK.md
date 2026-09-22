# CLAIMS — précheck opérateur du rond 13 (H16, AMF-1, C10)

> Référence : `docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md` — FREEZE NOTES AMF-1, H16, I-06, I-07.
> Lecture seule. Aucune de ces étapes ne déplace d'argent, n'écrit chez Stripe, n'écrit une ligne `Refund`
> ni n'envoie d'e-mail client.
>
> **D′ L1 (2026-09-22) — VALIDE UNIQUEMENT AVEC `CLAIMS_SURFACE_ENABLED` / `CLAIMS_INTAKE_ENABLED` ABSENTS.** Sous les
> flags produit (spec v2 §3), le bail legacy `CLAIMS_ENABLED`+`CLAIMS_WINDOW_UNTIL` est inerte et `phase2-claims-gate.js`
> refuse (precheck : anomalie nommant le flag ; window : refus). Historique figé : Mode A exécuté 2026-09-15→18,
> Mode B exécuté 2026-09-22 sur `dab754d` — CLOS, à ne jamais rejouer. Mode B n'est pas reproductible sur D′ par
> construction (approuver ≠ rembourser depuis L2).

## Quand

Sur **CHAQUE environnement** (staging, puis production), **avant l'ouverture de tout bail CLAIMS** sur cet
environnement, et avant toute fenêtre Mode A. Les étapes 0 à 2 se refont si le build déployé a changé depuis
le dernier précheck ; l'étape 3 se refait sur chaque nouveau SHA release-candidate certifié.

## Étape 0 — Condition de version (BLOQUANTE)

**AUCUN bail CLAIMS sur un environnement dont le build déployé ne contient pas le commit W7 `4d3e442`.** W7 a
livré la console qui appelle `POST /api/admin/claims/[id]/closure-notice` : la section « Avis client non envoyés »,
le bouton « Envoyer l’avis au client » et `counts.closureNoticesMissing` (H10). Le toast opérateur `stripeNotConfirmed`
(H11, texte gelé) nomme ce bouton : il n'est vrai que si le build **déployé** contient W7. La condition porte sur le
build déployé, pas sur l'arbre de travail, et se vérifie ainsi :

1. Lire le commit déployé : `curl -s https://<hôte>/version.json` → champ `commit` (SHA complet).
2. Dans un clone à jour contenant la branche déployée (`git fetch origin develop main` : en production, `commit` est
   un commit de `main`, que `develop` ne contient pas) : `git merge-base --is-ancestor 4d3e442 <commit>` doit sortir
   **0** (le build contient W7). Toute autre sortie (1 : le build ne contient pas W7 ; 128 : commit absent du clone) :
   ne pas ouvrir de bail.
3. Connecté en **admin** : `GET /api/admin/claims/financial-verification` doit porter `counts.closureNoticesMissing`
   (un nombre, ou `null` si la liste est illisible). Champ absent = build antérieur à W7 : ne pas ouvrir de bail.
   Sur `/fr/admin/claims`, la section « Avis client non envoyés (n) » s'affiche dès que ce compte est > 0 ou que sa
   liste est illisible ; avec 0 avis manquant elle n'est pas affichée, c'est voulu.
4. Consigner dans l'inbox le commit déployé et le résultat des points 2 et 3.

## Étape 1 — Recensement des populations (H16 / I-06 / I-07)

1. Lancer le précheck de l'opérateur en mode `REHEARSAL PRECHECK` :
   `scripts/server/phase2-claims-gate.js` (mode précheck). Il calcule lui-même les comptes, sans Stripe et
   sans écriture, et les imprime :
   - une ligne `CENSUS <clé> = <n>` par compte (toujours) ;
   - une ligne `!! CENSUS: <clé> — <message>` pour chaque compte > 0 ou `NOT MEASURED` ;
   - le bloc `CENSUS (C3 — legacy and closure populations; report them in the inbox; they do not change RESULT)`,
     après le bloc `ANOMALIES`.
   Ces lignes ne changent ni `RESULT` ni `WINDOW READINESS`.
2. Les mêmes comptes sont lisibles via `GET /api/admin/claims/census` (jeton interne) :
   `claims.legacy` et `claims.closure`. Un compte `null` veut dire NON MESURÉ — jamais « zéro ».
3. **Reporter dans l'inbox** (page Notion fixe, `write-inbox-file`), pour cet environnement : le commit
   déployé, chaque compte de `claims.legacy` (dont `ownRowResumeMismatch.nonTerminal` / `.terminal`) et de
   `claims.closure`, et chaque ligne `!! CENSUS:` telle qu'imprimée. Un compte `refundedAfterContradictionAttribution`
   > 0 ou `null` demande une **revue fondateur** (E-15) avant l'ouverture du bail.
4. Rappel : E-09 (réclamation soldée dont le remboursement a échoué chez Stripe, événement perdu) n'est
   **pas** compté par le recensement : il demande une lecture Stripe. C'est l'étape 2.

## Étape 2 — Revérification des remboursements soldés (AMF-1)

1. Connecté en **admin** sur l'environnement (staging n'a pas de cron), appeler
   `POST /api/admin/claims/reconcile-refunds`. La route accepte le jeton interne OU une session admin
   (sans session → 401 ; session non admin → 403). Elle n'est pas gatée par `CLAIMS_ENABLED`.
2. Lire dans la réponse `settledReverify: { checked, reverted, standing, unreadable, unproven, truncated }`.
3. **Consigner** dans l'inbox `settledReverify` complet. Le précheck Mode A exige **`reverted = 0`**.
   - `reverted > 0` : des réclamations viennent d'être marquées (alerte I-01 `reverted_after_refund` envoyée) ;
     elles apparaissent dans « Vérification financière requise » et se clôturent sur déclaration
     (« Clôturer ce dossier… »). Relancer l'étape 2 après traitement, jusqu'à `reverted = 0`.
   - `unreadable > 0` : Stripe n'a pas pu être lu ; relancer.
   - `truncated = true` : la fenêtre de 35 jours contient plus de 100 réclamations éligibles (ligne liée de la commande
     de la réclamation, `succeeded` ou `pending`), ou la borne de lecture (50 pages de 101 réclamations soldées) est
     atteinte. Le passage a relu **au plus** les 100 plus anciennes réclamations éligibles trouvées (tri `decidedAt`,
     puis `createdAt`). Quand c'est la borne de 50 pages qui arrête la lecture, toutes les éligibles trouvées ont été
     relues (parfois moins de 100), mais les réclamations soldées au-delà de ces pages n'ont pas été examinées.
     Il n'a pas de curseur, et chaque passage relit les 100 plus anciennes éligibles du moment : tant que celles déjà
     relues restent éligibles, un nouveau passage relit les mêmes et ne relit pas les plus récentes ; tant que plus de
     100 réclamations éligibles restent dans la fenêtre (ou que la borne de 50 pages est de nouveau atteinte),
     **relancer ne lève pas `truncated`**. Un passage n'atteint des réclamations plus récentes que si des plus
     anciennes sortent de la sélection (marquées après un remboursement annulé, ou sorties de la fenêtre).
     La réponse ne porte que des comptes, aucun identifiant : elle ne dit pas lesquelles ont été relues. Vérifier donc
     dans le Dashboard Stripe le remboursement de chaque réclamation remboursée dont le règlement (`decidedAt`, sinon
     `createdAt`) date des 35 derniers jours — au minimum celles qui suivent les 100 plus anciennes dans cet ordre — et
     le consigner dans l'inbox (résiduel déclaré, `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §25).
4. Résiduel (déclaré dans `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §21) : un échec que Stripe rapporte plus de
   35 jours après le règlement, dont l'événement a été perdu, n'est pas détecté.

## Étape 3 — Répétition sur base réelle de la liaison unique (C10 / J-M24, BLOQUANTE)

Avant toute fenêtre Claims, **sur le SHA release-candidate certifié final** (pas sur un commit antérieur) :

1. Démarrer une MariaDB **12.x jetable locale** (datadir neuf, écoute sur `127.0.0.1`), créer la base `claims_race`
   et y pousser le schéma avec Prisma 5.22.0 :
   `DATABASE_URL=mysql://root@127.0.0.1:<port>/claims_race node node_modules/prisma/build/index.js db push --skip-generate`
   (variable passée en préfixe de cette seule commande, jamais exportée : la garde du test refuse une URL égale à un
   `DATABASE_URL*` de l'environnement).
2. Lancer `CLAIMS_RACE_DATABASE_URL=mysql://root@127.0.0.1:<port>/claims_race CLAIMS_RACE_NEGATIVE=1 npx vitest run tests/claims-attribution-race.db.test.ts`
   et lire son code de sortie directement (jamais à travers un pipe).
3. Exiger : 20/20 itérations avec exactement une réclamation remboursée et liée, l'autre inchangée
   (`financial_verification`, `refundError` d'origine), le perdant toujours un 409 ; contrôle négatif (niveau
   d'isolation omis) : la ligne liée aux deux réclamations.
4. Consigner la version du serveur, le SHA, les comptes (gagnants, réponses du perdant, contrôle négatif) dans
   `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §20 et dans l'inbox.

**Jamais contre staging ni la production.** La garde du test (toujours exécutée) refuse tout hôte non loopback, le
préfixe du compte o2switch, toute base dont le nom n'est pas `claims_race…`, et toute URL ou base égale à un
`DATABASE_URL*` de `process.env`, `.env.local` ou `.env`. Dernier enregistrement : `d555f6f`, MariaDB 12.3.2,
20/20 (gagnants 9 / 11), contrôle négatif 20/20 (`docs/ops/REFUND-FINANCIAL-CONTRACT.md` §20).
