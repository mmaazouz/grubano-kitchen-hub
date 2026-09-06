# E1-B-COPY — current copy verbatim for the 10 auth / account emails (fixtures: Léa Martin, lea.martin@example.invalid, code 424242, new address lea.new@example.invalid)

> Do not rewrite here. Designed copy goes in the E1-B deliverables (formal French).

### AUTH_MAGIC_LINK_WITH_OTP
- **From:** "Grubano" <contact@grubano.com>
- **To (fixture):** lea.martin@example.invalid
- **Subject:** `Votre lien de connexion Grubano`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Connexion à Grubano
- **Body (text of the HTML):**

```text
Connexion à Grubano
 Bonjour Léa Martin, voici votre lien de connexion sécurisé :
 Me connecter
 Le bouton ne s'affiche pas ? Copiez-collez ce lien dans votre navigateur :
 https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef
 Le lien s'ouvre dans le mauvais navigateur ? Saisissez plutôt ce code sur la page de connexion :
 424242
 Ce lien est valable 15 minutes et ce code 10 minutes ; chacun ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.
```
- **CTA(s):** « Me connecter » → `https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef` · « https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef » → `https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef`
- **Footer:** none
- **Plain-text part:** yes — verbatim:

```text
Bonjour Léa Martin,

Voici votre lien de connexion sécurisé à Grubano. Cliquez dessus ou copiez-collez-le dans votre navigateur :

https://app.grubano.com/fr/eat/magic?token=op_fixture01.0123456789abcdef0123456789abcdef

Ou saisissez ce code à 6 chiffres sur la page de connexion : 424242

Ce lien est valable 15 minutes et ce code 10 minutes ; chacun ne fonctionne qu'une seule fois.
Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.
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
- **Subject:** `Bienvenue sur Grubano — votre compte est prêt`
- **Preheader:** none
- **Direction:** ltr (implicit)
- **Headline:** Bienvenue sur Grubano, Léa Martin
- **Body (text of the HTML):**

```text
Bienvenue sur Grubano, Léa Martin
 Votre compte est créé et déjà actif. Vous pouvez commander en Click & collect
 et suivre vos points fidélité depuis votre espace.
 Découvrir les restaurants
 Si vous n'êtes pas à l'origine de cette
 inscription, répondez simplement à cet e-mail.
```
- **CTA(s):** « Découvrir les restaurants » → `https://app.grubano.com/eat`
- **Footer:** none
- **Plain-text part:** none (HTML only — client-synthesized)


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

