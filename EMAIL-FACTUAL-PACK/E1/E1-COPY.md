# E1-COPY — current copy verbatim for this tranche (extracted from `../EMAIL-COPY-VERBATIM.md`)

> Fixtures: Léa Martin / Gnocchi Bar / GR-ABC123 / 12 sept. 2026 19:30. Do not rewrite here — designed copy goes in the tranche deliverables.

### AUTH_MAGIC_LINK
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Ton lien de connexion Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Connexion à Grubano
- **Body (text of the HTML):**

```text
Connexion à Grubano
 Bonjour Léa Martin, voici ton lien de connexion sécurisé :
 Me connecter
 Le bouton ne s'affiche pas ? Copie-colle ce lien dans ton navigateur :
 https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef
 Ce lien est valable 15 minutes et ne fonctionne qu'une seule fois. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.
```
- **CTA(s):** « Me connecter » → `https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef` · « https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef » → `https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef`
- **Footer:** none
- **Plain-text part:** yes — verbatim:

```text
Bonjour Léa Martin,

Voici ton lien de connexion sécurisé à Grubano. Clique dessus ou copie-colle-le dans ton navigateur :

https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef

Ce lien est valable 15 minutes et ne fonctionne qu'une seule fois.
Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.
```


### AUTH_MAGIC_LINK_WITH_OTP
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Ton lien de connexion Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Connexion à Grubano
- **Body (text of the HTML):**

```text
Connexion à Grubano
 Bonjour Léa Martin, voici ton lien de connexion sécurisé :
 Me connecter
 Le bouton ne s'affiche pas ? Copie-colle ce lien dans ton navigateur :
 https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef
 Le lien s'ouvre dans le mauvais navigateur ? Saisis plutôt ce code sur la page de connexion :
 424242
 Ce lien et ce code sont valables 15 minutes et ne fonctionnent qu'une seule fois. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.
```
- **CTA(s):** « Me connecter » → `https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef` · « https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef » → `https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef`
- **Footer:** none
- **Plain-text part:** yes — verbatim:

```text
Bonjour Léa Martin,

Voici ton lien de connexion sécurisé à Grubano. Clique dessus ou copie-colle-le dans ton navigateur :

https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef

Ou saisis ce code à 6 chiffres sur la page de connexion : 424242

Ce lien et ce code sont valables 15 minutes et ne fonctionnent qu'une seule fois.
Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.
```


### AUTH_PASSWORD_RESET
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Réinitialisation de votre mot de passe Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Réinitialiser votre mot de passe
- **Body (text of the HTML):**

```text
Réinitialiser votre mot de passe
 Bonjour Léa Martin, vous avez demandé à réinitialiser votre mot de passe Grubano.
 Choisir un nouveau mot de passe
 Ce lien est valable 1 heure et ne peut être utilisé qu'une seule fois.
 Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe reste inchangé.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Choisir un nouveau mot de passe » → `https://app.grubano.com/fr/eat/reset-password?token=0123456789abcdef&email=lea.martin%40example.invalid&space=eat`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### AUTH_PASSWORD_CHANGED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Votre mot de passe Grubano a été changé`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Mot de passe changé
- **Body (text of the HTML):**

```text
Mot de passe changé
 Bonjour Léa Martin, le mot de passe de votre compte Grubano vient d'être modifié.
 Ce n'était pas vous ? Réinitialisez immédiatement votre mot de passe
 depuis la page de connexion (« Mot de passe oublié ») ou répondez à cet email.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_WELCOME
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Bienvenue sur Grubano — ton compte est prêt`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Bienvenue sur Grubano, Léa Martin 👋
- **Body (text of the HTML):**

```text
Bienvenue sur Grubano, Léa Martin 👋
 Ton compte est créé et déjà actif. Tu peux commander, réserver une table
 et suivre tes points fidélité depuis ton espace.
 Découvrir les restaurants
 Si tu n'es pas à l'origine de cette
 inscription, réponds simplement à cet email.
```
- **CTA(s):** « Découvrir les restaurants » → `https://grubano.com/eat`
- **Footer:** none
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_CONFIRMATION_PICKUP
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 confirmée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande confirmée ✓
- **Body (text of the HTML):**

```text
Commande confirmée ✓
 Bonjour Léa Martin, votre paiement de
 25,50 € est confirmé —
 Gnocchi Bar prépare votre commande.
 Commande
 GR-ABC123
 2×
 Gnocchi 4 fromages
 1×
 Tiramisu maison
 Montant payé
 25,50 €
 Click & collect — votre commande sera à retirer au restaurant.
 Suivre ma commande
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Suivre ma commande » → `https://app.grubano.com/eat/account`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_CONFIRMATION_DELIVERY
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 confirmée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande confirmée ✓
- **Body (text of the HTML):**

```text
Commande confirmée ✓
 Bonjour Léa Martin, votre paiement de
 28,50 € est confirmé —
 Gnocchi Bar prépare votre commande.
 Commande
 GR-ABC123
 2×
 Gnocchi 4 fromages
 1×
 Tiramisu maison
 Montant payé
 28,50 €
 Livraison — votre commande arrive chez vous.
 Suivre ma commande
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA(s):** « Suivre ma commande » → `https://app.grubano.com/eat/account`
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### PARTNER_NEW_ORDER
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** gnocchi.bar@example.invalid
- **Subject:** `Nouvelle commande GR-ABC123 — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Nouvelle commande reçue
- **Body (text of the HTML):**

```text
Nouvelle commande reçue
 Vous avez reçu une nouvelle commande payée chez Gnocchi Bar.
 Commande
 GR-ABC123
 2×
 Gnocchi 4 fromages
 1×
 Tiramisu maison
 Mode
 Click & collect
 Montant
 25,50 €
 Retrouvez-la dans votre tableau de bord pour l'accepter et la préparer.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_ACCEPTED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 acceptée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande acceptée ✓
- **Body (text of the HTML):**

```text
Commande acceptée ✓
 Bonjour Léa Martin, bonne nouvelle : Gnocchi Bar a accepté votre commande et la prépare.
 Commande
 GR-ABC123
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_READY_PICKUP
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 prête — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande prête ✓
- **Body (text of the HTML):**

```text
Commande prête ✓
 Bonjour Léa Martin, votre commande chez Gnocchi Bar est prête — vous pouvez venir la récupérer.
 Commande
 GR-ABC123
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_READY_DELIVERY
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 prête — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande prête ✓
- **Body (text of the HTML):**

```text
Commande prête ✓
 Bonjour Léa Martin, votre commande chez Gnocchi Bar est prête et part bientôt en livraison.
 Commande
 GR-ABC123
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_ENROUTE
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 en route — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande en route
- **Body (text of the HTML):**

```text
Commande en route
 Bonjour Léa Martin, votre commande de Gnocchi Bar est en route — elle arrive bientôt !
 Commande
 GR-ABC123
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_COMPLETED_PICKUP
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 récupérée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande récupérée ✓
- **Body (text of the HTML):**

```text
Commande récupérée ✓
 Bonjour Léa Martin, votre commande chez Gnocchi Bar est récupérée. Bon appétit !
 Commande
 GR-ABC123
Un avis sur votre expérience aiderait beaucoup le restaurant — vous pouvez le partager depuis votre espace.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_DELIVERED
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 livrée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande livrée ✓
- **Body (text of the HTML):**

```text
Commande livrée ✓
 Bonjour Léa Martin, votre commande chez Gnocchi Bar est livrée. Bon appétit !
 Commande
 GR-ABC123
Un avis sur votre expérience aiderait beaucoup le restaurant — vous pouvez le partager depuis votre espace.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_CANCELLED_GENERIC
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 annulée — Gnocchi Bar`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Commande annulée
- **Body (text of the HTML):**

```text
Commande annulée
 Bonjour Léa Martin, votre commande chez Gnocchi Bar a été annulée.
 Commande
 GR-ABC123
Pour toute question, contactez directement le restaurant.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)


### CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Commande GR-ABC123 annulée — au sujet de votre paiement`
- **Preheader:** none
- **Direction:** ltr
- **Headline:** Commande annulée
- **Body (text of the HTML):**

```text
Commande annulée
 Bonjour Léa Martin,
Gnocchi Bar a annulé votre commande GR-ABC123, qui avait été payée. Pour le remboursement du montant payé, contactez notre support : contact@grubano.com (ou répondez simplement à cet e-mail) — chaque demande est traitée par un membre de l’équipe pendant la bêta.
Indiquez la référence GR-ABC123 dans votre message.
 Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin.
```
- **CTA:** none
- **Footer:** "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin."
- **Plain-text part:** none (HTML only — client-synthesized)

