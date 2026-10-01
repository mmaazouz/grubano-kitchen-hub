# RÉPÉTITION STAGING — CHECKLIST HUMAINE (FINAL BETA ACCEPTANCE)

> **Mission** : rejouer À LA MAIN, sur staging, le parcours complet
> partenaire → admin → consommateur → retrait → refund, avec de VRAIS clics
> et de VRAIS e-mails, avant le Clean Room.
>
> **Mode d'emploi** : avancez bloc par bloc. À chaque **CHECKPOINT**, arrêtez-vous,
> exécutez la commande indiquée (cPanel → Terminal) et collez la sortie + vos
> réponses `STEP n PASS` (ou la description du problème) dans la conversation.
> Claude vérifie, puis vous donne le feu vert pour le bloc suivant.

---

## ⛔ INTERDITS ABSOLUS (relire avant de commencer)

1. **JAMAIS** `test@grubano.com`, `resto@grubano.com` ni aucune autre identité
   compromise/démo. Les DEUX seules identités de cette répétition :
   - Partenaire : **pilote-resto@grubano.com**
   - Consommateur : **pilote-client@grubano.com**
2. **JAMAIS de vraie carte bancaire.** Stripe **TEST uniquement** —
   carte `4242 4242 4242 4242`, date d'expiration future quelconque, CVC quelconque.
3. **JAMAIS de vraie société** ni de vraies données bancaires dans le parcours
   Stripe Connect (mode TEST : utiliser les valeurs de test proposées par Stripe).
4. L'établissement créé s'appelle **« Rehearsal Beta Grubano »** — identité
   clairement TEST, mais avec une **vraie adresse française valide** (une adresse
   publique réelle, p. ex. celle d'un lieu public de votre ville) pour que le
   géocodage fonctionne.
5. Aucune autre écriture en base que celles produites par les clics du parcours.

**Hôtes** : parcours partenaire = `https://business.grubano.com` ·
parcours conso + admin = `https://app.grubano.com` (même build).

---

## BLOC 0 — PRÉPARATION

**STEP 0.1** — PERSONA : fondateur
- FAIRE : vérifier que vous recevez bien les e-mails sur **pilote-resto@grubano.com**
  ET **pilote-client@grubano.com** (envoyez-vous un e-mail de test sur chacune,
  ou vérifiez l'accès webmail).
- ATTENDU : les deux boîtes sont lisibles par vous.
- RÉPONDRE : `STEP 0.1 PASS` ou décrire.

**STEP 0.2** — PERSONA : fondateur
- URL : cPanel → **File Manager**
- FAIRE : télécharger la sauvegarde `~/backups/staging-2026-08-30-0133.sql.gz`
  sur votre machine **LOCALE** (clic droit → Download). Vérifier la taille > 0.
- ATTENDU : le fichier `.sql.gz` est sur votre disque local.
- RÉPONDRE : `STEP 0.2 PASS` + taille du fichier.

**STEP 0.3** — PERSONA : fondateur
- URL : cPanel → **Terminal**
- FAIRE :
  ```bash
  cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/rehearsal-verify.js baseline
  ```
- ATTENDU : un inventaire « baseline » sans erreur.
- RÉPONDRE : coller la **sortie complète**.

**STEP 0.4** — PERSONA : fondateur *(correction constatée par sonde : la page
d'inscription livreur répond 404 sur staging — le flag n'est pas actif dans le
runtime malgré l'édition précédente)*
- URL : cPanel → **Terminal**
- FAIRE (la 1ʳᵉ commande n'affiche qu'un COMPTE, jamais le contenu du fichier) :
  ```bash
  grep -c '^LOGISTICS_SIGNUP_ENABLED=true$' ~/app.grubano.com/.env.local
  ```
  - Si le résultat est `1` : la ligne est bonne → il manquait le restart :
    `touch ~/app.grubano.com/tmp/restart.txt`
  - Si le résultat est `0` : éditer `~/app.grubano.com/.env.local` pour que la
    ligne soit EXACTEMENT `LOGISTICS_SIGNUP_ENABLED=true` (sans espace, sans
    guillemets, sans majuscules ailleurs), puis
    `touch ~/app.grubano.com/tmp/restart.txt`
- ATTENDU : après ~1 min, Claude re-sonde `/fr/business/logistics` → 200.
- RÉPONDRE : `STEP 0.4 PASS` + le compte affiché (0 ou 1).

### ✅ CHECKPOINT 0 — coller : sortie `baseline` + STEP 0.1/0.2/0.4. Attendre le feu vert.

---

## BLOC A — PARTENAIRE (pilote-resto@grubano.com UNIQUEMENT)

**STEP A.1** — PERSONA : partenaire (navigateur normal ou profil dédié)
- URL : `https://business.grubano.com/fr/business`
- FAIRE : parcourir la landing partenaire, cliquer le bouton d'inscription
  (parcours « Restaurateur ») — vous passez par `/fr/business/start`
  (« Quel type de partenaire êtes-vous ? ») → carte **Restaurateur** →
  `/fr/business/register`.
- ATTENDU : formulaire d'inscription restaurateur : **nom + e-mail + consentement
  RGPD** (pas de mot de passe — connexion passwordless par lien magique).
- RÉPONDRE : `STEP A.1 PASS` ou décrire.

**STEP A.2** — PERSONA : partenaire
- URL : `https://business.grubano.com/fr/business/register`
- FAIRE : remplir — Nom : `Pilote Rehearsal` · E-mail : `pilote-resto@grubano.com`
  · cocher le consentement → **« Créer mon compte partenaire »**.
- ATTENDU : message générique « Si ces informations sont valides, un e-mail de
  vérification vient d'être envoyé… ».
- RÉPONDRE : `STEP A.2 PASS` ou décrire.

**STEP A.3** — PERSONA : partenaire
- FAIRE : ouvrir la boîte **pilote-resto@grubano.com** (regarder les spams).
- ATTENDU : e-mail RÉEL « **Confirme ton email — espace partenaire Grubano** »
  (expéditeur `contact@grubano.com`) avec un bouton **« Vérifier mon email »**.
- RÉPONDRE : `STEP A.3 PASS` ou décrire (délai, spam, rien reçu).

**STEP A.4** — PERSONA : partenaire
- FAIRE : cliquer **« Vérifier mon email »** dans l'e-mail.
- ATTENDU : atterrissage sur `/fr/business/verified?status=success` — page de
  confirmation avec invitation à se connecter par lien magique.
- RÉPONDRE : `STEP A.4 PASS` + le `status=` visible dans l'URL.

**STEP A.5** — PERSONA : partenaire
- URL : `https://business.grubano.com/fr/auth/magic`
- FAIRE : saisir `pilote-resto@grubano.com` → demander le lien magique →
  ouvrir l'e-mail reçu → cliquer le lien de connexion.
- ATTENDU : session ouverte ; redirection vers l'espace partenaire
  (onboarding `/fr/business/onboarding` si proposé, sinon tableau de bord).
- RÉPONDRE : `STEP A.5 PASS` + URL d'atterrissage.

**STEP A.6** — PERSONA : partenaire
- URL : `https://business.grubano.com/fr/business/onboarding`
- FAIRE — **étape 1 « Créez votre marque »** : Nom de marque
  `Rehearsal Beta Grubano` · type de cuisine au choix (ex. Pasta) · emoji →
  **Continuer**.
- ATTENDU : passage à l'étape 2 « Votre restaurant ».
- RÉPONDRE : `STEP A.6 PASS` ou décrire.

**STEP A.7** — PERSONA : partenaire
- FAIRE — **étape 2 « Votre restaurant »** : Nom `Rehearsal Beta Grubano` ·
  description courte · **adresse française RÉELLE et valide** + ville + code
  postal · modes : **« Retrait sur place » = ACTIVÉ, « Livraison » = DÉSACTIVÉ**
  (attention : par défaut c'est l'inverse — cliquez les deux boutons) →
  **Terminer**.
- ATTENDU : écran « **Votre espace est créé ✅** » (avec la mention explicite
  qu'un admin doit valider la mise en ligne). **Aucun** avertissement ambre
  d'adresse non géolocalisée (si un avertissement apparaît : l'adresse est mal
  saisie — le signaler).
- RÉPONDRE : `STEP A.7 PASS` + « avertissement adresse : oui/non ».

**STEP A.8** — PERSONA : partenaire
- FAIRE : cliquer **« Aller au tableau de bord »**, puis ouvrir la fiche de votre
  établissement (Dashboard → Établissements → « Rehearsal Beta Grubano » —
  URL de la forme `/fr/dashboard/establishments/<id>`).
- FAIRE : renseigner les **horaires d'ouverture** (section horaires du hub
  établissement) — des horaires plausibles couvrant l'heure actuelle.
- ATTENDU : horaires enregistrés sans erreur.
- RÉPONDRE : `STEP A.8 PASS` + l'`<id>` visible dans l'URL (utile pour la suite).

**STEP A.9** — PERSONA : partenaire
- URL : `/fr/menu` (menu de gauche « Menu »)
- FAIRE : **« Ajouter un plat »** — nom (ex. `Risotto rehearsal`), **prix**
  (ex. 14,50 €), et **allergènes** (champ « Allergènes (les 14 INCO) » —
  obligatoire ; sélectionnez au moins 2 allergènes réels du plat, ex. lait,
  céleri). Rattacher le plat à la marque si demandé. Enregistrer.
- ATTENDU : le plat apparaît dans la liste du menu avec son prix.
- RÉPONDRE : `STEP A.9 PASS` ou décrire.

**STEP A.10** — PERSONA : partenaire
- URL : la fiche établissement (`/fr/dashboard/establishments/<id>`)
- FAIRE : carte « **Encaissements** » → **« Configurer »** → suivre le parcours
  **Stripe Connect en mode TEST** jusqu'au bout (utiliser EXCLUSIVEMENT les
  valeurs de test proposées par Stripe — **jamais** de vraies données bancaires
  ni de vraie société). Revenir sur Grubano à la fin.
- ATTENDU : au retour, statut « **Compte actif — reversements quotidiens** »
  (éventuellement après un rafraîchissement ; un toast « Encaissements
  activés ✓ » peut s'afficher).
- RÉPONDRE : `STEP A.10 PASS` + le statut affiché.

### ✅ CHECKPOINT A — exécuter dans cPanel → Terminal :
```bash
cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/rehearsal-verify.js partner
```
Coller la sortie + vos `STEP A.n PASS` / problèmes. Attendre le feu vert.

---

## BLOC B — ADMIN (approbation)

**STEP B.1** — PERSONA : admin (navigateur/profil SÉPARÉ du partenaire —
fenêtre privée dédiée conseillée)
- URL : `https://app.grubano.com/fr/auth/magic`
- FAIRE : se connecter avec le **compte admin permanent** (lien magique envoyé
  sur l'adresse admin provisionnée — cf. `docs/ops/provision-admin.md`).
- ATTENDU : session admin ouverte.
- RÉPONDRE : `STEP B.1 PASS` ou décrire.

**STEP B.2** — PERSONA : admin
- URL : `https://app.grubano.com/fr/admin/approvals`
- FAIRE : identifier la ligne **« Rehearsal Beta Grubano »** dans les
  établissements en attente. Vérifier que la ligne indique un compte
  d'encaissement **actif** (le Connect du STEP A.10).
- ATTENDU : le dossier rehearsal est visible et complet.
- RÉPONDRE : `STEP B.2 PASS` ou décrire.

**STEP B.3** — PERSONA : admin
- FAIRE : **vrai clic** sur « **Approuver & publier** » pour
  « Rehearsal Beta Grubano ».
- ATTENDU : confirmation de publication ; la ligne quitte la file d'attente.
- RÉPONDRE : `STEP B.3 PASS` ou décrire.

### ✅ CHECKPOINT B — coller vos `STEP B.n`. Claude vérifie la publication de
son côté via l'API publique (`GET https://app.grubano.com/api/restaurants?q=Rehearsal`)
**et** vous fait relancer :
```bash
cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/rehearsal-verify.js partner
```
Attendre le feu vert.

---

## BLOC C — CONSOMMATEUR (pilote-client@grubano.com UNIQUEMENT)

> Utiliser un navigateur/profil **différent** de ceux du partenaire et de
> l'admin (idéalement votre téléphone, pour la géolocalisation réelle).

**STEP C.1** — PERSONA : conso
- URL : `https://app.grubano.com/fr/eat/auth`
- FAIRE : onglet **« Créer un compte »** — nom, e-mail
  `pilote-client@grubano.com`, mot de passe (nouveau, robuste, jamais
  réutilisé ailleurs) → créer le compte, puis se connecter.
- ATTENDU : session conso ouverte, redirection vers `/fr/eat`.
- RÉPONDRE : `STEP C.1 PASS` ou décrire.

**STEP C.2** — PERSONA : conso
- URL : `https://app.grubano.com/fr/eat`
- FAIRE : accepter la **permission de géolocalisation** quand le navigateur la
  demande (ou l'activer via le bouton de position de la page d'accueil).
- ATTENDU : votre position/ville est lisible sur l'accueil et le tri par
  proximité est actif ; **« Rehearsal Beta Grubano » est visible** dans la
  liste (il vient d'être publié).
- RÉPONDRE : `STEP C.2 PASS` + « resto visible : oui/non ».

**STEP C.3** — PERSONA : conso
- URL : `https://app.grubano.com/fr/eat/search`
- FAIRE : rechercher `Rehearsal` dans la recherche texte.
- ATTENDU : « Rehearsal Beta Grubano » ressort dans les résultats.
- RÉPONDRE : `STEP C.3 PASS` ou décrire.

**STEP C.4** — PERSONA : conso
- FAIRE : ouvrir la fiche du restaurant (`/fr/eat/r/<id>`), taper sur le plat
  `Risotto rehearsal`.
- ATTENDU : la fiche du plat s'ouvre et affiche les **allergènes AVANT
  l'achat** (ceux saisis au STEP A.9, ex. lait, céleri).
- RÉPONDRE : `STEP C.4 PASS` + les allergènes affichés.

**STEP C.5** — PERSONA : conso
- FAIRE : **« Ajouter au panier »**, puis ouvrir le panier
  (`/fr/eat/cart`) → **« Passer la commande »**.
- ATTENDU : redirection vers `/fr/eat/checkout/<orderId>`.
- RÉPONDRE : `STEP C.5 PASS` ou décrire.

**STEP C.6** — PERSONA : conso
- URL : `/fr/eat/checkout/<orderId>`
- FAIRE : lire l'écran de checkout SANS rien payer d'abord. Vérifier :
  - section « **Point de retrait** » avec « **Retrait chez Rehearsal Beta
    Grubano** » + l'**adresse du restaurant** ;
  - **AUCUN sélecteur d'adresse de livraison** conso ;
  - **AUCUN ETA / délai de livraison** promis.
- ATTENDU : les 3 points ci-dessus sont vrais.
- RÉPONDRE : `STEP C.6 PASS` ou décrire ce qui s'affiche en trop/en moins.

**STEP C.7** — PERSONA : conso
- FAIRE : payer via le module Stripe (« Payer … € ») avec la carte TEST
  **4242 4242 4242 4242**, date future, CVC quelconque.
- ATTENDU : paiement accepté → écran de **confirmation** de commande.
- RÉPONDRE : `STEP C.7 PASS` + le montant payé.

### ✅ CHECKPOINT C — exécuter :
```bash
cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/rehearsal-verify.js order
```
Coller la sortie + vos `STEP C.n`. Attendre le feu vert.

---

## BLOC D — RESTO + RETRAIT (les deux personas en parallèle)

**STEP D.1** — PERSONA : partenaire
- URL : `https://business.grubano.com/fr/orders` (menu « Commandes »)
- FAIRE : vérifier que la commande du conso **apparaît RÉELLEMENT** côté
  restaurateur, puis cliquer **« Accepter »**.
- ATTENDU : la commande passe en préparation côté resto.
- RÉPONDRE : `STEP D.1 PASS` ou décrire.

**STEP D.2** — PERSONA : partenaire
- FAIRE : faire avancer la commande via les vrais boutons de la machine à
  états : **En préparation** → **Prête**.
- ATTENDU : chaque transition est acceptée.
- RÉPONDRE : `STEP D.2 PASS` ou décrire.

**STEP D.3** — PERSONA : conso
- URL : `/fr/eat/orders` → ouvrir la commande (suivi `/fr/eat/track/<orderId>`)
- FAIRE : ouvrir le **pass de retrait** (bouton du suivi →
  `/fr/eat/order/<orderId>/pickup`).
- ATTENDU : **QR code réel** (code `GR-…`) + **adresse du restaurant** visible.
- RÉPONDRE : `STEP D.3 PASS` + le code `GR-…`.

**STEP D.4** — PERSONA : conso
- FAIRE : **vrai clic** sur « **Itinéraire** » sur le pass de retrait.
- ATTENDU : l'application cartographique s'ouvre avec **l'adresse du
  RESTAURANT** comme destination ; **aucun ETA Grubano** n'est affiché dans
  l'app Grubano.
- RÉPONDRE : `STEP D.4 PASS` + l'adresse reçue par l'app cartographique.

**STEP D.5** — PERSONA : partenaire
- FAIRE : simuler la remise en boutique : passer la commande à **Récupérée**
  puis à sa **complétion finale** (« Livrée/Terminée ») via les vrais boutons.
- ATTENDU : chaque transition est acceptée dans l'ordre.
- RÉPONDRE : `STEP D.5 PASS` ou décrire.

**STEP D.6** — PERSONA : conso
- URL : `/fr/eat/account` (ou `/fr/eat/rewards`)
- FAIRE : vérifier la **cagnotte fidélité**.
- ATTENDU : des **points ont été crédités** pour la commande complétée
  (~1 point / € + bonus d'inscription éventuel).
- RÉPONDRE : `STEP D.6 PASS` + le solde de points.

### ✅ CHECKPOINT D — relancer :
```bash
cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/rehearsal-verify.js order
```
Coller la sortie + vos `STEP D.n`. Attendre le feu vert.

---

## BLOC E — REFUND (2e commande TEST)

**STEP E.1** — PERSONA : conso
- FAIRE : repasser une **2e commande TEST** identique (menu → panier →
  checkout → paiement carte **4242…** — mêmes règles qu'au bloc C).
- ATTENDU : 2e commande payée et confirmée.
- RÉPONDRE : `STEP E.1 PASS` + le montant.

**STEP E.2** — PERSONA : partenaire
- URL : `https://business.grubano.com/fr/orders`
- FAIRE : sur cette 2e commande, cliquer le **refus / annulation** côté resto
  (vrai bouton, sans l'accepter).
- ATTENDU : la commande passe à « Annulée » alors qu'elle est payée.
- RÉPONDRE : `STEP E.2 PASS` ou décrire.

**STEP E.3** — PERSONA : admin
- URL : `https://app.grubano.com/fr/admin/reconciliation`
- FAIRE : vérifier que la 2e commande apparaît dans la vue des commandes
  **annulées-payées** (argent capté, remboursé = 0).
- ATTENDU : la ligne est visible avec le montant payé.
- RÉPONDRE : `STEP E.3 PASS` + le montant affiché.

**STEP E.4** — PERSONA : admin
- FAIRE : déclencher le **refund Stripe TEST** via le rail admin. ⚠️ Il n'y a
  **pas de bouton dans l'interface** : le rail est
  `POST /api/admin/refunds/run` (session admin requise — Claude ne peut PAS
  l'appeler à votre place). Depuis l'onglet admin connecté, ouvrir la console du
  navigateur (F12) et exécuter — `<orderId>` = l'identifiant visible dans l'URL
  de la 2e commande (`/fr/eat/checkout/<orderId>` ou `/fr/eat/track/<orderId>`,
  STEP E.1) :
    ```js
    fetch('/api/admin/refunds/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: '<orderId>', reason: 'rehearsal refus resto' }),
    }).then(r => r.json()).then(console.log)
    ```
- ATTENDU : réponse OK ; le remboursement Stripe TEST est créé (`re_…`).
- RÉPONDRE : `STEP E.4 PASS` + la réponse JSON (ou l'erreur — un 403 « gated »
  signifie que le flag REFUNDS_ENABLED est OFF sur staging : le signaler).

**STEP E.5** — PERSONA : admin
- FAIRE : rejouer **le même appel** une 2e fois (idempotence).
- ATTENDU : la 2e tentative est **refusée ou no-op** — il n'existe qu'**un
  seul** remboursement pour cette commande.
- RÉPONDRE : `STEP E.5 PASS` + la réponse de la 2e tentative.

### ✅ CHECKPOINT E — relancer :
```bash
cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/rehearsal-verify.js order
```
Coller la sortie + vos `STEP E.n`. Attendre le feu vert.

---

## BLOC F — FIN DE RÉPÉTITION

**STEP F.1** — PERSONA : fondateur
- URL : cPanel → **Terminal**
- FAIRE :
  ```bash
  cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/rehearsal-verify.js final
  ```
- ATTENDU : inventaire pré-clean complet (comptes/commandes/refunds créés par la
  répétition, rien d'autre).
- RÉPONDRE : coller la **sortie complète**.

**STEP F.2** — PERSONA : fondateur
- FAIRE : reconfirmer que la sauvegarde du STEP 0.2 est bien sur votre machine
  locale (le fichier existe, taille > 0).
- RÉPONDRE : `BACKUP DOWNLOADED LOCALLY = YES` (obligatoire, verbatim).

### ✅ CHECKPOINT F — coller : sortie `final` + `BACKUP DOWNLOADED LOCALLY = YES`.
La répétition est close ; le Clean Room peut être planifié.
