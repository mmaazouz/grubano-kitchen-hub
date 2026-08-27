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
| T-05 | **Flags argent à trancher pour la bêta** : défauts OFF = annulation payée sans circuit ET aucun refund in-app | `lib/claims.ts`, `lib/refund.ts` — comportements documentés runbook §7bis | Décision fondateur : CLAIMS_ENABLED (exige table Claim en base) + REFUNDS_ENABLED ; sinon procédure Stripe manuelle du runbook | Une commande payée annulée a un circuit de remboursement établi |
| T-06 | **ALERT_EMAIL + crons staging** : l'alerte ghost-order est un no-op silencieux sans ALERT_EMAIL ; confirm-sweep/reconcile-digest inertes hors main | `lib/admin-alerts.ts:30-31` ; `docs/ops/crons.md` | Poser ALERT_EMAIL sur staging + appel manuel quotidien `GET /api/admin/reconcile-ghost-orders` (runbook) pendant la bêta | Un paiement fantôme déclenche une alerte réellement reçue |
| T-07 | **Stripe Connect non exigé à l'approbation** : fallback plateforme = 100 % de l'argent chez Grubano sans rail de reversement | `app/api/orders/[id]/pay/route.ts:189-252` ; `lib/partner-balance.ts` | Checklist 7.1 du runbook (fait) ; durcissement optionnel : afficher le statut Connect dans /admin/approvals | Aucun resto approuvé sans décision consciente sur Connect |
| T-08 | **Empreinte réservation active par défaut (10 €)** alors que le fondateur la croyait retirée | `prisma/schema.prisma:1476` `@default(10)` ; `app/api/reservations/public/route.ts:104` | Décision fondateur : (a) assumer l'empreinte documentée, (b) `defaultDepositAmount 0` + fallback `?? 0` + gate flag sur `/deposit` (patch mécanique prêt), ou (c) pilote sans `reservable` | Le comportement réel = le comportement voulu |
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
