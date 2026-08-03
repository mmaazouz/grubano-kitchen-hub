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
| `AUTH_EMAIL_CHANGE_ENABLED` | `lib/email-change.ts` | Changement d'email de compte (3 routes confirm) |
| `AUTH_EMAIL_OTP_ENABLED` | `lib/email-otp.ts` | OTP email au login |
| `AUTH_MONEY_STEPUP_ENABLED` | `lib/email-otp.ts` | Step-up OTP sur actions argent |
| `CHARGEBACKS_ENABLED` | `lib/dispute.ts` | Cycle litiges/chargebacks |
| `CLAIMS_ENABLED` | `lib/claims.ts` | Réclamations client (⚠️ exige la table `Claim` en base — cf. harnais P10) |
| `CONSUMER_REDESIGN_ENABLED` | `lib/consumer-redesign.ts` | Re-design conso |
| `CREATOR_PAYOUT_ENABLED` | `lib/creator-payout.ts` | Versements créateurs |
| `DINEIN_SERVICE_ENABLED` | `lib/dinein-service.ts` | Frais de service dine-in |
| `FRANCHISE_POS_TAGGING_ENABLED` | `lib/franchise-pos-tagging.ts` | Attribution POS des commandes |
| `FRANCHISE_ROYALTY_ENABLED` | `lib/franchise-royalty.ts` | Royalties franchise |
| `FRANCHISE_SETTLEMENT_ENABLED` | `lib/franchise-settlement.ts` | Reversement franchiseur |
| `GHOST_ORDER_AUTO_REFUND_ENABLED` | `lib/refund.ts` | Auto-refund ghost-order du webhook (P0-04 — défaut OFF, peut rester OFF toute la bêta ; OFF → file manuelle `reconcile_manual`) |
| `INFLUENCER_ENABLED` | `lib/influencer-verification.ts` | Palier influenceur (vérif audience + taux majoré) |
| `LOGISTICS_AVAILABILITY_ENABLED` | `lib/logistics-availability.ts` | Statut en ligne livreur |
| `LOGISTICS_COURIER_ACCRUAL_ENABLED` | `lib/courier-accrual.ts` | Accrual course livreur (cas B) |
| `LOGISTICS_COURIER_ACTIVATION_ENABLED` | `lib/logistics-account.ts` | Activation des comptes livreurs |
| `LOGISTICS_DISTANCE_FEE_ENABLED` | `lib/logistics-fee.ts` | Frais de livraison à la distance |
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
| `PRESTATAIRE_CONNECT_ENABLED` | `lib/prestataire-connect.ts` | Connect prestataire |
| `RATE_LIMIT_ENABLED` | `lib/rate-limit.ts` | Rate-limiting applicatif (sûr à activer — audit go-live) |
| `REFUNDS_ENABLED` | `lib/refund.ts` | Moteur de remboursement : outil admin `/api/admin/refunds/run` **et** les rails `lib/claims.ts:199,325` / `lib/dispute.ts`. P0-04 : ne gouverne **plus** l'auto-refund ghost-order du webhook → `GHOST_ORDER_AUTO_REFUND_ENABLED`. ⚠️ Ne suffit donc PAS à garantir « aucun remboursement sans admin » : cf. note Q3 sous les couplages |
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

### ⚠️ Note Q3 — ce que la scission P0-04 règle, et ce qu'elle NE règle PAS

P0-04 supprime **un** chemin automatique : le webhook ghost-order ne rembourse plus
sans son propre flag (défaut OFF). Il reste, avec `CLAIMS_ENABLED`+`REFUNDS_ENABLED` ON,
**un remboursement déclenché par le RESTAURATEUR** (et non par un admin Grubano), pour un
montant **partiel** : `RestaurantClaimsPanel` → `POST /api/claims/[id]/respond` (accept) →
`lib/claims.ts:284` → `approveClaim:244` → `triggerClaimRefund:197` → `executeRefund`.
Un second chemin machine existe aussi (`runClaimAutoApproval:302-338`, `auto_timeout` —
son scheduler a été retiré par P0-07, mais la route `/api/admin/claims/auto-approve`
demeure appelable). Les deux contredisent Q3 (validation admin seule + intégral) et
**ne sont pas traités par P0-03/P0-04** — signalés, à arbitrer par Agent 0.
| `TIPS_ENABLED` | `LOGISTICS_PAYOUT_ENABLED` | pourboire encaissé sans rail de reversement = fonds tiers retenus (D-1) |
| `LOGISTICS_COURIER_ACCRUAL_ENABLED` | `LOGISTICS_PAYOUT_ENABLED` | course retenue sans reversement (D-1 symétrique) |
| `LOGISTICS_PAYOUT_ENABLED` | `LOGISTICS_CONNECT_ENABLED` | reversement sans compte Connect onboardé |
| `FRANCHISE_ROYALTY_ENABLED` | `FRANCHISE_SETTLEMENT_ENABLED` | royalties accumulées sans reversement |
| `FRANCHISE_SETTLEMENT_ENABLED` | `FRANCHISE_CONNECT_ENABLED` | settlement sans compte Connect |
| `CREATOR_PAYOUT_ENABLED` | `CREATOR_CONNECT_ENABLED` | payout créateur sans compte Connect |

## Procédure de bascule d'un flag (staging) — sans rien exécuter ici

1. Vérifier le couplage EN LOCAL avant toute bascule :
   `FLAG1=true FLAG2=true node scripts/check-flags.mjs` (avec le set cible complet).
2. Vérifier les prérequis DB du flag (ex. `CLAIMS_ENABLED` exige que la table
   `Claim` existe → `bash ~/app.grubano.com/scripts/server/prisma-push.sh` si
   le schéma a changé depuis le dernier push).
3. cPanel Terminal → éditer `~/app.grubano.com/.env.local` (jamais via FTP,
   jamais commité).
4. `touch ~/app.grubano.com/tmp/restart.txt` (Passenger recharge l'env).
5. Vérifier l'effet par la surface gatée (404/403 attendu → réel) et
   `curl -s https://app.grubano.com/version.json` pour confirmer quel build tourne.
