# E1-A-DESIGN-MANIFEST — les 3 emails représentatifs × leurs états

Système : `CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md`. Références rendues : `emails/`. Revue : `E1-A-email-gallery.html`.
**Données de démonstration** (jamais des constantes) : Léa Martin · Gnocchi Bar · `GR-ABC123` · 25,50 € · 2× Gnocchi 4 fromages + 1× Tiramisu maison · code `482913` · token de fixture.

## Table de synthèse

| Email | Audience | Statut | Objet recommandé | Préheader recommandé | Fichier |
|---|---|---|---|---|---|
| **AUTH_MAGIC_LINK** | consommateur + tout rôle partenaire | ACTION REQUISE | `Votre lien de connexion Grubano` | `Votre lien de connexion, valable 15 minutes.` | `emails/auth-magic-link.html` |
| AUTH_MAGIC_LINK + code *(dormant)* | idem | ACTION REQUISE | `Votre lien de connexion Grubano` | `Votre lien de connexion et votre code.` | `emails/auth-magic-link-code.html` |
| **CONSUMER_ORDER_READY** (retrait) | consommateur | SUCCESS | `Commande GR-ABC123 prête — Gnocchi Bar` | `Votre commande chez Gnocchi Bar vous attend au comptoir.` | `emails/consumer-order-ready-pickup.html` |
| …READY livraison *(DORMANT)* | consommateur | NEUTRE | `[ne pas envoyer]` | `État dormant hors bêta — ne pas envoyer.` | `emails/consumer-order-ready-delivery-DORMANT.html` |
| **PARTNER_NEW_ORDER** | propriétaire du restaurant | ACTION REQUISE | `Nouvelle commande GR-ABC123 — Gnocchi Bar` | `GR-ABC123 · 25,50 € · Click & collect · à accepter.` | `emails/partner-new-order.html` |

---

## 1 · AUTH_MAGIC_LINK

**Déclencheur** : demande de connexion sans mot de passe. Le plus envoyé, le plus sensible. Idempotence : aucune (les répétitions sont légitimes).

**Composants** : EmailHeader · h1 « Connexion à Grubano » · adresse · PrimaryButton « Me connecter » · *[CodeBlock — dormant]* · CopyableUrl · validité · phrase d'ignorance · Footer. **Aucune bande de statut** : la sémantique ACTION REQUISE est portée par le bouton et le h1 ; une bande ambre alourdirait un email dont l'action est déjà évidente. **Aucun composant de commande.**

**Champs** — requis : `to`, `link` (absolu, hôte allow-listé). Optionnels : `name` (**vide → « Bonjour, »**), `code` (6 chiffres, uniquement si `AUTH_EMAIL_OTP_ENABLED`).

**Registre corrigé** (note historique — le copy produit a été aligné en vouvoiement le 2026-09-06) : le copy d'alors tutoyait (« ton lien », « clique », « tu n'es pas ») → **vouvoiement** intégral. Objet actuel « Ton lien de connexion Grubano » → « Votre lien de connexion Grubano ».

**Validités — correction factuelle (E1-A FACTUAL PATCH 2026-09-06, mesurée dans le code)** : lien **15 minutes** (`lib/magic-link.ts` `MAGIC_TTL_MS = 15 * 60 * 1000`), code **10 minutes** (`lib/email-otp.ts` `OTP_TTL_MS = 10 * 60 * 1000`) — deux durées DISTINCTES. L'état combiné lien + code doit les distinguer : « Ce lien est valable 15 minutes et ce code 10 minutes ; chacun ne fonctionne qu'une seule fois. » (la version approuvée disait « lien 10 minutes » : sur-correction, corrigée sans toucher au visuel). Les deux sont à usage unique.

**CTA** : un seul primaire, doublé de l'URL visible et cliquable — un client qui bloque les boutons doit pouvoir se connecter.

**Texte brut** : adresse · URL seule sur sa ligne · code s'il existe · validités · ignorance · pied.

---

## 2 · CONSUMER_ORDER_READY — retrait

**Déclencheur** : passage de la commande au statut `ready`. Idempotence : `order_ready` / `order:<id>` — un seul envoi par commande.

**Composants** : EmailHeader · h1 « Votre commande est prête » · **StatusBand SUCCESS** « ✓ Prête au retrait » + « Vous pouvez venir la récupérer au restaurant. » · adresse · OrderRefBlock · RestaurantBlock (+ « Présentez votre référence de commande au comptoir. ») · précision de mode · Footer.

**Choix de sémantique** : SUCCESS et non ACTION REQUISE. La commande **est** prête — c'est un fait acquis ; l'action du client est portée par la phrase de la bande et le conseil du bloc restaurant. Employer l'ambre reviendrait à alarmer sur une bonne nouvelle.

**Aucun CTA** : le produit ne passe aucune URL de suivi pour cet email et rien ne prouve qu'un pass de retrait soit atteignable ici. **Aucun bouton n'est inventé — décision bêta actée : CONSUMER_ORDER_READY = aucun CTA.** L'emplacement CTA du système reste disponible pour les emails qui ont une destination réelle.

**Champs** — requis : `orderId`, `to`, `customerName` (la route passe `name ?? email` : un email en guise de nom est possible — le bloc l'accepte sans casse), `restaurantName`, `status:'ready'`, `fulfillmentType`, `orderRef`. Non transmis aujourd'hui : **adresse et horaires du restaurant** — le bloc les prévoit, ils ne s'affichent que s'ils existent.

**Variante livraison — DORMANTE, hors bêta** : bandeau noir en tête « État dormant — hors bêta · ne jamais envoyer tant que la livraison est désactivée », bande NEUTRE « Prise en charge à venir », et **aucun horaire, aucun coursier, aucun ETA** dans le corps. Elle existe pour être conçue une fois ; elle ne doit jamais partir.

**Texte brut** : titre · adresse · `Commande / Restaurant / Mode` · conseil comptoir · pied.

---

## 3 · PARTNER_NEW_ORDER

**Déclencheur** : commande payée. **Serveur, atteignable sans onglet ouvert** (fait courant depuis 2026-09-06) — l'alerte est fiable ; toute formulation ancienne sur un « navigateur à laisser ouvert » est historique. Idempotence : `resto_order_received` / `order:<id>`.

**Composants** : EmailHeader · h1 « Nouvelle commande à accepter » · **StatusBand ACTION REQUISE** « ! Action requise » + « Une commande payée attend votre acceptation. » · OrderRefBlock · ItemsTable + Mode + **Montant payé** · RestaurantBlock · PrimaryButton « Voir et accepter la commande » · précision opérationnelle · Footer.

**Lisible en 5 secondes** : le h1 dit l'action, la bande la confirme, la référence est en mono 20 px, le montant en mono 20 px à droite. Aucun paragraphe d'explication du paiement. **Aucun nom de client** (non transmis, et donnée personnelle inutile à l'action). **Aucune promesse de délai.**

**Champs** — requis : `orderId`, `to` (`restaurant.operator.email`), `restaurantName`, `orderRef`, `fulfillmentType` (→ « Click & collect »), `items[{name, qty}]`, `totalCents` (serveur). Optionnel : note client, si un jour transmise — s'insère après la table, en bloc de données, absente sinon.

**États conditionnels** : liste vide → la table disparaît, le montant reste ; noms longs → retour à la ligne, colonne quantité fixe ; nom de restaurant long → le bloc s'étend sans débordement.

**Texte brut** : titre · fait · `Commande` · lignes `2x …` · `Mode` · `Montant payé` · URL du tableau de bord · pied.

---

## États transversaux rendus dans la galerie
320 · 390 · 600 · bureau · **images bloquées** · **texte brut**. Vérifiés : aucun débordement horizontal, marque lisible sans images, statut lisible sans couleur, montants et références copiables.

## Ce qui reste hors E1-A
Les autres emails d'auth, les autres emails de commande consommateur, les autres emails partenaires, réclamations, remboursements, sécurité, onboarding, liste d'attente coursier, franchise, réservations — E1-B/C/D, E2, E3, **sur ce contrat, sans dérive**.
