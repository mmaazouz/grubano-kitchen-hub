# CLAIMS — BATCH 2 : REGISTRE D'AUDIT ADVERSARIAL

> Statut : **audit exécuté AVANT livraison**, comme exigé. Ce document conserve l'historique :
> ce que l'audit a trouvé dans mon propre travail, ce qui a été corrigé, ce qui reste OPEN.
> **Il ne doit jamais être réécrit pour faire disparaître un défaut trouvé.**
>
> Rappel de portée : Claims **NON activé**, `REFUNDS_ENABLED` **NON ouvert**, aucun remboursement
> Stripe exécuté, aucune Clean Room. Aucun changement de schéma Prisma.

---

## 1. Méthode

Auditeurs indépendants sur dimensions séparées, puis **un réfuteur hostile par constat**
(consigne : `real=false` par défaut en cas de doute, ne confirmer qu'après relecture du code
courant), puis **contrôles négatifs** dans les tests (prouver que la suite vire au rouge si le
défaut est réinjecté).

Dimensions : **A** autorité au niveau article · **B** vérité cumulative (Stripe + DB) ·
**C** asynchrone / réconciliation · **D** auth & sécurité (allergènes) · **E** vérité
admin/produit · **F** sûreté de la fenêtre T-48.

Sévérités : **P0** l'argent bouge mal ou un signalement sécurité est perdu · **P1** on affirme au
client/à l'admin quelque chose de faux sur l'argent, ou un plafond d'autorité est faux ·
**P2** réel mais borné · **P3** cosmétique.

---

## 2. Ce que l'audit a trouvé DANS MON PROPRE TRAVAIL (historique — ne pas effacer)

### 2.1 Corrigés pendant le batch

| # | Sév. | Constat | Correctif |
|---|---|---|---|
| 1 | **P0** | **`requestedAmountCents` ignoré** : en retirant l'autorité au client j'avais supprimé la lecture du montant demandé. Le client livré envoie un montant et **aucune** sélection de lignes → **chaque réclamation était gonflée à la commande entière**. | Le montant demandé est honoré comme **RÉDUCTION uniquement**, jamais comme autorité. `resolveClaimAmount` le borne au plafond serveur. |
| 2 | P2 | La page d'aide conso envoyait encore un montant au lieu de sa sélection existante. | Elle envoie `items` dérivé de son propre état `selected`. |
| 4 | P2 | **`getClaimEligibility` ne consultait jamais Stripe** : le plafond **montré** au client était le plafond DB, donc un remboursement fait depuis le Dashboard Stripe était invisible. Le formulaire proposait de l'argent déjà remboursé, que le serveur refusait ensuite. | Le `stripePaymentIntentId` est transmis : la vue conso et l'application serveur utilisent **la même** vérité cumulative. Tests : `tests/claims-eligibility-stripe-truth.test.ts`. |
| 6 | P2 | **Remboursements `pending` soustraits DEUX FOIS.** Le contrat du projet (`REFUND-FINANCIAL-CONTRACT.md` §66/§145/A9) dit que `charge.amount_refunded` **inclut déjà** un remboursement encore `pending` ; mon commentaire dans `lib/claims.ts` affirmait l'inverse. Effet : plafond **trop bas**, réclamations légitimes refusées. | `min(capturé−remboursé, capturé−max(remboursé,pending))`. Le terme `pending` reste un **plancher** pour le cas anormal où il serait rapporté hors `amount_refunded`. Commentaire faux corrigé. Contrôle négatif dans `tests/claim-scope.test.ts`. |
| 7 | P2 | La route de récupération de réconciliation n'avait **aucun appelant planifié** : un webhook Stripe perdu laissait une réclamation en `refunding` indéfiniment. | Étape quotidienne dans `.github/workflows/cron.yml`. **Ne déplace aucun argent** : aucun appel moteur, aucune écriture Stripe — elle rejoue le même CAS idempotent que le webhook, à partir de la ligne `Refund` déjà existante. (À distinguer de l'étape P0-07 supprimée par le fondateur, qui **payait**.) |
| 8 | P1 | `resolveStuckClaim` existait **sans aucune route** : l'argent bloqué n'avait pas de sortie, et la réclamation gardait `activeOrderKey`, empêchant le client de re-déposer sur cette commande. | Route `POST /api/admin/claims/[id]/resolve-stuck`, rôle relu **en base** et non depuis le JWT, trace admin, **aucun mouvement d'argent**. |
| 9 | P2 | **`allergen_safety` n'était pas exclu du chemin machine.** `autoResolveSmallClaim` pouvait approuver et rembourser sans humain ; les signalements sécurité étant souvent de **petits** montants, c'était le chemin le PLUS probable pour en clore un automatiquement. Le commentaire de `isSafetyReason` promettait déjà « aucun remboursement automatique » — le code ne l'appliquait pas. | Garde en **première** position dans `autoResolveSmallClaim`. Prouvé **non inerte** de bout en bout par la vraie route (`tests/claims-route-auth.test.ts`), avec un cas non-sécurité qui, lui, passe — sinon le test ne prouverait rien. |
| 10 | P3 | Le tri sécurité n'existait que dans la liste **argent bloqué**, c'est-à-dire **après** l'échec d'un remboursement. Sur les listes où une réclamation **arrive**, une exposition allergène était indistinguable d'un accompagnement manquant. | `triageBySafety` appliqué à `listRestaurantClaims`, `listPendingRestaurantClaims`, `listSilenceExpiredClaims` + badge admin. **Visibilité et ordre seulement** : aucune autorité financière supplémentaire. |
| 11 | **P1** | **Le remboursement automatique « ghost order » contournait le bail T-48** : il partait sur son propre flag permanent, donc une autorisation de dépenser qui n'expirait jamais. | `isGhostOrderAutoRefundEnabled() && isRefundsEnabled()` — le bail vaut pour **tous** les appelants, chemins automatiques compris. |
| 12 | P2 | La liste « Remboursements à traiter » affichait l'argent bloqué **sans aucun contrôle** : voir sans pouvoir agir. | Contrôles câblés sur `resolve-stuck`, en deux temps, avec la mention explicite qu'aucun argent ne bouge. |
| 13 | P2 | Le toast admin affirmait **« remboursement déclenché »** à **chaque** approbation, y compris dans le cas ordinaire où le rail est fermé et où **rien** ne part. | Le composant lit l'état réel renvoyé par la route (`refunded` / `failed` / autre) et le dit. 3 clés ajoutées dans les 5 locales. |
| — | **P1** | **Base de prix fausse** : `Order.items[].price` est le prix **catalogue** alors que `Order.total` est le montant **réellement payé** (promotions, parrainage, fidélité). Sur toute commande remisée, Σ lignes > total, donc une réclamation sur **une** ligne se retrouvait plafonnée à la commande entière — exactement l'invariant que ce batch prétend établir. Scénario de l'auditeur : 2 × 15,00 € affichés, −50 %, 15,00 € payés → réclamer une part rendait 1500 c, soit 100 % de la commande. | Mise à l'échelle proportionnelle des lignes sur le montant payé. Ne fait que **réduire** : quand Σ lignes ≤ total (cas normal, frais au-dessus) le facteur vaut 1. |
| — | P3 | **L'opérateur de fenêtre pouvait survivre à sa propre autorisation** : le bail T-48 est plafonné à 30 min, donc au-delà de ~28 min l'opérateur continuait à afficher « WINDOW OPEN » alors que l'application avait déjà fermé la porte. Aucun risque d'argent (la porte échoue fermée), mais un **opérateur de preuve qui ment** est précisément la classe de défaut que ce train doit supprimer. | Refus explicite plutôt que raccourcissement silencieux : l'humain choisit une fenêtre légale. |

### 2.2 Défauts trouvés dans mes **corrections elles-mêmes** (re-audits)

| Constat | Nature |
|---|---|
| Ma première correction des approbations non payées était **INERTE** : j'avais relâché la garde pré-CAS mais laissé `arbitrationDecision: null` dans le `where` du CAS — Prisma traduit `null` en `IS NULL`, donc **0 ligne** appariée. Le test passait quand même. | Trouvé par re-audit, corrigé, plus `claimAuthority`. |
| Le **mock de test était aveugle au `where`** : `updateMany` renvoyait `count:1` pour n'importe quelle clause, ce qui rendait la régression CAS **indétectable**. | Le mock évalue désormais la clause `where` ; un contrôle négatif prouve que la suite vire au rouge si la régression est réinjectée. |
| **Échec CI après `ae98239`** : j'avais poussé après n'avoir lancé que des suites ciblées. La suite complète cassait sur 6 fichiers (mocks partiels sans `refundEmailDedupeKey`, `prisma.refund.aggregate` manquant, exports de listes manquants). L'exception était **avalée par un `try/catch` best-effort**, donc l'espion n'était jamais appelé. | Corrigé dans `25f391c`. Règle retenue : **un `try/catch` qui avale une exception ne prouve aucun effet de bord**. |

### 2.3 Défauts trouvés dans les correctifs du batch 2, par ma propre relecture

| Constat | Correctif |
|---|---|
| Le toast « catch-all » que je venais d'écrire affirmait « aucun remboursement n'est parti » **aussi** dans l'état `already_handled`, où un remboursement a pu **déjà** être tenté par un autre acteur. C'était **une nouvelle affirmation fausse** introduite par le correctif censé supprimer les affirmations fausses. | Reformulé dans les 5 locales : « aucun remboursement **confirmé par cette action** ». Ne dit que ce que l'action a réellement établi. |
| Les contrôles « argent bloqué » que je venais de câbler s'affichaient sur **les six** états de la liste, alors que `resolveStuckClaim` n'en accepte **qu'un seul** (`refundError` non nul + statut `approved`/`refunding`). Un bouton présent sur toutes les cartes aurait renvoyé 409 sur la plupart : l'UI aurait promis une action que le serveur refuse. | Prédicat unique `isStuckResolvable`, **exporté** et utilisé **à la fois** par la route et par la liste — les deux ne peuvent plus diverger. Les états non clôturables affichent la raison au lieu d'un bouton. Contrôle négatif : un prédicat toujours vrai est détecté. |

### 2.4 RE-AUDIT des correctifs du batch 2 — 4 auditeurs, 16 constats, **5 survivants**

Re-audit adversarial lancé **sur les correctifs eux-mêmes** (dimensions B vérité cumulative,
C asynchrone/réconciliation, D sécurité, E vérité admin), un réfuteur hostile par constat.
**16 constats candidats → 11 réfutés → 5 confirmés.** Les 5 sont corrigés ci-dessous.

| Sév. | Constat | Correctif |
|---|---|---|
| **P2 (conséquence argent)** | **Le toast disait « le remboursement a ÉCHOUÉ : aucun argent n'est parti » dans le cas exact où un remboursement Stripe venait de RÉUSSIR.** RESUME-FIRST peut reprendre un remboursement ANTÉRIEUR de la même commande et le faire aboutir : le moteur renvoie `ok`, **l'argent est parti**, et `triggerClaimRefund` rapporte quand même `state:'failed'` (`error:'resume_mismatch'`) parce qu'il n'a pas soldé CETTE réclamation. L'admin, informé du contraire de la vérité, refait un remboursement → **client payé deux fois**. C'est mon PROPRE correctif « toast véridique » qui repliait ce cas sur « échoué ». | Branche dédiée, placée AVANT `failed`. La correspondance est extraite dans une fonction pure `lib/claim-approval-toast.ts` pour être **testée** et non re-dérivée dans le composant. Copie FR : « de l'argent EST parti… Ne relancez aucun remboursement ». 2 contrôles négatifs (règle d'origine + mon premier correctif). |
| P2 | **La trappe « argent bloqué » renvoyait 403 aux admins que le projet provisionne réellement.** Ma route relisait `Operator.role` en base et exigeait `'admin'` — plus strict en apparence, cassé en pratique : `scripts/server/provision-admin.js` accorde l'admin en **INSÉRANT une ligne `OperatorRole`** et ne touche **jamais** `Operator.role`. Le fondateur passait le middleware, passait `/arbitrate` (donc pouvait **déplacer de l'argent réel**), et se faisait refuser sur la seule porte de déblocage. | La route utilise `resolveAdmin()` (garde canonique) : résolue depuis la SESSION, **relue en base** (la propriété qui comptait), sur l'ensemble réel des rôles. Test de route + contrôle négatif sur l'ancienne règle. |
| P2 | **La page d'aide conso affichait un « Montant demandé » que le serveur n'enregistre pas.** Elle sommait les prix **catalogue** des lignes cochées sans jamais lire le plafond que le correctif n°2 venait de rendre juste : sur une commande remisée ou déjà partiellement remboursée (Dashboard inclus), le client lisait 10,00 € et l'accusé de réception annonçait ensuite 5,00 €. La propriété affichée par le batch — plafond MONTRÉ = plafond APPLIQUÉ — ne tenait pas sur cette page. | Le montant affiché est borné au plafond serveur déjà récupéré par la page (il ne peut que **rétrécir**), plus une ligne qui explique le plafonnement (5 locales). |
| P3 | **Le tri sécurité s'arrêtait une étape avant l'écran de décision.** `listArbitrationQueue` est la **seule** liste portant les boutons approuver/refuser, et c'est là qu'atterrit toute réclamation sécurité refusée par le chemin machine puis routée par le restaurant. Elle restait triée par `createdAt` seul, sans indicateur. | `triageBySafety` appliqué à la file d'arbitrage + badge sur la carte. Contrôle négatif : l'ordre chronologique enterrait la ligne. |
| P3 | **Le balayage quotidien de récupération ne RETIRAIT jamais une ligne.** `reconcileClaimForRefund` passe un remboursement échoué en `approved` **avec** `refundError` — toujours dans le prédicat du balayage. Les mêmes réclamations étaient donc « réconciliées » chaque jour, réécrivant des valeurs identiques, annonçant un `reconciled: 1` perpétuel et occupant définitivement la fenêtre `take:200` devant les vraies réclamations bloquées. | Le prédicat exclut `refundError` non nul : une ligne déjà réconciliée attend un **admin**, pas un balayage de plus. Le chemin webhook, lui, n'est pas filtré — la vérité passe toujours. |

**Réfutés (11)** — dont plusieurs constats qui décrivaient des défauts **déjà corrigés** plus tôt
dans la même session (le bouton offert sur les 6 états, le balayage `auto_timeout` sans garde
sécurité, la formulation du toast sur un remboursement `pending`). Les réfuteurs l'ont vérifié
dans le code courant et les ont écartés à ce titre.

**Conséquence assumée** : l'état `stale_refunding_no_refund_row` (statut `refunding`, aucune ligne
`Refund`, aucune `refundError`) reste **sans sortie manuelle**. Élargir l'échappatoire à cet état
serait une modification de sémantique argent, pas le câblage d'un contrôle manquant : hors périmètre
de ce batch. **Consigné OPEN ci-dessous.**

---

## 3. Reste OPEN (assumé, non corrigé dans ce batch)

| # | Sév. | Constat | Pourquoi OPEN |
|---|---|---|---|
| — | P2 | **`stale_refunding_no_refund_row` sans sortie manuelle** : une réclamation passée en `refunding` dont aucune ligne `Refund` n'existe (le moteur a échoué avant de créer la ligne) n'est clôturable par aucune action admin. Elle reste visible dans la liste argent bloqué. | Élargir l'échappatoire à cet état est une décision de **sémantique argent**, pas le câblage d'un contrôle manquant. À trancher hors batch. |
| 3 / 5 | P2 | La **sélection d'articles n'est pas persistée** et il n'y a **aucun suivi de consommation par article** : deux réclamations successives peuvent viser la même ligne, chacune sous le plafond global. Le plafond **cumulatif en argent** empêche toute sur-restitution ; c'est la traçabilité par ligne qui manque. | Exige un **changement de schéma Prisma**. La consigne impose de S'ARRÊTER avant toute migration. Non entrepris. |
| T-42 | P1 | Financement Connect brut vs net. | Décision fondateur, hors périmètre Claims. |
| T-45 | P1 | Présentation conso d'une commande remboursée. | Explicitement exclu de ce batch. |
| T-46 | P1 | Comptabilité du résumé financier opérateur. | Explicitement exclu de ce batch. |
| T-47 | P2 | Deux remboursements du même montant sur la même commande suppriment le second e-mail. | Clé de dédup identifiée ; correction hors batch. |

**Limite de méthode assumée** : un client peut décrire une exposition allergène sous un motif
non-sécurité (« qualité »). Le tri sécurité est donc déclaratif. Aucune détection automatique
n'est prétendue.

---

## 4. Portes passées avant livraison

| Porte | Résultat |
|---|---|
| Suites ciblées de la zone modifiée | vertes |
| **Suite COMPLÈTE en local** | **392 fichiers, 4054 tests verts**, 5 skipped, 17 todo |
| Typecheck vs baseline connue | **41 erreurs = baseline exacte**, **0 nouvelle**, aucune hors `tests/` |
| Contrôle négatif du typecheck | une variante de bouton invalide injectée volontairement **fait bien échouer** le typecheck sur le composant modifié — la baseline propre n'est donc pas un angle mort |
| Complétude i18n | verte (5 locales) |
| YAML du cron | parse validé, étapes listées |
| Couplage de feature-flags (`scripts/check-flags.mjs`) | ✅ cohérent |
| Schéma Prisma | **0 ligne modifiée** — la porte « STOP avant migration » n’a jamais été franchie |
| Sondes runtime staging (avant push, lecture seule) | `POST /api/admin/refunds/run` → **403 `{gated:true}`** · `POST /api/claims` → **403 `{gated:true}`** |
| Flags | Claims, Refunds, Clean Room : **inchangés, fermés** |
