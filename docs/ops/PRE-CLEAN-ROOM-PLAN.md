# PRE-CLEAN ROOM — SÉQUENCEMENT, RÉPÉTITION, EXCLUSIONS
> Préparé le 2026-08-29 (mission PRE-CLEAN SAFETY). AUCUNE suppression n'a été faite.
> Ce document fixe l'ordre des opérations pour le prochain master. Une seule passe destructive, à la fin.

## Ordre exact des phases

**PHASE 1 — LOCAL CLEAN DB ZERO-TO-ORDER.** Sur une base QA locale VIERGE (nouvelle base MariaDB, pas la QA actuelle) : restaurant créé de zéro par le vrai flow → conso → Stripe TEST → commande → pickup → QR → complétion → remboursement. Prouve le produit sans AUCUNE fixture. La répétition staging ne remplace PAS ce test — elle vient après.

**PHASE 2 — STAGING DRESS REHEARSAL** (répétition jetable, AVANT tout nettoyage). Pourquoi avant : staging est encore pollué → la répétition y ajoute des données identifiées → le clean room final efface AUSSI la répétition → une seule passe destructive → le vrai pilote devient le premier compte de la base propre.

**PHASE 3 — FINAL CLEAN ROOM** (destructif, une seule fois, sur la base du script de classification + confirmation fondateur ligne à ligne).

**PHASE 4 — POST-CLEAN EMPTY SMOKE** (lecture seule : catalogue vide classe A, admin fonctionne, version.json, aucun résidu).

**PHASE 5 — REAL PILOT FIRST ACCOUNT** (checklist runbook 7.1 : marque, pickup, allergènes, géocodage, Connect actif, approbation admin).

## ⚠️ STAGING ENVOIE DE VRAIS E-MAILS
Aucune garde d'environnement n'empêche l'envoi réel (vérification partenaire, magic-link, confirmations). Le plan de répétition EXIGE donc :

**UNE VRAIE BOÎTE MAIL JETABLE, POSSÉDÉE PAR LE FONDATEUR** (une boîte réelle créée pour l'occasion — pas d'adresse fictive, pas de contournement de vérification, pas de patch temporaire d'auth, pas de désactivation d'e-mail). Idéalement DEUX : une pour le partenaire de répétition, une pour le consommateur de répétition (ou le même fournisseur avec deux adresses).

## Répétition staging — parcours complet (jetable)
e-mail jetable réel → inscription partenaire `/business/register` → e-mail de vérification RÉEL reçu → vérification → onboarding (adresse RÉELLE → géocodage automatique — vérifier lat/lng non nuls) → marque → établissement → pickup activé → horaires → menu → produit → allergènes REMPLIS → Connect TEST → approbation admin (`/admin/approvals` avec le PERMANENT ADMIN) → publication → compte conso de test (2ᵉ e-mail jetable réel si nécessaire) → géolocalisation → recherche → panier → auth → Stripe TEST (cartes de test) → commande → réception restaurateur → préparation → prête → pass QR (adresse + « Voir l'itinéraire ») → complétion → fidélité → scénario remboursement (si retenu dans l'acceptance).

## Identification des données de répétition (moyens EXISTANTS — aucun champ ajouté)
La clé de corrélation = **l'e-mail jetable** (unique, choisi ce jour-là) :
- `Operator.email` (partenaire + conso de répétition) → cuid `Operator.id` ;
- `Restaurant.ownerId`/relation opérateur → resto de répétition (+ `Brand`, `MenuItem` rattachés) ;
- `Order.consumerId` + `Order.restaurantId` → commandes ; `LedgerEntry.orderId` ; `Refund` ;
- `LogisticsProfile.email` si un test livreur est joué ;
- Stripe TEST : `stripeAccountId` (acct_ de test) créé ce jour-là ;
- `EmailLog`/`EmailDispatch` : lignes `to = e-mail jetable`.
Consigner les DEUX adresses jetables + la date/heure de la répétition dans le rapport de PHASE 2 : c'est la liste de suppression de PHASE 3.

## CLEAN ROOM — EXCLUSIONS (à protéger explicitement)
- le **PERMANENT BETA ADMIN** (créé par `scripts/server/provision-admin.js` — mécanisme officiel : passwordless, idempotent, audité) ;
- données système/bootstrap (config plateforme, `VerificationToken`/NextAuth actifs du permanent admin) ;
- tout **utilisateur bêta réel** ; tout **pilote réel** (dont « Riz dala » cmq0903ib00097u0t0vzt327h TANT QUE sa provenance n'est pas confirmée par le fondateur — seul resto staging géocodé, Paris 11ᵉ) ;
- les **inscriptions livreur réelles** de la waitlist (LogisticsProfile non-test) ;
- toute donnée légitime classée REAL ou UNKNOWN par le script de lecture.

## CLEAN ROOM — CIBLES de suppression (après confirmation fondateur)
- fixtures démo historiques : comptes seed versionnés **`test@grubano.com`, `resto@grubano.com`, `resto2@grubano.com`, `franchise@grubano.com`, `createur@grubano.com`** (mots de passe `Test1234!`/`Demo1234!` VERSIONNÉS dans le repo = identités compromises par construction) + franchiseurs DEMO ;
- restos de test : `demo-resto-test-profile`, `demo-resto-test-2-profile`, `rest_001`…`rest_006`, « QA Bistro » `cmsv2uonq0002dpauu6pqq4d5` (+ marques/menus/commandes rattachés) ;
- conso QA : `qa-*@grubano.test`, `qa+op@grubano.test`, `contact+qabeta*@grubano.com` et leurs commandes/réservations/fidélité ;
- données de la répétition PHASE 2 (par e-mail jetable) ;
- toute ligne TEST PROVED supplémentaire révélée par le script de lecture.

## Règles absolues
UNKNOWN = DO NOT DELETE · REAL = DO NOT DELETE · SYSTEM = DO NOT DELETE · PERMANENT ADMIN = DO NOT DELETE. Jamais de TRUNCATE ; suppressions par identifiants explicites uniquement ; le script de lecture (`scripts/server/staging-classification-read.js`) se rejoue APRÈS nettoyage pour vérifier `TEST PROVED: 0`.

## KIT DE RÉPÉTITION (R1 — prêt, à exécuter APRÈS neutralisation + flags + zero-to-order local + classification UNKNOWN)
Checklist d'exécution (une session, ~45 min) :
1. **Deux adresses jetables RÉELLES** créées par le fondateur (partenaire + conso) — un alias réellement reçu est acceptable ; noter les deux adresses + l'heure de début.
2. Partenaire : `/fr/business/register` → e-mail de vérification RÉEL reçu → vérifier → onboarding (adresse réelle → vérifier lat/lng ≠ null au dossier admin) → pickup ON → menu + produit + **allergènes remplis** → Connect TEST → `/admin/approvals` (permanent admin) → approuver → publier.
3. Conso : géoloc → l'établissement apparaît trié → recherche → panier → auth (2ᵉ jetable) → checkout pickup (« Retrait chez X + adresse ») → carte TEST 4242 → commande.
4. Restaurateur : reçoit → prépare → prête → conso : pass QR (adresse + « Voir l'itinéraire ») → remise → fidélité créditée.
5. Remboursement : 2ᵉ commande payée → refus restaurateur → rail refund admin → `re_` TEST → e-mail → réconciliation ; re-tenter le refund → refus (idempotence).
6. Clôture : re-jouer `staging-classification-read.js` → les données de répétition apparaissent (UNKNOWN avec e-mail jetable) → les consigner comme lot « REHEARSAL » du Clean Room. Vérifier `PUBLIC CREDENTIAL ACTIVE WITH PASSWORD = 0` toujours vrai.
Corrélation cleanup : tout part de l'e-mail jetable → `Operator.id` → Restaurant/Brand/MenuItem/Order/LedgerEntry/Refund/EmailLog (requêtes du script d'évidence). AUCUN champ ajouté au schéma.
