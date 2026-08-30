# PREMIER VRAI RESTAURATEUR PILOTE — CHECKLIST (post-Clean Room)

> À dérouler UNIQUEMENT après le Clean Room (base repartie propre) et après une
> répétition staging réussie (`docs/ops/REHEARSAL-CHECKLIST.md`). Ici, tout est
> RÉEL : vraie personne, vrai établissement, vraies données — seul l'argent
> reste en mode TEST pendant la beta fonctionnelle.

---

## Règle de gouvernance — DATA = REAL BY DEFAULT

À partir du Clean Room, **toute donnée créée sur la plateforme est réputée
RÉELLE par défaut**. Conséquences :

1. Une donnée de test doit être **explicitement marquée TEST** dès sa création
   (nom préfixé `TEST`/`Rehearsal`, e-mail dédié documenté) — sinon elle est
   traitée comme une donnée de production et **ne sera jamais purgée**.
2. **Plus jamais** de nettoyage fondé sur l'hypothèse « tout est du test » :
   aucun script de purge globale, aucun `deleteMany` large. Toute suppression
   future est nominative, justifiée et tracée.
3. Les identités historiques compromises (`test@grubano.com`,
   `resto@grubano.com`, comptes démo/QA) sont définitivement interdites.

---

## Checklist du premier pilote réel

### 1. Compte partenaire
- [ ] Le restaurateur s'inscrit **lui-même** sur
  `https://business.grubano.com/fr/business` → parcours Restaurateur →
  `/fr/business/register`, avec **sa vraie adresse e-mail professionnelle**
  (celle qu'il consulte au quotidien — la connexion se fait par lien magique).
- [ ] Il clique le lien de vérification reçu (« Vérifier mon email ») et se
  connecte via `/fr/auth/magic`.

### 2. Établissement
- [ ] **Vrai nom d'établissement** (celui de la devanture).
- [ ] **Vraie adresse complète** (numéro, rue, ville, code postal) — vérifier à
  l'écran final de l'onboarding qu'**aucun avertissement d'adresse non
  géolocalisée** ne s'affiche (sinon corriger l'adresse dans les réglages).
- [ ] **Horaires d'ouverture réels** renseignés dans la fiche établissement
  (`/fr/dashboard/establishments/<id>`).
- [ ] Mode de service : **Retrait sur place (Click & collect) ACTIVÉ** ;
  livraison désactivée tant que la flotte n'est pas ouverte.
- [ ] **Coordonnées de contact** à jour (téléphone/e-mail joignables — le
  support et l'admin doivent pouvoir le joindre pendant la beta).

### 3. Menu
- [ ] **Menu réel** : les plats effectivement vendus, avec **prix réels**.
- [ ] **Allergènes réels** renseignés pour chaque plat (les 14 INCO —
  obligation légale d'information ; c'est affiché au client avant l'achat).
- [ ] Photos/descriptions honnêtes (pas d'images d'illustration trompeuses).

### 4. Encaissements (beta fonctionnelle)
- [ ] Stripe **Connect en mode TEST** pendant la beta fonctionnelle — le
  parcours produit (« Encaissements » → « Configurer ») est complété avec les
  valeurs de test Stripe. **Aucune vraie donnée bancaire** tant que
  l'activation financière LIVE n'est pas prononcée.
- [ ] Le restaurateur est informé (cf. message d'invitation ci-dessous) que les
  commandes de la beta sont des tests sans encaissement commercial réel.

### 5. Mise en ligne
- [ ] Revue admin du dossier sur `https://app.grubano.com/fr/admin/approvals` :
  identité cohérente, adresse géocodée, horaires plausibles, menu + allergènes
  complets, Connect actif.
- [ ] Clic admin « **Approuver & publier** ».
- [ ] Vérification post-publication : l'établissement apparaît sur
  `/fr/eat` (recherche + proximité) et une commande retrait de bout en bout
  (payée en carte TEST) fonctionne, pass QR compris.

---

## Message d'invitation (à envoyer au pilote)

> Bonjour [Prénom],
>
> Nous ouvrons la beta de Grubano, notre plateforme de commande en
> Click & collect, et nous aimerions que [Nom de l'établissement] en soit le
> premier restaurant pilote.
>
> Concrètement :
> - Vous créez votre espace en quelques minutes (établissement, horaires,
>   menu, allergènes) — nous vous accompagnons à chaque étape.
> - Une fois votre fiche validée, votre établissement est visible dans
>   l'application et nous testons ensemble de vraies commandes de retrait,
>   du paiement jusqu'au QR code de récupération en boutique.
> - Pendant cette phase, le paiement commercial réel n'est pas encore activé :
>   les commandes de test se font avec des cartes de test, sans encaissement
>   ni frais pour vous. L'activation financière réelle interviendra une fois
>   la plateforme finalisée — nous vous préviendrons et referons ce
>   paramétrage ensemble à ce moment-là.
>
> Votre retour de terrain orientera directement le produit. Si vous êtes
> partant, répondez à ce message et nous planifions la mise en route.
>
> Merci,
> Mohammed — Grubano
