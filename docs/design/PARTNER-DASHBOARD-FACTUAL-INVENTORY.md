# GRUBANO — INVENTAIRE FACTUEL DU DASHBOARD PARTENAIRE
> **SHA d'inventaire : `981c05d`** (branche `develop` = staging) · **Date : 2026-08-30**
> **Doctrine ABSOLUE « FACTS ONLY »** : chaque champ, CTA, état, colonne documenté ici a été VU dans le code (référence `fichier:ligne` à l'appui). Ce qui n'existe pas est explicitement marqué **N'EXISTE PAS**.
> **Claude Design ne doit PAS inventer de champs produit.** Ce document est la source de vérité produit pour tout travail de design sur le dashboard partenaire (opérateur de rôle `restaurant`). En cas de doute sur l'existence d'une fonctionnalité (availability, photos, variantes, options, taxes, remises par plat, abonnements…), consulter la PART 23 (« CHAMPS DE DONNÉES EXACTS ») et les sections « Ce qui N'EXISTE PAS » de chaque PART — si ce n'est pas écrit ici, ça n'existe pas.
>
> Périmètre : tout ce qu'un compte **rôle `restaurant`** peut réellement atteindre. Les consoles admin / franchise / creators / affiliate / supplier(rôle) / logistics(rôle) / prestataire(rôle) et l'app conso `/eat/*` sont HORS périmètre (documentées ailleurs).
>
> Sommaire : PART 1 Route map · PART 2 Navigation map · PART 3 Dashboard home · PART 4 Réservations · PART 5 Commandes · PART 6 Cuisine · PART 7 Menus · PART 8 Création/édition de plat · PART 9 Stock · PART 10 Fournisseurs · PART 11 Clients · PART 12 Avis · PART 13 Analytics · PART 14 Finances · PART 15 Marques · PART 16 Établissements · PART 17 Adresse/Horaires/Modes de service/Connect · PART 18 Réglages · PART 19 Composants partagés · PART 20 Mobile · PART 21 Desktop · PART 22 Surfaces legacy/cachées/mortes · PART 23 Champs de données exacts · PART 24 Permissions/Flags · PART 25 Synthèse handoff design.

---

# PART 1 — ROUTE MAP (tableau complet des routes)

## Mécanique d'accès (préambule factuel)

- **Middleware** (`middleware.ts`) : les routes plates opérateur sont gatées `restaurant/admin` via `OPERATOR_FLAT_PREFIXES` (middleware.ts:32-37) = `/menu /orders /stocks /loyalty /promotions /analytics /brands /reviews /wallet /suppliers /tables /customers /notifications /cashflow /prep /onboarding /finance /pricing /marketplace /dinein /more /briefing /premium`. `/dashboard` a son propre gate `restaurant/admin` (middleware.ts:200). Sans session → redirect `/login` (middleware.ts:180). Mauvais rôle → renvoi vers le « home » de son rôle (middleware.ts:254-257).
- **Coquille** (`components/AppChrome.tsx:22-31`) : toute route NON listée dans `BARE_PREFIXES` (`lib/app-chrome-rules.ts:40-44`) est enveloppée dans `OperatorShell` (chrome navy). Rendues NUES (bare) : `/eat /eat-next /franchise /creators /supplier /admin /logistics /business /t /legal /login /add-activity /affiliate /onboarding /auth/magic` + la racine `/`. Exception documentée : `/deliveries` rend SOUS la coquille (app-chrome-rules.ts:37-39, décision fondateur).
- **Gate onboarding** (`app/[locale]/dashboard/layout.tsx:56-63`) : un `restaurant` sans Brand OU sans Restaurant est redirigé de `/dashboard` vers `/business/onboarding` (serveur, avant tout rendu).
- **Post-login** (`lib/post-login-redirect.ts:16`) : `restaurant → /dashboard` après connexion magic-link.
- **Établissement courant** : cookie `grubano_estab` (OperatorShell.tsx:22, 101-106) ; le switcher topbar liste les établissements (GET `/api/establishments`, OperatorShell.tsx:76) avec badge « Publié / Non publié » (`operator.status.published/unpublished`, fr.json:630-631) piloté par `isActive` (admin-contrôlé). L'ancien toggle « Ouvert/Fermé » du shell est **SUPPRIMÉ** (OperatorShell.tsx:16-19 : « dead local state with no backend — it lied to operators »).

## Légende des statuts

`ACTIVE` = fonctionne sur données réelles · `PARTIAL` = mélange réel + blocs « Bientôt »/inertes · `HIDDEN` = atteignable UNIQUEMENT par URL directe (aucun lien entrant trouvé) · `LEGACY` = relique/redirect de compat ou maquette d'une autre époque · `DEFERRED` = gaté par flag env OFF · `DEAD` = inatteignable pour un partenaire.

## 1a. Cœur opérateur (sous OperatorShell)

| Route | Fichier page | inNav | Atteinte réelle | Gate | Flag | Status |
|---|---|---|---|---|---|---|
| `/` | `app/[locale]/page.tsx:12` | — | redirect → `/dashboard` | public | — | ACTIVE (redirect) |
| `/dashboard` | `app/[locale]/dashboard/page.tsx` | ✔ sidebar « Dashboard » + bottom-nav | nav ; post-login | restaurant/admin + gate onboarding (layout.tsx:56-63) | — | ACTIVE — home consolidé `OperatorDashboard` (GET /api/dashboard/overview) ; N=0 → CTA « /business/onboarding » (OperatorDashboard.tsx:89) ; file « À traiter » → /dashboard/establishments, /stocks (l.101-102) ; 5 actions rapides → /orders /tables /dashboard/fulfillment /menu /marketplace/orders (l.186-190) ; bloc « Copilote IA » = « Bientôt » honnête (l.179-182). Détail PART 3 |
| `/dashboard/establishments` | `app/[locale]/dashboard/establishments/page.tsx` | ✖ | panneau switcher « Ajouter un établissement » (OperatorShell.tsx:196) ; back-link du hub (EstablishmentHub.tsx:343) ; liens depuis /reviews:255, /dinein:146, alertes dashboard | restaurant/admin (double check page l.34) | — | ACTIVE — liste + switch + ajout (POST /api/restaurants `additional:true`, isActive=false forcé serveur, commentaire l.13-17). Détail PART 16 |
| `/dashboard/establishments/[id]` | `app/[locale]/dashboard/establishments/[id]/page.tsx` | ✖ | clic sur un établissement dans la liste | restaurant/admin, owner-scoped (l.46-48 : id étranger → retour liste) | ONBOARDING_GUIDE_ENABLED (guides IA seulement, self-gating, EstablishmentHub.tsx:336-340) | ACTIVE — HUB établissement : marques → `/menu?brand=`, horaires, **Adresse (AddressSection)**, Connect, zone sensible. Détail PART 16-17 |
| `/dashboard/fulfillment` | `app/[locale]/dashboard/fulfillment/page.tsx` | ✖ | action rapide dashboard « Mettre en pause les commandes en ligne » (OperatorDashboard.tsx:188) | restaurant/admin (page l.33) | — | ACTIVE — « Réception des commandes » : canaux delivery/pickup/réservation (page l.57-60 : deliveryEnabled, pickupEnabled, reservationEnabled, deliveryRadius) ; carte dine-in → lien /tables (FulfillmentForm.tsx:387). Détail PART 17.7 |
| `/tables` | `app/[locale]/tables/page.tsx` | ✔ sidebar « Réservations & Salle » + bottom-nav | nav | OPERATOR_FLAT (middleware.ts:34-36) | PUNITIVE_CAPTURE_ENABLED (comportement no-show) | ACTIVE — réservations, plan de salle, addition (TableTicket), config tables/QR. Détail PART 4 |
| `/orders` | `app/[locale]/orders/page.tsx` | ✔ sidebar « Commandes » + bottom-nav | nav | OPERATOR_FLAT | CLAIMS_ENABLED (panneau réclamations, page l.16-17) | ACTIVE — file de commandes réelle, machine d'états ; panneau claims DEFERRED (flag OFF). Détail PART 5 |
| `/prep` | `app/[locale]/prep/page.tsx` | ✔ sidebar « Cuisine » | nav | OPERATOR_FLAT | — | ACTIVE — KDS RÉEL (l.4-23) : GET /api/orders/kitchen poll 8 s, bump via PATCH /api/orders/[id]/status. Détail PART 6 |
| `/menu` | `app/[locale]/menu/page.tsx` | ✔ sidebar « Menus » | nav ; hub → `/menu?brand=<id>` (EstablishmentHub.tsx:409) | OPERATOR_FLAT | ONBOARDING_AI_MENU_PREFILL_ENABLED (import carte IA) | ACTIVE — CRUD menu byte-identical (l.23-25) ; liens sortants → /brands (l.528), /promotions (l.1139). Détail PART 7-8 |
| `/stocks` | `app/[locale]/stocks/page.tsx` | ✔ sidebar « Stock » + bottom-nav | nav ; alertes dashboard ; liens /suppliers:385,541,703 | OPERATOR_FLAT | — | ACTIVE — journal de stock + assistant IA ; le bouton « Réappro. » ouvre la modale d'ajustement (l.274-278), il ne route PAS vers /marketplace/reorder. Détail PART 9 |
| `/suppliers` | `app/[locale]/suppliers/page.tsx` | ✔ sidebar « Fournisseurs » | nav | OPERATOR_FLAT | — | ACTIVE — annuaire fournisseurs legacy + POST /api/suppliers/orders ; « Parcourir le marketplace » → /marketplace/suppliers (l.327). Détail PART 10 |
| `/customers` | `app/[locale]/customers/page.tsx` | ✔ sidebar « Clients » | nav | OPERATOR_FLAT | — | ACTIVE — top-20 scopé tenant, PII masquée (l.6-14 : jamais email/téléphone/adresse), KPI + filtres ?tier serveur. Détail PART 11 |
| `/customers/[id]` | `app/[locale]/customers/[id]/page.tsx` | ✖ | ligne de la liste (`href=/customers/${row.id}`) | OPERATOR_FLAT + fence tenant (l.4-7 : étranger → 404) | — | ACTIVE — fiche client masquée, contact-free ; retour → /customers (CustomerProfileClient.tsx:77). Détail PART 11 |
| `/reviews` | `app/[locale]/reviews/page.tsx` | ✔ sidebar « Avis » | nav | OPERATOR_FLAT | — | PARTIAL — avis réels GET /api/restaurants/{id}/reviews + brouillon IA réel (POST /api/reviews/generate-reply) ; MAIS « Envoyer » la réponse = « bientôt » (pas de persistance, l.20-23), import Google/TripAdvisor = « bientôt » (l.20). Détail PART 12 |
| `/analytics` | `app/[locale]/analytics/page.tsx` | ✔ sidebar « Analytics » | nav | OPERATOR_FLAT | — | PARTIAL — données réelles GET /api/analytics ; « bientôt » honnêtes : comparaison semaine préc., tendances KPI, couverts, rang par plats, heatmap jour×heure, dates personnalisées (l.13-25) ; lien → /orders (l.132). Détail PART 13 |
| `/finance` | `app/[locale]/finance/page.tsx` | ✔ sidebar « Finances » | nav | OPERATOR_FLAT | (REFUNDS_ENABLED cité : modale remboursement INERTE, l.19-21) | PARTIAL — P&L 30 j réel GET /api/finance/summary (équation caBrut−commission−créateurs−remises=netResto, l.12-16) ; « bientôt » : prochain virement SEPA, calendrier payouts, journal ledger, relevés PDF (l.18-20) ; lien → /orders (l.129). Détail PART 14 |
| `/brands` | `app/[locale]/brands/page.tsx` | ✔ sidebar « Marques » | nav ; hub → `/brands?restaurantId=` (EstablishmentHub.tsx:395,450) | OPERATOR_FLAT | — | ACTIVE — liste des marques réelles (GET /api/brands/summary) + création (modale) byte-identical (l.17-24). Détail PART 15 |
| `/brands/[id]/franchise` | `app/[locale]/brands/[id]/franchise/page.tsx` | ✖ | modale d'édition de marque du hub (`EstablishmentHub.tsx:614`) | OPERATOR_FLAT, owner-scoped (l.10-11 : non-owner → 403/404) | — | ACTIVE — le propriétaire édite ses conditions franchise (openToFranchise, royaltyPct fraction, setupFee, zones) via GET/PATCH /api/brands/[id] ; retour → /brands (l.130,153). Détail PART 15.2 |
| `/promotions` | `app/[locale]/promotions/page.tsx` | ✖ | lien depuis /menu (menu/page.tsx:1139) — SEULE entrée | OPERATOR_FLAT | — | ACTIVE — moteur promotions réel `lib/promotions` résolu serveur au checkout (l.4-7). Détail PART 7.6 |
| `/more` | `app/[locale]/more/page.tsx` | ✔ sidebar « Réglages » + bottom-nav « Plus » + avatar profil topbar (OperatorShell.tsx:207) | nav | OPERATOR_FLAT | — | ACTIVE — hub Réglages : KYB réel affiché (page l.29-33), formulaires TVA + DAC7 RÉELS (MoreClient.tsx:159-168), Notifications → /notifications (l.124), CGU/Confidentialité → /legal/* (l.179-180), déconnexion réelle signOut (l.70-75) ; INERTES « bientôt » : Profil, Sécurité & mot de passe, Langue, Centre d'aide, Contacter le support (l.118-122, 175-177). **Le bloc « Facturation & abonnement » a été RETIRÉ** (l.21-25 : aucun abonnement opérateur n'existe). Détail PART 18 |
| `/notifications` | `app/[locale]/notifications/page.tsx` | ✖ sidebar ; ✔ cloche topbar (OperatorShell.tsx:203) + ligne /more:124 | topbar | OPERATOR_FLAT | — | PARTIAL — « APERÇU HONNÊTE — écran NON BRANCHÉ » (l.9-14) : bandeau « Aperçu — bientôt », feed = exemples illustratifs, aucun backend. Détail PART 3 (page 3) |
| `/marketplace` | `app/[locale]/marketplace/page.tsx` | ✖ | **aucun lien entrant trouvé** → URL directe | OPERATOR_FLAT | PRESTATAIRE_ENABLED (carte services cachée si OFF, l.27-28) | HIDDEN — hub réel : liens → /marketplace/suppliers (+/prestataires si flag) ; intégrations Lydia/SumUp/Mailchimp = inertes « bientôt » (l.60-77). Détail PART 10.2 |
| `/marketplace/suppliers` | `app/[locale]/marketplace/suppliers/page.tsx` | ✖ | /suppliers « Parcourir le marketplace » (l.327) ; hub /marketplace:39 | OPERATOR_FLAT | — | ACTIVE — découverte fournisseurs B2B (plateformes actives), recherche ?q ; lien → /marketplace/orders (l.69). Détail PART 10.3 |
| `/marketplace/suppliers/[id]` | `.../suppliers/[id]/page.tsx` | ✖ | clic fournisseur dans la découverte | OPERATOR_FLAT | — | ACTIVE — catalogue + ajout panier ; → `/marketplace/suppliers/[id]/panier` (SupplierCatalogClient.tsx:113). Détail PART 10.4 |
| `/marketplace/suppliers/[id]/panier` | `.../panier/page.tsx` | ✖ | depuis le catalogue | OPERATOR_FLAT | — | ACTIVE — panier (lib/supply-cart) → POST /api/marketplace/orders (re-validation serveur) ; « Payer en ligne » verrouillé/différé (marketplace/orders/page.tsx:20-23). Détail PART 10.5 |
| `/marketplace/orders` | `app/[locale]/marketplace/orders/page.tsx` | ✖ | action rapide dashboard « Voir les factures fournisseurs » (OperatorDashboard.tsx:190) ; /marketplace/suppliers:69 | OPERATOR_FLAT | — | ACTIVE — historique SupplyOrders owner-scoped, timeline honnête (seul createdAt réel, l.25-29) ; « Recommander » recharge le panier (l.17-19), « Annuler » = PATCH placed→cancelled. Détail PART 10.6 |
| `/marketplace/reorder` | `app/[locale]/marketplace/reorder/page.tsx` | ✖ | **aucun lien entrant trouvé** → URL directe | OPERATOR_FLAT | — | HIDDEN — pont stock-bas → découverte pré-remplie ?q (READ-ONLY, l.9-15) ; StockItem n'a NI prix NI lien fournisseur → pas de total estimé fabriqué (l.18-22). Détail PART 10.7 |
| `/marketplace/prestataires` | `.../prestataires/page.tsx:17` | ✖ | carte du hub /marketplace (si flag ON) | OPERATOR_FLAT + `notFound()` si flag OFF | PRESTATAIRE_ENABLED | DEFERRED — 404 byte-identical quand OFF. Détail PART 10.8 |
| `/marketplace/prestataires/[id]` | `.../prestataires/[id]/page.tsx` | ✖ | depuis la liste (flag ON) | idem | PRESTATAIRE_ENABLED | DEFERRED |
| `/marketplace/prestataire-missions` | `.../prestataire-missions/page.tsx:16-20` | ✖ | depuis la découverte prestataires (flag ON) | idem ; « Payer » sous DOUBLE flag `isPrestataireConnectLive()` | PRESTATAIRE_ENABLED (+ Connect) | DEFERRED |
| `/loyalty` | `app/[locale]/loyalty/page.tsx` | ✖ (AUCUNE entrée sidebar malgré le commentaire l.7 « reachable via the rail » — la NAV d'OperatorShell.tsx:33-48 ne contient PAS loyalty) | **aucun lien entrant trouvé** → URL directe | OPERATOR_FLAT | — | HIDDEN — handlers réels byte-identical (validate/register/wallet, l.11-16) ; stats agrégées = « bientôt » (l.24-26) ; paliers Bronze 0/Silver 100/Gold 200/Platine 400 affichés read-only (l.22-24). Détail PART 12 (annexe) |
| `/briefing` | `app/[locale]/briefing/page.tsx` | ✖ (commentaire l.25 : « NO sidebar nav entry ») | **aucun lien entrant trouvé** → URL directe | OPERATOR_FLAT | — | HIDDEN — données réelles GET /api/briefing (CA jour, résas, stock bas) ; météo/insights IA/projections = « bientôt » (l.18-22). Détail PART 3 (page 2) |
| `/cashflow` | `app/[locale]/cashflow/page.tsx` | ✖ | **aucun lien entrant trouvé** → URL directe | OPERATOR_FLAT | — | HIDDEN — « CÂBLAGE REPORTÉ » (l.10-19) : APERÇU HONNÊTE COMPLET, TOUS les montants = « — », aucun backend de projection. Détail PART 14 (annexe) |
| `/dinein` | `app/[locale]/dinein/page.tsx` | ✖ | **aucun lien entrant trouvé** → URL directe | OPERATOR_FLAT | — | HIDDEN — « APERÇU PHASE-3, NON CÂBLÉ » (l.5) : bandeau « Aperçu — bientôt » obligatoire, tickets = exemples, « Encaisser » INERTE (l.24-25) ; liens sortants réels → /tables (l.229), /dashboard/establishments (l.146). Détail PART 4 (page 2) |
| `/deliveries` | `app/[locale]/deliveries/page.tsx` | ✖ | **aucun lien entrant trouvé** → URL directe | session + rôles restaurant/supplier/franchise/admin page-level (l.27,38 ; PAS dans OPERATOR_FLAT_PREFIXES) | LOGISTICS_MISSIONS_ENABLED (l.13) | DEFERRED — flag OFF (défaut) → aperçu honnête `DeliveriesPreview` sous la coquille (exception fondateur, l.14-20) ; ON → formulaire réel RequestDelivery. Détail PART 22.3 |
| `/wallet` | `app/[locale]/wallet/page.tsx` | ✖ | **aucun lien entrant trouvé** → URL directe | OPERATOR_FLAT | — | LEGACY — maquette en dur (« 487 pts », « Livreur à 4 min », l.19-32), lucide, aucune donnée réelle ; relique « Aperçu PWA · ce que voit le client ». Détail PART 14 (annexe) |
| `/onboarding` | `app/[locale]/onboarding/page.tsx` | ✖ | **aucun lien entrant trouvé** → URL directe (le parcours vivant est `/business/onboarding`, cf. dashboard/layout.tsx:62) | OPERATOR_FLAT ; rendu BARE plein écran (app-chrome-rules.ts:24-27) | — | HIDDEN — wizard 1er établissement CD LOT 7, CÂBLÉ sur les vrais endpoints (POST /api/restaurants + /api/brands + /api/menu, l.16-27 ; étape « Horaires » = visuelle seulement, l.19-20) mais orphelin. Détail PART 22.2 |
| `/pricing` | `app/[locale]/pricing/page.tsx:14-16` | ✖ | redirect inconditionnel → `/more` | OPERATOR_FLAT | — | LEGACY — l'écran « Tarification & Premium » était un mock (frais en dur + abonnement fictif 29 €/mois, l.3-11) ; route gardée pour les bookmarks |
| `/premium` | `app/[locale]/premium/page.tsx:10-12` | ✖ | redirect inconditionnel → `/more` | OPERATOR_FLAT | — | LEGACY — l'ancien mock « 14 jours gratuits » ; redirect direct vers /more |
| `/account` | `app/[locale]/account/page.tsx` | ✖ | inatteignable pour un `restaurant` : middleware.ts:242 gate `consumer/admin` → bounce /eat | consumer/admin | — | DEAD (pour le partenaire) — et la page elle-même est un mock en dur (commandes/points inventés, l.5-16). Détail PART 22.9 |

## 1b. Auth & espace partenaire public (rendu BARE, hors coquille)

| Route | Fichier page | inNav | Atteinte réelle | Gate | Flag | Status |
|---|---|---|---|---|---|---|
| `/login` | `app/[locale]/login/page.tsx:6` | — | URL historique ; middleware y renvoie les non-connectés | public | — | ACTIVE (redirect) → `/eat/auth` (« le sélecteur multi-portail est retiré », l.3-4) |
| `/auth/magic` | `app/[locale]/auth/magic/page.tsx` | — | lien e-mail magic-link ; CTA « Se connecter » du parcours partenaire | PUBLIC exact (middleware.ts:155) | AUTH_EMAIL_OTP_ENABLED (bloc code 6 chiffres) | ACTIVE — connexion passwordless : ?token → signIn, sinon formulaire e-mail ; atterrissage par rôle via `postLoginPath` (restaurant → /dashboard) ; PartnerShell sur TOUS les hôtes (l.25-31). Détail PART 18.B |
| `/business` | `app/[locale]/business/page.tsx` | — | landing partenaire ; racine du host business.grubano.com y redirige (middleware.ts:64-66) | public (middleware.ts:143) | — | ACTIVE — vitrine PartnerShell (hero, piliers, CTA « Devenir partenaire » → /business/start). Détail PART 22.4 |
| `/business/start` | `app/[locale]/business/start/page.tsx` | — | CTA de /business | public | PRESTATAIRE/AFFILIATE/CREATOR/SUPPLIER/FRANCHISE/LOGISTICS_SIGNUP flags (cartes conditionnelles, l.4-9,15-18) | ACTIVE — choix du type de compte, carte Restaurateur en vedette → parcours existants. Détail PART 22.5 |
| `/business/register` | `app/[locale]/business/register/page.tsx` | — | depuis /business/start (restaurateur) | public | — | ACTIVE — inscription restaurateur PASSWORDLESS (nom + e-mail + RGPD, POST /api/partners/register → vérif e-mail → magic-link, l.8-16). Détail PART 22.6 |
| `/business/auth` | `app/[locale]/business/auth/page.tsx:11-13` | — | anciens liens | public | — | LEGACY (redirect) → `/auth/magic` (login unifié S2) |
| `/business/verified` | `app/[locale]/business/verified/page.tsx` | — | lien de vérification e-mail (?status=success/expired/used/invalid/error) | public | — | ACTIVE — landing post-vérification, CTA → /auth/magic (l.13-17). Détail PART 18.B |
| `/business/onboarding` | `app/[locale]/business/onboarding/page.tsx` | — | redirect FORCÉ depuis /dashboard quand 0 brand ou 0 restaurant (dashboard/layout.tsx:62) ; CTA N=0 du dashboard (OperatorDashboard.tsx:89) | public au middleware (middleware.ts:143), la page se gate via GET /api/business/me | — | ACTIVE — LE parcours d'onboarding vivant : étapes brand → restaurant → done (l.21). Détail PART 18.B |
| `/business/logistics` | `app/[locale]/business/logistics/page.tsx` | — | carte « Logistique » de /business/start (si LOGISTICS_SIGNUP_ENABLED ON) ; cible du redirect legacy /business/logistics-soon | PUBLIC (sous-arbre /business ; « no flag gate here, no notFound », commentaire l.6-7) | — | ACTIVE — landing marketing « Devenez livreur » (waitlist), full-bleed gb-foundation accent ambre, garde-fous d'honnêteté (zéro stat fabriquée, aucun montant de rémunération). Détail PART 22.7 |
| `/business/logistics/register` | `app/[locale]/business/logistics/register/page.tsx` | — | CTA de /business/logistics | PUBLIC ; gate d'inscription évalué au RUNTIME côté API (`isLogisticsSignupEnabled`, app/api/logistics/register/route.ts:8) | LOGISTICS_SIGNUP_ENABLED (API) | ACTIVE — candidature livreur waitlist réelle (POST /api/logistics/register). Détail PART 22.8 |
| `/business/logistics-soon` | `.../logistics-soon/page.tsx:8-10` | — | orphelin assumé | public | — | LEGACY (redirect) → /business/logistics/register |
| `/add-activity` | `app/[locale]/add-activity/page.tsx` | ✖ (le RoleSwitcher qui y mène — components/RoleSwitcher.tsx:94 — n'est monté QUE dans les shells supplier/logistics/prestataire, PAS dans OperatorShell) | pour un restaurateur mono-rôle : URL directe uniquement | session (tout rôle) ; sans session → /auth/magic (l.22-23) | flags par activité (l.9-14) | HIDDEN (pour le restaurateur) — hub « ajouter une activité » : route vers les parcours existants avec e-mail de session pré-rempli, n'accorde AUCUN rôle (l.21-27) |
| `/legal/mentions-legales`, `/legal/confidentialite` | `app/[locale]/legal/*/page.tsx` | ✖ | liens depuis /more (MoreClient.tsx:179-180) | public (middleware.ts:161) | — | ACTIVE — pages légales publiques, shell sobre. Détail PART 22.10 |
| `/legal/cookies` | `app/[locale]/legal/cookies/page.tsx` | ✖ | aucun lien depuis l'app opérateur | public | — | HIDDEN (côté opérateur). Détail PART 22.10 |
| `/design`, `/design/gb-foundation` | `app/[locale]/design/**` | ✖ | outillage interne | public (middleware.ts:134) | — | HIDDEN — catalogues design vivants (« design surface, not a real consumer route », design/page.tsx:10-12). Détail PART 22.11 |
| `/franchise/dashboard` | `app/[locale]/franchise/dashboard/page.tsx` | ✖ | URL directe (le middleware ADMET un `restaurant` : « a franchisee IS a restaurateur », middleware.ts:201-205) | franchise/restaurant/admin | FRANCHISE_ENABLED — arbre `/franchise` entier 404 quand OFF (tests/role-pages-lock.test.ts:30) | DEFERRED — console franchise (documentée hors périmètre) |
| `/t/[tableId]` (+ `/t/[tableId]/menu`) | `app/[locale]/t/**` | — | QR généré par /tables (buildQrUrl, TablesShell.tsx:93-97) | PUBLIC (middleware.ts:140) | — | ACTIVE — sortie CONSO du partenaire : addition de table côté client (hors dashboard) |

**Décompte** : 58 routes partenaire — **32 ACTIVE** (dont 3 redirects vivants `/`, `/login`, et les 2 pages logistics publiques) · **4 PARTIAL** (/reviews, /analytics, /finance, /notifications) · **11 HIDDEN** · **5 DEFERRED** · **5 LEGACY** · **1 DEAD** (/account). Note critique de complétude : les routes `/business/logistics` et `/business/logistics/register` manquaient à la cartographie initiale et ont été réintégrées ici (statut ACTIVE ×2).

**Espaces explicitement EXCLUS du périmètre partenaire** (autres rôles/consoles, jamais atteints par un `restaurant` : middleware les bounce ou les layouts 404) : `/eat/**` (public conso — un restaurateur PEUT y naviguer comme n'importe quel visiteur), `/eat-next/**` (chantier conso), `/admin/**` (admin only, middleware.ts:238), `/affiliate/**` (bounce → /affiliate/join, session-only, middleware.ts:233-235), `/creators/**`, `/supplier/**` (rôle), `/logistics/**`, `/prestataire/**`, `/chef/[slug]`, `/ref/[code]`. Également hors périmètre mais adjacents : `/supplier/register`, `/business/prestataire/register`, `/affiliate/join|apply`, `/franchise` landing (parcours d'AUTRES rôles, cibles des cartes de `/business/start`).

---

# PART 2 — NAVIGATION MAP (carte de navigation réelle)

## 2a. Hiérarchie produit (telle que codée)

```
PARTENAIRE (Operator, 1 compte e-mail)
│  identité légale au niveau COMPTE : SIREN / raison sociale / KYB / TVA / DAC7 → /more
│
├── ÉTABLISSEMENTS (Restaurant, 0..N — cookie grubano_estab sélectionne le courant)
│     liste + ajout : /dashboard/establishments   (ajout ⇒ isActive=false forcé, revue admin)
│     badge « Publié / Non publié » = Restaurant.isActive (admin-contrôlé), affiché dans le
│     switcher topbar (OperatorShell.tsx:182) et le hub (EstablishmentHub.tsx:356-360 online/offline)
│
│     HUB /dashboard/establishments/[id] (la fiche de l'établissement) contient, dans l'ordre :
│       1. guides IA onboarding (self-gated ONBOARDING_GUIDE_ENABLED)
│       2. header (logo-initiales, nom, badge en ligne/hors ligne, adresse, « Voir le tableau de bord »)
│       3. préremplissage IA site + logo (SitePrefillImport / LogoPrefillImport)
│       4. MARQUES de l'établissement (le cœur du hub) → clic = /menu?brand=<id> ; « Gérer » ouvre
│          la modale d'édition de marque (qui contient le lien conditions franchise
│          /brands/[id]/franchise) ; CTA création → /brands?restaurantId=<id>
│       5. HORAIRES (OpeningHoursSection — grille hebdo 7 jours multi-plages + fermetures
│          exceptionnelles ; GET/PUT /api/restaurants/[id]/hours, closures)
│       6. ADRESSE (AddressSection — NOUVEAU post-train : édition adresse/CP/ville avec validation
│          France stricte + re-géocodage IGN/BAN atomique ; PATCH /api/restaurants/[id])
│       7. ENCAISSEMENTS / Stripe Connect (ConnectCard — 4 états none/pending/active/restricted ;
│          POST → onboarding hébergé Stripe ; la carte rend RIEN si le GET échoue ; commissions
│          jamais exposées)
│       8. ZONE SENSIBLE : « Fermer temporairement » / « Rouvrir l'établissement » + « Supprimer »
│          (EstablishmentHub.tsx:483-510)
│
├── MARQUES (Brand, rattachées à un établissement) → /brands (liste, création, stats)
│       └── conditions FRANCHISE de la marque → /brands/[id]/franchise (royaltyPct, setupFee, zones)
│
├── MENU (par marque) → /menu (?brand= filtre) — plats (MenuItem), création/édition, scan IA,
│       lien promotions → /promotions
│
└── CANAUX DE RÉCEPTION → /dashboard/fulfillment (livraison / retrait / réservation, rayon,
        pause des commandes en ligne) — PAS dans le hub : atteint par l'action rapide du dashboard
```

**Où vit quoi (résumé designer)** : horaires + adresse + Connect + suppression = hub établissement `/dashboard/establishments/[id]` · pickup/livraison/pause = `/dashboard/fulfillment` · menu = `/menu` (par marque) · promotions réelles = `/promotions` (entrée unique depuis /menu) · stock = `/stocks` · finance = `/finance` (P&L) + `/more` (TVA, DAC7) + `/marketplace/orders` (commandes fournisseurs) · avis = `/reviews` (par établissement courant) · clients = `/customers` · fidélité = `/loyalty` (orphelin) · réservations/salle/addition/QR-table = `/tables`.

## 2b. Ce que la sidebar affiche, dans l'ordre, avec les labels FR réels
(source NAV : OperatorShell.tsx:33-48 ; labels : messages/fr.json:590-614)

| # | Label FR (verbatim) | Groupe (label FR) | Route | Note |
|---|---|---|---|---|
| 0 | logo « **Grubano** Business » | — | /dashboard | OperatorShell.tsx:144-147 |
| 1 | **Dashboard** | (sans groupe) | /dashboard | |
| 2 | **Réservations & Salle** | Opérations | /tables | onglets internes : Liste · Agenda · Plan · Addition · Config (TablesShell.tsx:78 ; fr « tab ») |
| 3 | **Commandes** | Opérations | /orders | |
| 4 | **Cuisine** | Opérations | /prep | KDS réel |
| 5 | **Menus** | Opérations | /menu | |
| 6 | **Stock** | Opérations | /stocks | |
| 7 | **Fournisseurs** | Opérations | /suppliers | |
| 8 | **Clients** | Relation client | /customers | |
| 9 | **Avis** | Relation client | /reviews | |
| 10 | **Analytics** | Pilotage | /analytics | |
| 11 | **Finances** | Pilotage | /finance | |
| 12 | **Marques** | Organisation | /brands | |
| 13 | **Équipe** · Bientôt | Organisation | — (href null) | INERTE (OperatorShell.tsx:46) |
| 14 | **Réglages** | Organisation | /more | seule entrée sans `requiresEstab` |
| 15 | **Copilote IA** · Bientôt | (bas du rail, hors groupes) | — (href null) | INERTE (OperatorShell.tsx:158-162) |

**N'EXISTENT PAS dans la sidebar** (un designer pourrait les supposer) : Fidélité, Promotions, Marketplace, Briefing, Trésorerie/Cashflow, Livraisons, Service à table, Notifications (cloche topbar seulement), Wallet, Équipe (inerte), Abonnement/Facturation (retiré).

## 2c. Topbar (OperatorShell.tsx:170-212)
1. Hamburger (mobile) → drawer sidebar.
2. **Switcher d'établissement** : monogramme + nom + « {ville} · Publié/Non publié » (point vert si publié) ; 0 établissement → « Aucun établissement » ; multi → panneau déroulant + « **Ajouter un établissement** » → /dashboard/establishments.
3. Date du jour (Intl, jour semaine + date) — décorative, non cliquable.
4. Cloche **Notifications** → /notifications — **sans badge de non-lus** (aucun compteur réel n'existe).
5. Profil (initiales + nom de session) → /more — le chevron `expand_more` suggère un menu déroulant qui N'EXISTE PAS.

## 2d. Bottom-nav mobile (5 onglets — OperatorShell.tsx:51-57)
**Dashboard** (/dashboard) · **Commandes** (/orders) · **Réservations & Salle** (/tables) · **Stock** (/stocks) · **Plus** (/more, label fr `nav.more`).

## 2e. Faits de dette design de la carte (constat, pas de solution)
- 8 routes plates opérateur sont ORPHELINES de toute navigation (/loyalty, /briefing, /cashflow, /dinein, /deliveries, /marketplace hub, /marketplace/reorder, /onboarding wizard) — atteignables uniquement par URL, dont deux au contenu réel (/loyalty handlers, /briefing API).
- /wallet est une maquette d'une autre époque avec chiffres inventés en dur, toujours servie à quiconque tape l'URL (gate restaurant/admin, aucun bandeau « aperçu »).
- Deux systèmes de design coexistent : le CD navy `--op-*` + Material Symbols (majorité des écrans) vs lucide + shadcn legacy (/wallet, /account, /marketplace/suppliers, parties de /dashboard/establishments).
- /briefing et /dinein n'activent AUCUNE entrée sidebar quand on y est (notes assumées dans le code : briefing/page.tsx:25, dinein/page.tsx:8-10).
- Deux écrans « promotions » coexistent : l'onglet Promos de /menu affiche 3 promos MOCK en dur tandis que /promotions gère les vraies — jamais les mêmes données ; et /promotions n'a AUCUNE entrée de navigation hormis le bandeau de /menu:1139.
- Deux wizards d'onboarding câblés coexistent (/onboarding 4 étapes plein écran, orphelin, vs /business/onboarding 2 étapes, le vivant), appelant les mêmes endpoints.

---
# PART 3 — DASHBOARD HOME (+ /briefing + /notifications)

## Contexte commun aux 3 pages

- Les 3 routes (`/dashboard`, `/briefing`, `/notifications`) rendent **dans la coquille OperatorShell** (navy, sidebar + topbar + bottom-nav mobile) : `components/AppChrome.tsx:22-31` — aucune n'est dans `BARE_PREFIXES`.
- **Gate rôle** : `/dashboard` exige `restaurant`/`admin` (`middleware.ts:200`) ; `/briefing` et `/notifications` sont dans `OPERATOR_FLAT_PREFIXES` (`middleware.ts:32-37`) → même gate.
- **Atteignabilité dans la nav** :
  - `/dashboard` : entrée sidebar « Dashboard » + 1er onglet du bottom-nav mobile (`OperatorShell.tsx:34,52`).
  - `/notifications` : **uniquement via la cloche du topbar** (`OperatorShell.tsx:203-205`) — pas d'entrée sidebar, pas de bottom-nav. La cloche n'affiche **aucun badge de non-lus** (icône seule).
  - `/briefing` : **ORPHELINE** — aucun lien nulle part dans l'app (grep `/briefing` sur tous les .tsx : seuls la page elle-même et son commentaire ; assumé : « /briefing has NO sidebar nav entry », `app/[locale]/briefing/page.tsx:25`). Accessible seulement par URL directe.
- **Gate onboarding** (spécifique `/dashboard`) : `app/[locale]/dashboard/layout.tsx:56-63` — un partenaire `restaurant` sans Brand OU sans Restaurant (non archivé) est redirigé **côté serveur** vers `/business/onboarding` avant tout rendu. Admin bypass.
- Iconographie : Material Symbols (`<span className="ms">`), pas lucide, sur les 3 pages.
- Largeur contenu : `.op-content` padding 24px, sections centrées `max-width:1520px` (`components/operator/operator-shell.css:131-132`). Breakpoint unique de bascule mobile de la coquille : **880px** (bottom-nav apparaît, padding 16px, `operator-shell.css:146-157`) — pas les breakpoints Tailwind.

## PAGE 1 — `/dashboard` (accueil KPI opérateur)

1. **Nom utilisateur** : « **Dashboard** » (`operator.dash.title` ; même label sidebar `operator.nav.dashboard`).
2. **Route** : `/{locale}/dashboard` — `app/[locale]/dashboard/page.tsx` (wrapper serveur) → `components/operator/OperatorDashboard.tsx` (client, tout le rendu).
3. **Objectif métier** : cockpit consolidé **niveau propriétaire** (tous établissements agrégés) : 4 KPIs, file « À traiter » (alertes réelles), placeholders honnêtes pour l'opérationnel live et l'IA, 5 raccourcis. Le détail par établissement (commandes en cours, graphe revenus, top plats) a été **retiré de la home** et vit dans /orders, /analytics, /stocks, /reviews (commentaire d'architecture `dashboard/page.tsx:15-27`).
4. **Persona / permission** : `restaurant`/`admin` (middleware.ts:200 + API `ALLOWED_ROLES` `app/api/dashboard/overview/route.ts:12`). Garde défensive : sans session → EmptyState 🔒 (`dashboard/page.tsx:35-46`).
5. **Données backend** : `GET /api/dashboard/overview` (`app/api/dashboard/overview/route.ts`), owner-scoped :
   - **aggregates** : `establishmentsCount` (Restaurant non archivés, :163-167) ; `caJour` = Σ `Order.subtotal` des commandes créées AUJOURD'HUI hors `cancelled`/`awaiting_payment`/`expired` (:184-200 — sous-total, frais de livraison exclus, même convention que /api/finance/summary) ; `orders7d` = volume fenêtre glissante 7 jours (:194) ; `avgBasket7d` = moyenne même fenêtre, `null` si 0 commande (:201) ; `avgRating`/`totalReviews` = moyenne pondérée des champs **dénormalisés** `Restaurant.rating`/`Restaurant.reviewCount` (:205-210) — il n'existe **aucune table d'avis alimentant ces champs** (commentaire :33-34).
   - **alerts.brandsToUnlock** : dérivé (pas de colonne dédiée) — `no_brand` (établissement sans marque), `empty_menu` (marques mais 0 `MenuItem.available`), `offline` (`Restaurant.isActive=false`) (:242-272). Les `detail` FR sont **écrits en dur côté API** (:251, :260, :269).
   - **alerts.stockOut** : `StockItem` des marques du propriétaire, sévérité `out` (qty ≤ 0) ou `low` (qty ≤ minThreshold) calculée en JS (:279-302).
   - L'API renvoie aussi `objectives` (franchisable/creator/influenceurs, :335-348) et `supplierToOrder`/`reviewsToHandle` marqués `available:false` — **la page ne les affiche PAS** (l'interface TS du client ignore `objectives`, `OperatorDashboard.tsx:20-24`).
   - L'API ne 500 jamais : elle dégrade en shape vide (:357-361).
6. **Actions** : « Actualiser » → `location.reload()` (rechargement complet, pas un refetch, `OperatorDashboard.tsx:114`) ; clic sur une ligne « À traiter » → `/dashboard/establishments` (alerte marque) ou `/stocks` (alerte stock) (:101-102) ; 5 raccourcis (navigation pure) ; état N=0 : CTA « Créer mon établissement » → `/business/onboarding` (:89 — cas quasi inatteignable pour un rôle `restaurant`, le layout redirige déjà).
7. **Champs éditables** : **AUCUN.** Page 100 % lecture.
8. **Champs read-only** : les 4 KPIs, les lignes de la file, la date/heure d'actualisation (calculée côté client au rendu, `OperatorDashboard.tsx:41-42` — PAS le `meta.generatedAt` de l'API).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | PERSISTÉ ? | FONCTIONNE ? | MORT ? | FLAG ? | FLOW EXTERNE ? |
|---|---|---|---|---|---|---|---|---|
| Actualiser | En-tête | `location.reload()` | non (relecture GET) | — | oui | non | non | non |
| (ligne file « À traiter ») | Carte « À traiter » | Link → /dashboard/establishments ou /stocks | non | — | oui | non | non | non |
| Ouvrir la file de commandes | Barre raccourcis | Link → /orders | non | — | oui | non | non | non |
| Ajouter une réservation | Barre raccourcis | Link → /tables | non | — | oui (mais atterrit sur la page tables, **pas** sur un formulaire de création ouvert) | non | non | non |
| Mettre en pause les commandes en ligne | Barre raccourcis | Link → /dashboard/fulfillment | non | — | oui | non | non | non |
| Ajouter un produit au menu | Barre raccourcis | Link → /menu | non | — | oui (atterrit sur /menu, pas sur le formulaire d'ajout ouvert) | non | non | non |
| Voir les factures fournisseurs | Barre raccourcis | Link → /marketplace/orders | non | — | oui | non | non | non |
| Réessayer (état erreur) | Carte erreur | `location.reload()` | non | — | oui | non | non | non |
| Créer mon établissement (N=0) | Carte onboarding | Link → /business/onboarding | non | — | oui | non | non | non |

Note markup : les raccourcis sont des `<button>` imbriqués dans des `<Link>` (`OperatorDashboard.tsx:186-190`) — HTML invalide (interactif dans interactif), le clic fonctionne via le Link parent.

10. **Filtres — N'EXISTENT PAS** (pas de sélecteur de période, pas de filtre par établissement ; le switcher d'établissement du topbar ne change PAS les agrégats de cette page — toujours « tous établissements »).
11. **Recherche — N'EXISTE PAS.**
12. **Pagination — N'EXISTE PAS** ; la file « À traiter » est tronquée à **6 lignes** en dur (`.slice(0, 6)`, `OperatorDashboard.tsx:166`) **sans lien « voir tout »** — le compteur du header montre le total réel (:161), il peut donc afficher 14 avec 6 lignes visibles.
13. **États métier** : 5 états rendus par React : `loading` / `error` / **onboarding N=0** (`aggregates.establishmentsCount === 0`, :81-98) / chargé mono-établissement / chargé multi (≥2 → sous-titre « Vue agrégée · {count} établissements », :78,112).
14. **Empty states (FR réels)** : file vide « **Rien à traiter** » / « Tout est sous contrôle pour l'instant » (`operator.queue.emptyTitle/emptyBody`) ; N=0 « **Bienvenue sur Grubano Business** » / « Créez votre premier établissement pour activer les commandes, les réservations, le stock et le Copilote IA. » + 3 étapes (Infos du restaurant / Votre menu / Mise en ligne) ; non connecté « Connectez-vous pour voir votre dashboard » / « Cette page est réservée aux comptes opérateurs. » (`dashboard.home.empty.authTitle/authDesc`).
15. **Loading** : squelette shimmer complet (en-tête + 4 KPI + 2 cartes) `aria-busy` (`OperatorDashboard.tsx:45-61`, animation `.op-sk` `dashboard.css:112-113`).
16. **Error** : carte centrée icône `cloud_off` : « **Impossible de charger le tableau de bord** » / « Vérifiez votre connexion internet et réessayez. Si le problème persiste, contactez le support Grubano. » + « Réessayer » (:64-75).
17. **Success state — N'EXISTE PAS** (aucune mutation → aucun toast).
18. **Disabled** : les 5 tuiles « Opérationnel en direct » portent la classe `.soon` (opacité .55, `dashboard.css:52`) avec valeur « — » + tag « Bientôt » — visuellement désactivées, non cliquables (`OperatorDashboard.tsx:144-155`).
19. **Mobile ACTUEL** : breakpoints CSS custom (PAS Tailwind) `dashboard.css:120-132` : ≤880px → KPIs 2 colonnes, `op-row2` 1 colonne, tuiles live 2 colonnes, en-tête empilé ; ≤460px → KPIs 1 colonne. Coquille : bottom-nav 5 onglets apparaît ≤880px, sidebar devient drawer (`operator-shell.css:146-165`).
20. **Desktop ACTUEL** : section centrée max **1520px**. KPIs `grid 4×1fr` ; rangée 2 en `1.6fr 1fr` (live ops | file) (`dashboard.css:16,39`) ; bande IA pleine largeur ; raccourcis en pills flex-wrap.
21. **Composants** : `OperatorDashboard` (client, monolithique), `EmptyState` de `components/design-system` (cas non connecté uniquement), `Link` de `@/navigation`, `formatEuros` (`lib/format-money`). Styles : `dashboard.css` + `operator-shell.css`.
22. **APIs** : `GET /api/dashboard/overview` (unique, `cache:'no-store'`, `OperatorDashboard.tsx:33`). La coquille appelle en plus `GET /api/establishments` (switcher, `OperatorShell.tsx:76`). L'ancien `GET /api/dashboard` (`app/api/dashboard/route.ts`) n'est **plus appelé par la home**.
23. **Feature flags — AUCUN** sur cette page.
24. **Hardcodes / placeholders** :
   - 5 tuiles « Opérationnel en direct » (Commandes en cours / Réservations à venir / Livraisons en cours / Tables occupées / File cuisine) : valeur « — » + « **Bientôt** » — **aucun backend live** (`OperatorDashboard.tsx:14-16,140`).
   - Bande « Copilote IA » : « **Le Copilote arrive bientôt** » / « Les premiers insights proactifs apparaîtront ici avec plus de données. » (:178-182).
   - Textes `detail` des alertes marques en dur en FR **dans l'API** (non i18n) : « Aucune marque rattachée — créez une marque pour démarrer la carte. », « Aucun plat disponible — ajoutez un plat au menu. », « Établissement hors ligne — réactivez-le pour recevoir des commandes. » (`overview/route.ts:251,260,269`).
   - Heure « Actualisé à » = heure du rendu client, pas `generatedAt` serveur (:41).
25. **Contrôles morts** : aucun bouton sans effet sur la page (les tuiles « Bientôt » sont des placeholders assumés, non des boutons). Dans la coquille : « Équipe · Bientôt » et « Copilote IA · Bientôt » = `<span aria-disabled>` inertes (`OperatorShell.tsx:46,159-162`).
26. **Dette legacy** :
   - Composants de l'ancienne home **encore présents mais plus utilisés** : `components/home/ConsolidatedHome.tsx`, `components/dashboard/DashboardRevenueChart.tsx`, `components/dashboard/LiveOrders.tsx` (seul un import de **type** d'`EstablishmentSwitcher` survit dans /orders et /dashboard/fulfillment). Confirmé `dashboard/page.tsx:24-27`.
   - Namespace i18n `dashboard.home.*` : ~90 % des clés (kpi.vsYday, liveOrders.*, perf.*, influencers.*, ov.*) ne sont **plus rendues** ; seuls `empty.authTitle/authDesc` et `sidebar.defaultUserName` servent encore.
   - L'API calcule `objectives` (seuils franchisables PROVISOIRES 4.5★/100 cmd/180 j, `overview/route.ts:104`) que l'UI n'affiche plus.

## PAGE 2 — `/briefing` (briefing matinal) — HIDDEN/ORPHELINE

1. **Nom utilisateur** : pas de titre de page ; hero « **Bonjour {prénom}** » (`operator.briefing.helloName`, fallback « Bonjour ») + date longue.
2. **Route** : `/{locale}/briefing` — `app/[locale]/briefing/page.tsx` (100 % client). **Page orpheline** (voir contexte commun).
3. **Objectif métier** : briefing du matin — synthèse IA générée par LLM + chiffres du jour + réservations du soir + alertes stock + checklist matinale.
4. **Persona / permission** : restaurant/admin (OPERATOR_FLAT + API gatée via `resolveEstablishmentScope`, `app/api/briefing/route.ts:18-22` — endpoint durci après une fuite PII cross-tenant, commentaire :12-17).
5. **Données backend** : `GET /api/briefing`, scoped propriétaire :
   - `briefing` (string) : texte généré par **Claude à CHAQUE chargement de page** (`llmComplete({task:'briefing'})`, :78 — pas de cache visible ; quota LLM par partenaire, `LlmQuotaError` → 429 :107-109). Prompt :63-75 (accueil + 3 priorités + 1 conseil, max 120 mots).
   - `kpis.caToday` : Σ `LoyaltyOrder.amount` validées aujourd'hui (**LoyaltyOrder = commandes UberEats validées**, :39-42,54) — ⚠️ PAS la même source que le « CA du jour » du /dashboard (Order.subtotal). Deux définitions différentes coexistent.
   - `kpis.ordersToday` : count de ces mêmes LoyaltyOrder.
   - `kpis.reservations`/`guests` : `Reservation` du jour hors cancelled/noshow (:34-36) ; noms clients /eat **masqués** (`maskEatReservation`, :50).
   - `lowStock` : `StockItem` avec `quantity ≤ minThreshold × 1.2` (:46) — ⚠️ seuil **différent** de celui du /dashboard (×1).
   - L'API renvoie une liste `reservations` (time, customerName masqué, guests, table, status, allergies — 5 max) que **la page n'affiche jamais ligne à ligne** : seuls les compteurs, gros groupes ≥6 et « à confirmer » en sont dérivés (`briefing/page.tsx:109,132`).
6. **Actions** : « Actualiser » → `load()` (vrai refetch — donc **regénère un appel LLM à chaque clic**, :163,46-56) ; cocher/décocher la checklist (state React local) ; « Réessayer » (erreur).
7. **Champs éditables** : les cases de la **checklist du matin** uniquement — state React, **non persisté** (tout est perdu au rechargement, :44,237).
8. **Read-only** : tout le reste (synthèse IA, chiffres, alertes, date, prénom via `useSession()`).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | PERSISTÉ ? | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|---|---|
| Actualiser | Hero | refetch GET /api/briefing (+ appel LLM) | lecture + génération LLM | — | oui | non |
| Réessayer | Carte erreur | refetch | idem | — | oui | non |
| (cases checklist) | Carte « Checklist du matin » | toggle state local | **non** | **NON** (perdu au reload) | oui (visuellement) | non |
| (lignes « Alertes à ne pas rater ») | Carte alertes | **AUCUNE** — `<div>` avec chevron_right et `cursor:pointer` hérité de `.op-queue__row`, **pas de Link ni onClick** (:214-218) | non | — | **NON** | **OUI — contrôle mort** (contrairement à la même file sur /dashboard qui navigue) |

10-12. **Filtres / recherche / pagination — N'EXISTENT PAS** (lowStock affiché : 3 noms max dans le sous-titre d'alerte :129, 1 nom max dans la checklist :141).
13. **États métier** : `loading` / `error` / **journée vide** (CA=0 ET commandes=0 ET résas=0 ET 0 alerte stock → écran dédié, :112-123) / chargé. `briefing` string vide → ligne IA remplacée par « Votre synthèse IA du jour arrive bientôt — prévisions et recommandations personnalisées. » + tag Bientôt (:168-171).
14. **Empty state (FR réel)** : « **La journée n'a pas encore commencée** » / « Votre briefing sera prêt dès l'ouverture de votre établissement. » ; alertes vides : « **Rien à signaler** » / « Aucune alerte pour le moment — bonne journée ! ».
15. **Loading** : squelette shimmer multi-cartes `aria-busy` (:70-91). Visible longtemps : l'API attend la complétion LLM avant de répondre.
16. **Error** : « **Impossible de charger votre briefing du jour** » + corps partagé avec le dashboard + « Réessayer » (:94-105). ⚠️ Si le **quota LLM** est atteint (429), la page bascule TOUT en erreur, y compris les chiffres non-IA (la route ne renvoie rien sans le LLM, `route.ts:78-105`).
17. **Success** : compteur de checklist « {fait}/{total} » (:233) ; pas de toast.
18. **Disabled** : widget météo et tuile « Météo & impact livraison » = « — » + « Bientôt » (:159-162,198-201) ; « Note moyenne » du récap = « — » + « Bientôt » (:182).
19. **Mobile** : `@media (max-width:880px)` (`briefing.css:138-142`) : `op-row2` 1 colonne, hero resserré. + coquille 880px (bottom-nav ; /briefing n'y a pas d'onglet → aucun item actif).
20. **Desktop** : max 1520px ; 2 rangées `op-row2` (`1.6fr 1fr`) : Chiffres du jour | Aujourd'hui, puis Insights IA | Checklist ; carte Alertes pleine largeur entre les deux.
21. **Composants** : page monolithique client ; `useSession()` (prénom) ; `formatEuros` ; styles `briefing.css` + classes partagées `op-card`/`op-queue`.
22. **APIs** : `GET /api/briefing` (unique, `cache:'no-store'`).
23. **Flags — AUCUN.**
24. **Hardcodes / placeholders** : météo « — Bientôt » ×2 (hero :159-162 + tuile :198-201) — **aucune intégration météo n'existe** ; « Note moyenne » du jour « — Bientôt » (:182) ; carte « Insights IA pour aujourd'hui » (tag « Proactif ») : « **Recommandations IA bientôt disponibles** » / « Le Copilote analysera vos données pour vous suggérer des actions concrètes chaque matin. » (:226-229) — aucun backend ; 2 items de checklist **statiques en dur** : « Vérifier les températures des frigos », « Allumer les équipements de cuisson » (:143-144) ; heures des résas formatées **en dur `fr-FR`** côté API (`route.ts:90`) quel que soit le locale.
25. **Contrôles morts** : lignes « Alertes à ne pas rater » (chevron + hover + cursor pointer, aucune navigation ni action, :214-218).
26. **Dette legacy** : page orpheline (0 lien entrant) ; divergence de définitions avec /dashboard (CA du jour + seuil stock bas) → les deux pages peuvent afficher des chiffres différents le même jour ; un appel LLM payant par affichage/Actualiser, sans cache.

## PAGE 3 — `/notifications` (centre de notifications opérateur) — APERÇU NON BRANCHÉ

1. **Nom utilisateur** : « **Notifications** » (`operator.notif.title`) + compteur « {n} non lue(s) ».
2. **Route** : `/{locale}/notifications` — 100 % client. Atteinte UNIQUEMENT par la cloche du topbar. Distincte de `/eat/account/notifications` (conso).
3. **Objectif métier** : ⚠️ **Écran NON BRANCHÉ — aperçu honnête.** Le système de notifications temps réel **n'existe pas en backend** (commentaire :7-14). Maquette CD avec 8 notifications **d'exemple illustratives**, sous une bannière obligatoire.
4. **Persona** : restaurant/admin (OPERATOR_FLAT, `middleware.ts:35`).
5. **Données backend** : **AUCUNE.** Zéro fetch. Les 8 lignes sont un tableau constant `EXAMPLES` en dur (:37-46) : commande #1042 (28,40 €), avis 3★ Google, stock bas Burrata, résa table 6, versement 312,40 €, commande fournisseur Metro, commande annulée #1031, avis 4★. Horodatages fictifs en dur (« il y a 5 min »… :38-45 + `operator.notif.time.*`).
6. **Actions (toutes locales, aucune persistée)** : « Tout marquer comme lu » → state React `readAll` ; 6 chips de filtre (Toutes / Commandes / Avis / Stock / Réservations / Paiements) → filtre local des exemples ; toggles de préférences (voir 7).
7. **Champs éditables** : 15 interrupteurs de « Préférences de notification » (5 types × Dans l'app / E-mail / SMS) — **`defaultChecked` non contrôlé, purement visuel, aucun backend, rien n'est sauvegardé** (:57-64,173-191). Défauts en dur `PREFS` (:58-64).
8. **Read-only** : tout le feed (exemples).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | PERSISTÉ ? | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|---|---|
| Tout marquer comme lu | En-tête | state local `readAll` | **non** | **NON** | visuellement | effet réel : mort (rien à marquer) |
| Toutes / Commandes / Avis / Stock / Réservations / Paiements | Chips filtres | filtre local des exemples | non | non | visuellement | — |
| Interrupteurs préférences (×15) | Carte « Préférences de notification » | checkbox non contrôlée | **non** | **NON** | visuellement | **OUI — aucun effet réel** |
| (lignes du feed) | Feed | **aucune** — `<div>` non cliquables | non | — | — | pas de navigation prévue |

10-12. **Filtres** : 6 chips (locaux, sur données d'exemple). **Recherche / pagination — N'EXISTENT PAS** (8 exemples fixes, groupés « Aujourd'hui » / « Hier »).
13. **États métier** : un seul état — la maquette « loaded ». **Pas de loading, pas d'erreur, pas d'empty** (aucun fetch). « Tout marquer comme lu » `disabled` quand `unread === 0` (:115).
14-17. **Empty / loading / error / success — N'EXISTENT PAS.**
18. **Disabled** : « Tout marquer comme lu » à 0 non lue (:115).
19. **Mobile** : `notifications.css:135-149` : ≤880px bannière en colonne, méta du feed en wrap ; ≤460px en-tête aligné haut.
20. **Desktop** : colonne centrée **max-width:760px** (`notifications.css:31-32`) — plus étroite que le reste de l'app (1520px).
21. **Composants** : page monolithique client ; `notifications.css` ; classes `op-card`/`op-btn-ghost`/`op-switch` ; `t.rich` pour les montants illustratifs en `.mono`.
22. **APIs — AUCUNE.** 23. **Flags — AUCUN.**
24. **Hardcodes** : **toute la page** — 8 notifications d'exemple avec noms fictifs (Sophie Martin, Karim Belhadj, Julie Roussel, Amine Lahlou), montants illustratifs (28,40 €, 312,40 €), fournisseur « Metro Paris 11e » (:37-46 + `operator.notif.item.*`). Bannière obligatoire (FR réel) : « **Les notifications en temps réel arrivent bientôt** » / « Les éléments ci-dessous illustrent l'interface à venir — rien n'est encore poussé en direct. » + tag « Bientôt » (:121-128).
25. **Contrôles morts** : les 15 interrupteurs de préférences ; « Tout marquer comme lu » (agit sur des exemples) ; la cloche du topbar mène ici mais **n'a pas de badge de non-lus** — aucun compteur réel n'existe.
26. **Dette legacy** : la page revendique remplacer « the legacy MOCK page » (commentaire :16-19) — c'est toujours un mock, re-skinné.

## Dette design factuelle (récap PART 3)

1. **File d'alertes : deux patterns pour la même chose** — sur /dashboard les lignes `op-queue__row` sont des `<Link>` navigants (`OperatorDashboard.tsx:167`), sur /briefing les mêmes lignes visuelles (même classe, même chevron, même hover) sont des `<div>` **morts** (`briefing/page.tsx:214-218`).
2. **Deux « CA du jour » incompatibles** — /dashboard : Σ `Order.subtotal` du jour (`overview/route.ts:196-200`) ; /briefing : Σ `LoyaltyOrder.amount` validées (UberEats) (`briefing/route.ts:39-42,54`). Deux seuils « stock bas » différents (×1 vs ×1.2 : `overview/route.ts:288` vs `briefing/route.ts:46`).
3. **Compteur > lignes affichées** — badge « À traiter » = total (`OperatorDashboard.tsx:161`), liste tronquée à 6 (:166) sans « voir tout ».
4. **`<button>` dans `<Link>`** sur les 5 raccourcis du dashboard (:186-190).
5. **Page /briefing orpheline** — 0 lien entrant ; pas d'item sidebar actif quand on y est.
6. **Cloche sans badge** — le topbar link /notifications n'affiche aucun compte de non-lus, et la page qu'il ouvre est un mock.
7. **Largeurs divergentes** — /notifications à 760px centré vs 1520px pour le reste.
8. **Textes d'alerte non i18n** — `detail` FR en dur dans l'API (`overview/route.ts:251,260,269`) ; heures des résas du briefing en `fr-FR` en dur (`briefing/route.ts:90`).
9. **Beaucoup de « Bientôt » sur la home** — 5 tuiles live + bande Copilote IA (/dashboard), météo ×2 + note du jour + insights IA (/briefing), page /notifications entière : la moitié de la surface du « cockpit » est du placeholder assumé.
10. **Code mort conservé** — `ConsolidatedHome.tsx`, `DashboardRevenueChart.tsx`, `LiveOrders.tsx` plus référencés ; ~90 % du namespace i18n `dashboard.home.*` orphelin.
11. **Fragilité briefing** — quota LLM atteint (429) = toute la page en erreur, chiffres réels inclus ; un appel LLM payant par affichage, sans cache.
12. **« Actualisé à » trompeur potentiel** — heure du rendu client, pas du calcul serveur (`meta.generatedAt` ignoré).
13. **Objectifs calculés mais invisibles** — l'API overview calcule franchisable/creator (seuils provisoires 4.5★/100/180 j) ; l'UI ne les rend nulle part.

## Ce qui N'EXISTE PAS (PART 3 — à ne pas supposer)

- **Aucune donnée opérationnelle live** sur la home : pas de commandes en cours, réservations à venir, livraisons, tables occupées, file cuisine (tuiles « — Bientôt »).
- **Aucun système de notifications réel** : pas de modèle Notification en base, pas de push, pas de compteur de non-lus, pas de préférences persistées, pas de temps réel/websocket.
- **Aucun graphique** sur la home actuelle (le graphe revenus a été retiré ; il vit dans /analytics).
- **Aucun sélecteur de période** (fenêtres jour/7 j fixes) ni **filtre par établissement** sur les KPIs de la home.
- **Aucune comparaison** vs hier / vs semaine dernière (clés i18n `vsYday`/`vsLastWeek` existent mais ne sont plus rendues ; styles `.op-kpi__trend` en CSS sans aucun élément).
- **Aucune table d'avis** alimentant la « Note moyenne » (champs dénormalisés) ; pas d'« avis à traiter » calculable (`overview/route.ts:97-98`).
- **Aucun signal fournisseur** (« commandes fournisseur à passer ») : pas de lien propriétaire→fournisseur dans le schéma (`overview/route.ts:95-96`).
- **Aucune météo**, **aucun insight IA proactif**, **aucune note moyenne journalière** (briefing).
- **Aucune persistance de la checklist** du briefing.
- **Aucun objectif/gamification affiché** (calculé côté API seulement).
- **Aucune personnalisation du dashboard** (pas de réorganisation de cartes, pas de widgets).

---
# PART 4 — RÉSERVATIONS (/tables + /dinein)

Périmètre : `/tables` (Réservations & Salle : liste, agenda, plan de salle, addition/TableTicket, config), `/dinein` (Service à table — aperçu inerte), et les surfaces modales associées (nouvelle réservation, confirmation no-show, clôture de table avec empreinte, historique de consommation, alerte impayé, paiement Stripe inline).

Repères adjacents à ne PAS confondre : `/t/[tableId]` = page CONSO du QR de table (paiement réel Stripe côté client, `app/[locale]/t/[tableId]/page.tsx`) — pas une page opérateur. `/eat/dinein` = démo CONSO 100 % inerte (`app/[locale]/eat/dinein/page.tsx:12-27`) — rien à voir avec le /dinein opérateur documenté ici.

## PAGE 1 — `/tables` « Réservations & Salle »

1. **Nom utilisateur (FR réel)** : titre « **Réservations & Salle** » (`tables.pageTitle`), même label sidebar (icône Material `event_seat`, OperatorShell.tsx:35 et :54, `operator.nav.reservations`). Sous-titre : date longue FR du jour sélectionné (ex. « samedi 30 août 2026 ») — TablesShell.tsx:384-393.
2. **Route** : `/[locale]/tables` — `dynamic = 'force-dynamic'` (page.tsx:22). Pas de sous-routes ; les 5 onglets sont du state client (pas d'URL par onglet, pas de deep-link).
3. **Objectif métier** : gérer la salle d'UN établissement (celui du cookie `ESTABLISHMENT_COOKIE`, fallback le plus ancien — page.tsx:60-61) : créer/voir les réservations du jour, marquer arrivée / dépassement / no-show, gérer l'empreinte bancaire de garantie (Stripe, capture manuelle), tenir l'addition d'une table (TableTicket : lignes, quantités, encaissement Stripe, clôture tracée), configurer tables + durée par défaut + montant d'empreinte, générer/imprimer les QR codes de table (URL `/t/<tableId>`).
4. **Persona / permission** : middleware.ts:34-36 (`OPERATOR_FLAT`) → restaurant/admin. Défense en profondeur : session absente → redirect `/auth/magic` (page.tsx:28-30) ; rôle ≠ restaurant/admin → EmptyState 🔒 « Accès réservé aux restaurants » / « Cette page est uniquement disponible pour les comptes opérateurs de restaurant. » (page.tsx:37-47, textes en dur dans le TSX, PAS dans fr.json). APIs owner-scoped via `resolveEstablishmentScope` (api/tables/route.ts:17, api/reservations/route.ts:74).
5. **Données backend** :
   - **Restaurant** : `id, name, city, defaultReservationDurationMin` (page.tsx:51-58) ; `defaultDepositAmount` + durée via GET `/api/restaurants/[id]/fulfillment` (TablesShell.tsx:1170, 1245).
   - **RestaurantTable** : `id, name, seats, x, y, active` (TablesShell.tsx:38-45 ; GET /api/tables filtre `active: true`, tri `name asc` — api/tables/route.ts:29-32). ⚠️ `x`/`y` stockés (POST défaut 50/50, :56-57) mais **jamais utilisés pour positionner** : le plan est une grille CSS (§20).
   - **Reservation** : `id, tableId, customerName, phone, email, guests, date, endTime, type (quick|standard|full), status, allergies (Json[]), depositAmount (Float €), depositPaid, depositStatus, depositCurrency, noShowPenalty, stripePaymentIntentId, notes, table{}` (TablesShell.tsx:47-76). PII des résas conso /eat : nom MASQUÉ, phone/email `null` par `maskEatReservation` (api/reservations/route.ts:99-101 ; lib/customer-scope.ts:61-69) — l'opérateur ne voit jamais le contact d'un client /eat.
   - **TableTicket** (« addition ») : `id, status (open|paid|void), currency, subtotal (Float €), reservationId, items[]{id, menuItemId, name, unitPrice, quantity, addedBy ('client'|opérateur), notes, allergies, status}` (TicketPanel.tsx:26-41) ; historique : `openedAt, paidAt, closedReason, closedAt, amountPaid` + lignes `cancelledAt` (ReservationHistory.tsx:16-36).
   - **Empreinte Stripe** : GET `/api/reservations/[id]/deposit` → `depositStatus, stripeStatus, amount` (en CENTS), `currency` (app/api/reservations/[id]/deposit/route.ts:173-174).
   - **MenuItem** (picker addition) : `id, name, price, category` via GET `/api/tickets/menu` (TicketPanel.tsx:185-192).
6. **Actions possibles (par onglet)** :
   - **Global** : changer d'établissement (EstablishmentSwitcher, invisible à ≤1 établissement — TablesShell.tsx:396-397) ; « Nouvelle réservation » (modal) ; naviguer entre 5 onglets « Liste / Agenda / Plan / Addition / Config » (fr.json `tables.tab.*` ; TablesShell.tsx:430-443).
   - **Liste** : naviguer jour −1/+1 ; filtrer (Toutes/Arrivés/Allergies/Acompte) ; « Client arrivé » (empreinte active) ou « Arrivée » (sans empreinte) → PATCH status='arrived' ; « No-show » → modal de confirmation → PATCH status='noshow' ; « Dépassement » sur une résa arrivée → PATCH status='overrun' ; ouvrir l'addition d'une table arrivée (clic badge session ou pill « Nouvelle commande client ») ; ouvrir l'historique de consommation (icône `history`).
   - **Agenda** : naviguer jour −1/+1 uniquement (grille lecture seule).
   - **Plan** : sélectionner une table (fiche détail dessous) ; « Voir l'addition » d'une table occupée ; historique d'une résa passée.
   - **Addition** : choisir la table (select) ; « Ouvrir une addition » (liée à la résa arrivée) ou « Ouvrir en walk-in (sans réservation) » ; ajouter un plat du menu (recherche + clic) ; ajouter une « Ligne libre » (libellé + prix) ; ±1 quantité ; supprimer une ligne (soft-cancel) ; « Encaisser & clôturer » (Stripe Elements inline) ; « Clôturer en impayé » (modal empreinte) ; « Libérer la table » (addition vide) ; « Annuler l'addition » (void, confirmation inline) ; régler ou clôturer l'addition impayée du service précédent (UnpaidAlert).
   - **Config** : régler la durée par défaut (presets 1 h / 1 h 30 / 2 h + saisie 15-600 min, save au blur) ; régler l'empreinte no-show (presets 0/10/15/20 € + saisie 0-500 €, save au blur) ; créer une table (nom + places) ; télécharger le QR PNG d'une table ; « Imprimer les QR codes » (planche A4 via `window.print()`).
7. **Champs réellement éditables** :
   - **Modal Nouvelle réservation** (TablesShell.tsx:1679-1922) : Nom du client (requis), Téléphone (optionnel), Date (min = aujourd'hui), Heure (min = maintenant si aujourd'hui), Couverts (1-30), Durée min (15-300, pré-remplie par la durée par défaut), Table (chips). C'EST TOUT — voir « N'EXISTE PAS ».
   - **Config** : durée par défaut (min 15 / max 600, :1314-1324) ; montant d'empreinte € (min 0 / max 500, :1370-1383) ; nouvelle table : Nom (placeholder « Table 7 »), Places (1-30) (:1432-1453).
   - **Addition** : recherche menu ; ligne libre (Libellé, « Prix € » inputMode decimal — TicketPanel.tsx:557-579) ; quantité des lignes.
8. **Champs read-only** : ligne de résa (heure début + heure de libération, couverts, nom, « {table} · {guests} couvert(s) · libère {release} » (`tables.rowMeta`), badges session #XXXX / statut / type Rapide-Standard-Complet / empreinte, allergies ⚠) ; KPIs jour « Réservations » / « Couverts » / « Acomptes » (somme des `depositAmount` où `depositPaid` — TablesShell.tsx:612-637) ; Config : « {n} table(s) configurée(s) » + liste nom/places (aucune édition/suppression), URL encodée de chaque QR ; Addition : statut (Ouverte/Payée/Annulée), Total (jamais recalculé côté client — Float € serveur), notes/allergies par ligne, tag « commande client » ; Historique : tickets archivés complets (statuts « Payée / Clôturée impayée / Annulée / En cours », dates, lignes barrées « annulée », Total, « Encaissé »).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND | PERSISTÉ | FONCTIONNE | MORT | FLAG | FLOW EXTERNE |
|---|---|---|---|---|---|---|---|---|
| « Nouvelle réservation » | head | ouvre modal | — | — | oui (disabled si 0 table, TablesShell.tsx:402) | non | — | — |
| « Réserver » | modal résa | POST /api/reservations | crée Reservation (+ warning horaires non bloquant) | oui | oui | non | — | — |
| « Annuler » | modal résa | ferme | — | — | oui | non | — | — |
| « Client arrivé » | ligne (empreinte active) | PATCH status='arrived' | résa arrivée + auto-ouverture ticket lié (api/reservations/route.ts:462-476) ; l'empreinte RESTE active (TablesShell.tsx:360-363) | oui | oui | non | — | — |
| « Arrivée » | ligne (sans empreinte) | PATCH status='arrived' | idem | oui | oui | non | — | — |
| « No-show » | ligne (empreinte active) | ouvre modal confirmation | — | — | oui | non | — | — |
| « Marquer le no-show » | modal confirmation | PATCH status='noshow' | flag OFF (pilote) : empreinte LIBÉRÉE, aucun débit (api/reservations/route.ts:367-401) ; flag ON : `captureHold` débite la pénalité + email client | oui | oui | non | `PUNITIVE_CAPTURE_ENABLED` (lib/deposit.ts:22) | Stripe |
| « Dépassement » | ligne arrivée | PATCH status='overrun' | statut | oui | oui | non | — | — |
| badge « Nouvelle commande client » | ligne / plan | ouvre onglet Addition + acquitte | — (état UI seul, aucun modèle serveur de notif — TablesShell.tsx:112-115) | non | oui | non | — | — |
| icône `history` | ligne / plan | ouvre ReservationHistory | GET /api/reservations/[id]/tickets | — | oui | non | — | — |
| « Voir l'addition » | plan (table occupée) | onglet Addition | — | — | oui | non | — | — |
| icône `qr_code_2` (span) | plan, table non occupée | AUCUNE | — | — | — | **OUI — `<span>` stylé bouton, sans handler** (TablesShell.tsx:1102) | — | — |
| « Ouvrir une addition » | Addition vide | POST /api/tickets {walkin:false} | exige résa arrivée ; 409 si impayé précédent | oui | oui | non | — | — |
| « Ouvrir en walk-in (sans réservation) » | Addition vide | POST /api/tickets {walkin:true} | ticket sans résa | oui | oui | non | — | — |
| plat du menu (clic) | Addition | POST /api/tickets/[id]/items {menuItemId} | ligne ajoutée | oui | oui | non | — | — |
| « Ajouter » (ligne libre) | Addition | POST /api/tickets/[id]/items {name, unitPrice} | ligne libre | oui | oui | non | — | — |
| − / + quantité | ligne addition | PATCH ou DELETE /api/tickets/[id]/items/[itemId] | qty ; qty<1 = suppression | oui | oui | non | — | — |
| icône `delete` ligne | ligne addition | DELETE item | soft-cancel (status='cancelled', hors total) | oui | oui | non | — | — |
| « Encaisser & clôturer » | Addition | monte InlinePayPanel → POST /api/tickets/[id]/pay | PaymentIntent Stripe auto-capture ; webhook passe le ticket 'paid' + libère l'empreinte | oui | oui | non | — | **Stripe Elements** |
| « Clôturer en impayé » | Addition / UnpaidAlert | ouvre CloseTableModal | — | — | oui | non | — | — |
| « Libérer la table » | Addition vide d'articles | POST /api/tickets/[id]/close {reason:'empty'} | ticket void, closedReason='void_empty' | oui | oui | non | — | — |
| « Annuler l'addition » → « Oui, annuler » | Addition | PATCH /api/tickets/[id] {status:'void'} | void | oui | oui | non | — | — |
| « Encaisser l'addition précédente » | UnpaidAlert | InlinePayPanel sur le ticket bloqué | Stripe | oui | oui | non | — | Stripe |
| « Libérer la table » / « Clôturer en impayé » (choix empreinte) | CloseTableModal | POST /api/tickets/[id]/close {reason, deposit:'capture'\|'release'} | void tracé + règlement empreinte ; **capture inopérante pilote → libération** (close/route.ts:99-105 + V4-1) | oui | oui | non | `PUNITIVE_CAPTURE_ENABLED` | Stripe |
| « Confirmer — l'empreinte sera libérée » | CloseTableModal (étape confirm) | doClose() | idem | oui | oui | non | idem | Stripe |
| presets « 1 h / 1 h 30 / 2 h » + input min | Config durée | POST /api/restaurants/[id]/fulfillment {defaultReservationDurationMin} | persisté sur Restaurant | oui | oui | non | — | — |
| presets « 0 / 10€ / 15€ / 20€ » + input € | Config empreinte | POST fulfillment {defaultDepositAmount} | persisté (0 = désactivé) | oui | oui | non | — | — |
| « Ajouter une table » → « Créer » | Config | POST /api/tables | RestaurantTable créée (x/y=50 par défaut) | oui | oui | non | — | — |
| « PNG » | carte QR | download canvas 512px | — (fichier local `grubano-{estab}-{table}.png`) | non | oui | non | — | — |
| « Imprimer les QR codes » | Config | `window.print()` (planche A4 cachée) | — | non | oui | non | — | impression navigateur |
| « Aller à Config » | empty state 0 table | change d'onglet | — | — | oui | non | — | — |
| bannière horaires « OK » (croix) | head | dismiss | — | non | oui | non | — | — |

10. **Filtres** : Liste uniquement — 4 chips « Toutes / Arrivés / Allergies / Acompte » (`tables.filter.*` ; TablesShell.tsx:605-610). « Toutes » EXCLUT cancelled + noshow ; « Acompte » = `depositAmount > 0` quel que soit le statut. Aucun filtre sur Agenda/Plan/Addition/Config.
11. **Recherche** : réservations — **N'EXISTE PAS**. Addition — recherche plein-texte locale dans le menu (« Rechercher un plat… », TicketPanel.tsx:312-314, 536-543).
12. **Pagination** : **N'EXISTE PAS.** GET /api/reservations?date= renvoie tout le jour ; la liste rend tout (TablesShell.tsx:667). Navigation par jour −1/+1 seulement (pas de datepicker, pas de vue semaine).
13. **États métier** :
   - **Reservation.status** : `confirmed → arrived → overrun` ; `cancelled` ; `noshow` ; `completed` (posé UNIQUEMENT par le serveur — addition payée via webhook ou table clôturée ; jamais par un clic opérateur — TablesShell.tsx:58-61 ; le PATCH n'accepte pas 'completed', api/reservations/route.ts:57). Badges FR : « Arrivée » / « Dépassement » / « Terminée ».
   - **depositStatus** : `none | authorized | captured | released`. Badges : « Empreinte {amount} active » / « Empreinte libérée » / « Pénalité {amount} prélevée » ; legacy (undefined/'none' avec depositAmount>0) → pill montant + « ✓ » si depositPaid (TablesShell.tsx:824-846).
   - **Cycle empreinte réel** : créée côté CONSO (POST /api/reservations/[id]/deposit — PI Stripe manual-capture, route publique gardée par le cuid) ; reste active à l'arrivée ; libérée au paiement de l'addition (webhook) OU au choix de clôture ; annulation opérateur ⇒ libération automatique (P0-12, api/reservations/route.ts:330-353) ; no-show pilote ⇒ libération (V4-1). `depositPaid` NON déclarable manuellement — 403 `deposit_declaration_forbidden` (route.ts:282-294).
   - **TableTicket.status** : `open | paid | void` ; `closedReason` : `void_unpaid | void_empty | void_manual` (close/route.ts:37-41). Lignes : `active | cancelled` ; `addedBy: 'client'` = commande passée par le client via /t.
   - **Type de résa** : `quick | standard | full` (« Rapide / Standard / Complet ») — affiché en pill, mais **non choisissable** dans le formulaire (toujours 'standard', TablesShell.tsx:1700).
   - **Code session** : `#XXXX` (hash djb2 → Crockford base32 4 chars, lib/reservation-code.ts) ; sans résa → pill « Walk-in ».
14. **Empty states (FR réels)** : 0 établissement 🏪 « Aucun établissement » / « Créez un établissement pour gérer ses tables et réservations. » (page.tsx:65-76 + TablesShell.tsx:372-382) ; 0 table (hors Config) « Aucune table » / « Ajoutez votre première table dans Config pour pouvoir prendre des réservations. » + « Aller à Config » (:448-456) ; jour sans résa « Aucune réservation ce jour » / « Votre salle est libre pour l'instant. Ajoutez une réservation ou attendez les prochaines demandes clients. » ; Addition sans table active « Aucune table — ajoutez-en une dans Config. » ; sans ticket « Ouvrez l'addition d'un client arrivé, ou en walk-in. » ; 0 ligne « Aucune ligne pour le moment. » ; menu vide « Aucun plat trouvé. » ; QR « Ajoutez une table pour générer son QR code. » ; Historique « Aucune addition pour cette réservation. » ; Modal résa 0 table « Aucune table pour le moment. Ajoutez une table dans l'onglet Config avant de réserver. »
15. **Loading** : liste — spinner Material `progress_activity` + « Chargement… » (:654-658), refresh silencieux (polling) ; Addition — spinner seul (TicketPanel.tsx:357-360) ; InlinePayPanel « Préparation du paiement… » ; CloseTableModal spinner + littéral « … » (:180) ; Historique « Chargement… ». Pas de skeleton sur /tables (contrairement à /dinein).
16. **Errors** : modal résa — pill rouge avec le message SERVEUR verbatim (ex. « Créneau déjà passé — choisissez un horaire à venir. », « Table déjà réservée de HH:MM à HH:MM » 409, « Cette table a N place(s), vous demandez M couvert(s). ») — :1777-1781 ; garde client avant POST « Créez ou sélectionnez une table avant de réserver. » + hint rouge créneau passé. Actions statut : « Action impossible — réessayez. » / 409 « Statut incompatible (déjà capturée ou libérée). » (`tables.deposit.actionError*`) — rollback optimiste + resync par polling (:308-312). Config : « Impossible d'enregistrer la durée » / « Impossible d'enregistrer l'empreinte. ». Addition : « Une erreur est survenue, réessayez. » ; paiement « Impossible de démarrer le paiement. Réessayez. » ; clôture « Clôture impossible — réessayez. » ; règlement empreinte partiel « Empreinte non réglée : {error}. La table est clôturée — réglez l'empreinte depuis la réservation. » (⚠ renvoie vers une action « depuis la réservation » qui n'a PAS de surface UI — voir dette). Bannière horaires (POST résa hors horaires, NON bloquante) : « Réservation hors de vos horaires configurés » / message serveur / « La réservation est bien créée — vous êtes maître chez vous. Vérifiez simplement que ce créneau est voulu. » (:410-427).
17. **Success** : résa créée → fermeture modal + reload liste (pas de toast) ; Config → pill « Enregistré » ✓ auto-effacée 2 s (:1186-1190, 1229-1234) ; clôture → toast texte « Empreinte libérée — table libérée » / « Pénalité {amount} prélevée — table libérée » / « Table libérée » (TicketPanel.tsx:608-623) ; paiement → `onPaid` → rechargement ticket (webhook 'paid'), badge « Payée ».
18. **Disabled** : « Nouvelle réservation » si 0 table (:402) ; « Réserver » si saving ∥ pas de table ∥ créneau passé (:1911) ; boutons de ligne pendant PATCH (`pendingId`) ; presets/inputs Config pendant save (+ empreinte tant que `!depositLoaded`) ; tag « Empreinte désactivée » à montant 0 (:1345-1347) ; « PNG » tant que l'origin n'est pas monté (:1665) ; steppers/CTA addition pendant `pending`.
19. **Mobile ACTUEL** : breakpoints tables.css : **1040px** (plan 6→4 colonnes, :436-439), **880px** (head en colonne, stat-strip empilée, colonne « covers » MASQUÉE `display:none` :447, plan 3 colonnes, grille QR 1 colonne), **460px** (formulaire ligne libre wrap) — :435-453. Les modals CloseTableModal/ReservationHistory sont des bottom-sheets mobiles (`items-end` + `rounded-t-3xl`, centrés `sm:` — CloseTableModal.tsx:146-147, ReservationHistory.tsx:90-91). Les modals op-* (résa, no-show) restent centrés à toutes tailles (max-width 560/440px, tables.css:384-385).
20. **Desktop ACTUEL** : contenu max 1520px. Liste pleine largeur (`resv-row`). Plan de salle : **grille fixe repeat(6,1fr), tuiles carrées aspect-ratio 1** (tables.css:167-168) — ordre = tri alphabétique API, PAS les coordonnées x/y. Agenda : `<table>` 1 colonne table + 6 colonnes heures fixes **17h→22h** (TablesShell.tsx:906) dans un wrapper scrollable. Addition : colonne **max-width 640px** (tables.css:284) — n'exploite pas le desktop. Config : cartes empilées ; grille QR 2 colonnes.
21. **Composants** : `TablesShell` (client, 1923 l.) + sous-vues internes ListView/CalendarView/FloorPlanView/SetupView/QrCodesSection/QrCard/PrintableQrSheet/NewReservationForm/CaptureConfirmModal/DepositBadge ; `TicketPanel` ; `CloseTableModal` ; `ReservationHistory` ; `UnpaidAlert` ; `InlinePayPanel` → `StripeTicketPayment` (partagé avec /t et le modal conso — InlinePayPanel.tsx:10-16) ; `SessionBadge` ; `EstablishmentSwitcher` ; `EmptyState` (design-system) ; `qrcode.react` (QRCodeSVG + QRCodeCanvas). Icônes : Material Symbols dans TablesShell/TicketPanel, **lucide-react** dans CloseTableModal/ReservationHistory/UnpaidAlert/InlinePayPanel/SessionBadge (divergence, voir dette).
22. **APIs** : `GET /api/tables?restaurantId=` ; `POST /api/tables` (DELETE existe côté serveur, AUCUN appelant UI) · `GET /api/reservations?date=&restaurantId=` ; `POST /api/reservations` ; `PATCH /api/reservations` (status only) · `GET /api/reservations/[id]/deposit` (CloseTableModal) ; `GET /api/reservations/[id]/tickets` (historique) — POST /deposit, /deposit/capture, /deposit/release, /[id]/cancel, /public, /availability, /refund-deposit, /purge-residual-deposits existent mais ne sont PAS appelés par ce dashboard (TablesShell.tsx:355-359) · `GET /api/tickets?restaurantTableId=` ; `POST /api/tickets` ; `PATCH /api/tickets/[id]` ; `POST /api/tickets/[id]/close` ; `POST /api/tickets/[id]/items` ; `PATCH|DELETE /api/tickets/[id]/items/[itemId]` ; `POST /api/tickets/[id]/pay` ; `GET /api/tickets/menu` · `GET|POST /api/restaurants/[id]/fulfillment`. Polling : réservations 4 s (TablesShell.tsx:296), ticket courant 3 s (TicketPanel.tsx:182, pausé pendant le paiement), tickets des tables arrivées 6 s pour le badge « nouvelle commande » (TablesShell.tsx:160).
23. **Feature flags** : `PUNITIVE_CAPTURE_ENABLED` (lib/deposit.ts:22) — OFF en pilote : no-show et clôture impayée LIBÈRENT l'empreinte au lieu de capturer ; les textes FR le disent (« Aucune pénalité n'est débitée pendant le pilote… », fr.json `tables.deposit.actionConfirmNoshowBody`, `premium.closure.depositCapture/captureWarning`). Aucun autre flag.
24. **Hardcodes / placeholders** :
   - `depositAmount: 10` **codé en dur** dans le state initial du formulaire de résa et envoyé tel quel au POST (TablesShell.tsx:1701, 1774) — la valeur configurée dans Config (`defaultDepositAmount`) n'est PAS utilisée par le formulaire opérateur.
   - Agenda : heures fixes `['17h','18h','19h','20h','21h','22h']` (:906) — une résa à midi n'apparaît pas dans la grille.
   - Agenda fallback noms de tables `['T1','T2','Terrasse','Bar','Salon']` (:907) et Plan fallback 3 tables factices (:1037-1041) — code MORT en pratique (l'empty state 0-table :448 rend ces vues inaccessibles sans table).
   - Défaut local empreinte `useState(10)` avant hydratation (:1158).
   - Texte « Le paiement par QR arrivera bientôt. » (fr.json `tickets.paidNote`, TicketPanel.tsx:581) alors que le composant de paiement de la page QR /t existe et est réutilisé ici même (InlinePayPanel.tsx:10-14) — texte périmé/mensonger.
   - Durée par défaut fallback 60 min (page.tsx:83, api/tables/route.ts:23).
25. **Contrôles morts** : faux bouton QR du plan (`<span className="icon-btn-sm">` icône `qr_code_2`, table non occupée — aucun handler, TablesShell.tsx:1102) ; `DELETE /api/tables` = capacité serveur orpheline (endpoint fonctionnel soft-delete sans aucun contrôle UI) ; UnpaidAlert — prop `previousReservationId` jamais fournie (TicketPanel.tsx:348-355) → badge « Service précédent » affiche TOUJOURS « Walk-in », même quand l'addition bloquée venait d'une réservation (UnpaidAlert.tsx:40-45, 97 — reconnu en commentaire).
26. **Dette** : voir section consolidée en fin de PART 4.

## SURFACES MODALES de /tables (récapitulatif)

| Surface | Fichier | Déclencheur | Contenu clé |
|---|---|---|---|
| Nouvelle réservation | TablesShell.tsx:1679-1922 | bouton head | 7 champs (§7), garde créneau passé 5 min (miroir serveur PAST_GRACE_MS, api/reservations/route.ts:23), aperçu live « libère à {time} » |
| Confirmation no-show | TablesShell.tsx:851-893 | « No-show » | « Marquer le no-show ? » + « …Aucune pénalité n'est débitée pendant le pilote : l'empreinte de {amount} sera libérée. » ; CTA danger « Marquer le no-show » |
| Clôture de table (empreinte) | CloseTableModal.tsx | « Clôturer en impayé » / table vide | choix « Empreinte de garantie » : capture (libellé pilote « Pénalité désactivée pendant le pilote — l'empreinte ({amount}) sera libérée ») vs « Libérer l'empreinte (rien débité) » ; pré-sélection intelligente (capture si impayé + hold actif) ; étape de confirmation dédiée avant « capture » |
| Historique de consommation | ReservationHistory.tsx | icône `history` | « Consommation de la réservation » — tickets archivés, lignes annulées barrées, « Encaissé {amount} » |
| Alerte impayé précédent | UnpaidAlert.tsx | 409 `table_has_unpaid_previous` ou `ticketAlert` du PATCH arrived | « Addition impayée du service précédent » + « Montant à régler : {amount} » + 2 actions (Encaisser / Clôturer en impayé) ; non-dismissible tant que non résolue |
| Paiement inline | InlinePayPanel.tsx → StripeTicketPayment | « Encaisser & clôturer » / « Encaisser l'addition précédente » | Stripe Elements réel (clientSecret + publishableKey de POST /pay) |
| Planche QR imprimable | TablesShell.tsx:1561-1609 | « Imprimer les QR codes » | A4, 2 colonnes, QR SVG 180px, « Scannez avec votre téléphone », « grubano.com » |

## PAGE 2 — `/dinein` « Service à table » (APERÇU INERTE, HIDDEN)

1. **Nom utilisateur** : « **Service à table** » (`operator.dinein.title`). **Aucune entrée sidebar dédiée** — « Réservations & Salle » (/tables) reste l'entrée active du rail quand on est sur /dinein (dinein/page.tsx:8-10). Atteignable uniquement par URL directe.
2. **Route** : `/[locale]/dinein` (client component).
3. **Objectif métier** : **aperçu produit (« preview phase 3 ») de la future commande à table temps réel.** RIEN n'est câblé : « ⚠️ APERÇU PHASE-3, NON CÂBLÉ » (page.tsx:5) ; aucun /api/tickets appelé, aucun Stripe (:18-25). Bannière d'honnêteté OBLIGATOIRE dans les deux états (:14-16).
4. **Persona** : restaurant/admin (OPERATOR_FLAT, middleware.ts:36, 252-257).
5. **Données backend** : UNE seule requête réelle — `GET /api/establishments` (décide skeleton / onboarding N=0 / preview, :96-100). Tout le reste est constant : `EXAMPLE_TABLES` (6 tables factices, :57-64) et `EXAMPLE_TICKET` (:67-81).
6-8. **Actions / éditable / read-only** : actions réelles = « Actualiser » (`location.reload()`, :170-172), « Gérer les réservations » → lien réel `/tables` (:229-236), « + Ajouter votre établissement » → `/dashboard/establishments` (état N=0, :146). Tout le reste est visuel. Aucun champ éditable.
9. **CTA** :

| LABEL FR | SURFACE | ACTION | BACKEND | FONCTIONNE | MORT/INERTE |
|---|---|---|---|---|---|
| « Actualiser » | head | location.reload() | — | oui (recharge la même préview) | non |
| « Voir le ticket » | carte table | ouvre modal ticket VISUEL (state local) | — | oui (visuel) | inerte métier |
| « Encaisser » (carte, statut « À encaisser ») | carte table | ouvre le MÊME modal visuel | — | — | **inerte — n'encaisse rien** (:218-221) |
| « Une addition / Partager également / Par personne » | modal | bascule d'affichage local | — | oui (visuel) | inerte métier |
| « Marquer comme servi » | pied de modal | — | — | — | **MORT : `disabled aria-disabled`** (:293-295) |
| « Encaisser » | pied de modal | — | — | — | **MORT : `disabled aria-disabled`** (:296-298) |
| « Gérer les réservations » / « Créneaux & acomptes » | bas de page | Link /tables | — | oui | non |
| « + Ajouter votre établissement » | onboarding N=0 | Link /dashboard/establishments | — | oui | non |

10-12. **Filtres / recherche / pagination — N'EXISTENT PAS.**
13. **États métier (exemples)** : statuts de carte « Commande en cours / Servi / À encaisser » (`operator.dinein.status.*`) — purement illustratifs.
14. **Empty state** : onboarding N=0 (logo + `operator.onb.*` + CTA + 3 étapes, :137-158). Pas d'autre empty state.
15. **Loading** : skeleton `.op-sk` (titre, bannière, strip, 3 cartes 220px) tant que /api/establishments n'a pas répondu (:117-133).
16. **Error** : aucun — un échec de fetch passe silencieusement à la préview (`catch → []` puis onboarding, :99 ; « never a blocking error », :93-94).
17-18. **Success / Disabled** : pas de succès ; disabled = les 2 boutons du pied de modal.
19. **Mobile** : dinein.css — grille tables 3→2 colonnes à **1180px** (:180-182), 1 colonne + head en colonne + strip empilée à **880px** (:183-191). Modal op-* centré (pas de bottom-sheet).
20. **Desktop** : grille `repeat(3,1fr)` (dinein.css:76) max 1520px. Modal max-width 560px.
21. **Composants** : page autonome (Link/formatEuros seulement) ; dinein.css.
22. **APIs** : `GET /api/establishments` uniquement. 23. **Flags** : aucun.
24. **Hardcodes (assumés et étiquetés à l'écran)** : bannière obligatoire « Aperçu — la commande à table en temps réel arrive bientôt » / « Les tickets et paiements ci-dessous illustrent l'interface à venir. Les données affichées sont des exemples, pas un flux en direct. » + tag « Bientôt ». Stats en dur : 6 tables, 22 couverts, 52,40 €, 314,60 € (:187-190). 6 cartes tables en dur (:57-64). Ticket exemple 162,80 € avec « Service (10%, exemple) » (:58-81). Note du modal : « …L'encaissement (paiement Stripe) n'est pas encore actif sur cet aperçu. » (`dinein.ticketNote`). Le taux 10 % est un exemple ; le vrai taux vit dans `Restaurant.dineInServiceRatePct` côté backend et n'est PAS facturé ici (:19-21).
25. **Contrôles morts** : « Marquer comme servi », « Encaisser » (pied de modal, disabled) ; « Encaisser » de carte (visuel sans encaissement). (Anciens compteurs/QR factices « comme si live » supprimés, :28-31.)
26. **Dette** : la page ENTIÈRE est une dette assumée — préview honnête en attendant la phase 3/KDS. Recouvrement fonctionnel : l'addition de table VIVANTE existe déjà dans /tables (onglet Addition) — deux surfaces racontent le « service à table », une réelle, une factice.

## Dette design factuelle (PART 4)

1. **Deux design systems dans la même page /tables** : TablesShell + TicketPanel = Material Symbols + tokens `--op-*` (TablesShell.tsx:34, tables.css) vs CloseTableModal, ReservationHistory, UnpaidAlert, InlinePayPanel, SessionBadge = **lucide-react + Tailwind/shadcn** (`bg-background`, `text-muted-foreground`, `bg-destructive`) — les modals de la zone argent n'ont pas le même look que la page qui les ouvre.
2. **Onglet Addition étroit sur desktop** : `.op-tk{max-width:640px}` (tables.css:284) dans un conteneur de 1520px.
3. **Agenda borné 17h-22h en dur** (TablesShell.tsx:906) : toute réservation déjeuner est invisible dans la grille Agenda alors qu'elle existe en Liste. Granularité 1 h, simple bloc « busy » sans nom/durée.
4. **Plan de salle sans plan** : coordonnées x/y stockées (api/tables/route.ts:56-57) mais rendu = grille uniforme triée par nom. Pas de forme de salle, pas de drag & drop.
5. **Contrôle mort** : faux bouton QR sur tuile libre du plan (TablesShell.tsx:1102).
6. **Texte mensonger restant** : « Le paiement par QR arrivera bientôt. » (TicketPanel.tsx:581) contredit InlinePayPanel.tsx:10-14.
7. **Texte orphelin** : « …réglez l'empreinte depuis la réservation. » (`premium.closure.settleError`) — aucune surface UI de règlement d'empreinte sur la fiche réservation (le dashboard n'appelle plus /deposit/capture|release).
8. **Badge « Service précédent » toujours « Walk-in »** dans UnpaidAlert (prop jamais alimentée), y compris quand l'impayé vient d'une résa nommée.
9. **Empreinte du formulaire ≠ Config** : le formulaire opérateur envoie `depositAmount: 10` en dur (TablesShell.tsx:1701, 1774), ignorant `defaultDepositAmount` configuré dans le même écran.
10. **KPI « Acomptes » basé sur depositPaid** (:614) alors que le cycle nominal du pilote LIBÈRE les empreintes (jamais `depositPaid=true` flag OFF) — le compteur affiche structurellement 0 € pendant le pilote.
11. **Deux labels FR pour le même PATCH « marquer arrivé »** : « Client arrivé » (empreinte) vs « Arrivée » (sans) (TablesShell.tsx:730-760, `actionArrived` vs `actionMarkArrived`).
12. **Pas de deep-link d'onglet** : les 5 onglets sont du state — impossible de partager/rafraîchir sur « Addition ».
13. **CSS mort** : `.rv-workspace` défini (tables.css:133, media :437), utilisé nulle part.
14. **Micro-i18n cassée** : aria-labels littérales « − » « + » (TicketPanel.tsx:506-511), « × » (UnpaidAlert.tsx:79) ; loader littéral « … » (CloseTableModal.tsx:180) ; formats de date/heure en `'fr-FR'` codé en dur (TablesShell.tsx:384, 616, 668-669, 927).
15. **Nombreux styles inline ponctuels** au milieu des classes op-* (TablesShell.tsx:395, 633, 687, 1455, 1508 ; dinein/page.tsx:119-131, 186-190, 205, 294).
16. **Guard 403 non traduit** : l'EmptyState « Accès réservé aux restaurants » en dur dans le TSX (page.tsx:41-44).
17. **/dinein en doublon narratif** : page entière factice coexistant avec l'addition réelle de /tables ; sans entrée de navigation.
18. **Code mort** : fallbacks de tables factices dans CalendarView (:907) et FloorPlanView (:1037-1041), inaccessibles.

## Ce qui N'EXISTE PAS (PART 4 — qu'un designer pourrait supposer)

- **Édition d'une réservation** : aucun moyen de modifier nom/heure/table/couverts après création (le PATCH ne porte que `status` — api/reservations/route.ts:55-62).
- **Annulation d'une réservation depuis /tables** : le serveur accepte `status:'cancelled'` mais AUCUN bouton « Annuler » n'existe dans la Liste/le Plan. (L'annulation opérateur avec libération d'empreinte + email est câblée serveur, sans surface UI ici.)
- **Vue des réservations annulées / no-show** : le filtre « Toutes » les exclut ; aucun onglet « historique du jour ».
- **Vue semaine / mois / datepicker** : navigation jour par jour uniquement.
- **Recherche de réservation / client** ; **pagination**.
- **Suppression ou édition d'une table** (renommer, changer les places, désactiver) : l'API DELETE existe, zéro contrôle UI.
- **Positionnement du plan de salle** (drag & drop, zones, formes) : x/y stockés, jamais rendus.
- **Champs du formulaire de résa** : email, allergies, notes, type (quick/standard/full), précommande, montant d'empreinte personnalisé — tous acceptés par le schéma serveur (api/reservations/route.ts:27-53) mais ABSENTS du formulaire opérateur.
- **Création d'empreinte Stripe côté opérateur** : le POST /deposit n'est appelé que par le flux conso ; une résa saisie au téléphone n'a jamais de PI (le montant 10 € enregistré reste sans empreinte réelle).
- **Capture réelle de pénalité no-show** : `PUNITIVE_CAPTURE_ENABLED` OFF — tout libère.
- **Pénalité distincte de l'acompte** : décision produit « pénalité = 100 % de l'empreinte », un seul montant configurable (TablesShell.tsx:1154-1157).
- **Multi-tables par réservation** : V1 = 1 résa / 1 table, garde de capacité stricte (api/reservations/route.ts:145-155).
- **Rappels / confirmations automatiques au client** (SMS, email de rappel) : seuls emails câblés = annulation-par-le-restaurant et pénalité-no-show-prélevée (api/reservations/route.ts:415-453).
- **Notifications serveur des nouvelles commandes client** : badge « Nouvelle commande client » = état 100 % UI (polling + baseline locale, « There is NO server notification model » — TablesShell.tsx:112-115) ; se perd au rechargement.
- **Coordonnées du client des résas /eat** : masquées volontairement (nom masqué, phone/email null).
- **Remise / TVA / pourboire / partage d'addition sur le ticket réel** : le TableTicket n'a que lignes × prix = sous-total ; le split n'existe qu'en démo /dinein.
- **Impression de l'addition** (ticket papier).
- **Service à table temps réel** : /dinein est un aperçu inerte — pas de KDS dine-in, pas de facturation du service 10 %.

---
# PART 5 — COMMANDES (`/orders`)

1. **Nom utilisateur (labels FR réels)** : titre « **Commandes** » (`messages/fr.json:1247`) ; entrée nav latérale « **Commandes** » (`fr.json:593`), icône Material `receipt_long` (`OperatorShell.tsx:36`) ; aussi dans la bottom-nav mobile (`OperatorShell.tsx:53`). Badge à côté du titre : « **En direct** » avec pastille verte pulsante (`fr.json:1243`, `OrdersClient.tsx:332`, `orders.css:43-45`). Sous-titre : « **Grubano uniquement · {count} actives** » + date longue localisée (`fr.json:1248`, `OrdersClient.tsx:322-334`).
2. **Route** : `/[locale]/orders` — page serveur `app/[locale]/orders/page.tsx`, `dynamic = 'force-dynamic'` (page.tsx:21). Query param : `?order=<id>` ouvre directement la modale détail de cette commande (`page.tsx:129`, `OrdersClient.tsx:96`).
3. **Objectif métier** : console de réception/traitement des commandes consommateur Grubano (livraison + retrait) pour l'établissement COURANT : accepter/refuser une nouvelle commande, la faire avancer dans la machine à états, mettre le restaurant en pause, couper un plat en rupture. Flux quasi temps réel : polling 15 s + carillon Web-Audio.
4. **Persona / permission** : OPERATOR_FLAT (restaurant/admin, `middleware.ts:32-37`). La page re-vérifie la session : sans email → empty state « Connectez-vous… » (`page.tsx:137-143`). **SEC1** : `canPublish = role === 'admin'` (`page.tsx:52`) — un propriétaire peut mettre EN PAUSE mais ne peut PAS remettre en ligne un restaurant jamais approuvé (le serveur applique `decidePublication`, `app/api/restaurants/[id]/pause/route.ts:82-93`, message 403 : « La première mise en ligne de l'établissement doit être validée par un administrateur. »). Anti-IDOR mutation : commande étrangère → 404 (`app/api/orders/[id]/status/route.ts:65-71`).
5. **Données backend** :
   - `Operator` (id, role, brands{name,emoji}, restaurants{id,name,city,isActive}) (`page.tsx:39-50`).
   - `Order` : id, status, fulfillmentType, subtotal, deliveryFee, total, referralCode, consumerId, items (JSON), createdAt — **100 dernières commandes max, plus récentes d'abord** (`lib/orders-feed.ts:113-122`).
   - Filtre fantômes : statuts `awaiting_payment` et `expired` JAMAIS montrés au resto (`orders-feed.ts:12`).
   - `MenuItem` (id, name, available, brand{name,emoji}) pour l'attribution marque des lignes + le picker rupture (`page.tsx:91-102`, `orders-feed.ts:124-127`).
   - Client : identité **MASQUÉE** — `maskCustomerName(operator.name)` uniquement (prénom + initiale) ; email/téléphone/adresse **jamais sélectionnés** (`orders-feed.ts:44-48, 134-141, 200`).
   - La remise est **DÉRIVÉE** : `discount = max(0, subtotal + deliveryFee − total)` — pas de colonne dédiée (`orders-feed.ts:181`).
   - Effet de bord à la lecture : « lazy expiry » — commande carte en `awaiting_payment` depuis > 24 h → passée à `expired` au chargement (`page.tsx:76-87`).
6. **Actions** : avancer la machine à états (`PATCH /api/orders/[id]/status`) ; refuser une commande reçue (→ `cancelled`) ; mettre en pause / réactiver le restaurant (`PATCH /api/restaurants/[id]/pause`) ; basculer un plat en rupture / disponible (`PATCH /api/menu/[id]/availability`) ; filtrer par marque, changer d'onglet, activer/couper le son, débloquer l'audio, « Voir plus » sur l'historique ; changer d'établissement (switcher rendu **uniquement si ≥ 2 établissements** — `EstablishmentSwitcher.tsx:54`) ; répondre à une réclamation (panneau claims, uniquement si `CLAIMS_ENABLED`).
7. **Champs éditables** : **aucun champ de formulaire** sur la page principale — seules bascules d'état (statut commande, isActive restaurant, available plat). Panneau réclamations : un seul champ texte, le motif de refus (textarea, maxLength 1000) (`RestaurantClaimsPanel.tsx:111-115`). **N'EXISTE PAS** : édition d'une commande (articles, montants, adresse), temps de préparation estimé, note interne, remboursement partiel côté resto.
8. **Champs read-only** : tout le contenu commande — n° (`#XXXXXX` = 6 derniers chars de l'id en majuscules, `OrdersClient.tsx:486`), canal (Retrait/Livraison), heure, marques, aperçu articles (2 premiers + « +N », `orders-feed.ts:175-177`), total, articles détaillés (taille, suppléments, « Sans : … », note client), sous-total/remise/frais de livraison/total, code parrainage, nom client masqué avec mention « **Coordonnées protégées par Grubano** » (`fr.json:1297`, `OrdersClient.tsx:561`). Montants via `formatEuros`, **jamais recalculés** (`OrdersClient.tsx:24-25`).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | PERSISTÉ ? | FONCTIONNE ? | MORT ? | FLAG ? | FLOW EXTERNE ? |
|---|---|---|---|---|---|---|---|---|
| « Son activé » / « Son coupé » | En-tête | toggle local + unlock audio | non | non (state React, perdu au reload) | oui | non | — | non |
| « Activer le son » (bannière « Activer le son des commandes ») | Bannière autoplay | resume AudioContext + bip test | non | non | oui | non | — | non |
| « Tout mettre en pause » / « Réactiver » | Rangée contrôle (`OrdersClient.tsx:374-382`) | PATCH /api/restaurants/[id]/pause | oui (Restaurant.isActive) | oui | oui | non | — | non |
| « En attente de validation » (bouton disabled) | Rangée contrôle, owner + resto hors ligne (`OrdersClient.tsx:370-372`) | aucune | non | — | volontairement inerte (disabled) | état informatif | — | non |
| « Réactiver » | Bannière warn « Restaurant en pause » (admin uniquement, `OrdersClient.tsx:409-413`) | même PATCH pause | oui | oui | oui | non | — | non |
| « Toutes » + chips marques (emoji + nom) | Rangée filtres | filtre client-side | non | non | oui | non | — | non |
| « Rupture de stock » (chip pointillée) | Rangée filtres (`OrdersClient.tsx:433-435`) | ouvre modale rupture | non | — | oui | non | — | non |
| « À traiter » / « En cours » / « Terminées » (+ badge compteur) | Onglets | change tab client-side | non | non | oui | non | — | non |
| Carte commande (clic) | Liste | ouvre modale détail | non | — | oui | non | — | non |
| « Refuser » | Carte + modale, statut `received` (`OrdersClient.tsx:713`) | advance → `cancelled` | oui (Order.status ; si payée : claim système + emails + alerte admin) | oui | oui | non | comportement enrichi si CLAIMS_ENABLED | non |
| « Accepter » | Carte + modale, statut `received` (`OrdersClient.tsx:716`) | advance → `preparing` | oui | oui | oui | non | — | non |
| « Marquer prête » | statut `preparing` (`OrdersClient.tsx:725`) | advance → `ready` | oui | oui | oui | non | — | non |
| « Remise au client » | statut `ready` + retrait (`OrdersClient.tsx:742`) | advance → `delivered` (direct, pas de leg livreur) | oui + crédit points fidélité côté serveur | oui | oui | non | — | non |
| « En attente du livreur » / « En attente du client » | statut `ready` (label, pas bouton) (`OrdersClient.tsx:735-738`) | aucune | — | — | informatif | non | — | non |
| « Marquer livrée » | statut `picked_up` (`OrdersClient.tsx:752`) | advance → `delivered` | oui + crédit fidélité | oui | oui | non | — | non |
| « Voir plus » | Bas de l'onglet Terminées (`OrdersClient.tsx:518`) | +20 éléments affichés | non | non | oui | non | — | non |
| « Plat en rupture » | Pied de modale détail (`OrdersClient.tsx:620-625`) | ferme détail, ouvre modale rupture | non | — | oui | non | — | non |
| « Mettre en rupture » / « Réactiver » | Ligne plat, modale rupture (`OrdersClient.tsx:671-678`) | PATCH /api/menu/[id]/availability | oui (MenuItem.available) | oui | oui | non | — | non |
| ✕ (close) | Deux modales | ferme | non | — | oui | non | — | non |
| « Accepter » (réclamation) | Panneau claims | POST /api/claims/[id]/respond {accept} | oui (claim → file admin ; AUCUN refund déclenché ici) | oui | oui | non | CLAIMS_ENABLED | non |
| « Refuser » → « Confirmer le refus » | Panneau claims | POST respond {refuse, reason} | oui | oui | oui | non | CLAIMS_ENABLED | non |
| « Voir la photo » | Panneau claims (`RestaurantClaimsPanel.tsx:102-105`) | ouvre photoUrl nouvel onglet | non | — | oui | non | CLAIMS_ENABLED | lien externe (URL photo) |
| Switcher d'établissement | En-tête (≥2 établissements) | écrit cookie + router.refresh | non (cookie) | oui (cookie durable) | oui | non | — | non |

10. **Filtres** : **marque** (chips « Toutes » + 1 chip par marque, filtre client sur `order.brandNames`, `OrdersClient.tsx:250, 420-431` ; les compteurs d'onglets respectent le filtre marque :249-253) ; **onglets = filtre statut** : `received` → « À traiter » ; `preparing`/`ready`/`picked_up`/statut inconnu → « En cours » ; `delivered`/`cancelled` → « Terminées » (`lib/orders-feed.ts:61-65`). **N'EXISTE PAS** : filtre par canal (livraison/retrait), par date, par montant, par client.
11. **Recherche** : **N'EXISTE PAS** (ni n° de commande, ni client, ni plat).
12. **Pagination** : le backend charge **au plus 100 commandes** (`orders-feed.ts:117`) — au-delà, **aucun accès aux commandes plus anciennes**. « À traiter »/« En cours » : liste complète non paginée. « Terminées » : 20 visibles + « Voir plus » (+20 à chaque clic, `OrdersClient.tsx:72, 258-259, 516-520`). **N'EXISTE PAS** : pagination serveur, infinite scroll, export.
13. **États métier (machine à états serveur — `app/api/orders/[id]/status/route.ts:15-24`)** :
```
received  → preparing | cancelled
preparing → ready | cancelled
ready     → picked_up | delivered | cancelled   (delivered direct = remise retrait)
picked_up → delivered
delivered → (terminal)   cancelled → (terminal)
```
Labels FR (namespace `dashboard.home.liveOrders`, `fr.json:1036-1043`) : Reçue / En préparation / Prête / En route / Livrée / Annulée / « En cours » (statut inconnu). **P0-19** : sur un RETRAIT, `picked_up` et `delivered` s'affichent « **Récupérée** » (`fr.json:1040`, `OrdersClient.tsx:242-245`) et la ligne « Frais de livraison » est masquée dans la modale (:606-608). Effets serveur du passage à `delivered` : crédit points fidélité idempotent (une ligne 'earn' par commande) (`status/route.ts:156-184`). Annulation d'une commande **payée** : demande de remboursement système dans la même transaction (si CLAIMS_ENABLED), email consommateur véridique, alerte email admin (`status/route.ts:102-263`). Aucun remboursement n'est déclenché depuis cet écran. Statuts cachés au resto : `awaiting_payment`, `expired`.
14. **Empty states (FR réels)** : non connecté 🔒 « Connectez-vous pour voir vos commandes » / « Cette page est réservée aux comptes opérateurs. » (`fr.json:1274-1275`) ; pas de restaurant 🏪 « Aucun restaurant rattaché » / « Créez votre fiche restaurant pour recevoir des commandes. » (:1276-1277) ; zéro commande — icône `receipt_long`, « Aucune commande » / « Les nouvelles commandes apparaîtront ici en temps réel. » (:1269-1270) ; filtre/onglet vide — icône `search_off`, « Aucune commande » / « Aucune commande ne correspond à ces filtres. » (:1271-1272) ; modale rupture sans plat : « Aucun plat au menu » (:1306).
15. **Loading** : server component — premier rendu déjà hydraté, **pas de skeleton visible** (classe `.op-sk` définie dans `orders.css:162-163` mais aucun JSX ne la rend). Rafraîchissements (poll 15 s) silencieux (réconciliation React par id, `OrdersClient.tsx:195-209`).
16. **Errors** : échec du chargement serveur → `loadDataSafe` catch → retombe sur l'empty state « Aucun restaurant rattaché » (`page.tsx:118-125, 147-153`) — **même écran qu'une vraie absence de restaurant**. Échec poll : silencieux. Échec transition : toast « Action impossible » + description serveur (ex. « Transition invalide: X → Y ») ou « Erreur réseau, réessayez. » (`order-actions.tsx:86-95`, `fr.json:1055-1057`). Échec pause : toast « Impossible de changer l'état du restaurant » + revert optimiste (:274-286, `fr.json:1263`). Échec rupture : toast « Impossible de mettre à jour le plat » + revert (:303-315, `fr.json:1309`).
17. **Success** : transition → toast « Statut mis à jour » / « Désormais : {status} » + `router.refresh()` (`order-actions.tsx:91-93`, `fr.json:1053-1054`) ; nouvelle commande au poll → toast « Nouvelle commande » ou « {count} nouvelles commandes » + carillon (`fr.json:1315-1316`) ; pause → « Restaurant mis en pause » / « Restaurant réactivé » (:1261-1262) ; rupture → « {name} retiré du menu » / « {name} de nouveau disponible » (:1307-1308). Sonore : carillon 880 Hz Web-Audio à l'arrivée (jamais au premier chargement), **re-carillon en boucle toutes les 25 s tant qu'au moins une commande reste en `received`** (`OrdersClient.tsx:70-71, 230-237`).
18. **Disabled** : boutons d'action de la commande en cours de PATCH (`pendingId` partagé carte/modale, :708, opacité .55 `orders.css:145`) ; bouton pause pendant l'appel (`pausePending`, :376) ; « En attente de validation » disabled permanent pour un owner hors ligne (:370) ; bouton rupture pendant la bascule (`availPending`, :673) ; claims en `loading`/`disabled` pendant la requête (`RestaurantClaimsPanel.tsx:117-132`).
19. **Mobile ACTUEL** : shell 880px (padding 16px + bottom-nav). `@media (max-width:880px)` (`orders.css:238-249`) : en-tête empilé ; stat-strip 3 compteurs empilés avec séparateurs horizontaux ; onglets pleine largeur (flex:1) ; **mini-stepper masqué** sur les cartes ; pied de carte en colonne ; labels du full-stepper réduits à 8.5px. `≤460px` : libellé du toggle son disparaît (icône seule, :250-252). Rangée filtres : scroll horizontal sans scrollbar (:91-92). Modales : `position:fixed` centrées, backdrop padding 20px, `max-height:92vh` scrollable (:169-171) — **pas de bottom-sheet mobile**.
20. **Desktop ACTUEL** : contenu centré max 1520px. Liste : **une seule colonne verticale** quelle que soit la largeur (`orders.css:109`). Modale détail max-width 520px, modale rupture 560px. Stat-strip : 3 stats côte à côte séparées par bordures verticales.
21. **Composants** : `OrdersClient` (île client, monte son propre `ToastProvider`, :76-82) ; `OpOrderActions` (boutons contextuels, :699-759) ; `MiniStepper` / `FullStepper` (:762-826) ; `EstablishmentSwitcher` (lucide) ; `RestaurantClaimsPanel` (Tailwind + `Button` design-system, style visuel DIFFÉRENT du reste) ; `EmptyState`/`ToastProvider` design-system. Iconographie : **Material Symbols** partout, sauf le switcher et le panneau claims (lucide/Tailwind).
22. **APIs** : `GET /api/orders/live?locale=` (poll 15 s onglet visible + refetch au focus, `OrdersClient.tsx:195-218`) · `PATCH /api/orders/[id]/status` (body `{status}`) · `PATCH /api/restaurants/[id]/pause` (body `{isActive}`) · `PATCH /api/menu/[id]/availability` (body `{available}`) · `GET /api/claims/restaurant` + `POST /api/claims/[id]/respond`.
23. **Feature flags** : `CLAIMS_ENABLED` — OFF ⇒ le panneau réclamations n'est **pas monté du tout** (`page.tsx:165-169`) ; gate aussi la création de claim système à l'annulation payée (`status/route.ts:106-140`). Aucun autre flag.
24. **Hardcodes / placeholders** : « bientôt » réel dans la modale rupture : « **Réactivation automatique « jusqu'à demain » : bientôt disponible.** » (`fr.json:1310`, :682-684) — la fonctionnalité n'existe pas (TODO explicite `availability/route.ts:15-16`). Constantes : poll 15 000 ms, re-carillon 25 000 ms, page historique 20, carillon 880 Hz. Dégradé orange en dur `#FF8A3D → #F2570E` répété (`orders.css:70,96,104,146,161`). Panneau claims : couleurs hex en dur hors tokens `--op-*` (`RestaurantClaimsPanel.tsx:73-103`).
25. **Contrôles morts** : **aucun** — chaque CTA a un handler. « En attente de validation » est volontairement disabled (état, pas défaut).
26. **Dette legacy** : clés i18n orphelines `orders.statusAll/statusLive/statusDone` (`fr.json:1265-1267`) et `pausedBadge` (:1258) ; `.oc-cust` définie (`orders.css:125-126`) sans markup ; skeleton `.op-sk` jamais rendu ; panneau claims dans le langage visuel de l'ANCIEN design system ; **double implémentation des boutons d'action** : `OpOrderActions` (op-styled, cet écran) et `OrderStatusActions` (shared, lucide) avec les mêmes transitions (`order-actions.tsx:109-200` vs `OrdersClient.tsx:699-759`).

## Surfaces secondaires de /orders

1. **Modale détail commande** (`OrdersClient.tsx:525-632`) : titre « Commande {ref} », sous-titre canal + date + heure ; timeline FullStepper (5 étapes livraison / 4 retrait, :795-808) ou boîte rouge « Commande annulée » ; bloc client masqué (« Coordonnées protégées par Grubano » / « Client invité ») + « Code parrainage » éventuel ; « Articles » (qté, emoji marque, « Taille », « Suppléments », « Sans », « Note » entre guillemets) ; totaux (« Sous-total », « Remise » en vert si > 0, « Frais de livraison » sauf retrait, « Total ») ; callout info : « **Les montants et le passage d'une étape à l'autre sont calculés et autorisés côté serveur — cette fenêtre les affiche uniquement.** » (`fr.json:1280`) ; pied : « Plat en rupture » + mêmes boutons d'action que la carte. Fermeture : clic backdrop ou ✕.
2. **Modale rupture de stock** (:635-690) : titre « Rupture de stock », desc « Désactivez un plat épuisé : il disparaît du menu commandable. Réactivez-le dès qu'il revient. » ; une ligne par plat (TOUS les plats de TOUTES les marques) : emoji, nom, marque uppercase, pill « Disponible »/« En rupture », bouton « Mettre en rupture »/« Réactiver » ; note « bientôt » (§24). Pas de recherche ni filtre dans cette modale.
3. **Panneau réclamations** (au-dessus de la liste, `CLAIMS_ENABLED` + ≥1 claim en attente) : titre « Réclamations clients », par claim : n° commande, compte à rebours « {hours} h restantes pour répondre » ou « Délai de réponse dépassé — vous pouvez encore répondre… », « Motif », « Montant réclamé », « Détails », « Voir la photo » ; actions « Accepter » (toast « Réclamation acceptée — transmise à Grubano pour décision de remboursement. ») / « Refuser » → textarea « Motif du refus » + « Confirmer le refus » (`fr.json:7163-7183`).

---

# PART 6 — CUISINE (`/prep`, KDS)

1. **Nom utilisateur** : titre « **Cuisine** » (`fr.json:293`), badge « **En direct** » (:321) ; entrée nav « **Cuisine** » (:594), icône `skillet` (`OperatorShell.tsx:37`). **Absente de la bottom-nav mobile.** Sous-titre : date longue localisée sans année (`page.tsx:100-103`).
2. **Route** : `/[locale]/prep` — composant **entièrement client** (`'use client'`, page.tsx:1).
3. **Objectif métier** : KDS (Kitchen Display System) réel — board 3 colonnes des commandes actives (`received` / `preparing` / `ready`) de l'établissement courant, timer réel par ticket (dérivé de `Order.createdAt` serveur), code couleur d'âge, bouton « bump » qui fait avancer la VRAIE machine à états. Écran sans argent (aucun montant, page.tsx:19-20).
4. **Persona** : OPERATOR_FLAT (restaurant/admin). L'API `GET /api/orders/kitchen` re-vérifie session + rôle + périmètre propriétaire (`app/api/orders/kitchen/route.ts:19-21`). Le bump passe par le même `PATCH /api/orders/[id]/status` que /orders.
5. **Données backend** : mêmes `OrderView` que /orders (via `buildOrderViews` partagé), restreints aux statuts cuisine `received|preparing|ready` (`kitchen/route.ts:26-31`, `lib/kds.ts:10-19`). Champs affichés : id (5 derniers chars, `page.tsx:185`), fulfillmentType, createdAt (timer), items (qté, nom, taille, suppléments, exclusions, note). `picked_up`/`delivered`/`cancelled` hors board (filtrés serveur).
6. **Actions** : « **Commencer** » (`received → preparing`, :216-219, `lib/kds.ts:25-29`) ; « **Prêt** » (`preparing → ready`) ; colonne « Prêtes » : AUCUNE action — tag statique « Prêt » (:221-224), la suite (remise/livraison) se fait sur /orders ; « Réessayer » (écran d'erreur initial). **Pas d'undo** : le serveur interdit le retour arrière (page.tsx:17-18) — la clé i18n `kitchen.undo` (« Remettre en cours », `fr.json:307`) n'est plus rendue nulle part.
7. **Champs éditables** : **aucun.** Seule mutation : le statut via bump. **N'EXISTE PAS** : bump par article/ligne, réassignation de station, priorisation manuelle, note cuisine.
8. **Read-only** : tout le ticket — n° `#XXXXX`, badge canal, timer « {minutes} min », articles avec « sans {items} » (`fr.json:322`) en badge rouge, suppléments en badge neutre icône `add`, note client en badge (:195-213).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | PERSISTÉ ? | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|---|---|
| « Commencer » | Ticket colonne « Nouvelles » | PATCH status → preparing (optimiste + resync) | oui | oui | oui | non |
| « Prêt » | Ticket colonne « En préparation » | PATCH status → ready | oui | oui | oui | non |
| « Prêt » (tag vert) | Ticket colonne « Prêtes » (:221-224) | aucune | — | — | informatif, non cliquable (div) | non |
| « Réessayer » | Écran erreur premier chargement (:143-145) | refetch | non | — | oui | non |

10. **Filtres** : **N'EXISTENT PAS** dans le rendu actuel. Les clés i18n `filterAll/filterOpen/filterReady` (`fr.json:300-302`) et le CSS `.kit-filters` (`prep.css:90-94`) subsistent mais aucun JSX ne les rend (legacy du mock).
11. **Recherche : N'EXISTE PAS.** 12. **Pagination : N'EXISTE PAS** (bornée de fait par le take:100 de `buildOrderViews`).
13. **États métier** : colonnes = statuts « Nouvelles » (`received`) / « En préparation » (`preparing`) / « Prêtes » (`ready`) (`fr.json:313-315`, `lib/kds.ts:14`). Code couleur d'âge (display-only, `lib/kds.ts:42-46`) : **fresh** < 10 min (bordure verte), **warn** 10–19 min (ambre), **late** ≥ 20 min (rouge + animation pulse `prep.css:101-102`). Ticket `ready` : bordure verte, opacité .92. Stat « Ticket le plus ancien » en rouge à ≥ 20 min (:163). Badge canal : « Livraison » (moped) / « Click & collect » (shopping_bag) / « Sur place » (table_restaurant) (`fr.json:308-312`, :33). **Fait** : le schéma documente `fulfillmentType = delivery|pickup` uniquement (`prisma/schema.prisma:2226`) ; le cas `dinein` a un style et un label mais aucune commande `Order` observée ne le porte (les additions sur place passent par le modèle Ticket) — fallback vers `pickup` pour un type inconnu (:181).
14. **Empty states (FR réels)** : board vide — icône `soup_kitchen`, « **Aucun ticket en cuisine** » / « **Dès qu'une commande sera acceptée, son ticket apparaîtra ici pour la préparation.** » (`fr.json:303-304`) — NB : le texte dit « acceptée » mais les commandes `received` (pas encore acceptées) apparaissent AUSSI (colonne « Nouvelles »). Colonne vide : encadré pointillé « **Aucun ticket** » (:316).
15. **Loading** : premier chargement — carte icône `skillet` + « **Chargement de la cuisine…** » (:319). Pas de skeleton. Polls suivants silencieux (8 s onglet visible + refetch au focus, :32, 65-71).
16. **Errors** : échec du PREMIER chargement — carte `cloud_off`, « Impossible de charger le tableau de bord » + corps — labels **empruntés au namespace dashboard** `operator.dash.*` (:141-144, `fr.json:638-640`) : le texte parle du « tableau de bord » alors qu'on est en cuisine. Échec d'un poll : silencieux. Échec bump : callout warn `role="alert"` « **Impossible de mettre à jour le ticket. Réessayez.** » (:131-136) + resync serveur ; le callout ne se referme que via un bump réussi (pas de bouton fermer).
17. **Success** : **aucun toast** — le bump réussi = déplacement optimiste de la carte + resync (:83-97). Pas de carillon sonore sur /prep (contrairement à /orders) — **N'EXISTE PAS**.
18. **Disabled** : bouton bump du ticket en cours de PATCH (`disabled={pendingId === o.id}`, :216, opacité .55 `prep.css:163`). Un seul pending à la fois.
19. **Mobile** : `@media (max-width:880px)` — stat-strip empilée ; **board 3 colonnes → 1 colonne** (`prep.css:135-138, 166`), ordre DOM conservé (Nouvelles → En préparation → Prêtes). Pas dans la bottom-nav : accès via le drawer. Boutons bump larges pleine-largeur padding 14px (`prep.css:126`) — dimensionnés doigt/cuisine.
20. **Desktop** : max 1520px. Board `grid-template-columns:repeat(3,1fr)` (`prep.css:156`). Stat-strip 3 compteurs : « Tickets en cours » / « Temps moyen en cuisine » / « Ticket le plus ancien » (`fr.json:297-299`, calculés sur received+preparing uniquement, :112-117). Typo tickets volontairement plus grosse que /orders (n° 21px, timer 19px, articles 15px — `prep.css:105,112,122`).
21. **Composants** : aucun composant partagé de rendu — markup inline dans `PrepPage` (:121-237). Helpers purs : `lib/kds.ts` (colonnes, bumpTarget, elapsedMin, ageOf), types `OrderView` de `lib/orders-feed`. Material Symbols. **Pas de ToastProvider** (erreurs via callout inline).
22. **APIs** : `GET /api/orders/kitchen?locale=` (poll 8 s onglet visible) · `PATCH /api/orders/[id]/status` (le MÊME endpoint que /orders).
23. **Flags** : **aucun**.
24. **Hardcodes** : poll 8 000 ms, tick horloge 10 000 ms, seuils 10/20 min (:32, 76, `lib/kds.ts:42-46`) ; dégradé orange en dur sur `.kt-bump` (`prep.css:126`). Le mock « bientôt » a été retiré (:23) — plus aucun placeholder de données sur l'écran rendu.
25. **Contrôles morts** : **aucun rendu** (les restes CSS/i18n des anciens filtres/undo/bannière subsistent seulement, §26).
26. **Dette legacy** : `prep.css` contient ~40 % de styles pour des surfaces plus rendues (`.preview-banner` :43-47, `.op-onb__*` :49-61, `.kit-filters` :90-94, `.tickets-grid` 4 colonnes :97,133-134, `.kt-undo` :130, `.op-agg-label` :36-37, `.op-sk` :72-73) ; l'en-tête du fichier décrit encore l'« APERÇU HONNÊTE » mock alors que la page est réelle (contradiction interne). Clés i18n `operator.kitchen` orphelines : `aggPrefix`, `previewTitle/previewBody`, `filterAll/filterOpen/filterReady`, `undo`. `bump` et `ready` valent tous deux « Prêt » (:305-306). L'écran d'erreur réutilise les libellés du dashboard. Commentaire nav stale : « Cuisine → /prep (mockup) » (`OperatorShell.tsx:20`) alors que /prep est réel.

## Dette design factuelle (PART 5 + 6)

1. **Deux langages visuels sur /orders** : panneau claims en Tailwind + hex `#F97316`/`#FFF7F3` + Button lucide-era vs tout le reste en `--op-*` + Material Symbols ; switcher d'établissement aussi en lucide.
2. **Deux implémentations des mêmes boutons d'action commande** (op-styled sur /orders, shared lucide sur le dashboard) — même transition, rendus divergents.
3. Dégradé orange `#FF8A3D→#F2570E` dupliqué en dur ≥ 7 fois entre `orders.css` et `prep.css` au lieu d'un token.
4. **Échec de chargement /orders indiscernable de « pas de restaurant »** : même écran 🏪 pour une panne DB et un compte sans fiche.
5. **Texte d'erreur /prep mensonger sur le contexte** : « Impossible de charger le tableau de bord » sur l'écran Cuisine.
6. **Texte empty /prep imprécis** : « Dès qu'une commande sera acceptée… » alors que les `received` apparaissent déjà.
7. CSS/i18n morts volumineux sur /prep + clés orphelines sur /orders.
8. Modales /orders : boîte centrée max 520/560px même sur mobile (pas de bottom-sheet).
9. Doublons de définitions CSS partagées (`op-card`, `op-emptyline`, `op-error__card`, `op-btn-primary`, `stat-strip`, `op-sk`) recopiés avec des valeurs légèrement différentes (stat-strip : label 11px/valeur 22px `orders.css:61-62` vs 12px/26px `prep.css:85-86`).
10. « Prêt » ambigu sur /prep : le bouton d'action et le tag d'état final affichent le même mot.
11. Feedback de succès incohérent pour la même mutation : toast sur /orders, aucun feedback textuel sur /prep.
12. Badge « Sur place » (dinein) stylé et traduit sur /prep et /orders alors que le schéma Order ne connaît que delivery|pickup — état inatteignable dans les données actuelles.

## Ce qui N'EXISTE PAS (PART 5 + 6)

- **Recherche de commande** (n°, client, plat) — nulle part.
- **Historique au-delà des 100 dernières commandes** ; aucun export (CSV/PDF), aucune impression de ticket.
- **Filtres par canal, date, montant** sur /orders ; **tout filtre** sur /prep.
- **Temps de préparation estimé / promis** : aucun champ ETA, aucun choix « prête dans X min » à l'acceptation (clic sec).
- **Motif de refus d'une commande** : « Refuser » annule sans champ motif ni confirmation (contrairement au refus de réclamation).
- **Modale de confirmation** avant refus/annulation — clic immédiat.
- **Remboursement depuis l'écran opérateur** : aucun bouton refund ; l'argent d'une annulation payée part en file d'arbitrage admin.
- **Coordonnées client** (email, téléphone, adresse de livraison) : masquées par conception — seul « Prénom N. » + « Coordonnées protégées par Grubano ».
- **Contact client / chat / appel** — aucun canal.
- **Infos livreur** (nom, position, ETA) : la remise au livreur n'est qu'un label d'attente.
- **Retour arrière de statut** (undo) : interdit par le serveur, aucun contrôle UI.
- **Ajustement de commande** : suppression d'article, remplacement, remise partielle — rien.
- **Bump par article** sur le KDS ; **routage par station** (friteuse/grill…) ; **impression cuisine**.
- **Notification sonore sur /prep** (carillon seulement sur /orders).
- **Réactivation automatique d'un plat en rupture** (« jusqu'à demain ») : annoncée « bientôt », non construite.
- **Horaires d'ouverture / pause programmée** : la pause est un booléen manuel global, pas de planification.
- **Commandes « sur place » (dinein) dans ce flux** : les additions de table passent par un autre modèle (Ticket) et un autre écran.
- **Snooze/mute temporisé du son** : toggle booléen de session, non persisté.
- **Vue agrégée multi-établissements** : les deux écrans montrent UN établissement (cookie) ; pas de vue consolidée.

---
# PART 7 — MENUS (`/menu` + `/promotions`)

> Source unique /menu : `app/[locale]/menu/page.tsx` (2243 lignes, page cliente unique contenant TOUTES les surfaces : tabs, modales, overlay scan), `app/api/menu/*`, `components/menu/*`, `messages/fr.json` (bloc `menu`), `app/[locale]/menu/menu.css`. Labels FR cités = texte réel de fr.json.

## 7.0 Vue d'ensemble structurelle

- **Une seule route** : `/{locale}/menu`. Nom nav : « **Menus** » (`operator.nav.menus`, rendu ligne 544 comme titre H1). Rendue **dans l'OperatorShell** (navy) — contenu nu `<section className="op-menu">` (page.tsx:29-31). Design « CD verbatim v1 », Material Symbols.
- **4 onglets** (page.tsx:584-595, `role="tablist"`) : « **Plats** » (`editor.tabDishes`), « **Catégories** » (`editor.tabCategories`), « **Promos** » (`editor.tabPromos`), « **À adopter** » (`adopt.tab`). Deep-link `?tab=adopt` supporté (:232-234) ; toute autre valeur retombe sur « Plats ». Catégories/Promos ne sont PAS deep-linkables.
- Deep-link **`?brand=<id>`** honoré : ouvre la marque cliquée depuis le hub établissement (:223-234, 316-319). Sans param : première marque de la liste.
- La page monte son **propre `SessionProvider`** (:174-184) — les pages opérateur n'ont pas de provider global.
- Sous-titre : « **{cats} catégories · {dishes} plats** » (`editor.subtitle`, :546).
- **Note de scope multi-établissement** (:552-557) : « **Vous gérez la carte de {name}. Changez d'établissement dans le sélecteur en haut pour éditer une autre carte — les menus ne s'agrègent pas entre établissements.** » (`editor.scopeNote`).
- **Sélecteur de marques** : chips « **Marques de cet établissement** » (`brandsHint`, :566-581), scopées à l'établissement via `Brand.restaurantId` (:400-405) ; **masqué s'il n'y a qu'une marque en scope**. Fallback : si aucune marque ne porte de `restaurantId` (legacy), toutes s'affichent.

## 7.1 Onglet « Plats » (surface principale) — les 26 points

1. **Nom** : « Menus » (H1) ; onglet « Plats ».
2. **Route** : `/{locale}/menu` (+ `?brand=<id>`, `?tab=adopt`).
3. **Objectif** : CRUD complet de la carte d'une marque (plats groupés par catégorie), disponibilité on/off par plat, ajout par IA (photo de plat, import carte) ou manuel.
4. **Persona** : OPERATOR_FLAT (middleware.ts:33) restaurant/admin ; API POST/PUT/DELETE `/api/menu` re-vérifient rôle + propriété de la marque (`app/api/menu/route.ts:84-102, 149-166, 189-207`).
5. **Données backend** : `MenuItem` (prisma/schema.prisma:368-390) : `id, brandId, name, description?, price (Float €), comparePrice?, category (texte libre), calories?, allergens Json[], labels Json[], photos Json[], options Json[], available, isPopular, prepTime?, createdAt, updatedAt, dishAdoptions[]`. Marques via `/api/brands/summary` ; établissements via `/api/establishments` (note de scope). Catégories perso via modèle `Category` (`id, name, position`).
6. **Actions** : changer de marque (chips) ; sélectionner une catégorie (colonne gauche) ; ajouter un plat (Scan IA / Manuel) ; éditer un plat (modale) ; supprimer un plat (bouton dans la modale d'édition) ; toggler la disponibilité (switch par ligne) ; importer une carte par IA (bloc flaggé).
7. **Champs éditables** (via modales — PART 8) : name, description, price, category, calories, allergens, labels, isPopular, photo, available (switch inline).
8. **Read-only en liste** : prix `formatEuros(item.price, locale)` (:807), chips « ★ Best » / labels / « {n} kcal » (:799-805), tag « **Épuisé** » (`editor.soldOut`) sur plat indisponible (:796), miniature photo ou emoji de catégorie (🥗🍝🍰🥤, fallback 🍴 — :123-126).
9. **CTA (onglet Plats)** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND | PERSISTÉ | FONCTIONNE | MORT | FLAG |
|---|---|---|---|---|---|---|---|
| « Scan IA / Ajouter par photo » | carte quick-add (:601-604) | ouvre AIScannerOverlay | non (à ce stade) | — | oui | non | — |
| « Manuel / Créer un plat » | carte quick-add (:605-608) | ouvre DishEditor (nouveau) | non | — | oui | non | — |
| « Ajouter un plat » | header colonne plats + empty state (:766-768, 776-778) | ouvre DishEditor (nouveau) | non | — | oui | non | — |
| « Ajouter une catégorie » | bas colonne catégories (:754-756) | **bascule sur l'onglet Catégories** (pas de modale directe) | non | — | oui | non | — |
| Switch disponibilité (aria « Disponible — visible par les clients » / « Indisponible — masqué ») | chaque ligne plat (:808-816) | optimistic + `PUT /api/menu {id, available}` | oui | oui | oui (⚠️ pas de rollback si le PUT échoue, :444-452) | non | — |
| Icône crayon « Modifier » | chaque ligne plat (:818-821) | ouvre DishEditor (édition) | non | — | oui | non | — |
| Chips marques `{emoji} {name}` | sélecteur (:569-579) | change brandId + refetch items | non | — | oui | non | — |

10. **Filtres** : sélection de catégorie en colonne gauche (filtre client par égalité exacte de nom, :724-726) ; chips de marque. C'est tout.
11. **Recherche** : **N'EXISTE PAS** (aucun input de recherche de plat sur /menu).
12. **Pagination** : **N'EXISTE PAS** — `GET /api/menu?brandId=` renvoie tous les items (`route.ts:66-69`), tri serveur `category asc, name asc`.
13. **États métier d'un plat** : `available` true/false (tag « Épuisé » + ligne grisée `.is-unavailable`), `isPopular` (chip « ★ Best »). Pas d'autre statut (pas de brouillon, pas d'« archivé »).
14. **Empty states** : catégorie vide → « **Aucun plat dans cette catégorie** » + « **Ajoutez votre premier plat via “Scan IA” ou “Manuel” — vos clients le verront dès sa mise en ligne.** » (:771-779). Zéro marque → écran onboarding plein : logo Grubano + « **Aucune marque pour le moment** » / « **Créez votre première marque pour démarrer votre carte et ajouter vos plats.** » / CTA « **Créer une marque** » → `/brands` (:519-535).
15. **Loading** : skeleton structurel 2 colonnes `MenuBuilderFallback` (:186-210), réutilisé pendant session-loading, brands-loading et items-loading.
16. **Error** : fetch items en échec → **silencieux** (le `finally` coupe juste le loading, :270-277 ; **aucun message d'erreur de liste**). Erreurs de mutation : voir modales.
17. **Success** : ajout/édition → la liste se met à jour en place (:463, 479) ; **bannière de conseils photo** (soft warnings modération IA) auto-fermée après 6 s : « **Conseils pour améliorer la photo** » (`photo.warningsTitle`, composant :674-697, timer :490-494). Pas de toast de succès sur l'onglet Plats.
18. **Disabled** : aucun sur la liste (les disabled vivent dans les modales).
19. **Mobile ACTUEL** (menu.css) : ≤1040px colonne catégories 220px, grip et description masqués (:304-309) ; ≤880px workspace 1 colonne, colonne catégories devient **rangée de pills horizontales scrollables** (:310-329) ; ≤460px grilles labels/promos resserrées (:330-333). Media queries viewport (le CD d'origine utilisait des container queries — commentaire :303).
20. **Desktop ACTUEL** : workspace grid **290px | 1fr** (menu.css:69). Ligne plat = grip + thumb 48px + texte + prix mono + switch + crayon.
21. **Composants** : tout local à page.tsx (`DishesWorkspace`, `CategoriesTab`, `PromosTab`, `AdoptTab`, `AIScannerOverlay`, `DishEditor`, `PhotoWarningsBanner`) + `components/menu/MenuPrefillImport.tsx`, `components/menu/DishSheetModal.tsx`, design-system (`Badge, Button, Card, EmptyState, SkeletonList, ToastProvider`) utilisé UNIQUEMENT dans l'onglet Adopter, `StarBadge`.
22. **APIs** : `GET/POST/PUT/DELETE /api/menu` · `GET/POST/PATCH/DELETE /api/menu/categories` · `POST /api/menu/photo` · `POST /api/menu/scan-dish` · `GET/POST /api/menu/scan-card` · `GET /api/brands/summary` · `GET /api/establishments` · `GET /api/dishes/available` · `POST /api/dishes/adopt` · `POST /api/dishes/waitlist` (+ `/accept`, `/decline`) · `GET /api/dishes/[id]/sheet`.
23. **Flags** : `ONBOARDING_AI_MENU_PREFILL_ENABLED` (lib/menu-extract.ts:17) — gate l'import de carte IA ; le composant se sonde via `GET /api/menu/scan-card` et rend `null` si OFF (MenuPrefillImport.tsx:28-38). Rien d'autre.
24. **Hardcodes** : 14 allergènes UE en dur `ALL_EU` (:114) ; 4 labels en dur `ALL_LABELS` = Veggie/Halal/Sans gluten/Épicé avec icônes Material (:116-121) ; 4 catégories par défaut `Entrées/Plats/Desserts/Boissons` (:134) ; emojis de catégorie (:123-126) ; sentinelle « **Non classé** » (:138, serveur categories/route.ts:19) ; **promos 100 % mock** `PROMOS` (« Happy hour », « Bundle midi », « Première commande » — :163-167).
25. **Contrôles morts** : icône **`drag_indicator`** (grip) sur chaque ligne plat ET chaque ligne catégorie (:747, :784) — **aucun handler de drag** dans le fichier : le réordonnancement N'EXISTE PAS, icône purement décorative. Les 4 tuiles « Créer une promo » (voir 7.3).
26. **Dette legacy** : l'onglet Adopter est resté dans l'ancien design shadcn/Tailwind (`DSCard`, `grid sm:grid-cols-2`, :1378-1584) vs CSS `--op-` partout ailleurs ; `MenuPrefillImport` en **lucide-react** (MenuPrefillImport.tsx:5) là où la page impose Material Symbols ; `Category.position` existe côté serveur (categories/route.ts:65) mais aucune UI de réordonnancement.

## 7.2 Onglet « Catégories » (surface + 2 modales)

- Onglet « **Catégories** ». Titre carte : « **Vos catégories** » (`categories.tabTitle`), sous-titre « **Organisez vos plats. Les 4 catégories par défaut sont toujours disponibles ; vos catégories perso peuvent être renommées ou supprimées.** »
- **Objectif** : CRUD des catégories PERSO d'une marque. Les 4 défauts sont des constantes front, non stockées, non éditables (categories/route.ts:12-20 : noms réservés, normalisation accents pour empêcher « ENTREES » de shadow un défaut).
- **Données** : modèle `Category {id, name, position}` par marque + agrégats calculés client (nb plats, nb disponibles par catégorie — :961-966).
- **CTA** :

| LABEL FR | SURFACE | ACTION | BACKEND | PERSISTÉ | FONCTIONNE | MORT |
|---|---|---|---|---|---|---|
| « Nouvelle catégorie » | header (:973-981) | ouvre modale create | `POST /api/menu/categories {brandId,name}` | oui | oui | non |
| « Renommer » (icône crayon) | ligne catégorie perso (:1028-1031) | ouvre modale rename | `PATCH /api/menu/categories {id,name}` — renomme ET migre les plats (transaction, categories/route.ts:159-171) | oui | oui | non |
| « Supprimer » (icône poubelle) | ligne perso (:1032-1036) | ouvre modale confirm | `DELETE /api/menu/categories?id=` — reclasse les plats en « Non classé » puis supprime (transaction, categories/route.ts:204-210) | oui | oui | non |
| « Créer » / « Renommer » (submit) | modale (:1080-1084) | POST/PATCH | oui | oui | oui | non |
| « Supprimer » (confirm, danger) | modale delete (:1117-1121) | DELETE | oui | oui | oui | non |
| « Annuler » ×2 | modales | ferme | non | — | oui | non |

- **Éditable** : uniquement `name` (input, `maxLength={50}`, placeholder « **Ex. Pizzas, Vins, Brunch…** »). Read-only : badges « **Défaut** » (tooltip « Catégorie par défaut — non modifiable ») / « **Perso** », compteur « {n} plats · {avail}/{n} », pastille verte/grise (≥1 plat dispo — :1023-1025). `position` N'EST PAS éditable.
- Défauts non modifiables ; perso renommable/supprimable ; jamais d'empty state (les 4 défauts sont toujours rendus — :954).
- **Erreurs mappées** (:878-884) : 400 → « **Nom invalide ou réservé.** », 409 → « **Cette catégorie existe déjà.** », autre → « **Action impossible — réessayez.** », réseau → « **Impossible de joindre le serveur.** » Modale delete : note « **Les plats associés repasseront en “Non classé”.** » + corps « **La catégorie “{name}” sera supprimée.** »
- **Disabled** : submit disabled si vide ou saving ; boutons de modale pendant saving/deleting ; spinner `progress_activity`.
- Note : la clé i18n `categories.savedToast` (« Catégorie enregistrée ») existe mais **aucun toast n'est émis** — clé morte.

## 7.3 Onglet « Promos » — MOCK INERTE (assumé)

- 3 promos **en dur** (:163-167) affichées sous « **Promotions actives & planifiées** » avec badge « **Aperçu** » (`editor.promoSoon`) et pills « Actif »/« Inactif ».
- Bandeau honnête cliquable vers `/promotions` : « **Aperçu — bientôt. La création et l'activation des promotions se font sur l'écran Promotions.** » (:1139-1143).
- Carte « **Créer une promo** » : 4 tuiles « **Remise %** » / « **Montant fixe** » / « **Flash deal** » / « **Plat du chef** » (:1167-1177) — **boutons sans onClick = 4 contrôles morts**.
- ⚠️ La gestion réelle des promotions vit sur `/promotions` (§7.6) — **jamais les mêmes données** que ce mock.

## 7.4 Onglet « À adopter » (recettes créateurs) — résumé factuel

- Titre « **Recettes créateurs à adopter** », sous-titre « **Ajoute une recette de créateur à ta carte** », note « **Engagement minimum {days} jours · tu peux retirer librement une recette qui ne décolle pas.** » (fallback 60 j — :1393, 1601).
- Catalogue `GET /api/dishes/available` : cartes avec photo/🍽️, badge cuisine, « **Par {name}** », « **{count} abonnés** », étoiles créateur, pitch « **Le créateur touche {pct} %, tu gardes le reste.** », bloc business (fiche technique : difficulté, temps total, diet tags, allergènes, « **Prix conseillé {price} €** », « **coût matière estimé {cost} €** », « **Marge brute estimée ~{pct} %** », « **Estimations fournies par le créateur.** »).
- **Champ éditable unique** : « **Ton prix de vente (€)** » (input number, défaut = prix suggéré, :1504-1508).
- CTA selon état : « **Adopter** » (`POST /api/dishes/adopt {creatorDishId, brandId, sellingPrice}`) ; offre d'exclusivité live → « **Exclusivité disponible — expire dans {hours} h** » + « Adopter »/« Refuser » (`/api/dishes/waitlist/accept|decline`) ; ville prise → « **Déjà pris dans ta ville** » + « **M'inscrire sur la liste d'attente** » (`POST /api/dishes/waitlist`) ; adoptée → boutons disabled « **Adoptée** »/« **Déjà à ta carte** » + « **Voir la fiche technique** » → `DishSheetModal`.
- **DishSheetModal** (components/menu/DishSheetModal.tsx) : fiche technique verrouillée serveur (`GET /api/dishes/[id]/sheet`, 200 seulement pour adoptants/créateur/admin), scaling portions ×N client, allergènes proéminents, bouton « **Imprimer** », état absent « **Cette recette n'a pas encore de fiche technique…** ».
- Empty states : « **Aucune recette à adopter** » / « **Les recettes approuvées par les créateurs apparaîtront ici.** » ; sans marque : « **Crée d'abord une marque pour adopter des recettes créateurs.** »
- **Divergence de ton** : cet onglet tutoie (« Ajoute », « tu gardes ») alors que le reste de /menu vouvoie.
- Toasts réels via `ToastProvider` local (seul onglet à en avoir).

## 7.5 Bloc « Importer ma carte (photo ou PDF) » — MenuPrefillImport (flaggé OFF par défaut)

- **Auto-gating** : sonde `GET /api/menu/scan-card` → rend `null` si `ONBOARDING_AI_MENU_PREFILL_ENABLED !== 'true'` (MenuPrefillImport.tsx:28-38 ; scan-card/route.ts:41).
- Quand ON : carte au-dessus de la liste, sous-titre « **L'IA lit votre carte et vous propose une liste de plats. Vous relisez, corrigez et confirmez — rien n'est enregistré avant votre confirmation.** »
- Flow : « **Choisir un fichier** » (JPG/PNG/WebP/GIF/PDF, 8 Mo max) → `POST /api/menu/scan-card {fileBase64, mediaType}` → LLM extrait un brouillon → revue ligne par ligne avec 3 inputs éditables « **Nom** » / « **Prix (€)** » / « **Description** » + bouton « **Retirer** » → « **Confirmer et ajouter à la carte** » = boucle de `POST /api/menu` par plat (MenuPrefillImport.tsx:81-89 — **la catégorie envoyée vient du draft IA, non éditable dans la revue**) → « **{count} plat(s) ajouté(s) à votre carte.** » ou « **{ok} ajouté(s), {failed} à vérifier (prix manquant ?).** » · « **Importer une autre carte** » reset.
- Erreurs : « Format non pris en charge… », « Fichier trop volumineux (8 Mo maximum). », 429 → « Limite IA atteinte. Réessayez plus tard. », générique « L'analyse a échoué. Réessayez. » ; vide → « Aucun plat détecté. Essayez une photo plus nette, ou ajoutez vos plats manuellement. »

## 7.6 `/promotions` — « Promotions » (l'écran RÉEL des promotions, hors sidebar)

1. **Nom utilisateur** : « **Promotions** » (`promotions.title`) ; sous-titre = compteur pluriel « Aucune promotion active / 1 promotion active / # promotions actives » (`operator.promotions.activeCount`, PromotionsManager.tsx:340).
2. **Route** : `/{locale}/promotions` — `app/[locale]/promotions/page.tsx:10-12` (coquille mince) → tout vit dans `components/promotions/PromotionsManager.tsx` (client, 718 lignes). OperatorShell navy (`--op-*`, Material Symbols — page.tsx:6-7). **Entrée de navigation quasi nulle** : pas d'entrée sidebar ; seul lien = bandeau de l'onglet Promos de /menu (menu/page.tsx:1139).
3. **Objectif métier** : créer et piloter les promotions du restaurant. Le MOTEUR applique côté serveur au checkout « la meilleure pour le client, jamais de cumul » (`lib/promotions.pickBestPromotion`, Manager:19-22) — l'écran ne recalcule RIEN.
4. **Persona/permission** : OPERATOR_FLAT (middleware.ts:33) → restaurant/admin. L'API scope à l'**établissement COURANT** (`resolveEstablishmentScope`, `app/api/restaurant/promotions/route.ts:49-60`) : marques et promos de cet établissement uniquement, ownership STRICT (route.ts:7-9, 138, 228).
5. **Données backend** : `GET /api/restaurant/promotions` → `{promotions, brands, menuItems}` ; `Promotion {id, brandId, name, type, discount, conditions?, startDate, endDate, active, usageCount}` (Manager:24-31). `conditions` : `minOrderEur?, itemIds?, channels?, thresholdEur?, rewardKind?, rewardPct?, freeItemIds?`. En plus : `GET /api/restaurant/campaigns` (invitations de campagne chef, best-effort, jamais bloquant, Manager:105-109).
6. **Actions** : créer une promo (modale) ; activer/désactiver (toggle soft) ; lancer une promo flash « Anti-gaspi » (modale dédiée) ; rejoindre une campagne chef (modale opt-in) ; changer d'onglet.
7. **Champs éditables (modale « Créer une promotion »)** — labels FR réels (Manager:490-608 ; Zod serveur route.ts:31-42) :
   - « **Marque** » (select, rendu **seulement si >1 marque**, Manager:490-497)
   - « **Nom de l'offre** » (placeholder « Ex. Happy lundi −15% » ; 2..80 caractères serveur)
   - « **Type** » : segment 4 options « **Pourcentage** » / « **Montant fixe** » / « **2e article** » / « **Palier** » (Manager:506-518)
   - Valeur : « **Remise (%) — entre 1 et 90** » (percent), « **Remise (€)** » (fixed, >0), « **Remise sur le 2e article (%)** » (second_item 1..90) — masquée pour « Palier »
   - Palier : « **Seuil du palier (€)** » + choix « **Remise %** » / « **Article offert** » → « **Remise au palier (%)** » OU « **Article(s) pouvant être offert(s)** » (hint : « **Le moins cher de cette sélection présent au panier sera offert.** »)
   - « **Début** » / « **Fin** » (datetime-local ; fin > début obligatoire, Manager:185)
   - « **Commande minimum (€, optionnel)** »
   - « **Plats ciblés (optionnel)** » (checklist des plats de la marque ; hint « **Sans sélection, la remise s'applique à toute la commande…** »)
   - « **Canaux (optionnel — les deux par défaut)** » : « **Livraison** » / « **Click & collect** »
8. **Read-only (carte promo)** : badge de type « Réduction automatique »/« Offre » (Manager:284-287), badge de statut, nom, valeur formatée (« −{value}% », « 2e à −{value}% », « dès {amount} »), pill « Dès {amount} », fenêtre « Du {start} au {end} », marque + « {count} plat(s) ciblé(s) » + canaux, usage « {count} commande(s) » (Manager:437-457).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND | PERSISTÉ | FONCTIONNE | MORT | FLAG |
|---|---|---|---|---|---|---|---|
| « Nouvelle promotion » | header (Manager:350-352) | ouvre modale create | non | — | oui | non | — |
| « Anti-gaspi » | header, bouton ghost (Manager:343-349) | ouvre modale « Stock à écouler » | non | — | oui | non | — |
| « Créer la promotion » | modale (Manager:622-624) | `POST /api/restaurant/promotions` | oui | oui | oui | non | — |
| pause/play (title « Désactiver »/« Réactiver ») | chaque carte non expirée (Manager:462-469) | `PATCH {id, active}` — toggle soft | oui | oui | oui | non | — |
| « Lancer la flash » | modale anti-gaspi (Manager:674-676) | POST type percent, fenêtre maintenant→péremption (Manager:244-256) | oui | oui | oui | non | — |
| « Participer » | carte invitation campagne (Manager:381) | ouvre modale opt-in | non | — | oui | non | — |
| « Confirmer » | modale opt-in (Manager:707-709) | `POST /api/restaurant/campaigns {campaignId, discountPct}` | oui | oui | oui | non | — |
| « Annuler » ×3 | 3 modales | ferme | non | — | oui | non | — |
| onglets « Actives / Programmées / Terminées » | tablist (Manager:403-419) | regroupement CLIENT des promos déjà chargées | non | — | oui | non | — |

10. **Filtres** : les 3 onglets avec compteurs (statut dérivé des dates réelles + flag `active` : `statusOf` Manager:136-142 — active/paused → « Actives », scheduled → « Programmées », ended → « Terminées »). C'est tout.
11. **Recherche : N'EXISTE PAS.** 12. **Pagination : N'EXISTE PAS** (tout chargé d'un coup).
13. **États métier d'une promo** : 4 badges — « **Active** » (verte, en cours) / « **Désactivée** » (fenêtre valide mais toggle off) / « **À venir** » (démarre plus tard) / « **Expirée** » (carte grisée `.is-ended`, plus de toggle — Manager:288-294, 437, 459-460).
14. **Empty states** : 0 promo → « **Aucune promotion pour l'instant** » + « **Aucune promotion. Créez votre première offre — elle s'appliquera automatiquement aux commandes éligibles.** » + CTA « **Créer votre première promotion** » (Manager:388-399). Onglet vide → « **Aucune promotion dans cette catégorie** » (Manager:422-428).
15. **Loading** : squelette `op-sk` (head + tabs + 4 cartes 200px, Manager:305-321).
16. **Error** : carte `cloud_off` « **Impossible de charger vos promotions.** » + « Réessayer » (Manager:322-333) ; erreurs de formulaire dans un callout rouge (message serveur ou « Action impossible — réessayez. »).
17. **Success** : ligne toast verte `op-promo-toast` — « **Promotion créée — elle s'applique dès maintenant aux commandes éligibles.** » / « **Promotion mise à jour.** » / « **Promo anti-gaspi lancée ✓** » / « **Vous participez à la campagne ✓** » (Manager:363-365) ; **aucun auto-dismiss** (pas de setTimeout — le toast reste jusqu'au prochain événement).
18. **Disabled** : submit disabled tant que le formulaire est invalide ou saving (`formValid` Manager:186, `agValid`:237-238, `optInValid`:116) ; spinner `progress_activity` pendant le save.
19. **Mobile** : `promo-grid` 2 colonnes → 1 ≤1040px ; segment de types 4→2 colonnes ≤880px (promotions.css:65, 163-171).
20. **Desktop** : grille 2 colonnes de cartes ; modales `op-modal` (create) / `op-modal narrow` (anti-gaspi, opt-in).
21. **Composants** : tout local à PromotionsManager.tsx ; grammaire `op-*` + Material Symbols.
22. **APIs** : `GET/POST/PATCH /api/restaurant/promotions` · `GET/POST /api/restaurant/campaigns`.
23. **Flags** : **AUCUN**.
24. **Hardcodes** : remise anti-gaspi par défaut « 30 » % (heuristique assumée, Manager:83) ; nom de la promo anti-gaspi figé « **Anti-gaspi — stock à écouler** » (`agName`) ; canaux limités à `delivery|pickup` (Manager:600).
25. **Contrôles morts** : aucun détecté.
26. **Faits notables / dette** :
   - **L'édition d'une promo existante N'EXISTE PAS** (ni nom, ni valeur, ni dates) — seul le toggle actif/inactif ; **la suppression N'EXISTE PAS non plus**, par doctrine (« promotions are NEVER deleted — orders reference them », route.ts:15-16).
   - **Aucun code promo** : l'endpoint ne renvoie volontairement pas `code` → l'UI ne rend jamais de badge « Code promo » (Manager:281-283).
   - 2 notes d'honnêteté systématiques : « **Les promotions ne se cumulent pas… seule la plus avantageuse pour le client est retenue automatiquement au moment du paiement (côté serveur).** » (`bestOfNote`, page + modale) et « **La remise est à votre charge : le client paie le prix remisé, la commission Grubano se calcule sur le montant payé.** » (`docFinance`).
   - Un opérateur voit deux écrans « promotions » aux contenus différents (mock /menu vs réel /promotions).

---

# PART 8 — CRÉATION / ÉDITION DE PLAT

## 8.1 Modale « Manuel » — DishEditor (page.tsx:1942-2242)

1. **Nom** : « **Ajouter un plat** » (création, `editor.modalNewTitle`) / « **Modifier le plat** » (édition, `editor.modalEditTitle`).
2. **Surface** : modale `op-modal wide` (max-width **580px**, menu.css:210) sur backdrop cliquable-pour-fermer, au-dessus de `/menu`.
3. **Objectif** : créer/éditer un `MenuItem` d'une marque possédée.
4. **Permission** : mêmes gates que la page ; POST/PUT re-vérifient rôle restaurant/admin + `Brand.operatorId` (route.ts:84-102 ; PUT anti-IDOR avec 404 cross-tenant, route.ts:160-167).
5. **CHAMPS EXACTS réellement édités par le formulaire** (labels FR réels) :

| Champ | Label FR | Contrôle | Validation Zod serveur (route.ts:17-40) |
|---|---|---|---|
| `name` | « Nom du plat » | input texte, placeholder « Nom du plat » | string 1–100, requis |
| `description` | « Description » | textarea 3 lignes | string ≤500, nullish |
| `price` | « Prix (€) » | input number step 0.1 min 0 | number > 0 requis — **Float en euros**, jamais en cents |
| `calories` | « Calories » | input number min 0 | int > 0, nullish |
| `category` | « Catégorie » | **chips exclusives** = 4 défauts + catégories perso | string trim 1–50 (texte libre côté serveur) |
| `allergens` | « Allergènes (UE 14) » | 14 chips multi-select (Gluten, Lactose, Œuf, Soja, Arachide, Fruits à coque, Poisson, Crustacés, Mollusques, Céleri, Moutarde, Sésame, Sulfites, Lupin — page.tsx:114) | array de strings, défaut [] |
| `labels` | « Labels » | 4 tuiles multi-select : Veggie (eco), Halal (verified), Sans gluten (grain), Épicé (local_fire_department) | array de strings, défaut [] |
| `isPopular` | « Best-seller » / sous-texte « Mis en avant auprès des clients » | switch | boolean, défaut false |
| photo | « Ajouter une photo » / « Changer la photo » (`photo.pick`/`photo.change`) | zone cliquable → file picker `image/jpeg,image/png,image/webp`, **8 Mo max** vérifié client (:1986-1993) ET serveur | `imageBase64` + `mediaType` (enum jpeg/png/webp) optionnels |

   - `available` n'est **pas** dans la modale (uniquement le switch de la liste ; la création POST le met à `true` par défaut).
6. **Read-only dans la modale** : preview photo (objectURL ou URL Cloudinary carrée `c_fill,g_auto,ar_1:1`).
7. **CTA** :

| LABEL FR | ACTION | BACKEND | PERSISTÉ | FONCTIONNE |
|---|---|---|---|---|
| « Enregistrer » / « Enregistrement… » | création : `POST /api/menu` (photo incluse dans le payload — atomique, :2040-2064) ; édition : si nouvelle photo → `POST /api/menu/photo` d'abord (persiste `photos=[url]` via `menuItemId`), puis `PUT /api/menu` du reste (:2067-2092) | oui | oui | oui |
| « Supprimer ce plat » (rouge, édition seulement, :2222-2227) | `DELETE /api/menu?id=` | oui | oui | oui — **⚠️ AUCUNE confirmation** : un clic supprime immédiatement (:496-500) |
| « Annuler » | ferme | non | — | oui |

8. **Pipeline photo serveur** (lib/dish-photo.ts) : modération Claude vision **fail-closed** (rejet dur : contenu inapproprié, non-nourriture, logo concurrent/watermark/texte incrusté — prompt lignes 27-41) → upload Cloudinary signé → URL carrée. Rejet = plat NON créé (route.ts:110-120 « never a photoless dish silently »). Avertissements doux (flou, sombre, cadrage) = non bloquants, remontés dans la bannière « **Conseils pour améliorer la photo** ».
9. **Erreurs photo mappées** (:2019-2034) : 422 → « **Photo refusée. {reason}** », 400 → « **Photo invalide (format ou taille). Acceptés : JPG, PNG, WebP — 8 Mo max.** », 503 → « **Service photo temporairement indisponible…** », 500 → « **Échec de l'envoi de la photo.** », réseau → « **Impossible d'envoyer la photo — vérifiez votre connexion.** » Affichées en callout danger dans la modale.
10. **Disabled** : « Enregistrer » disabled si `saving || !d.name` (:2232) — le nom est le SEUL champ requis côté client.
11. **Responsive** : la modale garde 580px max ; grille labels 4→3→2 colonnes (menu.css:252, 328, 331) ; paire Prix/Calories en `op-field-row`.

## 8.2 Overlay « Scan IA » — AIScannerOverlay (page.tsx:1609-1938), plein écran, 3 étapes

- **Étape upload** : « **Choisissez une photo du plat** » + « **L'IA détecte automatiquement le nom, les ingrédients, les allergènes et les calories.** » · CTA « **Choisir une photo** » (accept `image/*` — GIF accepté au scan) ; avec preview : « **Changer** » / « **Analyser avec l'IA** ».
- **Étape analyse** : spinner + « **L'IA analyse…** » + 5 stages séquencés côté client toutes les 900 ms (purement cosmétiques, :1740-1744) : « Détection du plat… », « Identification des ingrédients… », « Calcul nutritionnel… », « Recherche allergènes… », « Génération de la fiche… ». Appel réel : `POST /api/menu/scan-dish {imageBase64, mediaType}` → Claude vision renvoie `{name, description, ingredients, allergens, calories_min/max, category, suggested_labels}` (scan-dish/route.ts:19-33). 429 → « **Limite IA atteinte, réessaie plus tard.** »
- **Étape résultat** : kicker « **Généré par IA** » / « **Vérifier la fiche** » — mêmes champs que la modale Manuel (Nom, Description, Catégorie chips, Prix, Calories, Allergènes, Labels), pré-remplis. **Prix pré-calculé par une formule en dur** : `(calories_min/100 + 7)` arrondi au dixième (:1782-1784) ; calories = moyenne min/max. `ingredients` renvoyé par l'IA **n'est PAS affiché ni stocké**. CTA « **Ajouter au menu** » / « **Enregistrement…** » = `POST /api/menu` avec la photo scannée incluse (GIF converti en jpeg pour le stockage, :1804-1814) ; erreur → « **Échec de l'ajout, réessayez.** » ou message serveur. Bouton retake `restart_alt` (« Reprendre »).
- Overlay `op-scan` : fond chrome sombre, contenu max-width 520px (menu.css:265).

## 8.3 Divergence formulaire ↔ schéma API (facts)

Champs **acceptés par Zod POST/PUT** (`route.ts:17-40`) mais **sans AUCUN contrôle dans l'UI** : `comparePrice` (prix barré), `options` (array Json), `prepTime`, `photos` (array — l'UI n'en gère qu'une). Un designer ne doit pas supposer d'UI pour eux.

## Dette design factuelle (PART 7 + 8)

- **Grips de drag décoratifs** : `drag_indicator` rendu sur chaque plat (:784) et chaque catégorie (:747) sans aucun handler — suggère un réordonnancement qui n'existe pas.
- **4 tuiles « Créer une promo » sans onClick** (:1173-1177) — boutons morts assumés dans un onglet mock.
- **Onglet Adopter dans un autre design system** que le reste de la page : shadcn/Tailwind `DSCard/DSButton` + classes `grubano-*` (:1396-1581) vs CSS `--op-` partout ailleurs ; et **tutoiement** (adopt.*) vs vouvoiement (editor.*, categories.*, aiCard.*).
- **MenuPrefillImport en lucide-react** (MenuPrefillImport.tsx:5) alors que la page bannit lucide au profit de Material Symbols (commentaire :24-25).
- **Suppression de plat sans confirmation** (:2223 → deleteItem :496-500) alors que la suppression de catégorie a une modale de confirmation (:1091-1125) — deux patterns pour la même classe d'action destructive.
- **Toggle disponibilité optimiste sans rollback** ni feedback d'échec (:444-452).
- **Échec de chargement de la liste silencieux** (:270-277 : pas d'error state pour GET /api/menu).
- **Deux styles d'inputs number pour le prix** : `op-input mono` step 0.1 dans les modales (:2159) vs Input DS step 0.01 dans l'import carte (MenuPrefillImport.tsx:143-146) vs input Tailwind brut step 0.1 dans Adopter (:1504-1508).
- **Clé i18n morte** `menu.categories.savedToast`.
- **« Ajouter une catégorie » de la colonne gauche ne crée rien** : il change juste d'onglet (:623, 754-756) — deux étapes là où le header de l'onglet Catégories ouvre directement la modale.
- **Prix suggéré du scan = formule arbitraire en dur** `calories/100 + 7 €` (:1783) présentée comme pré-remplissage IA.
- Labels FR en dur dans le source (`CATEGORIES_FR_LABELS`, :846-853) doublonnant les clés i18n — deux sources pour le même texte.
- Media queries viewport là où le design CD spécifiait des container queries (commentaire menu.css:303).
- **/promotions sans entrée de navigation** hormis le bandeau de /menu — l'écran réel des promotions est quasi introuvable ; toast succès sans auto-dismiss.

## Ce qui N'EXISTE PAS (PART 7 + 8 — à ne pas supposer)

- **Recherche de plats** sur /menu ; **pagination** ; **tri manuel/drag-and-drop** (plats ET catégories, malgré les grips et le champ `Category.position` en base).
- **Variantes / tailles / options de plat** : la colonne `options Json` existe en base et dans le Zod mais **aucune UI** nulle part.
- **Prix barré** (`comparePrice`), **temps de préparation** (`prepTime`) : colonnes + Zod, zéro UI.
- **Multi-photos** : `photos` est un array mais l'UI gère exactement UNE photo (remplacée, jamais galerie).
- **Disponibilité planifiée** (« jusqu'à demain ») : explicitement non construit (availability/route.ts:15-16, TODO assumé) — le toggle est un booléen simple.
- **Taxes / TVA par plat, remises par plat, coût matière du plat propre** (le coût n'apparaît que sur les recettes créateurs, déclaratif).
- **Duplication de plat, archivage, brouillons, historique de modifications**.
- **Création de promotions depuis /menu** (mock ; le réel est sur /promotions).
- **Édition/suppression d'une promotion existante** sur /promotions (seul le toggle actif/inactif) ; **codes promo** (jamais rendus).
- **Réordonnancement ou position des catégories** (position stockée, jamais éditée).
- **Édition de la catégorie d'un plat lors de l'import carte IA** (la revue n'expose que Nom/Prix/Description).
- **Toast de succès** après création/édition de plat (seule la bannière photo apparaît, seulement s'il y a des warnings).
- La route `PATCH /api/menu/[id]/availability` existe mais est consommée par **/orders** (OrdersClient.tsx:298), pas par /menu (qui passe par PUT /api/menu).

---
# PART 9 — STOCK (`/stocks`)

> ⚠️ CONTEXTE STRUCTUREL À COMPRENDRE AVANT DE DESSINER (vaut pour PART 9 + 10) : il existe **DEUX systèmes fournisseurs parallèles et non connectés** :
> 1. **Legacy `/suppliers`** — modèles Prisma `Supplier`/`SupplierProduct`/`SupplierOrder` : annuaire PARTAGÉ entre tous les opérateurs (pas de colonne operatorId, `app/api/suppliers/route.ts:10-12`), prix en **euros Float**, commande = e-mail nodemailer au fournisseur.
> 2. **Marketplace B2B `/marketplace/suppliers`** — modèles `SupplierProfile`/`SupplierCatalogItem`/`SupplyOrder` : vrais comptes fournisseurs de la plateforme, prix en **cents Int**, commandes scopées par opérateur, state machine, paiement Stripe gaté.
> Ces deux mondes ne partagent AUCUNE donnée. Le bouton « Découvrir » du legacy renvoie vers le marketplace (`app/[locale]/suppliers/page.tsx:327`).

## 9.1 Page `/stocks` — « Stock »

| Point | Fait |
|---|---|
| 1. Nom utilisateur | « **Stock** » (`fr.json:4`), sous-titre « **Suivez votre inventaire et vos niveaux d'alerte** » (fr.json:5). Entrée sidebar « Stock » + onglet bottom-nav mobile « Stock » (`OperatorShell.tsx:39,55`) |
| 2. Route | `/[locale]/stocks` (`app/[locale]/stocks/page.tsx`, client component) |
| 3. Objectif métier | Journal d'inventaire par article : quantité, unité, seuil d'alerte, DLC ; mise à jour manuelle (modal) ou en langage naturel (assistant IA Claude) |
| 4. Persona/permission | Opérateur `restaurant` (ou `admin`). API scopée aux marques que l'opérateur POSSÈDE (`app/api/stocks/route.ts:29-40`, anti-IDOR) |
| 5. Données backend | `StockItem` : `id, brandId, name, quantity(Float), unit, minThreshold(Float), dlc(DateTime?), lastUpdated`. **AUCUN champ prix/valeur** sur StockItem |
| 7. Champs éditables (modal) | Nom (`fieldName`, requis), Marque (`fieldBrand` — champ TEXTE LIBRE, pas un select de marques !), Quantité (number, step any), Unité (select kg/g/L/mL/u), Seuil de stock bas (number), DLC (date) — page.tsx:326-362 |
| 8. Read-only | En liste : tout. Le statut (OK/Bas/Rupture) est CALCULÉ côté client : `urgent` si qty ≤ 40 % du seuil, `soon` si qty < seuil, sinon `ok` (page.tsx:26-30) |
| 10. Filtres | 3 pills avec compteurs : « **Tous** » / « **Stock bas** » / « **Rupture** » (page.tsx:204-213, fr.json:14-16). Pas de filtre par marque, pas de filtre DLC |
| 11. Recherche | **N'EXISTE PAS** |
| 12. Pagination | **N'EXISTE PAS** — l'API renvoie tout, trié brandId puis nom (route.ts:37-40) |
| 13. États métier | Pills : `ok`→« OK » (vert), `soon`→« Bas » (classe `low`), `urgent`→« Rupture » (classe `out`) (page.tsx:33, fr.json:22-26). ⚠️ « Rupture » s'affiche dès qty ≤ 40 % du seuil, **même si qty > 0** |
| 14. Empty state | « **Aucun article suivi** » + « **Ajoutez votre premier article pour commencer à suivre votre inventaire et recevoir des alertes de stock bas.** » + CTA « Ajouter un article » (page.tsx:150-172, fr.json:32-33). Filtre vide : « **Aucun article dans ce filtre** » |
| 15. Loading | Skeletons `op-sk` : 4 stats + barre IA + 4 lignes (page.tsx:55-73) |
| 16. Error | Carte `op-error__card` icône cloud_off : « **Impossible de charger le stock** » + corps + « Réessayer » (page.tsx:76-89, fr.json:34-36) |
| 17. Success | Après save modal : fermeture + refetch silencieux (page.tsx:146). Modal IA : encadré vert « Stock mis à jour » (page.tsx:444-448) — voir contrôle mensonger ci-dessous |
| 18. Disabled | « Enregistrer » disabled pendant `saving` (:366) ; bouton envoi IA pendant `loading` (:454) |
| 19. Mobile | ≤900px : la table disparaît, remplacée par des cartes `stock-cards` empilées (stocks.css:163-166) ; ≤880px : stats en colonne, filtres pleine largeur (:167-177). Bottom-nav du shell |
| 20. Desktop | Table 5 colonnes grid `2.2fr 1fr 1fr 1.4fr 110px` : Article / Quantité / Seuil bas / Statut / (action) (stocks.css:92-94). Pas de max-width propre (celle du shell) |
| 21. Composants | Aucun composant partagé : tout local à page.tsx (StockLoaded, StockRow, StockCard, StockModal, AIChatModal, ForecastLine) + classes CSS `op-*`, Material Symbols |
| 22. APIs | `GET /api/stocks` (liste), `POST /api/stocks` (upsert : create si pas d'id, update sinon), `POST /api/stocks/update-ai` (parsing IA) |
| 23. Flags | Aucun |
| 24. Hardcodes | Stat « **Valeur totale du stock** » = pill « **Bientôt** » en dur, aucune donnée (page.tsx:189-192, fr.json:6,10 — StockItem n'a pas de prix). Marque par défaut du formulaire = **`'Gnocchi Bar'` en dur** (page.tsx:105,126). Unités du select en dur (kg/g/L/mL/u). Prévision IA côté serveur : consommation journalière EN DUR `{kg:0.7, L:0.5, g:500, mL:300, u:5}` (`app/api/stocks/update-ai/route.ts:30`) |
| 25. Contrôles morts | (a) bouton « **Réappro./Réapprovisionner** » qui ouvre en réalité le modal Ajuster (icône panier trompeuse, page.tsx:274-279) ; (b) assistant IA qui affiche « Stock mis à jour » sans jamais rien sauvegarder (ci-dessous) |
| 26. Dette legacy | Le champ « Marque » du modal envoie un `brandId` texte libre — si le texte ne correspond pas à un id de marque possédée, l'API répond 403 « Marque non autorisée » (route.ts:74-75) **sans que l'UI n'affiche cette erreur** (le `saveItem` n'inspecte pas la réponse, page.tsx:135-147 : échec silencieux) |

### 9.1a Modal « Ajouter un article » / « Ajuster : {name} »
- Même composant `StockModal` pour les deux modes (page.tsx:307-374). Titres : « **Ajouter un article** » / « **Ajuster : {name}** » (fr.json:37-38).
- CTA : « **Annuler** » (ghost, ferme) · « **Enregistrer** » / « **Enregistrement…** » (primary, POST /api/stocks, persisté ✅).
- Backdrop cliquable pour fermer. ⚠️ **Aucun affichage d'erreur** : si le POST échoue (403/400/500), le modal se ferme comme un succès (page.tsx:135-147).
- **N'EXISTE PAS** : suppression d'un article de stock (aucun DELETE dans l'API ni dans l'UI), historique des mouvements, photo, prix d'achat, fournisseur lié, code-barres.

### 9.1b Modal « Assistant Stock » (IA)
- Ouvert par la barre « Copilote » : placeholder « **Ajoute 10 kg de farine, ou demande ce qui est en stock bas…** », tag « **Copilote** » (page.tsx:196-201, fr.json:11-12). ⚠️ La barre ressemble à un champ de saisie mais c'est un **bouton** qui ouvre le modal.
- Chat : message d'accueil « **Bonsoir 👋 Comment se sont passés les stocks ce soir ? Décrivez en langage naturel.** » (fr.json:53), bulles user (fond zest) / IA, indicateur « **Analyse en cours…** ».
- Envoie `{text}` à `POST /api/stocks/update-ai` (Claude parse le texte en items JSON, `update-ai/route.ts:16-27`).
- 🔴 **CONTRÔLE MENSONGER** : le client n'envoie **jamais de `brandId`** (page.tsx:394) → l'API répond en mode **preview** (« Fournissez un brandId pour sauvegarder », `update-ai/route.ts:80-86`) et **N'ÉCRIT RIEN EN BASE** ; mais comme la réponse contient `updated_items`, le client affiche « **Compris. Mis à jour : {summary}.** » + l'encadré vert « **Stock mis à jour** » (page.tsx:396-399, 444-448, fr.json:54,58). L'utilisateur croit avoir mis à jour son stock ; à la fermeture le refetch montre des quantités inchangées.
- Erreurs honnêtes : 429 quota IA « **Limite IA atteinte, réessaie plus tard.** », 422 « **Impossible d'analyser ce texte. Exemple : "poulet 3 kg, riz 5 kg, sauce tomate terminée"** » (route.ts:65-70) ; côté client « **Je n'ai pas pu interpréter les quantités. Reformulez.** » / « **Erreur de connexion. Réessayez.** ».

---

# PART 10 — FOURNISSEURS (`/suppliers` + `/marketplace/*`)

## 10.1 Page `/suppliers` — « Commander » (legacy, 4 sous-surfaces en machine à états)

Un seul fichier client (`app/[locale]/suppliers/page.tsx`) avec 4 modes : `choice` (défaut) → `list` (catalogue comparatif) / `order` (annuaire → bon de commande) / `self` (liste de courses). **Pas d'URL par mode** — le back navigateur quitte la page entière.

| Point | Fait |
|---|---|
| 1. Nom | « **Commander** » (fr.json:63) ; entrée sidebar « Fournisseurs » (`OperatorShell.tsx:40`) |
| 2. Route | `/[locale]/suppliers` (une seule URL pour les 4 écrans) |
| 3. Objectif | Réapprovisionnement legacy : commander chez ses fournisseurs (bon de commande e-mail) ou générer une liste de courses |
| 4. Persona | restaurant/admin (middleware + `resolveEstablishmentScope` sur les APIs) |
| 5. Données | `Supplier` (name, specialty, zone, leadTime String, minOrder Float €, rating Float, apiEnabled, phone, email) + `SupplierProduct` (name, unit, price Float €, stock 'in'/'low'/'out'). ⚠️ Annuaire **PARTAGÉ plateforme** — pas de scoping opérateur (`api/suppliers/route.ts:10-12`) |
| 22. APIs | `GET /api/suppliers` (liste + produits), `POST /api/suppliers/orders` (crée `SupplierOrder` + envoie l'e-mail « Bon de commande Grubano » via nodemailer si le fournisseur a un e-mail ET `SMTP_PASS` est défini, `api/suppliers/orders/route.ts:88-128`) |
| 23. Flags | Aucun |

### Surface A — Sélecteur de méthode (mode `choice`, page.tsx:127-151)
Titre « Commander », sous-titre « **Comment souhaitez-vous restocker ?** ». 3 grandes tuiles-boutons :
| Label FR | Action | Effet |
|---|---|---|
| « **Catalogue intelligent** » / « Comparez prix & dispo entre fournisseurs » | mode `list` | fetch /api/suppliers, écran comparatif |
| « **Un seul fournisseur** » / « Choisissez parmi vos partenaires vérifiés » | mode `order` | annuaire |
| « **Je m'en occupe** » / « Liste de courses imprimable / WhatsApp » | mode `self` | liste de courses **mockée** |

### Surface B — Annuaire (mode `order`, `SupplierList`, page.tsx:190-335)
- Titre « Fournisseurs », sous-titre « **Vos fournisseurs et le marketplace Grubano** ». Lien retour « Changer de méthode ».
- **Onglets** : « **Mes fournisseurs** » (avec compteur) / « **Découvrir** » (:233-240). ⚠️ « Mes fournisseurs » = en réalité TOUS les fournisseurs de la plateforme (annuaire partagé).
- **Recherche** : « **Rechercher un fournisseur…** » — filtre client sur nom+spécialité+zone (:215-220).
- **Filtres catégorie** : « Tous / Frais / Sec / Boissons / Emballages » — filtre par **substring du token** ('frais', 'sec'…) dans nom/spécialité/zone (:206-218) — pas de champ catégorie en base.
- **Cartes fournisseur** : avatar initiales + dégradé déterministe (7 dégradés en dur, :47-55), nom, chips spécialité/zone, badge « API » si `apiEnabled`, note ★ `rating.toFixed(1)` (⚠️ rating seedé, jamais recalculé — aucun système d'avis fournisseur), « Délai de livraison » (String libre ex « 24h »), « Commande minimum » (€), « Produits » (count). CTA « **Commander** » (→ bon de commande) et « **Voir la boutique** » (⚠️ ouvre le catalogue comparatif GLOBAL de tous les fournisseurs, pas la boutique de CE fournisseur — :309).
- Empty : « **Aucun fournisseur enregistré** » + « **Parcourez le marketplace pour en ajouter et passer votre première commande.** » + CTA « Parcourir le marketplace » (→ bascule l'onglet Découvrir). Filtre vide : « **Aucun fournisseur ne correspond** ».
- **Onglet « Découvrir »** = carte honnête « **Découvrir de nouveaux fournisseurs** » + CTA « **Parcourir le marketplace** » → **lien vers `/marketplace/suppliers`** (:318-332). Aucune liste ici.
- Pagination : **N'EXISTE PAS**.

### Surface C — Bon de commande mono-fournisseur (`PartnerOrderForm`, page.tsx:339-454)
- Titre = nom du fournisseur ; sous-titre spécialité + « **Livraison sous {lead}** ». Retour « Autre fournisseur ».
- Carte « **Bon de commande** » : chaque produit dispo (stock ≠ 'out') avec prix €/unité et **stepper −/+** (quantité initiale **pré-remplie à 1 pour TOUS les produits**, :342-344 — le total démarre non nul).
- Pied : « **Total estimé** » (€, somme client) + CTA « **Envoyer via {channel}** » où channel = 'API' si apiEnabled, sinon 'Email' si email, sinon 'WhatsApp' (:446). ⚠️ Quel que soit le canal affiché, le backend fait la même chose : crée le `SupplierOrder` et envoie un E-MAIL si possible — **aucune intégration API ni WhatsApp n'existe**. Disabled si sending ou total = 0.
- Erreurs : « **Aucun produit sélectionné** » / « **Erreur lors de l'envoi. Réessayez.** » (callout danger).
- Succès : carte check verte « **Commande confirmée** » + « **Email envoyé au fournisseur** » ou « **Commande enregistrée** » + « Livraison sous {lead} » + montant + CTA « **Retour aux stocks** » (→ /stocks).
- ⚠️ Le `total` est envoyé PAR LE CLIENT et stocké tel quel (`createSchema` accepte `total`, route.ts:22-26) — pas de recalcul serveur (contraste avec le marketplace).

### Surface D — Catalogue comparatif (`CatalogView`, page.tsx:458-649)
- Titre « **Catalogue** », sous-titre « **Meilleur prix par produit** ». Produits groupés PAR NOM à travers les fournisseurs ; par groupe : compteur « {n}/{m} dispo », offres cliquables (radio) affichant fournisseur + « En stock »/« Stock faible »/« Rupture » (disabled) + délai + prix €/unité ; sélection → stepper « Quantité ».
- Barre panier si sélection : « **Total · {count} fournisseur(s)** », montant €, « {count} produit(s) », CTA « **Envoyer les commandes** » → **un POST /api/suppliers/orders PAR fournisseur** (:506-531).
- Succès : « **Commandes envoyées** » + « **Bons de commande envoyés par email · {count} fournisseur(s)** » + total + « Retour aux stocks ».
- Empty : « **Aucun produit fournisseur configuré** ».

### Surface E — Liste de courses (`SelfShoppingList`, page.tsx:653-708)
- Titre « **Liste de courses** », sous-titre « **Triée par catégorie** ».
- 🔴 **CONTENU 100 % EN DUR** : catégories et articles mockés (« Frais : Poulet mariné · 4 kg, Champignons · 2 kg », « Sauce : Sauce butter chicken · 3 L », « Riz basmati · 5 kg », « Boîtes kraft · 100 u ») — :656-661. Aucune donnée du stock réel, aucune mention d'exemple.
- Cases à cocher purement locales (state, non persisté).
- 🔴 **2 BOUTONS MORTS** : « **WhatsApp** » et « **Imprimer** » n'ont **aucun onClick** (:700-701).
- Lien « **Après les courses : mettre à jour** » → /stocks (fonctionne).

### Tableau CTA consolidé /suppliers
| Label FR | Surface | Action | Backend ? | Persisté ? | Fonctionne ? | Mort ? |
|---|---|---|---|---|---|---|
| Catalogue intelligent / Un seul fournisseur / Je m'en occupe | choice | change de mode | GET /api/suppliers (2 premiers) | — | ✅ | non |
| Rechercher / chips catégorie | annuaire | filtre client | non | non | ✅ | non |
| Commander | carte fournisseur | ouvre bon de commande | non | — | ✅ | non |
| Voir la boutique | carte fournisseur | ouvre catalogue GLOBAL | non | — | ⚠️ trompeur | non |
| Parcourir le marketplace | Découvrir | Link /marketplace/suppliers | — | — | ✅ | non |
| Envoyer via API/Email/WhatsApp | bon de commande | POST /api/suppliers/orders | SupplierOrder + e-mail | ✅ | ✅ (mais canal affiché ≠ réel) | non |
| Envoyer les commandes | catalogue | POST ×N | idem | ✅ | ✅ | non |
| WhatsApp | liste courses | — | — | — | ❌ | **MORT** |
| Imprimer | liste courses | — | — | — | ❌ | **MORT** |
| Retour aux stocks / Après les courses | confirmations | Link /stocks | — | — | ✅ | non |

Responsive /suppliers : grille cartes 3 col → 2 col ≤1180px → 1 col ≤880px (suppliers.css:67,216-224) ; bon de commande max-width 640px ; confirmation max-width 440px centrée.

## 10.2 Page `/marketplace` — hub « Marketplace » (HIDDEN)

| Point | Fait |
|---|---|
| 1. Nom | « **Marketplace** », sous-titre « **Intégrations & partenaires** » (fr.json:6533-6534) |
| 2. Route | `/[locale]/marketplace` (server component) |
| 3. Objectif | Hub de liens : approvisionnement fournisseurs + (flag) prestataires + intégrations « bientôt » |
| 6. Actions | 2 liens réels : « **Approvisionnement fournisseurs** » / « Commander auprès des fournisseurs de la plateforme » → `/marketplace/suppliers` ; « **Prestataires de services** » (visible SEULEMENT si `PRESTATAIRE_ENABLED=true`, gate serveur sans fuite, page.tsx:28,48-57) → `/marketplace/prestataires` |
| 24. Hardcodes | Section « **Intégrations** » : **Lydia, SumUp (Paiement), Mailchimp (Marketing) en dur**, lignes inertes avec badge « Bientôt » + note « **Les connexions aux plateformes de livraison et de paiement arrivent bientôt.** » (page.tsx:17-21, 61-77) — honnête, aucune intégration n'existe |
| 26. Dette | 🔴 **Le hub n'a AUCUN lien entrant** : ni la sidebar, ni /more, ni le dashboard ne pointent vers `/marketplace` (grep exhaustif : seuls des liens vers /marketplace/suppliers, /marketplace/orders existent). Accessible uniquement en tapant l'URL |

## 10.3 Page `/marketplace/suppliers` — « Fournisseurs » (découverte B2B)

| Point | Fait |
|---|---|
| 1. Nom | « **Fournisseurs** » / « **Commandez auprès des fournisseurs de la plateforme.** » (fr.json:6581-6582) |
| 2. Route | `/[locale]/marketplace/suppliers` (client) |
| 3. Objectif | Découvrir les fournisseurs ACTIFS de la plateforme et ouvrir leur catalogue |
| 4. Persona | restaurant/admin (API 401/403, `api/marketplace/suppliers/route.ts:16-19`) |
| 5. Données | `SupplierProfile` visibles = `status='active' AND marketplaceCoherencePending=false` (route.ts:26) + leurs `SupplierCatalogItem` `available=true`. Champs : companyName, city, categories(Json), deliveryZones, minimumOrderCents, leadTimeDays, items |
| 6. Actions | Recherche produit, clic carte → catalogue, lien « **Mes commandes** » → /marketplace/orders |
| 11. Recherche | « **Rechercher un produit…** » — filtre les FOURNISSEURS qui offrent un produit correspondant + affiche jusqu'à 3 correspondances inline avec prix (page.tsx:49-55, 122-131). Pré-rempli par `?q=` (pont réappro) |
| 12. Pagination | **N'EXISTE PAS** |
| 14. Empty | « **Aucun fournisseur actif pour le moment.** » ; recherche vide : « **Aucun fournisseur ne propose « {q} ».** » |
| 15/16. Loading/Error | Spinner Loader2 centré ; carte « **Impossible de charger les fournisseurs.** » |
| 19/20. Responsive | `max-w-4xl` centré, grille cartes `sm:grid-cols-2` (page.tsx:58,97) |
| 21. Composants | ⚠️ **Ancien DS** : lucide-react + `Card`/`Badge` design-system + Tailwind `grubano-*` — PAS le DS navy `op-*` |
| 22. API | `GET /api/marketplace/suppliers` |
| 24. Cartes | companyName, ville (MapPin), jusqu'à 4 badges catégorie (labels via `supplier.cat*`, ex « Produits frais »), « {count} produits », « {days} jours » (délai), « Min. {amount} » si minimum > 0. **N'EXISTE PAS** : note ★, photo/logo image, tri, filtre zone/catégorie (route.ts:11 « Zone/category filtering is a later refinement ») |

## 10.4 Page `/marketplace/suppliers/[id]` — catalogue fournisseur (acheteur)

| Point | Fait |
|---|---|
| 1. Nom | En-tête = nom du fournisseur ; lien retour « Marketplace » (fr.json:6507) |
| 2. Route | `/[locale]/marketplace/suppliers/[id]` (server page + `SupplierCatalogClient`) |
| 3. Objectif | Parcourir le catalogue, composer un panier (quantités), atteindre le minimum de commande |
| 4. Persona | restaurant/admin par SESSION (`callerOperator`, page.tsx:58-59) ; fournisseur non visible/inexistant → « **Fournisseur introuvable** » / « **Ce fournisseur n'est pas disponible ou n'existe plus.** » |
| 5. Données | SupplierProfile (même gate de visibilité) + TOUS ses catalogItems (les `available=false` affichés grisés « **Indisponible** », non ajoutables, SupplierCatalogClient.tsx:158-171) |
| 6. Actions | Recherche produit (client), chips catégorie réelles du catalogue, ajout/stepper par article, « Voir le panier » |
| 9. CTA clé | « **Voir le panier** » — disabled tant que panier vide OU minimum non atteint ; persiste les quantités en **localStorage** (`lib/supply-cart`, clé par fournisseur) et navigue vers `…/panier`. **AUCUNE commande créée ici, aucun argent** (page.tsx:19-24) |
| 13. États | Barre panier sticky : total (cents formatés), barre de progression vers `minimumOrderCents` réel, « **Encore {montant} pour atteindre le minimum** » / « **Minimum de commande atteint** » / « **Prêt à commander** » / « **Ajoutez des produits** » (client.tsx:192-213, fr.json:6525-6529) |
| 14. Empty | Catalogue vide : « **Ce fournisseur n'a pas encore publié son catalogue** » + « **Revenez bientôt : {supplier} prépare sa liste de produits.** » ; filtre : « **Aucun produit ne correspond** » |
| 18. Badge zone | « **Livre dans votre zone** » affiché UNIQUEMENT si une ville des restaurants de l'acheteur matche textuellement une deliveryZone (normalisation accents/casse, page.tsx:37-42, 107-119) |
| 21. Composants | DS navy `op-*` + Material Symbols (contraste avec 10.3) |
| 24. Omissions documentées dans le code | ★ note/avis fournisseur, heure limite de commande, photo/SKU d'article : **N'EXISTENT PAS** (page.tsx:26-29). Vignette article = icône `nutrition` générique |

## 10.5 Page `/marketplace/suppliers/[id]/panier` — « Votre panier »

| Point | Fait |
|---|---|
| 1. Nom | « **Votre panier** » / « **Vérifiez votre commande avant de l'envoyer au fournisseur** » (fr.json:6242-6243) |
| 2. Route | server page + `CartClient` |
| 5. Données | Serveur : fournisseur (gate visibilité) + items `available=true` (prix autoritaires). Client : quantités localStorage. Jointure affichage seulement |
| 6/7. Éditable | Steppers par ligne + suppression ligne (icône poubelle « Retirer ») ; **jour de livraison** : 5 chips de dates consécutives calculées `aujourd'hui + leadTimeDays` (aucun jour désactivé — pas de modèle de fermetures fournisseur, CartClient.tsx:64-84) ; « **Note au fournisseur » (facultatif)** textarea maxLength 1000, placeholder « **Ex. : livraison à l'arrière, sonner à l'interphone « Cuisine », palette reprise…** » |
| 9. CTA | « **Passer la commande** » → `POST /api/marketplace/orders` avec UNIQUEMENT `{supplierProfileId, lines:[{catalogItemId, quantity}], notes, desiredDate}` — le serveur re-snapshotte les prix en cents, recalcule le total et re-vérifie le minimum (`api/marketplace/orders/route.ts:66-93`). Persisté ✅ (`SupplyOrder` + `SupplyOrderLine` snapshots). Disabled si vide/sous le minimum/en cours. « **Payer en ligne** » = bouton **VERROUILLÉ INERTE** (`disabled`, icône cadenas) + note « **Paiement en ligne bientôt disponible** » (CartClient.tsx:318-321, fr.json:6265-6266) |
| 13. États | Récap fournisseur avec badge « **Minimum atteint** » / « **Minimum non atteint** » ; ligne « **Reste à atteindre {montant}** » si sous le minimum |
| 14. Empty | « **Votre panier est vide** » + « **Ajoutez des produits depuis le catalogue d'un fournisseur pour composer votre commande.** » + CTA « **Parcourir les fournisseurs** » |
| 16. Error | Fournisseur disparu : « **Fournisseur indisponible** » / « **Ce fournisseur n'est plus disponible. Votre panier n'a pas pu être ouvert.** » ; échec POST : « **Impossible d'envoyer la commande. Réessayez.** » (ou message serveur ex « Commande inférieure au minimum du fournisseur ») |
| 17. Success | « **Commande envoyée** » + « **Votre commande a été envoyée à {supplier}.** » + total serveur + CTA « **Voir mes commandes** » / « **Retour au marketplace** » ; le panier localStorage est vidé |
| 19/20. Responsive | Desktop : grille 2 colonnes `1fr 340px` (récap sticky) ; ≤940px : 1 colonne (panier.css:34,110-114) |
| 24. Notes honnêtes | Encadré « **Règlement selon vos conditions habituelles avec le fournisseur. La commande lui est envoyée immédiatement.** » (fr.json:6267). **N'EXISTE PAS** : ligne TVA, frais de livraison, commission visible côté acheteur (la commission 1 % vit sur le payout fournisseur, page.tsx:21) |

## 10.6 Page `/marketplace/orders` — « Mes commandes fournisseurs »

| Point | Fait |
|---|---|
| 1. Nom | « **Mes commandes fournisseurs** » / « **Suivez vos commandes d'approvisionnement et recommandez en un clic** » (fr.json:6189-6190) |
| 2. Route | server page + `OrdersClient` (liste + vue détail dans le même composant, sans URL de détail) |
| 4. Persona | restaurant/admin ; non-opérateur → « **Accès réservé aux restaurateurs** » (page.tsx:79-91). Données scopées `operatorId` session |
| 5. Données | `SupplyOrder` (status, totalCents, desiredDate, createdAt) + `supplierProfile` (companyName, city, email, phone) + `SupplyOrderLine` snapshots (nameSnapshot, unitSnapshot, quantity, unitPriceCents, lineTotalCents) |
| 10. Filtres | Onglets avec compteurs « **Toutes / Envoyées / Confirmées / En préparation / Livrées** » + select période « **30 derniers jours / 90 derniers jours / Cette année** » (OrdersClient.tsx:274-289). ⚠️ Pas d'onglet pour Annulée/Refusée (visibles seulement dans « Toutes ») |
| 12. Pagination | **N'EXISTE PAS** (tout l'historique chargé serveur) |
| 13. États métier | `placed`→« Envoyée », `confirmed`→« Confirmée », `preparing`→« En préparation », `delivered`→« Livrée », `cancelled`→« Annulée », `declined`→« Refusée » (fr.json:6213-6218). N° court `#XXXXXX` dérivé de l'id (pas de numérotation séquentielle) |
| 14. Empty | « **Aucune commande pour l'instant** » + CTA « **Découvrir les fournisseurs** » ; filtre : « **Aucune commande dans ce filtre** » |
| 15. Loading | Skeletons (gate d'hydratation) |
| 20. Desktop liste | Table grid `150px 1.4fr 96px 80px 110px 130px` : Commande / Fournisseur / Articles / Total / Statut / (Voir) (supply-orders.css:38-39) ; ligne cliquable → détail |
| 19. Mobile | ≤760px : lignes recomposées `1fr auto` avec mini-ligne articles·total (supply-orders.css:118-128) ; détail 2 colonnes → 1 colonne ≤1000px |
| Détail | En-tête avatar initiales+dégradé (6 dégradés en dur), « **Passée le {date} · {heure}** », « **Livraison prévue {date}** » si desiredDate ; carte « **Articles commandés** » (lignes snapshot ×qty, prix unitaire, sous-totaux, Total) ; carte « **Suivi de la commande** » = timeline 4 étapes (Commande envoyée → Confirmée par le fournisseur → En préparation → Livrée) — **seule l'étape « envoyée » a un horodatage réel (createdAt)** ; les autres affichent « En attente » / « Prévue {date} » — aucun confirmedAt/deliveredAt n'est stocké (page.tsx:24-28). Annulée/refusée : timeline 2 étapes |
| 9. CTA détail | « **Recommander** » : recharge les lignes dans le panier localStorage et navigue vers `…/panier` (re-validation serveur, OrdersClient.tsx:125-130) ✅. « **Contacter le fournisseur** » : simple `tel:` ou `mailto:` (masqué si ni téléphone ni e-mail) ✅. « **Annuler la commande** » : visible seulement si statut `placed` (state machine `canRestoCancel`, lib/marketplace.ts:110-112) ; `window.confirm` natif « **Annuler cette commande ? Cette action est irréversible.** » puis `PATCH /api/marketplace/orders/[id]` `{status:'cancelled'}` — après confirmation fournisseur → 409 serveur ✅ |
| 24. Absences | **N'EXISTE PAS** côté acheteur : bouton « Payer » (le GET renvoie pourtant `paymentStatus`/`chargedCents` « Slice 5c », route.ts:29 — non affichés) ; facture PDF ; note/avis sur la commande ; recherche |

## 10.7 Page `/marketplace/reorder` — « À réapprovisionner » (🔴 ORPHELINE)

| Point | Fait |
|---|---|
| 1. Nom | « **À réapprovisionner** » / « **Vos produits en stock bas — commandez chez un fournisseur.** » (fr.json:6612-6613) |
| 2. Route | `/[locale]/marketplace/reorder` (client) |
| 3. Objectif | Pont stock-bas → découverte fournisseurs : liste READ-ONLY des StockItems sous seuil, chaque ligne ouvre `/marketplace/suppliers?q={nom}` |
| 5. Données | `GET /api/marketplace/reorder` : StockItems des marques de l'opérateur (scoping session correct, contrairement au legacy /api/stocks) filtrés sous seuil, triés du plus critique (route.ts:22-38) ; mêmes seuils 40 %/100 % que /stocks (lib/marketplace.ts:122-131) |
| 9. CTA | Par ligne : « **Chercher chez les fournisseurs** » = **Link de navigation** (aucun POST). Empty : « **Parcourir tous les fournisseurs** » |
| 13. Pills | « **Critique** » (rouge) / « **Bas** » (orange) + « seuil {min} {unit} » + « DLC {date} » (⚠️ date ISO brute non formatée : la string ISO est injectée telle quelle, reorder/page.tsx:163) |
| 14. Empty | « **Aucun produit en stock bas. 👍** » (état heureux) |
| 24. Hardcodes | Stat « **Total estimé** » = « **Bientôt** » (pas de prix sur StockItem, page.tsx:132-135) ; note honnête en bas : « **Ces articles sont sous leur seuil d'alerte… aucune commande n'est passée ici…** » (fr.json:6580) |
| 25/26. 🔴 | **AUCUN lien entrant** : ni /stocks, ni le shell, ni le dashboard ne pointent vers /marketplace/reorder. Le bouton « Réappro. » de /stocks ouvre le modal Ajuster au lieu de ce pont. URL directe uniquement |

## 10.8 Prestataires (adjacent, flag OFF par défaut)
- `/marketplace/prestataires` (« **Prestataires de services** » / « **Trouvez un prestataire par métier et par zone.** ») et `/marketplace/prestataire-missions` (« **Mes demandes** ») existent mais la page serveur fait `notFound()` si `PRESTATAIRE_ENABLED !== 'true'` (défaut OFF, prestataires/page.tsx:17, lib/prestataire-account.ts:22-23). Découverte par métier (Électricité, Plomberie, HACCP, Nettoyage…) + zone ; services « sur devis » — **aucun prix, panier ni paiement**. Construite dans l'ANCIEN DS (lucide + Tailwind grubano-*), comme 10.3. La carte du hub /marketplace est masquée serveur quand OFF (aucune fuite).

## Flags récapitulatifs (PART 9-10)
| Flag | Défaut | Effet |
|---|---|---|
| `SUPPLIER_CONNECT_ENABLED` | OFF | `POST /api/marketplace/orders/[id]/pay` répond 403 « Paiement indisponible » (pay/route.ts:25-27). Aucun bouton acheteur ne l'appelle de toute façon (« Payer en ligne » inerte) |
| `PRESTATAIRE_ENABLED` | OFF | Carte hub + pages prestataires 404 |
| (aucun flag) | — | /stocks, /suppliers, découverte + panier + commandes marketplace : toujours actifs |

## Dette design factuelle (PART 9-10)

1. 🔴 **Assistant IA stock mensonger** : « Compris. Mis à jour : … » + « Stock mis à jour » alors que rien n'est persisté (pas de brandId → mode preview serveur) — stocks/page.tsx:394-399,444-448 vs update-ai/route.ts:80-86.
2. 🔴 **2 boutons morts** « WhatsApp » et « Imprimer » (liste de courses, aucun onClick) — suppliers/page.tsx:700-701.
3. 🔴 **Liste de courses 100 % mockée** présentée sans mention d'exemple — :656-661.
4. 🔴 **`/marketplace` (hub) et `/marketplace/reorder` orphelins** : aucun lien entrant (grep exhaustif). La sidebar n'a pas d'entrée Marketplace.
5. **Label « Réappro./Réapprovisionner »** sur les lignes en rupture de /stocks ouvre le modal AJUSTER (icône panier trompeuse) au lieu d'un flux de commande — :274-279 ; le vrai pont existe (/marketplace/reorder) mais n'est pas branché.
6. **« Envoyer via API/WhatsApp »** : canal affiché sans intégration — le backend n'envoie que des e-mails (api/suppliers/orders/route.ts:88-128).
7. **« Voir la boutique »** ouvre le catalogue global, pas la boutique du fournisseur cliqué — :309.
8. **Onglet « Mes fournisseurs »** = annuaire PARTAGÉ de toute la plateforme (Supplier sans operatorId).
9. **Deux DS divergents dans le même flux** : découverte (10.3) et prestataires en ancien DS (lucide, Tailwind grubano-*) ; catalogue/panier/commandes/réappro en DS navy op-*. L'acheteur change de langage visuel en cliquant une carte.
10. **Deux patterns pour la même action « commander à un fournisseur »** : flux legacy euros/e-mail (/suppliers) et flux marketplace cents/state-machine (/marketplace), avec confirmations, steppers et vocabulaire différents.
11. **Échec silencieux du modal stock** : erreurs POST non affichées, le modal se ferme comme un succès — stocks/page.tsx:135-147.
12. **Bon de commande pré-rempli qty=1 sur TOUS les produits** — un clic « Envoyer » commande tout le catalogue — suppliers/page.tsx:342-344.
13. **Total legacy calculé client et stocké tel quel** — divergence avec le marketplace qui recalcule serveur.
14. **DLC brute non formatée** sur /marketplace/reorder (string ISO dans « DLC {date} »).
15. **Champ « Marque » du modal stock = texte libre** pré-rempli « Gnocchi Bar » en dur au lieu d'un select des marques réelles — stocks/page.tsx:105,126,331-335.
16. **Quick action dashboard « Voir les factures fournisseurs »** pointe vers /marketplace/orders qui ne contient AUCUNE facture (historique de commandes sans PDF ni numérotation) — OperatorDashboard.tsx:190.
17. **Stats « Bientôt » ×2** : « Valeur totale du stock » (/stocks) et « Total estimé » (/marketplace/reorder).
18. **Pas d'URL par écran** sur /suppliers (4 écrans sous une seule route, back navigateur destructif) et sur le détail de /marketplace/orders (state local, non partageable).
19. **`GET /api/suppliers/orders`** (historique bons de commande legacy) n'est consommé par AUCUNE surface UI ; idem `POST /api/suppliers` (création fournisseur legacy sans UI).
20. **rating fournisseur legacy** affiché ★ mais seedé et jamais recalculé (aucun système d'avis) — suppliers/page.tsx:295-297.

## Ce qui N'EXISTE PAS (PART 9-10 — qu'un designer pourrait supposer)

**Stock** : prix/valeur d'achat par article, valeur totale du stock (stat « Bientôt »), suppression d'article, historique des mouvements/journal d'entrées-sorties, photos, code-barres/scan, catégories d'articles, lien article↔fournisseur, lien article↔recette/plat du menu, décrément automatique du stock à la vente, alertes push/e-mail de stock bas, export CSV, recherche, pagination, multi-établissement explicite (scoping par marque uniquement).

**Fournisseurs legacy** : création/édition/suppression de fournisseur depuis l'UI, historique des bons de commande (l'API GET existe, aucune UI), statut/suivi d'un bon de commande envoyé, intégration API ou WhatsApp réelle, avis/notes réels, messagerie.

**Marketplace B2B** : note ★/avis fournisseur, photos produits (icône générique), SKU, tri et filtres zone/catégorie sur la découverte, pagination, paiement en ligne acheteur (bouton verrouillé + backend gaté flag OFF), TVA/frais de livraison/commission visibles, heure limite de commande, calendrier de livraison réel (jours de fermeture), horodatages confirmé/livré (seul createdAt existe), facture PDF/numéro séquentiel, modification d'une commande envoyée (seule l'annulation avant confirmation existe), chat fournisseur (mailto/tel seulement), favoris/fournisseurs enregistrés, réassort automatique.

**Hub marketplace** : toute intégration réelle (Lydia/SumUp/Mailchimp = lignes inertes « Bientôt »), intégrations plateformes de livraison (retirées volontairement).

---
# PART 11 — CLIENTS (`/customers` + `/customers/[id]`)

Entrées de navigation (OperatorShell.tsx:41-42) : « **Clients** » (`nav.customers`, icône `group`, groupe `crm`, `requiresEstab: true`) et « **Avis** » (`nav.reviews`, icône `reviews`, PART 12). ⚠️ **/loyalty n'a AUCUNE entrée dans le rail ni aucun lien interne** — page orpheline accessible uniquement par URL (grep exhaustif ; le commentaire d'en-tête `loyalty.css:5` « Fidélité reachable via the rail » est PÉRIMÉ) — voir annexe PART 12.

## PAGE 1 — /customers (liste clients)

1. **Nom utilisateur** : « **Clients** » (`operator.customers.title`). Sous-titre : « **Programme de fidélité actif** » (`customers.subtitle`, CustomersClient.tsx:105).
2. **Route** : `/[locale]/customers` (+ query `?tier=bronze|silver|gold|platinum`). Server component `page.tsx`, client `CustomersClient.tsx`. `dynamic = 'force-dynamic'` (page.tsx:33).
3. **Objectif métier** : vue des clients fidélité du restaurateur (top 20 par points) avec agrégats de relation réels (commandes, panier moyen, total dépensé, dernière visite) — **sans jamais exposer les coordonnées** (modèle hybride fondateur, page.tsx:6-13).
4. **Persona / permission** : `restaurant` (ou `admin` = vue plateforme). Scoping tenant : un client « appartient » au restaurateur ssi il a commandé chez lui, via 2 flux (lib/customer-scope.ts:9-14) : A) validation UberEats `LoyaltyOrder.brandId → Brand.operatorId` ; B) commande conso /eat `Order.restaurantId → Restaurant.operatorId`, rejointe par email. Pas de session → écran vide (page.tsx:42). Admin : agrégats à 0, identités masquées quand même (customer-scope.ts:259, 264).
5. **Données backend** : `LoyaltyCustomer` : `id, name (masqué serveur), pointsBalance, tier, createdAt` (customer-scope.ts:252) — l'email sélectionné UNIQUEMENT pour joindre les commandes, jamais renvoyé (:251-252) ; `Order` (/eat) : `total, createdAt, fulfillmentType`, statuts exclus `awaiting_payment/expired/cancelled` (:165-171) ; `LoyaltyOrder` (UberEats) : `amount, validatedAt` (:190-193). Stats écran (`getCustomerScreenStats`, :403-463) : 4 KPI + compteurs par palier, serveur, même périmètre que la liste. « Nouveaux ce mois » = PREMIÈRE commande dans le périmètre ce mois calendaire, jamais `createdAt` (:393-394). Masquage identité : « Mohammed Maazouz » → « Mohammed M. » ; email → partie locale ; vide → « Client » (:28-39).
6. **Actions** : rechercher (client-side), filtrer par palier (navigation serveur), cliquer une ligne → fiche. **C'est tout. Aucune création, aucune édition, aucun export, aucun contact.**
7. **Champs éditables** : **AUCUN.** 100 % lecture.
8. **Read-only** : nom masqué, « Client depuis {date} », palier (badge coloré à pastille 7×7), Commandes, Total dépensé, Points, Dernière visite (« Hier »/« 3 juil. » via Intl, CustomersClient.tsx:63-75).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|---|
| « Tous » + compteur | chip filtre | `<Link href="/customers">` | GET serveur (re-query) | OUI | non |
| « Bronze / Argent / Or / Platine » + compteur | chips filtre | `<Link ?tier=…>` (CustomersClient.tsx:141-150) | GET serveur re-query | OUI | non |
| Ligne client (toute la row) | liste | `<Link /customers/[id]>` (:177) | GET fiche | OUI | non |
| Icône `visibility` (title « Voir la fiche ») | fin de ligne | fait partie du même Link | — | OUI | non |

10. **Filtres** : un seul — palier (`?tier=`), 4 valeurs + « Tous ». Compteurs par palier serveur sur la population complète clôturée (`groupBy tier`, customer-scope.ts:421). Valeur inconnue → « Tous » (page.tsx:56-57).
11. **Recherche** : input « **Rechercher un client…** » (`customers.searchPlaceholder`) — **filtrage client-side sur le NOM MASQUÉ uniquement, sur les ≤20 lignes visibles** (CustomersClient.tsx:79-83). AUCUNE requête serveur. Recherche par email/téléphone impossible par construction.
12. **Pagination** : **N'EXISTE PAS.** `take: 20` en dur, tri `pointsBalance desc` (customer-scope.ts:249-250). Titre de carte honnête : « **Meilleurs clients** » (`customers.listTitle`). Un 21ᵉ client est invisible et sa fiche inaccessible par tout chemin UI.
13. **États métier** : paliers `bronze / silver / gold / platinum` (+ alias legacy `platine` mappé sur `plat`, CustomersClient.tsx:35-37). Labels FR : **Bronze / Argent / Or / Platine** (`customers.tier.*`). Couleurs de chips : bronze `#F3E3D3/#8A5A2B`, argent `#E7ECF0/#5B6472`, or `#FCEFC7/#9C7318`, platine `#E7E4FB/#5B4FC4` (customers.css:71-74).
14. **Empty states** : 0 client — icône `group`, « **Aucun client pour l'instant** » / « **Vos clients apparaîtront ici après leur première commande — vous pourrez suivre leur fidélité et leur historique.** » (:85-95) ; recherche/filtre sans résultat — icône `search_off`, « **Aucun client trouvé** » / « **Aucun client ne correspond à votre recherche ou à ce palier.** » (:169-174).
15. **Loading** : **pas de skeleton** — server component (transition de route Next par défaut).
16. **Error** : **silencieux** — toute erreur serveur → `catch` → liste vide + stats à zéro (page.tsx:49-51) : l'écran d'erreur EST l'empty state. Pas de bouton réessayer.
17. **Success** : sans objet. 18. **Disabled** : aucun.
19. **Mobile** : `@media (max-width:640px)` (customers.css:81-88) — le header de table disparaît, chaque ligne devient 2 colonnes (avatar+nom / badge palier) + ligne `lmini` condensée « 12 · 245,00 € · Or » ; colonnes num, dernière visite et œil **masquées**. Bandeau privacy et KPI strip wrappent.
20. **Desktop** : grille 7 pistes `2fr 1fr 90px 110px 90px 110px 80px` (customers.css:42,45) — Client · Palier · Commandes · Total dépensé · Points · Dernière visite · œil. KPI strip 4 stats `flex` min-width 150px.
21. **Composants** : `CustomersClient`, `CustomerAvatar` (partagé liste/fiche — initiales par graphèmes, couleur dérivée de `LoyaltyCustomer.id` seul, réduction adaptative mesurée au canvas + re-mesure à `document.fonts.ready`, CustomerAvatar.tsx:3-10), CSS scopé `.cl-root`, Material Symbols Rounded. Pas de shadcn.
22. **APIs** : aucune côté client — server component via `lib/customer-scope` (Prisma direct).
23. **Flags** : aucun.
24. **Hardcodes** : `take: 20` ; tri points desc non modifiable ; bandeau bleu privacy permanent : « **Confidentialité clients. Vous voyez l'historique, la fidélité et les préférences. Les coordonnées (e-mail, téléphone, adresse) restent protégées par Grubano.** » (`customers.privacyListTitle/Body`).
25. **Contrôles morts** : aucun sur la liste.
26. **Dette** : clés i18n orphelines d'une ancienne version à PANNEAU latéral (`customers.panelTitle` « Fiche client », `close`, `dtPoints`, `dtLtv`, `dtOrders`, `dtAvg`, `serverNote`, `contactTitle` « Coordonnées », `noPhone` « Aucun numéro renseigné », `historySoonTitle/Body`, `tableTitle`, `statActive`, `colAvg`) ; divergence documentée vs maquette CD : Points en mono NEUTRE, pas orange (décision CD 18/08, CustomersClient.tsx:195-196).

## PAGE 2 — /customers/[id] (fiche client)

1. **Nom** : pas de titre dédié — fil d'Ariane « **Clients › {nom masqué}** » (CustomerProfileClient.tsx:76-80), h1 = nom masqué.
2. **Route** : `/[locale]/customers/[id]`. `dynamic = 'force-dynamic'` (page.tsx:18).
3. **Objectif** : fiche relation d'UN client — hero identité + KPIs relation + préférences (plats favoris, mode habituel) + échelle fidélité + 5 dernières commandes + bannière allergène PAR COMMANDE (sécurité alimentaire — jamais un profil santé stocké, page.tsx:8-9).
4. **Persona** : même clôture tenant — client hors tenant → `notFound()` 404, jamais de fuite (page.tsx:24-25 ; customer-scope.ts:321-326). Pas de session → 404.
5. **Données backend** : `getCustomerProfile` (customer-scope.ts:314-387) : `LoyaltyCustomer` (id, nom masqué, tier, points, createdAt=« membre depuis ») + commandes des 2 flux avec items parsés. Dérivés serveur : favoris = top 3 plats par quantité (:344-346) ; mode habituel = mode le plus fréquent (:347) ; 5 commandes récentes avec `itemsPreview` (« 3 premiers plats +N »), mode, montant, `dietaryNote` (exclusions + note de la 1ʳᵉ option de chaque item, :349-371). **Aucun email/téléphone/adresse dans le payload, par construction** (:229-230).
6. **Actions** : naviguer (breadcrumb). **Les deux seuls boutons d'action sont désactivés** (§25).
7. **Champs éditables** : **AUCUN.**
8. **Read-only** : hero (nom masqué, badge palier, badge vert « **Client fidèle** » si palier gold/platine OU ≥10 commandes, :54, « Client depuis {mois année} », « {n} commandes chez vous », « Dernière : il y a X jours ») ; KPIs (Commandes « chez votre établissement », Panier moyen « sur l'historique », Client depuis « {n} mois », Dernière visite) ; préférences (chips plats ×count ou « Pas encore de préférence » ; mode « Livraison »/« Click & collect » + « Mode le plus fréquent ») ; fidélité (solde points, barre de progression seuils réels 0/100/200/400 :22-27, échelle Bronze→Platine, « Plus que {pts} points pour atteindre {tier} » / « Palier maximum atteint ») ; historique (5 lignes date/plats/mode/montant ou « Aucune commande récente ») ; allergène — bandeau rouge « **Allergène signalé sur la commande du {date}** » + mention « **Visible par commande (sécurité alimentaire), pas conservé au profil.** » (affiché pour LA plus récente commande portant une note, :72, 194-203).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|
| « Offrir des points » | hero, bouton primaire orange | AUCUNE — `disabled` + title « Bientôt disponible » (:107-109) | NON | **MORT (assumé « bientôt »)** |
| « Message via Grubano » | hero, bouton ghost | AUCUNE — `disabled` + « Bientôt disponible » (:110-112) | NON | **MORT (assumé)** |
| « Clients » (breadcrumb) | fil d'Ariane | Link retour liste | OUI | non |

10-12. **Filtres / recherche / pagination — N'EXISTENT PAS.** Historique plafonné à 5 commandes (customer-scope.ts:352), aucun « voir plus ».
13. **États métier** : paliers idem liste ; badge « Client fidèle » (règle §8).
14. **Empty states** : « **Pas encore de préférence** » (`customerProfile.noFavorites`) ; « **Aucune commande récente** » (`customerProfile.historyEmpty`) ; tirets « — » pour panier/dernière visite si 0 commande.
15-16. **Loading / Error** : pas de skeleton (server component) ; erreur/introuvable/hors-tenant → 404 Next standard.
17-18. **Success / Disabled** : aucune mutation ; disabled = les 2 boutons hero (`opacity:.55; cursor:not-allowed`, customer-profile.css:52).
19. **Mobile** : `max-width:760px` — grille 2 colonnes → 1 (customer-profile.css:113) ; `max-width:640px` — hero wrap, 2 boutons en rangée 50/50 (:114).
20. **Desktop** : grille `1fr 1fr` (gauche relation+préférences, droite fidélité+historique, css:59) ; KPIs 2×2 ; hero avec halo radial orange. RTL géré (`flip-rtl` chevron, css:7-8).
21. **Composants** : `CustomerProfileClient`, `CustomerAvatar` (variante `profile`, 66px), CSS `.cp-root`.
22-23. **APIs / flags** : aucune côté client (Prisma direct serveur) ; aucun flag.
24. **Hardcodes** : seuils échelle 0/100/200/400 en dur (:22-27, miroir de lib/loyalty) ; top favoris = 3 ; historique = 5 ; encart final « **Note interne · visible par votre équipe uniquement** » → boîte pointillée « **Les notes d'équipe arriveront bientôt.** » (:209-215) — fonctionnalité **N'EXISTE PAS**.
25. **Contrôles morts** : « Offrir des points », « Message via Grubano » (désactivés, tooltip « Bientôt disponible ») ; « Note interne » = zone annoncée sans aucun backend.
26. **Dette** : aucun chrome legacy (écran récent, CD verbatim).

---

# PART 12 — AVIS (`/reviews`) + annexe `/loyalty`

## /reviews (avis)

1. **Nom utilisateur** : « **Avis** » (`operator.reviews.title`). Sous-titre : « **{count} avis au total** » (`reviews.subtotal`).
2. **Route** : `/[locale]/reviews` — page entièrement `'use client'`.
3. **Objectif métier** : lire les avis conso publiés sur l'établissement COURANT (avis Grubano on-platform uniquement) : moyenne, distribution 1-5 étoiles, liste, et générer un BROUILLON de réponse par IA. Page « honnêtement dé-mockée » : l'ancienne version livrait un tableau `MOCK_REVIEWS` en dur + un « Envoyer » non persistant (page.tsx:12-24).
4. **Persona** : middleware opérateur. Établissement courant résolu comme le shell : `GET /api/establishments` + cookie `grubano_estab` (le cookie gagne s'il est valide, sinon `currentId`, sinon le plus ancien — page.tsx:95-108).
5. **Données backend** : `Review` (Prisma) via `GET /api/restaurants/{id}/reviews` : `id, rating, text, tags, createdAt, operator.name` — **statut `published` uniquement, `take: 50`, tri date desc** (route.ts:43-48). Auteur exposé en **PRÉNOM seul** (privacy, route.ts:13, 24-26). Distribution par étoile calculée serveur (:49-53). Ce GET est **PUBLIC** (:8). Le POST du même endpoint (dépôt/upsert d'avis) est côté CONSO.
6. **Actions** : rafraîchir · changer d'onglet (Tous / À répondre / Répondus) · ouvrir la modale « Répondre » · choisir un ton (Chaleureux/Professionnel/Concis) · générer un brouillon IA · éditer le brouillon. **Rien n'est jamais enregistré.**
7. **Champs éditables** : dans la modale seulement — sélecteur de ton (état local) ; textarea « **Votre réponse (modifiable)** » placeholder « **Cliquez sur « Générer un brouillon » ou écrivez directement votre réponse ici…** » (état local, perdu à la fermeture).
8. **Read-only** : moyenne (1 décimale) + 5 étoiles + « {count} avis » ; barres de distribution 5→1 avec % ; compteur orange « avis à répondre » ; par carte : avatar initiales (gradient par index, `AV_GRADS` page.tsx:32-39), nom (ou « Client Grubano »), badge source « GRUBANO », étoiles, date longue FR, texte, tags, badge « À répondre ».
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|---|
| « Actualiser » (`dash.refresh`) | header | re-fetch establishments + reviews (:308-311) | GET ×2 | OUI | non |
| « Tous » / « À répondre » / « Répondus » + compteurs | pilules onglets | état local | non | OUI (mais voir §13) | non |
| « Répondre » | carte avis, bouton orange | ouvre la modale composeur (:420-423) | non | OUI | non |
| « Générer un brouillon » (→ « Génération en cours… ») | modale, bouton violet IA | `POST /api/reviews/generate-reply` (:171-190) | OUI (appel LLM payant, quota par opérateur) | OUI | non |
| « Envoyer la réponse » | pied de modale | AUCUNE — `disabled` + title « **Envoi & publication — bientôt** » (:522-525) | non | NON | **MORT (assumé)** |
| « Fermer » | pied de modale | ferme (brouillon PERDU) | non | OUI | non |
| × (aria « Annuler ») + clic backdrop | modale | ferme | non | OUI | non |
| « Créer mon établissement » (`onb.cta`) | état onboarding | Link `/dashboard/establishments` (:255) | — | OUI | non |
| « Réessayer » (`dash.retry`) | état erreur | relance `load()` | GET | OUI | non |

10. **Filtres** : les 3 onglets uniquement. **Fait clé : « Tous » et « À répondre » affichent exactement la même liste** (« all and pending are identical while replies aren't persisted », :147-151) ; « Répondus » affiche TOUJOURS l'état vide.
11. **Recherche : N'EXISTE PAS.** 12. **Pagination : N'EXISTE PAS** (`take: 50` serveur — le 51ᵉ avis est invisible).
13. **États métier** : un avis n'a qu'UN état visible — « À répondre » (badge `reviews.badgePending`). La classe `.rv-badge.answered` existe (reviews.css:82) mais n'est jamais rendue. `pendingCount = tous les avis`, `answeredCount = 0` en dur (:143-145). **Pas de statut de réponse en base** exposé à cette page.
14. **Empty states** : onboarding (0 établissement) — logo + « **Bienvenue sur Grubano Business** » + « **Créez votre premier établissement pour commencer à recevoir et gérer les avis de vos clients.** » + 3 étapes (:246-271) ; 0 avis — icône `rate_review`, « **Aucun avis pour l'instant** » / « **Vos premiers avis clients apparaîtront ici dès qu'ils seront publiés — vous pourrez y répondre directement.** » ; onglet Répondus — « **Aucune réponse enregistrée pour l'instant** » / « **L'enregistrement et la publication de vos réponses arrivent bientôt — pour l'instant, générez et copiez un brouillon depuis l'onglet « À répondre ».** »
15. **Loading** : skeleton complet (`op-sk` shimmer) : titre, carte overview, pilule onglets, 3 cartes (:203-224). Génération IA : spin `progress_activity` + « Génération en cours… ».
16. **Error** : page — `cloud_off` + « **Impossible de charger vos avis** » + « Réessayer ». Génération IA : callout rouge « **La génération du brouillon a échoué. Réessayez dans un instant.** » (:496-501). NB : le 429 quota IA renvoie « Limite IA atteinte, réessaie plus tard. » (generate-reply/route.ts:79) mais l'UI affiche le message générique (elle ne lit pas `error`).
17. **Success** : génération réussie → le textarea se remplit. Aucun autre succès possible (pas d'envoi).
18. **Disabled** : « Envoyer la réponse » toujours `disabled` ; « Générer un brouillon » pendant la génération (`cursor:progress`).
19. **Mobile** : `@media (max-width:880px)` (reviews.css:170-180) — header en colonne ; overview 3 colonnes → 1 (empilés avec séparateurs) ; onglets pleine largeur ; date d'avis sous les étoiles ; étapes onboarding 1 colonne. Modale : `max-width:560px`, `max-height:92vh`, header/footer sticky (css:91-98).
20. **Desktop** : overview grille `auto 1fr auto` ; liste d'avis en colonne pleine largeur (cartes empilées).
21. **Composants** : tout custom scopé `.gb-op` (op-card, op-modal, op-callout, rv-*) — le CSS recopie les composants partagés du CD (reviews.css:21-23). Pas de shadcn.
22. **APIs** : `GET /api/establishments` · `GET /api/restaurants/{id}/reviews` (publique) · `POST /api/reviews/generate-reply` `{platform, authorName, rating, text}` → `{reply}` — restaurateur AUTHENTIFIÉ requis (401 sinon), rate-limit 20/min, texte ≤ 2000 chars, quota LLM par opérateur (generate-reply/route.ts:35-49).
23. **Flags** : aucun sur la page (rate-limit derrière `RATE_LIMIT_ENABLED` côté lib).
24. **Hardcodes** : source unique en dur `REAL_SOURCE = 'Grubano'` (:30) — badge identique sur tous les avis ; bandeau import « **Importer vos avis Google, TripAdvisor…** » / « **La synchronisation multi-plateformes de vos avis externes arrive progressivement.** » + tag « **Bientôt** » — **AUCUN backend** (:314-322) ; pied de modale pilule « **Envoi & publication — bientôt** » ; note IA « **Le brouillon IA est une suggestion — relisez-le et ajustez-le avant d'envoyer, il n'est jamais publié automatiquement.** » ; le prompt IA signe en dur « **L'équipe Grubano** » et se présente comme « manager of a dark kitchen called Grubano » — pas le nom du restaurant du tenant (generate-reply/route.ts:63-69).
25. **Contrôles morts** : « Envoyer la réponse » (disabled permanent) ; bandeau import multi-plateformes (aucune action) ; onglet « Répondus » (structurellement toujours vide).
26. **Dette** : pas de bouton « Copier » pour le brouillon IA malgré l'empty state Répondus qui dit « générez et copiez » (copie manuelle au clavier uniquement) ; « Tous » ≡ « À répondre » = doublon fonctionnel exact ; l'agrégat headline `Restaurant.rating / reviewCount` (affiché côté conso) n'est PAS alimenté par ces avis (« intentionally left untouched », route.ts:10-12) — la moyenne vue ici peut différer de la note affichée aux consommateurs.

## Annexe PART 12 — /loyalty (fidélité opérateur, page ORPHELINE)

1. **Nom utilisateur** : « **Fidélité** » (`operator.loyalty.title`). Sous-titre : « **Programme de fidélité — 1 point = 1 € dépensé · Bronze → Platine** ».
2. **Route** : `/[locale]/loyalty` — `'use client'`. ⚠️ **ORPHELINE : aucune entrée de rail, aucun lien entrant.**
3. **Objectif métier** : écran d'ADMIN du programme fidélité côté opérateur : règles gelées du programme (lecture seule) + 3 outils réels : valider une commande UberEats (créditer des points), inscrire un membre, consulter le wallet d'un client par email.
4. **Persona** : middleware opérateur. Endpoints : validate = restaurateur connecté, marque résolue DANS son tenant (validate/route.ts:27-35) ; register = **public** rate-limité 10/10min (register/route.ts:13-18) ; wallet `?email=` = opérateur/admin, restaurateur clôturé à SES clients, rate-limit 20/min (wallet/route.ts:46-60).
5. **Données backend** : wallet (`GET /api/loyalty/wallet?email=`) : `pointsBalance, centsPerPoint, balanceEuros, creditScale[{points,euros}], tier, next_tier, next_tier_pts, recent_orders[{id,brand,amount,pointsEarned,date}], referral_code` (page.tsx:47-57), conversion points→€ = `lib/loyalty.pointsToCents`, jamais recalculée client (:19-22) ; validate → `{pointsEarned, newBalance, tier}` ; écrit `LoyaltyOrder` + met à jour `LoyaltyCustomer` (points/tier serveurs, seuils 0/100/200/400, validate/route.ts:8-17) ; register → crée `LoyaltyCustomer` (10 pts bonus, tier bronze, register/route.ts:42-50).
6. **Actions** : 3 formulaires (onglets « **Valider une commande** » / « **Inscrire un membre** » / « **Consulter un wallet** »). Tous fonctionnent réellement.
7. **Champs éditables** : Valider — « Email du client » (email requis, `client@email.com`), « N° de commande UberEats » (requis, `#UE-58291`), « Montant (€) » (number step 0.01, `24.90`), « Marque » (select). Inscrire — « Nom complet » (requis), « Email » (requis), « Téléphone (optionnel) ». Wallet — « Email du client » (requis).
8. **Read-only** : bandeau stats « Membres » / « Points émis (cumul) » / « Points échangés » / « Récompenses données » → **valeur « Bientôt » ×4** (aucun endpoint, page.tsx:142-150) ; règles « Gagner 1 point pour chaque 1,00 € dépensé », « Bonus de bienvenue (à l'inscription) » = « 10 pts », « Expiration des points » = « Les points n'expirent pas », callout « **Règle du programme : 1 point = 1 € dépensé (arrondi à l'entier), 10 points offerts à l'inscription. Ces règles sont fixées côté Grubano…** » ; paliers 4 cartes Bronze 0 / Silver 100 / Gold 200 / Platine 400 pts — NB labels FR : **« Silver » et « Gold » non traduits** (`loyalty.tier.silver/gold`) alors que /customers dit « Argent » / « Or » ; conversion — jalons 100/200/400 pts → « donnent » → **« Bientôt »** tant qu'aucun wallet n'a été consulté, tag « Indicatif — crédit exact calculé lors de la commande » (:199-221).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | PERSISTÉ ? | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|---|---|
| Toggle « Programme actif » | header, pill + switch | AUCUNE — `checked readOnly`, title « Bientôt » (:135-138) | non | non | NON | **MORT (décoratif)** |
| Onglets outils ×3 | pilule tablist | état local | non | non | OUI | non |
| « Valider et créditer » | form validate | `POST /api/loyalty/validate` | OUI (crée LoyaltyOrder, crédite points, recalcule tier) | **OUI** | OUI | non |
| « Valider une autre commande » | callout succès | reset état local | non | non | OUI | non |
| « Inscrire au programme » | form register | `POST /api/loyalty/register` | OUI (crée LoyaltyCustomer +10 pts) | **OUI** | OUI | non |
| « Inscrire un autre membre » | callout succès | reset | non | non | OUI | non |
| « Consulter le wallet » | form wallet | `GET /api/loyalty/wallet?email=` | lecture | — | OUI | non |

10-12. **Filtres / recherche / pagination** : n'existent pas (le lookup wallet par email est la seule recherche ; `recent_orders` non paginé).
13. **États métier** : chaque formulaire `idle | loading | ok | err`. Tiers wallet : bronze/silver/gold/platine (seuils serveur).
14. **Empty states** : wallet introuvable — `search_off` + « **Wallet introuvable** » + message serveur ; wallet sans commande — `receipt_long` + « **Aucune commande enregistrée** ».
15. **Loading** : submits spin + disabled ; lookup wallet skeleton 150px (:337-341). Pas de skeleton de page (statique tant qu'on ne soumet rien).
16. **Error** : callouts rouges par formulaire, message = `data.error` serveur ou « **Erreur inconnue.** » (fallback en dur ×3, :75, 89, 103).
17. **Success** : validate — callout vert « **Commande validée** » + « +{pts} pts · Solde : {n} pts · {palier} » ; register — « **{name} inscrit(e)** » + « {n} points de bienvenue · Code de parrainage : {8 premiers chars} » ; wallet — carte navy « **Wallet fidélité** » (email, tier, points, « soit un crédit de {€} », barre de progression, « Plus que {pts} pts pour atteindre le palier {tier} » / « Palier maximum atteint », « Code de parrainage » complet) + « **Commandes récentes** » (marque, date, montant, +pts).
18. **Disabled** : submits pendant loading ; toggle programme (readOnly).
19. **Mobile** : `max-width:880px` (loyalty.css:192-199) — stats en colonne, grille paliers 4→2 colonnes, échelle de conversion en colonne ; `max-width:460px` — paliers 1 colonne, onglets pleine largeur (:200-204).
20. **Desktop** : cartes empilées pleine largeur ; paliers `repeat(4,1fr)` ; wallet card gradient navy avec glow orange.
21. **Composants** : custom `.gb-op` (op-card, op-callout, op-switch, wallet-card, tier-grid…), `formatEuros`. Pas de shadcn.
22. **APIs** : `POST /api/loyalty/validate` · `POST /api/loyalty/register` · `GET /api/loyalty/wallet?email=` (handlers préservés byte-identical du legacy, page.tsx:13-17).
23. **Flags** : aucun sur la page.
24. **Hardcodes** : **`BRANDS = ['Gnocchi Bar', 'Le Riz Gourmand', 'Pasta Fresca', 'Rollix']` en dur** (page.tsx:34) — le select Marque n'est PAS alimenté par les marques réelles du tenant (l'API validate, elle, résout la marque dans le tenant du caller → mismatch possible pour tout opérateur sans ces 4 marques) ; seuils paliers + jalons 100/200/400 en dur (miroirs de lib/loyalty, :38-43, 205) ; « Bientôt » ×4 stats + ×3 montants € de l'échelle avant lookup.
25. **Contrôles morts** : toggle « Programme actif » (checked readOnly, aucun handler — :135-138).
26. **Dette** : la page reste centrée sur le flux UberEats (« N° de commande UberEats ») ; les points gagnés via commandes /eat sont crédités ailleurs (à la livraison), pas depuis cet écran.

## Dette design factuelle (PART 11 + 12)

1. **/loyalty page orpheline** : dans le middleware (middleware.ts:33) mais absente du rail (OperatorShell.tsx:34-47) et sans aucun lien entrant. Le commentaire loyalty.css:5 est faux à ce SHA.
2. **Labels de paliers incohérents entre écrans** : /customers « Argent » / « Or » vs /loyalty « Silver » / « Gold » — même donnée, deux vocabulaires FR.
3. **Deux systèmes d'avatars pour la même notion « personne »** : /customers utilise `CustomerAvatar` (couleur déterministe par id) ; /reviews utilise initiales naïves + gradient par INDEX de liste (`AV_GRADS[idx % 6]`) — le même client change de couleur quand la liste change d'ordre.
4. **Deux styles de boutons primaires orange divergents** : `.btn-primary` (customer-profile.css:48) vs `.op-btn-primary` (reviews.css:100, loyalty.css:117) — gradients identiques mais paddings/tailles différents, classes dupliquées par écran.
5. **Contrôles morts visibles** : « Offrir des points » + « Message via Grubano », « Envoyer la réponse », toggle « Programme actif », bandeau « Importer vos avis Google, TripAdvisor… ».
6. **Onglet « Répondus » structurellement vide + « Tous »≡« À répondre »** : trois onglets pour un seul contenu réel.
7. **Pas de bouton Copier** pour le brouillon IA.
8. **Recherche clients trompeusement locale** : l'input ne cherche que dans les 20 lignes chargées, sur le nom masqué — un membre hors top-20 est introuvable.
9. **Select « Marque » de /loyalty en dur** avec les 4 marques historiques — non tenant-scopé côté UI.
10. **Clés i18n mortes** du panneau client legacy.
11. **Breakpoints divergents** : /customers 640px, fiche 760/640, /reviews et /loyalty 880 (+460).
12. **La moyenne d'avis de /reviews peut différer de la note conso** (`Restaurant.rating/reviewCount` non alimenté par ces avis).
13. **Signature IA en dur « L'équipe Grubano »** et persona « dark kitchen called Grubano » dans le prompt, jamais le nom du restaurant.

## Ce qui N'EXISTE PAS (PART 11 + 12)

**Clients** : aucune coordonnée client (email/téléphone/adresse) — masquage volontaire par construction, PAS un manque à combler (customer-scope.ts:15, 229-230) ; pas de pagination, pas de tri au clic sur colonne, pas d'export, pas de recherche serveur, pas de segmentation/tags, pas de création manuelle de client, pas de fusion de doublons, pas de suppression/RGPD UI, pas de notes d'équipe (annoncées « bientôt »), pas d'envoi de points, pas de messagerie, pas de profil santé/allergènes stocké (allergènes = par commande uniquement), pas de campagnes/marketing.

**Avis** : pas de modération (masquer/supprimer/signaler un avis) — aucun contrôle, aucune API opérateur ; pas d'envoi ni de stockage de réponse (le brouillon meurt à la fermeture), donc pas d'historique de réponses ; pas d'avis externes (Google/TripAdvisor/UberEats) — source unique « Grubano », import « bientôt » sans backend ; pas de filtre par note, pas de recherche, pas de tri, pas de pagination au-delà de 50, pas de notification « nouvel avis », pas de photos dans les avis (le modèle exposé n'a que rating/text/tags).

**Fidélité** : pas d'édition des règles du programme (taux, bonus, seuils = gelés côté Grubano, lecture seule) ; pas d'activation/désactivation du programme (toggle décoratif) ; pas de stats du programme (« Bientôt », aucun endpoint) ; pas de catalogue de récompenses côté opérateur (le modèle `Reward` existe en base, aucun écran opérateur ; l'ancien catalogue `available_rewards` supprimé du wallet — wallet/route.ts:17-22) ; pas de liste des membres sur cet écran (elle vit sur /customers) ; pas d'ajustement manuel de points (crédit uniquement via validation UberEats) ; pas de retrait/débit de points ; pas d'expiration de points (règle : n'expirent pas).

---
# PART 13 — ANALYTICS (`/analytics`)

Toutes les pages de cette famille (analytics/finance/cashflow/wallet) rendent **dans l'OperatorShell** (`components/AppChrome.tsx:28-32`), contenu `<section>` centré **max 1520 px**, padding 24 px (16 px ≤880 px).

1. **Nom utilisateur** : « **Analytics** » (`operator.analytics.title` ; nav « Analytics », groupe insights, icône Material `monitoring` — OperatorShell.tsx:43).
2. **Route** : `/{locale}/analytics` — `app/[locale]/analytics/page.tsx`.
3. **Objectif métier** : pilotage des ventes — CA 7j/30j, classement des marques, heures de pointe, KPIs.
4. **Persona/permission** : `restaurant`/`admin` (OPERATOR_FLAT middleware.ts:33 ; API via `resolveEstablishmentScope`, `app/api/analytics/route.ts:15-19`, `lib/establishment-scope.ts:29`).
5. **Données backend — ⚠️ FAIT CLÉ** : la source est **`LoyaltyOrder`** (commandes UberEats validées via le programme fidélité), **PAS le modèle `Order`** (commandes conso Grubano). `app/api/analytics/route.ts:27-38` : `prisma.loyaltyOrder.findMany` (fenêtres 30 j et 7 j, `validatedAt`, `amount`) + `prisma.brand.findMany` (name, emoji). Un designer ne doit pas supposer que ces graphiques reflètent les commandes /eat — ils reflètent les validations loyalty.
6. **Actions** : basculer la période 7 j / 30 j (état client, page.tsx:180-181) ; basculer l'onglet classement Plats/Marques (:290-291) ; « Actualiser » = `location.reload()` (:184).
7. **Champs éditables** : AUCUN. 100 % lecture.
8. **Read-only** : tout — 4 KPIs, courbe SVG 7 j, bande d'intensité horaire, classement marques.
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | FONCTIONNE ? | MORT ? |
|---|---|---|---|---|---|
| « 7 jours » / « 30 jours » | header, segmented `op-period` | state `period` | non | oui | non |
| « Personnalisée » + badge « Bientôt » | header | — | — | non | **disabled** (`disabled title={t('soon')}`, :183) |
| « Actualiser » | header | `location.reload()` | re-GET | oui | non |
| « Plats » / « Marques » | onglets carte Classements | state `rankTab` | non | oui (mais « Plats » n'affiche qu'un empty honnête) | non |
| « Voir mes commandes » | empty state | Link `/orders` | — | oui | non |
| « Réessayer » | état erreur | `location.reload()` | re-GET | oui | non |

10. **Filtres** : période 7j/30j uniquement. Pas de filtre marque, pas de filtre canal. Dates personnalisées **N'EXISTENT PAS** (bouton inerte « Bientôt »).
11. **Recherche : N'EXISTE PAS.** 12. **Pagination : N'EXISTE PAS** (classement tronqué à 5 marques — `slice(0, 5)`, :297).
13. **États métier** : loading / error / ready + « ready mais vide » (`hasData` = aucun point de revenu, 0 marques, 0 commandes — :119-136).
14. **Empty state (FR réel)** : « **Pas encore assez de données** » / « **Vos statistiques de vente apparaissent ici après quelques jours d'activité. Revenez bientôt !** » + CTA « **Voir mes commandes** » (`analytics.emptyTitle/emptyBody/emptyCta`). Même trio réutilisé en mini-empty dans les cartes Heures de pointe et Marques (:281,305).
15. **Loading** : skeleton complet `op-sk` (header + 4 KPIs + carte graphique + 2 cartes, :82-102).
16. **Error** : `op-error__card`, icône `cloud_off`, « **Impossible de charger les analytics** » + corps `dash.errorBody` + « Réessayer » (:105-116).
17. **Success** : aucun toast — pur affichage.
18. **Disabled** : « Personnalisée » (badge « Bientôt », :183).
19. **Mobile** : breakpoints CSS custom : ≤880 px → KPIs 2 colonnes, `op-row2` 1 colonne, header en colonne ; ≤460 px → KPIs 1 colonne (`analytics.css:128-138`). Graphiques dans wrapper `op-chart-wrap` scrollable, `dir="ltr"` forcé (RTL-safe). Analytics n'est PAS dans la bottom-nav — accessible seulement via rail/drawer.
20. **Desktop** : max 1520 px ; grille KPIs 4 colonnes, `op-row2` 2 colonnes (Heures de pointe / Classements).
21. **Composants** : page autonome (rien d'importé hormis `Link`) ; classes `op-*` ; SVG inline calculé (:225-247) ; Material Symbols.
22. **APIs** : `GET /api/analytics` (unique, `cache: 'no-store'`, :64).
23. **Flags** : AUCUN.
24. **Hardcodes/placeholders — l'honnêteté « bientôt » est le motif dominant** (commentaire d'intention :13-25) :
    - KPI « **Couverts** » : toujours « — » + badge « Bientôt » (pas de backend — :205-209).
    - KPIs « Commandes » et « Panier moyen » en période 7 j : « — » + « **Sur 30 j uniquement** » (l'API n'expose que le 30 j — :141-142,197-203).
    - Tendances KPI (« vs période précédente ») : badge « **Tendance bientôt** » sur les 4 KPIs (:193,198,203).
    - Courbe : légende « **Semaine précédente — bientôt** » (pas de ligne comparative inventée — :221).
    - Heatmap : agrégat HORAIRE seul (10h–23h, `route.ts:75-78`), une seule bande d'intensité 6 niveaux + note « **détail jour × heure bientôt** » (:261-278).
    - Onglet « Plats » : empty honnête « **Classement des plats bientôt** » / « **Le détail des ventes par plat arrivera ici avec la ventilation par produit.** » (:308).
    - Dégradés d'avatars de marques en dur (`BRAND_GRADS`, :40-46).
25. **Contrôles morts** : « Personnalisée » (disabled by design). Rien d'autre.
26. **Dette legacy** : « Actualiser » = `location.reload()` (rechargement complet) ; « Dernière mise à jour » = heure de RENDU client (`new Date()`, :79), pas l'heure des données.

---

# PART 14 — FINANCES (`/finance`) + annexes `/cashflow` et `/wallet`

## /finance — « Finances »

1. **Nom utilisateur** : « **Finances** » (`operator.fin.title` ; nav « Finances », icône `account_balance_wallet` — OperatorShell.tsx:44).
2. **Route** : `/{locale}/finance`.
3. **Objectif métier** : P&L réel du restaurateur sur 30 jours glissants — la « golden equation » `CA brut − commission − reversé créateurs − remises financées = revenu net`, affichée telle que l'API la fournit (jamais recalculée côté client — page.tsx:12-17).
4. **Persona** : `restaurant`/`admin` (middleware.ts:35 + API `ALLOWED_ROLES`, `app/api/finance/summary/route.ts:12`).
5. **Données backend** — la source est bien le modèle **`Order`** (commandes conso réelles, statuts hors `cancelled/awaiting_payment/expired`, fenêtre 30 j glissants — route.ts:69-83) + **`LedgerEntry.applicationFeeAmount`** (commission réellement prélevée, tamponnée par transaction, types payment/deposit_capture/refund — :105-115) + **`DishSale.creatorEarning`** figé (:120-124) + remises dérivées `subtotal + deliveryFee − total` positives (:131-136). L'API retourne aussi `caAmeneParCreateurs`/`ordersFromCreators` (:148-152) — **la page ne les affiche PAS** (page.tsx:113-116 les ignore).
6. **Actions** : « Actualiser » (reload). C'est tout.
7. **Champs éditables** : AUCUN sur la page. Le modal remboursement contient un segmented Total/Partiel, un select motif, un textarea note — mais le modal est inatteignable (§25).
8. **Read-only** : formule CA (3 termes), barre de proportion net/frais, 3 lignes de décomposition (« **Commission Grubano (x %)** », « **Reversé aux créateurs** », « **Remises de bienvenue financées** » — les 2 dernières masquées si 0, :181-183). Le taux de commission affiché est DÉRIVÉ des montants API (`commissionGrubano ÷ caBrut`), jamais en dur (:143-148).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND ? | FONCTIONNE ? | MORT ? | FLAG ? |
|---|---|---|---|---|---|---|
| « Actualiser » | header | `location.reload()` | re-GET | oui | non | — |
| « Voir mes commandes » | empty state | Link `/orders` | — | oui | non | — |
| « Réessayer » | erreur | reload | re-GET | oui | non | — |
| « Remboursement total » / « Partiel » | modal refund | rien (pas de handler) | non | non | **morts** (:242-243) | gate-2 REFUNDS |
| « Annuler » / croix | modal refund | ferme le modal | non | oui (si modal ouvert) | — | — |
| « Confirmer le remboursement » | modal refund | — | AUCUN (pas de câblage Stripe) | non | **disabled + aria-disabled** (:269) | gate-2 (REFUNDS_ENABLED) |

10. **Filtres** : AUCUN. Fenêtre 30 j fixe (`windowDays: 30` ; sous-titre « 30 derniers jours »). Un sélecteur de période **N'EXISTE PAS**.
11. **Recherche : N'EXISTE PAS.** 12. **Pagination : N'EXISTE PAS** (aucune liste réelle).
13. **États métier** : loading / error / ready / vide (`ordersTotal === 0` — :119).
14. **Empty state FR** : « **Aucune transaction pour l'instant** » / « **Vos revenus, commissions et versements apparaîtront ici dès votre première commande.** » / CTA « Voir mes commandes ».
15. **Loading** : skeleton `op-sk` (header + 2 cartes + 1 carte, :72-97).
16. **Error** : « **Impossible de charger vos données financières** » + `dash.errorBody` + « Réessayer ». Nota : l'API **ne renvoie jamais 500 volontairement** — en cas d'erreur interne elle dégrade en zéros (route.ts:165-169) → l'utilisateur voit alors l'empty state, pas l'écran d'erreur.
17. **Success** : aucun toast.
18. **Disabled** : « Confirmer le remboursement » (disabled permanent, gate-2).
19. **Mobile** : ≤880 px → `op-row2` 1 colonne, formule CA empilée verticalement (`finance.css:202-205`) ; ≤460 px ajustement statut payout (:215-217).
20. **Desktop** : 1520 px max ; 2 rangées `op-row2` 2 colonnes (Décomposition + Prochain versement ; Journal + Factures).
21. **Composants** : page autonome ; `formatEuros` ; classes `op-*` ; modal maison `op-modal-backdrop`/`op-modal`.
22. **APIs** : `GET /api/finance/summary` uniquement.
23. **Flags** : aucun lu par la page ; le remboursement est verrouillé « gate-2 » par construction (bouton disabled), pas par env (page.tsx:21,268).
24. **Hardcodes/« bientôt »** (tous des empty honnêtes, aucun chiffre inventé) :
    - « **Prochain versement** » : montant « — », « **Calcul du prochain virement — bientôt disponible** », « **Virement SEPA — compte bancaire à connecter** » (:188-195).
    - « **Échéancier des versements** » : pill « Bientôt » + « **Historique des versements bientôt disponible** » / « **L'échéancier de vos virements SEPA s'affichera ici après la connexion de votre compte de paiement.** » (:199-206).
    - « **Journal des transactions** » : pill « Bientôt » + « **Journal détaillé bientôt disponible** » / « **Le détail ligne par ligne de vos encaissements, commissions et remboursements arrivera ici.** » (:211-218).
    - « **Factures & relevés** » : pill « Bientôt » + « **Relevés mensuels bientôt disponibles** » / « **Vos relevés PDF mensuels seront générés et téléchargeables ici.** » (:221-228).
    - Callout du modal refund : « **Aperçu uniquement : les remboursements ne sont pas encore actifs. Ils seront branchés avec l'intégration des paiements.** » (`fin.refundSoonNote`).
25. **Contrôles morts — FAIT MAJEUR** : le **modal « Rembourser la commande » est INATTEIGNABLE**. Rendu dans le DOM (:232-274) mais **aucun `setRefund(true)` n'existe dans le fichier** (recherche exhaustive) : aucun bouton n'ouvre le modal. Code mort complet (~40 lignes de JSX + 15 clés i18n `fin.refund*`). À l'intérieur, segments Total/Partiel sans handler et « Confirmer » disabled.
26. **Dette** : `caAmeneParCreateurs` et `ordersFromCreators` calculés par l'API mais jamais affichés (valeur créateurs invisible pour l'opérateur) ; « Actualiser » = reload complet ; heure « Actualisé à » = heure de rendu client.

## Annexe PART 14a — /cashflow « Trésorerie » (HIDDEN, aperçu honnête complet)

1. **Nom** : « **Trésorerie** » (`operator.cash.title`). Sous-titre : « **Prévision de trésorerie · {days} prochains jours** ».
2. **Route** : `/{locale}/cashflow`.
3. **Objectif (affiché)** : prévision de trésorerie 30/60/90 j. **Réalité** : APERÇU HONNÊTE COMPLET — « CÂBLAGE REPORTÉ (décision Mohammed). Il n'existe AUCUN backend de projection réel » (page.tsx:10-20). L'ancien mock 100 % en dur a été RETIRÉ.
4. **Persona** : restaurant/admin (middleware.ts:35).
5. **Données backend** : **AUCUNE. Zéro fetch dans la page** (aucun `fetch`/`useEffect` réseau). Aucune API `/api/cashflow` n'existe.
6. **Actions** : bascule horizon 30/60/90 j (`op-period` role tablist, :70-84) — ne fait que **ré-étiqueter** les textes (« {days} j ») ; « Actualiser » = reload.
7-8. **Éditables** : AUCUN. **Read-only** : tout, et tous les montants = « — » (const `DASH`, :22).
9. **CTA** : « 30 j / 60 j / 90 j » (state cosmétique) ; « Actualiser » (`location.reload()` d'une page statique).
10-12. **Filtres / recherche / pagination : N'EXISTENT PAS.**
13. **États métier** : un seul état — l'aperçu. **Pas de loading, pas d'erreur, pas d'empty distinct.**
14. **Preview state FR (le cœur de la page)** : bandeau `role="note"` : « **Prévision de trésorerie — bientôt visible** » / « **Cet écran est un aperçu de la prévision de trésorerie à venir. Le calcul (versements attendus, charges connues, historique) n'est pas encore activé : aucun chiffre n'est affiché tant que la projection réelle n'est pas disponible.** » + tag « Bientôt » (:52-59).
15-17. **Loading / Error / Success : N'EXISTENT PAS.** 18. **Disabled** : aucun.
19. **Mobile** : ≤880 px → `op-row2` 1 colonne, topbar en colonne (`cashflow.css:121-124`). Graphique scrollable `op-chart-wrap` `dir="ltr"`.
20. **Desktop** : 1520 px max ; hero pleine largeur, carte projection pleine largeur, 2 cartes Entrées/Sorties en `op-row2`.
21-23. **Composants / APIs / Flags** : autonome, classes `op-*`, SVG statique ; AUCUNE API ; AUCUN flag.
24. **Hardcodes — la page ENTIÈRE** : « **Solde actuel** » = « — », aria-label « Non disponible pour l'instant », note « **Disponible une fois la prévision activée** » (:62-68) ; stats « Entrées prévues » / « Sorties prévues » / « Solde projeté en fin d'horizon » = « — » + « fourchette haute / basse — à venir » (:101-115) ; SVG courbe en POINTILLÉS opacité 0.55 + bande d'incertitude illustrative + seuil de sécurité — **coordonnées codées en dur, forme purement illustrative** (:129-151), watermark « **Projection bientôt disponible** » (:152-154) ; carte alerte « **Alerte de trésorerie basse** » + tag « Estimation » (:163-170) ; listes Entrées (« Versement Grubano ») / Sorties (« Charge / fournisseur ») : 3 rangées factices chacune, date « — », montant « — », tag « Estimé », pied « **Le détail des entrées et sorties prévues s'affichera ici une fois la prévision activée.** » (:173-211).
25. **Contrôles morts** : aucun au sens strict (l'horizon fonctionne cosmétiquement). Mais la page entière est un placeholder.
26. **Dette / accès** : **page ORPHELINE** — absente du rail et du bottom-nav ; aucun `href` vers `/cashflow` dans tout le code .tsx (grep). URL directe uniquement.

## Annexe PART 14b — /wallet « Wallet Client » (⚠️ MOCK LEGACY INTÉGRAL, orphelin)

1. **Nom** : « **Wallet Client** » (titre EN DUR dans le JSX, PAS i18n — wallet/page.tsx:8). Sous-titre « **Aperçu PWA · ce que voit le client** » + badge « QR-based » (:9-12).
2. **Route** : `/{locale}/wallet`.
3. **Objectif (affiché)** : montrer à l'opérateur ce que verrait un client (wallet fidélité, suivi commande, chat cuisine, parrainage). **Réalité : 100 % maquette statique, zéro donnée.**
4. **Persona** : restaurant/admin (middleware.ts:34). Rendu dans l'OperatorShell.
5. **Données backend** : **AUCUNE.** Server component sans fetch ni Prisma.
6. **Actions** : AUCUNE fonctionnelle.
7-8. **Éditables / read-only** : rien d'éditable ; l'input « Message… » est `readOnly` (:55-59).
9. **CTA** : bouton envoi chat (icône MessageCircle) — aucun onClick, **MORT** (:60-62) ; bouton partage (icône Share2) — aucun onClick, **MORT** (:72-74).
10-17. **Filtres / recherche / pagination / états / empty / loading / error / success : N'EXISTENT PAS.** Un seul état statique.
18. **Disabled** : input chat `readOnly`.
19. **Mobile** : Tailwind `max-w-lg mx-auto` (~512 px), padding `px-5` (:7).
20. **Desktop** : `md:max-w-3xl` (~768 px) — **très étroit dans un shell qui offre 1520 px** ; divergent des autres pages op-.
21. **Composants** : **ANCIEN design system** — `Card`/`SectionTitle` de `components/grubano/*` + icônes **lucide-react** (QrCode, MessageCircle, Share2, MapPin — :1-3).
22-23. **APIs / Flags** : AUCUNE / AUCUN.
24. **Hardcodes — la page entière est fictive** : « 487 pts », « Tier Silver · 113 pts jusqu'à Gold » (:19-20) ; suivi « Livreur à 4 min » avec stepper Reçue/En cuisine/En route/Livrée figé à l'étape 3 (:31-41) ; conversation chat inventée (« Plus de sauce s'il vous plaît 🙏 » / « C'est noté ! On ajoute du pesto en plus. », :47-52) ; lien de parrainage fictif « grubano.app/r/sarah » + « +100 pts par inscription » (:69-70 — **aucun système de parrainage client n'existe dans le backend**).
25. **Contrôles morts** : les 2 boutons ci-dessus.
26. **Dette** : page **ORPHELINE** (aucun lien entrant) + chrome legacy (Card/lucide) + textes FR en dur hors i18n + données mensongères présentées sans aucun marqueur « aperçu/bientôt » (contrairement à /cashflow, le modèle honnête). **C'est la seule page de la famille qui AFFICHE des chiffres inventés comme s'ils étaient réels.**

## NOTE FACTUELLE : /pricing et /premium = redirects vers /more

- `/pricing` : `pricing/page.tsx:14-16` — `redirect('/{locale}/more')`, **INCONDITIONNEL**. L'ancien mock (frais en dur 2,90 € livraison / 15,00 € min / 0,50 € emballage / +5 %, bouton « Enregistrer » inerte, « Premium 29 €/mois » fictif) retiré au SHA 981c05d (commentaire :3-13).
- `/premium` : `premium/page.tsx:10-12` — redirect direct vers `/more` ; l'ancienne page vendait un essai « Démarrer 14 jours gratuits » inventé (:1-9).
- Conséquence produit : **aucun abonnement opérateur, aucune page tarification n'existe.** Le bloc Premium/billing de /more a également été retiré (PART 18).

## Dette design factuelle (PART 13 + 14)

- **Modal refund inatteignable** sur /finance (code + i18n morts).
- **/wallet = corps étranger** : ancien DS, largeur ~768 px dans un shell 1520 px, textes FR non i18n, chiffres fictifs SANS marqueur d'aperçu.
- **2 pages orphelines** : `/wallet` et `/cashflow` — aucune nav, toujours gatées et déployées.
- **« Actualiser » = `location.reload()`** sur les 3 pages op- (analytics:184, finance:160, cashflow:46) — pattern uniforme mais rudimentaire.
- **Horodatage trompeur léger** : « Dernière mise à jour »/« Actualisé à » = heure du RENDU client, pas des données serveur.
- **Incohérence de source de données non signalée à l'écran** : /analytics agrège `LoyaltyOrder` (UberEats/fidélité) tandis que /finance agrège `Order` (commandes Grubano). Deux pages voisines dans le groupe « Pilotage » peuvent afficher des CA sans rapport, sans mention de la source.
- **Valeur créateurs calculée mais invisible** (`caAmeneParCreateurs`/`ordersFromCreators` jamais affichés).
- **Toggle horizon cosmétique** sur /cashflow (30/60/90 j ne change que des libellés).
- **Breakpoints CSS custom (880/460 px)** dans analytics/finance/cashflow vs breakpoints Tailwind (768/1024) de /wallet — deux systèmes responsive dans la même famille.

## Ce qui N'EXISTE PAS (PART 13 + 14)

- **Analytics** : pas de dates personnalisées ; pas de comparaison période précédente (aucune tendance %) ; pas de ventilation par plat ; pas de heatmap jour × heure (agrégat horaire seul, 10h–23h) ; pas de couverts ; pas d'export (CSV/PDF) ; pas de filtre par marque ni par canal ; pas de commandes/panier sur 7 j ; les données /eat (modèle Order) ne sont PAS dans ces graphiques.
- **Finances** : pas de versements SEPA réels (montant, date, compte — tout « bientôt ») ; pas de connexion de compte bancaire ; pas d'échéancier ; pas de journal de transactions ligne à ligne ; pas de factures/relevés PDF téléchargeables sur cet écran ; pas de remboursement exécutable (gate-2) ; pas de sélecteur de période (30 j fixe) ; pas d'export comptable.
- **Trésorerie** : aucune projection réelle, aucun solde, aucune alerte réelle — 0 backend, 0 API.
- **Wallet** : aucun vrai wallet client côté opérateur — pas de chat cuisine, pas de parrainage client, pas de suivi livreur en temps réel ; tout est décor.
- **Global** : aucun abonnement/plan/facturation opérateur (Premium retiré) ; aucune page tarification (redirects).

---
# PART 15 — MARQUES (`/brands` + `/brands/[id]/franchise`)

Toutes ces pages rendent LEUR contenu seul — le chrome (sidebar navy, topbar, bottom-nav) est fourni par `AppChrome → OperatorShell` (commentaire `app/[locale]/brands/page.tsx:13-15`).

## 15.1 Page `/brands` — « Marques »

1. **Nom utilisateur** : « **Marques** » (h1, `brands.title`), sous-titre « **Regroupez vos établissements sous une même identité** » (`brands.marquesSubtitle`). Rendu page.tsx:375-376.
2. **Route** : `/[locale]/brands` (client, `'use client'`). Deep-link `?restaurantId=…` (:107-108) : envoyé par le hub, pré-ouvre la modale de création (:190-192) et cible ce restaurant.
3. **Objectif métier** : lister les marques virtuelles de l'opérateur (concepts de dark kitchen), en créer (de zéro ou par copie vers un établissement) et accéder au hub de l'établissement rattaché.
4. **Persona/permission** : `restaurant`/`admin` (OPERATOR_FLAT middleware.ts:34, gate :251-255). Un 401 API redirige vers `/auth/magic` (:224).
5. **Données backend** : `GET /api/brands/summary` → `{brands:[{id,name,emoji,platform,status,restaurantId,menuCount,adoptedDishCount}], performance:{windowDays:30,caBrut,ordersTotal}}` (:36-47 ; API `app/api/brands/summary/route.ts:77-140` — CA = somme des `Order.subtotal` 30 jours hors `cancelled/awaiting_payment/expired`, :130). `GET /api/establishments` → `{establishments:[{id,name,city,isActive}], currentId}` (:150-157).
6. **Actions** : créer une marque de zéro ; copier une marque vers un établissement ; ré-adopter des recettes créateurs exclues après copie ; ouvrir le hub d'un établissement rattaché (« Gérer »).
7. **Champs éditables** (modale création, mode « Repartir de zéro ») : Nom (« **Nom de la marque** », input maxLength 80, :546-554) ; Type de cuisine (9 chips : Italien/Asiatique/Burger/Healthy/Sushi/Desserts/Wraps/Pâtes/Autre, :52-62 + 560-573) ; Emoji (14 chips 🍕🍜🍔🥗🍣🍰🥙🍝🌮🍱🥘🥟🍴🥐, :63 + 579-591) ; Slogan (« **Slogan (optionnel)** », maxLength 140, :594-603). Mode « Copier une marque » : select « **Marque à copier** » + select « **Établissement cible** » (:616-644).
8. **Read-only** : strip de stats (nb marques, « Établissements au total », « CA toutes marques confondues », « Commandes », :398-415) ; par carte : monogramme (gradient déterministe présentation-only, :67-83), plateforme, pill statut, compteur établissements rattachés (0 ou 1), « Plats au menu », « Plats adoptés » (:425-465).
9. **CTA** :

| Label FR | Surface | Action | Effet backend | Persisté | Fonctionne | Mort |
|---|---|---|---|---|---|---|
| « Créer une marque » | head + empty state | ouvre la modale (mode scratch) | non | — | oui (:378-380, 390-393) | non |
| « Repartir de zéro » / « Copier une marque » | toggle modale | change le mode | non | — | oui (:513-527) ; « Copier » disabled si 0 marque (:524) | non |
| « Créer » | pied de modale (scratch) | `POST /api/brands` {name,emoji,cuisineType,tagline,restaurantId} | crée `Brand` (restaurantId vérifié owner, 400 « Établissement invalide » sinon — `app/api/brands/route.ts:126-130`) | oui | oui ; redirige vers `/dashboard/establishments/{id}` (:232-234) | non |
| « Copier la marque » | pied de modale (copy) | `POST /api/brands/copy` {sourceBrandId,targetRestaurantId} | duplique la marque + menu | oui | oui ; si `excludedAdoptions` → modale ré-adoption, sinon redirige hub cible (:266-279) | non |
| « Ré-adopter » (par ligne) | modale ré-adoption | `POST /api/dishes/adopt` {creatorDishId,brandId,sellingPrice} | adopte la recette | oui | oui ; 409 `city_taken` → badge « Ville déjà prise » (:304-307) | non |
| « Terminé » | pied modale ré-adoption | ferme + redirige vers hub cible | non | — | oui (:314-319) | non |
| « Gérer » | carte marque rattachée | Link `/dashboard/establishments/{restaurantId}` | non | — | oui (:470-476) | non |
| « Gérer · Bientôt » | carte marque NON rattachée | aucune | non | — | **INERTE volontaire** — span `aria-disabled` ; « the detail route /brands/[id] doesn't exist yet » (:467-482) | oui |
| « Annuler » / ✕ | modale | ferme (bloqué pendant save/copy, :195) | non | — | oui | non |
| « Réessayer » | état erreur | recharge les 2 GET | non | — | oui (:356-358) | non |

10. **Filtres** : **N'EXISTENT PAS.** (Les clés i18n `brands.statusAll` « Statut : Tous », `filterAllPlatforms` « Toutes plateformes », `sortMost/sortLeast` existent dans fr.json mais ne sont référencées nulle part — legacy.)
11. **Recherche : N'EXISTE PAS.** 12. **Pagination : N'EXISTE PAS.**
13. **États métier d'une marque** : `status === 'active'` → pill « **Active** » ; tout autre statut → « **Brouillon** » (:322-323, 434-435). Rattachée (restaurantId non nul) vs détachée (compteur 0 + « Gérer » inerte).
14. **Empty state** : « **Aucune marque pour l'instant** » + « **Regroupez vos établissements sous une marque commune — utile pour les franchises et les groupes multi-sites.** » + CTA « Créer une marque » (:383-394).
15. **Loading** : skeleton complet (head + strip + 3 cartes 210px, `op-sk`, :326-345).
16. **Error** : carte `cloud_off` « **Impossible de charger vos marques** » + réessayer (:348-363). Erreurs formulaire en `op-callout--danger` inline (« Le nom est obligatoire. », « Erreur réseau, réessaie. », « Copie impossible. Réessaie. »…).
17. **Success** : création scratch → redirection vers le hub cible ; fallback sans établissement → callout vert « Créer ✓ » (:536-541). Copie → modale de ré-adoption ou redirection.
18. **Disabled** : « Copier une marque » (toggle) si 0 marque ; « Copier la marque » si `copying || !copyTarget || 0 marque` (:674) ; « Créer » pendant `saving` (:664) ; « Ré-adopter » pendant loading (:733).
19. **Mobile** : brands.css — grille 3 col → 2 col ≤1180px → 1 col ≤880px ; head en colonne, bouton « add » pleine largeur, stat-strip empilée ≤880 ; pieds de modale empilés colonne inversée ≤460 (:167-183).
20. **Desktop** : grille `repeat(3,1fr)` gap 16 (brands.css:69) ; modale `max-width:560px` (`op-modal.wide`, :102).
21. **Composants** : page monolithique + classes `op-*`, Material Symbols (`span.ms`), `formatEuros`. Aucun shadcn.
22. **APIs** : `GET /api/brands/summary` ; `GET /api/establishments` ; `POST /api/brands` ; `POST /api/brands/copy` ; `POST /api/dishes/adopt`.
23. **Flags** : aucun.
24. **Hardcodes** : gradients de monogramme en dur (7 valeurs, :67-75) ; `POST /api/brands` a `platform` par défaut **`'ubereats'`** côté serveur (`app/api/brands/route.ts:15`) — la carte affiche `b.platform` brut ou « Grubano » en fallback (:432) : **une marque créée depuis cette page affichera « ubereats » comme sous-titre alors que l'UI n'offre aucun choix de plateforme** ; fenêtre de perf fixe 30 jours (summary/route.ts:52).
25. **Contrôles morts** : « Gérer · Bientôt » sur marque détachée — seul contrôle inerte, honnêtement étiqueté.
26. **Dette legacy** : ~10 clés i18n `brands.*` orphelines (`conceptsActive`, `statusAll`, `sortMost`, `badgeActive`, `addBrand`, `perfTitle/perfSubtitle`, `brandKind`, `pageTitleCreate`, `backToHub`) ; route détail `/brands/[id]` inexistante (seule `/brands/[id]/franchise` existe).

## 15.2 Sous-page `/brands/[id]/franchise` — « Conditions de franchise »

1. **Nom** : « **Conditions de franchise** » (`brands.franchise.title` / `tabFranchise`) ; back-link « Marques » (`brandsBack`).
2. **Route** : `/[locale]/brands/[id]/franchise` (client). Gate middleware `/brands` + owner-scoped serveur (« a non-owner gets 403/404 », page.tsx:11).
3. **Objectif** : le propriétaire d'une marque définit les conditions auxquelles elle est proposée en franchise (sous-titre : « **Définissez les conditions auxquelles votre marque est proposée en franchise.** »).
4. **Persona** : opérateur propriétaire de la marque (ou admin).
5. **Données backend** : `GET /api/brands/[id]` → `Brand.{name,emoji,cuisineType,status,openToFranchise,royaltyPct,setupFee,franchiseZones,franchiseStatus}` (:19-30, 54-75). `royaltyPct` stocké en **FRACTION** (0.06), le formulaire travaille en **POURCENT** et convertit (:15-16, 67, 91).
6. **Actions** : activer/désactiver « Ouverte à la franchise » ; fixer taux de royalties, frais d'installation, zones, statut ; enregistrer.
7. **Champs éditables** : toggle « **Ouverte à la franchise** » (op-switch, :213) ; « **Taux de royalties (%)** » (number 0–50 step 0.1, placeholder « 6 », vide = défaut 6 % — hint « **Laissez vide pour le taux par défaut (6 %).** », :226-229) ; « **Frais d'installation (€)** » (number ≥0, :233-236) ; « **Statut de la franchise** » (select Aucun/Ouverte/Complète, :242-246) ; « **Zones / villes autorisées** » (textarea « **Une ville par ligne (ou séparées par des virgules).** », max 50 zones — `.slice(0,50)` :97).
8. **Read-only** : header marque (monogramme emoji/initiales, nom, pill « Active »/« Brouillon », cuisine ou « Cuisine non renseignée », :162-173) ; stat strip « Ouverte à la franchise : Oui/Non » + « Zones autorisées : N » (:176-185) ; bloc « **Récapitulatif** » (valeurs actuelles : « 6 % (par défaut) », « Aucun » pour frais vides, :275-302) ; chips zones avec re-lecture honnête (:263-271).
9. **CTA** : « Marques » (back, Link :130-132) ; « **Enregistrer** » / « Enregistrement… » (savebar) → `PATCH /api/brands/[id]` {openToFranchise,royaltyPct,setupFee,franchiseZones,franchiseStatus} (:101-108) + scroll top + bannière succès ; onglet « Conditions de franchise » (tablist) — **statique**, 1 seul tab non cliquable utilement (:188-190).
10-12. **Filtres/recherche/pagination : N'EXISTENT PAS.**
13. **États métier** : statut marque active/brouillon (affichage) ; franchiseStatus none/open/full.
14. **Empty state** : zones vides → « **Aucune zone renseignée — la marque est proposée sans restriction géographique.** » (:270).
15. **Loading** : skeletons `op-sk` (:136-145).
16. **Error** : `cloud_off` « **Impossible de charger cette marque** » + retour Marques (:146-157) ; erreur inline `role="alert"` (« **Le taux doit être compris entre 0 et 50 %.** », « **Une erreur est survenue. Veuillez réessayer.** »).
17. **Success** : bannière verte « **Conditions enregistrées** » / « **Les conditions de franchise de votre marque ont été mises à jour.** » (:192-197) ; disparaît à la première modification (:78).
18. **Disabled** : « Enregistrer » pendant `saving` (:305).
19-20. **Responsive** : styles dans `franchise.css` ; même shell op-.
21-23. **Composants / APIs / Flags** : classes op-*, Material Symbols, formatEuros ; `GET`+`PATCH /api/brands/[id]` ; aucun flag (la consommation côté franchisé est gatée ailleurs).
24. **Hardcodes** : défaut 6 % de royalties (:283 + serveur) ; plafond 50 % (:90) ; 50 zones max (:97).
25. **Contrôles morts** : l'unique onglet « Conditions de franchise » est un bouton `role="tab"` sans handler (:189).
26. **Dette** : accessible uniquement via un petit lien texte « **Conditions de franchise →** » enfoui dans la modale d'édition de marque du hub (`EstablishmentHub.tsx:613-618`) — aucune autre entrée de navigation.

---

# PART 16 — ÉTABLISSEMENTS (liste + hub, vue d'ensemble)

## 16.1 Page `/dashboard/establishments` — « Établissements »

1. **Nom utilisateur** : titre h1 = `establishment.label` + « s » concaténé en dur → « **Établissements** » (`EstablishmentsManager.tsx:209`) ; sous-titre « **{count} établissement(s) rattaché(s) à ton compte.** » (`manageSubtitle`).
2. **Route** : server component (`page.tsx`) + client `components/dashboard/EstablishmentsManager.tsx`.
3. **Objectif** : lister tous les établissements de l'opérateur, en sélectionner un comme actif (cookie durable), en créer un nouveau (soumis à validation admin), ouvrir le hub d'un établissement.
4. **Persona** : session obligatoire (redirect `/auth/magic`, page.tsx:24-27) ; rôle `restaurant`/`admin` sinon EmptyState 🔒 « **Accès réservé aux restaurants** » / « **Cette page est uniquement disponible pour les comptes opérateurs de restaurant.** » (page.tsx:34-44).
5. **Données backend** : Prisma direct serveur — `Restaurant.findMany({operatorId, archivedAt:null}, orderBy createdAt asc, select {id,name,city,address,isActive})` (page.tsx:46-50) ; établissement courant résolu du cookie `ESTABLISHMENT_COOKIE` via `pickEstablishment` (:56-59).
6. **Actions** : ouvrir le hub (clic ligne ou « Gérer ») ; « Voir ce tableau de bord » (pose le cookie + navigue `/dashboard`) ; « Ajouter un établissement » (modale).
7. **Champs éditables** (modale « **Nouvel établissement** ») : « **Nom de l'établissement** » (maxLength 120, placeholder « Ex. Grubano Lyon Part-Dieu ») ; « **Ville** » (maxLength 100, « Lyon ») ; « **Adresse** » (maxLength 300, « 12 rue de la République ») ; « **Type de cuisine** » (9 chips, mêmes valeurs que /brands, Manager:15-25) ; « **Description (optionnel)** » (textarea maxLength 2000) ; « **Logo (optionnel)** » et « **Photo de couverture (optionnel)** » (inputs URL http(s), Manager:407-429) — hint « **Colle un lien d'image. Si vide, un visuel par défaut est utilisé.** » **Le logo/cover se saisit par URL collée — il n'y a PAS d'upload de fichier.**
8. **Read-only** : stat strip « Établissements : N » + « Publié : N » (compte des `isActive`, Manager:218-231) ; par ligne : logo-initiales gradient (présentation, Manager:35-53), nom, « ville · adresse », chip « **Sélectionné** » (si courant), badge « **Publié** » / « **Non publié** ».
9. **CTA** :

| Label FR | Surface | Action | Effet backend | Persisté | Fonctionne | Mort |
|---|---|---|---|---|---|---|
| « Ajouter un établissement » | head + empty state | ouvre la modale | non | — | oui (:212-214, 240-242) | non |
| ligne entière (overlay `est-list-row__link`) | liste | Link `/dashboard/establishments/{id}` | non | — | oui (:257-261) | non |
| « Gérer » | ligne | Link même cible que la ligne | non | — | oui (:289-294) | non |
| « Voir ce tableau de bord » | ligne | pose cookie `ESTABLISHMENT_COOKIE` + `router.push('/dashboard')` | non (cookie client) | cookie durable | oui, spinner lié à la transition (:115-120, 297-311) | non |
| « Créer l'établissement » | pied de modale | `POST /api/restaurants` avec `additional:true` | crée `Restaurant` avec **`isActive:false` FORCÉ serveur** (« admin review », api/restaurants/route.ts:413-436) ; géocode BAN | oui | oui ; pose le cookie sur le nouveau + `router.refresh()` (:183-192) | non |
| « Annuler » / ✕ | modale | ferme | non | — | oui | non |

10-12. **Filtres / Recherche / Pagination : N'EXISTENT PAS.**
13. **États métier** : `isActive` = **PUBLICATION gérée par l'admin** (visible sur /eat), PAS un état ouvert/fermé — commentaire explicite Manager:200-202 et 280-283 ; badge « Publié »/« Non publié » (`operator.status.published/unpublished`). Chip « Sélectionné » = établissement actif du cookie.
14. **Empty state** : « **Aucun établissement pour l'instant** » + « **Ajoutez votre premier établissement pour activer les commandes, les réservations et le stock.** » + CTA (:233-244).
15. **Loading** : server component (pas de skeleton) ; « Voir ce tableau de bord » affiche un `op-spin` pendant la transition.
16. **Error** : erreurs formulaire inline `op-note--danger` (« **Le nom est obligatoire.** », « **Ville invalide — saisis le nom d'une vraie ville (pas un type de cuisine).** », « **Adresse invalide — saisis une adresse complète (numéro et rue).** », « **Lien d'image invalide (doit commencer par http).** », « **Création impossible. Vérifie les champs.** », « **Erreur réseau, réessaie.** »). Validation client : ville ≥2 chars et ≠ mot-clé cuisine (:139-142) ; adresse plausible via `isPlausibleAddress` (:147-150) ; URLs http(s) (:152-157). Le serveur ré-applique tout.
17. **Success** : toast inline auto-dismiss 4 s (:106-110) — « **Établissement créé. Il est maintenant sélectionné.** » OU warning si `geocodeStatus === 'not_found'` : « **Établissement créé, mais l'adresse n'a pas pu être vérifiée — contrôle l'orthographe de la ville et de l'adresse.** » (:190-191). Une panne BAN ne déclenche PAS le warning (:188-189).
18. **Disabled** : « Créer l'établissement » pendant `saving` (:440) ; « Voir ce tableau de bord » pendant sa propre transition (:300).
19. **Mobile** : `establishments.css:259-272` — ≤880px : stat-strip en colonne, bouton add pleine largeur, `est-list-row` en flex-wrap, badges pleine largeur, chips cuisine 3 colonnes ; ≤460px : titre 20px, pieds de modale empilés.
20. **Desktop** : liste dans une `op-card` unique, lignes empilées ; modale `max-width:520px` (css:186). Note métier importante : la modale affirme « **Le nouvel établissement est créé hors ligne. Il devient visible sur Grubano après validation.** » (`createdHint`, Manager:431-434) — exact (isActive forcé false serveur).
21. **Composants** : `EstablishmentsManager` (client), classes op-*, Material Symbols, `EmptyState` design-system (refus de rôle uniquement).
22. **APIs** : `POST /api/restaurants` (additional:true) ; lecture Prisma serveur (pas d'API GET pour la liste ici).
23. **Flags** : aucun.
24. **Hardcodes** : gradients de ligne (6 paires, Manager:35-42) ; toast 4000 ms (:109).
25. **Contrôles morts** : aucun. (Redondance factuelle : la ligne cliquable ET « Gérer » ouvrent la même cible.)
26. **Dette legacy** : classes CSS `estab-openclosed open/closed` conservées pour le badge alors que le sens est désormais Publié/Non publié (Manager:283 — « Chip classes kept (cosmetic only) ») ; clés i18n orphelines `establishment.statOpenNow` « Ouverts maintenant » (l'ancien mensonge), `liveChip`/`offlineChip`, `openHub`, `manageTitle`, `manageLink` ; titre h1 construit par concaténation `{t('label')}s` (Manager:209) — fragile en i18n.

## 16.2 Hub `/dashboard/establishments/[id]` — vue d'ensemble

1. **Nom** : pas de titre de page dédié — le header est la carte identité de l'établissement (nom + badge + adresse). Back-link « **Mes établissements** » (`dashboard.hub.bcRoot`, `EstablishmentHub.tsx:343-346`).
2. **Route** : server component (`page.tsx`) + client `components/hub/EstablishmentHub.tsx`.
3. **Objectif** : fiche de gestion d'UN établissement : ses marques (cœur), horaires, adresse, encaissements Stripe, zone sensible (pause + suppression).
4. **Persona** : session requise + rôle restaurant/admin (page.tsx:23-43, même EmptyState 🔒) ; lookup **owner-scoped** : un id étranger/inconnu redirige vers `/dashboard/establishments` — jamais un 404 (page.tsx:45-53).
5. **Données backend** : serveur : `Restaurant.{id,name,city,address,isActive}` + `establishmentsCount` (nb non archivés du compte, page.tsx:57-59 — pilote l'adaptation N=1). Client : `GET /api/brands/summary` (Hub:144-155).
6. **Ordre RÉEL des sections** (Hub:334-530) : ① OnboardingGuide + OnboardingChat (auto-gating, rendent null flag OFF) → ② back-link → ③ header (logo initiales gradient, nom, badge « **En ligne** »/« **Hors ligne** », « ville · adresse », bouton « **Voir le tableau de bord** ») → ④ SitePrefillImport → ⑤ LogoPrefillImport → ⑥ « **Vos marques** » (grille) → ⑦ Horaires d'ouverture (OpeningHoursSection) → ⑧ « **Adresse de l'établissement** » (AddressSection) → ⑨ « **Encaissements** » (ConnectCard) → ⑩ « **Zone sensible** » (pause + suppression). Sections ⑦-⑩ détaillées en PART 17.
7. **CTA du header** : « Mes établissements » (Link liste, :343-346) ; « Voir le tableau de bord » — `window.location.href='/dashboard'` (**ne pose PAS le cookie**, contrairement au bouton de la liste, :363-369).
8. **États métier du header** : badge « En ligne » / « Hors ligne » piloté par `isActive` (:356-359) — **même champ que « Publié/Non publié » de la liste, libellé différent** (voir Dette PART 17). Mis à jour en live après un PATCH pause (:264).
9. **Mobile/Desktop** : css partagée `establishments.css` — grille marques 2 col → 1 col ≤1040 (:257-258) ; ≤880 danger-row empilée boutons pleine largeur (:268-270), field-rows en colonne ; ≤460 `est-head` padding réduit. Desktop : marques en `grid repeat(2,1fr)` gap 12 (:219) ; chaque section dans `est-embedded-section`.
10. **Composants** : EstablishmentHub + OpeningHoursSection + AddressSection + ConnectCard + SitePrefillImport + LogoPrefillImport + OnboardingGuide/Chat.
11. **Flags du hub** : `ONBOARDING_GUIDE_ENABLED` (OnboardingGuide.tsx:12), `ONBOARDING_AI_CHAT_ENABLED` (OnboardingChat:9), `ONBOARDING_AI_SITE_PREFILL_ENABLED` (prefill-site/route.ts:20), `ONBOARDING_AI_LOGO_PREFILL_ENABLED` (logo-prefill/route.ts:19) — les 4 composants se sondent eux-mêmes par GET et rendent NULL si OFF.

## 16.3 Section « Vos marques » (cœur du hub)

- Titre « **Vos marques** » + hint « **Cliquez une marque pour ouvrir son menu** » (Hub:378-381).
- **Scoping factuel** : à N=1 établissement, TOUTES les marques du compte sont montrées ; le filtre par `restaurantId` ne s'applique que si `establishmentsCount > 1` ET qu'au moins une marque porte un `restaurantId` (Hub:174-180).
- **Carte marque** : emoji-tuile, nom, statut « **Active** »/« **En pause** » (`status==='active'`, Hub:415-418), pied « N plats » + « N créateurs ». Clic principal = stretched-link vers **`/menu?brand={id}`** (Hub:409). Boutons levés : crayon (éditer) et poubelle (supprimer) (Hub:421-438).
- **Tuile « Ajouter une marque »** + hint « **Vierge ou copier une marque existante** » → Link `/brands?restaurantId={id}` (Hub:450-454).
- **Loading** : « Chargement… » + spinner (Hub:383-386). **Empty** : « **Aucune marque pour le moment** » / « **Ajoutez votre première marque pour démarrer votre carte.** » + CTA « Créer une marque » → `/brands?restaurantId={id}` (Hub:387-401).
- **Modale « Modifier la marque »** : mêmes champs que la création /brands (nom 80, cuisine 9 chips, emoji 14, slogan 140) ; hydratée par `GET /api/brands/[id]` avec seed optimiste depuis le summary (Hub:185-207) ; save = `PATCH /api/brands/[id]` {name,emoji,cuisineType,tagline} (Hub:219-227) ; contient le lien « **Conditions de franchise →** » vers `/brands/[id]/franchise` (Hub:613-618). « Enregistrer » disabled pendant `saving || editLoading` (:624).
- **Modale « Supprimer la marque ? »** : corps « **Tu es sur le point de supprimer « {name} ». Cette action est définitive.** » ; warning si plats : « **Cette marque a {count} plat(s) au menu — supprime-les d'abord.** » (Hub:649-653). `DELETE /api/brands/[id]` ; refus mappés par `reason` (`app/api/brands/[id]/route.ts:137-154`) : `has_menu_items` → « **Impossible : la marque contient encore des plats. Supprime-les d'abord.** » ; `last_brand_active_restaurant` → « **Impossible : c'est la dernière marque d'un restaurant en ligne.** » ; `has_related_data` → « **Impossible : des commandes ou données sont liées à cette marque.** » (Hub:313-320).

---

# PART 17 — ADRESSE / HORAIRES / MODES DE SERVICE / CONNECT

## 17.1 Section « Horaires d'ouverture » (`components/hours/OpeningHoursSection.tsx`)

1. **Nom** : « **Horaires d'ouverture** » (`hours.sectionTitle`) ; intro : « **Vos horaires pilotent les créneaux de réservation, le badge « Ouvert / Fermé » de votre fiche et l'acceptation des commandes.** »
2. **Objectif** : CRUD des horaires hebdomadaires + fermetures exceptionnelles, avec gestion des conflits de réservations.
3. **Modèle de saisie RÉEL** (à comprendre pour tout redesign) :
   - Grille 7 jours affichés **Lundi→Dimanche** (ordre `DAYS_ORDER=[1..6,0]`, :56) ; `dayOfWeek` reste la convention JS 0=dimanche.
   - Chaque jour porte **0..n plages** `{open, close}` en texte libre « HH:mm » ; **0 plage = « Fermé ce jour »** (badge, :379-383).
   - Saisie tolérante : « 9 » → « 09:00 », « 19h30 » → « 19:30 », « 24 » → « 24:00 » (normalizeTime, :65-75), normalisée au blur (:425, 435).
   - **Plages de nuit valides** : close < open (ex. 19:00→01:00) → badge « **lendemain** » (:441-446) ; « 24:00 » accepté comme fermeture uniquement (open=24:00 → « **Heure invalide — utilisez le format HH:mm (ex. 19:00).** », :206).
   - Boutons par jour : copier (« **Appliquer à tous les jours** » — copie AUSSI un jour fermé, note « **Horaires du jour copiés sur toute la semaine — pensez à enregistrer.** »), ✕ (« **Fermé ce jour** » = vider), + (« **Ajouter une plage** », défaut 19:00–22:00, :174).
   - Édits **locaux** jusqu'à « **Enregistrer les horaires** » = **UN PUT atomique** remplaçant tout le set (`PUT /api/restaurants/[id]/hours` {hours:[{dayOfWeek,openTime,closeTime}]}, :213-217) ; erreurs serveur (chevauchement intra-jour…) affichées telles quelles.
   - Badges d'état : « **Modifications non enregistrées** » (ambre) / « **Horaires enregistrés** » (vert 2,5 s, :150-154).
   - Jamais configuré : encart « **Aucun horaire configuré : tout est permis (réservations et commandes à toute heure). Configurez vos horaires pour qu'ils fassent foi.** » (:355-359).
   - Hint permanent : « **Format 19:00 — une fermeture après minuit (ex. 01:00) est valide ; « 24:00 » = minuit.** »
4. **Fermetures exceptionnelles** : intro « **Congés, jours fériés, travaux… Le motif est visible par vos clients.** » ; formulaire inline (pas une modale) : dates « Du »/« Au » (date pickers, dateEnd ≥ dateStart, :529-543), checkbox « **Fermeture partielle (heures précises)** » → « De »/« À », « **Motif (visible par les clients)** » maxLength 140 placeholder « ex. Congés annuels ». CTA « **Planifier la fermeture** » → `POST /api/restaurants/[id]/closures` SANS confirm (:245-254). Liste : dates formatées, « **Journée entière** » ou plage, motif, poubelle « **Supprimer cette fermeture** » → `DELETE .../closures/[closureId]` (:296-310). Empty : « **Aucune fermeture exceptionnelle planifiée.** »
5. **Modale de conflits** (bottom-sheet mobile / centrée sm:, :651-733) : si le serveur répond `{created:false, conflicts, ongoing}` → titre « **Réservations sur cette période** » ; « **X réservations existent sur cette période. En confirmant, elles seront annulées et les empreintes libérées sans frais.** » (ne compte QUE les annulables) ; encart calme pour les sessions en cours : « **N sessions en cours — les clients à table termineront normalement (commande et paiement restent possibles).** » — jamais annulées ; liste des résas avec SessionBadge + badge « empreinte active »/« sans empreinte » ; « **Confirmer la fermeture** » (rouge si annulations, orange/primary sinon) → re-POST avec `confirm:true` ; toast récap « **Fermeture planifiée — N réservations annulées, M empreinte(s) libérée(s).** » + éventuel « **N empreintes n'ont pas pu être libérées — réglez-les depuis les réservations.** » (:281-286), auto-dismiss 6 s.
6. **États** : loading spinner ; « **Impossible de charger les horaires — réessayez.** » ; disabled save si `!dirty`.
7. **APIs** : GET/PUT `/api/restaurants/[id]/hours` ; GET/POST `/api/restaurants/[id]/closures` ; DELETE `/api/restaurants/[id]/closures/[closureId]`.
8. **⚠️ Design system** : cette section est écrite en **Tailwind/shadcn + icônes lucide** (Clock, Plus, Copy…, :5-8, classes `rounded-2xl border-border bg-card`) — PAS en fondation `op-*` comme le reste du hub (fait de dette).

## 17.2 Section « Adresse de l'établissement » (`components/restaurant/AddressSection.tsx`) — NOUVELLE (train B3)

1. **Nom** : « **Adresse de l'établissement** » (`dashboard.hub.addr.title`) ; desc : « **Corrigez ici l'adresse saisie à l'inscription. Elle détermine la position de votre établissement sur la carte et dans le tri par proximité.** »
2. **Objectif** : réparer une adresse mal saisie à l'onboarding (cas réel documenté : city="30210" / postalCode="Fournès", :10-13).
3. **Champs** : « **Adresse** » (labels réutilisés de `business.onboarding` : `addressLabel`, maxLength 300, autoComplete street-address) ; « **Code postal** » (maxLength 5, inputMode numeric) ; « **Ville** » (maxLength 100). **Le code postal démarre VIDE** (non hydraté du serveur — `useState('')`, :41) même si l'établissement en a un.
4. **Validation client (miroir du serveur)** : 3 champs obligatoires → « **Adresse, code postal et ville sont obligatoires.** » ; adresse plausible (`isPlausibleAddress`) → « **Adresse invalide — saisis une adresse complète (numéro et rue).** » ; CP normalisé FR 5 chiffres (fonctions PARTAGÉES `lib/address-validation` — chiffres fullwidth/arabes inclus, :72-78) → « **Code postal invalide — 5 chiffres attendus (ex. 30210).** » ; ville non 100 % numérique → « **Ville invalide — saisissez un nom de ville (ex. Fournès), pas un code postal.** »
5. **Save** : `PATCH /api/restaurants/[id]` {address,city,postalCode} (:89-97). Serveur : validation stricte France avec reason codes `invalid_address`/`invalid_postal_code`/`invalid_city` (`app/api/restaurants/[id]/route.ts:402-427`) + **re-géocodage OBLIGATOIRE** (IGN/BAN) persisté ATOMIQUEMENT — un échec stocke lat/lng = null, jamais de coords obsolètes (AddressSection:18-21 ; route:434-510).
6. **Feedbacks** : succès « **Adresse enregistrée.** » ; si `geocodeStatus !== 'ok'` ET `coordsKept !== true` → warning `geoWarnNotFound` (wording onboarding) — l'établissement est enregistré SANS coordonnées, hors tri par proximité (:110-116) ; `coordsKept:true` (adresse inchangée + panne géocodeur) → PAS de warning (route:519-521). Toute frappe efface l'état précédent (:50-54). Le header du hub se rafraîchit en live via `onSaved` (Hub:110-113, 469-474).
7. **CTA** : « **Enregistrer l'adresse** » (disabled pendant saving, icône save).
8. **Style** : op-* (settings-block, op-field, op-note) — cohérent avec le hub, contrairement aux horaires.

## 17.3 Section « Encaissements » (`components/connect/ConnectCard.tsx`)

1. **Nom** : « **Encaissements** » (`connect.title`).
2. **Objectif** : configurer/suivre le compte Stripe Connect de l'établissement (reversements).
3. **Données** : `GET /api/restaurants/[id]/connect` → `{status:'none'|'pending'|'active'|'restricted', chargesEnabled, payoutsEnabled, detailsSubmitted}` (:10-13).
4. **4 états réels** (:16-24) :
   - `none` → carte invitation : « **Configurez vos encaissements** » / « **Recevez les paiements de vos clients directement sur votre compte, reversements quotidiens.** » + CTA « **Configurer** ».
   - `pending` → badge orange « **Onboarding à terminer** » + « **Finalisez votre dossier pour activer les encaissements.** » + CTA « **Reprendre** ».
   - `active` → badge vert « **Compte actif — reversements quotidiens** », **aucun CTA** (sobre, :137).
   - `restricted` → badge rouge « **Action requise** » + « **Stripe a besoin d'une information complémentaire pour poursuivre les versements.** » + « Reprendre ».
5. **CTA « Configurer »/« Reprendre »** : `POST /api/restaurants/[id]/connect` → `{url}` = **Account Link Stripe-HOSTED** → `window.location.href = url` (**FLOW EXTERNE** : la page quitte l'app vers Stripe, :50-69 ; retour construit sur `NEXTAUTH_URL`, connect/route.ts:68). Idempotent serveur (jamais un 2ᵉ compte). Échec → « **Impossible d'ouvrir la page Stripe — réessayez.** »
6. **⚠️ Comportement DÉFENSIF** : pendant le chargement OU si le GET échoue, la carte rend **RIEN** (`return null`, :71-72) — la section Encaissements peut être totalement absente du hub sans aucun indice visuel.
7. **N'EXISTE PAS ici** : champs de commission (explicitement non exposés — « Commission fields are NOT exposed (A7) », :24) ; soldes, historique de versements, IBAN.
8. **Style** : Tailwind/shadcn + lucide (Landmark, ChevronRight) — même divergence que les horaires.

## 17.4 Sections « Pré-remplir depuis mon site web » et « Récupérer mon logo depuis mon site »

- **SitePrefillImport** (Hub:373) : flag `ONBOARDING_AI_SITE_PREFILL_ENABLED` — sonde GET `/api/restaurants/prefill-site`, rend null si OFF. ON : coller l'URL → « **Analyser mon site** » → POST extrait un BROUILLON (nom/description/cuisine) → écran « **Proposition — relisez et corrigez** » (champs éditables « **Nom affiché** », « **Description** », « **Types de cuisine** » séparés par virgules, max 6) → « **Confirmer et mettre à jour** » = `PATCH /api/restaurants/[id]` des seuls champs non vides (SitePrefillImport:64-88). RIEN n'est enregistré avant confirmation ; « **Vos informations légales (SIREN, raison sociale) ne sont jamais reprises du site.** » Erreurs dédiées : 429 quota IA, 504 timeout, 400 URL.
- **LogoPrefillImport** (Hub:375) : flag `ONBOARDING_AI_LOGO_PREFILL_ENABLED`. « **Détecter mon logo** » → POST détecte + fetch SSRF-safe → aperçu → « **Confirmer ce logo** » = upload des BYTES vers `/api/restaurants/logo-prefill/apply` puis PATCH du logo (LogoPrefillImport:60-70). Erreur 413 « **Image trop volumineuse.** », `notFound` « **Aucun logo détecté sur ce site. Vous pouvez en ajouter un manuellement.** »
- Les deux `onConfirmed` déclenchent un `window.location.reload()` complet (Hub:373, 375).
- **Style** : composants shadcn (`Card, Button, Input`) + lucide — 3ᵉ langage visuel sur la même page.

## 17.5 Section « Zone sensible » + modale de suppression

- Titre « **Zone sensible** » (`operator.estab.dangerZone`, Hub:485).
- **Rangée 1 — pause** : « **Fermer temporairement** » / « **Suspend la réception de commandes en ligne pour cet établissement** » (ou, si déjà hors ligne : « **Rouvrir l'établissement** » / « **Réactive la réception des commandes en ligne pour cet établissement** »). Bouton ghost → `PATCH /api/restaurants/[id]/pause` {isActive:!isActive} (Hub:248-270). **Règle de publication serveur** : un owner ne peut PAS remettre en ligne un resto jamais approuvé (`approvedAt`) → 403 affiché : « **La première mise en ligne de cet établissement doit être validée par un administrateur.** » (`pause/route.ts:75-91` ; Hub:258). Pendant l'appel : « Mise à jour… ».
- **Rangée 2 — suppression** : « **Supprimer cet établissement** » / intro « **Si cet établissement a des commandes, il sera archivé (son historique sera conservé). Sinon, il sera définitivement supprimé.** » Si dernier établissement : blocker « **C'est votre dernier établissement — créez-en un autre avant de pouvoir supprimer celui-ci.** » et le bouton **n'est pas rendu** (Hub:511-528).
- **Modale « Supprimer cet établissement ? »** : re-saisie EXACTE du nom (« **Tapez « {name} » pour confirmer.** », input sans autocomplete/autocorrect, Hub:727-743) ; « **Supprimer définitivement** » disabled tant que `typed !== name` (:767) ; `DELETE /api/restaurants/[id]` → le serveur décide : commandes > 0 → SOFT (`archivedAt=now`) sinon HARD delete FK-safe, retourne `{mode:'archived'|'deleted'}` (`route.ts:531-581`) ; panneau succès ~1,4 s (« **Établissement archivé (historique préservé).** » / « **Établissement supprimé.** ») puis hard-navigate vers la liste (Hub:287-297, 700-711). Erreurs : 403 « **Vous n'avez pas le droit de supprimer cet établissement.** », 404 « **Cet établissement n'existe plus.** », générique « **La suppression a échoué — réessayez dans un instant.** »

## 17.6 Page `/dashboard/fulfillment` — « Réception des commandes » (modes de service)

1. **Nom** : « **Réception des commandes** » (`operator.fulfillment.title`) ; sous-titre « **Choisissez comment {name} reçoit ses commandes — canaux, délais et barème.** »
2. **Route** : server component (`page.tsx`) + client `components/dashboard/FulfillmentForm.tsx`. **Pas de paramètre d'URL** : l'établissement est résolu par le cookie (fallback = le plus ancien, page.tsx:47-80). ⚠️ Ce n'est PAS une section du hub — page à part, gate `/dashboard` (restaurant/admin, `middleware.ts:200`).
3. **Objectif** : activer/désactiver les 3 canaux (livraison / click & collect / sur place), régler délais et infos de retrait ; afficher le barème (lecture seule).
4. **Données** : Prisma serveur `Restaurant.{deliveryEnabled,pickupEnabled,reservationEnabled,deliveryRadius,pickupPrepTime,deliveryPrepTime,pickupAddress,pickupInstructions,deliveryFee,minOrder}` (page.tsx:50-72).
5. **Champs RÉELLEMENT éditables** (POST `JSON.stringify(form)` intégral, Form:127-131) : toggles **Livraison / Click & collect / Sur place** ; « **Temps de préparation** » livraison ET retrait (number 0–180 min) ; « **Zone de livraison** » (number 0–50 km, hint « **Distance maximale autour du restaurant (0–50 km).** ») ; « **Adresse de retrait** » (hint « **Si différente de l'adresse principale du restaurant.** ») ; « **Instructions de retrait** » (textarea, hint « **Visibles dans la confirmation de commande.** »).
6. **Read-only** : « **Frais de livraison** » et « **Commande minimum** » — VRAI barème (`Restaurant.deliveryFee/minOrder` en euros) affichés verrouillés (icône lock) avec tag « **Bientôt** » — jamais POSTés (Form:281-297).
7. **CTA** :

| Label FR | Surface | Action | Effet backend | Fonctionne | Mort |
|---|---|---|---|---|---|
| toggles Livraison / Click & collect / Sur place | cartes canal | état local | via save | oui (:240-247, 305-313, 366-374) | non |
| « Enregistrer » | save-bar | ouvre modale de confirmation | non | oui ; disabled si `!dirty \|\| 0 canal \|\| saving` (:414-421) | non |
| « Appliquer » | modale « **Confirmer les changements** » (« **Les nouveaux paramètres seront visibles immédiatement par vos clients sur l'app et dans le tunnel de commande.** ») | `POST /api/restaurants/[id]/fulfillment` (body = form) | met à jour Restaurant | oui (:118-152) ; toast « **Paramètres enregistrés** » / « **Les changements sont en ligne immédiatement.** » | non |
| « Annuler » | save-bar | reset au snapshot initial + toast « **Modifications annulées** » | non | oui ; disabled si `!dirty` (:113-116, 407-412) | non |
| « Gérer les réservations & le service à table » | carte Sur place | Link `/tables` | non | oui (:387-390) | non |
| toggle « **Accepter les commandes en ligne** » | héro | AUCUNE | non | **INERTE** — `disabled aria-disabled`, tag « Bientôt » (:186-190) | oui |
| chips « **30 min** » / « **1 h** » / « **Jusqu'à demain** » + « **Reprendre maintenant** » | panneau pause | AUCUNE | non | **INERTES** — disabled, valeur « 19:45 » taguée « exemple » (:196-210) | oui |
| « **Temps de préparation par défaut** » (20) + chips coup de feu « **Aucun / +10 / +20 min** » | carte prep | AUCUNE | non | **INERTES** — disabled + « Bientôt » (:216-230) | oui |
| « **Temps de préparation** » Sur place (18) | carte dine-in | AUCUNE | non | **INERTE** — disabled + « Bientôt » (:379-385) | oui |

8. **Bannière d'honnêteté** en tête : « **Aperçu — bientôt — l'acceptation en ligne, la mise en pause et le coup de feu sont illustratifs et ne sont pas encore reliés depuis cet écran.** » (Form:167-172).
9. **Save-bar** : compteur live « **N canaux actifs** » (warn si 0) + « **Modifications non enregistrées** » ; blocage métier : « **Au moins un mode doit rester actif** » (toast erreur si 0 canal au submit, :119-124).
10. **Note retrait** (informative, non câblée) : « **Le client reçoit un code de retrait (ex. G-4821) à présenter au comptoir.** » (:355-359).
11. **États refus** : rôle non restaurant → « **Accès réservé aux restaurants** » ; 0 établissement → « **Aucun restaurant rattaché** » / « **Créez d'abord votre fiche restaurant pour configurer les modes de service.** » + CTA « **Aller à Marques** » → `/brands` (page.tsx:82-98).
12. **Composants** : mix op-* (op-card/op-switch/op-modal) + `ToastProvider/useToast` shadcn (Form:38-40, 78-83).
13. **Hardcodes** : valeurs illustratives 20 min, 18 min, +10/+20, « 19:45 » (taguées « exemple »/« Bientôt ») ; `Object.assign(initial, form)` mute la prop pour resnap la baseline (Form:143) — pattern atypique factuel.

## Dette design factuelle (PART 15-17)

- **3 langages visuels sur le MÊME écran hub** : marques/adresse/zone sensible en fondation navy `op-*` + Material Symbols (EstablishmentHub.tsx:16-18) ; Horaires et Encaissements en Tailwind shadcn + lucide (`OpeningHoursSection.tsx:5-8`, `ConnectCard.tsx:5`) ; blocs prefill IA en `Card/Button/Input` shadcn (`SitePrefillImport.tsx:6`). Trois familles de boutons, de bordures et d'icônes cohabitent verticalement.
- **Terminologie divergente pour le MÊME champ `isActive`** : liste = « Publié / Non publié » (EstablishmentsManager.tsx:283-286) ; header du hub = « En ligne / Hors ligne » (`dashboard.hub.online/offline`, EstablishmentHub.tsx:356-359) ; zone sensible = « Fermer temporairement / Rouvrir ». Un designer doit savoir que ces trois vocabulaires pointent le même booléen.
- **Classes CSS mensongères conservées** : badge de publication garde `estab-openclosed open/closed` (Manager:283).
- **Carte Encaissements silencieusement absente** : GET en échec ou en cours → `return null` (ConnectCard.tsx:71-72) — aucune trace visuelle qu'une section argent manque.
- **Deux boutons « ouvrir le dashboard » au comportement différent** : la liste pose le cookie AVANT de naviguer (Manager:115-120) ; le header du hub navigue SANS poser le cookie (Hub:363-369) — depuis le hub d'un établissement B, « Voir le tableau de bord » peut afficher le dashboard de l'établissement A (celui du cookie).
- **Redondance de clic** : dans la liste, la ligne entière, « Gérer » ET le nom mènent au même hub, plus un 3ᵉ bouton « Voir ce tableau de bord » sur la même ligne — 3 actions par ligne dont 2 identiques.
- **/dashboard/fulfillment déconnecté du hub** : les modes de service se règlent sur une page sans paramètre pilotée par le cookie alors que tout le reste de la config vit dans le hub par id ; le hub ne contient AUCUN lien vers /dashboard/fulfillment (grep `fulfillment` absent d'EstablishmentHub.tsx ; la clé i18n `dashboard.hub.accessDelivery` « Livraison · Retrait » existe mais n'est référencée nulle part).
- **7 contrôles inertes « Bientôt » sur /dashboard/fulfillment** (toggle acceptation, 3 chips pause + reprendre, prep par défaut, 2 chips rush, prep sur place) — honnêtement tagués mais dessinés comme des contrôles réels.
- **« Gérer · Bientôt » inerte** sur les marques détachées de /brands — la route détail `/brands/[id]` n'existe pas.
- **Entrée unique enfouie** vers `/brands/[id]/franchise` : un lien texte dans la modale d'édition de marque.
- **Titre pluralisé par concaténation** `{t('label')}s` (Manager:209).
- **Clés i18n orphelines** : `establishment.statOpenNow`, `liveChip/offlineChip`, `openHub`, `manageTitle`, `manageLink` ; `brands.conceptsActive/statusAll/sortMost/sortLeast/badgeActive/perfTitle/perfSubtitle/brandKind/pageTitleCreate/backToHub`.
- **Marque neuve étiquetée « ubereats »** : POST /api/brands défaut `platform:'ubereats'` affiché brut en sous-titre — aucun sélecteur de plateforme dans l'UI.
- **Code postal non hydraté** dans AddressSection : le champ démarre vide même quand l'établissement a un CP en base — l'opérateur doit le re-saisir à chaque correction.
- **Tuiles logo = initiales sur gradient hashé** partout (liste, hub, marques) : le champ `Restaurant.logo` existe (saisissable à la création par URL) mais AUCUNE de ces surfaces n'affiche le vrai logo (Manager:43-53 « pure presentation », Hub:79-87, brands/page.tsx:67-83).
- **Reload complet après prefill IA** : `onConfirmed={() => window.location.reload()}` ×2.

## Ce qui N'EXISTE PAS (PART 15-17 — qu'un designer pourrait supposer)

- **Aucune recherche, aucun filtre, aucune pagination, aucun tri** sur /brands, la liste des établissements et les marques du hub.
- **Pas de page détail de marque** (`/brands/[id]` n'existe pas — seule la sous-page franchise existe).
- **Pas d'upload de fichier** pour logo/couverture : uniquement une URL collée (création d'établissement) ou le prefill IA gated par flag ; pas de recadrage, pas de galerie de photos d'établissement.
- **Pas d'édition du nom / de la description / de la cuisine de l'établissement depuis le hub** : le hub n'expose que adresse, horaires, marques, Connect et zone sensible. Nom/description/cuisine ne sont éditables que via le prefill IA (flag OFF par défaut) — aucun formulaire manuel n'existe dans le hub.
- **Pas de choix de plateforme** pour une marque (Uber Eats / Deliveroo…) : le champ existe en base, aucune UI.
- **Pas de fuseaux horaires ni de jours fériés automatiques** dans les horaires ; pas de calendrier visuel — uniquement la grille texte HH:mm et les fermetures datées.
- **Pas de frais de livraison / commande minimum éditables** : affichage verrouillé « Bientôt » (Form:284-296) ; pas de frais par zone, pas de zones de livraison dessinées sur carte (un simple rayon en km).
- **Pas de pause temporisée réelle** (30 min / 1 h / demain) ni de « coup de feu » : blocs illustratifs inertes ; la seule pause réelle est le toggle binaire isActive de la zone sensible du hub.
- **Pas de tableau de bord Stripe intégré** : ni solde, ni historique de versements, ni IBAN, ni commissions — tout se passe sur la page hébergée Stripe.
- **Pas de duplication/archivage manuel d'établissement** : la seule sortie est la suppression (le soft-archive est décidé par le serveur).
- **Pas de gestion multi-utilisateurs / staff / rôles par établissement.**
- **Pas de prévisualisation de la fiche consommateur (/eat)** depuis le hub ou la liste.
- **Pas de statut de validation admin visible** : après création (isActive forcé false), l'opérateur voit « Non publié » mais aucun écran ne montre où en est la revue admin ni de bouton « demander la publication » (la remise en ligne d'un resto jamais approuvé renvoie un 403 texte).
- **Pas d'adresse internationale** : validation strictement française (CP 5 chiffres, géocodage BAN/IGN).

---
# PART 18 — RÉGLAGES (`/more`) + parcours compte & auth partenaire

## 18.A `/more` — « Réglages »

1. **Nom utilisateur** : « **Réglages** » (h1, `more.title`), sous-titre « **Gérez votre compte et vos informations légales** » (`more.subtitle`). Entrée rail : « **Réglages** » (icône `settings`, OperatorShell.tsx:47) ; onglet bottom-nav mobile : « **Plus** » (icône `menu`, :56).
2. **Route** : `/[locale]/more` (`app/[locale]/more/page.tsx`).
3. **Objectif métier** : hub de réglages du partenaire — identité légale KYB (lecture seule), TVA intracommunautaire (éditable), auto-déclaration DAC7 (éditable), liens vers Notifications et pages légales, déconnexion réelle.
4. **Persona / permission** : `restaurant`/`admin` (OPERATOR_FLAT `middleware.ts:36` + gate :251-254) ; sans session → redirect `/login` (:177-180). Rendu dans le shell opérateur navy (page.tsx:4-5).
5. **Données backend** : server component, Prisma direct owner-scoped par email de session : `Operator.{siren, officialName, legalForm, kybStatus, kybVerifiedAt, country}` (page.tsx:29-33). Toute erreur/absence → objet vide (tout `null`, :25). Côté client : session NextAuth (`name`, `email`) pour la ligne « Profil » (MoreClient.tsx:53-55).
6. **Actions** : enregistrer le N° de TVA, enregistrer les infos DAC7, naviguer vers `/notifications`, `/legal/mentions-legales`, `/legal/confidentialite`, se déconnecter. RIEN d'autre.
7. **Champs éditables** : uniquement dans les 2 sous-formulaires (§18.A.2 et §18.A.3). Aucun champ de la page elle-même.
8. **Champs read-only** : Raison sociale + forme juridique (concaténées « · », MoreClient.tsx:137), SIREN (police mono, :141-143), statut KYB (badge, :145-154), ligne Profil (nom · email de session), version « **Grubano Business · v2.4.0** » (`more.version`).

### 18.A.1 CTA

| LABEL FR | SURFACE | ACTION | EFFET BACKEND | PERSISTÉ | FONCTIONNE | MORT |
|---|---|---|---|---|---|---|
| « Profil » (rangée) | Bloc « Compte » | aucune — rangée inerte + pastille « Bientôt » | non | — | non | OUI (inerte assumé, MoreClient.tsx:118) |
| « Sécurité & mot de passe » (sous-texte « Mot de passe, double authentification ») | Bloc « Compte » | inerte + « Bientôt » | non | — | non | OUI (:120) |
| « Langue » | Bloc « Compte » | inerte + « Bientôt » | non | — | non | OUI (:122) |
| « Notifications » (sous-texte « E-mails, alertes de commande ») | Bloc « Compte » | Link → `/notifications` | non | — | OUI (:124) | non |
| « Enregistrer » (TVA) | Form TVA | POST `/api/operator/vat-number` | UPDATE `Operator.vatNumber` | OUI | OUI | non |
| « Enregistrer » (DAC7) | Form DAC7 | POST `/api/operator/dac7` | UPDATE `Operator.{registeredAddress,taxId,taxIdCountry,dateOfBirth,sellerType}` | OUI | OUI | non |
| « Centre d'aide » | Bloc « Aide & support » | inerte + « Bientôt » | non | — | non | OUI (:175) |
| « Contacter le support » | Bloc « Aide & support » | inerte + « Bientôt » | non | — | non | OUI (:177) |
| « Mentions légales » | Bloc « Aide & support » | Link → `/legal/mentions-legales` | non | — | OUI (:179) | non |
| « Politique de confidentialité » | Bloc « Aide & support » | Link → `/legal/confidentialite` | non | — | OUI (:180) | non |
| « Se déconnecter » / « Déconnexion… » | Bas de page | `signOut({ callbackUrl: '/login' })` next-auth | invalide la session JWT | OUI | OUI (:70-75,185-188) | non |

### 18.A.2 Formulaire « N° de TVA intracommunautaire »
Fichier : `components/fiscal/VatNumberForm.tsx`, embarqué byte-identical sous le bandeau « **N° de TVA intracommunautaire** » (`more.legal.vatSection`, MoreClient.tsx:159-162).
- Titre interne « **Informations fiscales** », phrase « **Votre n° de TVA apparaîtra sur les factures de commission Grubano.** ».
- **1 seul champ** : « **N° de TVA intracommunautaire** », placeholder « FR 12 345 678 901 », `maxLength=20` (:55-62). Validation serveur : zod `max(20)` + regex alphanumérique/espaces ; **valeur vide = effacement** (retour à null) (`vat-number/route.ts:29,40-44`).
- APIs : GET puis POST `/api/operator/vat-number` (owner-scoped session, 401 sinon).
- États : le composant retourne `null` tant que le GET initial n'a pas répondu (:31) — **pas de skeleton, le bloc apparaît d'un coup**. Statuts inline : « **N° de TVA enregistré.** » / « **N° de TVA effacé.** » / « **Une erreur est survenue. Réessayez.** ». Bouton avec spinner pendant l'envoi.
- Le pays (`country`) est renvoyé par le GET mais **jamais affiché**.

### 18.A.3 Formulaire « Déclaration DAC7 »
Fichier : `components/fiscal/Dac7FiscalForm.tsx`, sous le bandeau « **Déclaration DAC7** » (`more.legal.dac7Section`). Titre interne « **Informations fiscales DAC7** », phrase « **Requises pour la déclaration des opérateurs de plateforme (UE).** ».
- **Champs éditables** (labels FR réels, `dac7.*`) :
  - « **Type de vendeur** » — select 3 options : « Non spécifié » / « Société » / « Particulier » (:59-63)
  - « **Adresse du siège** » — texte, max 300
  - « **Numéro d'identification fiscale (TIN)** » — texte, max 40 (grille 2 colonnes avec le suivant, :69)
  - « **Pays émetteur du TIN (code ISO)** » — texte, max 2
  - « **Date de naissance (particuliers)** » — input date, **affiché SEULEMENT si Type = Particulier** (:79-84)
- API : GET/POST `/api/operator/dac7` — zod whitelist exacte, champs vides = effacés (null), owner-scoped session.
- États : `null` avant le GET initial (même absence de skeleton), inline « **Informations fiscales enregistrées.** » / erreur, bouton « Enregistrer » avec spinner.

### 18.A.4 Reste des 26 points
10-12. **Filtres / recherche / pagination : N'EXISTENT PAS.**
13. **États métier** : badge KYB — statut brut serveur mappé : `verified` → « **À jour** » (vert), `pending` → « **En cours** » (orange), `rejected` → « **Action requise** » (orange), vide/`none` → « **Non renseigné** » (gris), tout autre statut inconnu → affiché VERBATIM en gris (MoreClient.tsx:60-68). Sous-texte : « **Vérifiée le {date}** » si `kybVerifiedAt`, sinon « **Statut de vérification de votre entreprise** » (:150).
14. **Empty states** : Raison sociale absente → « **Non renseignée — bientôt** » (`more.legal.unset`) ; SIREN absent → rangée inerte avec pastille « Bientôt » (:143).
15. **Loading** : AUCUN skeleton pour la page (server component ; `dynamic='force-dynamic'`, page.tsx:22). Les 2 forms fiscaux disparaissent pendant leur fetch initial. Des classes `.op-sk` existent dans `more.css:54-55` mais **aucun JSX ne les utilise**.
16. **Error** : erreur Prisma/session → identité KYB vide silencieuse (page.tsx:43-44), pas d'écran d'erreur. Forms : message inline rouge. `.op-error__card` définie dans more.css:47-51 mais non utilisée.
17. **Success** : messages inline verts/orange des forms.
18. **Disabled** : « Se déconnecter » désactivé pendant la déconnexion (`disabled={loggingOut}`, opacité .6). Rangées inertes `aria-disabled="true"` sans hover (more.css:63-65).
19. **Mobile** : breakpoint unique **880px** (container query `gbop` + media query, more.css:92-97) — seul effet : masquer les sous-textes `.hide-mobile`. Le shell fournit la bottom-nav (« Plus » actif). Les forms fiscaux gardent leur grille Tailwind (TIN/pays en 2 colonnes même sur mobile).
20. **Desktop** : pleine largeur de la zone de contenu, pas de max-width propre.
21. **Composants** : `MoreClient` (rangées internes `InertRow`/`LinkRow`/`LegalRow`), `VatNumberForm`, `Dac7FiscalForm`, `Button` design-system, Material Symbols, CSS scoped `.gb-op` (more.css).
22. **APIs** : GET+POST `/api/operator/vat-number`, GET+POST `/api/operator/dac7`, `signOut` NextAuth. Lecture Prisma directe server-side pour le KYB.
23. **Flags** : AUCUN.
24. **Hardcodes** : « **Grubano Business · v2.4.0** » — chaîne i18n figée, ne reflète aucune version réelle. 6 rangées « Bientôt ». Les clés i18n `more.billing.*` (« Facturation & abonnement », « Formule actuelle », « Premium »…) **existent encore dans fr.json mais ne sont plus rendues** — le bloc a été retiré (MoreClient.tsx:21-25).
25. **Contrôles morts** : les 5 rangées inertes « Bientôt » (Profil, Sécurité, Langue, Centre d'aide, Contacter le support) — mortes par design assumé, avec pastille honnête.
26. **Dette legacy** : les forms TVA/DAC7 sont en Tailwind/tokens `grubano-*` (fond `bg-white`, VatNumberForm.tsx:61) embarqués dans une page en CSS CD `--op-*` — deux systèmes de style sur le même écran (assumé more.css:85-88). Deux patterns de bouton « Enregistrer » (DS `Button` vs `.op-btn-primary` définis mais inutilisés).

## 18.B Parcours compte & auth partenaire (hors coquille, PartnerShell)

### 18.B.1 `/business/onboarding` — Onboarding partenaire (2 étapes + écran final) — LE parcours vivant

1. **Nom** : pas de titre global ; étape 1 « **Créez votre marque** », étape 2 « **Votre restaurant** », frise interne « **Marque / Restaurant / Terminé** » (`business.onboarding.stepBrand/stepRestaurant/stepDone`).
2. **Route** : `/[locale]/business/onboarding`. Publique au middleware (tout `/business/*` traverse, middleware.ts:143) — le gate est fait PAR LA PAGE via API.
3. **Objectif** : créer la première marque puis le premier restaurant d'un partenaire fraîchement inscrit, pour débloquer son dashboard.
4. **Persona / permission** : gate client au chargement via GET `/api/business/me` (page.tsx:89-134) : 401 ou erreur réseau → `/auth/magic` ; rôle `admin` → `/dashboard` ; tout rôle ≠ `restaurant` → `/eat` ; marque+restaurant déjà créés → `/dashboard`. **Reprise** : marque existante sans restaurant → saute à l'étape 2 avec cuisine/emoji/nom pré-remplis depuis la marque (:119-124), sans jamais recréer la marque (anti-doublon).
5. **Données backend** : `MeResponse` de `/api/business/me` — `Operator.{role,status}`, existence `Brand` (première par `createdAt`) et `Restaurant` non archivé (`app/api/business/me/route.ts:30-46`).
6. **Champs — ÉTAPE 1 « Créez votre marque »** (sous-titre « **Le nom sous lequel vos plats apparaîtront sur Grubano.** ») :
   - « **Nom de la marque** » — requis, max 80, placeholder « Ex. Marco Pizzeria » (:322-330)
   - « **Type de cuisine** » — grille de 9 boutons prédéfinis : Italien 🍕 / Asiatique 🍜 / Burger 🍔 / Healthy 🥗 / Sushi 🍣 / Desserts 🍰 / Wraps 🥙 / Pâtes 🍝 / Autre 🍴 (:35-45) — valeur canonique stockée, défaut `italien`
   - « **Emoji / logo (optionnel)** » — 14 emojis prédéfinis (:47), synchronisé automatiquement avec la cuisine sauf choix manuel (:137-142)
   - CTA « **Continuer** » → POST `/api/brands` `{name, emoji, cuisineType}` (:153-161)
7. **Champs — ÉTAPE 2 « Votre restaurant »** (sous-titre « **Où est-il et comment livre-t-il ?** ») :
   - « **Nom du restaurant** » — requis, max 120, placeholder « Ex. Marco Pizzeria — Paris 11 »
   - « **Description courte (optionnel)** » — textarea 2 lignes, max 2000
   - « **Type de cuisine** » — même grille, ré-éditable, hint « **C'est la catégorie sous laquelle les clients vous trouveront sur Grubano.** »
   - « **Logo (optionnel)** » — **URL d'image collée** (pas d'upload), max 500, hint « **Collez un lien d'image. Si vide, un visuel par défaut selon votre cuisine est utilisé.** » (:444-454)
   - « **Photo de couverture (optionnel)** » — URL, max 500
   - « **Adresse** » — requis, max 300, placeholder « 12 rue de la Paix »
   - « **Ville** » — requis, max 100, hint « **La ville sert à l'exclusivité des recettes (un même plat par ville).** » (2/3 de la grille)
   - « **Code postal** » — optionnel, max 12 (1/3 de la grille, :476-496)
   - « **Comment servez-vous vos clients ?** » — 2 toggles boutons « **Livraison** » (défaut ON) / « **Retrait sur place** » (défaut OFF), hint « **Au moins une option doit être active.** » (:498-517) — **envoyés au POST** comme `deliveryEnabled`/`pickupEnabled` (:225-227)
   - Encart info : « **Votre restaurant sera créé en mode invisible. Notre équipe vérifie votre dossier avant la mise en ligne sur l'app Grubano.** » (`reviewNotice`, :519-521)
   - CTA « **Retour** » (revient à l'étape 1) + « **Terminer** » → POST `/api/restaurants`
8. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND | FONCTIONNE |
|---|---|---|---|---|
| « Continuer » | étape 1 | POST `/api/brands` | CREATE `Brand` | OUI |
| « Retour » | étape 2 | retour étape 1 (état local) | non | OUI |
| « Terminer » | étape 2 | POST `/api/restaurants` | CREATE `Restaurant` avec **`isActive: false` FORCÉ serveur** (`app/api/restaurants/route.ts:436`) + géocodage BAN serveur | OUI |
| « Aller au tableau de bord » | écran done | `router.push('/dashboard')` | non | OUI |
| « Quitter » | header PartnerShell | Link → `/business` | non | OUI |

9. **États métier** : POST restaurants 409 → considéré comme déjà fait, passe direct à l'écran done (:234-238) ; 401 sur l'un ou l'autre POST → `/auth/magic`.
10. **Loading** : gate initial = spinner centré `Loader2` (:261-269) ; boutons `loading` pendant soumission.
11. **Error states** (bandeau rouge en tête de carte, :311-315) : « **Le nom de la marque est obligatoire.** » · « **Impossible de créer la marque. Réessayez.** » · « **Nom, adresse et ville sont obligatoires.** » · « **Adresse invalide — saisissez une adresse complète (numéro et rue).** » (gate client `isPlausibleAddress` — ≥5 car., une lettre, chiffre ou séparateur, `lib/geocode.ts:179-186`) · « **Activez au moins la livraison ou le retrait.** » · « **Lien d'image invalide (doit commencer par http).** » · « **Impossible de créer le restaurant. Vérifiez vos informations.** » · « **Erreur réseau, réessayez.** »
12. **Success (écran « done »)** : coche verte, « **Votre espace est créé ✅** », corps « **Votre restaurant est en cours de validation par notre équipe avant la mise en ligne. Vous pouvez déjà préparer votre menu depuis le tableau de bord — il deviendra visible dès l'approbation.** » + **avertissement géocodage conditionnel** si `geocodeStatus:'not_found'` : « **Nous n'avons pas pu localiser cette adresse sur la carte. Vérifiez-la dans vos réglages : sans localisation, votre établissement n'apparaît pas dans le tri par proximité.** » (:252,285-289) ; `unavailable` (panne du géocodeur) = silencieux volontaire (:247-251).
13. **Mobile/Desktop** : grille cuisine 3 colonnes (→ 5 dès `sm`), libellés de frise masqués < `sm` (:576) ; carte `max-w-xl` (étapes) / `max-w-md` (done) centrée dans la colonne PartnerShell « form ».
14. **Composants** : `PartnerShell` mode `parcours` avec `exitHref="/business"` et **SANS frise du shell** (décision documentée : pas de référence Design pour cet écran, :619-628) ; `Card`/`Button`/`Input` design-system, lucide-react.
15. **APIs** : GET `/api/business/me`, POST `/api/brands`, POST `/api/restaurants`. **Flags** : aucun. **Contrôles morts** : aucun.
16. **Dette** : deux frises de progression différentes coexistent dans le tunnel partenaire — la frise interne 3 crans de cette page (`StepHeader`, Tailwind) vs la frise `pt-steps` 4 crans du PartnerShell utilisée par `/business/verified` (« Compte / Établissement / Vérification / Mise en ligne ») — vocabulaires et visuels divergents pour le même parcours.

### 18.B.2 `/business/verified` — Résultat de vérification d'email

1. **Nom** : titre selon `?status=` : « **Email vérifié ✅** » / « **Lien expiré** » / « **Lien déjà utilisé** » / « **Lien invalide** » / « **Une erreur est survenue** » (`business.verified.*`).
2. **Route** : `/[locale]/business/verified?status=success|invalid|expired|used|error`. Statut absent/inconnu → repli `error` (:36-39). Publique.
3. **Objectif** : atterrissage du lien de vérification d'email envoyé à l'inscription partenaire ; oriente vers la connexion magic-link. **Données backend : AUCUNE** — pure lecture du query param.
4. **CTA** : « **Aller à la connexion** » (succès) / « **Revenir à la connexion** » (échecs) → `router.push('/auth/magic')` (:62-64,77-80). « Quitter » (header) → `/business`. **Aucun bouton « renvoyer l'email » N'EXISTE.**
5. **États métier** (:59-60) : ton `ok` (success, role=status) / `warn` (expired, used) / `error` (invalid, error, role=alert), icônes `check_circle` / `pending` / `error`. Corps FR : succès « **Votre email est vérifié et votre compte partenaire est actif : connectez-vous par lien magique pour créer votre établissement. La mise en ligne de votre restaurant sera validée par notre équipe une fois configuré.** » ; expiré « **Ce lien de vérification a expiré. Reconnectez-vous pour demander un nouvel email.** » ; déjà utilisé « **Ce lien a déjà été utilisé. Votre email est sans doute déjà vérifié — connectez-vous pour le confirmer.** » ; invalide « **Ce lien n'est pas reconnu. Vérifiez que vous avez bien cliqué sur le dernier email reçu.** » ; erreur « **Impossible de vérifier votre email pour le moment. Réessayez dans quelques instants.** »
6. **Loading** : fallback Suspense = carte skeleton 3 barres (:92-103). **Error** : cas ci-dessus + hint en échec : « **Si le problème persiste, contactez le support à contact@grubano.com.** » (:82-86).
7. **Composants** : `PartnerShell` mode `parcours`, `exitHref="/business"`, **AVEC frise 4 crans** : « Compte » (fait si succès, en cours sinon) / « Établissement » / « Vérification » / « Mise en ligne » (:19-27). Colonne parcours 560px, fluide < 720px.
8. Nuance factuelle : la frise affiche « Établissement / Vérification / Mise en ligne » en `todo`, mais l'écran d'onboarding qui suit n'affiche PAS cette frise (§18.B.1).

### 18.B.3 `/auth/magic` — « Connexion à Grubano » (page unifiée PartnerShell)

1. **Nom** : « **Connexion à Grubano** », sous-titre « **Connectez-vous sans mot de passe grâce à un lien envoyé par email.** » (`magic.title/subtitle`).
2. **Route** : `/[locale]/auth/magic` (+ `?token=…` pour la consommation du lien). Publique (middleware.ts:155).
3. **Objectif** : connexion sans mot de passe pour TOUS les rôles — envoi du lien magique (sans token), ou consommation du token puis redirection par rôle. **UNIFIÉE 2026-08-30** : même rendu PartnerShell sur tous les hôtes, l'ancien chrome legacy gaté sur hostname est SUPPRIMÉ (page.tsx:25-35).
4. **Persona** : public, tout rôle. Après connexion, redirection par rôle via `lib/post-login-redirect.ts:16-27` : restaurant → `/dashboard`, admin → `/admin`, franchise → `/franchise/dashboard`, creator → `/creators/dashboard`, supplier → `/supplier/dashboard`, logistics → `/logistics/dashboard`, prestataire → `/prestataire/dashboard`, affiliate → `/affiliate/dashboard`, consumer → `/eat`, rôle inconnu → `/eat`.
5. **Champs éditables** : « **Email professionnel** » (placeholder « vous@entreprise.fr », requis, autocomplete email) ; en phase « sent » si OTP activé : « **Code à 6 chiffres** » (placeholder « •••••• », numérique, filtré `\D`, :146-155).
6. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND | FONCTIONNE | FLAG |
|---|---|---|---|---|---|
| « Recevoir mon lien de connexion » / « Envoi… » | form email | POST `/api/auth/magic-link` via `requestMagicLink` | mint + email du lien | OUI | — |
| « Valider le code » / « Vérification… » | phase « sent » | `signIn('credentials', {email, otp})` | consomme l'OTP, crée la session | OUI | visible SEULEMENT si `AUTH_EMAIL_OTP_ENABLED === 'true'` (réponse `otpEnabled`, `lib/email-otp.ts:36`, `magic-link/route.ts:177`) |
| « Inscrire mon entreprise » | sous la carte, INCONDITIONNEL et server-rendered | Link → `/business/start` | non | OUI (:227-230) | — |
| « Quitter » | header PartnerShell | Link → `/business` | non | OUI | — |

7. **États métier (phases)** : `request` (form) / `verifying` (token présent : spinner + « **Connexion en cours…** ») / `sent` / `error` (:44).
8. **Loading** : skeleton de carte server-rendered pendant le bailout `useSearchParams` (titre + lien d'inscription restent server-rendered HORS Suspense, :199-224).
9. **Error states** (bandeaux rouges) : token invalide/expiré « **Ce lien est invalide ou expiré. Demandez-en un nouveau ci-dessous.** » (`magic.errorMsg`) ; **échecs de transport honnêtes** (429 → « **Trop de tentatives. Réessayez dans quelques instants.** », autre non-2xx/réseau → « **Impossible d'envoyer l'e-mail pour le moment. Réessayez plus tard.** » — `lib/magic-link-client.ts:14-17`, rate-limit réel 5 req/10 min) ; OTP « **Code invalide ou expiré. Vérifiez-le ou demandez un nouveau lien.** ».
10. **Success (« sent »)** : icône enveloppe verte, « **Vérifiez votre boîte mail** », « **Si un compte existe pour cet email, un lien de connexion vient d'être envoyé. Il expire dans 15 minutes.** » (**anti-énumération : 2xx toujours générique**). Si OTP ON, bloc additionnel : « **Le lien s'ouvre dans le mauvais navigateur ? Saisissez le code à 6 chiffres reçu par e-mail.** ».
11. **Disabled** : « Valider le code » tant que le code ≠ 6 chiffres (:157) ; submit ignoré si email vide.
12. **Responsive** : carte `max-w-md` (448px) centrée dans la colonne parcours 560px ; fluide < 720px. Hint : « **Vous recevrez un lien à usage unique, valable 15 minutes.** » Prompt : « **Pas encore inscrit ?** ».
13. **Composants** : `PartnerShell` mode `parcours` SANS frise, `Card`/`Button`/`Input` DS, lucide-react.
14. **APIs** : POST `/api/auth/magic-link`, `signIn('credentials')` (magicToken ou email+otp), GET `/api/auth/session`. **Flags** : `AUTH_EMAIL_OTP_ENABLED` (seul flag). **Hardcodes / morts** : aucun.
15. **Dette** : contenu de carte en Tailwind/DS `grubano-*` dans un shell en CSS de référence `.pt-*` — deux systèmes de style sur la même page.

### 18.B.4 `/login` — redirect

- **Plus aucune UI opérateur.** `login/page.tsx:5-7` = `redirect('/eat/auth')` inconditionnel. Le sélecteur multi-portails est retiré ; la connexion par mot de passe est la page consommateur `/eat/auth` (design Bolt), qui route par rôle après login. Le middleware continue d'utiliser `/login` comme cible de bounce pour toute route protégée sans session (middleware.ts:180) — l'utilisateur atterrit donc sur `/eat/auth` après **double redirection**.

### 18.B.5 Chrome partagé : PartnerShell (contexte des pages business)

`components/business/PartnerShell.tsx` — chrome maître public/partenaire, référence bankée `partner-shell.html`.
- Header : logo + « Grubano » + contexte « **Partenaires** » (`business.auth.brandPartners`), lien logo → `/business` (:66-70).
- Mode `parcours` : nav masquée, lien « **Quitter** » (icône close) vers `exitHref`, frise d'étapes optionnelle (rendue seulement si `steps` fourni — `verified` OUI, `onboarding` et `magic` NON), colonne 560px (`data-width="form"`).
- Footer : logo, liens « Mentions légales » / confidentialité / cookies, « **Nous contacter** » → `mailto:contact@grubano.com?subject=Grubano%20partenaire` (:132-135), `LanguageSwitcher` compact, copyright année dynamique.
- Responsive : container query 720px.

## Dette design factuelle (PART 18)

- **Deux systèmes de style sur un même écran** : `/more` mélange le CSS CD `--op-*` et les forms fiscaux Tailwind `grubano-*` à fond `bg-white` ; idem `/auth/magic` et `/business/onboarding` (carte DS Tailwind dans le shell `.pt-*` de référence).
- **Forms fiscaux sans état de chargement** : `VatNumberForm.tsx:31` et `Dac7FiscalForm.tsx:31` retournent `null` avant leur fetch — bandeau de section orphelin pendant le fetch.
- **CSS mort dans more.css** : `.op-error__card`, `.op-sk`, `.op-btn-primary`, `.set-row__val` définis mais jamais rendus.
- **Clés i18n zombies** : bloc `more.billing.*` (« Facturation & abonnement », « Formule actuelle », « Premium », « Moyens de paiement », « Historique de facturation ») subsiste dans fr.json alors que l'UI a été supprimée.
- **6 rangées « Bientôt »** sur `/more` — plus de la moitié du bloc « Compte » est inerte.
- **Version en dur** : « Grubano Business · v2.4.0 ».
- **Deux frises de progression divergentes** dans le tunnel partenaire (pt-steps 4 crans vs frise interne 3 crans ; `/auth/magic` n'en affiche aucune).
- **Grille DAC7 non responsive** : TIN + pays en `grid-cols-2` à toute largeur.
- **Double redirection login** : route protégée sans session → `/login` → `/eat/auth`.
- **Country renvoyé, jamais affiché** par GET `/api/operator/vat-number`.

## Ce qui N'EXISTE PAS (PART 18 — à ne pas supposer)

- **Aucun abonnement, plan, billing, facture opérateur, moyen de paiement** : `/pricing` et `/premium` sont des redirects nus vers `/more` ; aucun backend d'abonnement n'existe.
- **Aucune édition de profil** (nom, email, avatar, téléphone) — rangée « Profil » inerte.
- **Aucun changement de mot de passe ni 2FA** — rangée « Sécurité » inerte (le sous-texte « double authentification » décrit une fonction inexistante).
- **Aucun sélecteur de langue dans /more** — rangée « Langue » inerte (le switcher existe seulement dans le footer PartnerShell des pages business).
- **Aucun centre d'aide, aucun formulaire de contact support** — seuls des mailto dans le shell partenaire.
- **Aucun flux de déclaration/vérification KYB** côté partenaire : le statut est affiché tel quel ; aucun bouton « soumettre mes documents », aucun upload de pièces.
- **Aucun upload d'images** dans l'onboarding : logo et couverture sont des URLs collées.
- **Aucun choix d'horaires, de frais de livraison, de zone de livraison, de SIREN** dans l'onboarding — 2 étapes seulement (marque, restaurant).
- **Aucune création multi-restaurants ni multi-marques** via ce flow (première marque + premier restaurant uniquement ; reprise anti-doublon).
- **Aucune mise en ligne self-serve** : `isActive` FORCÉ à false serveur ; l'activation est admin-only.
- **Aucun renvoi d'email** sur `/business/verified`.
- **Aucun login par mot de passe sur /auth/magic** — email+lien (ou OTP 6 chiffres si flag) uniquement ; le mot de passe vit sur `/eat/auth`.
- **Aucune page /login dédiée** — c'est un redirect.
- **Aucun toggle « Ouvert/Fermé » dans le shell** (supprimé au train 981c05d).

---
# PART 19 — COMPOSANTS PARTAGÉS

## 19.1 OperatorShell — la coquille du dashboard partenaire

**Fichiers** : `components/operator/OperatorShell.tsx` (229 lignes) + `components/operator/operator-shell.css` (189 lignes).
**Montage** : `components/AppChrome.tsx:28-32` — TOUTE route qui n'est pas dans `BARE_PREFIXES` (`lib/app-chrome-rules.ts:40-44`) est enveloppée dans `<SessionProvider><OperatorShell>…`. Routes bare (SANS la coquille) : `/eat`, `/eat-next`, `/franchise`, `/creators`, `/supplier`, `/admin`, `/logistics`, `/business`, `/t`, `/legal`, `/login`, `/add-activity`, `/affiliate`, `/onboarding`, `/auth/magic`, et `/` (redirect). Exception documentée : `/deliveries` rend SOUS la coquille (`app-chrome-rules.ts:37-39`, décision fondateur).

### Identité visuelle (verbatim CD v1 LOT 1)
- Chrome navy PERMANENT (light + dark) : `--op-chrome-1:#0F2742` (`operator-shell.css:15`). Accent « Zest » `--op-zest:#FF6A1F` (:18). Violet réservé au Copilote `--op-ai:#6E56CF` (:19).
- Typo : `Gabarito` (display), `Hanken Grotesk` (UI), `JetBrains Mono` (chiffres) (:27-29) — auto-hébergées par `app/brand-fonts.css`. Icônes = **Material Symbols Rounded** (`.ms`, :50), PAS lucide (commentaire OperatorShell.tsx:12).
- Tokens `--op-*` scopés `.gb-op` (:14) ; jeu dark complet sous `[data-theme="dark"] .gb-op` (:35-47).
- Canvas contenu : `--op-canvas:#F2F4F7`, surfaces blanches, radius 6/8/12/16px, focus ring orange (:24-33).

### Sidebar (navy, 256px, collapsible)
Entrées EXACTES dans l'ordre du code (OperatorShell.tsx:33-48, labels `operator.nav.*`) : voir tableau PART 2b. Points structurels :
- Groupes = labels FR `operator.group.*` : « Opérations », « Relation client », « Pilotage », « Organisation ».
- Entrée inerte = `<span aria-disabled>` opacité .35, `pointer-events:none` (css:87), suffixe « · Bientôt » (`soon` = « Bientôt »).
- **Gate 0-établissement** : quand l'opérateur n'a AUCUN établissement (`data-scale="none"`), toutes les entrées `requiresEstab` (tout sauf Réglages) passent inertes en CSS (css:88-89). Le scale vient de `GET /api/establishments` (OperatorShell.tsx:75-89).
- Marque : logo `/brand/grubano-symbol-color.svg` + « **Grubano** / BUSINESS » (`brandSuffix` = « Business », :144-148).
- **Collapse** : bouton rond 24px à cheval sur le bord (`op-side__collapse`, chevron), réduit à 76px icônes seules (css:67). État `useState` local — **NON persisté** (ni cookie ni localStorage, :68). z-index 6 documenté comme fix d'un dead-control réel (css:63-65).
- Active state : règle « longest-href-wins » (:92-99) — fond orange 16%, icône Zest (css:83-84).

### Topbar (60px, navy, sticky)
De gauche à droite (:170-212) :
1. **Hamburger** (mobile seulement, ouvre le drawer).
2. **Sélecteur d'établissement** (`op-estab`) — 3 états pilotés par `data-scale` :
   - `none` : icône `storefront` + « **Aucun établissement** » (`estab.none`), clic SANS effet (onClick gaté `scale !== 'none'`, :176).
   - `single` : pastille initiales dégradé orange + nom + ligne `ville · Publié/Non publié` avec point vert si publié (:178-184). Pas de chevron, mais **le clic ouvre quand même `setEstabOpen`** — le panneau ne rend que si `scale === 'multi'` (:187) donc clic sans effet visible en mono-établissement.
   - `multi` : chevron `expand_more` + **panneau déroulant** 280px (`op-estab__panel`) : liste des établissements (mini-pastille initiales, nom, `ville · Publié/Non publié`, check orange sur le courant) + pied « **Ajouter un établissement** » (`estab.add`) → /dashboard/establishments (:187-198).
   - **Badge « Publié / Non publié »** : mappé sur `Restaurant.isActive` (publication contrôlée admin) — verrouillé par test source `tests/operator-shell-truth.test.ts:34-48` (l'ancien libellé mensonger « Ouvert/Fermé » et le toggle Ouvert mort SUPPRIMÉS, verrous :18-32).
   - Changement d'établissement = cookie `grubano_estab` (1 an) + `router.refresh()` (:101-106). Backend : `GET /api/establishments` (route.ts:16-50) — owner-scopé, rôles `restaurant|admin`, renvoie `{id,name,city,isActive}[]` + `currentId` (cookie → fallback plus ancien).
3. **Date du jour** : `calendar_today` + « jeudi 30 août » (Intl, locale-aware, :111-117, :200). Purement décoratif, non cliquable.
4. **Cloche notifications** : lien vers `/notifications` (:203-205). **AUCUN compteur non-lu rendu** — la classe CSS `.op-icon-btn .badge` existe (css:125) mais aucun JSX ne la rend : CSS orpheline.
5. **Profil** : pastille initiales (dérivées de `session.user.name`, fallback « **Utilisateur** » `profileGuest`) + nom + chevron `expand_more` → **simple lien vers `/more`** (:207-211). Le chevron suggère un menu déroulant qui N'EXISTE PAS.

### Contenu
`main.op-content` : scroll interne, padding 24px, **`>section` max-width 1520px centré** (css:131-132).

### Points d'état de la coquille
- **Persona** : tout utilisateur authentifié hors routes bare — le shell lui-même ne vérifie PAS le rôle (c'est `middleware.ts` qui gate) ; `/api/establishments` refuse 403 hors `restaurant|admin`.
- **Loading state** : aucun — le switcher apparaît en « Aucun établissement » tant que le fetch n'a pas répondu (fetch silencieux `.catch(() => {})`, :83).
- **Error state** : aucun — un échec du fetch établissements laisse le shell en `data-scale="none"` (toute la nav inerte) sans message.
- **Feature flags** : aucun dans le shell.
- **Contrôles morts** : Équipe (« · Bientôt »), Copilote IA (« · Bientôt ») — inertes ASSUMÉS ; clic sur le switcher en mono-établissement sans effet.

## 19.2 PartnerShell — chrome public/partenaire (modes « parcours » et « vitrine »)

**Fichiers** : `components/business/PartnerShell.tsx` (147 lignes) + `components/business/partner-shell.css` (237 lignes). Référence bankée `scripts/design-qa-refs/partner-shell.html` (Claude Design 2026-08-23).
**Identité** : canvas CHAUD `--pt-bg:#FBF8F3` (vs canvas froid opérateur), tokens `--pt-*` scopés `.pt-shell` (css:24-68), dégradé « sunrise » `#FFB020→#FF6A1F→#F2570E` (:29), radius plus généreux (8/12/18/26px, :53), RTL = police Cairo (:69). **Aucun jeu dark** (une seule palette).
**Deux modes** (prop `mode`, :27-47) :
- **`vitrine`** : header avec nav ≤ 3 entrées + CTA pill navy, contenu **1080px**, footer complet.
- **`parcours`** : nav masquée, lien « Quitter » (`business.shell.exit`) + **frise d'étapes** (`pt-steps` : disques numérotés, done=vert basil avec check, now=dégradé sunrise, todo=gris, css:113-123), colonne **560px** (`--pt-form`).
**Header** : sticky 64px, fond crème translucide + blur, marque « Grubano » + badge contexte (:64-92). **Footer** (désactivable via prop) : marque + liens légaux + contact mailto + `LanguageSwitcher` compact + copyright (:123-143).
**WHERE USED (parcours)** : `/business/start` (:80), `/business/register` (:74,:90), `/business/verified` (:67,:95), `/business/onboarding` (:627, sans frise), `/auth/magic` (:216, inconditionnel tous hôtes). **WHERE USED (vitrine)** : `/business` landing (:86).
**Primitives fournies par partner-shell.css** (noms 1:1 avec la maquette, confinés `.pt-shell`) : `.btn` (--primary sunrise / --secondary / --ghost, tailles lg/md, `[aria-busy]` fait tourner l'icône :233-236), `.fld/.inp` (champs avec `.fld__help` et `.fld__err`, :171-184), `.card/.card--raised` (:191-197), `.note--info/ok/warn/error` (:199-209), `.pill--ok/wait/todo` (:211-215), `.sk` skeleton (:217-219), `.empty` (:220-223), échelle typo `.t-hero…t-eyebrow` (:142-151).

## 19.3 PartnerChrome — chrome LEGACY (Tailwind + lucide)

**Fichier** : `components/business/PartnerChrome.tsx` (40 lignes). Header blanc Tailwind : pastille navy `ChefHat` (lucide) + « Grubano / Partenaires » + badge `ShieldCheck` « espace vérifié » (`business.auth.verifiedSpace`), `main` centré max-w-6xl (:14-38). Frère de PartnerShell — « les consommateurs historiques ne changent pas d'apparence ; migration route par route » (PartnerShell.tsx:11-14).
**Consommateurs ENCORE ACTIFS (4 surfaces, vérifiés par import + JSX)** : 1) `/add-activity` (page.tsx:16,86 — + `add-activity.css` qui recopie localement les tokens `--op-*` que PartnerChrome ne porte pas, css:6-10) ; 2) `/supplier/register` (:8,99) ; 3) `/business/prestataire/register` (RegisterForm.tsx:8,92) ; 4) `/affiliate/join` (:4,19).
**Ex-consommateurs migrés** : `/auth/magic` (ancien PartnerChrome gaté hostname SUPPRIMÉ, page.tsx:27), `/business/logistics/register` (remplacé par `.lo-mkt`, :10), `/affiliate/dashboard/**` (AffiliateShell), `/affiliate/apply/candidature` (chrome `.af-mkt`).

## 19.4 Patrons transversaux du dashboard

⚠️ **Fait structurel majeur** : il n'existe AUCUNE feuille de style partagée pour le contenu opérateur. Chaque page « self-sufficient » **recopie** les mêmes classes (`op-card`, `op-btn-add`, `op-modal*`, `op-field/input/select`, `op-emptyline`, `op-error__card`, `op-sk`, `op-onb*`, `op-dash__head`…) dans son propre CSS — assumé en commentaire (`stocks.css:20-25` « Self-sufficient: recopies the shared content components »). `.op-card{…}` est redéfinie à l'identique dans **au moins 32 fichiers CSS** (grep : stocks/menu/orders/brands/tables/reviews/prep/notifications/more/loyalty/finance/cashflow/briefing/dinein/deliveries/dashboard/fulfillment/establishments/analytics/suppliers/marketplace×5/promotions + les shells admin/supplier/logistics/franchise/creator/affiliate). Seule `operator-shell.css` porte les tokens.

### Cards — `op-card`
Fond surface, bordure 1px, radius 12px, ombre légère (`stocks.css:43`). Where used : toutes les pages contenu CD (≥ 32 fichiers). Variante mobile : cartes dédiées par écran (ex. `.st-card`, stocks.css:107).

### Tables / listes — patron « table desktop → cartes mobile »
Desktop : grille CSS par ligne (`st-head-row`/`st-row` `grid-template-columns:2.2fr 1fr 1fr 1.4fr 110px`, stocks.css:92-94), en-têtes uppercase 10.5px. Mobile : la table passe `display:none`, une pile de cartes `display:grid` prend le relais (stocks.css:163-166, bascule à **900px** pour /stocks). Ce ne sont PAS des `<table>` HTML — des div-grids.

### Formulaires — `op-field` / `op-input` / `op-select`
Label 11.5px gras gris au-dessus, input 13.5px bordure forte, focus = bordure Zest + ring orange (stocks.css:154-160). `op-field-row` = 2 champs côte à côte. Variante `.op-input.mono` pour les chiffres. Présent dans 18 fichiers CSS. Legacy parallèle : `components/design-system/Input.tsx` (Tailwind, label/hint/error intégrés) — encore utilisé par les pages non re-skinnées.

### Dialogs / modales — DEUX grammaires concurrentes (+ confirm natif)
1. **`op-modal`** (CD, dominante) : backdrop fixe `rgba(10,18,32,.55)` z-100, panneau 480px max, head sticky avec titre Gabarito + close, body colonne gap 14, foot sticky Annuler (`op-btn-ghost`) + action (`op-btn-add`/`op-btn-primary`) (stocks.css:145-153). Where used (JSX) : /menu (page.tsx:1046,1092,2103), /brands, /stocks, /reviews, /dinein, /finance (grep `op-modal-backdrop` : 17 fichiers). Fermeture par clic-backdrop.
2. **`Modal` design-system** (`components/design-system/Modal.tsx`, Tailwind) : catalogue /design, pages legacy.
3. **`window.confirm()` natif** encore utilisé dans /marketplace/orders (OrdersClient.tsx), /supplier/catalog, /prestataire/services — trois patrons différents pour « confirmer une action ».

### Toasts
- **`ToastProvider`/`useToast`** maison (`components/design-system/Toast.tsx` : 4 variantes success/error/warning/info, auto-dismiss 4s, portal, « stacked from the bottom on mobile, top-right on desktop », :8).
- **PAS de provider global** : monté LOCALEMENT par page — /menu (page.tsx:1185-1192 « operator pages have no global provider ») et /orders (page.tsx:159-168, commentaire documentant un P0 réel : panel blanc-écran faute de provider). Les autres pages opérateur n'ont AUCUN toast — le succès s'exprime par fermeture de modale + re-render.

### Empty states
- CD : `.op-emptyline` (icône Material 34px, titre gras, sous-texte ≤ 380px, CTA optionnel — stocks.css:138-142).
- Onboarding N=0 dédié : `.op-onb__card` (carte centrée 520px, 3 steps numérotés, CTA dégradé — stocks.css:116-126).
- Legacy : `EmptyState.tsx` design-system (utilisé par /orders).

### Error / retry
`.op-error__card` : icône 44px, titre, texte, bouton « Réessayer » (`op-btn-primary`) (stocks.css:128-133).

### Loading / skeletons
`.op-sk` : shimmer animé 1.4s (stocks.css:135-136). Côté PartnerShell : `.sk` équivalent avec `prefers-reduced-motion` respecté (partner-shell.css:217-219) — la version opérateur `op-sk` ne désactive PAS l'animation en reduced-motion.

### Filtres — patron « pilules à compteur »
Rangée de boutons pill bordés, actif = fond encre (dark : fond Zest), compteur mono en suffixe (stocks.css:75-79 `.stock-filters`, CustomersClient.tsx:137-141 `.tier-filters`). Filtrage **client-side** sur les données déjà chargées. Mobile : pilules `flex:1` pleine largeur.

### Recherche
Aucun patron partagé. Recherche client-side locale par page où elle existe : /customers (input `.lsearch` icône `search`, filtre le nom masqué en mémoire), /marketplace/suppliers + catalogue fournisseur (searchQuery). Les autres pages opérateur n'ont pas de recherche.

### Pagination
**N'EXISTE PAS** dans le dashboard partenaire. Grep `setPage(|Précédent|Suivant|PAGE_SIZE` sur `app/[locale]` : seul hit = console **creators** (revenus/page.tsx:136,181). Toutes les listes opérateur chargent et rendent tout.

### Date pickers
Aucun composant calendrier. Seuls des `<input type="date">` NATIFS : /stocks (DLC) — et côté rôle prestataire. C'est tout pour le périmètre.

### Badges / pills de statut
- CD : `.st-pill.ok/low/out` (point coloré + fond teinté success/warning/danger, stocks.css:82-86) — même grammaire déclinée par page (orders, dinein…).
- Legacy : `Badge.tsx` design-system (7 tones Tailwind).

### Boutons
- `op-btn-add` / `op-btn-primary` : dégradé orange `#FF8A3D→#F2570E`, ombre orange, disabled opacité .55 (stocks.css:46-48,132-133).
- `op-btn-ghost` : bordure neutre. `st-action` : bouton d'action de ligne, hover bordure Zest.
- Legacy parallèle : `Button.tsx` design-system (variants primary/secondary/ghost/danger, prop `loading`).

### Barre Copilote IA
`.ai-bar` : bandeau violet cliquable (icône dégradée, placeholder, tag « COPILOTE », bouton send) ouvrant une modale de chat (stocks.css:63-71). Where used : /stocks uniquement (AIChatModal → `POST /api/stocks/update-ai`).

---

# PART 20 — MOBILE (comportement ACTUEL)

**Breakpoints réels** (viewport media queries — le CD d'origine utilisait des container queries, converties : operator-shell.css:145) :

| Seuil | Effet |
|---|---|
| **≤ 880px** (LE breakpoint pivot de la coquille) | Sidebar → **drawer** fixe hors-écran (`translateX(-110%)`, transition .22s, RTL inversé), ouvert par le hamburger, backdrop `rgba(10,18,32,.5)` cliquable, fermeture auto à la navigation (OperatorShell.tsx:87). Le drawer ignore l'état collapsed (largeur forcée 256px, css:151). Bouton collapse masqué (:152). **Bottom-nav apparaît** (:155). Padding contenu 24→16px (:157). Topbar : padding réduit, nom d'établissement tronqué à 84px, ligne ville/statut masquée, **date masquée** (:158-163). |
| **≤ 700px** | Nom du profil masqué (pastille seule, :165-167). |
| **≤ 900px** (pages contenu, ex. stocks) | Table → pile de cartes (stocks.css:163-166). |
| **≤ 880px** (pages contenu) | Head de page en colonne, stat-strip empilée avec séparateurs horizontaux, filtres pleine largeur, bouton Ajouter pleine largeur, steps onboarding 1 colonne (stocks.css:167-177). |

**Bottom-nav mobile** : 5 onglets navy sticky bottom avec safe-area (operator-shell.css:135-140), actif = Zest. Onglets (OperatorShell.tsx:51-57) : **Dashboard** (`dashboard`), **Commandes** (`receipt_long`), **Réservations & Salle** (`event_seat`), **Stock** (`inventory_2`), **Plus** (`menu` → /more). NB : **9 destinations de la sidebar (Cuisine, Menus, Fournisseurs, Clients, Avis, Analytics, Finances, Marques, Notifications) ne sont accessibles sur mobile QUE via le drawer hamburger.**

**Modales sur mobile** : la même `op-modal` centrée (max-width 480, `max-height:92vh`, scroll interne) — pas de variante bottom-sheet (exceptions : CloseTableModal/ReservationHistory de /tables et la modale de conflits horaires, qui sont en bottom-sheet Tailwind — PART 4/17).

**PartnerShell mobile** : container query `@container pt (max-width:720px)` — liens nav masqués (CTA conservé), labels de la frise masqués (disques seuls), `row2` → 1 colonne, typo réduite (partner-shell.css:152-154,226-231).

**PartnerChrome mobile** : badge « espace vérifié » masqué sous `sm` (PartnerChrome.tsx:28).

---

# PART 21 — DESKTOP (comportement ACTUEL)

- **Layout** : flex 2 colonnes — sidebar sticky 256px (collapsed : 76px) + colonne main ; topbar sticky 60px ; `op-content` scroll interne (operator-shell.css:60-96,131). Le body ne scrolle jamais (`overflow:hidden` sur `.gb-op`, :60).
- **Largeur contenu** : `op-content>section` **max 1520px centré** (:132). Chaque page pose sa propre grille interne (ex. stats en strip flex, `op-row2` 2 colonnes sur analytics/finance/cashflow/briefing).
- **Collapse sidebar** : chevron rond à cheval sur le bord ; en collapsed les labels et groupes disparaissent, icônes centrées (:73-81). Non persisté (re-expand à chaque navigation full-reload).
- **Panneau établissements** : dropdown absolu 280px sous la topbar (:107).
- **Toasts** : top-right sur desktop (Toast.tsx:8) — uniquement sur /menu et /orders.
- **Dark mode** : les tokens dark opérateur existent (operator-shell.css:35-47) et `data-theme="dark"` est posé sur `<html>` par un script inline lisant `localStorage.grubano_theme` (`app/[locale]/layout.tsx:81`) — mais **le seul contrôle de thème de tout le produit vit dans `/eat/account`** (consumer, `lib/eat-theme.ts`, unique importeur `app/[locale]/eat/account/page.tsx`). Le dashboard partenaire n'offre AUCUN réglage de thème : un opérateur ne voit le dark que si le même navigateur l'a activé côté app conso.
- **Pages étirées / non re-skinnées** : `/wallet` et `/account` rendent sous OperatorShell mais avec l'ancien chrome Tailwind (`components/grubano/Card`, lucide) et une colonne étroite `max-w-lg / md:max-w-3xl` (wallet/page.tsx:7) — visuellement étrangères au canvas CD 1520px.

## Dette design factuelle (PART 19-21)

1. **32+ copies de la même CSS** : `.op-card` et toute la grammaire contenu dupliquées fichier par fichier au lieu d'une feuille partagée — toute évolution du patron exige ~32 éditions synchronisées.
2. **3 patrons concurrents pour « confirmer »** : `op-modal` CD, `Modal` design-system, `window.confirm()` natif.
3. **2 systèmes de design cohabitent sous la même coquille** : CD gb-op (Material Symbols, Gabarito/Hanken) vs design-system Tailwind (lucide, Inter) — /wallet et /account importent encore `components/grubano/*` ; le README du design-system se déclare encore « Single source of truth » (README.md:3).
4. **/wallet mock en dur** rendu sous la coquille (voir PART 14b) — aucune donnée réelle, aucune entrée sidebar.
5. **Toasts non systémiques** : provider monté sur 2 pages seulement ; ailleurs, aucun feedback toast.
6. **Chevron menteur sur le profil** : `expand_more` sur `op-profile` (OperatorShell.tsx:210) alors que c'est un simple lien /more — aucun dropdown.
7. **CSS orpheline compteur notifications** : `.op-icon-btn .badge` définie (css:125) mais jamais rendue — la cloche n'affiche jamais de non-lus.
8. **Collapse non persisté** : `useState(false)` (:68) — la préférence saute à chaque rechargement.
9. **Échec silencieux du fetch établissements** : `.catch(() => {})` (:83) — en cas d'erreur réseau, la coquille affiche « Aucun établissement » et gèle la nav (data-scale="none") sans aucun message.
10. **Breakpoints désalignés** : coquille à 880px, bascule table→cartes des pages à 900px — entre 880 et 900px on a le chrome desktop avec le contenu mobile.
11. **Reduced-motion partiel** : `.sk` PartnerShell le respecte, `.op-sk` opérateur non.
12. **`add-activity.css` recopie des tokens `--op-*`** localement parce que PartnerChrome ne les porte pas — troisième source de vérité des tokens.
13. **PartnerChrome vs PartnerShell** : deux chromes partenaires vivants en même temps (décision fondateur) — un candidat au /business/prestataire/register voit un header différent de celui de /business/register.
14. **Mono-établissement** : le sélecteur d'établissement est cliquable mais sans effet.
15. **Pas de titre de page dans la topbar** : l'identification de l'écran repose uniquement sur l'item actif de la sidebar + le titre du contenu.

## Ce qui N'EXISTE PAS (PART 19-21 — qu'un designer pourrait supposer)

- **Pagination** — nulle part dans le dashboard partenaire. Toutes les listes rendent tout.
- **Recherche globale / command palette** — aucune ; recherche locale sur 2 zones seulement (clients, marketplace).
- **Compteur de notifications non lues** sur la cloche — non rendu.
- **Menu déroulant profil** (déconnexion rapide, thème, langue depuis la topbar) — le profil est un lien vers /more.
- **Toggle Ouvert/Fermé de l'établissement** — SUPPRIMÉ volontairement (mensonge produit) ; un vrai contrôle « pause commandes » est un ticket post-beta (OperatorShell.tsx:17-20, verrou tests/operator-shell-truth.test.ts).
- **Copilote IA global** — entrée sidebar inerte « Bientôt » ; seule /stocks a une barre IA fonctionnelle (et son écriture est en preview — PART 9).
- **Page Équipe / gestion du staff** — entrée inerte « Bientôt », aucune route.
- **Sélecteur de rôle dans OperatorShell** — le `RoleSwitcher` multi-rôles existe (components/RoleSwitcher.tsx) mais n'est monté que dans les consoles logistics/supplier/prestataire, jamais dans la coquille restaurant.
- **Réglage de thème côté opérateur** — le toggle dark vit uniquement dans /eat/account (conso).
- **Persistance du collapse sidebar** — non stockée.
- **Composant date-picker / calendrier** — seulement des `<input type="date">` natifs.
- **Bottom-sheet mobile** — les modales restent centrées (rares exceptions Tailwind PART 4/17).
- **Breadcrumbs** — aucun (exception : fiche client, fil d'Ariane local).
- **Abonnement / billing / Premium** — /pricing et /premium sont des redirects inconditionnels vers /more ; aucun modèle d'abonnement n'existe dans le backend.
- **Feuille de style contenu partagée** — chaque page recopie ses classes.
- **Drag & drop, tri de colonnes, export CSV** — aucun dans les listes opérateur.

---
# PART 22 — SURFACES LEGACY / CACHÉES / MORTES (+ funnel /business public)

## 22.0 Récapitulatif consolidé des surfaces hors-nav (avec renvoi vers la PART canonique)

| Surface | Statut | Fiche complète |
|---|---|---|
| `/briefing` | HIDDEN — données réelles, orpheline | PART 3 (page 2) |
| `/notifications` | PARTIAL — aperçu non branché, cloche seule | PART 3 (page 3) |
| `/dinein` | HIDDEN — aperçu phase-3 inerte | PART 4 (page 2) |
| `/promotions` | ACTIVE — mais quasi introuvable (1 seul lien entrant, /menu) | PART 7.6 |
| `/marketplace` (hub) | HIDDEN — orphelin | PART 10.2 |
| `/marketplace/reorder` | HIDDEN — orphelin | PART 10.7 |
| `/loyalty` | HIDDEN — handlers réels, orpheline | PART 12 (annexe) |
| `/cashflow` | HIDDEN — aperçu honnête complet, orpheline | PART 14a |
| `/wallet` | LEGACY — mock intégral menteur, orphelin | PART 14b |
| `/pricing`, `/premium` | LEGACY — redirects → /more | PART 14 (note) + PART 18 |
| `/onboarding` (wizard 4 étapes) | HIDDEN — câblé mais orphelin | §22.2 ci-dessous |
| `/deliveries` | DEFERRED — flag OFF → aperçu honnête | §22.3 |
| `/account` | DEAD pour le partenaire — mock conso | §22.9 |
| `/add-activity` | HIDDEN pour le restaurateur mono-rôle | §22.13 |
| `/legal/cookies`, `/design`, `/design/gb-foundation` | HIDDEN | §22.10-22.11 |
| `/business/auth`, `/business/logistics-soon` | LEGACY — redirects | §22.12 |

## 22.1 Note de complétude (méthode du critique)

- Croisement carte ↔ filesystem : `git ls-files` sur `app/[locale]/**/page.tsx` = **161 pages**, dont ~60 dans le périmètre partenaire. **2 routes partenaires manquaient à la carte initiale** : `/business/logistics` et `/business/logistics/register` (§22.7/22.8, intégrées à la PART 1) — notable car la route LEGACY `/business/logistics-soon` **redirige vers** `/business/logistics/register` et la carte « Logistique » de `/business/start` y pointe (start/page.tsx:45).
- Sondage d'exactitude sur 4 fragments + la cartographie : **tous les faits sondés vérifiés exacts dans le code au fichier:ligne** (`location.reload()` OperatorDashboard.tsx:114, `.slice(0,6)` :166, wallet mock :8/:19/:58, AddressSection `useState('')` :41, `drag_indicator` sans handler :747/:784). Seul écart : une citation du mock PROMOS décalée d'une ligne (163-167 vs 162-166), non trompeuse — corrigée dans ce document. **Aucune invention détectée ; les « N'EXISTE PAS » sondés sont vrais.**
- Hors périmètre assumé (pas des gaps) : `/franchise/dashboard` (console franchise), `/t/[tableId]` (page CONSO du QR), `/supplier/register`, `/business/prestataire/register`, `/affiliate/join|apply`, `/creators*`, `/franchise` landing (parcours d'AUTRES rôles).

## 22.2 `/onboarding` — wizard 1er établissement (HIDDEN, câblé mais orphelin)

1. **Route** : `/{locale}/onboarding` — `app/[locale]/onboarding/page.tsx` (client, CD LOT 7). **Plein écran BARE** (dans `BARE_PREFIXES`, commentaire page.tsx:10-12) — pas d'OperatorShell. Gate restaurant/admin (OPERATOR_FLAT, middleware.ts:35).
2. **Objectif** : assistant 4 étapes de création du PREMIER établissement (« NO additional »), qui pilote les VRAIS endpoints existants (page.tsx:16-27).
3. **Parcours** (barre de progression 25 %/étape, :96 ; frise latérale desktop, :253-259 ; « **Étape {current} sur {total}** » `operator.onboarding.stepLabel`) :
   - Étape 1 « **Votre restaurant** » (`stepResto`) : {name, city, address, cuisine[], phone} — garde locale des requis (:112).
   - Étape 2 « **Horaires d'ouverture** » (`stepHours`) : **VISUELLE SEULEMENT** — non persistée, note honnête (:19-20). Horaires par défaut « 12:00 – 14:30, 19:00 – 22:30 » en dur (:53).
   - Étape 3 « **Votre menu** » (`stepMenu`) : plats {name, price €} collectés localement.
   - Étape 4 « **Mise en ligne** » (`stepPublish`) : CTA « **Mettre mon restaurant en ligne** » (`publishCta`) → séquence réelle `POST /api/restaurants` (serveur FORCE isActive:false — validation admin, affiché honnêtement) → `POST /api/brands` → `POST /api/menu` par plat (:145-199). Écran final « **Votre espace est créé ✅** » (`doneTitle`) + bouton → /dashboard (:284).
4. Champs = ceux des 4 étapes ; pas de filtre/recherche/pagination. Bouton « quitter » (croix) → /dashboard (:245). Cuisines proposées en dur : italien/français/japonais/méditerranéen/burgers/autre (:44-51). Parsing prix « 12,50 »→Float (:57-60).
5. **Dette factuelle** : page **ORPHELINE** — aucun lien entrant (le parcours vivant est `/business/onboarding`, cf. dashboard/layout.tsx:62). **Deux wizards d'onboarding câblés coexistent** (`/onboarding` 4 étapes CD plein écran vs `/business/onboarding` 2 étapes PartnerShell — PART 18.B.1) qui appellent les mêmes endpoints.

## 22.3 `/deliveries` — « Livraisons » (DEFERRED, aperçu honnête sous coquille)

1. **Route** : `/{locale}/deliveries` — `app/[locale]/deliveries/page.tsx` (server). Sous l'OperatorShell (exception fondateur : retirée des BARE_PREFIXES, :14-16). **PAS dans OPERATOR_FLAT_PREFIXES** : gate page-level rôles restaurant/supplier/franchise/admin, sinon `notFound()` (:27, :38).
2. **Objectif** : versant livraison des commandes (demande de coursier). Flag `LOGISTICS_MISSIONS_ENABLED` (lib/missions) : **OFF (défaut) → `<DeliveriesPreview/>` ; ON → formulaire réel `<RequestDelivery/>`** (POST /api/logistics/missions/request) (:42-45).
3. **Aperçu (état livré aujourd'hui)** — `components/logistics/DeliveriesPreview.tsx` : titre « **Livraisons** » / « **Suivi du versant livraison de vos commandes** » ; bandeau « Bientôt » : « **Le réseau de coursiers Grubano se déploie progressivement** » + « **L'affectation automatique des livreurs, le suivi GPS en direct et le versement des coursiers arrivent bientôt. Les données ci-dessous sont des exemples illustratifs, pas des livraisons réelles.** » (:73-80). 4 stats EXEMPLES en dur (4 / 27 min / 3 / 1 — :85-88) + note « **Les chiffres et montants affichés sont des exemples illustratifs tant que le réseau de coursiers n'est pas actif.** » Chips « exemple » sur chaque ligne, panneau détail avec placeholder GPS hachuré « **Suivi GPS en direct — bientôt disponible** », « **Versement coursier** » marqué « **Bientôt actif** » (:167-179).
4. Tous les boutons d'action de l'aperçu sont INERTES sauf « voir » (ouvre le panneau détail, :119) et sa fermeture. Aucun backend appelé par l'aperçu.
5. **Dette** : route ORPHELINE (aucun lien entrant) ; c'est la SEULE page opérateur gatée par un set de rôles élargi (supplier/franchise inclus) au niveau page, et la SEULE avec l'exception « aperçu visible sous la coquille » quand le flag est OFF (partout ailleurs la doctrine est 404/invisible).

## 22.4 `/business` — landing partenaire (vitrine PartnerShell)

1. **Route** : `/{locale}/business` (client). PUBLIC (middleware.ts:143) ; racine du host business.grubano.com y redirige (middleware.ts:64-66). Chrome = `PartnerShell mode="vitrine"` (nav « **Se connecter** » → /auth/magic ; CTA « **Devenir partenaire** » → /business/start — page.tsx:86-90).
2. **Objectif** : vitrine de recrutement partenaire. Eyebrow « **Espace partenaires** », H1 « **Développez votre activité avec Grubano** », lead « **Restaurateurs, fournisseurs, créateurs, logistique — un seul espace, une vérification instantanée, un compte pour tout gérer.** » (`business.landing.*`).
3. **CTA** : hero « Devenir partenaire » (+icône rocket) → /business/start et « Se connecter » → /auth/magic (:98-103) ; 4 cartes « **Un espace pour chaque métier** » (Restaurateur/Fournisseur/Créateur/Logistique, icônes **lucide**) qui pointent TOUTES vers /business/start (:124-126) ; bloc « **Comment ça marche** » 3 étapes ; 3 piliers (Material Symbols) ; clôture « **Prêt à développer votre activité ?** » + CTA → /business/start.
4. **Faits notables** : page à **deux grammaires visuelles assumées** — sections hero/piliers/clôture en grammaire PartnerShell (Material Symbols) et sections « Métiers »/« Comment ça marche » RESTAURÉES VERBATIM de l'ancienne version (Tailwind `grubano-*` + lucide + animation Reveal), arbitrage fondateur documenté (:17-25). La bande de repères chiffrés de la maquette CD a été RETIRÉE (aucun engagement commercial non validé, :22-25). Aucun formulaire, aucune donnée.

## 22.5 `/business/start` — « Quel type de partenaire êtes-vous ? »

1. **Route** : `/{locale}/business/start` (SERVER component pour lire les flags, :28-30). PUBLIC. `PartnerShell mode="parcours"` avec frise « Compte (en cours) → Établissement → Vérification → Mise en ligne » + « Quitter » → /business (:80-88).
2. **Objectif** : aiguillage du type de compte. H1 « **Quel type de partenaire êtes-vous ?** » / « **Un seul compte — vous ajouterez d'autres activités après.** »
3. **CTA** : carte vedette « **LE CŒUR DE GRUBANO** » → « **Restaurateur** » (« **Servez vos clients, gérez votre établissement.** ») → `/business/register` (:97-106). Cartes « **LES PARTENAIRES** » **conditionnelles par flag de rôle** (doctrine P0-38 « rôles gelés → cartes ABSENTES », :67-77) : « Fournisseur » → /supplier/register (si SUPPLIER_ENABLED), « Chef & Créateur de recettes » → /creators/apply (si CREATOR_ENABLED), « Logistique » → **/business/logistics/register** (si `isLogisticsSignupEnabled()` — la carte suit l'INSCRIPTION waitlist, PAS l'opérationnel, :73), « Prestataire » (si PRESTATAIRE_ENABLED), « Recommander Grubano » → /affiliate/apply (si AFFILIATE_ENABLED). Ligne discrète « **Réseau / plusieurs établissements ? Groupe & Franchise** » → /franchise/apply (si FRANCHISE_ENABLED, :126-131). « **Déjà partenaire ? Se connecter** » → /auth/magic. « **Autre activité ? Écrivez-nous** » = mailto:contact@grubano.com (:142).
4. **Fait notable** : c'est le SEUL écran où le nombre de cartes visibles dépend de 6 flags env — **un designer doit prévoir de 1 à 6 cartes partenaires.**

## 22.6 `/business/register` — inscription restaurateur (passwordless)

1. **Route** : `/{locale}/business/register` (client). PUBLIC. `PartnerShell mode="parcours"`, frise « Compte » en cours, « Quitter » → /business (:17-19).
2. **Objectif** : créer le compte restaurateur SANS mot de passe (password=null, connexion magic-link — :13-15).
3. **Champs** : nom + e-mail + case consentement RGPD — c'est TOUT (:31-33). Anti-bot invisibles : honeypot `website` + `formStartedAt` (:34-37).
4. **CTA** : submit → `POST /api/partners/register {name, email, consent, website, formStartedAt}` (:48-52) → message de confirmation (vérif e-mail) ; lien « déjà partenaire » → /auth/magic.
5. **Erreurs** : champs manquants, consentement requis, 429 « rate limited », erreur serveur, erreur réseau (clés `business.auth.*`, :43-58).
6. **N'EXISTE PAS** : champ mot de passe, choix d'établissement, SIREN — l'identité légale arrive plus tard (/more).

## 22.7 `/business/logistics` — landing « Devenez livreur »

1. **Route** : `/{locale}/business/logistics` (server). PUBLIC (sous-arbre /business ; « no flag gate here, no notFound », :6-7). **HORS OperatorShell ET PartnerShell** : page marketing full-bleed en langage gb-foundation, accent AMBRE `--gb-lo` (:5-9), badge nav « Livreurs ».
2. **Objectif** : recruter des livreurs pour la waitlist du réseau. Garde-fous d'honnêteté TOUS présents (:10-21) : bandeau waitlist (réseau en déploiement), **zéro statistique fabriquée**, rémunération descriptive SANS montant (« **Le barème exact et les modalités de versement seront communiqués au lancement du réseau. Les revenus… ne sont pas garantis. Cette page ne constitue pas une offre d'emploi ni un contrat.** » — `business.logistics.landing.revNote`), FAQ « Vous vous demandez… », AUCUN témoignage.
3. **CTA** : tous → `/business/logistics/register` (:18-19) ; footer → les VRAIES pages légales (/legal/mentions-legales, /legal/confidentialite, /legal/cookies — jamais /legal/cgu qui n'existe pas, :20-21). 6 tuiles features + 4 étapes (icônes Material, :31-45).
4. **Statut** : ACTIVE (contenu marketing statique, atteignable via la carte « Logistique » de /business/start quand `LOGISTICS_SIGNUP_ENABLED` ON, et cible du redirect legacy /business/logistics-soon).

## 22.8 `/business/logistics/register` — candidature livreur (waitlist)

1. **Route** : `/{locale}/business/logistics/register` (client, LA page = le fichier, scoped `.lo-mkt` ambre, :8-12). PUBLIC.
2. **Objectif** : candidature self-serve livreur — inscription à la **liste d'attente** (le réseau n'est pas lancé). Gate d'inscription évalué au RUNTIME côté API (`isLogisticsSignupEnabled`, `app/api/logistics/register/route.ts:8` — train f7f8b64).
3. **Champs** (labels `business.logistics.*`) : « type de partenaire » Indépendant/Société (:28), SIREN (optionnel pour l'indépendant — clés `fieldSirenOptional*`), types de missions ×4 (repas / produits fournisseurs / B2B / froid — tuiles à icônes :29-38), véhicules ×5 (vélo / scooter / voiture / camionnette / frigorifique :30-53), zones, nom / e-mail / téléphone de contact, consentement RGPD (→ /legal/confidentialite). Préremplissage `?email` / `?siren` supporté (:13-14). Anti-bot : honeypot `website` + `formStartedAt`.
4. **CTA** : submit → `POST /api/logistics/register` → outcome honnête `active|pending|rejected` + drapeau `waitlist` qui bascule le wording de succès (:85-94, 188-200 ; l'API attache `waitlist` UNIFORMÉMENT tant que l'activation coursier est OFF, route.ts:67). **Aucun e-mail envoyé, aucun auto-login** — le succès dit explicitement qu'on ne peut pas encore se connecter (:19-22). CTA succès + nav retour → /business/logistics.
5. **Faits notables** : la référence de dossier fabriquée de la maquette CD (« LIV-2026-00318 ») a été RETIRÉE (:17-19). Statut : ACTIVE (formulaire réel, waitlist réelle).

## 22.9 `/account` — mock consommateur (DEAD pour le partenaire)

1. **Route** : `/{locale}/account` (server, statique). Gate `consumer/admin` (middleware.ts:242) → un `restaurant` est bounce vers /eat : **inatteignable pour le partenaire**. Rendue sous l'OperatorShell si un admin y va.
2. **La page entière est un MOCK en dur** : « Bonjour, Mohammed » / « Membre depuis janvier 2025 » (:27-28), « 1 240 pts ≈ 12,40€ de réduction disponible » (:37-38), 2 commandes actives inventées (#GR-2241 Gnocchi Bar…, :5-8), 3 commandes d'historique et 3 favoris inventés (:10-16). Ancien design (Card grubano + lucide).
3. **Aucune donnée réelle, aucune API, aucun lien entrant.** L'espace compte réel du consommateur est `/eat/account` (hors périmètre).

## 22.10 `/legal/*` — pages légales publiques

- **Chrome** : layout légal sobre partagé, rendu BARE (BARE_PREFIXES `/legal`), public sans session (middleware.ts:161).
- **`/legal/mentions-legales`** : modèle standard FR dont chaque FAIT (société, hébergeur, médiation) est lu de `lib/legal-info.ts` (:1-13). Tant que `isLegalInfoComplete()` est false : bandeau « **⚠️ Mentions légales en cours de finalisation — les informations relatives à la société et à l'hébergeur ne sont pas encore définitives.** » (`legal.draftBanner`) + **noindex** (robots, :16-20). Le bandeau disparaît de lui-même quand le fondateur remplit lib/legal-info.ts.
- **`/legal/confidentialite`** : même patron. Liens entrants réels : /more (MoreClient.tsx:179-180) + consentements RGPD des formulaires d'inscription.
- **`/legal/cookies`** : inventaire des cookies RÉELLEMENT posés, listés depuis `LEGAL_COOKIES` (lib/legal-info.ts) : NEXT_LOCALE, cookies NextAuth prod, `grubano_estab` (établissement sélectionné), `grubano_ref`, `grubano_chef`, cookies anti-fraude Stripe (:6-14). Fait notable : « **no consent banner/CMP exists** » (:13) — **aucune bannière cookies n'existe dans l'app**. HIDDEN côté opérateur (lié seulement depuis les footers publics, ex. landing livreur).
- **N'EXISTE PAS** : `/legal/cgu` (les formulaires renvoient vers mentions-légales/confidentialité uniquement — logistics/register :23-24).

## 22.11 `/design` + `/design/gb-foundation` — catalogues internes (HIDDEN)

- `/design` : documentation VIVANTE du design system `components/design-system/` — chaque composant exercé dans toutes ses variantes ; « design surface, not a real consumer route », route publique par politique volontaire (:4-11, middleware.ts:134).
- `/design/gb-foundation` : catalogue de la fondation `gb-*`.
- Aucun lien entrant produit ; outillage d'agents/QA. Aucune donnée métier.

## 22.12 Redirects legacy (cibles vivantes)

| Route | Fichier | Comportement |
|---|---|---|
| `/business/auth` | `business/auth/page.tsx:11-13` | redirect inconditionnel → `/auth/magic` (login unifié S2 ; l'inscription a déménagé vers /business/register) |
| `/business/logistics-soon` | `logistics-soon/page.tsx:8-10` | redirect inconditionnel → `/business/logistics/register` (le placeholder « bientôt » est mort, l'onboarding livreur est LIVE) |
| `/pricing`, `/premium` | voir PART 14/18 | redirects inconditionnels → `/more` |
| `/login` | `login/page.tsx:5-7` | redirect inconditionnel → `/eat/auth` |

---
## 22.13 `/add-activity` — hub « Ajouter une activité » (HIDDEN pour le mono-rôle)

1. **Nom utilisateur** : « **Ajouter une activité** » (`addActivity.title`) ; sous-titre « Développez votre compte Grubano. Vos informations vérifiées sont réutilisées — vous ne les saisissez qu'une fois. » (`addActivity.subtitle`).
2. **Route** : `/{locale}/add-activity` — `app/[locale]/add-activity/page.tsx` (server component, `force-dynamic` :19). Chrome : **PartnerChrome LEGACY** (:16, :86 — route dans `BARE_PREFIXES`, pas d'OperatorShell) ; `add-activity.css` recopie localement les tokens `--op-*` (cf. PART 19).
3. **Objectif métier** : hub multi-rôle — proposer au compte connecté d'AJOUTER une activité (fournisseur, créateur, logistique, franchise, affilié, prestataire) en routant vers les parcours d'inscription/candidature EXISTANTS. **La page n'accorde AUCUN rôle et ne fait AUCUNE écriture** (commentaire :22-37 : « No fetch / mutation / create happens here »).
4. **Persona/permission** : tout rôle connecté (auth middleware) ; session absente → `redirect('/auth/magic')` (:59) ; opérateur introuvable → idem (:65).
5. **Données backend** : `Operator {id, role}` (:61-64, select explicite), set de rôles via `readOperatorRoles` (:67), ancre société KYB `getOperatorCompanyIdentity` en best-effort `.catch(() => null)` (:81 — la page marche sans la migration B1.1).
6. **Actions** : cliquer une carte d'activité → navigation vers le parcours cible avec l'e-mail de session en préremplissage VERROUILLÉ + siren/société vérifiés en préremplissage ÉDITABLE (`activityHref`, :112) ; « Établissements » (retour) → `/dashboard` (:88).
7. **Champs éditables** : **AUCUN** (page de routage pure). 8. **Read-only** : cartes d'activité (icône Material, titre, description, badge, CTA).
9. **CTA** :

| LABEL FR | SURFACE | ACTION | EFFET BACKEND | PERSISTÉ | FONCTIONNE | MORT | FLAG | FLOW EXTERNE |
|---|---|---|---|---|---|---|---|---|
| « Établissements » (← retour) | haut de page (:88-91) | `Link` → `/dashboard` | non | — | oui | non | — | non |
| « Commencer » (carte register) | cartes fournisseur/créateur/logistique/affilié/prestataire (:123) | `Link` → parcours d'inscription existant (email verrouillé) | non (le parcours cible, oui) | — | oui | non | flag du rôle | non |
| « Déposer une candidature » + badge « Sur candidature » | cartes en mode apply (franchise…) (:119, :123) | `Link` → parcours de candidature | non | — | oui | non | flag du rôle | non |

10. **Filtres** : **N'EXISTE PAS** (la liste est calculée serveur). 11. **Recherche** : **N'EXISTE PAS**. 12. **Pagination** : **N'EXISTE PAS**.
13. **États métier** : la liste exclut (a) les rôles DÉJÀ détenus (`addableActivities`), (b) les rôles dont le flag est OFF (:69-79 — `SUPPLIER/CREATOR/FRANCHISE/AFFILIATE/PRESTATAIRE_ENABLED`, et `LOGISTICS_SIGNUP_ENABLED` pour la logistique = inscription/waitlist, PAS l'opérationnel). Avec les flags staging actuels (PART 24), un restaurateur mono-rôle ne voit donc que les activités dont le flag est ON.
14. **Empty state** : toutes activités détenues/OFF → icône `task_alt` + « **Vous avez déjà toutes les activités disponibles.** » + « Cette activité sera rattachée à votre compte connecté. » (:96-101).
15. **Loading** : aucun état client (rendu serveur d'un bloc). 16. **Error** : aucun affichage d'erreur propre (les redirects couvrent les cas session). 17. **Success** : sans objet (pas d'écriture). 18. **Disabled** : sans objet.
19. **Mobile / 20. Desktop** : grille de cartes `aa-types` (CSS local, re-skin CD LOT 7) ; PartnerChrome = en-tête centré, colonne unique.
21. **Composants** : PartnerChrome (LEGACY — cf. PART 19), cartes locales `aa-type` (data-role → teinte par rôle).
22. **APIs** : **AUCUNE** côté client ; lectures serveur Prisma uniquement (point 5).
23. **Flags** : les 6 flags de rôle du point 13 (lus AU RENDU serveur — page `force-dynamic`, donc interrupteurs runtime réels, pas figés au build).
24. **Hardcodes** : le mapping icône/titre par activité (:41-52) — présentation seule.
25. **Contrôles morts** : aucun détecté.
26. **Dette factuelle** : PartnerChrome legacy (une des pages restantes — PART 19/25) ; `add-activity.css` duplique les tokens `--op-*` (PART 21, fait n°12) ; la page est **orpheline pour un restaurateur mono-rôle** (aucun lien depuis l'OperatorShell — atteinte par URL directe ou depuis des parcours multi-rôles).

# PART 23 — CHAMPS DE DONNÉES EXACTS (dashboard partenaire)

> Source : `prisma/schema.prisma` @ SHA `981c05d`. Chaque champ ci-dessous est LU dans le schéma (ligne citée). Types Prisma : `String?` = nullable ; `@default(...)` = valeur par défaut ; `Json` = colonne JSON MySQL (pas d'array natif). Les montants du grand livre / factures sont en CENTIMES entiers ; les prix produit (MenuItem, Order, Ticket) sont des `Float` en euros.

## 23.1 Restaurant (établissement) — schema.prisma:1415-1551

Le profil PUBLIC de l'établissement côté conso + ses réglages de fulfillment. **ÉDITABLE PAR LE PARTENAIRE** via le hub (`PATCH /api/restaurants/[id]`, whitelist zod à route.ts:334-347 ; fulfillment via `PATCH /api/restaurants/[id]/fulfillment`, whitelist :15-31).

| Champ | Type | Défaut | Sens métier | Qui édite |
|---|---|---|---|---|
| `id` | String | cuid() | identifiant | système |
| `operatorId` | String | — | propriétaire (Operator) ; indexé, PAS unique → un opérateur peut posséder plusieurs établissements (1416-1420) | système |
| `name` | String | — | nom public (1422) | partenaire (PATCH, max 120) |
| `description` | String? (Text) | null | description publique (1423) | partenaire (max 2000) |
| `coverPhoto` | String? | null | URL photo de couverture (1424) | partenaire (URL) |
| `logo` | String? | null | URL logo (1425) | partenaire (URL, + prefill IA `/api/restaurants/logo-prefill`) |
| `cuisine` | Json | "[]" | array de strings (types de cuisine) — MySQL sans array natif (1426-1427) | partenaire |
| `rating` | Float | 0 | note affichée côté conso — **valeur STOCKÉE, jamais recalculée depuis les Review** (1428 + commentaire 1556-1559) | système (seed) |
| `reviewCount` | Int | 0 | compteur affiché — même statut que rating (1429) | système |
| `deliveryTime` | Int | 30 | temps de livraison affiché, minutes (1430) | partenaire (0-180) |
| `minOrder` | Float | 0 | minimum de commande € (1431) | partenaire (0-500) |
| `deliveryFee` | Float | 1.99 | frais de livraison € (1432) | partenaire (0-50) |
| `city` | String | — | ville (1433) | partenaire (refusée si purement numérique — route:407-419) |
| `address` | String | — | adresse texte (1434) | partenaire (plausibilité vérifiée — route:396-406) |
| `lat` / `lng` | Float? | null | coordonnées géocodées (BAN/IGN) (1435-1436) | **système** — écrites au re-géocodage lors d'un PATCH adresse (route:477-512), effacées si l'adresse change et ne géocode pas |
| `isActive` | Boolean | true | **LA barrière de visibilité /eat** (1437) | partenaire pour PAUSE/reprise ; la 1ʳᵉ publication d'un resto jamais approuvé est ADMIN-only (lib/publication-rule, route:455-475) |
| `archivedAt` | DateTime? | null | soft-delete : établissement avec historique de commandes « supprimé » = archivé (1438-1445) | système |
| `status` | String? | null | cycle de vie B2.4 — libre, **INERTE** (rien ne le lit) (1446-1452) | admin (futur) |
| `approvedAt` | DateTime? | null | tampon d'approbation admin ; conditionne le droit du partenaire à republier (1453, route:455-475) | admin/système |
| `deliveryEnabled` | Boolean | true | canal livraison actif (1457) | partenaire (fulfillment) |
| `pickupEnabled` | Boolean | false | canal Click & collect actif (1458) | partenaire |
| `reservationEnabled` | Boolean | false | canal réservation actif (1459) | partenaire |
| `deliveryRadius` | Int | 5 | rayon de livraison km (1460) | partenaire (0-50) |
| `pickupPrepTime` | Int | 15 | préparation retrait, min (1461) | partenaire (0-180) |
| `deliveryPrepTime` | Int | 30 | préparation livraison, min (1462) | partenaire (0-180) |
| `defaultReservationDurationMin` | Int | 60 | durée de table par défaut, min (1463-1468) | partenaire (15-600) |
| `defaultDepositAmount` | Float | 10 | empreinte de réservation €, la pénalité no-show = 100 % de ce montant, PAS de champ pénalité séparé (1469-1476) | partenaire (0-500) |
| `cancellationWindowHours` | Int | 2 | fenêtre d'auto-annulation client, heures — **PAS d'UI de réglage** (« No settings UI yet », 1477-1482) | personne (défaut figé) |
| `stripeAccountId` | String? @unique | null | compte Stripe Connect Express (1483-1488) | système (onboarding Connect) |
| `stripeAccountStatus` | String? | null | pending \| active \| restricted (1489) | système |
| `stripeOnboardedAt` | DateTime? | null | 1ʳᵉ activation du compte (1490) | système |
| `commissionRateDineIn/Pickup/Delivery` | Float? ×3 | null | overrides de commission par établissement (défauts plateforme 5/8/12 %) — **LUS au checkout** (1491-1501) | admin |
| `commissionFreeUntil` | DateTime? | null | offre fondateurs 0 % bornée (1502) | admin |
| `dineInServiceRatePct` | Float? | 0 | taux de service sur place (ex 0.10), gated DINEIN_SERVICE_ENABLED (1503-1509) | admin |
| `pickupAddress` | String? | null | adresse de retrait (1510) | partenaire (fulfillment, max 500) |
| `pickupInstructions` | String? (Text) | null | consignes de retrait (1511) | partenaire (max 2000) |
| `openingHours` | Json? | null | **LEGACY, JAMAIS LU** — la vraie source est la table OpeningHour (1512-1517 + 1631-1632) | personne |
| `pointOfSaleId` | String? @unique | null | lien 1:1 franchise → PointOfSale, INERTE (1518-1527) | franchiseur |
| `createdAt` | DateTime | now() | — | système |

## 23.2 Brand (marque / concept) — schema.prisma:243-287

Un établissement sert plusieurs marques (dark kitchen). **ÉDITABLE PAR LE PARTENAIRE** via `/brands`.

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `id` | String | cuid() | — |
| `operatorId` | String | — | propriétaire (246) |
| `restaurantId` | String? | null | rattachement à l'établissement (nullable, 253-254) |
| `name` | String | — | nom de la marque (255) |
| `emoji` | String | "🍴" | emoji de la marque (256) |
| `platform` | String | "ubereats" | plateforme d'origine (257) |
| `status` | String | "active" | statut (258) |
| `openToFranchise` | Boolean | false | marque ouverte au franchisage (264) |
| `royaltyPct` | Float? | null | % royalties franchiseur, ex 0.06 (265) |
| `setupFee` | Float? | null | frais d'installation € (266) |
| `franchiseZones` | Json | "[]" | villes/zones autorisées (array de strings) (267) |
| `tagline` | String? | null | pitch page découverte (268) |
| `cuisineType` | String? | null | ex « Italien » (269) |
| `avgMonthlyRevenue` | Float? | null | CA vitrine indicatif (270) |
| `franchiseStatus` | String | "none" | none \| open \| full — badge « Complet » (271) |
| `createdAt` | DateTime | now() | — |

## 23.3 Category (catégories de menu PERSONNALISÉES) — schema.prisma:298-309

**⚠ Ne stocke QUE les catégories custom du partenaire.** Les 4 catégories par défaut (Entrées / Plats / Desserts / Boissons) sont des CONSTANTES front-end, toujours présentes, non supprimables — elles n'existent PAS en base (commentaire 290-293). `MenuItem.category` reste du TEXTE LIBRE (le NOM), pas de FK. **ÉDITABLE** via `GET/POST/PATCH/DELETE /api/menu/categories` (categories/route.ts:48-209).

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `id` | String | cuid() | — |
| `brandId` | String | — | catégories par MARQUE, cascade delete (300-301) |
| `name` | String | — | unique par marque (308) |
| `position` | Int | 0 | ordre d'affichage (303) |
| `createdAt` | DateTime | now() | — |

## 23.4 MenuItem (plat) — schema.prisma:368-390

**ÉDITABLE PAR LE PARTENAIRE** via `/menu` (`POST/PATCH/DELETE /api/menu`, whitelist zod route.ts:17-52 — le PATCH accepte tous les champs du create en partiel + `id`).

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `id` | String | cuid() | — |
| `brandId` | String | — | le plat appartient à une MARQUE (pas à l'établissement) (370) |
| `name` | String | — | nom (372) — API : max 100 |
| `description` | String? (Text) | null | description (373) — API : max 500 |
| `price` | Float | — | prix € (374) — API : > 0 |
| `comparePrice` | Float? | null | prix barré (375) |
| `category` | String | — | NOM de catégorie en texte libre, PAS une FK (376) |
| `calories` | Int? | null | calories (377) |
| `allergens` | Json | "[]" | array de strings (378) |
| `labels` | Json | "[]" | array de strings (végé, épicé…) (379) |
| `photos` | Json | "[]" | **array d'URLs — les photos EXISTENT** (380) ; upload via `/api/menu/photo`, création IA via `/api/menu/scan-dish` | 
| `options` | Json | "[]" | array d'objets LIBRES (pas de modèle Option/Variante typé) (381) |
| `available` | Boolean | true | **la disponibilité EXISTE** (382) ; toggle dédié `PATCH /api/menu/[id]/availability` |
| `isPopular` | Boolean | false | badge populaire (383) |
| `prepTime` | Int? | null | temps de préparation min (384) |
| `createdAt` / `updatedAt` | DateTime | now() / @updatedAt | — |

## 23.5 Order (commande conso) — schema.prisma:2216-2326

**GÉRÉ SYSTÈME** — créé par le checkout conso (`POST /api/orders`) ; le partenaire ne peut QUE faire avancer le `status` (machine à états).

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `id` | String | cuid() | — |
| `consumerId` | String | — | Operator.id du client (2218) |
| `restaurantId` | String | — | établissement (2219) |
| `items` | Json | — | **shape RÉEL validé serveur** (app/api/orders/route.ts:30-38) : `[{ itemId: string, name: string, qty: int 1..99, price: number>0, options: object[] }]` — noms/prix FIGÉS à la commande |
| `subtotal` | Float | — | sous-total € (2222) |
| `deliveryFee` | Float | 1.99 | frais livraison (0 en pickup) (2223) |
| `total` | Float | — | total payé (2224) |
| `status` | String | "received" | received → preparing → ready → picked_up → delivered \| cancelled (2225) |
| `fulfillmentType` | String | "delivery" | delivery \| pickup (2226) |
| `deliveryAddress` | String | — | adresse formatée en TEXTE (2227) |
| `deliveryLat` / `deliveryLng` | Float? | null | coords géocodées, flag LOGISTICS_DISTANCE_FEE_ENABLED (2236-2237) |
| `paymentMethod` | String | "card" | card \| cash \| wallet (2238) |
| `stripePaymentIntentId` | String? @unique | null | PI Stripe (2245) |
| `paymentStatus` | String? | null | null=legacy \| pending \| paid (webhook) (2246) |
| `pointsEarned` | Int | 0 | points fidélité gagnés (2247) |
| `estimatedTime` | Int | 30 | ETA min (2248) |
| `trackingUrl` | String? | null | URL de suivi (2249) |
| `pointOfSaleId` | String? | null | attribution franchise (2252) |
| `referralCode` | String? | null | code parrainage capté au checkout (2258) |
| `promotionId` | String? | null | promo appliquée (résolue SERVEUR) (2265) |
| `discount` | Float | 0 | remise € financée par le resto (2266) |
| `pointsRedeemed` | Int | 0 | points dépensés (2273) |
| `loyaltyCreditCents` | Int | 0 | crédit fidélité en CENTIMES, financé par Grubano (2274) |
| `smallOrderFeeCents` | Int | 0 | frais petite commande, 100 % Grubano (2282) |
| `tipCents` | Int | 0 | pourboire livreur, gated TIPS_ENABLED (2287) |
| `deliveryMode` | String | "restaurant" | restaurant \| grubano_courier \| platform_subsidized — discriminant livraison (2303) |
| `chefSlug` | String? | null | attribution page chef (stat pure) (2313) |
| `createdAt` / `updatedAt` | DateTime | — | — |

## 23.6 Reservation — schema.prisma:540-603

Créée par le STAFF (`POST /api/reservations`) ou le CONSO (`POST /api/reservations/public`). **Le partenaire édite le `status`** (PATCH — enum confirmed|arrived|overrun|cancelled|noshow ; noshow déclenche la capture de l'empreinte, route:356-360).

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `id` | String | cuid() | — |
| `tableId` | String | — | table réservée (542) |
| `restaurantId` | String? | null | établissement, figé à la résa (551) |
| `userId` | String? | null | compte conso lié (null = walk-in/staff) (559) |
| `source` | String | "staff" | 'staff' = saisie équipe (contact visible) · 'eat' = résa conso → le partenaire voit un nom MASQUÉ et NI téléphone NI email (560-566) |
| `customerName` | String | — | nom client (567) |
| `phone` / `email` | String? | null | contact — masqué si source='eat' (568-569) |
| `guests` | Int | — | couverts (570) |
| `date` / `endTime` | DateTime | — | début / fin (571-572) |
| `type` | String | "standard" | quick \| standard \| full (573) |
| `status` | String | "confirmed" | confirmed \| arrived \| overrun \| cancelled \| noshow (574) |
| `allergies` | Json | "[]" | allergies déclarées (575) |
| `preOrder` | Json | "[]" | pré-commande (576) |
| `depositAmount` | Float | 0 | montant d'empreinte € (577) |
| `depositPaid` | Boolean | false | legacy back-compat (578) |
| `noShowPenalty` | Float | 0 | pénalité (579) |
| `stripePaymentIntentId` | String? | null | PI manual-capture de l'empreinte (586) |
| `depositStatus` | String | "none" | none \| authorized \| captured \| released (587) |
| `depositCurrency` | String | "eur" | — (588) |
| `cancelReason` | String? | null | ex 'closure' (auto-annulée par fermeture exceptionnelle) (594) |
| `cancelledBy` | String? | null | 'consumer' \| 'operator' (598) |
| `notes` | String? (Text) | null | notes libres (599) |
| `createdAt` | DateTime | now() | — |

## 23.7 RestaurantTable — schema.prisma:517-538

**ÉDITABLE PAR LE PARTENAIRE** via `/tables` (`POST /api/tables`, zod route.ts:53-60).

`id` · `restaurantId String?` (dark kitchen = 0 table) (526) · `name` (528, API max 50) · `seats Int` (529, API 1-30) · `x`/`y Float @default(50)` (position % sur le plan de salle, 530-531, API 0-100 — jamais rendue) · `active Boolean @default(true)` (532).

## 23.8 TableTicket (addition) + TicketItem — schema.prisma:1677-1722 & 2179-2214

Addition ouverte à une table (QR pay façon Sunday). **Le partenaire ouvre le ticket, ajoute/annule des lignes** ; le PAIEMENT est système (Stripe).

TableTicket : `id` · `restaurantId` · `restaurantTableId` · `reservationId String?` (lien best-effort à la résa pour libérer l'empreinte, 1685) · `status String @default("open")` (open|paid|void, 1686) · `currency @default("eur")` · `subtotal Float @default(0)` (Σ recalculée à chaque écriture, 1688) · `openedAt` · `paidAt?` · `closedReason String?` ('paid'|'void_unpaid'|'void_empty'|'void_manual', 1697-1701) · `closedAt?` · `stripePaymentIntentId?` (1707) · `amountPaid Float?` (1708) · `platformFeeAmount Float @default(0)` (1712) · `tipAmount Float @default(0)` (réservé, jamais collecté, 1714).

TicketItem : `menuItemId String?` (null = LIGNE LIBRE, 2186) · `name` + `unitPrice` **FIGÉS à l'ajout** — un changement de prix menu ne réécrit jamais une ligne facturée (2183-2186) · `quantity Int @default(1)` · `addedBy @default("staff")` ('staff'|'client', 2205) · `options String? @db.Text` (JSON-encodé, même shape que Order.items[].options, 2206) · `notes String?` (« sans oignons », 2207) · `allergies String?` (2208) · `status @default("active")` ('active'|'cancelled' — annulation = SOFT, la ligne reste comme trace, 2209) · `cancelledAt?` (2210).

## 23.9 StockItem — schema.prisma:463-473

**ÉDITABLE** via `/stocks` (upsert `POST /api/stocks`, zod route.ts:48-56).
`id` · `brandId` (le stock est PAR MARQUE, 465) · `name` · `quantity Float @default(0)` · `unit String @default("kg")` · `minThreshold Float @default(0)` (seuil d'alerte) · `dlc DateTime?` (date limite de consommation) · `lastUpdated @default(now()) @updatedAt`.

## 23.10 Supplier / SupplierProduct / SupplierOrder — schema.prisma:477-513

**⚠ TABLES GLOBALES : aucun `operatorId` nulle part** — tout partenaire voit les MÊMES fournisseurs et les MÊMES commandes fournisseur (GET sans filtre opérateur, api/suppliers/orders/route.ts:49-53). Le partenaire PEUT créer un fournisseur (`POST /api/suppliers` — sans UI) et passer une commande (`POST /api/suppliers/orders` — envoyée par EMAIL nodemailer).

- **Supplier** : `name` · `specialty String?` · `zone String?` · `leadTime @default("24h")` · `minOrder Float @default(0)` · `rating Float @default(5.0)` · `apiEnabled Boolean @default(false)` · `phone?` · `email?` (478-488).
- **SupplierProduct** : `supplierId` · `name` · `unit @default("kg")` · `price Float` · `stock String @default("in")` (in|low|out) (493-502).
- **SupplierOrder** : `supplierId` · `items Json` — shape réel validé : `[{ name, quantity, unit, price }]` (route.ts:15-19) · `total Float` · `status @default("pending")` (pending|sent|confirmed|delivered) · `sentAt @default(now())` · `deliveredAt?` (504-513).

## 23.11 Review (avis conso) — schema.prisma:1562-1578

**GÉRÉ SYSTÈME/CONSO** — écrit par le client (upsert, un avis éditable par (user, restaurant), reviews/route.ts:85). Le partenaire ne fait que LIRE.
`restaurantId` · `userId` · `orderId String?` (lien souple) · `rating Int` (1..5) · `text String? @db.Text` · `tags Json @default("[]")` (chips « qu'avez-vous aimé » : taste|service|speed|value|ambiance, 1571) · `status @default("published")` (published|pending|hidden — modération, 1572) · `createdAt/updatedAt`. **PAS de champ réponse du restaurateur** ; `/api/reviews/generate-reply` génère un texte IA mais ne PERSISTE RIEN. Le headline `Restaurant.rating/reviewCount` n'est PAS recalculé depuis ces lignes (1556-1559).

## 23.12 Waitlist (file d'attente resto) — schema.prisma:1603-1617

**GÉRÉ CONSO** — le client rejoint la file ; le partenaire consulte via `/api/restaurants/[id]/waitlist`. `restaurantId` · `userId` · `partySize Int` · `notify Boolean @default(true)` (préférence SMS — l'envoi n'existe pas encore, « delivery = Wave 5 », 1601) · `status @default("waiting")` (waiting|cancelled) · unique (restaurantId,userId). **`position` N'EST PAS UNE COLONNE** — calculée à la lecture (1599-1600).

## 23.13 Fidélité : LoyaltyCustomer / LoyaltyTransaction / Reward / LoyaltyOrder — schema.prisma:313-364

**GÉRÉ SYSTÈME** (crédits sur livraison, débits au paiement). Le partenaire consulte via `/loyalty`.
- **LoyaltyCustomer** : `name` · `email @unique` · `phone?` · `pointsBalance Int @default(10)` (le bonus signup de 10 pts EST le défaut) · `tier @default("bronze")` · `referralCode @unique @default(cuid())` · `referredBy String?` (313-325). **Table GLOBALE keyed par email — pas de lien opérateur/marque sur le client.**
- **LoyaltyTransaction** (grand livre points) : `customerId` · `orderId?` · `type` (earn|redeem|refund) · `points Int` SIGNÉ (332-342). `pointsBalance` reste le cache.
- **Reward** : `customerId` · `type String` (libre) · `promoCode @unique @default(cuid())` · `redeemed Boolean @default(false)` (356-364).
- **LoyaltyOrder** (UberEats legacy) : `customerId` · `brandId` · `uberOrderNumber @unique` · `amount Float` · `pointsEarned Int` · `validatedAt` (344-354).

## 23.14 Promotion — schema.prisma:392-416

**ÉDITABLE PAR LE PARTENAIRE** via `POST/PATCH /api/restaurant/promotions` (create : route.ts:31-42 ; **le PATCH ne touche QUE `active`**, :44-47 — pas d'édition des autres champs après création).
`brandId` · `name` (API 2-80) · `type` (percent|fixed|second_item|threshold_reward, 397) · `discount Float` (398) · `code String? @unique` (promo à CODE saisie par le client, jamais auto-appliquée — **jamais renvoyé à l'UI opérateur**, 399) · `conditions Json @default("{}")` — shape réel : `{ minOrderEur?, itemIds?, channels?('delivery'|'pickup')[], thresholdEur?, rewardKind?('percent'|'free_item'), rewardPct?, freeItemIds? }` (route:20-29) · `startDate`/`endDate` · `active @default(true)` · `campaignId String?` (opt-in campagne chef, 410) · `usageCount`.

## 23.15 OpeningHour / ClosureException — schema.prisma:1633-1668

**ÉDITABLE** : horaires via `PUT /api/restaurants/[id]/hours` (remplace tout, max 50 plages — route:15-22) ; fermetures via `POST /api/restaurants/[id]/closures` (+ DELETE par id).
- **OpeningHour** : UNE LIGNE PAR PLAGE (midi + soir = 2 lignes ; 0 ligne un jour = fermé ce jour ; 0 ligne au total = « non configuré » → aucune restriction, 1620-1624). `dayOfWeek Int` (0=dimanche…6=samedi) · `openTime`/`closeTime String "HH:mm"` (closeTime < openTime = service après minuit ; "24:00" accepté) · `channel @default("all")` (V1 : toujours 'all').
- **ClosureException** : `type @default("closed")` ('special_hours' RÉSERVÉ, non implémenté, 1659) · `dateStart`/`dateEnd DateTime` (jours INCLUSIFS, date-only) · `startTime`/`endTime String?` (fermeture PARTIELLE si renseignés) · `reason String?` **PUBLIQUE ≤140 car.** montrée au conso (1664). Le POST retourne les résas en conflit sans rien créer ; `confirm:true` crée ET annule les résas + libère les empreintes (closures route:29-33).

## 23.16 Operator — champs pertinents partenaire — schema.prisma:13-179

Le compte utilisateur (tous rôles). Champs que le dashboard partenaire manipule/affiche (tokens verify/magic/pendingEmail EXCLUS) :

| Champ | Type | Défaut | Sens | Qui édite |
|---|---|---|---|---|
| `name` / `email @unique` / `phone?` / `city?` | String | — | identité de base (15-19) | partenaire |
| `status` | String | "active" | active \| pending \| pending_review \| suspended (20) | système/admin |
| `statusReason` | String? | null | motif de suspension/refus montré au partenaire (24) | admin |
| `role` | String | "restaurant" | rôle PRIMAIRE ; le SET complet vit dans OperatorRole (25, 71-77) | système |
| `emailVerifiedAt` / `consentAt` | DateTime? | null | vérif email + consentement RGPD horodaté (36, 39) | système |
| `siren` | String? | null | n° SIREN 9 chiffres (110) | système (KYB serveur uniquement — « never by user input », 105-107) |
| `officialName` | String? | null | raison sociale (111) | système (KYB) |
| `legalForm` | String? | null | forme juridique, string libre (112) | système (KYB) |
| `kybStatus` | String? | null | état KYB compte — INERTE, rien ne le lit (113, 105) | système |
| `kybVerifiedAt` | DateTime? | null | (114) | système |
| `vatNumber` | String? | null | n° TVA intracom du PARTENAIRE, affiché sur SA facture de commission (122) | **partenaire** (`POST /api/operator/vat-number`) |
| `country` | String | "FR" | ISO alpha-2 — pilote le TAUX de TVA de la facture via lib/tax.resolveVatRate (123) | partenaire |
| `registeredAddress` | String? | null | adresse du siège (DAC7) (131) | **partenaire** (`POST /api/operator/dac7`) |
| `taxId` / `taxIdCountry` | String? | null | TIN + pays émetteur (132-133) | partenaire (dac7) |
| `dateOfBirth` | DateTime? | null | DAC7, personnes physiques (134) | partenaire (dac7) |
| `sellerType` | String? | null | entity \| individual (135) | partenaire (dac7) |
| `locale` | String? | null | langue email/UI fr\|en\|es\|it\|ar (null ⇒ fr) (164) | partenaire |
| `onboardingNudgeUnsub` | Boolean | false | désinscription des relances onboarding (165) | partenaire (lien unsubscribe) |

## 23.17 Invoice (facture de commission) + InvoiceCounter — schema.prisma:2151-2177

**GÉRÉ SYSTÈME** — une facture par établissement par mois, totaux calculés depuis LedgerEntry (∑ applicationFeeAmount), JAMAIS recomputés depuis les taux (2146-2149). Le partenaire LIT via `/api/restaurants/[id]/invoices` (+ `/pdf` généré à la volée — pas de PDF stocké).
`restaurantId` · `periodStart`/`periodEnd DateTime` (mois, borne fin exclusive) · `number String @unique` — **séquence légale sans trou GRB-YYYY-NNNNN** issue d'InvoiceCounter dans la MÊME transaction (2156-2159) · `totalTtc Int` (CENTIMES — le prélevé réel) · `totalHt Int` (round(ttc/1.2)) · `totalTva Int` (ttc−ht, exact au centime) · `entriesCount Int` · `status @default("issued")` · `issuedAt`. InvoiceCounter : `year Int @id` · `seq Int @default(0)` (2174-2177).

## 23.18 PIÈGES DESIGNER — ce qui N'EXISTE PAS (chaque point vérifié dans le schéma)

1. **Restaurant : PAS de colonne `postalCode`.** Le CP est accepté par le PATCH mais sert UNIQUEMENT à affiner le géocodage BAN — « postalCode has no stored column » (route.ts:434-436). Un formulaire ne pourra jamais RÉAFFICHER le CP saisi.
2. **Restaurant : PAS de téléphone, PAS d'email, PAS de SIRET sur l'établissement** — l'identité société (siren, officialName, vatNumber…) vit sur l'Operator (compte), pas sur le Restaurant.
3. **MenuItem : les photos EXISTENT** (`photos Json`) et **la disponibilité EXISTE** (`available`) — ne pas les inventer manquantes. En revanche : **PAS de TVA par plat, PAS de remise par plat, PAS de SKU, PAS de modèle Variante/Option typé** (`options` = array d'objets libres), **PAS de lien plat↔stock** (aucune FK MenuItem↔StockItem).
4. **Order : PAS de nom/téléphone client sur la commande** — uniquement `consumerId` + `deliveryAddress` texte. **PAS de champ livreur assigné** sur Order (les missions de livraison sont une table `Mission` séparée, flag OFF — schema:2314-2318). **PAS de motif d'annulation** ni timestamps par étape de statut (un seul `status` + createdAt/updatedAt).
5. **Reservation source='eat' : le partenaire ne voit NI téléphone NI email et un nom MASQUÉ** (560-566) — ne pas dessiner une fiche client complète pour les résas venues de l'app conso.
6. **`cancellationWindowHours` : AUCUNE UI de réglage n'existe** (« No settings UI yet ») — figé au défaut 2 h.
7. **Empreinte : UN SEUL montant configurable** (`defaultDepositAmount`) — **PAS de champ pénalité no-show séparé** ; pénalité = 100 % de l'empreinte.
8. **Catégories par défaut (Entrées/Plats/Desserts/Boissons) : n'existent PAS en base** — constantes front, non supprimables ; seules les catégories CUSTOM sont en table. `MenuItem.category` = texte libre, pas de FK.
9. **Fournisseurs legacy : tables GLOBALES, non scopées par partenaire** — Supplier/SupplierProduct/SupplierOrder n'ont AUCUN operatorId/restaurantId ; tout le monde partage le même carnet et le même historique de commandes.
10. **Avis : PAS de champ « réponse du restaurant »** sur Review ; le générateur IA de réponse ne stocke rien. **`Restaurant.rating` n'est PAS la moyenne des Review** — valeur stockée jamais recalculée.
11. **Waitlist : `position` n'est pas une colonne** — calculée à la lecture ; `notify` est une préférence SMS dont l'ENVOI n'existe pas (Wave 5).
12. **Promotion : après création, SEUL `active` est modifiable** (PATCH = {id, active} uniquement). Pas d'édition du nom/dates/remise.
13. **Horaires : `Restaurant.openingHours` (Json) est un champ LEGACY jamais lu** — la source de vérité est la table OpeningHour. 0 ligne = « non configuré » = aucune restriction, PAS « fermé ».
14. **PAS de modèle Abonnement/Premium côté partenaire** (le bloc Premium/billing de /more RETIRÉ ; /pricing et /premium redirigent). Aucune table Subscription/Plan n'existe.
15. **Facture : PAS de PDF stocké** — généré à la demande ; montants en CENTIMES entiers, à formater côté UI.
16. **Fidélité : le client fidélité (LoyaltyCustomer) n'est PAS lié au compte conso Operator** — table séparée keyed email, sans FK vers Operator ni vers un restaurant.
17. **StockItem : PAS de prix/coût, PAS de fournisseur lié, PAS d'historique de mouvements** — un seul enregistrement par article avec quantité courante.
18. **TicketItem : l'annulation d'une ligne est un SOFT-cancel** (`status='cancelled'`, ligne conservée comme trace) ; prévoir l'état « ligne annulée » dans le design de l'addition, pas une disparition.

---

# PART 24 — PERMISSIONS / FLAGS

## A. Modèle de rôles

### A.1 Rôle primaire + SET de rôles (multi-rôle)
- **Rôle primaire** : colonne `Operator.role`, chaîne, défaut `"restaurant"`. Valeurs possibles : `restaurant | franchise | creator | consumer | admin | supplier | logistics | affiliate | prestataire` — `prisma/schema.prisma:25`.
- **SET de rôles** : table `OperatorRole` (une ligne par couple opérateur×rôle, `@@unique([operatorId, role])`) — schema:229-240. La colonne `role` primaire est CONSERVÉE (source de rollback + rôle d'affichage) ; le SET est la vérité d'accès — schema:71-77.
- **Injection en session** : au login, `lib/auth.ts` lit le SET (`readOperatorRoles`) et le pose dans le JWT puis la session : `lib/auth.ts:53`, `:105`, `:154` (fallback `[token.role]` pour les vieux JWT/OAuth), `:163-164`. Côté UI, `session.user.roles` est un tableau ; `session.user.role` reste le primaire.

### A.2 Qui voit quoi — le gate central est `middleware.ts`
- Le middleware gate sur le SET : `hasAny(allowed)` = « au moins UN des rôles de l'utilisateur est dans la liste » — middleware.ts:188-192. Un compte multi-rôle passe dès qu'un rôle convient.
- **Espace partenaire (restaurant)** = `/dashboard` (middleware.ts:200, rôles `restaurant|admin`) + les **23 routes plates opérateur** de `OPERATOR_FLAT_PREFIXES` (:32-37), gate `restaurant|admin` (:251-257). NB : `/pricing` et `/premium` sont désormais des redirects vers `/more` mais restent gatés ici.
- Un non-restaurateur qui tape une URL opérateur est renvoyé vers le **home de son rôle primaire** (`spacesForRoles(roles)[0]`, fallback `/eat`) — :254-256.
- Autres espaces (situer le partenaire) : `/franchise/dashboard` = `franchise|restaurant|admin` (un franchisé EST un restaurateur — :201-205) ; `/creators/dashboard` = `creator|admin` (:206-207) ; `/supplier/**` hors landing/register = `supplier|admin` (:212-215) ; `/logistics/**` = `logistics|admin` (:219-222) ; `/prestataire/**` = `prestataire|admin` (:226-229) ; `/affiliate/**` = `affiliate|admin` sauf `/affiliate/join` (:233-235) ; `/admin/**` = `admin` seul (:238-241) ; `/account` = `consumer|admin` (:242).
- **Routes publiques** (aucune session) : `/`, `/login`, `/design`, `/eat/**`, `/t/[tableId]`, `/business/**` (tout l'espace partenaire pré-login), `/chef/[slug]`, `/ref/[code]`, `/auth/magic` (exact), `/affiliate/apply`, `/legal/**`, `/api/auth/**`, landings `/franchise` et `/creators` hors dashboard, `/supplier` + `/supplier/register` — :134-175.
- **Host partenaire** : sur `business.grubano.com`, la racine localisée redirige vers `/business` — :62-66 ; détection via `lib/partner-host.ts` (env `PARTNER_REGISTER_ALLOW_HOST`).

### A.3 Espaces & switcher (affichage seulement)
`lib/role-spaces.ts` mappe rôle → home : `restaurant → /dashboard`, `franchise → /franchise`, `creator → /creators/dashboard`, `supplier → /supplier/dashboard`, `logistics → /logistics/dashboard`, `prestataire → /prestataire/dashboard`, `affiliate → /affiliate/dashboard`, `consumer → /eat`, `admin → /dashboard` (dédupliqué) — :21-31. Source du RoleSwitcher ; ce fichier **ne gate rien** (commentaire :6 « This changes NOTHING about access control »).

### A.4 Cas particulier `/deliveries`
`/deliveries` n'est PAS dans `OPERATOR_FLAT_PREFIXES` ; son gate vit dans la page : rôles `restaurant|supplier|franchise|admin`, sinon `notFound()` — deliveries/page.tsx:27,38.

### A.5 Doctrine « rôle gelé » (P0-38 / Q8)
Quand le flag racine d'un rôle est OFF, son espace devient **traversant au middleware** (ni login ni redirection) et c'est le **layout serveur** de l'arbre qui répond `notFound()` — une capacité masquée est INTROUVABLE (404), jamais « redirigée » — middleware.ts:121-129 (lecture de `CREATOR_ENABLED`, `SUPPLIER_ENABLED`, `FRANCHISE_ENABLED`, `LOGISTICS_ENABLED`) + :171-175. Layouts 404 : `supplier/layout.tsx:14`, `logistics/layout.tsx:14`, `franchise/layout.tsx:14`, `creators/layout.tsx:14`, `chef/layout.tsx:14`, `eat/c/layout.tsx:14`.

## B. Flags d'environnement — convention et inventaire côté PARTENAIRE

**Convention repo** : un flag est ON uniquement si la variable vaut EXACTEMENT la chaîne `'true'` ; absent/vide/`1`/`TRUE` = OFF. **Tous OFF par défaut au code** — `docs/ops/flags.md:3-5`. Les valeurs vivent dans le `.env.local` de chaque serveur. Couplages obligatoires vérifiés par `scripts/check-flags.mjs` et `tests/flag-coupling.test.ts` — flags.md:68-88.

**Valeurs STAGING actuellement connues** (relevé mission, cohérent avec `scripts/server/staging-classification-read.js:298`) : `RATE_LIMIT_ENABLED` **ON** · `REFUNDS_ENABLED` **ON** · `ADMIN_AUDIT_ENABLED` **ON** · `LOGISTICS_SIGNUP_ENABLED` **ON** · `CLAIMS_ENABLED` **OFF** · `LOGISTICS_ENABLED` **OFF** · `LOGISTICS_COURIER_ACTIVATION_ENABLED` **OFF** · `DELIVERY_FULFILLMENT_ENABLED` **OFF** (bêta = **retrait/pickup uniquement**). Tout flag non listé « ON staging » doit être présumé **OFF** (défaut code).

### B.1 Flags qui changent ce que le PARTENAIRE voit ou peut faire

| Flag | Lecteur canonique | Ce qu'il gate côté partenaire (exact) | Staging |
|---|---|---|---|
| `DELIVERY_FULFILLMENT_ENABLED` | `lib/fulfillment.ts:26-27` | OFF = **retrait uniquement** : `POST /api/orders` refuse le mode `delivery` (403) — orders/route.ts:132, fulfillment.ts:42 ; côté conso la fiche annonce `delivery: flag && restaurant.deliveryEnabled` — restaurants/[id]/route.ts:307. ON = la livraison revient, gouvernée par les colonnes DB `deliveryEnabled`/`pickupEnabled` (FulfillmentForm édite ces colonnes dans les DEUX modes). ⚠️ `pickupEnabled` défaut FALSE en base : un resto sans pickup activé ne reçoit AUCUNE commande — `docs/ops/CLOSED-BETA-RUNBOOK.md:115` | **OFF** |
| `CLAIMS_ENABLED` | `lib/claims.ts` | Le panneau « réclamations » de `/orders` (RestaurantClaimsPanel) ne se rend QUE flag ON — orders/page.tsx:165-168. OFF → /orders byte-identique SANS ce panneau. **Décision fondateur D4 : OFF est FINAL pour la bêta** — eat/order/[orderId]/help/page.tsx:274 | **OFF** |
| `REFUNDS_ENABLED` | `lib/refund.ts` | Moteur de remboursement : outil admin `/api/admin/refunds/run` + rails claims/dispute — flags.md:59. Côté partenaire : AUCUNE UI directe ; le bouton de `/finance` est INERTE (disabled) indépendamment du flag — finance/page.tsx:21,268 | **ON** |
| `LOGISTICS_MISSIONS_ENABLED` | `lib/missions.ts` | Écran `/deliveries` : OFF (défaut) → **aperçu honnête** DeliveriesPreview ; ON → formulaire réel RequestDelivery (POST /api/logistics/missions/request) — deliveries/page.tsx:13-23,44 | OFF (défaut) |
| `PUNITIVE_CAPTURE_ENABLED` | `lib/deposit.ts:21-22` | Capture PUNITIVE d'empreinte de réservation. OFF → le no-show **libère** l'empreinte au lieu de la capturer — reservations/route.ts:357,383,486 ; le choix walk-out « capture » à la clôture de ticket dégrade en libération — tickets/[id]/close/route.ts:108-110. L'empreinte elle-même (pré-autorisation 10 € + libération) n'est PAS gatée par ce flag — CLOSED-BETA-RUNBOOK.md:148. OFF **tout le pilote** (motif juridique) | OFF |
| `DINEIN_SERVICE_ENABLED` | `lib/dinein-service.ts:21` | Frais de service sur l'addition dine-in : OFF (ou taux resto null/0) → `serviceCents = 0` — tickets/[id]/pay/route.ts:95, t/[tableId]/ticket/route.ts:61 | OFF (défaut) |
| `ONBOARDING_GUIDE_ENABLED` | `lib/onboarding-progress.ts:14` | Copilote d'onboarding du hub : OnboardingGuide SELF-GATING — sonde `GET /api/onboarding/guide` et **rend `null`** quand OFF (hub byte-identique) — EstablishmentHub.tsx:336-338, OnboardingGuide.tsx:12 | OFF (défaut) |
| `ONBOARDING_AI_CHAT_ENABLED` | `lib/onboarding-chat.ts:34` | Chat IA « comment faire » du hub : OnboardingChat self-gating (POST 404 OFF) — Hub:339-340, OnboardingChat.tsx:9 | OFF (défaut) |
| `ONBOARDING_AI_SITE_PREFILL_ENABLED` | `lib/site-extract.ts:23` | Préremplissage du profil depuis le site web (SSRF-safe) : POST 404 OFF ; le GET renvoie `enabled:false` — prefill-site/route.ts:20 | OFF (défaut) |
| `ONBOARDING_AI_LOGO_PREFILL_ENABLED` | `lib/logo-detect.ts:13` | Détection/application de logo IA : POST 404 OFF — logo-prefill/route.ts:19 | OFF (défaut) |
| `ONBOARDING_AI_MENU_PREFILL_ENABLED` | `lib/menu-extract.ts:17` | Scan de carte (photo → plats) : POST 404 OFF ; GET renvoie `enabled:false` — scan-card/route.ts:21 | OFF (défaut) |
| `ONBOARDING_NUDGE_ENABLED` | `lib/onboarding-nudge.ts` | Relances email d'onboarding par cron — pas d'UI partenaire | OFF (défaut) |
| `AUTH_EMAIL_CHANGE_ENABLED` | `lib/email-change.ts` | Changement d'email de compte (3 routes confirm) ; OFF → 404 + notice neutre — flags.md:22 | OFF (défaut) |
| `AUTH_EMAIL_OTP_ENABLED` / `AUTH_MONEY_STEPUP_ENABLED` | `lib/email-otp.ts:39-40` | OTP email au login / step-up OTP sur actions argent. OFF → le garde `requireStepUp` est INERTE (retourne ok) — lib/step-up.ts:26 ; `/api/auth/step-up/request` répond 404 — :51 | OFF (défaut) |
| `RATE_LIMIT_ENABLED` | `lib/rate-limit.ts` | Rate-limiting applicatif sur les endpoints publics — aucune UI, mais explique des 429 honnêtes | **ON** |
| `ALLOW_PLATFORM_FALLBACK` | `lib/connect-gate.ts:16-18` | ⚠️ **DANGER-FLAG inversé** : défaut ABSENT = BLOQUANT. Un restaurant SANS compte Stripe Connect ACTIF ne peut PAS encaisser : `/api/orders/[id]/pay` et `/api/tickets/[id]/pay` refusent `409 restaurant_not_payable` — connect-gate.ts:1-23. `true` = QA uniquement, jamais prod. **Conséquence design : un partenaire non-onboardé Stripe a un catalogue visible mais impayable** | absent (bloquant) |
| `SUPPLIER_CONNECT_ENABLED` | `lib/supplier-connect.ts` | Paiements B2B du marketplace fournisseurs — pipeline gaté OFF → le B2B est sans paiement réel | OFF (défaut) |
| `FRANCHISE_POS_TAGGING_ENABLED` | `lib/franchise-pos-tagging.ts:12` | Attribution POS des commandes — orders/route.ts:598. Invisible pour un restaurant non-franchisé | OFF (défaut) |
| `TIPS_ENABLED` | `lib/tips.ts` | Sélecteur de pourboire livreur côté panier CONSO. Aucune UI partenaire ; couplage argent : exige `LOGISTICS_PAYOUT_ENABLED` — flags.md:79 | OFF |
| `LOGISTICS_DISTANCE_FEE_ENABLED` | `lib/logistics-fee.ts` | Aperçu de frais de livraison à la distance dans le panier conso. Sans effet tant que la livraison est OFF | OFF (défaut) |

### B.2 Flags de RÔLE (déterminent quelles « autres activités » un partenaire peut ajouter)

L'écran **« Ajouter une activité »** (`/add-activity`) compose ses cartes à partir des flags de rôle, lus au rendu serveur — add-activity/page.tsx:70-77 : `AFFILIATE_ENABLED`, `PRESTATAIRE_ENABLED`, `SUPPLIER_ENABLED`, `CREATOR_ENABLED`, `LOGISTICS_SIGNUP_ENABLED` (inscription/waitlist, PAS l'opérationnel), `FRANCHISE_ENABLED`. Même logique sur `/business/start` — start/page.tsx:76-77,126.

| Flag | Effet | Staging |
|---|---|---|
| `CREATOR_ENABLED` | Rôle créateur entier : 22 routes + layouts `/creators`, `/chef`, `/eat/c` → 404 OFF | OFF présumé (défaut) |
| `SUPPLIER_ENABLED` | Rôle fournisseur entier (12 routes + layout `/supplier` 404 OFF). ⚠️ L'annuaire opérateur `/suppliers` (pluriel) n'est PAS gaté — feature restaurant — flags.md:60 | OFF présumé |
| `FRANCHISE_ENABLED` | Rôle franchise entier (12 routes, layout `/franchise` 404 OFF) | OFF présumé |
| `LOGISTICS_ENABLED` | Rôle livreur OPÉRATIONNEL (17 routes, `/logistics` 404 OFF). Depuis WAVE 3, ne gate PLUS l'inscription — flags.md:44 | **OFF** |
| `LOGISTICS_SIGNUP_ENABLED` | INSCRIPTION livreur seule : landing `/business/logistics` + formulaire + `POST /api/logistics/register` (waitlist réelle, compte non-connectable). N'ouvre RIEN d'opérationnel — flags.md:45, gate logistics/layout.tsx:27 | **ON** |
| `LOGISTICS_COURIER_ACTIVATION_ENABLED` | Activation des comptes livreurs : OFF → tout inscrit reste `waitlist` | **OFF** |
| `PRESTATAIRE_ENABLED` | Marketplace prestataires : côté PARTENAIRE, gate aussi `/marketplace/prestataires*` (404 OFF) et l'onglet dans `/marketplace` | OFF présumé |
| `AFFILIATE_ENABLED` | Surface affilié entière (404 OFF), y compris `/affiliate/apply` public | OFF présumé |
| `INFLUENCER_ENABLED` | Palier influenceur (vérif audience + taux) — CTA « bientôt » quand OFF | OFF présumé |

### B.3 Flags admin / plomberie (sans surface partenaire directe)
`ADMIN_AUDIT_ENABLED` (journal actions admin — **ON staging**) ; `GHOST_ORDER_AUTO_REFUND_ENABLED`, `CLAIMS_AUTO_APPROVE_ENABLED`, `CLAIM_AUTO_RESOLVE_ENABLED` (+ plafond `CLAIM_AUTO_APPROVE_MAX_CENTS` défaut 0), `CHARGEBACKS_ENABLED`, `ATTRIBUTION_COOKIES_ENABLED`, `CONSUMER_REDESIGN_ENABLED` (arbre `/eat-next` 404 OFF), `LOGISTICS_TRACKING_ENABLED` (géoloc livreur), flags Connect par type de partenaire `CREATOR_CONNECT_ENABLED` / `FRANCHISE_CONNECT_ENABLED` / `LOGISTICS_CONNECT_ENABLED` / `AFFILIATE_CONNECT_ENABLED` / `PRESTATAIRE_CONNECT_ENABLED` / payout `CREATOR_PAYOUT_ENABLED` / `LOGISTICS_PAYOUT_ENABLED` / franchise `FRANCHISE_ROYALTY_ENABLED` / `FRANCHISE_SETTLEMENT_ENABLED` — tous OFF par défaut, inventaire complet dans `docs/ops/flags.md:17-88`.

### B.4 Comment un flag ATTEINT l'UI (pattern à connaître pour dessiner)
Les composants CLIENT ne peuvent jamais lire `process.env` : trois patterns co-existent, tous vus au code —
1. **Gate serveur 404** (layout/page serveur appelle `isXxxEnabled()` puis `notFound()`) — ex. logistics/layout.tsx:27.
2. **Rendu conditionnel serveur** (le serveur choisit quel composant rendre) — ex. /orders claims panel (page.tsx:165), /deliveries aperçu vs formulaire (:44).
3. **Self-gating par sonde API** (le composant client fetch un GET qui répond `enabled:false`, et rend `null` ou un état « bientôt ») — ex. OnboardingGuide.tsx:12, OnboardingChat.tsx:9, prefill-site GET.

## C. ⚠️ Le piège « SSG bankée » — flag ON ≠ visible

**Fait prouvé sur staging le 2026-08-30** (documenté dans le code) : un gate qui lit `process.env` dans un rendu SANS API dynamique est **prérendu STATIQUEMENT au build CI** — et les builds CI tournent sans les flags → le `notFound()` est **cuit dans le déploiement pour toujours** ; poser le flag dans `.env.local` + restart Passenger **ne ressuscite PAS la page** (« flag exactly `true` in env, restart done, page still 404 ») — `app/[locale]/business/logistics/layout.tsx:18-23`. Le correctif est `export const dynamic = 'force-dynamic'` qui fait du flag un vrai interrupteur RUNTIME — :24. Même garde posée sur `/deliveries` — deliveries/page.tsx:25.

**Conséquence pour Claude Design** : quand on annonce « le flag X est ON en staging », l'écran correspondant n'est visible QUE si son gate est évalué au runtime (force-dynamic, ou une API dynamique dans l'arbre). Un écran gaté-au-build reste 404 jusqu'au prochain redéploiement. Ne jamais conclure « la feature est cassée » ou « le design a disparu » sans vérifier ce point.

**Procédure de bascule** (référence, jamais exécutée par Design) : `node scripts/check-flags.mjs` avec le set cible → prérequis DB → éditer `.env.local` serveur → `touch tmp/restart.txt` → vérifier l'effet réel + `version.json` — flags.md:116-129.

## D. Faits de dette (constatés, sans proposition de solution)

- Le bouton de remboursement de `/finance` est **codé disabled en dur** (« INERT: no Stripe call until gate-2 REFUNDS_ENABLED + money review ») — il ne s'activera PAS même flag ON — finance/page.tsx:21,268.
- `CLAIMS_ENABLED=false` est **FINAL pour la bêta** (décision fondateur D4) : le panneau réclamations de `/orders` n'apparaît jamais en bêta.
- `/eat/search` garde des **filtres livraison résiduels** (« Livraison offerte », tri « Plus rapides ») alors que la livraison est OFF pilote — ticket ouvert T-25 — `docs/ops/GO-LIVE-TICKETS.md:41`.
- `pickupEnabled` défaut **FALSE** en base : un établissement dont les modes n'ont pas été posés ne peut recevoir aucune commande en pilote retrait — CLOSED-BETA-RUNBOOK.md:115.
- Le piège SSG (section C) a réellement produit un 404 fantôme en staging malgré flag ON + restart ; tout futur gate de page env doit être audité pour `force-dynamic`.
- `/deliveries` est le SEUL écran opérateur avec une exception fondateur « aperçu visible sous la coquille » (mock honnête sous flag OFF) ; partout ailleurs la doctrine est 404/invisible.

---
# PART 25 — SYNTHÈSE HANDOFF DESIGN

## 25.1 Décompte des routes par statut (58 routes partenaire @ 981c05d)

| Statut | N | Routes |
|---|---|---|
| **ACTIVE** | 32 | `/` (redirect), `/dashboard`, `/dashboard/establishments`, `/dashboard/establishments/[id]`, `/dashboard/fulfillment`, `/tables`, `/orders`, `/prep`, `/menu`, `/stocks`, `/suppliers`, `/customers`, `/customers/[id]`, `/brands`, `/brands/[id]/franchise`, `/promotions`, `/more`, `/marketplace/suppliers`, `/marketplace/suppliers/[id]`, `/marketplace/suppliers/[id]/panier`, `/marketplace/orders`, `/login` (redirect), `/auth/magic`, `/business`, `/business/start`, `/business/register`, `/business/verified`, `/business/onboarding`, `/business/logistics`, `/business/logistics/register`, `/legal/mentions-legales`, `/legal/confidentialite` (+ `/t/[tableId]` = sortie conso du partenaire, comptée hors dashboard) |
| **PARTIAL** | 4 | `/reviews` (envoi de réponse « bientôt »), `/analytics` (nombreux « bientôt »), `/finance` (versements/journal/relevés « bientôt »), `/notifications` (aperçu non branché) |
| **HIDDEN** | 11 | `/loyalty`, `/briefing`, `/cashflow`, `/dinein`, `/onboarding` (wizard), `/marketplace` (hub), `/marketplace/reorder`, `/add-activity`, `/legal/cookies`, `/design`, `/design/gb-foundation` |
| **DEFERRED** | 5 | `/deliveries` (LOGISTICS_MISSIONS_ENABLED), `/marketplace/prestataires`, `/marketplace/prestataires/[id]`, `/marketplace/prestataire-missions` (PRESTATAIRE_ENABLED), `/franchise/dashboard` (FRANCHISE_ENABLED) |
| **LEGACY** | 5 | `/wallet` (mock intégral), `/pricing` (redirect /more), `/premium` (redirect /more), `/business/auth` (redirect /auth/magic), `/business/logistics-soon` (redirect register) |
| **DEAD** | 1 | `/account` (gate consumer/admin — mock, inatteignable pour un restaurant) |

## 25.2 Liste consolidée des contrôles morts restants (visibles à l'écran, sans effet réel)

| # | Écran | Contrôle | Référence |
|---|---|---|---|
| 1 | /briefing | Lignes « Alertes à ne pas rater » — chevron + cursor pointer, `<div>` sans Link ni onClick | briefing/page.tsx:214-218 |
| 2 | /notifications | 15 interrupteurs de préférences (non persistés) + « Tout marquer comme lu » (agit sur des exemples) | notifications/page.tsx:57-64, 115, 173-191 |
| 3 | /tables (Plan) | Faux bouton QR `qr_code_2` sur tuile libre — `<span>` stylé bouton sans handler | TablesShell.tsx:1102 |
| 4 | /tables (UnpaidAlert) | Badge « Service précédent » toujours « Walk-in » (prop jamais alimentée) | UnpaidAlert.tsx:40-45 |
| 5 | /dinein | « Marquer comme servi » + « Encaisser » (pied de modal, disabled) ; « Encaisser » de carte (visuel sans encaissement) | dinein/page.tsx:218-221, 293-298 |
| 6 | /menu | 2 grips `drag_indicator` décoratifs (plats + catégories, aucun handler drag) ; 4 tuiles « Créer une promo » sans onClick | menu/page.tsx:747, 784, 1173-1177 |
| 7 | /stocks | Assistant IA affiche « Stock mis à jour » sans rien persister (mode preview serveur) ; « Réappro. » ouvre le modal Ajuster, pas un flux de commande | stocks/page.tsx:394-399, 444-448, 274-279 |
| 8 | /suppliers (liste de courses) | Boutons « WhatsApp » et « Imprimer » sans onClick ; contenu 100 % mock sans mention d'exemple | suppliers/page.tsx:656-661, 700-701 |
| 9 | /marketplace/…/panier | « Payer en ligne » verrouillé inerte (disabled + cadenas) | CartClient.tsx:318-321 |
| 10 | /customers/[id] | « Offrir des points » + « Message via Grubano » (disabled « Bientôt disponible ») ; zone « Note interne » annoncée sans backend | CustomerProfileClient.tsx:107-112, 209-215 |
| 11 | /reviews | « Envoyer la réponse » (disabled permanent) ; bandeau import Google/TripAdvisor sans action ; onglet « Répondus » structurellement vide | reviews/page.tsx:314-322, 522-525 |
| 12 | /loyalty | Toggle « Programme actif » (checked readOnly, aucun handler) | loyalty/page.tsx:135-138 |
| 13 | /analytics | « Personnalisée » (disabled « Bientôt ») | analytics/page.tsx:183 |
| 14 | /finance | Modal « Rembourser la commande » INATTEIGNABLE (aucun setRefund(true)) ; segments Total/Partiel sans handler ; « Confirmer le remboursement » disabled | finance/page.tsx:232-274 |
| 15 | /wallet | Bouton envoi chat + bouton partage (aucun onClick) ; page entière = mock | wallet/page.tsx:60-62, 72-74 |
| 16 | /brands | « Gérer · Bientôt » sur marque détachée (span aria-disabled) | brands/page.tsx:467-482 |
| 17 | /brands/[id]/franchise | Onglet unique « Conditions de franchise » role=tab sans handler | franchise/page.tsx:189 |
| 18 | /dashboard/fulfillment | 7 contrôles inertes « Bientôt » : toggle « Accepter les commandes en ligne », 3 chips pause + « Reprendre maintenant », prep par défaut + 2 chips coup de feu, prep sur place | FulfillmentForm.tsx:186-230, 379-385 |
| 19 | /more | 5 rangées inertes « Bientôt » : Profil, Sécurité & mot de passe, Langue, Centre d'aide, Contacter le support | MoreClient.tsx:118-122, 175-177 |
| 20 | OperatorShell | « Équipe · Bientôt » + « Copilote IA · Bientôt » (spans aria-disabled) ; chevron profil sans dropdown ; clic switcher mono-établissement sans effet ; cloche sans badge de non-lus | OperatorShell.tsx:46, 159-162, 176/187, 203-211 |
| 21 | /orders | « En attente de validation » — disabled volontaire (état informatif, pas un défaut) | OrdersClient.tsx:370-372 |
| 22 | /deliveries (aperçu) | Tous les boutons d'action inertes sauf « voir » (panneau détail) | DeliveriesPreview.tsx |

## 25.3 Dette design factuelle consolidée (constats, pas de solutions)

**Systèmes de design**
1. **Deux (parfois trois) systèmes de design cohabitent sous la même coquille** : CD navy `--op-*` + Material Symbols + Gabarito/Hanken (majorité) vs shadcn/Tailwind + lucide + Inter (legacy). Écrans mixtes : hub établissement (3 langages sur une page — PART 17), /tables (modals argent en lucide), /orders (panneau claims), /menu (onglet Adopter + MenuPrefillImport), /more (forms fiscaux), /marketplace (découverte legacy vs catalogue op-*). Écrans entièrement legacy : /wallet, /account, /marketplace/suppliers, /marketplace/prestataires*.
2. **32+ copies de la même grammaire CSS** (`op-card`, `op-modal`, `op-field`, `op-btn-*`, `op-sk`, `op-emptyline`, `op-error__card`) recopiées fichier par fichier — aucune feuille partagée ; seule operator-shell.css porte les tokens. Valeurs légèrement divergentes entre copies (stat-strip orders vs prep).
3. **3 patrons concurrents pour « confirmer une action »** : op-modal CD, Modal design-system, `window.confirm()` natif. Suppression de plat SANS confirmation vs suppression de catégorie AVEC modale.
4. Dégradé orange `#FF8A3D→#F2570E` dupliqué en dur ≥ 7 fois ; deux styles de boutons primaires orange aux paddings différents.

**Navigation & découvrabilité**
5. **8 routes opérateur orphelines** de toute navigation (/loyalty, /briefing, /cashflow, /dinein, /deliveries, /marketplace hub, /marketplace/reorder, /onboarding) — deux au contenu réel (/loyalty, /briefing).
6. **Deux écrans « promotions » aux données différentes** : onglet Promos de /menu = 3 mocks en dur ; /promotions = les vraies — et /promotions n'a qu'UN lien entrant (bandeau /menu:1139), aucune entrée sidebar.
7. **Deux wizards d'onboarding câblés coexistent** (/onboarding 4 étapes plein écran orphelin vs /business/onboarding 2 étapes vivant), appelant les mêmes endpoints ; deux frises de progression divergentes dans le tunnel partenaire.
8. **Deux systèmes fournisseurs parallèles non connectés** (legacy /suppliers euros/e-mail vs marketplace cents/state-machine) — l'utilisateur change de monde ET de langage visuel en cliquant.
9. Sur mobile, 9 destinations de la sidebar ne sont accessibles QUE via le drawer hamburger (bottom-nav = 5 onglets).

**Cohérence des données affichées**
10. **Deux « CA du jour » incompatibles** : /dashboard et /finance agrègent `Order` ; /briefing et /analytics agrègent `LoyaltyOrder` (UberEats) — deux pages voisines peuvent afficher des CA sans rapport, sans mention de la source. Deux seuils « stock bas » différents (×1 vs ×1.2).
11. **Terminologie divergente pour le même booléen `isActive`** : « Publié / Non publié » (liste + topbar) vs « En ligne / Hors ligne » (header hub) vs « Fermer temporairement / Rouvrir » (zone sensible).
12. **Labels de paliers fidélité incohérents** : « Argent / Or » (/customers) vs « Silver / Gold » (/loyalty).
13. « Actualisé à » = heure du rendu client, jamais l'heure des données serveur (dashboard, analytics, finance).
14. La moyenne d'avis de /reviews peut différer de la note affichée aux consommateurs (`Restaurant.rating` jamais recalculé).

**Contrôles mensongers / honnêteté**
15. **Assistant IA stock mensonger** (« Stock mis à jour » sans écriture) — le seul cas où l'UI MENT activement ; /wallet = seul écran affichant des chiffres inventés sans marqueur d'aperçu. Partout ailleurs, la doctrine « Bientôt » honnête est respectée (bandeaux, tags, disabled).
16. **Beaucoup de « Bientôt »** : ~la moitié de la surface du cockpit (/dashboard tuiles live + Copilote, /briefing météo/insights, /notifications entier), /analytics (6 zones), /finance (4 cartes), /dashboard/fulfillment (7 contrôles), /more (6 rangées), /loyalty (stats).
17. Textes périmés : « Le paiement par QR arrivera bientôt » (/tables) alors que le composant existe ; « Impossible de charger le tableau de bord » sur l'écran Cuisine ; canal « API/WhatsApp » affiché sans intégration (/suppliers).

**Comportements techniques visibles**
18. « Actualiser » = `location.reload()` sur dashboard/analytics/finance/cashflow/dinein (pas de refetch in-place) ; reload complet après prefill IA.
19. Échecs silencieux : modal stock (se ferme comme un succès), liste /menu (aucun error state), fetch établissements du shell (`catch(() => {})` → nav gelée sans message), /customers (erreur = empty state), carte Connect absente sans indice.
20. Pas de pagination NULLE PART (take 20/50/100 en dur selon les écrans — les enregistrements au-delà sont invisibles sans aucun indicateur) ; pas d'export ; pas de recherche serveur.
21. Breakpoints désalignés : coquille 880px, tables→cartes 900px, /customers 640px, fiche client 760px, marketplace 940/1000/1180px — et /wallet en Tailwind 768/1024.
22. Empreinte de résa : le formulaire envoie 10 € en dur en ignorant la valeur configurée dans Config (même écran) ; KPI « Acomptes » structurellement à 0 € pendant le pilote.
23. Toasts non systémiques (2 pages sur ~30) ; collapse sidebar non persisté ; boutons `<button>` imbriqués dans `<Link>` sur la home.

## 25.4 Captures AVANT

Les captures d'écran de l'état AVANT (desktop + mobile, par route) sont déposées dans **`docs/design/shots-981c05d/`** (dossier versionné à côté de ce document). Toute proposition de redesign doit être comparée à ces captures — elles constituent la baseline visuelle au SHA `981c05d`.

**81 captures, nomenclature `<surface>-<largeur>.jpg`** (largeurs 390 / 768 / 1440, pleine page, session partenaire réelle sur données réelles de test) : `dashboard`, `reservations-tables`, `orders`, `kitchen-prep`, `menu`, `promotions`, `stocks`, `suppliers`, `customers`, `reviews`, `analytics`, `finance`, `wallet`, `cashflow`, `loyalty`, `dinein`, `marketplace`, `briefing`, `notifications`, `brands`, `establishments-list`, `establishment-hub`, `settings-more`, `auth-magic`, `operator-login` (montre la redirection réelle vers `/fr/eat/auth`), `courier-signup`, `courier-register`. Les surfaces gatées OFF (prestataires, deliveries) et les modales ne sont pas capturées — se référer aux fiches.

## 25.5 LES INTERDITS — ce que Claude Design ne doit JAMAIS inventer

Rappel de la doctrine : **si ce n'est pas documenté ici, ça n'existe pas.** Les pièges les plus probables (source : PART 23.18 + sections « N'EXISTE PAS » par PART) :

1. **Pas de variantes / tailles / options de plat** dans l'UI (colonne `options Json` libre en base, ZÉRO interface) ; pas de prix barré ni prepTime dans l'UI ; UNE seule photo par plat (pas de galerie) ; pas de TVA/remise/SKU/coût matière par plat ; pas de lien plat↔stock.
2. **Photos et disponibilité des plats EXISTENT** (photos Json + available + toggle) — ne pas les inventer manquantes non plus.
3. **Pas de coordonnées client** nulle part (commandes, clients, résas /eat) — masquage volontaire par construction, PAS un manque : ne jamais dessiner email/téléphone/adresse client.
4. **Pas de code postal ré-affichable** sur l'établissement (aucune colonne `postalCode` — le champ démarre vide).
5. **Pas de téléphone/email/SIRET sur l'établissement** (l'identité légale vit sur le COMPTE, dans /more).
6. **Pas d'abonnement, plan, billing, Premium, page tarification** — retirés ; aucune table Subscription n'existe.
7. **Pas d'édition/suppression d'une promotion** après création (seul le toggle actif/inactif) ; pas de codes promo côté opérateur.
8. **Pas d'édition d'une réservation** après création (statut seul) ; pas d'annulation depuis /tables ; un seul montant d'empreinte (pas de pénalité séparée) ; capture no-show DÉSACTIVÉE pilote.
9. **Pas de réponse aux avis persistée** (brouillon IA volatile), pas de modération, pas d'avis externes.
10. **Pas de notifications réelles** (pas de modèle en base, pas de compteur, pas de push), pas d'équipe/staff, pas de Copilote IA global, pas de chat/messagerie.
11. **Pas de pagination, pas d'export CSV/PDF, pas de recherche serveur, pas de tri de colonnes, pas de drag & drop** dans les listes opérateur.
12. **Pas de solde/IBAN/versements Stripe dans l'app** (tout sur la page hébergée Stripe ; commissions jamais exposées).
13. **Pas de plan de salle positionné** (x/y stockés, jamais rendus), pas de vue semaine/datepicker de résas.
14. **Pas de stock valorisé** (aucun prix sur StockItem), pas d'historique de mouvements, pas de suppression d'article.
15. **Pas de livraison en bêta** (`DELIVERY_FULFILLMENT_ENABLED` OFF = pickup only) ; un resto sans Stripe Connect actif est **impayable** (`409 restaurant_not_payable`).
16. **Catégories par défaut (Entrées/Plats/Desserts/Boissons) = constantes front**, pas des données ; `MenuItem.category` = texte libre sans FK.
17. **`Restaurant.rating` n'est pas la moyenne des avis** (valeur stockée jamais recalculée).
18. **Prévoir l'état « ligne annulée » sur l'addition** (soft-cancel = la ligne reste barrée, ne disparaît jamais).
19. Le nombre de cartes de `/business/start` varie de 1 à 6 selon les flags de rôle — ne jamais figer une grille à 6.
20. Un écran gaté par flag peut rester 404 malgré « flag ON » (piège SSG, PART 24.C) — ne pas conclure à une régression design.

---
*Fin de l'inventaire factuel — SHA `981c05d`, 2026-08-30. Toute évolution du code invalide potentiellement ce document : re-vérifier au SHA courant avant tout handoff.*
