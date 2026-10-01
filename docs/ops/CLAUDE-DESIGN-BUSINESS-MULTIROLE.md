# CLAUDE DESIGN — BUSINESS ACQUISITION + MULTI-ROLE ONBOARDING (handoff factuel) · 2026-08-29

> Handoff READ-ONLY préparé par la mission BETA FUNCTIONAL CLOSURE. **Claude Design n'a PAS été lancé** — ce document attend le GO fondateur. Tu n'as aucun accès au dépôt : tout l'état nécessaire est ici. Compléments : `CLAUDE-DESIGN-GENERAL-DELTA.md` (delta général 28 points), `CLAUDE-DESIGN-BUSINESS-ONBOARDING.md` (brief onboarding, JAMAIS consommé), `DESIGN-CODE-GAP-MATRIX.md` (114+ surfaces).

## 1-3. État actuel du tunnel business (vérifié à l'écran + code, develop 2026-08-29)

**Tunnel homogène PartnerShell (`pt-*`, réf maîtresse `partner-shell.html` bankée 23/08) sur 5 écrans** : `/business` (vitrine) → `/business/start` (choix du métier) → `/business/register` → `/business/verified` → `/business/onboarding` (mode parcours). **UN SEUL trou au milieu : `/auth/magic`** (l'écran de connexion), resté sur le chrome legacy `PartnerChrome` (`grubano-*` + lucide) ET conditionné au hostname `business.*` détecté CÔTÉ CLIENT : sur tout autre hôte le candidat voit un conteneur nu sans logo NI lien « Inscrire mon entreprise » ; le SSR est une page BLANCHE (bailout Suspense `fallback={null}`). Mismatch intégral vs réf (logo glyphe lucide vs `grubano-symbol-color.svg` 28px, Space Grotesk vs Gabarito, orange legacy #F97316 vs VIVID #FF6A1F, canvas froid vs chaud #FBF8F3, largeurs 1152/448 vs 1080/560, badge « Espace vérifié » HORS réf). Un correctif code converge pour les trois défauts : détection d'hôte côté serveur (`lib/partner-host.isPartnerHostValue` + headers) + fallback Suspense non nul — à coordonner avec ta maquette.

## 4. L'ancien « aperçu dashboard » retrouvé (archéologie git) — SAFE À RÉUTILISER

Ce dont le fondateur se souvient existe en DEUX morceaux historiques :
- **Le visuel** : `HeroMockup` + `MetricCard` (commit `b2173d8`, 2026-06-16, `app/[locale]/business/page.tsx` de l'époque) — carte premium avec fausse barre de navigateur (pilule `business.grubano.com` + cadenas), 2 tuiles métriques (« Commandes 1 248 +12 % », « Revenus 8 640 € +8 % »), bloc « Activité récente » 3 lignes squelettes, badge vérifié flottant. **Zéro élément interactif, zéro donnée réelle, valeurs littérales** → SAFE. Retiré par `5b5ac58` (remplacement de shell PartnerShell), PAS par décision produit. **Les clés i18n existent encore ×5 locales** (`business.landing.mockUrl/mockOrders/mockRevenue/mockActivity/mockRow1..3`, orphelines).
- **Le squelette 2 colonnes pitch/formulaire** : l'écran `/business/auth` historique (commit `00d7d92`, retiré `20b8ad7` « unify partner login ») — barre de marque + colonne pitch (H1 + 3 puces, masquée <md) + colonne carte d'auth. Clés i18n encore vivantes (`business.auth.heroTitle/heroBullet1..3`).
- ⚠️ **NE PAS réutiliser** la 3ᵉ variante (celle que le fondateur a probablement VUE) : c'était un DÉFAUT — le vrai OperatorShell (sidebar réelle, useSession, 28 prefetches, appels API 401) servi aux anonymes autour du formulaire magic (fenêtre `c2d59cb`→`f7829e4`). Aujourd'hui `lib/app-chrome-rules.ts` + 39 tests INTERDISENT tout chrome opérateur sur `/auth/magic` — garde-fou à respecter : le futur aperçu doit être un COMPOSANT STATIQUE à placeholders (modèle `HeroMockup`), jamais les vrais composants.

**Concept cible validé fondateur (desktop)** : aperçu neutralisé de l'espace partenaire (placeholders, aucun CA réaliste, aucune commande crédible) + formulaire e-mail de connexion visible à côté. **Mobile : connexion prioritaire, aperçu secondaire.**

## 5-6. Onboarding restaurateur — mesures responsive (2026-08-29, prod build)

| Largeur | Colonne form | Vide de chaque côté | Débordement |
|---|---|---|---|
| 390 | 308 px | 41 px | 0 |
| 768 | 462 px (carte `max-w-xl` 576) | 153 px | 0 |
| 1024 | 462 px | 281 px | 0 |
| 1280 | 462 px | 409 px | 0 |
| 1440 | 462 px | **489 px** | 0 |

**Verdict : MOBILE-FIRST ACCEPTABLE, conforme à ta réf** (`--pt-form:560px` mono-colonne) — AUCUN défaut CSS mécanique. Le ressenti fondateur (« une expérience mobile posée au milieu d'un desktop ») est une conséquence du PARTI PRIS mono-colonne : c'est un chantier DESIGN (multi-colonne desktop ? résumé latéral ? double frise à résorber — ton brief `CLAUDE-DESIGN-BUSINESS-ONBOARDING.md` le dénonce déjà et n'a jamais été transformé en réf). **Priorité n°1 de ce chantier.**

## 7-9. Routes restaurateur / livreur / waitlist livreur

- **Restaurateur (rôle principal, opérationnel)** : `/business` → start → register (passwordless, honeypot, RGPD) → verified → `/auth/magic` → onboarding → console opérateur (`/dashboard`…). Publication admin-only (`/admin/approvals`, advisory Connect + advisory GÉO ambre depuis WAVE 2).
- **Livreur (WAITLIST RÉELLE depuis WAVE 3)** : landing LO4 `/business/logistics` (re-skin CD, bandeau waitlist honnête) + formulaire LO5 `/business/logistics/register` → `POST /api/logistics/register` → `LogisticsProfile{status:'pending'}` + Operator non-connectable + e-mails (confirmation candidat honnête « aucun compte actif », alerte admin B5a). SIREN **optionnel pour un indépendant** (aucun appel de vérification payant sans SIREN), requis société. Gaté `LOGISTICS_SIGNUP_ENABLED` (OFF par défaut — le fondateur l'active sur staging) ; l'OPÉRATIONNEL (17 routes, dashboards) reste sous `LOGISTICS_ENABLED` OFF ; l'ACTIVATION sous `LOGISTICS_COURIER_ACTIVATION_ENABLED` OFF. **Aucun dashboard livreur, aucune promesse de date/zone/revenu.**

## 10-17. Inventaire multi-rôles (état RÉEL des 6 métiers secondaires)

| Métier | Landing | Register | Flag | État réel flags OFF | Vetting |
|---|---|---|---|---|---|
| Livreur | LO4 re-skin CD | LO5 complet | `LOGISTICS_SIGNUP_ENABLED` (nouveau) | **WAITLIST OUVERTE dès activation du flag** | SIREN optionnel indép. ; activation = 2ᵉ verrou |
| Fournisseur | `/supplier` | complet | `SUPPLIER_ENABLED` | mort/invisible | SIREN vérifié ⇒ `active` IMMÉDIAT (pas de waitlist !) |
| Créateur | `/creators` | apply complet | `CREATOR_ENABLED` | mort | vetting YouTube+LLM |
| Franchise | `/franchise` | wizard public | `FRANCHISE_ENABLED` | mort | approbation admin |
| Prestataire | (pas de landing) | register direct | `PRESTATAIRE_ENABLED` | mort | SIREN ⇒ `active` immédiat |
| Affilié | `/affiliate/apply` | complet | `AFFILIATE_ENABLED` | mort | **grant INSTANTANÉ sans vetting** |

⚠️ **Contrainte produit clé** : seul le LIVREUR possède un second verrou d'activation indépendant → ouvrir son inscription n'ouvre rien. Pour fournisseur/prestataire/affilié, ouvrir l'inscription crée des comptes ACTIFS immédiatement — décision produit d'un autre ordre, à ne pas déclencher par design.

## 18-19. CTA actuels & dead links résiduels

Cartes `/business/start` conditionnelles aux flags (masquées, jamais cassées — patron sain). Depuis WAVE 3, la carte Logistique apparaît avec le flag signup. Dead controls business résiduels : AUCUN sur le tunnel restaurateur (reality check 29/08 : onboarding Next/Save PASS, register PASS, magic PASS avec erreurs honnêtes 429/5xx depuis WAVE 1). Résiduel P2 hors tunnel : tuiles « Créer une promo » de `/menu` opérateur (4, inertes sous un callout honnête).

## 20. Composants réutilisables

PartnerShell (vitrine + parcours, frise d'étapes, footer légal, RTL Cairo), grammaire `pt-*` (canvas #FBF8F3, zest #FF6A1F, Gabarito/Hanken, Material Symbols), `HeroMockup`/`MetricCard` (à re-créer depuis `git show b2173d8` — concept SAFE), clés i18n orphelines des deux anciens écrans (×5 locales, rien à re-traduire), advisory ambre admin (patron Connect+géo).

## 21. Contraintes produit (récapitulatif dur)

1. RESTAURATEUR = rôle principal, plus grande importance visuelle.
2. Rôles non ouverts → interest/waitlist UNIQUEMENT ; pas de faux dashboard ; aucune fonction inactive prétendue active.
3. Aperçu dashboard = STATIQUE, placeholders, jamais les vrais composants (garde `app-chrome-rules` + tests).
4. `/auth/magic` : chrome hors-hostname à résoudre côté serveur (une ligne de code prête) — ta maquette doit couvrir l'état « hôte quelconque ».
5. Aucune promesse : date, délai, revenu, zone, activation automatique (waitlists).
6. Système COMMUN et extensible pour l'entrée des métiers (pas une page totalement différente par métier).
7. Wording argent D2 inchangé ; lexique canonique FR (Click & collect · restaurant, jamais « établissement »).

## Ordre de travail suggéré
① Onboarding restaurateur desktop (brief prêt) · ② `/auth/magic` en PartnerShell + concept « aperçu + connexion » (A+C ci-dessus) · ③ entrée multi-rôles `/business/start` avec états waitlist · ④ landing `/business` : réintégrer un aperçu produit neutralisé (HeroMockup 2.0).
