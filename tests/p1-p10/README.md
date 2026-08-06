# Harnais P1-P10 — photographie de l'état actuel (Sprint 0 / S0-1)

Encode les 10 parcours critiques du protocole M7 (« contre-vérification boîte
noire ») en tests **de caractérisation** rejouables : chaque test affirme le
comportement **ACTUEL** du code, y compris quand il est buggé. La suite est
donc **verte aujourd'hui** — c'est une photographie, pas un jugement.

Zéro correctif métier n'a été apporté (règle Sprint 0). Les bugs connus de
l'audit sont encodés, pas corrigés.

## Les trois statuts (préfixe du titre de chaque test)

| Préfixe | Sens | Après correctif post-arbitrage |
|---|---|---|
| `[PASS-ACTUEL]` | Le comportement actuel est le comportement voulu. | Doit rester vert. |
| `[FAIL-ATTENDU: <constat>]` | Le test affirme le comportement actuel **buggé** (bug connu de la Carte des écarts v1, référencé dans le titre). | **Devient rouge quand le bug est corrigé** → l'agent du correctif doit inverser l'assertion. C'est voulu : impossible de corriger sans mettre à jour la photographie. |
| `[NON-TESTABLE: <raison>]` | Dépendance environnement : Stripe (`it.skipIf(!process.env.STRIPE_SECRET_KEY)` — présence seule, jamais la valeur) ou UI navigateur (`it.todo`). | Le harnais tourne en CI **sans clés Stripe**, sans erreur. |

## Lancer

```bash
npx vitest run tests/p1-p10 --reporter=dot   # harnais seul
npm run test:ci                              # suite complète (gate des deux deploys)
```

Les deux workflows de déploiement (`deploy-staging.yml`, `deploy-production.yml`)
exécutent déjà `npm run test:ci` en gate bloquant → ce harnais bloque
automatiquement tout push qui changerait la photographie sans l'assumer.

## Inventaire (146 tests au commit de création ; 148 après les ré-photographies de vague 1 — P8/P10, voir totaux)

| Parcours | Fichier | Tests | PASS | FAIL-ATT. | NON-TEST. | Constat clé |
|---|---|---|---|---|---|---|
| P1 Référence C&C carte | `p1-reference-click-collect.test.ts` | 30 | 25 | 3 | 2 | Socle hors-argent OK bout en bout (machine d'états + fidélité idempotente à `delivered`). **1 test ré-photographié vague 1 (P0-02)** : pickup+espèces → 400 (comptes inchangés). |
| P2 Carte refusée | `p2-carte-refusee.test.ts` | 19 | 15 | 1 | 3 | Anti-double-paiement **CONFIRMÉ** (3 couches). Mais aucun handler `payment_intent.payment_failed` → un refus carte ne laisse aucune trace serveur. |
| P3 Annulation resto payée | `p3-annulation-resto-payee.test.ts` | 17 | 15 | 0 | 2 | **Ré-photographié vague 4 (P0-08)** : l'absence de remboursement automatique est désormais l'état VOULU (Q3) — annuler une commande PAYÉE crée une demande d'arbitrage SYSTÈME dans la MÊME transaction (motif `system_order_cancelled`, montant intégral) + email honnête localisé ; NON payée = chemin historique byte-identique. Plus aucun FAIL-ATTENDU. |
| P4 Annulation client | `p4-annulation-client.test.ts` | 7 | 3 | 3 | 1 | Annulation client **inexistante** (aucune route ; PATCH status → 403 pour un consumer). |
| P5 Refund humain | `p5-refund-humain.test.ts` | 7 | 5 | 0 | 2 | Modale `/finance` inerte **par construction** (bouton `disabled` en dur) ; le rail owner `POST /api/orders/[id]/refund` fonctionne, lui, indépendamment de la surface. |
| P6 Support | `p6-support-decoratif.test.ts` | 20 | 6 | 9 | 5 | Support décoratif confirmé (aucun backend, e-mail sans `mailto:`, présence « En ligne » simulée, ETA promis en dur). Nuance : la vue remboursement de l'aide est câblée sur `/api/claims` mais gatée `CLAIMS_ENABLED` OFF. |
| P7 Livraison | `p7-livraison-terminale.test.ts` | 12 | 8 | 3 | 1 | `delivered` **atteignable via l'API resto** (écart vs audit) mais jamais via l'UI (bouton gaté pickup) ni via le rail livreur (Mission ≠ Order) → fidélité jamais créditée sur une delivery pilotée par les surfaces réelles. |
| P8 Cash payable carte | `p8-cash-payable-carte.test.ts` | 14 | 12 | 0 | 2 | **Ré-photographié vagues 1+2 (P0-02 + P0-29)** : ACT 1 — cash/wallet REFUSÉS 400 à la création ; ACT 2 — `/pay` LIT désormais `paymentMethod` et refuse toute commande non-carte (409 `payment_method_mismatch`, zéro PI, zéro écriture, tracé). Le double encaissement des lignes HÉRITÉES est FERMÉ — plus aucun FAIL-ATTENDU sur ce parcours. |
| P9 Avis / ★ seedée | `p9-avis-etoile-seedee.test.ts` | 12 | 6 | 5 | 1 | `orderId` fantôme stocké verbatim, aucun check rôle/commande (auto-avis possible) ; `Restaurant.rating` seedé jamais recalculé (documenté « choix produit différé » dans le code). |
| P10 Claims activation | `p10-claims-activation.test.ts` | 14 | 8 | 3 | 3 | **Ré-photographié vague 1 (P0-27)** : plus d'`auto_small` par défaut — sans `CLAIM_AUTO_RESOLVE_ENABLED`+plafond explicites, une petite réclamation reste en revue restaurant (tracé). Vecteur de crash réel inchangé = flag ON sans `prisma db push` (P2021 → 500 brut), y compris en GET. Gate OFF = 403 `{gated:true}`, pas 404. |

**Totaux : 90 PASS-ACTUEL · 34 FAIL-ATTENDU · 22 NON-TESTABLE** (à la création — 146 tests ; après vague 1 — P8 ACT 1 + P10 : 148 = 94 · 32 · 22 ; après vague 2 — P8 ACT 2 (P0-29) : 149 = 98 · 29 · 22 ; après vague 4 — P3 (P0-08) : 152 tests = 103 · 27 · 22).

## Écarts notables vs la Carte des écarts v1 (à reporter à Agent 0)

1. **P2** : « anti-double-paiement ⚪ à confirmer » → confirmé au niveau route
   (409 avant Stripe, réutilisation du PI en `requires_payment_method`,
   idempotencyKey déterministe).
2. **P7** : « delivered jamais atteignable côté resto » est faux au niveau API
   (le PATCH accepte `ready→picked_up→delivered` et même `ready→delivered`
   direct, la machine ne lit pas `fulfillmentType`) — le verdict reste vrai en
   pratique via l'UI et le rail livreur.
3. **P10** : le « crash à l'activation » n'est pas dans la logique : c'est
   l'absence de la table `Claim` (activation sans migration) + l'absence de
   toute frontière d'erreur dans la route.
4. **P1** : le crédit fidélité ne passe plus par `loyaltyCustomer.updateMany`
   (CLAUDE.md §13 obsolète) : `upsert` par email + `$transaction` idempotente.
   Par ailleurs `POST /api/orders` est session-only (401), pas « session/public »
   comme le documente CLAUDE.md §6.
5. **P8** : `Order.paymentStatus` n'a pas de défaut → une commande cash reste
   `paymentStatus=null` à vie ; la base des points inclut les frais de livraison.

## Règles pour les prochains agents

- Ne JAMAIS « réparer » un `[FAIL-ATTENDU]` en douce : l'inversion de
  l'assertion fait partie du correctif et doit être dans le même commit.
- Ne pas ajouter ici de tests d'autres périmètres : ce dossier = les 10
  parcours M7, rien d'autre.
- Les `it.todo` UI seront convertis en E2E navigateur seulement si l'arbitrage
  le demande (hors périmètre Sprint 0).
