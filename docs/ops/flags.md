# Feature flags — inventaire et procédure (S0-4)

Convention repo : un flag n'est actif que si sa variable d'env vaut **exactement**
la chaîne `'true'` (comparaison stricte). Tout le reste (absent, vide, `1`,
`TRUE`) = OFF. **Tous les flags sont OFF par défaut au code.**

Les VALEURS par environnement ne sont pas dans le repo (elles vivent dans le
`.env.local` de chaque serveur). Le relevé de référence par env est le format
M9 : `présent/absent · ON/OFF · environnement` — jamais de valeur de secret.
⚠️ À CONFIRMER SERVEUR : le set réellement ON en staging (constat d'audit :
~6 flags ON en staging ; relevé exact dans les pages d'audit Notion M9).

## Inventaire (lecteur canonique dans `lib/`) ✅

| Flag | Lu par | Effet (1 ligne) |
|---|---|---|
| `ADMIN_AUDIT_ENABLED` | `lib/admin-audit.ts` | Journal d'audit des actions admin |
| `AFFILIATE_ENABLED` | `lib/affiliate-account.ts` | Surface affilié entière (404 OFF) |
| `AFFILIATE_CONNECT_ENABLED` | `lib/creator-payout.ts` | Onboarding Stripe Connect affilié |
| `ATTRIBUTION_COOKIES_ENABLED` | `lib/attribution-cookies.ts` | Pose des cookies d'ATTRIBUTION `grubano_ref` (/api/ref/[code]) et `grubano_chef` (/api/chef-visit/[slug]) — défaut OFF **toute la bêta** (règle « tracker non essentiel → OFF plutôt que CMP »). Seul le Set-Cookie est gaté : redirection, validation du code et click-tracking affilié restent byte-identical |
| `ALLOW_PLATFORM_FALLBACK` | `lib/connect-gate.ts` | ⚠️ **DANGER-FLAG D'OUVERTURE (D5)** — défaut ABSENT = BLOQUANT : les routes de paiement (`/api/orders/[id]/pay`, `/api/tickets/[id]/pay`) et la création de commande carte REFUSENT (`409 restaurant_not_payable`) tout restaurant sans compte Connect ACTIF — le fallback plateforme encaisserait l'argent du resto sans AUCUN rail de reversement. `true` restaure le comportement historique (PI nu plateforme) : **QA/harnais UNIQUEMENT, JAMAIS en production**. |
| `AUTH_EMAIL_CHANGE_ENABLED` | `lib/email-change.ts` | Changement d'email de compte (3 routes confirm) |
| `AUTH_EMAIL_OTP_ENABLED` | `lib/email-otp.ts` | OTP email au login |
| `AUTH_MONEY_STEPUP_ENABLED` | `lib/email-otp.ts` | Step-up OTP sur actions argent |
| `CHARGEBACKS_ENABLED` | `lib/dispute.ts` | Cycle litiges/chargebacks |
| `CLAIMS_ENABLED` | `lib/claims.ts` | Réclamations client (⚠️ exige la table `Claim` en base — cf. harnais P10) |
| `CLAIMS_AUTO_APPROVE_ENABLED` | `lib/claims.ts` | Route d'auto-approbation des réclamations (P0-25 — défaut OFF **toute la bêta** : le sweep `auto_timeout` rembourse sans humain ; OFF → 403 explicite tracé) |
| `CLAIM_AUTO_RESOLVE_ENABLED` | `lib/claims.ts` | Auto-résolution des PETITES réclamations `auto_small` (P0-27 — défaut OFF **toute la bêta** : elle remboursait sans humain dès 10 €). Verrou n°2 : `CLAIM_AUTO_APPROVE_MAX_CENTS` (plafond en centimes, **défaut 0 = désactivé**, valeur mal formée → 0 tracé, jamais permissif) |
| `CONSUMER_REDESIGN_ENABLED` | `lib/consumer-redesign.ts` | Re-design conso |
| `CREATOR_ENABLED` | `lib/creator-account.ts` | P0-06 (Q8) : rôle CRÉATEUR entier — 22 routes 404 OFF (apply/vetting/dishes/profil/pages publiques chef/earnings/connect + rails admin payout) |
| `CREATOR_PAYOUT_ENABLED` | `lib/creator-payout.ts` | Versements créateurs |
| `DELIVERY_FULFILLMENT_ENABLED` | `lib/fulfillment.ts` | P0-01 (pilote Q1) : OFF (défaut) = retrait UNIQUEMENT — `POST /api/orders` refuse `delivery` (403). ON = la livraison revient, gouvernée par les colonnes `Restaurant.deliveryEnabled`/`pickupEnabled` (lues dans les deux modes). ⚠️ Ops pilote : `pickupEnabled` défaut FALSE en base — activer explicitement les restaurants du pilote (le seed démo le fait). |
| `DINEIN_SERVICE_ENABLED` | `lib/dinein-service.ts` | Frais de service dine-in |
| `FRANCHISE_ENABLED` | `lib/franchise-account.ts` | P0-06 (Q8) : rôle FRANCHISE entier — 12 routes 404 OFF (apply/approve/brands/POS/finances/profil + côté franchisé + rail settlement admin) |
| `FRANCHISE_POS_TAGGING_ENABLED` | `lib/franchise-pos-tagging.ts` | Attribution POS des commandes |
| `FRANCHISE_ROYALTY_ENABLED` | `lib/franchise-royalty.ts` | Royalties franchise |
| `FRANCHISE_SETTLEMENT_ENABLED` | `lib/franchise-settlement.ts` | Reversement franchiseur |
| `GHOST_ORDER_AUTO_REFUND_ENABLED` | `lib/refund.ts` | Auto-refund ghost-order du webhook (P0-04 — défaut OFF, peut rester OFF toute la bêta ; OFF → file manuelle `reconcile_manual`) |
| `INFLUENCER_ENABLED` | `lib/influencer-verification.ts` | Palier influenceur (vérif audience + taux majoré) |
| `LOGISTICS_AVAILABILITY_ENABLED` | `lib/logistics-availability.ts` | Statut en ligne livreur |
| `LOGISTICS_COURIER_ACCRUAL_ENABLED` | `lib/courier-accrual.ts` | Accrual course livreur (cas B) |
| `LOGISTICS_COURIER_ACTIVATION_ENABLED` | `lib/logistics-account.ts` | Activation des comptes livreurs |
| `LOGISTICS_DISTANCE_FEE_ENABLED` | `lib/logistics-fee.ts` | Frais de livraison à la distance |
| `LOGISTICS_ENABLED` | `lib/logistics-account.ts` | P0-06 (Q8) : rôle LIVREUR entier — 17 routes 404 OFF. EXCLUSIONS voulues : fee-preview (surface panier conso), positions/sweep (purge RGPD cron), my-position-data (art. 15/17), tracking-consent (retrait du consentement) |
| `LOGISTICS_MISSIONS_ENABLED` | `lib/missions.ts` | Missions livreur (404 OFF) |
| `LOGISTICS_PAYOUT_ENABLED` | `lib/creator-payout.ts` | Versements livreurs |
| `LOGISTICS_TRACKING_ENABLED` | `lib/logistics-tracking.ts` | Géoloc livreur (capture + affichage + purge) |
| `ONBOARDING_AI_CHAT_ENABLED` | `lib/onboarding-chat.ts` | Chat IA d'onboarding |
| `ONBOARDING_AI_LOGO_PREFILL_ENABLED` | `lib/logo-detect.ts` | Préremplissage logo IA |
| `ONBOARDING_AI_MENU_PREFILL_ENABLED` | `lib/menu-extract.ts` | Préremplissage menu IA |
| `ONBOARDING_AI_SITE_PREFILL_ENABLED` | `lib/site-extract.ts` | Préremplissage depuis site web (SSRF-safe) |
| `ONBOARDING_GUIDE_ENABLED` | `lib/onboarding-progress.ts` | Guide d'onboarding |
| `ONBOARDING_NUDGE_ENABLED` | `lib/onboarding-nudge.ts` | Relances email onboarding (cron) |
| `PRESTATAIRE_ENABLED` | `lib/prestataire-account.ts` | Marketplace prestataires (404 OFF) |
| `PUNITIVE_CAPTURE_ENABLED` | `lib/deposit.ts` | V4-1 (décision fondateur, motif JURIDIQUE — défaut OFF **tout le pilote**) : capture PUNITIVE d'empreinte (pénalité no-show + walk-out impayé). OFF → `captureHold` refuse (403 tracé, point d'étranglement lib) et le no-show LIBÈRE l'empreinte au lieu de la capturer. L'empreinte (pré-autorisation + libération) n'est PAS gouvernée par ce flag. Le choix walk-out `capture` (tickets/close) DÉGRADE en libération. Aucun couplage : bascule autonome (flux ENTRANT, aucun fonds tiers retenu — les holds sont libérés). ⚠️ À la réactivation post-pilote, RESTAURER les annonces de pénalité retirées par V4-1 (`eat.reservation.depositIntro`, email `sendReservationConfirmation`, `tables.deposit.actionConfirm*`, `tables.noShow.penaltyNote`, `premium.closure.depositCapture`, `premium.closure.captureWarning`, `premium.closure.confirmCapture` ×5 locales) — capturer sans l'annoncer au client serait pire juridiquement |
| `PRESTATAIRE_CONNECT_ENABLED` | `lib/prestataire-connect.ts` | Connect prestataire |
| `RATE_LIMIT_ENABLED` | `lib/rate-limit.ts` | Rate-limiting applicatif (sûr à activer — audit go-live) |
| `REFUNDS_ENABLED` | `lib/refund.ts` | Moteur de remboursement : outil admin `/api/admin/refunds/run` **et** les rails `lib/claims.ts:199,325` / `lib/dispute.ts`. P0-04 : ne gouverne **plus** l'auto-refund ghost-order du webhook → `GHOST_ORDER_AUTO_REFUND_ENABLED`. ⚠️ Ne suffit donc PAS à garantir « aucun remboursement sans admin » : cf. note Q3 sous les couplages |
| `SUPPLIER_ENABLED` | `lib/supplier-account.ts` | P0-06 (Q8) : rôle FOURNISSEUR entier — 12 routes 404 OFF + webhook stripe-supplier (double flag). L'annuaire privé opérateur `/api/suppliers` (pluriel) n'est PAS gaté (feature restaurant) |
| `SUPPLIER_CONNECT_ENABLED` | `lib/supplier-connect.ts` | Paiements fournisseurs B2B |
| `TIPS_ENABLED` | `lib/tips.ts` | Pourboires (⚠️ fonds tiers — voir couplages) |

Trois flags supplémentaires, lus via la table de `lib/connect-onboarding.ts:32-34`
(onboarding Stripe Connect par type de partenaire) : `CREATOR_CONNECT_ENABLED`,
`FRANCHISE_CONNECT_ENABLED`, `LOGISTICS_CONNECT_ENABLED`.

## Couplages OBLIGATOIRES (`scripts/check-flags.mjs`) ✅

Un flag ON dont le prérequis est OFF = danger argent/confiance. Vérifiés par
`npm run check:flags` (exit 1 si violé) et par `tests/flag-coupling.test.ts` :

| Si ce flag est ON… | …alors celui-ci DOIT l'être | Pourquoi |
|---|---|---|
| `CLAIMS_ENABLED` | `REFUNDS_ENABLED` | claim approuvée sans refund = approuvée-mais-non-remboursée |
| `GHOST_ORDER_AUTO_REFUND_ENABLED` | `REFUNDS_ENABLED` | l'auto-refund ghost-order réutilise le moteur admin (P0-04). L'inverse n'est PAS requis : `REFUNDS` seul n'allume PAS le chemin webhook |
| `CLAIMS_AUTO_APPROVE_ENABLED` | `CLAIMS_ENABLED` | l'auto-approbation balaye des réclamations (P0-25) ; via `CLAIMS`⇒`REFUNDS` elle exige transitivement le moteur |
| `CLAIM_AUTO_RESOLVE_ENABLED` | `CLAIMS_ENABLED` | l'auto-résolution `auto_small` rembourse sans validation humaine (P0-27) ; via `CLAIMS`⇒`REFUNDS` elle exige transitivement le moteur |
| `TIPS_ENABLED` | `LOGISTICS_PAYOUT_ENABLED` | pourboire encaissé sans rail de reversement = fonds tiers retenus (D-1) |
| `LOGISTICS_COURIER_ACCRUAL_ENABLED` | `LOGISTICS_PAYOUT_ENABLED` | course retenue sans reversement (D-1 symétrique) |
| `LOGISTICS_PAYOUT_ENABLED` | `LOGISTICS_CONNECT_ENABLED` | reversement sans compte Connect onboardé |
| `FRANCHISE_ROYALTY_ENABLED` | `FRANCHISE_SETTLEMENT_ENABLED` | royalties accumulées sans reversement |
| `FRANCHISE_SETTLEMENT_ENABLED` | `FRANCHISE_CONNECT_ENABLED` | settlement sans compte Connect |
| `CREATOR_PAYOUT_ENABLED` | `CREATOR_CONNECT_ENABLED` | payout créateur sans compte Connect |
| `CREATOR_CONNECT_ENABLED` · `CREATOR_PAYOUT_ENABLED` | `CREATOR_ENABLED` | capacité créateur ON alors que le rôle est masqué (P0-06) |
| `SUPPLIER_CONNECT_ENABLED` | `SUPPLIER_ENABLED` | paiements B2B ON alors que le rôle fournisseur est masqué (P0-06) |
| `FRANCHISE_CONNECT_ENABLED` · `FRANCHISE_ROYALTY_ENABLED` · `FRANCHISE_POS_TAGGING_ENABLED` | `FRANCHISE_ENABLED` | capacité franchise ON alors que le rôle est masqué (P0-06) |
| `LOGISTICS_CONNECT_ENABLED` · `LOGISTICS_MISSIONS_ENABLED` · `LOGISTICS_COURIER_ACTIVATION_ENABLED` · `LOGISTICS_AVAILABILITY_ENABLED` · `LOGISTICS_TRACKING_ENABLED` | `LOGISTICS_ENABLED` | capacité livreur ON alors que le rôle est masqué (P0-06) |

### ⚠️ Note Q3 — ce que la scission P0-04 règle, et ce qu'elle NE règle PAS

P0-04 supprime **un** chemin automatique : le webhook ghost-order ne rembourse plus
sans son propre flag (défaut OFF). Il reste, avec `CLAIMS_ENABLED`+`REFUNDS_ENABLED` ON,
**un remboursement déclenché par le RESTAURATEUR** (et non par un admin Grubano), pour un
montant **partiel** : `RestaurantClaimsPanel` → `POST /api/claims/[id]/respond` (accept) →
`lib/claims.ts:284` → `approveClaim:244` → `triggerClaimRefund:197` → `executeRefund`.
Un second chemin machine existe aussi (`runClaimAutoApproval:302-338`, `auto_timeout` —
son scheduler a été retiré par P0-07, mais la route `/api/admin/claims/auto-approve`
demeure appelable). Les deux contredisent Q3 (validation admin seule + intégral).

**Mise à jour vague 1 (mission E)** : ces deux portes sont désormais fermées —
P0-24 route l'accept restaurateur vers la file admin (`arbitration`, zéro argent) ;
P0-25 met la route d'auto-approbation derrière `CLAIMS_AUTO_APPROVE_ENABLED`
(défaut OFF toute la bêta, 403 explicite tracé).

**Mise à jour vague 1 (mission C — P0-27)** : la dernière porte signalée est fermée.
L'auto-résolution des petites réclamations (`autoResolveSmallClaim`, `decidedBy
'auto_small'`) remboursait **sans humain et par défaut** (plafond 1000 centimes
implicite) dès CLAIMS+REFUNDS ON. Elle est désormais FAIL-SAFE : double verrou
`CLAIM_AUTO_RESOLVE_ENABLED` (défaut OFF) **et** `CLAIM_AUTO_APPROVE_MAX_CENTS`
(défaut 0 ; mal formée → 0 tracé). Avec le set bêta (CLAIMS+REFUNDS, rien d'autre),
**plus aucun chemin de remboursement sans validation humaine n'existe** — les seuls
déclencheurs restants sont admin : `/api/admin/refunds/run`, les 3 routes refund
admin (P0-03/P0-26) et `arbitrateClaim` (P0-24).

## Procédure de bascule d'un flag (staging) — sans rien exécuter ici

1. Vérifier le couplage EN LOCAL avant toute bascule :
   (sur votre ordinateur, dans le dossier du projet — exemple concret, copiable :)
   `CLAIMS_ENABLED=true REFUNDS_ENABLED=true node scripts/check-flags.mjs`
   — en remplaçant les deux flags par le set cible complet.
2. Vérifier les prérequis DB du flag (ex. `CLAIMS_ENABLED` exige que la table
   `Claim` existe → `bash ~/app.grubano.com/scripts/server/prisma-push.sh` si
   le schéma a changé depuis le dernier push).
3. cPanel Terminal → éditer `~/app.grubano.com/.env.local` (jamais via FTP,
   jamais commité).
4. `touch ~/app.grubano.com/tmp/restart.txt` (Passenger recharge l'env).
5. Vérifier l'effet par la surface gatée (404/403 attendu → réel) et
   `curl -s https://app.grubano.com/version.json` pour confirmer quel build tourne.
