# E3-COPY — current copy verbatim for this tranche (extracted from `../EMAIL-COPY-VERBATIM.md`)

> Fixtures: Léa Martin / Gnocchi Bar / GR-ABC123 / 12 sept. 2026 19:30. Do not rewrite here — designed copy goes in the tranche deliverables.

### AUTH_STEPUP_CODE
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Votre code de confirmation Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Confirmation de sécurité
- **Body (text of the HTML):**

```text
Confirmation de sécurité
 Pour confirmer un retrait, saisissez ce code de confirmation :
 424242
 Ce code est valable 10 minutes et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail et vérifiez votre compte.
```
- **CTA:** none
- **Footer:** none
- **Plain-text part:** yes — verbatim:

```text
Confirmation de sécurité Grubano.
Pour confirmer un retrait, saisissez ce code : 424242
Valable 10 minutes, une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.
```


### ACCOUNT_EMAIL_CHANGE_CODE
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Votre code de confirmation Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Confirmation de sécurité
- **Body (text of the HTML):**

```text
Confirmation de sécurité
 Pour modifier l'e-mail de votre compte, saisissez ce code de confirmation :
 424242
 Ce code est valable 10 minutes et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail et vérifiez votre compte.
```
- **CTA:** none
- **Footer:** none
- **Plain-text part:** yes — verbatim:

```text
Confirmation de sécurité Grubano.
Pour modifier l'e-mail de votre compte, saisissez ce code : 424242
Valable 10 minutes, une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.
```


### ACCOUNT_EMAIL_CHANGE_LINK
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.new@example.invalid
- **Subject:** `Confirmez votre nouvelle adresse e-mail — Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Confirmez votre nouvelle adresse
- **Body (text of the HTML):**

```text
Confirmez votre nouvelle adresse
 Vous avez demandé à utiliser cette adresse comme nouvel e-mail de connexion à votre compte Grubano.
Confirmer ma nouvelle adresse
Ce lien expire dans 15 minutes et ne fonctionne qu'une seule fois. Tant que vous ne cliquez pas, rien ne change et vous restez connecté avec votre adresse actuelle. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Confirmer ma nouvelle adresse » → `https://app.grubano.com/eat/account/email/confirm?token=op_fixture01.0123456789abcdef`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### ACCOUNT_EMAIL_CHANGED_ALERT
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Sécurité : votre e-mail de connexion a été modifié — Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Votre e-mail a été modifié
- **Body (text of the HTML):**

```text
Votre e-mail a été modifié
 L'adresse e-mail de connexion de votre compte Grubano vient d'être remplacée par l***@e***.
Si vous êtes à l'origine de ce changement, aucune action n'est nécessaire. Sinon, contactez-nous immédiatement : votre compte a pu être compromis.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### ACCOUNT_EMAIL_CHANGE_CONFIRM
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.new@example.invalid
- **Subject:** `Votre nouvelle adresse e-mail est active — Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Adresse e-mail mise à jour
- **Body (text of the HTML):**

```text
Adresse e-mail mise à jour
 C'est confirmé : cette adresse est désormais l'e-mail de connexion de votre compte Grubano.
Utilisez-la pour vos prochaines connexions.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### ACCOUNT_EMAIL_ALREADY_USED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.new@example.invalid
- **Subject:** `À propos de votre adresse e-mail — Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Adresse déjà utilisée
- **Body (text of the HTML):**

```text
Adresse déjà utilisée
 Quelqu'un vient de tenter d'associer cette adresse à un compte Grubano, mais elle est déjà utilisée.
Si c'était vous, connectez-vous directement avec cette adresse. Sinon, ignorez cet e-mail — aucun changement n'a eu lieu sur votre compte.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_EMAIL_VERIFY
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** marco@example.invalid
- **Subject:** `Confirme ton email — espace partenaire Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Bienvenue sur Grubano, Marco Pizzeria 👋
- **Body (text of the HTML):**

```text
Bienvenue sur Grubano, Marco Pizzeria 👋
 Pour activer ton espace partenaire, confirme ton adresse email :
 Vérifier mon email
 Ce lien expire dans 24 heures. Si tu n'es
 pas à l'origine de cette demande, ignore simplement cet email.
```
- **CTA(s):** « Vérifier mon email » → `https://business.grubano.com/api/partners/verify-email?token=op_fixture02.fedcba9876543210fedcba9876543210`
- **Footer:** none
- **Plain-text part:** none (HTML only — client-synthesized)


### ADMIN_PARTNER_PENDING
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** admin-alerts@example.invalid
- **Subject:** `[Grubano] Nouveau dossier restaurant à valider`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Nouveau dossier à valider
- **Body (text of the HTML):**

```text
Nouveau dossier à valider
 Un nouveau restaurant vient de soumettre son inscription et attend une validation administrateur.
 Type
 restaurant
 Partenaire
 Marco Pizzeria
Ouvrez la console d'administration pour examiner et valider ce dossier.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### ADMIN_PARTNER_PENDING__from_route
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** admin-alerts@example.invalid
- **Subject:** `[Grubano] Nouveau dossier restaurant à valider`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Nouveau dossier à valider
- **Body (text of the HTML):**

```text
Nouveau dossier à valider
 Un nouveau restaurant vient de soumettre son inscription et attend une validation administrateur.
 Type
 restaurant
 Partenaire
 Marco Pizzeria
Ouvrez la console d'administration pour examiner et valider ce dossier.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_ACCOUNT_VALIDATED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Votre compte Grubano est validé`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Compte validé ✓
- **Body (text of the HTML):**

```text
Compte validé ✓
 Bonjour Marco Rossi, bonne nouvelle : votre établissement est validé et activé sur Grubano.
Vous pouvez dès maintenant accéder à votre espace.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_ACCOUNT_REJECTED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Votre demande Grubano n'a pas été validée`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Demande non validée
- **Body (text of the HTML):**

```text
Demande non validée
 Bonjour Primeurs de Lyon, après examen, votre compte fournisseur n'a pas pu être validé pour le moment.
Motif : SIREN non vérifiable.
Vous pouvez corriger votre dossier et le soumettre à nouveau.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_DOCS_NEEDED_UNWIRED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Documents à fournir — Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Documents à fournir
- **Body (text of the HTML):**

```text
Documents à fournir
 Bonjour Camille, pour finaliser la validation de votre compte, des documents complémentaires sont nécessaires.
Motif : Justificatif d’audience manquant.
Complétez votre dossier depuis votre espace pour débloquer la validation.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### COURIER_WAITLIST_CONFIRMATION
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** sami.courier@example.invalid
- **Subject:** `Votre demande Grubano Livreur est bien enregistrée`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Demande enregistrée
- **Body (text of the HTML):**

```text
Demande enregistrée
 Bonjour Sami,
Merci pour votre intérêt. Le service Grubano Livreur n'est pas encore ouvert : votre demande a bien été enregistrée sur la liste d'attente.
Nous vous recontacterons à cette adresse lorsque l'ouverture sera possible dans votre zone. Aucune action n'est requise de votre part d'ici là.
Aucun compte actif n'a été créé — vous ne pouvez pas encore vous connecter.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### ONBOARDING_NUDGE_RESTAURANT
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Il vous reste 5 étapes pour activer votre restaurant`
- **Preheader:** none
- **Direction:** ltr
- **Headline:** Votre restaurant est presque prêt
- **Body (text of the HTML):**

```text
Votre restaurant est presque prêt
 Bonjour Marco,
 Il vous reste 5 étapes pour finaliser votre installation et passer en ligne sur Grubano. Reprenez là où vous vous êtes arrêté.
 Reprendre mon installation
 Vous ne souhaitez plus recevoir ces rappels ? Se désabonner.
```
- **CTA(s):** « Reprendre mon installation » → `https://app.grubano.com/fr/business/onboarding` · « Se désabonner » → `https://app.grubano.com/api/onboarding/unsubscribe?token=op_fixture01.4d5179030b8d2cb8bc6512faf9481e9b2c0439be906fd20c169b2ce5a02b1b4b`
- **Footer:** "Vous ne souhaitez plus recevoir ces rappels ? Se désabonner."
- **Plain-text part:** none (HTML only — client-synthesized)


### ONBOARDING_NUDGE_GENERIC
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Il vous reste 2 étapes pour finaliser votre inscription`
- **Preheader:** none
- **Direction:** ltr
- **Headline:** Vous y êtes presque
- **Body (text of the HTML):**

```text
Vous y êtes presque
 Bonjour Marco,
 Il vous reste 2 étapes pour finaliser votre inscription sur Grubano. Reprenez là où vous vous êtes arrêté.
 Reprendre mon inscription
 Vous ne souhaitez plus recevoir ces rappels ? Se désabonner.
```
- **CTA(s):** « Reprendre mon inscription » → `https://app.grubano.com/fr/affiliate/dashboard` · « Se désabonner » → `https://app.grubano.com/api/onboarding/unsubscribe?token=op_fixture01.4d5179030b8d2cb8bc6512faf9481e9b2c0439be906fd20c169b2ce5a02b1b4b`
- **Footer:** "Vous ne souhaitez plus recevoir ces rappels ? Se désabonner."
- **Plain-text part:** none (HTML only — client-synthesized)


### OPERATOR_SUPPLIER_PURCHASE_ORDER
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** commandes@primeurs.example.invalid
- **Subject:** `Bon de commande Grubano — 05/09/2026`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Bon de commande
- **Body (text of the HTML):**

```text
Bon de commande
 Bonjour,
Veuillez trouver ci-dessous notre commande du jour.
 Produit
 Quantité
 Total
 Tomates San Marzano12 kg€38.40
Basilic frais2 bottes€3.00
 Total
 €41.40
 Livraison estimée sous 48 h.
 Référence commande : so_fixture0001
 L'équipe Grubano
```
- **CTA:** none
- **Footer:** none
- **Plain-text part:** none (HTML only — client-synthesized)


### CREATOR_DISH_ADOPTED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** chef@example.invalid
- **Subject:** `Nouvelle adoption — Gnocchi Bar sert « Gnocchi au pesto rosso »`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Votre recette vient d’être adoptée 🎉
- **Body (text of the HTML):**

```text
Votre recette vient d’être adoptée 🎉
 Bonjour Chef Nadia, bonne nouvelle :
 Gnocchi Bar (Lyon) vient d’adopter votre recette
 Gnocchi au pesto rosso au prix de 13,50 €.
 Vos royalties de 2% s’appliquent sur chaque vente de cette recette.
 Voir mon studio
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Voir mon studio » → `https://app.grubano.com/creators/dashboard`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_WAITLIST_OFFER
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Exclusivité disponible — « Gnocchi au pesto rosso » à Lyon`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Une exclusivité s’est libérée
- **Body (text of the HTML):**

```text
Une exclusivité s’est libérée
 Bonjour, l’exclusivité de la recette Gnocchi au pesto rosso à
 Lyon vient de se libérer — et
 Gnocchi Bar est le prochain sur la liste d’attente.
 Vous avez 48 h pour l’adopter avant que l’offre ne passe au restaurant suivant.
 Adopter la recette
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Adopter la recette » → `https://app.grubano.com/menu`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_RESERVATION_CONFIRMED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Réservation confirmée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Réservation confirmée ✓
- **Body (text of the HTML):**

```text
Réservation confirmée ✓
 Bonjour Léa Martin, votre table est réservée.
 Restaurant
 Gnocchi Bar
 Date
 samedi 12 septembre à 19:30
 Couverts
 4
 N° de session
 #K7Q2
 Présentez simplement votre nom (ou votre n° de session) à votre arrivée.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_RESERVATION_CONFIRMED_DEPOSIT
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Réservation confirmée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Réservation confirmée ✓
- **Body (text of the HTML):**

```text
Réservation confirmée ✓
 Bonjour Léa Martin, votre table est réservée.
 Restaurant
 Gnocchi Bar
 Date
 samedi 12 septembre à 19:30
 Couverts
 4
 N° de session
 #K7Q2
 Une empreinte bancaire temporaire de 40,00 € peut être demandée pour cette réservation —
 ce n’est pas un paiement : rien n’est débité ; elle reste active jusqu’au paiement de l’addition et est libérée automatiquement.
 Présentez simplement votre nom (ou votre n° de session) à votre arrivée.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_NEW_RESERVATION
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Nouvelle réservation — samedi 12 septembre à 19:30`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Nouvelle réservation reçue
- **Body (text of the HTML):**

```text
Nouvelle réservation reçue
 Une nouvelle réservation vient d'être prise chez Gnocchi Bar.
 Client
 Léa M.
 Date
 samedi 12 septembre à 19:30
 Couverts
 4
 N° de session
 #K7Q2
 Retrouvez-la dans votre espace réservations.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_RESERVATION_CANCELLED_BY_CLIENT
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Annulation confirmée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Annulation confirmée
- **Body (text of the HTML):**

```text
Annulation confirmée
 Bonjour Léa Martin, votre réservation chez Gnocchi Bar
 du samedi 12 septembre à 19:30 est bien annulée.
 Si une empreinte était associée, elle sera libérée — aucun débit.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_RESERVATION_CANCELLED_BY_CLIENT
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Réservation annulée par le client — samedi 12 septembre à 19:30`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Réservation annulée par le client
- **Body (text of the HTML):**

```text
Réservation annulée par le client
 Léa M. a annulé sa réservation chez Gnocchi Bar.
 Date
 samedi 12 septembre à 19:30
 Couverts
 4
 La table est de nouveau disponible sur ce créneau.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_RESERVATION_CANCELLED_BY_OWNER
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Votre réservation a été annulée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Réservation annulée
- **Body (text of the HTML):**

```text
Réservation annulée
 Bonjour Léa Martin, nous sommes désolés : Gnocchi Bar
 a dû annuler votre réservation du samedi 12 septembre à 19:30.
 Si une empreinte était associée, elle sera libérée sans frais — aucun débit.
 Réserver un autre créneau
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Réserver un autre créneau » → `https://app.grubano.com/eat`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_RESERVATION_CANCELLED_BY_CLOSURE
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Votre réservation a été annulée — fermeture exceptionnelle de Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Réservation annulée — fermeture exceptionnelle
- **Body (text of the HTML):**

```text
Réservation annulée — fermeture exceptionnelle
 Bonjour Léa Martin, nous sommes sincèrement désolés :
 Gnocchi Bar sera exceptionnellement fermé et a dû annuler
 votre réservation du samedi 12 septembre à 19:30.
 Motif : Travaux en cuisine.
 Si une empreinte était associée, elle sera libérée sans frais — aucun débit.
 Réserver un autre créneau
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Réserver un autre créneau » → `https://app.grubano.com/eat`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_NOSHOW_PENALTY_CHARGED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Pénalité no-show débitée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Pénalité no-show
- **Body (text of the HTML):**

```text
Pénalité no-show
 Bonjour Léa Martin, votre réservation chez Gnocchi Bar
 du samedi 12 septembre à 19:30 n’a pas été honorée.
 Montant débité
 40,00 €
 Réservation
 samedi 12 septembre à 19:30
 Conformément aux conditions annoncées lors de la réservation, l’empreinte de garantie a été débitée.
 Vous souhaitez contester ? Une contestation est recevable pendant 30 jours :
 pour toute contestation, contactez le restaurant ou notre support (contact@grubano.com) — le remboursement est instruit par l’équipe Grubano.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CRON_CREATOR_EARNINGS_RECAP / CRON_MONTHLY_INVOICES_RECAP
_(plain-text cron recaps — templates in `../EMAIL-COPY-VERBATIM.md §H`)_
