# CLAIMS — précheck opérateur du rond 13 (H16, AMF-1)

> Référence : `docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md` — FREEZE NOTES AMF-1, H16, I-06, I-07.
> Lecture seule. Aucune de ces étapes ne déplace d'argent, n'écrit chez Stripe, n'écrit une ligne `Refund`
> ni n'envoie d'e-mail client.

## Quand

Sur **CHAQUE environnement** (staging, puis production), **avant l'ouverture de tout bail CLAIMS** sur cet
environnement, et avant toute fenêtre Mode A. Les deux étapes se refont si le build déployé a changé depuis
le dernier précheck.

## Étape 0 — Condition d'ordre W6 → W7 (BLOQUANTE)

**AUCUN bail CLAIMS avant W7 (H10)** — sur aucun environnement. Le build W6 écrit l'enregistrement de clôture,
tente les avis client et expose `POST /api/admin/claims/[id]/closure-notice`, mais aucun contrôle de la console
n'appelle encore cette route : la section « Avis client non envoyés », le bouton « Envoyer l’avis au client »,
`counts.closureNoticesMissing` et le test J-C30 arrivent avec le slice console W7 (H10). Le toast opérateur
`stripeNotConfirmed` (H11, texte gelé) dit « Réessayez « Envoyer l’avis au client » plus tard » : il ne peut pas
s'afficher tant que les réclamations sont fermées (l'expéditeur répond `claims_disabled`, étape 4, avant
`stripe_not_confirmed`, étape 7), mais il nommerait un contrôle absent dès qu'un bail s'ouvre.

- Avant d'ouvrir un bail CLAIMS : vérifier que le build déployé contient W7 (H10 et J-C30 verts) et le consigner
  dans l'inbox avec le commit.
- Un build W6 sans W7 se déploie uniquement avec `CLAIMS_ENABLED` fermé.
- Si W7 est retardé au-delà d'une fenêtre de bail prévue : ajouter une IMPLEMENTATION NOTE à H11 et retirer la
  phrase finale « Réessayez … plus tard » de `stripeNotConfirmed` (5 locales) tant que le contrôle n'existe pas.

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
   - `truncated = true` : plus de réclamations éligibles que la borne (100) ; relancer jusqu'à `truncated = false`.
4. Résiduel (déclaré dans `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §21) : un échec que Stripe rapporte plus de
   35 jours après le règlement, dont l'événement a été perdu, n'est pas détecté.
