# PHASE 2 — PREFLIGHT OPÉRATIONNEL v2 : UNE commande fondateur (staging)

> Contexte : `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §13/§19, `docs/ops/BETA-PRODUCT-FINAL-CLOSEOUT.md` (EVIDENCE DISCIPLINE). L'environnement Claude Code n'a **aucun shell distant** (SSH :22 filtré, étape SSH GHA en timeout 5/5). Le fichier `.env.local` du serveur est la **seule** source de vérité runtime et n'est **jamais** écrit par la CI. → L'opérateur est shippé automatiquement par le déploiement (`scripts/server/*.js`) et exécuté UNE fois par le fondateur. Il décide PASS/FAIL seul ; aucune interprétation, aucun paramètre, aucun secret à saisir.
>
> **v1 (2026-09-04, exécuté)** a MESURÉ `REFUNDS_ENABLED = true` sur staging et a correctement échoué fermé à l'étape 2 : le gel technique n'avait jamais existé (constante historique depuis ≤ 2026-08-29 ; seul le gel opérationnel tenait ; aucun refund inattendu côté Stripe TEST). **v2** rétablit le gel technique et termine le préflight en un seul passage.

## Ce que fait l'opérateur v2 (`scripts/server/phase2-preflight.js`)

1. **ENV** — prouve qu'il tourne dans l'app staging déployée (schéma Phase 1/2 + marqueurs de build Phase 2 **et** F2 dans la route webhook compilée + `NEXTAUTH_URL` = app.grubano.com + base NON nommée « prod » + clé Stripe **TEST**). Imprime les valeurs AVANT (mesurées dans le fichier) de `REFUNDS_ENABLED`, `ALERT_EMAIL`, `LOGISTICS_SIGNUP_ENABLED`.
2. **BACKUP** — copie `.env.local` → `.env.local.bak-phase2-<horodatage>` (600), contenu vérifié.
3. **WRITE** — la seule écriture : `REFUNDS_ENABLED=false` (**gel technique**), `ALERT_EMAIL=admin-qa@grubano.com`, `LOGISTICS_SIGNUP_ENABLED=false` (autorisé par le fondateur : ce flag ouvre une inscription livreur publique réelle — landing `/business/logistics`, formulaire, `POST /api/logistics/register` — alors que la livraison est hors bêta ; l'opérationnel livreur reste verrouillé par `LOGISTICS_COURIER_ACTIVATION_ENABLED`). Toutes les autres lignes sont préservées **octet pour octet** (vérifié) ; relecture prouvée ; idempotent (`NO CHANGE NEEDED` au second passage).
4. **FLAGS** — valeurs EFFECTIVES de tous les drapeaux argent **relues dans le fichier** (`ABSENT → EFFECTIVE FALSE`). **FAIL** si `REFUNDS_ENABLED`, `CLAIMS_ENABLED`, `CLAIMS_AUTO_APPROVE_ENABLED` ou `GHOST_ORDER_AUTO_REFUND_ENABLED` vaut `true` après écriture. Le rechargement du processus n'est **pas observable** par le script (dit tel quel ; restart à l'étape 10).
5. **MAIL** — envoie **UN** e-mail de TEST « MONEY REVIEW — TEST préflight Phase 2 v2 (aucun argent) » via les réglages SMTP de l'app vers `admin-qa@grubano.com` ; imprime `accepted / rejected / response / messageId` ; réception inbox = `NOT MEASURED`.
6. **REFUNDS** — lecture seule : aucun refund inattendu pendant la fenêtre flag=true (lignes `Refund` depuis le 2026-08-29, `AdminAuditLog refund.run`, lignes ledger `refund`) ; seule attendue : la répétition Z1 du 29/08 (14,50 €). Sinon **FAIL — HARD STOP**.
7. **ORDER** — lecture seule de **GR-N5TSM0** (`…n5tsm0`) : statut, `paymentStatus`, `subtotal/total`, `pointsRedeemed/loyaltyCreditCents/pointsEarned`, POS, PI tronqué, lignes fidélité, lignes `Refund`, ledger du PI, `FranchiseRoyalty` (attendue : aucune), client fidélité, verdict **DISPOSABLE**.
8. **FRANCH** — lecture seule : royalties, points de vente, opérateurs `franchise`, commandes rattachées à un POS, `FRANCHISE_ENABLED` effectif.
9. **LEDGER** — `GET /api/admin/ledger/check` (lecture seule, 7 jours) de l'app elle-même avec le token interne lu dans l'env (jamais imprimé).
10. **RESTART** — touche `tmp/restart.txt` (Passenger recharge l'env).

Garanties : **aucun refund, aucune écriture Stripe, aucun argent, aucun schéma, aucun secret imprimé ; chaque valeur imprimée est MESURÉE sur le serveur et étiquetée (fichier / DB / route).** Fail-closed : première anomalie → `RESULT: FAIL` + `FAILED STEP` + exit non nul. Contrôles négatifs prouvés en local avant remise : base « prod », clé LIVE, marqueur F2 absent, `CLAIMS_ENABLED=true` après écriture, SMTP injoignable → FAIL fermés ; préservation des clés + idempotence prouvées.

## LA commande (cPanel Terminal, une seule ligne) — dès que la CI du commit `a1/refund-hardening → develop` est verte et que `/version.json` porte son SHA

```bash
~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js
```

→ coller **tout** le bloc `GRUBANO PHASE 2 PREFLIGHT v2 (staging)` dans le chat (il ne contient aucun secret). « file not found » = signal FAIL à renvoyer tel quel.

## Déjà fait SANS action fondateur (2026-09-04, Stripe TEST)
- Endpoint webhook TEST `we_…7ueK` : `refund.updated` + `refund.failed` abonnés (relu depuis Stripe, `livemode=false`, existants conservés).
- Compte Connect TEST du restaurant de répétition : calendrier de virements `daily` → `manual` (config TEST, aucun argent). Solde disponible **0 €** au 2026-09-04 (13,34 € attendus le 2026-09-08, +13,34 € le 2026-09-09) — **à relire au moment de l'exécution**, jamais sur le calendrier seul.
