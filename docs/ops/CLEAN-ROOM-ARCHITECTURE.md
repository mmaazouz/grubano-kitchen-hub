# CLEAN ROOM — ARCHITECTURE DELETE / ARCHIVE / PRESERVE
> Mission BETA SECURITY GATE (2026-08-29). PRÉPARATION SEULE — aucune exécution ici.
> Correction de doctrine : le Clean Room ne signifie PAS « DELETE EVERYTHING TEST ».
> Cible : 0 compte test connectable · 0 credential public actif · 0 resto test public/commandable ·
> 0 donnée démo visible dans le produit · 0 seed démo possible sur la bêta — SANS casser
> la cohérence des historiques (ledger/refunds/orders/invoice/audit/compteurs).

## Pré-requis (ordre obligatoire, AVANT toute passe destructive)
1. Neutralisation sécurité exécutée (`scripts/server/neutralize-public-credentials.js` — POSTCHECK `ACTIVE WITH PASSWORD = 0`).
2. Flags bêta corrigés (CLAIMS OFF, LOGISTICS_SIGNUP ON — pack env).
3. ZERO-TO-ORDER local PASS.
4. Classification UNKNOWN renvoyée par le fondateur (gabarit de `unknown-evidence-read.js`).
5. Rehearsal staging PASS (données de répétition identifiées par l'e-mail jetable).

## DELETE (hard) — seulement si TOUT est vrai
- classe **TEST PROVED** (jamais HIGH sans confirmation fondateur, jamais UNKNOWN) ;
- **0 commande** (`Order.restaurantId` FK Restrict), **0 LedgerEntry** (append-only, réf sans FK), **0 Refund/Invoice/Claim/FranchiseRoyalty/ReferralOrder** référencés ;
- pas de compteur/numérotation impliqué.
Candidats types : marques/menus/POS `demo-*` sans historique, opérateurs seed jamais utilisés, restos test SANS commande, LoyaltyOrders `QA-PARITY-%`, réservations `source='qa-parity'` sans empreinte, données de répétition (après la répétition).
Ordre de suppression (FK) : enfants → parents : TicketItem→TableTicket ; OrderItems(json) n/a ; Review/Waitlist (cascade) ; Order (⚠ ReferralOrder d'abord) ; OpeningHour/ClosureException ; RestaurantTable/Reservation ; Brand/MenuItem/StockItem/Promotion ; Restaurant ; OperatorRole/Address/Account/Session (cascade) ; Operator.

## ARCHIVE / SUSPEND (pattern OFFICIEL du repo) — pour tout test AVEC historique
- **Restaurant test avec commandes/ledger** (ex. « Resto Test » 63 orders/28 paid/64 ledger) : `archivedAt=now, isActive=false, approvedAt=null` → non public, non commandable, non listé ; historique intact. JAMAIS de delete.
- **Opérateur test avec historique** : `status='suspended'` + `password=null` + purge tokens + Sessions supprimées (= non connectable) ; la ligne survit pour `Order.consumerId`/audit.
- **Connect TEST historique** (« Resto Test » acct_ TEST) : **PRESERVE la référence** (`stripeAccountId` reste sur la ligne archivée) — un compte Connect TEST est inerte et gratuit ; le déconnecter casserait la réconciliation ledger↔Stripe TEST. Aucune action Stripe LIVE. Option post-bêta : reject du compte TEST côté dashboard Stripe, sans toucher la base.
- **Commandes/orders test payés** : conservés tels quels (ledger + Refund pointent dessus) — l'archivage du resto les rend invisibles du produit.

## PRESERVE (toujours)
Permanent admin (admin-qa@… passwordless) · tout REAL · tout UNKNOWN non classé par le fondateur · **Invoice (document légal — 1 émise)** · **InvoiceCounter (2026 seq=1) + ServiceInvoiceCounter** (numérotation sans trous) · AdminAuditLog (append-only) · LedgerEntry (append-only : l'équation gross=fee+net doit rester vérifiable) · EmailLog/EmailDispatch (traçabilité) · configs singleton (ReferralConfig/AdoptionConfig — ⚠ valeur 0.22 = empreinte seed : à RÉALIGNER sur les défauts schéma, pas à supprimer) · waitlist livreur réelle · VerificationToken/Session de l'admin conservé.

## ORPHELINS — vérification à 0 inattendu
Le futur script de nettoyage devra compter APRÈS chaque lot :
- `LedgerEntry.restaurantId` → doit pointer sur un resto EXISTANT (archivé compte comme existant) ;
- `Refund.orderId`, `Claim.orderId`, `FranchiseRoyalty.orderId` → Order existant ;
- `Order.consumerId` → Operator existant (suspendu ok) ;
- `ReferralOrder` (FK NOT NULL) supprimé AVANT son Order.
`UNEXPECTED ORPHANS = 0` est un gate de sortie du Clean Room, au même titre que `TEST PROVED restants = 0 connectables`.

## Ce que le Clean Room NE fait PAS
Pas de TRUNCATE · pas de wildcard/domaine · pas de suppression de ledger/invoice/audit/compteurs · pas d'action Stripe LIVE · pas de suppression d'UNKNOWN (même « domaine jetable » — le domaine n'est pas une preuve) · pas d'atteinte au COUNT pour le plaisir du zéro : la cible est « invisible + non connectable + non recréable », pas « table vide ».
