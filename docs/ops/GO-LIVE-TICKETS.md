# GO-LIVE TICKETS — closed beta transactionnelle (état au 2026-08-27)

> Issus de l'audit A–H réconcilié (97 constats) après application des 7 lots de
> correctifs. **Tous les P0 identifiés sont fermés.** Restent : P1 acceptables en
> petite bêta surveillée, P2 après bêta, et les FOUNDER FACTS (pack séparé).
> Format court : ID · priorité · portée · résumé · fichiers · acceptation.

## P1 — avant l'ouverture PUBLIQUE (acceptables en closed beta surveillée)

| ID | Titre | Évidence | Fix attendu | Acceptation |
|---|---|---|---|---|
| T-01 | **Modes servables invisibles côté fiche** : la fiche resto n'expose que `fulfillment.delivery` — un établissement sans mode servable (pickup OFF + flag livraison OFF) se découvre par un 403 au moment de commander | `app/api/restaurants/[id]/route.ts` (~:305) n'expose pas pickup ; `lib/fulfillment.ts` | Exposer `fulfillment.pickup` (même calcul que le gate serveur) + griser le CTA commande quand aucun mode servable + avertissement onboarding « livraison indisponible pendant le pilote » | La fiche d'un resto non commandable ne propose plus « Commander » |
| T-02 | **Minimum de commande jamais affiché avant l'erreur** | `Restaurant.minOrder` appliqué serveur seulement (`app/api/orders/route.ts`) | Ligne info fiche resto + nudge panier quand subtotal < minOrder (calqué sur le nudge small-order-fee) | Le client voit le minimum avant de commander |
| T-03 | **Déclaration allergènes non obligatoire à la création de plat** (0 plat renseigné sur staging à date) | `app/api/menu/route.ts:29` (`.default([])`) ; le gate existe déjà côté flux créateur (`creators/dishes/[id]/submit:53-59`) | Décision produit : rendre la déclaration explicite obligatoire (avec choix « Aucun ») calquée sur le pattern créateur ; en bêta : mitigation par checklist admin 7.1 du runbook | Aucun plat publiable sans déclaration explicite |
| T-04 | **Vocabulaires allergènes divergents** : chips FR accentuées vs prompt scan-IA non accentué vs ids INCO créateur — valeur IA fantôme non décochable | `app/[locale]/menu/page.tsx:114` ; `app/api/menu/scan-dish/route.ts:26` ; `lib/dish-sheet.ts:22-25` | Normaliser au stockage sur les 14 ids INCO + aligner le prompt scan + normaliser accents à la réception `/api/menu` | Une seule taxonomie en base ; le scan IA produit des valeurs décochables |
| T-05 | ✅ **RÉSOLU (mission Money Flow, décisions D3/D4)** : cible bêta = `REFUNDS_ENABLED=true` + `ADMIN_AUDIT_ENABLED=true` + `ALERT_EMAIL` posé + `INTERNAL_CRON_TOKEN` absent ; `CLAIMS_ENABLED=false` FINAL (support humain, backlog `POST-BETA-CLAIMS-BACKLOG.md`). Reste l'ACTION ENV fondateur (pack). | — | — | Procédure complète : `MONEY-FLOW-CLOSED-BETA-RUNBOOK.md` §3-4 |
| T-06 | **ALERT_EMAIL + crons staging** : l'alerte ghost-order est un no-op silencieux sans ALERT_EMAIL ; confirm-sweep/reconcile-digest inertes hors main | `lib/admin-alerts.ts:30-31` ; `docs/ops/crons.md` | Poser ALERT_EMAIL sur staging + appel manuel quotidien `GET /api/admin/reconcile-ghost-orders` (runbook) pendant la bêta | Un paiement fantôme déclenche une alerte réellement reçue |
| T-07 | ✅ **RÉSOLU AU CODE (D5, branche connect-gate)** : refus serveur `409 restaurant_not_payable` à la création de commande carte ET aux deux routes `/pay` quand le resto n'est pas Connect-actif ; danger-flag QA `ALLOW_PLATFORM_FALLBACK` (jamais en prod). | `lib/connect-gate.ts` | — | Un resto non Connect-ready ne peut plus recevoir une vraie commande payante |
| T-08 | ✅ **RÉSOLU (décision fondateur D1)** : le hold 10 € RESTE pour la bêta, capture punitive VERROUILLÉE (aucune voie atteignable, prouvé M1) ; wording D2 aligne (lot money-wording). Dossier hold-vs-SetupIntent au pack (réévaluation post-pilote). | `lib/deposit.ts` | — | Autorisation temporaire uniquement, jamais une pénalité |
| T-09 | **Page « Fonctionnement de la plateforme » absente** (transparence classement/rôle) | Aucune page ; tri réel honnête (distance sinon nouveauté, note gated avis réels) — contenu 100 % dérivable du code | Page factuelle /eat + lien pied de page (matière : F-03/F-09 de l'audit) | Un consommateur peut lire les critères de classement réels |
| T-10 | **Réponse aux demandes de droits** : contact `privacy.dpoContact` placeholder ; runbook manuel livré mais canal officiel manquant | `lib/legal-info.ts` ; `docs/ops/DATA-SUBJECT-RIGHTS-RUNBOOK.md` | FOUNDER FACT (adresse) puis publication dans la politique de confidentialité | Une demande d'accès/suppression a un canal publié et un processus |

## P2 — après la bêta

| ID | Titre | Note |
|---|---|---|
| T-11 | Idempotence de POST /api/orders (retry réseau = commandes dupliquées impayées, expirent en 24 h ; le PAIEMENT est idempotent) | Header Idempotency-Key ou dédup consumerId+hash(items) |
| T-12 | `LoyaltyTransaction` sans `@@unique([orderId,type])` — course théorique de double débit/crédit au webhook | Contrainte + create-catch-P2002 ; fenêtre étroite, absorbée par les gardes d'état |
| T-13 | Crédit fidélité peut créer une commande < 0,50 € impayable (plancher Stripe) — coincée puis expirée | Capper le crédit en gardant la conversion points↔€ cohérente (lib/loyalty) — PAS de patch naïf |
| T-14 | Sweep d'expiration centralisé + `cancelIntent` du PI des commandes expirées (le lazy-expiry dépend de l'ouverture de la page /orders du resto) | La source « expiré payable » est déjà fermée côté /pay |
| T-15 | Fiche détail lisible pour un resto non approuvé (`isActive` non filtré sur GET /api/restaurants/[id]) — la commande re-bloque | 404 ou payload restreint hors owner/admin |
| T-16 | Restos sans coordonnées invisibles en listing géolocalisé (géocode BAN soft-fail) | Annexer en fin de liste ou backfill géocode post-approbation ; couvert en bêta par la checklist 7.1 |
| T-17 | Flux admin REJECT/SUSPEND : /admin/approvals n'a pas de refus (dossier refusé reste 'pending' sans notification) ; « Suspendre » inerte | Brancher sur le PATCH existant (publication-rule couvre déjà l'admin) + email statut |
| T-18 | Logos/couvertures partenaires = URLs externes arbitraires rendues au consommateur (fuite IP vers hôte tiers ; cassera au passage CSP enforce) | Proxifier/re-héberger (rail Cloudinary existant) ; risque accepté en bêta vettée |
| T-19 | Rétention : durées à arbitrer (comptes, commandes, résa/allergies, EmailLog) puis purges calquées sur le sweep géoloc | Les purges sans ambiguïté (EmailOtp, tokens reset) sont déjà en place |
| T-20 | Reçu/TVA du parcours pickup (« Voir le reçu — Bientôt ») — le rail reçu dine-in + lib/tax existent | REVIEW comptable/juriste puis branchement |
| T-21 | E-mails : identité société + lien légal en pied (attend les FOUNDER FACTS) | `lib/transactional-emails.ts` — base URL déjà corrigée |
| T-22 | Consentement consommateur : base légale compte/fidélité à qualifier (contrat vs consentement) → checkbox + consentAt éventuels | Pattern partenaire réutilisable tel quel |
| T-23 | Query strings sensibles (reset `?token=&email=`) dans les access logs Apache non rotatés | Retirer `email=` de l'URL (lookup par hash token) + politique de rotation logs (ticket ops o2switch) |
| T-24 | Registre des versions de consentement (`policyVersion`) inexistant | Utile dès que CGU/CGV existent |
| T-25 | `/eat/search` : filtres livraison résiduels en pilote retrait (« Livraison offerte », tri « Plus rapides ») | Masquer quand DELIVERY_FULFILLMENT_ENABLED OFF |

## Tickets ajoutés par la mission MONEY FLOW FINAL (2026-08-27)

| ID | Prio | Titre | Note |
|---|---|---|---|
| T-26 | **FOUNDER** | Remise de bienvenue créateur (10 %, cap 5 €) ACTIVE par défaut et financée de facto par le RESTO au /pay — contredit la doctrine B0 (« financée par Grubano ») et le commentaire du /pay qui la croit OFF | Options : couper (customerDiscountPct=0 en base), assumer le financement resto (corriger doctrine+commentaires), ou restaurer la déduction Grubano avec spec fraîche. M2-02 — au pack |
| T-27 | P1 | Aucune garde croisée DB entre les deux moteurs de refund — deux PARTIELS concurrents s'empilent (plafonnés par Stripe, jamais > total) | Refund row partagée (curseur) aussi sur le chemin refundPayment, ou verrou applicatif par PI. M6-02 |
| T-28 | P1 | /api/partner/balance rôle restaurant sur-affiche : les lignes ROUTÉES (déjà versées par Stripe) sont comptées comme dues | Filtrer routed=false pour le « dû par Grubano ». M5-02 |
| T-29 | P1 | requirements Stripe Connect (currently_due/past_due/disabled_reason) ni lus ni stockés — « restricted » aveugle pour le partenaire et l'admin | Lire acct.requirements au webhook + GET connect, stocker disabled_reason/currently_due, afficher ConnectCard+admin. M4-P1-1 |
| T-30 | P1 | Refund > J+1 = solde Express négatif (payouts quotidiens) — aucun monitoring, politique de couverture indéfinie | Doc runbook faite ; reste : lecture de balance dans l'outil admin + clause CGU partenaire + éventuel delay_days. M4-P1-2/FF4 — volet politique au pack |
| T-31 | P2 | Holds immobilisés : résa expirée sans statut / clôture manual+none → expiry Stripe ~7 j sans sweep | Sweep périodique releaseHold (délai = décision fondateur) ou assumer l'expiry documentée. M1-03 |
| T-32 | P2 | PATCH opérateur réservations et PATCH statut commande en read-check-write — courses état (arrived vs cancelled ; cancelled vs preparing) sans effet money direct | updateMany gardé sur le statut lu (calque self-cancel conso). M6-04/M6-05 |
| T-33 | P2 | Preuves Stripe best-effort jamais complétées (chargeId/transferId/fee NULL sur échec retrieve) + ligne ledger perdue si échec d'écriture (200 rendu) | Job de complétion idempotent + heal-on-replay ledger / cron backfill-ledger. M5-04/M2-09 |
| T-34 | P2 | Emails transactionnels ARGENT en FR uniquement pour des clients EN/ES/IT/AR | Porter sur le patron localisé claim-emails (locale + RTL). M7-07 |
| T-35 | P2 | Chaîne de preuve : pas d'orderId sur LedgerEntry (jointure par PI, rompue pour un orphelin), pas de paidAt/chargeId sur Order ; résumé checkout sans lignes small-fee/tip | Colonnes additives + affichage. M2-11 |
| T-36 | P2 | /api/admin/ledger/check comptera FAUX dès qu'un rail B2B (supply/service) émettra des PIs succeeded (pas de metadata.restaurantId) | Exclure les PIs à metadata supplyOrderId/serviceInvoiceId au moment d'activer ces rails. M5-06 |
| T-37 | P2 | Fenêtre d'annulation CLIENT d'une commande : inexistante (décision produit fondateur avant tout build) | FOUNDER-M3-01 — au pack (décision, pas un bug) |

## Tickets ajoutés par le préflight final Phase 2 (2026-09-05)

| ID | Prio | Titre | Note |
|---|---|---|---|
| T-38 | P1 (Product Cleanup) | **Pourboire livreur NON conditionné au mode de livraison** : si `TIPS_ENABLED` passe à `true`, le panier affiche le sélecteur de pourboire coursier pour une commande **à emporter** (`app/[locale]/eat/cart/page.tsx:797`, hors de la ternaire `fulfillment === 'delivery'`) et `POST /api/orders` honore `tipCents` sans condition de mode (`route.ts:489`) → pourboire retenu par la plateforme sans coursier (D-1 fonds tiers). Invariant requis : le chemin pourboire coursier exige un contexte de livraison/coursier (mode `delivery` + `DELIVERY_FULFILLMENT_ENABLED`). `TIPS_ENABLED` reste **FALSE** (runtime prouvé 2026-09-05) ; ne pas activer. | Isolé, corrigeable en Product Cleanup ; tests : pickup + flag ON → tip refusé/ignoré côté serveur et masqué côté UI. |
| T-39 | P1 pré-prod | **Auth interne non déterministe** : `GET /api/admin/ledger/check` → 401 avec le token canonique de `.env.local` (v3 mesuré) — le processus compare une autre valeur (injection hébergeur ou fichier `.env*` ombrant). Contrat cible et fix : `docs/ops/RUNTIME-SECRET-SOURCE-MATRIX.md` §2/§3. Non bloquant pour la réconciliation financière (directe, opérateur v4). | Décision après la mesure v4 `INTERNAL_CRON_TOKEN PRESENT BEFORE ENV LOAD`. |
| T-40 | P2 doc | `CLAUDE.md §9` décrit le `server.js` racine comme entrée Passenger ; le déploiement livre `.next/standalone/server.js` (Next) — le chargeur d'env réel est `@next/env` (dotenv). Corriger la doc (fondateur). | Mesuré par lecture du workflow + exclusions FTP. |

| T-41 | **P1 pré-prod (pré-existant)** | **Fichiers de la racine d'application servis publiquement** (mesuré HEAD 2026-09-05 staging) : `/server.js` 200, `/package.json` 200, `/prisma/schema.prisma` 200 (schéma complet), `/tmp/restart.txt` 200, `/scripts/server/*.js` 200 ; `/.env.local` et `/.htaccess` 404 (aucun secret). Cause : DocumentRoot Apache = racine Passenger. Remédiation : règles `.htaccess` serveur (`RUNTIME-SECRET-SOURCE-MATRIX.md §5`), à appliquer par le fondateur ou par un opérateur dédié après décision ; vérifier ensuite `/fr/eat` 200. | Divulgation d'information, pas de fuite de secret ; non bloquant TEST ; bloquant prod. |
| T-41 (mise à jour 2026-09-05) | **P1 PRÉ-PRODUCTION — bloquant prod, train infra SÉPARÉ** | **APP ROOT SOURCE EXPOSURE HARDENING** — classes secret toutes 404 (mesuré : `.env*` ×8 dont 4 sauvegardes `.env.local.bak*` testées par le fondateur, `.htaccess`, `.git/*`, `*.sql`, logs) ⇒ **aucune fuite de secret confirmée** ; classes source 200 (`/server.js`, `/package.json`, `/prisma/schema.prisma`, `/tmp/restart.txt`, `/scripts/server/*.js`, `/lib/ledger-check-core.js`). Handoff complet : `docs/ops/WEB-ROOT-HARDENING-HANDOFF.md` (sauvegarde, protection dotfiles existante à étendre, plus petit changement, baseline, vérifications ≤ 60 s, **rollback automatique**, jamais le fondateur à la main). Promotion P0 uniquement si un fichier portant un identifiant devient lisible. | `.htaccess` **non modifié** par le train financier Phase 2 ; l'opérateur v5 remesure à chaque run et passe en FAIL P0 si une classe secret répond 200. |
