# DATA SUBJECT RIGHTS — RUNBOOK V1 (closed beta)

> Workflow **MANUEL** de traitement des demandes de droits RGPD (accès, rectification,
> export, suppression, limitation, opposition) pendant la closed beta.
> Aucun self-service n'existe à ce jour hors : modification du profil consommateur
> (`PATCH /api/eat/account` — nom, téléphone, préférences de notification), CRUD des
> adresses (`/api/eat/addresses`), changement d'email (flag `AUTH_EMAIL_CHANGE_ENABLED`).
> Ce runbook est l'outil de l'admin ; il ne constitue pas un avis juridique.
> Les DURÉES de réponse et la politique de rétention sont des décisions
> fondateur/conseil — voir `LEGAL-COUNSEL-BETA-PACKET.md` (questions 4-5).

---

## 0. Canal et pré-requis

- **Canal d'entrée** : l'adresse de contact publiée (aujourd'hui de facto
  `contact@grubano.com` ; le contact « données personnelles » officiel de
  `lib/legal-info.ts` (`privacy.dpoContact`) est **[[FOUNDER FACT — à renseigner]]**).
- **Registre** : consigner chaque demande (date de réception, identité alléguée,
  droit exercé, décision, date de réponse). En bêta : un fichier tenu par le
  fondateur suffit, à condition d'être systématique.
- **Trace produit** : si `ADMIN_AUDIT_ENABLED` est ON, journaliser l'action finale
  (`AdminAuditLog`, action `privacy.request`) — sinon la ligne du registre fait foi.

## 1. Vérification d'identité (obligatoire avant toute réponse)

1. Répondre UNIQUEMENT à l'adresse email du compte concerné (jamais à une adresse
   tierce « qui écrit pour » — demander alors une preuve de mandat).
2. Défi technique réutilisable : demander à la personne de déclencher un
   **magic-link** (`/auth/magic` ou `/eat/auth`) et de répondre depuis la session
   connectée (capture de l'écran compte), OU répondre à un code envoyé à
   l'adresse du compte. Ne jamais demander le mot de passe.
3. En cas de doute → ne rien communiquer, demander un élément supplémentaire
   (ex. : n° d'une commande récente + montant).

## 2. Sources de données par persona (inventaire exhaustif au schéma)

**Consommateur** : `Operator` (compte : name, email, phone, city, locale,
notifPrefs) + `OperatorRole`, `Account`/`Session` (OAuth/NextAuth), `Address`
(adresses de livraison), `Order` (commandes : items, deliveryAddress, montants,
`stripePaymentIntentId`), `LoyaltyCustomer` + `LoyaltyTransaction` (fidélité),
`Reservation` (résa : nom, téléphone, email, **allergies**), `Review`, `Waitlist`,
`CreatorFollow`, `PromoRedemption`, `Referral` (customerId), `EmailLog`
(destinataire+sujet de chaque email), `EmailOtp` (journal de codes par email),
`VerificationToken` (reset mot de passe). Hors DB : Stripe (PaymentIntents du client —
dashboard Stripe), logs serveur o2switch (`~/logs/`).

**Partenaire restaurateur** : `Operator` (+ champs KYB/DAC7 self-déclarés,
`consentAt`, tokens hachés), `Restaurant` (établissement), `Brand`/`MenuItem`,
factures de commission (`Invoice`), `LedgerEntry`, Stripe Connect (KYC chez
Stripe, seul l'`acct_` id est en base), vérification SIREN
(recherche-entreprises.api.gouv.fr — rien n'y est stocké).

## 3. Procédures par droit

### ACCÈS / EXPORT (art. 15 / 20)
1. Vérifier l'identité (§1).
2. Sur le serveur (cPanel Terminal, jamais en local — la DB locale est une QA) :
   requêtes **SELECT uniquement** sur les tables du §2 filtrées par
   l'`Operator.id` / l'email du demandeur.
3. Compiler un JSON/PDF lisible, remettre par réponse email au compte.
4. Ne JAMAIS inclure : données d'un tiers (ex. autre client d'une même résa),
   secrets, tokens, identifiants Stripe complets.

### RECTIFICATION (art. 16)
- Rediriger d'abord vers le self-service (profil, adresses). Sinon : UPDATE ciblé
  admin sur le champ concerné, consigné au registre.

### SUPPRESSION (art. 17) — décision par table
- `Operator` : la suppression **cascade** `Address`, `OperatorRole`, `Session`.
- `Order`, `LedgerEntry`, `Invoice` : **NE PAS supprimer** (trace comptable /
  obligations légales) → **anonymiser** le lien (la stratégie exacte — mise à
  null de `consumerId`, écrasement de `deliveryAddress` — est une décision
  conseil : question posée au LEGAL-COUNSEL-BETA-PACKET).
- `Reservation.userId`, `Referral.customerId` : scalaires **sans FK** — les mettre
  à null explicitement (sinon lignes orphelines pseudonymisées).
- `LoyaltyCustomer`, `Review`, `Waitlist`, `CreatorFollow`, `EmailLog`,
  `EmailOtp` : suppression par email.
- Stripe : la suppression côté Stripe (customer/PI) se fait dans le dashboard
  Stripe, dans les limites de leurs obligations propres.
- Toujours : pré-vol SELECT → suppression bornée en transaction → preuve
  post-suppression (COUNT = 0), sur le modèle de l'ACTION 2 du Founder Action
  Pack précédent.

### LIMITATION / OPPOSITION (art. 18 / 21)
- V1 : suspendre le compte (`status='suspended'`, `password=NULL` si demandé)
  et consigner ; aucun traitement marketing n'existe (zéro tracker, zéro pub),
  l'opposition se limite donc aux emails transactionnels non indispensables.

## 4. Ce qui N'EXISTE PAS encore (à ne pas promettre)
- Bouton « supprimer mon compte » ; export self-service ; purges automatiques
  (hors géoloc livreur, flag OFF). Toute promesse publique de délai de réponse
  est interdite tant que le fondateur n'en a pas fixé un.
