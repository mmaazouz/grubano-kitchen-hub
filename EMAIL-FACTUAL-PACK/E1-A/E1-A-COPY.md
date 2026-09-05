# E1-A-COPY — current copy verbatim for the 3 representative emails (fixtures: Léa Martin / Gnocchi Bar / GR-ABC123)

> Do not rewrite here. Designed copy goes in the E1-A deliverables (formal French). Both magic-link states (with / without code) exist in the core pack; the primary state is below.

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

