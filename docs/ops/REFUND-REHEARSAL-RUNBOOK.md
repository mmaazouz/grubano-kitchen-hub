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

## 6 · Séquence d'exécution future (PLAN — non exécuté)

1 Stripe TEST prouvé · 2 commande GR-N5TSM0 toujours disposable (DB) · 3 aucun refund antérieur/nouveau (DB + Stripe) · 4 solde connecté DISPONIBLE lu à l'instant · 5 disponible ≥ 473 · 6 payout `manual` (sinon risque OPEN → arrêt) · 7 vecteur 500 c recalculé (test pin + inputs mesurés) · 8 webhooks sains · 9 observabilité (`ADMIN_AUDIT_ENABLED`) · 10 fenêtre ouverte par l'opérateur (preuve 401) · 11 **dispatch** `refund-rehearsal.yml` (order_id, 500, phrase) → exactement UN refund · 12 id `re_…` capturé (corps de la route) · 13 état Stripe observé (opérateur) · 14 `202 pending` ⇒ **aucun succès annoncé** · 15 `succeeded` ⇒ vérifier le refund réel · 16 reversal réelle 473 (`transfer_reversal`) · 17 fee refund réelle 27 · 18 Refund row `succeeded` · 19 ledger `refund` gross −500 / fee −27 / net −473 (F2 vérité Stripe) · 20 restore 3 pts · 21 reversal 5 pts · 22 `recoveryOffsetPoints` · 23 état client · 24 politique e-mail (suppress) · 25 réconciliation DIRECTE v5 · 26 `REFUNDS_ENABLED=false` (auto) · 27 runtime false prouvé · 28 porte 403 gated prouvée · 29 rapport financier final.

## 7 · Second scénario — GR-BZE1X (FULL 1450 c)

Éligibilité **READY côté Stripe** (0 refund, 1450 restants, fee 116 → reversal 1334) ; DB NOT MEASURED ici ; solde disponible requis **1334 c** (attendu ≥ 2026-09-09 si le partiel n'a pas consommé le disponible : 1334 − 473 = 861 < 1334 → **GR-BZE1X attendra 2026-09-09** (2668 − 473 = 2195 ≥ 1334). Exécution uniquement après PASS du partiel GR-N5TSM0. Franchise reste OUT OF BETA.

## 8 · Ce que ce train ne fait pas
Aucun refund · `REFUNDS_ENABLED` inchangé (false, 403 gated mesuré) · payout schedule inchangé · aucun webhook modifié · Stripe LIVE intact · web-root T-41, HTTP 401, normalisation hébergeur, Claims, e-mails (hors plan), livraison, franchise : hors périmètre.
