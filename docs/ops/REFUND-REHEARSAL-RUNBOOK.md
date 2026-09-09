# REFUND REHEARSAL RUNBOOK — première répétition Stripe TEST (GR-N5TSM0, partiel 500 c) — préparé le 2026-09-05, NON EXÉCUTÉ

> Préflight financier Phase 2 = **PASS** (réconciliation directe DB ↔ Stripe TEST, opérateur v5, fondateur). Ce document prépare la **première répétition intégrée** : UN remboursement partiel de **500 c de cash Stripe** sur GR-N5TSM0. **Rien n'est exécuté** sans la phrase fondateur exacte « I AUTHORIZE THE STAGING REFUND REHEARSAL ». Règle d'évidence : chaque fait porte sa source ; NOT MEASURED sinon.

## 1 · Faits MESURÉS le 2026-09-05 (Stripe TEST, lecture seule, 21:50 UTC)

| Objet | Valeur |
|---|---|
| Cible | GR-N5TSM0 · `cmtju919h0001h7t6bkn5tsm0` · PI `pi_3UB…CMfy` (trouvé par `metadata.orderId`) |
| PaymentIntent | `succeeded` · amount 1410 · amount_received 1410 · `on_behalf_of` + `transfer_data.destination` = `acct_1…yYMY` · application_fee_amount 76 · créé 2026-09-02T08:33Z |
| Charge `ch_3UB…HBjy` | `succeeded` · captured 1410 · **amount_refunded 0** · refunded false · frais Stripe réels 69 |
| Application fee `fee_1U…QdVo` | amount 76 · amount_refunded 0 |
| Transfer `tr_3UB…GDCe` | amount 1410 · amount_reversed 0 → destination `acct_1…yYMY` |
| Refunds sur le PI | **0** (aucun succeeded / pending / failed) |
| **Remaining cash refundable** | **1410 ≥ 500** ✅ |
| Compte connecté `acct_1…yYMY` (Express FR, créé 2026-08-30) | **AVAILABLE EUR = 0 c** · **PENDING EUR = 2668 c** (balance transactions : `payment:1334` disponible 2026-09-08, `payment:1334` disponible 2026-09-09) · autres devises : aucune · payouts_enabled true · requirements.currently_due [] |
| Payout schedule (TEST) | **`{"interval":"manual","delay_days":7}`** · 0 payout · risque de balayage automatique = **NONE** |
| Webhooks TEST | `we_1Tg…ygcg` (créé 2026-06-08) enabled, `app.grubano.com/api/webhooks/stripe`, events : `payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `payment_intent.succeeded`, **`charge.refunded`, `refund.updated`, `refund.failed`** ✅ · `we_1Tg…Pv6n` (créé 2026-06-10) même URL, `account.updated` seulement (sync Connect) — sans effet sur les refunds |
| Derniers événements refund TEST | `refund.updated` / `charge.refunded` 2026-08-29 (Z1), 2026-08-27 — aucun depuis |
| Second scénario GR-BZE1X `pi_3UA…DiB9` | `succeeded` 1450 · fee 116 · transfer 1450 non renversé · **0 refund** · remaining 1450 |

**Faits DB (source : opérateurs v3/v5 fondateur ; re-mesure serveur = `phase2-refund-gate.js` mode `precheck`)** : status delivered · paymentStatus paid · subtotal 14,50 € · total 14,10 € · pointsRedeemed 8 · loyaltyCreditCents 40 (5 c/pt) · pointsEarned 14 · 0 Refund row · POS null (standard) · franchise NO. Lignes `LoyaltyTransaction` (earn/redeem), `pointsBalance`, `recoveryOffsetPoints`, domaine e-mail du consommateur : **NOT MEASURED localement** (base injoignable) → imprimés par le precheck serveur.

## 1c · FINAL BEFORE PRECHECK du 2026-09-09T08:16Z (lecture seule — bloc BEFORE côté Stripe/porte ; DB via la commande fondateur)

- Staging = d698c25 (version.json) ; `POST /api/admin/refunds/run {}` et `POST /api/orders/<N5TSM0>/refund {}` non authentifiés → **403 gated** (REFUNDS_ENABLED false dans le process).
- GR-N5TSM0 Stripe TEST : PI succeeded 1410/1410, charge amount_refunded **0**, refunds sur le PI **0**, app fee 76 refunded **0**, transfer 1410 reversed **0** → TARGET STILL DISPOSABLE = YES, remaining refundable 1410.
- Compte connecté acct_1…yYMY : **AVAILABLE EUR 2668 c · PENDING 0 c** (les deux payments 1334 sont devenus disponibles) ; payout schedule `manual` / delay 7 inchangé ; 0 payout. Vecteur inchangé : fee reversal 27, reversal Connect requis 473 → **marge 2668 − 473 = 2195 c**.
- DB (refund rows, ledger gross/fee/net, balance/offset fidélité, états earn/redeem, preuves refund antérieur) : **NOT MEASURED depuis le poste local** (DB o2switch injoignable, SSH port 22 timeout local ET CI) → obtenue par la commande precheck fondateur (lecture seule, mode par défaut, JAMAIS `window`) :
  `~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-refund-gate.js`
- Fail-safe fenêtre vide (prouvé harnais nc6, jamais sur staging) : deadline finie `PHASE2_REFUND_WINDOW_MS` (défaut 15 min) → `REFUND OBSERVED (Stripe) = NONE within the window — nothing executed` → `finally` inconditionnel : `REFUNDS_ENABLED=false` + restart + porte prouvée `CLOSED` (403 gated) ; 0 écriture Stripe ; aucune action humaine. Si la porte ne reprouve pas CLOSED : anomalie « HUMAN ATTENTION REQUIRED » (le fichier est déjà false).
- Contrat de coordination le jour J : (A) phrase d'autorisation fondateur explicite → (B) CC prépare le dispatch et rend `REFUND DISPATCH READY = YES` + `WINDOW COMMAND MAY NOW BE RUN = YES` → (C) fondateur lance UNE commande `window` → (D) CC dispatch exactement UN refund 500 c via `refund-rehearsal.yml` pendant la fenêtre → (E) re-gel inconditionnel. Le fondateur n'ouvre JAMAIS la fenêtre avant (B).

## 1d · MÉCANISME DE DISPATCH prouvé (2026-09-09T08:58Z, sans refund)

- Chemin : **GitHub Actions `refund-rehearsal.yml` (workflow_dispatch, runner GitHub) → HTTPS → `POST https://app.grubano.com/api/admin/refunds/run`** avec l'en-tête `X-Internal-Token` = secret dépôt `INTERNAL_CRON_TOKEN` (comparé côté route à `process.env.INTERNAL_CRON_TOKEN`, constant-time, fail-closed si vide). Aucun accès DB ni SSH n'est nécessaire : le moteur de refund s'exécute DANS le process Next de staging.
- Parité prouvée par lecture du code : `app/api/admin/refunds/run/route.ts` et `app/api/admin/ledger/check/route.ts` portent le MÊME bloc d'auth (même en-tête, même variable, même `safeEqual`, même `trim`). Le kill-switch est évalué AVANT l'auth sur `refunds/run` (403 gated porte fermée), donc la preuve authentifiée passe par la route ledger.
- Preuve authentifiée à la SHA courante : `internal-token-probe.yml` dispatché sur fc262a4 → run 34332020981 → **HTTP STATUS = 200**, `GITHUB SECRET == STAGING RUNTIME TOKEN = YES` (GET lecture seule, statut seul, aucune valeur). Les deux workflows sont `state=active` (API GitHub) ; `refund-rehearsal.yml` id 351188965, dernier run 33994784902 = push skipped (enregistrement).
- Dispatch réel le jour J : `gh workflow run refund-rehearsal.yml --ref develop -f order_id=cmtju919h0001h7t6bkn5tsm0 -f amount_cents=500 -f confirm=<phrase fondateur>` ; le job sonde d'abord la porte (401 attendu, sinon ABORT sans POST), puis UN POST ; latence mesurée du probe : ~1 s après le démarrage du job (fenêtre 15 min largement suffisante).
- Non exécuté ici : aucun dispatch de `refund-rehearsal.yml`, aucune phrase d'autorisation utilisée, porte 403 gated.

## 2 · Vecteur du MOTEUR ACTUEL (dry-run avec les fonctions réelles — `tests/rehearsal-vector-n5tsm0.test.ts`, 7/7)

Entrée : **500 c de cash Stripe**. `computeRefundSplit({T:1410, F:76, R:0, Cprev:0, amt:500})` :

| Poste | Valeur | Règle |
|---|---|---|
| CUSTOMER STRIPE CASH REFUND | **500 c** | montant demandé (≤ 1410 restants) |
| APPLICATION FEE REVERSAL | **27 c** | `round(76·500/1410) − round(76·0/1410)` = cible cumulée arrondie (télescopage) |
| RESTAURANT TRANSFER REVERSAL | **473 c** | 500 − 27 (`reverse_transfer:true`) |
| ROYALTY | 0 | standard |
| GRUBANO RETAINED FEE AFTER REFUND | **49 c** | 76 − 27 |
| LOYALTY SPENT POINTS RESTORE | **3 pts** | `round(8·500/1410)` (planLoyaltyRefund, prorata sur charge.amount) |
| LOYALTY EARNED POINTS REVERSE | **5 pts** (si ligne `earn` créditée) | `round(14·500/1410)` |
| RECOVERY OFFSET DELTA | **0 si pointsBalance ≥ 5** ; sinon `5 − balance` | `applyReversalWithOffset(5, balance)` — balance = fait DB (precheck) |
| CUSTOMER TOTAL ECONOMIC RESTORATION | **515 c** cash + points restaurés (500 + 3×5) ; **490 c** net des points repris (− 5×5) | 5 c/pt (40 c / 8 pts) |

**VECTOR MATCHES PREVIOUS EXPECTATION = YES** (500 / 27 / 473 / 3 / 5 / ≈515). Second partiel identique → fee cumulée 54 (27+27), loyalty 10/6 cumulés (télescopage prouvé). GR-BZE1X FULL : fee refund 116, reversal 1334.

## 3 · Porte dure : solde disponible

**REQUIRED TRANSFER REVERSAL = 473 c** · **CONNECTED AVAILABLE = 0 c** (mesuré) → **AVAILABLE BALANCE SUFFICIENT = NO** → **FIRST REHEARSAL = WAIT**. Ce n'est pas un échec. Aucun fonds fabriqué, aucune avance de trésorerie Grubano (`ALLOW_PLATFORM_FALLBACK` effectif false, vérifié par le precheck — FAIL s'il est `true`). Première fenêtre possible : **à partir du 2026-09-08** (1334 c deviennent disponibles) — **à re-mesurer au moment de l'exécution**, jamais sur le calendrier seul. Règle Stripe : la reversal exige un solde **disponible** ≥ montant, sinon la demande de refund échoue.

## 4 · Prechecks

| Precheck | Verdict | Preuve |
|---|---|---|
| DB | NOT MEASURED localement (v3/v5 : cohérent, disposable YES) → precheck serveur | opérateur `precheck` (lecture seule) : order, Refund rows (FAIL si pending/failed/succeeded), claims, audits, lignes ledger refund, royalty, loyalty rows, balance/offset |
| LOYALTY | PASS (contrat) · balance/offset DB NOT MEASURED | Phase 1 : `planLoyaltyRefund` prorata cumulé, idempotence `@@unique([sourceEventId,type])` sur `re_…`, `applyReversalWithOffset` (jamais de solde négatif visible) ; tests `loyalty-refund` 25 + `loyalty-refund-apply` 8 verts |
| IDEMPOTENCY (F8) | PASS | `Refund.idempotencyKey = refund:<orderId>:<alreadyRefunded>` (@unique) créée AVANT Stripe ; `driveRefund` resume-first (liste par PI, `has_more` ⇒ 502 fail-closed, refund tagué `metadata.grubano_refund_row` adopté, re-création uniquement dans `RESUME_CREATE_WINDOW_MS` 20 h avec la même clé, au-delà 409 + MONEY REVIEW) ; verrou permanent sur ligne `failed` ; `refund-engine` 48 verts |
| WEBHOOK | PASS | `we_…ygcg` enabled TEST, 3 événements refund abonnés (mesuré) |
| OBSERVABILITÉ | PASS sous réserve `ADMIN_AUDIT_ENABLED=true` (sinon audit SKIPPÉ — le precheck l'imprime) | `AdminAuditLog refund.run` (route), Refund row, ledger `refund` (F2 vérité Stripe), `refund.updated`/`refund.failed` → `finalizeRefundRowFromStripe`, MONEY REVIEW → `ALERT_EMAIL` (m.maazouz@, 250 mesuré), réconciliation DIRECTE (v5) après coup — jamais le chemin HTTP 401 |
| STATUT | PASS | `pending` = 202 non-ok (pas d'e-mail, pas de ledger), `failed` = verrou, `succeeded` seul ⇒ ledger/e-mail/row |
| POST-STRIPE FAILURE RECOVERY | PASS | Stripe créé puis échec DB/webhook/ledger/loyalty/crash : la ligne `Refund` (pending, clé) existe déjà ; reprise = adoption par tag ou même clé d'idempotence (< 20 h) ; webhook `charge.refunded`/`refund.updated` re-joue la réconciliation complète (ledger vérité Stripe, loyalty par `re_…`) ; jamais de 2ᵉ création. Aucun gap trouvé (revues F2/F8 indépendantes PASS) |
| E-MAIL | **NO — SAFE FOR REHEARSAL = NO** | `sendRefundConfirmation` (`lib/transactional-emails.ts:724-727`) envoyée post-succès par `POST /api/admin/refunds/run` au consommateur : copie « vient d'être effectué par {restaurant} » + « délai bancaire 5 à 10 jours ouvrés » = défauts P1 connus (audit e-mail) ; le diff en attente du chantier e-mail ne les corrige pas |

**REHEARSAL EMAIL PLAN = SUPPRESS TEST EMAIL** : avant la fenêtre, ajouter un coupe-circuit additif dans `sendRefundConfirmation` (`REFUND_CONFIRMATION_EMAIL_ENABLED=false` ⇒ trace `EmailLog status=skipped`, aucun envoi ; défaut = comportement actuel) — 3 lignes, à coordonner avec le chantier e-mail (fichier avec modifications en attente) — **ou** option B si la copie corrigée est livrée avant. Aucun e-mail à un vrai client ; le destinataire = compte de test (domaine imprimé masqué par le precheck).

## 5 · Contrat `REFUNDS_ENABLED`

Les deux routes (`/api/admin/refunds/run`, `/api/orders/[id]/refund`) évaluent le kill-switch **avant** l'auth ⇒ **TEMPORARY REFUNDS_ENABLED TRUE REQUIRED = YES**. Exécution humaine : aucune UI ; le seul identifiant machine qui fonctionne côté staging est le secret GitHub (`INTERNAL_CRON_TOKEN`, 200 mesuré) ⇒ le refund est déclenché par **`.github/workflows/refund-rehearsal.yml`** (dispatch manuel ; inputs `order_id`, `amount_cents`, `confirm` = phrase exacte ; cible fixe staging ; sonde de porte 401 sinon abandon ; imprime statut + corps non secret). La fenêtre est tenue par **`scripts/server/phase2-refund-gate.js window`** (UNE commande fondateur, env `PHASE2_REFUND_WINDOW_CONFIRM` = phrase exacte) : precheck complet fail-closed → `REFUNDS_ENABLED=true` (ligne canonique + backup) → restart → preuve porte OUVERTE (401) → attente d'**exactement un** refund sur le PI (ou délai 15 min) → **re-gel inconditionnel** `REFUNDS_ENABLED=false` → restart → preuve porte FERMÉE (403 gated). **AUTO-REFREEZE PLAN = READY** (harnais : ouverture/fermeture, refus sans phrase, refus si WAIT/anomalie, re-gel sur délai). Le fondateur n'édite jamais `.env.local`.

### 5b · Pré-état BEFORE capturé par l'opérateur `window` (ajout 2026-09-08, FINAL PRE-AUTHORIZATION CHECK)

`scripts/server/phase2-refund-gate.js` (modes `precheck` et `window`) imprime, à l'étape [3] — donc **avant** toute action de porte ([7]) — un bloc `BEFORE ·` : `DB REFUND ROWS FOR ORDER`, `LEDGER LINES FOR PI (type{gross,fee,net})`, `LEDGER GROSS / FEE / NET`, `CUSTOMER LOYALTY BALANCE`, `RECOVERY OFFSET POINTS`, `ORDER LOYALTY REDEEMED`, `ORDER LOYALTY EARNED`, `EARN EVENT STATE`, `REDEEM EVENT STATE`, `PRIOR REFUND LOYALTY EVENT` (YES/NO), `PRIOR REFUND LEDGER ENTRY` (YES/NO).

Fail-closed : Prisma indisponible, aucune ligne ledger pour le PI, client fidélité introuvable, ou preuve d'un refund antérieur (loyalty/ledger) ⇒ anomalie ⇒ `window` **REFUSÉ** avant d'écrire `REFUNDS_ENABLED=true` (rien n'est modifié, aucun restart). Le mode `window` exige en outre un pré-état complet et imprime `WINDOW PRE-STATE CAPTURE = PASS (…)` **avant** `WINDOW OPEN WRITE`. Harnais local nc6 16/16 (faux staging + faux Stripe) : DB down → refusé, ledger absent → refusé, capture imprimée avant l'ouverture. Aucune fenêtre ouverte sur staging par ce train.

## 6 · Séquence d'exécution future (PLAN — non exécuté)

1 Stripe TEST prouvé · 2 commande GR-N5TSM0 toujours disposable (DB) · 3 aucun refund antérieur/nouveau (DB + Stripe) · 4 solde connecté DISPONIBLE lu à l'instant · 5 disponible ≥ 473 · 6 payout `manual` (sinon risque OPEN → arrêt) · 7 vecteur 500 c recalculé (test pin + inputs mesurés) · 8 webhooks sains · 9 observabilité (`ADMIN_AUDIT_ENABLED`) · 10 fenêtre ouverte par l'opérateur (preuve 401) · 11 **dispatch** `refund-rehearsal.yml` (order_id, 500, phrase) → exactement UN refund · 12 id `re_…` capturé (corps de la route) · 13 état Stripe observé (opérateur) · 14 `202 pending` ⇒ **aucun succès annoncé** · 15 `succeeded` ⇒ vérifier le refund réel · 16 reversal réelle 473 (`transfer_reversal`) · 17 fee refund réelle 27 · 18 Refund row `succeeded` · 19 ledger `refund` gross −500 / fee −27 / net −473 (F2 vérité Stripe) · 20 restore 3 pts · 21 reversal 5 pts · 22 `recoveryOffsetPoints` · 23 état client · 24 politique e-mail (suppress) · 25 réconciliation DIRECTE v5 · 26 `REFUNDS_ENABLED=false` (auto) · 27 runtime false prouvé · 28 porte 403 gated prouvée · 29 rapport financier final.

## 7 · Second scénario — GR-BZE1X (FULL 1450 c)

Éligibilité **READY côté Stripe** (0 refund, 1450 restants, fee 116 → reversal 1334) ; DB NOT MEASURED ici ; solde disponible requis **1334 c** (attendu ≥ 2026-09-09 si le partiel n'a pas consommé le disponible : 1334 − 473 = 861 < 1334 → **GR-BZE1X attendra 2026-09-09** (2668 − 473 = 2195 ≥ 1334). Exécution uniquement après PASS du partiel GR-N5TSM0. Franchise reste OUT OF BETA.

## 8 · Ce que ce train ne fait pas
Aucun refund · `REFUNDS_ENABLED` inchangé (false, 403 gated mesuré) · payout schedule inchangé · aucun webhook modifié · Stripe LIVE intact · web-root T-41, HTTP 401, normalisation hébergeur, Claims, e-mails (hors plan), livraison, franchise : hors périmètre.

## 1b · RECHECK LECTURE SEULE du 2026-09-07T00:09Z (porte pré-refund « September 8 »)

| Mesure | Valeur | Verdict |
|---|---|---|
| Staging | `/version.json` = **15bb7db** (app + business) ; `/fr/eat` 200 · `/api/restaurants` 200 · waitlist 200 | ENV = STAGING |
| Gel technique (processus) | `POST /api/admin/refunds/run {}` → **403 gated** · `POST /api/orders/[id]/refund {}` → 403 gated · `POST /api/admin/claims/auto-approve {}` → 403 gated (CLAIMS_ENABLED false) · `tipsEnabled:false` · `fulfillment.delivery:false` | REFUNDS_ENABLED runtime FALSE ; CLAIMS/TIPS/DELIVERY OFF ; GHOST_ORDER_AUTO_REFUND = fichier false (v5) — pas de sonde publique |
| GR-N5TSM0 (Stripe) | PI `pi_3UB…CMfy` succeeded 1410/1410 · charge `ch_3UB…HBjy` captured 1410, **amount_refunded 0** · fee 76 (refunded 0) · transfer 1410 (reversed 0) · **0 refund** · remaining **1410** | TARGET STILL DISPOSABLE (Stripe) = YES |
| Vecteur moteur ACTUEL (tests réels, 7/7 + engine 48/48) | 500 c → fee reversal **27**, restaurant reversal **473**, spent restore 3, earned reverse 5, offset 0 si balance ≥ 5 | CONFIRMS PREVIOUS VECTOR = YES |
| Compte connecté `acct_1…yYMY` | **AVAILABLE EUR 0 c** · PENDING EUR 2668 c (`payment:1334` available_on 2026-09-08, `payment:1334` available_on 2026-09-09) · payout schedule **manual** (delay 7) · 0 payout | **CONNECT FUNDING GATE = WAIT** · SHORTFALL **473 c** · sweep risk NONE |
| Webhooks TEST | `we_1Tg…ygcg` enabled : charge.refunded / refund.updated / refund.failed SUBSCRIBED | PASS |
| E-mail refund (HEAD `ca0e19a`) | `sendRefundConfirmation` : formulation neutre (« votre remboursement … est confirmé »), aucun délai chiffré, montant = `result.amountCents` du refund **succeeded** (appel uniquement après `result.ok`, 202 pending ⇒ aucun e-mail), fidélité jamais présentée comme cash | REFUND EMAIL SAFE = **YES** (plan SUPPRESS levé) |
| DB (order, Refund rows, ledger, loyalty balance/offset) | NOT MEASURED localement (base injoignable) ; dernières mesures v3/v5 cohérentes ; capture BEFORE = `phase2-refund-gate.js` (precheck, lecture seule) le jour J | — |

Aucune mutation : 0 refund, 0 flag, 0 payout, 0 webhook, 0 e-mail, Stripe LIVE intact. Prochaine étape : re-mesurer le solde **disponible** (pas pending) ; les `available_on` Stripe sont des estimations, pas une preuve.

## 9 · RÉPÉTITION EXÉCUTÉE — 2026-09-09 (UN refund TEST 500 c GR-N5TSM0) + closeout

- Autorisation fondateur (phrase exacte) 10:07Z → porte sondée 401 à 10:09:22Z → dispatch `refund-rehearsal.yml` run 34338693155 → HTTP 200 `{ok:true, resumed:false, refundId cmttxsfzr…, stripeRefundId re_3UB…5bzp, amountCents 500, restaurantReverseCents 473, applicationFeeRefundCents 27, cumulativeRefundedCents 500, remainingRefundableCents 910}` → porte 403 gated re-mesurée à 10:10:22Z (re-gel inconditionnel de l'opérateur window ; sortie brute de l'opérateur non archivée par CC — seul le fondateur l'a vue à l'écran).
- Stripe TEST (objets) : refund `created` 2026-09-09T10:09:32Z status succeeded (dès la création, carte TEST) ; événements transfer.reversed 10:09:32Z, application_fee.refunded 10:09:33Z, refund.created + charge.refunded 10:09:34Z, refund.updated 10:09:35Z — tous `pending_webhooks 0`. Charge amount_refunded 500 ; app fee refunded 27/76 ; **Transfer.amount_reversed 500 (BRUT)** ; balance connectée : payment_refund −500 + adjustment +27 ⇒ **net −473** (available 2668 → 2195, pending 0). Payout manual inchangé, 0 payout. GR-BZE1X intact.
- DB/ledger/fidélité (mesures fondateur, opérateurs lecture seule) : Refund row 1 succeeded 500 ; ledger refund {−500, −27, −473} ; réconciliation directe DB ↔ Stripe PASS (count = count, sum = sum, ecarts none) ; fidélité 20 → 18 (restore +3, reverse −5), offset 0 → 0. Aucun double effet.
- Les « FAIL » post-refund de `phase2-refund-gate.js` (precheck) et de `phase2-preflight.js` (garde « unexpected refund ») sont le comportement ATTENDU des gardes BEFORE / première répétition (refund existant, preuves loyalty/ledger antérieures) — PAS un échec de réconciliation.
- E-mail conso réel reçu (pilote-client@, sujet « Votre remboursement partiel est confirmé — Rehearsal Beta Grubano », 5,00 €, acteur neutre, sans délai chiffré, sans fidélité-cash). Chronologie autoritaire : `scripts/server/phase2-email-timeline.js` (lecture seule) compare Stripe `created` ↔ EmailDispatch.createdAt ↔ EmailLog.sentAt en UTC ; le code n'envoie l'e-mail qu'après `result.ok` (route refunds/run).
- Sécurité des sauvegardes : `scripts/server/phase2-backup-neutralize.js` (voir ticket T-43). Porte de financement Connect : ticket T-42 (brut vs net).

## 10 · SECONDE RÉPÉTITION — FULL REFUND GR-BZE1X — PRECHECK (2026-09-09, lecture seule, NON autorisé)

- Cible : `cmtj52ewh000320fboagbze1x` (GR-BZE1X ; id lu dans `PaymentIntent.metadata.orderId`). Stripe TEST 14:07Z : PI pi_3UA…DiB9 succeeded 1450/1450, fee 116, charge ch_3UA…1DeO captured 1450, amount_refunded 0, refunded false, **0 refund**, remaining 1450 ; app fee refunded 0/116 ; transfer tr_3UA…8Mz7 1450 reversed 0 → cible disponible côté Stripe. DB (statut/paiement/fidélité) = commande fondateur precheck avec `PHASE2_REFUND_ORDER_ID=cmtj52ewh000320fboagbze1x PHASE2_REFUND_AMOUNT_CENTS=1450`.
- Vecteur FULL (computeRefundSplit, `tests/rehearsal-vector-n5tsm0.test.ts`) : cash 1450 · fee refund 116 (cumul arrondi = fee totale) · net Connect −1334 · royalty 0 · remaining 0. Objets Stripe attendus : `Transfer.amount_reversed` **1450 (BRUT)**, `ApplicationFee.amount_refunded` 116 (crédit séparé), `Charge.refunded` true, `amount_refunded` 1450.
- Porte de financement BRUTE (T-42) : available 2195 ≥ 1450 → marge **745** → PASS (pending 0, payout manual/7, 0 payout). L'opérateur `phase2-refund-gate.js` calcule désormais `REQUIRED CONNECT FUNDING (GROSS transfer reversal — T-42) = montant cash` et refuse la fenêtre si available < brut (harnais nc6 mis à jour).
- État commande/paiement APRÈS (observation d'implémentation, pas une promesse contractuelle) : le rail A (`executeRefund`) n'écrit ni `Order.status` ni `Order.paymentStatus` ; seule la branche webhook ghost-order (`status expired` + `GHOST_ORDER_AUTO_REFUND_ENABLED`) pose `paymentStatus=refunded`. Attendu : `paymentStatus` reste `paid`, statut inchangé, `Refund` row succeeded 1450, ledger refund {−1450, −116, −1334}.
- Fidélité : plan = `planLoyaltyRefund` prorata sur charge.amount (full ⇒ reverse 100 % des points gagnés de la commande, restauration 100 % des points dépensés) puis `applyReversalWithOffset(reverse, soldeVisible)` ; offset exercé seulement si solde visible < points à reverser (T-44). Pas de mutation artificielle.
- Flags (process) 14:0xZ : refunds/run 403 gated · orders/<bze1x>/refund 403 gated · claims/auto-approve 403 gated ; fichier : imprimé par l'opérateur (CLAIMS_*, GHOST_*, TIPS, LOGISTICS_COURIER_ACTIVATION). Webhooks : we_…ygcg charge.refunded/refund.updated/refund.failed SUBSCRIBED ; 0 événement à livraison en attente sur 24 h.
- E-mail full : `sendRefundConfirmation({partial:false})` → sujet « Votre remboursement est confirmé — <resto> », corps neutre (montant = `result.amountCents` du refund succeeded, aucun acteur restaurant, aucun délai chiffré, aucune fidélité-cash), envoyé uniquement après `result.ok`.
