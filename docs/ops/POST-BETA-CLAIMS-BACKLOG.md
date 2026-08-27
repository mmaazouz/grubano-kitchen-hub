# POST-BETA — CLAIMS MODULE (dette explicite, priorité P1 post-bêta)

> **Décision fondateur D4 (2026-08, FINALE pour la bêta du 1er septembre)** :
> `CLAIMS_ENABLED=false` toute la closed beta — faute de temps pour éprouver le
> module. **L'escalade incident = support humain réel** (contact@grubano.com,
> alerte admin idempotente à chaque annulation payée, vue
> `/admin/reconciliation` « annulées payées », refund admin via
> `POST /api/orders/[id]/refund`). **Ne jamais réactiver automatiquement.**

## Ce qui existe DÉJÀ (construit, testé, dormant)

- **Backend complet** : `lib/claims.ts` (cycle restaurant_review → arbitration →
  approved/refunding/refunded/rejected ; `createSystemClaim` à l'annulation
  payée ; `activeOrderKey @unique` anti-doublon ; auto-résolution petites
  réclamations TRIPLE-verrouillée OFF) ; 8 routes API toutes gatées
  `isClaimsEnabled()` ; arbitrage admin (`arbitrateClaim` → `triggerClaimRefund`
  → moteur `executeRefund`).
- **UI** : formulaire client (`/eat/order/[orderId]/help`, vue masquée flag-OFF
  au profit du support humain), panneau resto (`RestaurantClaimsPanel`, null
  flag-OFF), console admin `/admin/claims` (redirect flag-OFF), `ClaimSection`
  suivi client.
- **Emails localisés ×5** (`lib/claim-emails.ts`, RTL ar) : dépôt, décision,
  remboursé, annulation payée (variante ON) — la variante OFF honnête existe
  aussi désormais (`sendOrderCancelledPaidOffEmail`).
- **Tests** : `tests/claims-*.test.ts`, `p3-annulation-resto-payee` (chemins ON
  et OFF), `refund-*` (moteur).
- **Depuis P0-24** : l'accept RESTAURATEUR ne déclenche PLUS d'argent — seul
  l'arbitrage ADMIN rembourse. `REFUNDS_ENABLED` ne gouverne plus aucun chemin
  restaurateur.

## Ce qui MANQUE avant réactivation

1. **Base contractuelle** : les CGV/conditions consommateur n'existent pas —
   le cycle réclamation (délais de réponse, critères, préavis) doit s'y adosser.
2. **Table `Claim` en base** : `db push` serveur requis (`docs/ops/flags.md:25`).
3. **Charge opérationnelle** : le cycle exige un répondant restaurant + un
   arbitre admin dans les délais (`claim_response_deadline`) — non tenable à
   un seul opérateur pendant la bêta.
4. **Éprouvage** : zéro réclamation réelle n'a jamais traversé le cycle complet
   en conditions réelles (seulement les tests).
5. Petites finitions : label client de l'état FAILED ; digest admin des claims
   en attente (l'alerte stale existe déjà).

## Conditions de réactivation (dans l'ordre)

1. CGV consommateur publiées (adossement contractuel du cycle).
2. `prisma db push` serveur (table `Claim`).
3. Décision fondateur sur les délais/critères (jamais inventés par un agent).
4. Poser `CLAIMS_ENABLED=true` (+ garder `CLAIMS_AUTO_APPROVE_ENABLED` et
   `CLAIM_AUTO_RESOLVE_ENABLED` OFF — remboursements sans humain interdits Q3).
5. Restaurer la variante d'email ON (automatique : le choix d'email est
   gouverné par le flag) et re-exposer la vue client (automatique aussi).

## Tests d'acceptation à rejouer à la réactivation

- Annulation d'une commande payée → une réclamation système en file admin,
  email honnête ON, arbitrage admin → refund → client informé.
- Dépôt client dans la fenêtre d'éligibilité ; hors fenêtre refusé.
- Accept restaurateur → arbitration SANS argent (P0-24 tenu).
- Rejeu/duplication : `activeOrderKey` anti-doublon ; refund idempotent.
- Flag OFF → retour exact au comportement bêta (masquages, email OFF, 403).
