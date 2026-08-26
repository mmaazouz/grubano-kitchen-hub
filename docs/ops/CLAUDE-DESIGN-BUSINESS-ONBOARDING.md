# BRIEF CLAUDE DESIGN — `/business/onboarding` (Grubano)

Tu n'as **aucun accès au dépôt**. Tout ce qu'il te faut est ici. Ne demande ni git, ni exploration de fichiers, ni middleware. Rends une **page HTML/CSS autonome**, desktop + mobile, dans la grammaire décrite au §3.

---

## 1. ROUTE ET PERSONA

**Route** : `/business/onboarding` — dernier écran du tunnel d'inscription **partenaire restaurateur**, après création du compte et connexion.

**Persona** : restaurateur indépendant ou petit groupe, en France. Desktop le plus souvent, mobile parfois. Il vient de signer, il veut aller vite et être rassuré.

**Objectif** : lui faire déclarer **sa marque** puis **son établissement**, sans friction, et lui dire honnêtement ce qui se passe ensuite.

**Pourquoi ce brief** : c'est le **seul écran obligatoire du parcours sans référence Design**. Les quatre autres (`/business`, `/business/start`, `/business/register`, `/business/verified`) sont déjà couverts et partagent le même shell. Il est **non contournable** — tout restaurateur y est redirigé automatiquement tant qu'il n'a pas de marque **et** d'établissement — et c'est **le seul écran du parcours qui écrit en base**.

---

## 2. LE SHELL EXISTANT — À RÉUTILISER, PAS À REDESSINER

Le chrome (« PartnerShell », mode *parcours*) est déjà validé. Il fournit :

- un **header** : logo Grubano à gauche, lien **« Quitter »** à droite ;
- une **frise d'étapes horizontale** sous le header ;
- une **colonne de contenu centrée de 560 px** ;
- un **footer** : 3 liens légaux + contact + sélecteur de langue.

**Tu dessines le contenu de la colonne 560 px**, plus la façon dont la frise est renseignée. Pas le header, pas le footer.

---

## 3. JETONS, CLASSES, ICÔNES

**Jetons** (déjà définis, à utiliser tels quels) :
Espacements `--pt-1` … `--pt-9` · Rayons `--pt-r-sm`, `--pt-r-md`, `--pt-r-lg`, `--pt-r-pill` · Couleurs `--pt-bg`, `--pt-ink`, `--pt-ink-2`, `--pt-muted`, `--pt-muted-2`, `--pt-border`, `--pt-border-2`, `--pt-border-3`, `--pt-focus` · Sémantiques `--pt-ok`/`--pt-ok-bg`/`--pt-ok-bd`, `--pt-info`/`--pt-info-bg`/`--pt-info-bd`, `--pt-error`/`--pt-error-bg`/`--pt-error-bd`, `--pt-basil`/`--pt-basil-600`/`--pt-basil-bg`/`--pt-basil-bd` · Largeurs `--pt-form` (560 px), `--pt-content` (1080 px) · Typo `--pt-display`, `--pt-mono`.

**Classes de la grammaire partenaire** :
`.card`, `.card--raised`, `.card__pad` · `.inp`, `.fld`, `.fld label`, `.check` · `.btn`, `.btn--lg`, `.btn--primary`, `.btn--secondary`, `.btn--block` · `.note`, `.note--ok`, `.note--warn`, `.note--error` · `.pill`, `.pill--todo` · `.t-h1`, `.t-h2`, `.t-h3`, `.t-lead`, `.t-small`, `.t-help`, `.t-eyebrow` · `.sk` (squelette) · `.ms` (icône Material Symbols), `.flip-rtl` (miroir en RTL).

**Icônes : Material Symbols uniquement** (`storefront`, `location_on`, `arrow_forward`, `arrow_back`, `check_circle`, `progress_activity`, `image`, `restaurant`, `local_shipping`, `shopping_bag`).
🔴 L'écran actuel utilise une **autre** bibliothèque d'icônes — c'est l'un des défauts à corriger. N'en introduis aucune.

---

## 4. LA FRISE — 4 crans, libellés déjà traduits ×5

Le shell affiche une frise de 4 étapes (`done` / `now` / `todo`). Les libellés existent **déjà en fr, en, es, ar, it** :

1. **Compte** · 2. **Établissement** · 3. **Vérification** · 4. **Mise en ligne**

Sur cet écran : « Compte » est **faite**, « Établissement » est **en cours**.

🔴 **Problème à résoudre** : l'écran actuel affiche, *à l'intérieur* de la carte, une **seconde** frise maison à 3 crans qui contredit celle du chrome. Choisis **une seule** progression et dis laquelle. Si tu gardes celle du chrome (recommandé), le contenu ne doit plus porter sa propre barre d'étapes.

⚠️ Le sous-parcours comporte réellement **deux formulaires** + un écran de succès. Exprime-le **sans** créer une frise concurrente (un titre de section, ou un discret « 1 sur 2 »).

---

## 5. LES TROIS ÉTATS À DESSINER

### État A — « Votre marque »
- **Nom de la marque** — texte, requis
- **Type de cuisine** — 9 choix : Italien, Japonais, Burger, Pizza, Healthy, Français, Asiatique, Oriental, Autre
- **Emoji** — 14 pictogrammes

Action : bouton primaire pleine largeur → état B.

### État B — « Votre établissement »
- **Nom de l'établissement** — texte, requis
- **Description** — texte long, optionnel
- **Adresse** — texte, requis · **Code postal** · **Ville**
- **Logo** — URL d'image, optionnelle · **Photo de couverture** — URL d'image, optionnelle
- 🔴 **Modes de retrait** — **deux cases à cocher : « Livraison » et « Retrait sur place »**. **Au moins une est obligatoire.**

Actions : bouton secondaire **« Retour »** + bouton primaire **« Terminer »**.

> **Ces deux cases sont RÉELLES et doivent être dessinées.** Elles étaient auparavant affichées puis ignorées ; le choix est désormais **enregistré**. C'est une information structurante pour le restaurateur : elle détermine s'il peut recevoir des commandes. Traite-la comme un choix de premier plan, pas comme une case perdue en bas de formulaire.
>
> ⚠️ **Nuance à refléter honnêtement, sans l'inventer** : pendant la période actuelle, **seul le retrait sur place est ouvert** ; la livraison est enregistrée mais **pas encore active**. Dis-le sobrement à côté de la case « Livraison » (une ligne `.t-help` suffit). **Ne donne aucune date, aucun délai, aucune promesse d'ouverture.**

### État C — « C'est prêt »
Écran de succès + bouton vers le tableau de bord.

🔴 **Message obligatoire, à formuler avec soin** : l'établissement est créé **invisible du public**. Sa mise en ligne dépend d'une **vérification humaine par l'équipe Grubano** — le partenaire ne peut pas la déclencher lui-même. Dis-le clairement, **sans aucun délai** (aucun délai n'est validé).

---

## 6. ÉTATS TRANSVERSAUX À COUVRIR

- **Chargement de la porte** (vérification de la session avant affichage) — squelette `.sk`, aucun contenu qui clignote.
- **Champ en erreur** — requis manquant, adresse trop courte, URL invalide, **aucun mode de retrait coché** — message sous le champ concerné.
- **Soumission en cours** — bouton occupé, formulaire non re-soumissible.
- **Erreur serveur** — bandeau `.note--error`, texte générique, l'utilisateur peut réessayer.
- **Reprise** — le partenaire qui a déjà déclaré sa marque revient **directement à l'état B**, champs pré-remplis. Montre à quoi ressemble un champ pré-rempli.

---

## 7. DONNÉES : CE QUI EST ENREGISTRÉ, CE QUI EST DÉRIVÉ

**Enregistré** (le backend existe et fonctionne) : nom de marque, type de cuisine, emoji · nom d'établissement, description, adresse, code postal, ville, logo, photo de couverture, **livraison**, **retrait**.

**Dérivé, jamais saisi** : la visibilité publique de l'établissement (**toujours forcée à invisible** à la création ; seul un administrateur la lève).

**Il existe deux indicateurs dérivés en lecture seule** — « établissement créé » et « carte prête » (au moins un plat disponible porté par une marque rattachée). Ils sont **calculés**, **jamais saisis**, et **aucune interface ne les affiche aujourd'hui**. Tu **peux** t'en servir pour informer (par exemple sur l'écran de succès : rappeler qu'il reste à créer sa carte). Tu ne dois **pas** en faire une machine à états ni un tableau de progression.

---

## 8. RESPONSIVE, RTL, ACCESSIBILITÉ

- **Desktop** : colonne 560 px centrée.
- **Mobile** : pleine largeur avec gouttières, boutons pleine largeur, cibles tactiles confortables. Le tunnel doit rester faisable au pouce.
- **RTL (arabe)** : mise en page reflétée, flèches en `.flip-rtl`. Les 5 langues partagent la structure — prévois des libellés **plus longs** qu'en français (l'espagnol et l'italien débordent facilement).
- **Contraste** conforme, focus visible (`--pt-focus`), labels associés aux champs, cases à cocher accessibles au clavier.

---

## 9. INTERDICTIONS FERMES

🔴 **N'invente aucun état métier.** Ces noms existent dans le vocabulaire interne mais **ne sont ni calculés ni décidés** — ne les affiche pas, ne les suggère pas : **Encaissement · Retrait (au sens financier) · Opérationnel · Approuvé · Commandable**.
*(« Retrait » au sens du mode de récupération d'une commande — la case du §5 — est un sujet différent et parfaitement légitime.)*

🔴 **N'invente aucune promesse commerciale ni aucun texte contractuel.** Interdits faute de source validée : **« 0 € »**, **« 15 minutes »**, **« 3 modes »**, tout **délai** d'activation ou d'ouverture de la livraison, toute promesse de mise en ligne, tout chiffre d'audience, de commission ou de revenu. **N'écris ni CGU, ni CGV, ni texte de consentement** — ces documents n'existent pas encore et leur rédaction appartient à un conseil juridique.

🔴 **N'invente pas de checklist d'activation** (« à vous / à Grubano »). Une telle liste figurait dans un carnet mais n'a **jamais été arbitrée**.

🔴 **Pas de nouvelle bibliothèque de composants**, pas de nouvelle palette, pas de nouvelle famille typographique.

---

## 10. LIVRABLE ATTENDU

Une page HTML autonome montrant les **3 états** (A, B, C), les **états transversaux** du §6, en **desktop et mobile**, dans la grammaire du §3, avec la frise du §4 correctement renseignée. Signale explicitement toute décision produit que tu as dû laisser ouverte.
