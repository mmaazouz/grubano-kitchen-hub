# Inventaire du code mort — S0-6 (preuves, ZÉRO suppression)

> Livrable Sprint 0 : **rien n'a été supprimé**. Chaque entrée « MORT-CONFIRMÉ »
> a survécu à une contre-vérification adversariale (grep repo entier du basename,
> imports par alias/relatifs/dynamic, références par chaîne/URL, barrels,
> conventions Next implicites). La suppression effective = **Lot B**, après
> validation Mohammed, avec re-grep + build vert + suite verte par lot.
> Méthode : 4 chasses (composants 139 fichiers, lib 160 fichiers, routes/nav,
> assets+scripts) puis contre-vérification indépendante de chaque candidat.

## 1. MORT-CONFIRMÉ — composants (11)

Lots de suppression cohérents (un lot = un commit, dépendances transitives ensemble) :

| Lot | Fichiers | Preuve (résumé) | Précaution |
|---|---|---|---|
| **A — shell opérateur legacy** | `components/Sidebar.tsx` · `components/MobileHeader.tsx` · `components/SidebarContext.tsx` · `components/portals/FranchiseSidebar.tsx` | 0 import hors eux-mêmes (grep exhaustif ; seuls hits = commentaires « re-skin of the legacy Sidebar » dans OperatorShell/AppChrome). `SidebarProvider` n'est monté par AUCUN layout. Remplacés par `OperatorShell`/`FranchiseShell`. | Supprimer les 4 ensemble (SidebarContext n'est importé que par les 3 autres). Anti-réactivation : ils référencent les anciennes nav `/creators`/`/franchise` (constat audit gels MVP). |
| **B — accueil consolidé legacy** | `components/home/ConsolidatedHome.tsx` · `components/connect/ConnectReturnToast.tsx` | ConsolidatedHome : 4 hits hors self, tous commentaires/libellés (le dashboard monte `OperatorDashboard`). ConnectReturnToast : uniquement importé par ConsolidatedHome. | ⚠️ ConnectReturnToast était le toast de retour Stripe onboarding (`/dashboard?connect=return`). Avant suppression, vérifier que `OperatorDashboard`/`EstablishmentHub` gère ce retour — sinon c'est une régression UX déjà présente à documenter, pas un simple ménage. |
| **C — orphelins unitaires** | `components/creators/CreatorEarningsChart.tsx` · `components/eat/LastReservationCard.tsx` · `components/finance/FinanceRail.tsx` · `components/hub/Breadcrumb.tsx` · `components/affiliate/AffiliateDashboardClient.tsx` | 0 hit hors self chacun (grep -F basename, tracked+untracked). FinanceRail = le « consommateur orphelin » de la route ledger noté par l'audit H4. AffiliateDashboardClient supplanté par `AffiliateHomeClient`. | `LastReservationCard` : ses imports (`StripeTicketPayment`, `SessionBadge`, `OrderAtTable`) restent VIVANTS par ailleurs — ne supprimer que la carte. Les clés i18n `affiliate.*` restent consommées par AffiliateHomeClient — supprimer le composant, PAS les clés. |

## 2. MORT-CONFIRMÉ — références mortes (2)

| Référence | Preuve | Effet si retirée |
|---|---|---|
| `middleware.ts:122` publicRoots `'/register'` + `components/AppChrome.tsx:35` BARE_PREFIXES `'/register'` | Aucun `app/[locale]/register/page.tsx` n'existe (seuls business/supplier/logistics/prestataire register). `/register` nu → 404. CLAUDE.md le note déjà « currently unused ». | 404 public → redirect /login (comportement neutre). |
| Page `app/[locale]/business/franchise-soon/page.tsx` | 0 lien entrant dans tout le repo ; l'unique référence est un test NÉGATIF (`expect(...).not.toContain('/business/franchise-soon')`) qui survivrait à la suppression. | ⚠️ D'anciennes URLs externes peuvent pointer dessus — si suppression, la remplacer par un `redirect()` vers `/franchise/apply` (pattern `logistics-soon`). |

## 3. MORT-CONFIRMÉ — assets `public/` (9)

| Fichiers | Preuve |
|---|---|
| `site.webmanifest` + `web-app-manifest-192x192.png` + `web-app-manifest-512x512.png` | Le manifest VIVANT est `manifest.webmanifest` (layout `:32`). `site.webmanifest` : 0 référence repo entier ; les 2 PNG ne sont référencés QUE par lui. À supprimer ensemble. |
| `brand/grubano-app-ink.svg` · `brand/grubano-app-light.svg` · `brand/grubano-app-primary.svg` · `brand/grubano-avatar-round.svg` · `brand/grubano-avatar-square.svg` · `brand/grubano-symbol-ink.svg` | Inventaire exhaustif des 42 références `brand/` du repo : toutes littérales, aucune construction dynamique, aucune URL absolue dans les emails. Seuls `grubano-symbol-color.svg` et `grubano-symbol-white.svg` sont utilisés (~35 usages) — **NE PAS Y TOUCHER**. |

Les images `food/`/`restaurants/` (85 fichiers) sont VIVANTES par chemins
construits dans `lib/food-images.ts` (correspondance 1:1 vérifiée) — hors périmètre.

## 4. MORT-CONFIRMÉ — scripts (5 + 1 catégorie)

| Entrée | Preuve |
|---|---|
| **Catégorie : 134 scripts i18n one-shot** (`add-*-i18n.js` ×67, `seed-*-i18n.js` ×58, `patch-*-i18n.js` ×2, +7 assimilés `p3-*`/`b12-*`/`sec1-*`…) | Migrations déjà jouées (leur sortie est commitée dans `messages/*.json`). 0 référence exécutante (package.json, CI, docs) — 100 % des hits croisés sont des en-têtes/commentaires entre eux. ⚠️ `scripts/add-creators-home-i18n.js` est UNTRACKED (récent) : vérifier qu'il a été exécuté avant de purger la catégorie. Destin proposé : déplacement `scripts/archive/i18n/` plutôt que suppression (historique utile). |
| `scripts/backfill-ledger.js` · `backfill-table-restaurant.js` · `backfill-brand-restaurant.js` | Backfills one-shot déjà joués ; 0 réf exécutante (la mention `backfill-*` du workflow est la politique d'EXCLUSION du deploy). |
| `scripts/diag-creator-inventory.js` | 0 réf (les autres diag-* sont cités par docs/ops/logs.md — celui-ci n'est cité nulle part). |
| `scripts/translate-dashboard-home.js` | 0 réf ; `translate:i18n` pointe vers `translate-messages.js`. |

`lib/` : **0 module mort** (160 fichiers, tous importés — chasse dédiée revenue vide).

## 5. INCERTAIN — arbitrage humain requis (ne pas supprimer)

| Entrée | Pourquoi c'est ambigu |
|---|---|
| `app/[locale]/admin/tracking/page.tsx` | 0 lien de nav, mais l'API vivante `courier-position` référence explicitement son gate — outil support géoloc conçu pour accès par URL directe. |
| `app/[locale]/design/gb-foundation/page.tsx` | Preview interne dev de la fondation gb- ; suppression sans risque runtime mais perte d'outillage. |
| Bras `middleware.ts` `/t` `/chef` `/ref` `/legal` exacts (sans page) + `'/api/auth'` (inatteignable via le matcher) | Code défensif volontaire : les retirer changerait 404→redirect login. Conserver. |
| `scripts/purge-test-artifacts.js` | Outil de purge pré-live (artefacts Weyss) peut-être PAS ENCORE joué — confirmer staging+prod avant tout. |
| `scripts/test-vetting.js` · `scripts/test-youtube.js` | Smoke-tests manuels documentés (cPanel) — non référencés par conception. |
| `scripts/deploy.sh` | Prédate la CI (Node 18 vs serveur Node 24) — probablement obsolète, mais outil manuel. |

## 6. RÉFUTÉS — faux candidats à NE PAS re-flaguer

`components/stellar/*` + `app/[locale]/eat-next/**` (redesign conso sous flag
`CONSUMER_REDESIGN_ENABLED`, testé en CI) · `CategoryPill`/`OrderCard` (vitrine
`/design`, publique) · pages `eat/order/[orderId]/{help,pickup,rate}` et
`eat/r/[id]/waitlist` (features réelles, couvertes par le robot visual-QA) ·
`creators/dashboard/audience` et `business/logistics-soon` (redirects volontaires
pour anciennes URLs) · `scripts/server/deploy-{staging,production}.sh` (secours
manuel documenté) · `scripts/seed-referral-config.js` (provisioning du singleton
ReferralConfig lu par 5 routes) · `scripts/server/legacy-password-reset-notify.js`
(shippé par les 2 pipelines).

## 7. Découvertes annexes (gaps UX, PAS du code mort — à router vers le backlog)

- `eat/order/[orderId]/rate/page.tsx` prétend être liée depuis `/eat/track` et
  `/eat/orders` — **aucun lien entrant n'existe** (la notation post-livraison
  est inatteignable en navigation normale).
- `eat/r/[id]/waitlist/page.tsx` : file d'attente réelle bout-en-bout, mais
  **aucun point d'entrée de navigation consommateur**.
