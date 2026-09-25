# CLAIMS D′ — SPÉCIFICATION D'IMPLÉMENTATION v2 (FIGÉE 2026-09-22, base `dab754d`)

> Décision fondateur (2026-09-22) : la décision D4 (« `CLAIMS_ENABLED=false` toute la bêta ») est
> abandonnée. Architecture retenue : **D′** — client 24/7 → restaurant 24/7 → décision Grubano 24/7 →
> file financière séparée → remboursement uniquement sous autorisation financière fail-closed.
> Cette page est la référence d'implémentation ; les règles R13 qu'elle remplace sont listées dans
> l'addendum v1.1 de `CLAIMS-T49-ROUND13-SPEC-v1.md` (les textes gelés y restent lisibles).

Conventions : **FAIT** = vérifié dans le code à `dab754d` ; **RÈGLE** = exigence ; **INTERPRÉTATION** = dérivée
d'une décision fondateur, acceptée explicitement le 2026-09-22 (GO Phase 1).

---

## 0. Décisions fondateur (finales)

| ID | Décision |
|---|---|
| D-1 | Ancre STRICTE : `Order.deliveredAt=null` ⇒ inéligible au self-service, aucun fallback `updatedAt` ; support manuel |
| D-2 | Réclamation SYSTÈME (annulation d'une commande payée) : suit la surface (gatée par `CLAIMS_SURFACE_ENABLED`, **pas** par INTAKE — ce n'est pas un dépôt client) |
| D-3 | Rail financier déclenché par SESSION ADMIN uniquement (`resolveAdmin`) ; ni `INTERNAL_CRON_TOKEN`, ni cron, ni dispatch GitHub comme déclencheur métier |
| D-4 | Lot : `dryRun` obligatoire → `confirm:'PAYER'` → max 20 → rapport individuel par réclamation |
| D-5 | Retrait d'une approbation fondé uniquement sur la frontière financière (aucune limite de temps) ; retour en `arbitration` ; jamais de `refused_final` silencieux |
| D-6 | Remboursement finalisé plus tard par webhook : E3 (avis post-fenêtre via console admin) + invariant FIN-EMAIL-01 ; pas d'e-mail depuis le webhook (H15 conservé) |
| D-7 | `restaurant_closed` retiré du choix client ; `excessive_wait`/`payment_issue` = choix explicite ; page d'aide alignée ; stepper quantité |
| D-8 | `/legal/cgv` ×5 locales + lien visible ; pas de checkbox de dépôt ; validation juridique du contenu avant production (hors spec — cette spec ne vaut pas validation juridique) |
| D-9 | Flags produit `CLAIMS_SURFACE_ENABLED` (lecture + workflow) et `CLAIMS_INTAKE_ENABLED` (nouvelles réclamations client) ; `CLAIMS_ENABLED`/`CLAIMS_WINDOW_UNTIL` restent l'outillage historique Mode A/B |
| D-10 | Arrêter les nouveaux dépôts = `INTAKE=false` ; `SURFACE=false` = kill-switch d'incident majeur seulement |
| D-11 | E-mail `approved` : montant réellement approuvé, « sera exécuté séparément », « une fois émis … dépend de votre banque », jamais « déjà émis » |
| D-12 | Restaurant : remboursement client brut / commission Grubano restituée / impact net ; jamais une estimation présentée comme une écriture Stripe confirmée |
| D-13 | `CLAIM_MAX_ORDER_AGE_DAYS = 30` (constante) ; fenêtre métier 48 h depuis `deliveredAt` |
| D-14 | Aucune ré-approbation admin n'est jamais un chemin d'argent ; v13 payables uniquement via `claimIds` explicites du rail |
| D-15 | Fidélité : prorata à `delivered` sur le cash effectivement conservé (arrondi cumulé §9 du contrat fidélité) ; 8 tests imposés |
| T-50 | `selection` persistée ; **aucune** consommation/blocage automatique par quantité historique en bêta ; dette ANTI-REPEAT ITEM CLAIM POLICY — POST-BETA |
| FIN-EMAIL-01 | Un avis attestant un refund Stripe `succeeded` ne dépend ni de SURFACE, ni d'INTAKE, ni d'un bail legacy ; dédup conservée |
| Interprétations acceptées | T1 amendé minimalement (§8.3) ; système gaté SURFACE ; rail refusé sous kill-switch ; retrait étendu aux preuves sans moteur ; `ADMIN_AUDIT_ENABLED='true'` obligatoire pour retrait et PAYER |

Automatismes toute la bêta : `CLAIMS_AUTO_APPROVE_ENABLED`, `CLAIM_AUTO_RESOLVE_ENABLED`, `GHOST_ORDER_AUTO_REFUND_ENABLED` = OFF ; `autoResolveSmallClaim` rendu inerte par construction ; aucun chemin machine n'écrit `status='approved'`.

---

## 1. Architecture cible

```
 ZONE MÉTIER — 24/7 sous CLAIMS_SURFACE_ENABLED='true' (jamais un bail)
   CLIENT ──dépôt (commande LIVRÉE, 48 h après deliveredAt, INTAKE)──▶ restaurant_review
                                          resto accept ──▶ arbitration ; resto refuse ──▶ refused ──contest──▶ arbitration
   SYSTÈME (annulation payée) ──────────────────────────────────────▶ arbitration
   ADMIN refuse_final ──▶ refused_final
   ADMIN approve(montant ≤ demandé, confirm) ──▶ APPROVED_AWAITING_PAYMENT   (aucun appel moteur, même RE ouvert)
   ADMIN withdraw_approval(confirm) ◀── correction d'erreur humaine, avant tout Stripe
   Récupération par preuve (R13) : non gatée, inchangée
 ═══════════════════ MONEY BOUNDARY (RE = REFUNDS_ENABLED + REFUNDS_WINDOW_UNTIL ≤ 30 min) ═══════════════════
   OPÉRATEUR autorisé ouvre un bail T-48 (opérateur pay-window, précheck T-42 par compte Connect)
   ADMIN (session) POST /api/admin/claims/pay-approved {dryRun} puis {confirm:'PAYER', token}
     sélection serveur = APPROVED_AWAITING_PAYMENT, FIFO, cap 20, RE relu AVANT chaque réclamation
     → triggerClaimRefund(claimId) [T1 amendé §8.3 ; T2..T4 inchangés] → executeRefund (moteur gelé, SHA épinglé)
     → Stripe → webhook → ledger → fidélité → avis post-argent → UI client/resto
   Bail expiré ⇒ arrêt immédiat, reste « non tenté », décisions métier intactes
```

Frontières : aucune écriture Stripe dans la zone métier ; seul appelant de `triggerClaimRefund` = le rail ; `lib/refund.ts` et `middleware.ts` intouchés ; vérité après coup (webhook, ledger, fidélité, réconciliation) inchangée.

---

## 2. Machine à états

### 2.1 Représentation (sans nouveau statut)
| État logique | Représentation |
|---|---|
| `restaurant_review`, `arbitration`, `refused`, `refused_final`, `refunding`, `refunded`, `financial_verification` | statuts existants |
| **APPROVED_AWAITING_PAYMENT** | `status='approved' ∧ arbitrationDecision='approved' ∧ refundAttempted=false ∧ refundId=null ∧ refundError=null ∧ arbitratedAt≠null ∧ approvedAmountCents≠null` |
| APPROVED héritée (à ratifier) | même forme avec `arbitrationDecision=null` ∨ `approvedAmountCents=null` — visible, jamais payable (population staging mesurée : 0) |
| Sous-états argent (`refundError` préfixés) | inchangés (R13) |

### 2.2 Transitions
| # | De → Vers | Acteur · route | Préconditions | Effets DB | Stripe | Concurrence |
|---|---|---|---|---|---|---|
| T-01 | ∅ → `restaurant_review` | client · `POST /api/claims` | `claimsIntakeOpen()` ; propriétaire ; `paymentStatus='paid'` ; **`status='delivered'`** ; `now−deliveredAt ≤ 48 h` ; `now−createdAt ≤ 30 j` ; motif canonique ; `scope` explicite (§5) ; montant ≤ `min(DB, Stripe)` | `Claim` + `selection` + `activeOrderKey` | 2 lectures | `activeOrderKey @unique` → 409 |
| T-02 | ∅ → `arbitration` (système) | resto/admin · `PATCH /api/orders/[id]/status` cancelled | `claimsSurfaceOpen()` ∧ `paid` ∧ total>0 | même transaction que l'annulation ; `selection={v:1,mode:'whole',modeSource:'system',…}` | non | P2002 → `already_active` |
| T-03 | `restaurant_review` → `refused` | resto · `respond` | scope établissement | `restaurantResponse/Reason`, `decidedBy='restaurant'`, `activeOrderKey=null` | non | CAS |
| T-04 | `restaurant_review` → `arbitration` | resto (accept) | idem | `restaurantResponse='accepted'` | **jamais** | CAS |
| T-05 | `refused` → `arbitration` | client · `contest` | ≤ 48 h après `decidedAt` ; `claimsSurfaceOpen()` | re-pose `activeOrderKey` | non | CAS + P2002 |
| T-06 | `arbitration` / `restaurant_review` échu → `refused_final` | admin · `arbitrate {decision:'refuse_final'}` | `arbitrationRefusal` (AM-B3 conservé) | terminal, `activeOrderKey=null`, closure record | non | CAS |
| **T-07** | `arbitration` / `restaurant_review` échu → APPROVED_AWAITING_PAYMENT | admin · `arbitrate {decision:'approve', approvedAmountCents, confirm:'APPROUVER', reason?, reduceReason?}` | `1 ≤ approvedAmountCents ≤ requestedAmountCents` ; `reduceReason` obligatoire si `<` ; plafond Stripe affiché (§7), avertissement bloquant si `>` reste | décision + `approvedAmountCents` écrits **une fois** ; audit `claim.arbitrate {moneyMoved:false}` ; e-mail `claim_decision_approved` (dédup par décision) | **jamais** | CAS `arbitrationDecision:null` |
| **T-08** | APPROVED héritée → APPROVED_AWAITING_PAYMENT (**ratification**) | admin · `arbitrate {decision:'approve', …}` | `status='approved' ∧ refundAttempted=false ∧ refundId=null ∧ approvedAmountCents IS NULL ∧ refundError ∈ {null, v13}` | CAS épingle `approvedAmountCents:null` ; écrit `approvedAmountCents`, `arbitrationDecision='approved'`, `arbitrationReason`, et `arbitratedBy/At`, `decidedBy='admin'`, `decidedAt` **seulement s'ils sont nuls** ; `refundError` v13 intact ; audit `claim.ratify` | jamais | `approvedAmountCents≠null` ⇒ 409 `APPROVE_ALREADY_SET` |
| **T-09** | APPROVED_AWAITING_PAYMENT → `arbitration` (**withdraw_approval**) | admin · `POST /api/admin/claims/[id]/withdraw-approval {reason≥10, confirm:'RETIRER'}` | §4 | §4 | jamais | CAS exclusif avec T1 |
| **T-10** | APPROVED_AWAITING_PAYMENT → `refunding` (T1) | rail · `pay-approved` PAYER → `triggerClaimRefund` | RE ∧ SURFACE strict ; sélection §8.5 ; `approvedAmountCents≠null` | T1 CAS amendé §8.3 | pas encore | un gagnant par pré-image |
| T-11..T-19 | T2/T4 existants (holds, park FV, preuve, refunded, 202, resume_mismatch, engine_failed, crash) | interne | inchangés ; montant = `approvedAmountCents` | oui (T3) | CAS `{refunding, M}` |
| T-20 | `refunding` (202) → `refunded` | webhook → `reconcileClaimForRefund` | ligne liée `succeeded` | `refunded`, closure record `noNoticeSource` | non | avis client par `closure-notice` (E3) |
| T-21 | `refunding` → `approved`+`stripe_failed:` | webhook `refund.failed` | ligne `failed` (verrou commande permanent, FAIT) | existant | non | existant |
| T-22..T-27 | FV → refunded/approved… (reconcile, attribute, adopt, stuck_close, reverted) | admin · routes non gatées | inchangés | lecture seule | inchangés |

Sorties de APPROVED_AWAITING_PAYMENT (D1 v1.1) : `pay` (rail, gaté RE ∧ SURFACE) · `withdraw` (admin) · `approve` refusé (`APPROVE_ALREADY_SET`) · `refuse_final` refusé (AM-B3) · `reconcile` refusé (réclamation saine). v13 après instant : `pay` via `claimIds` explicite + `reconcile`.

---

## 3. Contrat des flags

### 3.1 Définitions (`lib/claim-flags.ts` — lit `process.env` seulement, n'importe rien ; `lib/claims` ré-exporte `isClaimsEnabled`)
```
isClaimsSurfaceEnabled() = CLAIMS_SURFACE_ENABLED === 'true'
isClaimsIntakeEnabled()  = CLAIMS_INTAKE_ENABLED  === 'true'
isClaimsEnabled()        = bail legacy (CLAIMS_ENABLED + CLAIMS_WINDOW_UNTIL ≤ 60 min) — logique inchangée
claimsSurfaceOpen()      = isClaimsSurfaceEnabled() || isClaimsEnabled()
claimsIntakeOpen()       = isClaimsSurfaceEnabled() ? isClaimsIntakeEnabled() : isClaimsEnabled()
claimNoticeGate(cls)     = cls === 'pre_money' ? claimsSurfaceOpen() : true     // 'post_money' | 'closure'
```
- Flags produit prioritaires : `SURFACE='true'` ⇒ bail legacy inerte ; `SURFACE` absent ⇒ le bail ouvre surface+intake (Mode A/B).
- `INTAKE='true'` sans `SURFACE='true'` ⇒ rien ; `check-flags.mjs` : ERREUR `CLAIMS_INTAKE_ENABLED ⇒ CLAIMS_SURFACE_ENABLED` ; WARNING si `SURFACE='true'` et `CLAIMS_ENABLED='true'` ; WARNINGS §19 T-53 limités au bail ; aucun couplage à `REFUNDS_ENABLED`.
- `'TRUE'`/`'1'`/`''` ⇒ OFF.

### 3.2 Matrice
| Surface | SURFACE=true · INTAKE=true | SURFACE=true · INTAKE=false | SURFACE=false (kill-switch) |
|---|---|---|---|
| `POST /api/claims` | 201 | **403 `{error, gated:false, enabled:true, intakeOpen:false, reason:'intake_closed'}`** (sondes ⇒ UNKNOWN, jamais CLOSED) | 403 `{gated:true}` |
| `GET /api/claims?orderId` | `{enabled:true, intakeOpen:true, eligibility}` | overlay route : `not_owner` inchangé ; sinon `{...e, canClaim:false, reason:'intake_closed'}` — `existingClaim`/`scope` conservés | `{enabled:false}` |
| `GET /api/claims` (historique), `contest` | ok | ok | `{enabled:false}` / 403 |
| Réclamation système | créée | créée | non créée (variante Off + alerte admin) |
| Resto liste/historique/respond | ok | ok | `{enabled:false}` / 403 |
| Admin arbitrate / ratify / withdraw | ok | ok | 403 |
| `GET /api/admin/claims` | complet | complet | **scindé** : `enabled:false`, listes workflow `[]`, **`actionableRefunds` + `approvedAwaitingPayment` toujours renvoyés**, `counts.actionableTotal = money` |
| FV, lignes non finalisées, avis non envoyés, « À rembourser », census | visibles | visibles | **visibles** |
| Rail `dryRun` | ok | ok | ok (lecture) |
| Rail `PAYER` | **`isRefundsEnabled() ∧ isClaimsSurfaceEnabled()`** strict (jamais le bail legacy) | idem | **403** `{gated:true, flag:'CLAIMS_SURFACE_ENABLED'}` |
| E-mails pré-argent automatiques | envoyés | envoyés | sautés `claims_disabled` |
| Avis post-argent / clôtures explicites | envoyables | envoyables | **envoyables** |
| Récupération par preuve, webhook | ok | ok | ok |
| Badge admin | workflow + argent | idem | 0 + argent |
| auto-approve / auto-resolve / ghost | OFF | OFF | OFF |

### 3.3 Sites (FAIT : 25 lecteurs de `isClaimsEnabled()`, tous côté appelant)
- INTAKE : `POST /api/claims:43` ; overlay GET ; formulaires client (`intakeOpen`).
- SURFACE : GET `/api/claims:127` (première instruction), `contest:17`, `restaurant:13`, `respond:25`, `admin/claims:13` (scindé), `arbitrate:28`, `stale-alerts:24`, `status/route.ts:123` (`claimsOn = claimsSurfaceOpen()`) et `:246` (`claimsOpenNow = claimNoticeGate('pre_money')`), `orders/page.tsx:165`, `admin/claims/page.tsx:40` (cartes argent hors `claimsOpen &&`), `admin-overview.ts:78`, `admin-establishments.ts:111` (états argent hors ternaire), `census`.
- Bail legacy + flag propre : `auto-approve/route.ts:32` seulement. `autoResolveSmallClaim` : inerte (`{state:'not_eligible'}` inconditionnel, branche `claims/route.ts:107-118` retirée).
- Nouveaux : `withdraw-approval` (SURFACE), `ceiling` (SURFACE), `pay-approved` (dryRun admin ; PAYER RE ∧ SURFACE strict), `rows/[rowId]/notify` (admin, non gaté), `admin/loyalty/reconcile` (admin, non gaté).

### 3.4 Opérateurs historiques
| Outil | Sous flags produit | Changement L1 |
|---|---|---|
| `phase2-claims-gate.js` (Mode A) | sonde OPEN ⇒ refuse (`:475`) ; precheck disait READY | anomalie precheck + refus **nommant** le flag ; sonde UNKNOWN sur `intake_closed` ⇒ refus |
| `phase2-modeb-gate.js` (Mode B) | refuse (`:495/:592`) | message nommant le flag |
| `phase2-refund-gate.js window` | ne sonde que `refunds/run` | refus si SURFACE/INTAKE `'true'` ; sonde `POST /api/claims` ajoutée ; impression |
| `phase2-backup-neutralize.js` | garde les deux baux | inchangé |
| `env-provenance.js` `WATCHED_SECRET_KEYS` | | + 2 flags |
| Runbooks Mode A/B | | en-tête « valides uniquement avec SURFACE/INTAKE absents ; historique figé (Mode A 2026-09-15→18, Mode B 2026-09-22 `dab754d`) » |

Incompatibilités : bail legacy inerte sous SURFACE ; Mode A/B impossibles en bêta ; Mode B non reproductible sur D′ par construction (approve ≠ argent) ; combiné archivé ; `refund-rehearsal.yml` inapte au rail réclamations ; le bail legacy n'ouvre jamais le rail.

### 3.5 Procédures
- Bêta : `SURFACE=true`, `INTAKE=true` dans `.env.local` seulement (jamais l'UI cPanel) + restart + provenance ; preuves `POST /api/claims` 401, `GET /api/admin/claims` liste.
- Suspendre l'intake : `INTAKE=false` + restart ; preuve POST 403 `intake_closed`.
- Kill-switch : `SURFACE=false` **et** `INTAKE=false` **et** `CLAIMS_ENABLED` absent/false (sinon emergency-close d'abord) + restart + provenance ; preuves POST 403 `{gated:true}`, `GET /api/admin/claims` `{enabled:false, actionableRefunds:[…]}`.

---

## 4. Retrait d'une approbation (withdraw-approval)

Route `POST /api/admin/claims/[id]/withdraw-approval` · `{ reason: string ≥ 10, confirm: 'RETIRER' }` · `resolveAdmin()` · `rateLimit 'admin_claims_withdraw' 10/60` · gate `claimsSurfaceOpen()` · **409 `audit_disabled` si `ADMIN_AUDIT_ENABLED !== 'true'`**.

Préconditions (lues immédiatement avant le CAS) :
1. Forme : `status='approved' ∧ arbitrationDecision='approved' ∧ refundAttempted=false ∧ refundId=null ∧ refundError ∈ {null, `no_refund_proven:v13:`…, `no_refund_proven_rail_locked:`…}` (textes écrits uniquement par des chemins sans moteur avec 0 ligne propre) ; `refund_safety_hold:` (`refundAttempted=true`) et tout autre `refundError` ⇒ 409 « état argent enregistré : réconciliez ».
2. `prisma.refund.count({ where: { orderId, reason: 'claim:<id>' } }) === 0` (estampille, tout statut). Miroirs `external:` couverts par `refundId=null`. Lecture en échec ⇒ 409.
3. Aucune limite temporelle. Une tentative restaurée par `revertPreImage` (0 moteur, 0 ligne) n'interdit pas le retrait.

Transaction unique (client racine) : `updateMany` CAS sur la forme (dont `refundError: before.refundError`, `approvedAmountCents: before.approvedAmountCents`) → `data { status:'arbitration', arbitrationDecision:null, arbitratedBy:null, arbitratedAt:null, arbitrationReason:null, decidedBy:null, decidedAt:null, approvedAmountCents:null }` ; `count !== 1` ⇒ 409 ; puis `adminAuditLog.create({ action:'claim.withdraw_approval', metadata:{ previousArbitratedBy, previousArbitratedAt, previousArbitrationReason, previousApprovedAmountCents, previousDecidedAt, previousRefundError, reason, moneyMoved:false } })` — échec ⇒ rollback. `activeOrderKey` conservé.

Exclusivité avec le rail : même ligne, même pré-état que T1 ⇒ au plus un gagnant. Effets : e-mail `claim_approval_withdrawn` (pré-argent), dédup `claim:<id>:withdrawn:<previousArbitratedAt ISO>` ; statut client `arbitration` ; pas de closure record ; l'admin re-décide explicitement ; pin statique « la route n'écrit jamais `refused_final` ».

---

## 5. Sélection / T-50

- `Claim.selection Json?` : `{ v:1, mode:'items'|'amount'|'whole', modeSource:'client'|'derived'|'system', lines:[{index,itemId,qty,unitCents,name}], requestedCents, ceilingVerified:boolean }` — jamais un montant/id Stripe ; écrite dans le même `create` ; système : `{mode:'whole', modeSource:'system', lines:[], …}` ; legacy `null` ⇒ « Sélection non enregistrée ».
- `POST /api/claims` : champ `scope` explicite (ITEM_REQUIRED forcé `items` ; ITEM_OPTIONAL obligatoire, 400 sinon ; `not_received` défaut `whole` ; `excessive_wait`/`payment_issue` explicite) ; `items` ignorés si `scope≠'items'` ; `picked` vidé au changement de motif ; `restaurant_closed` retiré ; page d'aide alignée + stepper.
- **Aucune consommation automatique** : `buildClaimScope`/`resolveClaimAmount` inchangés. Protections : `activeOrderKey`, plafond argent restant, historique.
- Signal visuel non bloquant `previouslyClaimed[index] = [{claimId, status, qty}]` rendu admin et restaurant, **pas au client**.
- Dette : **ANTI-REPEAT ITEM CLAIM POLICY — POST-BETA** (voir `POST-BETA-CLAIMS-BACKLOG.md`).

---

## 6. Notifications post-argent (FIN-EMAIL-01)

### 6.1 Classes
| Classe | Gate | Déclencheurs |
|---|---|---|
| Pré-argent (automatiques) | `claimNoticeGate('pre_money') = claimsSurfaceOpen()` | `claim_ack`, `claim_decision_accepted/refused`, `claim_decision_approved`, `claim_decision_refused_final` inline, `claim_approval_withdrawn`, `order_cancelled` variante « demande transmise », resto (1)(2) |
| Post-argent (Stripe prouvé) | `true` | `claim_decision_refunded` (rail), clôture H06 `refunded`/`refundedLinked`/`refundRecorded`, `refund_confirmation`, resto (3) |
| Clôtures terminales explicites | `true` | `closure-notice` toutes sortes, `resolve-stuck` |

### 6.2 Sites (classe choisie par le fichier appelant)
`POST /api/claims` (ack) → pre ; `respond` → pre ; `status/route.ts` → pre ; `arbitrate` → pre ; `withdraw-approval` → pre ; `pay-approved` → post ; `closure-notice`, `reconcile`, `attribute`, `resolve-stuck` → `'closure'` ; `rows/[rowId]/notify` → post. Senders inchangés (paramètre `claimsOpen` conservé). Pin J-C21 remplacé : chaque appel porte `claimsOpen: claimNoticeGate('pre_money'|'post_money'|'closure')` conforme ; contrôle négatif : `claimsOpen: true`, `isClaimsEnabled()`, `claimsSurfaceOpen()` littéraux = violations ; `H15_IMPORTERS` liste explicite étendue.

### 6.3 E3 — avis différés
- Aucun envoi depuis le webhook (H15). R13 §23 amendé par §26 (v1.1).
- Lignes support « non notifiées » = `Refund.status='succeeded' ∧ stripeRefundId≠null ∧ reason NOT LIKE 'claim:%' ∧ idempotencyKey NOT LIKE 'external:%' ∧ aucun lieur (`Claim.refundId=row.id`) ∧ aucune `EmailDispatch('refund_confirmation', k)` pour `k ∈ {refund:<re_>, refund:<rowId>}`.
- `POST /api/admin/refunds/rows/[rowId]/notify` (`resolveAdmin`, non gaté) : relit ces conditions (409 `claim_bound`/`already_sent`) **et** `stripe.refunds.retrieve(re_)` dans la requête (lecture seule) : `succeeded` + montant entier > 0 ; `failed/canceled` ⇒ 409 + alerte `support_row_reverted` ; envoie `refund_confirmation` (`refund:<re_>`) + resto (3). Importe `lib/stripe` (lecture) et `lib/transactional-emails` ; jamais `lib/refund` ni `lib/claim-emails`.
- Lignes réclamation : `closure-notice` existant (envoie aussi resto (3)). Carte « Avis non envoyés » étendue aux lignes support ; l'opérateur pay-window imprime la liste après fermeture.
- Dédup `@@unique([trigger, dedupeKey])` inchangée.

### 6.4 E-mail `approved` (D-11)
`sendClaimDecisionEmail` gagne `approvedCents` (valeur = `approvedAmountCents` relu après le CAS) ; `approved.body` ×5 : fr « Un remboursement de {euros} a été approuvé par Grubano. Il sera exécuté séparément par notre équipe. Une fois émis, le délai d'apparition sur votre compte dépend de votre banque. » ; verbes imposés en *carried out / processed*, es *ejecutado / tramitado*, it *eseguito*, ar *تنفيذ* (jamais refund/pay/reembolsado/rimborsato/استرداد) ; dédup **par décision** `claim:<id>:approved:<arbitratedAt ISO>`.

### 6.5 Restaurant (D-12)
Bloc financier (projection + e-mail (3)) lu dans `LedgerEntry {type:'refund', sourceEventId:<re_>}` : brut = `−grossAmount` ; commission restituée = `−applicationFeeAmount` ; impact net = `netToRestaurant` — **jamais** `Refund.restaurantReverseCents/applicationFeeRefundCents` (prédiction, FAIT `lib/refund.ts:808-824`, jamais réécrite). Sans ligne ledger : bloc absent, avis (3) non envoyé (`ledger_line_missing`).

---

## 7. Contrats UX

### 7.1 Éligibilité client (même liste, même ordre dans `createClaim` et `getClaimEligibility`)
| # | Règle | `reason` |
|---|---|---|
| E1 | commande existe et propriétaire | `not_owner` |
| E2 | `paymentStatus === 'paid'` | `not_paid` |
| E3 | **`status === 'delivered'`** (annulée payée = réclamation SYSTÈME ; `picked_up` bloqué = support) | **`not_delivered`** (nouveau, ×5 locales) |
| E4 | `deliveredAt !== null ∧ now − deliveredAt ≤ 48 h` (ancre `deliveredAt`, jamais `updatedAt`) | `window_expired` |
| E5 | `now − createdAt ≤ CLAIM_MAX_ORDER_AGE_DAYS (30)` (invariant ≤ `LOGISTICS_ORDER_COORDS_RETENTION_DAYS`) | `window_expired` |
| E6 | plafond `min(total − ΣRefund succeeded, capturé − remboursé Stripe)` ; 0 ⇒ refus | (scope) |
| E7 | supprimée (T-50 : pas de consommation) | — |
| E8 | pas de réclamation active ; `existingClaim` calculé **avant** E3 | `active_claim` |
| — | overlay route : `claimsIntakeOpen()` faux ⇒ `intake_closed` (sauf `not_owner`) | `intake_closed` |
Message serveur `lib/claims.ts:376` remplacé par un code rendu par clé i18n. Writers de `deliveredAt` : `status/route.ts:130-133` et `:153-156` (même write, jamais réécrit) ; le seed démo ne le pose pas.

### 7.2 Client
Formulaire sans présélection (tri-état) ; statuts `claims.status.*` inchangés ; `refundedRowProven` durci (`succeeded ∧ stripeRefundId≠null`, jamais `pending`) ; historique « Mes réclamations » dans `/eat/account` ; `refundSummary` dérivé (Refund succeeded + ledger refund par PI + LoyaltyTransaction), `paymentStatus` intact, calculé seulement si PI présent et statut terminal ; badge « Remboursée X € » seulement prouvé ; « points repris » remplace « crédités » si `earn_reversal`.

### 7.3 Restaurant
Projection sûre (`select` explicite ; jamais `consumerId/refundError/refundId/arbitratedBy/contestReason/activeOrderKey/decidedBy`) ; `?view=history` whitelisté ; vocabulaire `received / answered_refused / grubano_deciding / approved_awaiting_refund / refunded / refusal_confirmed|refused_by_grubano / closed` ; réclamations système incluses ; onglets « À répondre » / « Historique » ; T-46 : `/api/finance/summary` ajoute `refundedCents`, `netReversedCents`, `refundsCount` depuis les lignes ledger `refund` (`caBrut` inchangé, `netResto −= netReversedCents/100`, pin « refund ⇒ commission nette » conservé) ; e-mails resto (1) reçu, (2) décidé (pré-argent), (3) remboursé (post-argent, ledger).

### 7.4 Admin
Dialogue d'approbation obligatoire (demandé · reste remboursable Stripe via `GET /api/admin/claims/[id]/ceiling` · déjà remboursé · sélection · montant approuvé · case réduction + motif · note « aucun remboursement déclenché ») ; toast nominal `admin.approvedNotSent` réécrit ; file « À rembourser (n) » (forme exacte, FIFO `arbitratedAt`) avec « Retirer l'approbation » et « Payer le lot (n) » (actif seulement si `refundGateState().open`) ; sous-liste « À ratifier » ; relabel `legacy_pending_money_decision` → `awaiting_payment` ; guidances F15/AM-B3 sans « approuvez-la à nouveau » ; FV inchangée.

---

## 8. Rail financier

### 8.1 Surface
`POST /api/admin/claims/pay-approved` · `resolveAdmin()` · `rateLimit 'admin_claims_pay_approved' 5/60` · 409 `audit_disabled` si audit OFF (PAYER) · **jamais** `INTERNAL_CRON_TOKEN`.

### 8.2 dryRun → PAYER
- `dryRun:true` (non gaté RE/SURFACE) : sélection §8.5 ; préflight par réclamation **sans écriture** : `preflightRefundFunding` (`held:routed_without_fee`), lecture live `charge.amount − amount_refunded` (`held:exceeds_refundable`), ligne `Refund pending` sur la commande (`held:order_has_pending_row`), `refundGateState()` ; renvoie la liste + **jeton** = `base64url(JSON{v:1, adminId, sha:DEPLOYED_SHA, iat, lease:expiresAt, items:[{claimId, approvedAmountCents, arbitratedAt}]}) + '.' + HMAC-SHA256(derive(NEXTAUTH_SECRET,'claims-pay-approved-v1'), payload)`, validité 10 min, ≤ 20 items.
- PAYER `{confirm:'PAYER', token}` : `isRefundsEnabled() ∧ isClaimsSurfaceEnabled()` sinon 403 ; vérifie signature/exp/adminId/sha ; **paie uniquement les items du jeton, dans l'ordre, jamais de re-sélection** ; par item : relecture (forme, `approvedAmountCents`, `arbitratedAt`) sinon `skipped:stale_dryrun` ; `refundGateState()` relu avant chaque item, marge 60 s ; budget 40 s (`not_reached`) ; rejeu d'un jeton consommé inoffensif.

### 8.3 Amendement T1 — seul delta de `triggerClaimRefund`
```
T1_SELECT += approvedAmountCents, arbitrationDecision
après la porte RE et la lecture de before :
  const payable = before.approvedAmountCents
  if (before.arbitrationDecision !== 'approved' || payable == null || !Number.isInteger(payable) || payable <= 0 || payable > before.requestedAmountCents)
      return { state:'failed', error:'amount_not_ratified' }     // 0 écriture
T1 CAS where += { arbitrationDecision:'approved', approvedAmountCents: payable }
`requested` → `payable` aux 6 usages (:767, :844, :899, :938-942, :992/:1028, :1025)
```
T2/T3/T4 sinon byte-identiques ; `reconcileNoRowByDerivation` (`:2525/:2548`), alerte FV (`:2116-2131`), `reconcileClaimEvidence` (`:3642`) lisent `approvedAmountCents ?? requestedAmountCents`.

### 8.4 Ratification
Voir T-08. `approvedAmountCents` n'a que deux écrivains : ratification/première décision (CAS épinglant `null`) et le retrait (remise à `null`) — S-29.

### 8.5 Sélection
`where {status:'approved', refundAttempted:false, refundId:null, refundError:null, arbitrationDecision:'approved', approvedAmountCents:{not:null}}`, `orderBy [{arbitratedAt:'asc'},{createdAt:'asc'}]`, `take ≤ 20` ; v13 exclus sauf `claimIds`. Un id hors sélection ⇒ `skipped:not_selectable`.

### 8.6 Rapport par réclamation
| Résultat | `outcome` | Suite |
|---|---|---|
| `refunded` | `paid {refundId, amountCents}` + avis post-argent | continue |
| `pending/stripe_pending` | `accepted_pending {refundId}` — aucun e-mail | continue |
| `pending/refunds_disabled` | `lease_closed` | **stop**, reste `not_attempted` |
| `already_handled` | `state_changed_since_dryrun` — jamais « payée » | continue |
| `failed/attempt_superseded` | `superseded` | continue |
| `failed/amount_not_ratified` | `not_paid:amount_not_ratified` | continue |
| `failed/{safety_hold, proof_stale, own_row_exists, unconfirmed_within_window, safety_check_unreadable}` | `held:<cause>` (0 €) | continue |
| `failed/{resume_mismatch, identity_unverified, engine_own_row}` | `review:<cause>` « argent possiblement déplacé, preuve requise » | continue |
| `failed/<erreur moteur>` | `not_paid:<erreur>` | continue |
| `throw` (catch par réclamation) | `crashed {engineCalled:unknown}` | **stop**, 200 avec rapport partiel |
Audit `claim.pay` par réclamation + `claim.pay_batch`. Aucune alerte nouvelle (toutes existent dans `triggerClaimRefund`).

### 8.7 Le rail ne fait jamais
n'écrit ni `arbitratedBy/At`, `arbitrationDecision`, `decidedAt`, `approvedAmountCents` ; n'importe ni `executeRefund`, ni `@/lib/stripe` en écriture, ni `INTERNAL_CRON_TOKEN` ; ne crée ni objet Stripe ni ligne `Refund` ; `refundGateState(` ≥ 2 occurrences ; jamais de re-sélection sous PAYER.

### 8.8 Opérateur `phase2-claims-pay-window.js` (nouveau ; réutilise `writeFlag`/`emergencyRefreeze` exportés par `phase2-refund-gate.js`)
Precheck : `version.json.commit ∈ CERTIFIED_SHAS`, `CLAIMS_SURFACE_ENABLED='true'`, `CLAIMS_ENABLED` absent/false, flags machine false, sélection recalculée en DB via `lib/claims-payable-core.js` (pur, partagé avec le dryRun, ajouté à la liste `cp` du workflow), **T-42 par compte Connect destination** (`available ≥ Σ approvedAmountCents du compte`, tout manque ⇒ WAIT) ; ouvre `REFUNDS_WINDOW_UNTIL` puis `REFUNDS_ENABLED` ; restart prouvé ; attend `stoppedBy` ou TTL ≤ 28 min ; referme (bail d'abord) ; sonde 403 ; `backup-neutralize` ; imprime les avis non envoyés. N'écrit jamais un flag CLAIMS. Cadence : un créneau par jour ouvré si file non vide.

---

## 9. Modèle de données

Colonnes additives nullables (aucune contrainte, aucun backfill) :
```prisma
model Claim { approvedAmountCents Int?   selection Json? }
model Order { deliveredAt DateTime? }
```
Migration : opérateur `scripts/server/dprime-staging-migrate.js` (STAGING seul, mysqldump vérifié, baseline, 3 × `ALTER TABLE … ADD COLUMN IF NOT EXISTS … NULL`, vérification `information_schema`, préservation des comptes, idempotent, PASS/FAIL, aucun secret) — **jamais** `prisma-push.sh` (chemins production, non déployé, diff global) ni `--accept-data-loss`. Ordre : L3a (opérateurs seuls) → migrate PASS → L3b (schéma) → `dprime-regen-client.js` PASS (preuve : `approvedAmountCents` et `selection` dans `index.d.ts` + regex `OrderScalarFieldEnum … deliveredAt`) → restart → `schemaReady()` (probe mise en cache) exposé au recensement ; `schemaReady=false` ⇒ 503 sur pay/withdraw/approve/POST claims ; **aucun repli** sur `requestedAmountCents`. Rollback : code = re-dispatch SHA précédent ; schéma = colonnes conservées.

Compatibilité (recensement MESURÉ 2026-09-22T17:11Z) : 9 réclamations = `refunded` 4, `refused` 3, `refused_final` 2 ; active 0 ; `approvedUnpaid` 0 ; FV 0 ; `closure.missing` 0 ; `terminalWithoutRecord` 4. Aucune réinterprétation, aucun backfill.

---

## 10. Invariants de sécurité (testables)

| ID | Invariant |
|---|---|
| S-01 | Aucune action restaurant n'atteint `executeRefund`/`triggerClaimRefund` |
| S-02 | `arbitrateClaim`, `approveClaim`, le balayage n'appellent jamais `triggerClaimRefund` — même RE ouvert, même bail legacy ; aucun chemin machine n'écrit `status='approved'` |
| S-03 | RE fermé ⇒ 0 `stripe.refunds.create` sur toute la zone métier, flags quelconques |
| S-04 | Seul appelant HTTP de `triggerClaimRefund` = `pay-approved` PAYER, session admin |
| S-05 | Rail : `refundGateState()` relu avant chaque réclamation, marge 60 s, arrêt sans écriture |
| S-06 | Le rail n'écrit jamais `arbitratedBy/At`, `arbitrationDecision`, `decidedAt`, `approvedAmountCents` |
| S-07 | Une décision approuvée n'est jamais transformée en refus par le rail, Stripe, un bail ou un flag |
| S-08 | ≤ 1 appel moteur par pré-image (MariaDB 2 processus 20/20) |
| S-09 | Retrait ⊥ paiement (MariaDB 20/20 + contrôle négatif) |
| S-10 | `1 ≤ approvedAmountCents ≤ requestedAmountCents` ; jamais augmenté hors nouvelle décision après retrait |
| S-11 | Montant moteur === `approvedAmountCents` épinglé par le CAS T1 === textes de preuve/mismatch |
| S-12 | **Équivalence des portes** : flags produit absents ⇒ `claimsSurfaceOpen ≡ claimsIntakeOpen ≡ isClaimsEnabled` sur tous les sites. Départs énumérés, voulus, indépendants des flags : (a) avis post-argent/clôtures envoyables, (b) états argent comptés/visibles sans porte, (c) approve ≠ argent, (d) `payable = approvedAmountCents`, (e) delivered-only + `deliveredAt` + D-15, (f) routes nouvelles non gatées |
| S-13 | Les flags produit n'ouvrent ni auto-approve, ni auto-resolve, ni ghost ; aucun couplage à `REFUNDS_ENABLED` ; INTAKE ⇒ SURFACE (ERREUR) |
| S-14 | Opérateurs Mode A/B et `refund-gate window` refusent (message nommant le flag) si SURFACE/INTAKE `'true'` ; `pay-window` refuse si SURFACE absent, `CLAIMS_ENABLED='true'`, ou `version.json.commit ∉ CERTIFIED_SHAS` ; le bail legacy n'ouvre jamais le rail |
| S-14b | v13 jamais sélectionnée automatiquement ; payable seulement via `claimIds` explicite après son instant |
| S-15 | `lib/refund.ts` SHA (LF) et `middleware.ts` inchangés |
| S-16 | `status≠'delivered'` ⇒ 409 ; ancre immobile sous rebond `updatedAt` ; `createdAt` > 30 j ⇒ refus ; `deliveredAt=null` ⇒ refus |
| S-17 | Réclamation système reste créable (bypass E3) sous SURFACE, INTAKE quelconque |
| S-18 | Plafond `min(DB, Stripe)` reste la borne ; aucune règle de lignes n'ajoute d'autorité |
| S-19 | Projection resto sans champs internes ; bloc financier ⇔ ligne ledger `refund` du `re_` |
| S-20 | « Remboursée »/« refunded » exigent `succeeded ∧ stripeRefundId≠null` ∧ ligne non libérée |
| S-21 | Aucun texte client/resto du cycle ne contient un délai bancaire chiffré ni « sera remboursé(e)/payé(e) » (5 locales) |
| S-22 | `refunds_disabled` n'est plus une cause d'alerte ; 0 alerte par approbation |
| S-23 | `INTAKE=false` ⇒ `POST /api/claims` 403 `intake_closed` ; GET/contest/resto/admin/rail inchangés ; aucune réclamation masquée |
| S-24 | `SURFACE=true ∧ INTAKE=false ∧ RE=false` ⇒ workflow existant fonctionne (sauf POST client), 0 `refunds.create`, 0 `Refund` créée |
| S-25 | Tout avis post-argent reste envoyable avec `SURFACE=false ∧ INTAKE=false ∧` bail absent |
| S-26 | Aucune quantité historique ne refuse une sélection |
| S-27 | T1 refuse sans écriture toute réclamation `approvedAmountCents=null` ; aucun repli sur `requestedAmountCents` ; `schemaReady()=false` ⇒ 503 |
| S-28 | Fidélité : à `delivered`, points nets = `E − min(round(E×ΣR_i/T), E)` (deltas cumulés, jamais un arrondi par événement) ; T=1410, E=14, 470×3 ⇒ −5/−4/−5, net 0 ; 705 ⇒ −7 ; rejeu ⇒ 0 écriture ; quel que soit l'état des flags |
| S-29 | `approvedAmountCents` : écrivains = ratification/première décision (CAS épinglant `null`) et retrait (`null`) ; tout autre = violation |
| S-30 | Retrait et PAYER exigent `ADMIN_AUDIT_ENABLED='true'` ; le retrait est transactionnel avec son audit |

---

## 11. Plan d'implémentation

| Lot | Contenu | Préalables |
|---|---|---|
| L0 | Recensement mesuré ; addendum R13 v1.1 ; contrat fidélité ; docs périmées ; dette ANTI-REPEAT ; script `typecheck` + baseline | — |
| L2 | Approve = décision (3 appels inline retirés, balayage étape 2 supprimé, machine ⇒ `arbitration`, `autoResolveSmallClaim` inerte, `refunds_disabled` supprimé, audit `moneyMoved:false`, copies, exit table D1 v1.1) | — |
| L1 | Flags produit (`lib/claim-flags.ts`, 25 sites, `intake_closed`, GET admin scindé, opérateurs, `WATCHED_SECRET_KEYS`, check-flags, docs, pins) — pin S-02 dans ce commit | L2 |
| L3a | `dprime-staging-migrate.js` + `dprime-regen-client.js` seuls | L0 |
| L3b | `schema.prisma` (3 colonnes + commentaires) ; regen ; `schemaReady` | L3a PASS serveur |
| L4 | Approbation avec montant, ratification, T1 amendé, « À rembourser », withdraw, e-mail `approved` | L3b regen PASS |
| L5 | Rail + `claims-payable-core` + pay-window + différentiel + MariaDB | L4 |
| L6 | Éligibilité delivered-only, `deliveredAt`, plafond, D-15 + route de réparation | L3b |
| L7 | T-50 | L3b |
| L8 | Restaurant | L4 |
| L9 | Client T-45 + E3 | L5 |
| L10 | Textes + CGV | — |
| L11 | Certification + répétition staging D′ (autorisation séparée) | L1-L10 |
| L12 | Préparation production (fondateur) : `dprime-prod-migrate.js` ; `main` ne reçoit L3b qu'après PASS prod | L11 |

Ordre dur : L0 → L2 → L1 → L3a → L3b → L4 → L5 → L6/L7/L8 → L9 → L10 → L11. Chaque lot : build frais, suite complète, i18n, typecheck vs baseline (0 erreur produit, `comm -13` vide), commit séparé, push `develop`. Les pins à inverser sont listés dans la spec v2 (§8.9 du rendu fondateur) et rappelés dans chaque commit.

### L6 — D-15 détail
> **Amendé par L6.1 (arbitrage fondateur 2026-09-25, option (a)).** La séquence ci-dessous reste exacte pour l'ancre, l'ordre d'exécution, la source de l'ensemble et la route de réparation. Ce qui change : la persistance ne somme plus des deltas par événement keyés sur le `re_`, elle **converge vers la cible cumulative** (cible de l'ensemble prouvé − effet réellement appliqué, écrit en une ligne d'ajustement). Voir `LOYALTY-REFUND-CONTRACT.md` §9/§10/§16 et §24 (7) « CLOSED BY L6.1 ». La composition avec `recoveryOffsetPoints` est **DIFFÉRÉE À T-44 PRE-LIVE** (§24 (8)).

Ensemble DB-connu = union dédupliquée par `re_` de `Refund {orderId, status:'succeeded', stripeRefundId ~ RE}` ∪ `LedgerEntry {type:'refund', stripePaymentIntentId = order.stripePaymentIntentId, sourceEventId ~ RE}` ; `createdUnix = floor(ledger.createdAt/1000)` sinon `floor((settledAt ?? createdAt)/1000)` ; `chargeAmountCents` = ligne ledger `payment` du PI sinon `round(order.total×100)` ; aucun import Stripe dans la route status. Séquence : skip de l'earn si ligne `earn` existe **ou** marqueur legacy `(refund, sourceEventId null)` ; sinon tx earn inchangée → commit ; **toujours** `reconcileLoyaltyOnRefund(prisma, …)` sur le client racine (jamais imbriqué), une tentative + un retry ; échec après earn ⇒ `[LOYALTY MISS] earn_prorata_incomplete` + alerte `loyalty_prorata_incomplete` ; réparation `POST /api/admin/loyalty/reconcile {orderId}` (`resolveAdmin`, DB seulement, non gatée). Tests 1-8 (aucun refund ; partiel avant ; total avant ; points dépendus ; 470×3 ; idempotence webhook/DB ; earn OK + rejeu jette ⇒ alerte puis réparation ; marqueur legacy ⇒ `grandfathered`).
