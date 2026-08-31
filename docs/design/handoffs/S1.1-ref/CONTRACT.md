# CLAUDE-DESIGN-CONSUMER-S1-RESTAURANT-MENU-CONTRACT

**Surface** : fiche restaurant + menu consommateur (`/fr/eat/r/[id]`). **Référence rendable** : `restaurant-menu.html` — `?state=empty|cart|product`, `?device=mobile`. **Restaurant de référence** : Rehearsal Beta Grubano, Fournès. Aucune fonction inventée.

## 1 · Design intent
Food-first, chaleureux, désirable. Le restaurant s'identifie en une seconde (hero image + nom + statut), le mode de service est explicite, le menu est confortable, le panier ne quitte jamais l'écran. Aucun chiffre non opéré.

## 2 · Hiérarchie
Header collant → Hero (image + nom + type/ville/distance + Ouvert) → Modes de service → Nav catégories collante → Plats → À propos (description/adresse + horaires) ; panier en colonne droite collante (desktop) ou barre basse (mobile) ; modale plat par-dessus.

## 3 · Règles de véracité (les 3 findings corrigés)
- **FAUX ETA — supprimé.** Aucun « 25-35 min », aucune préparation estimée, aucun délai : il n'existe pas de moteur ETA. Le hero n'en porte aucune trace.
- **FAUX FRAIS — supprimé.** Delivery OFF ⇒ ni « 1,99 € », ni icône deux-roues/scooter, ni mode Livraison. Le panier affiche « À régler au retrait. **Aucun frais ajouté.** »
- **HAVERSINE — wording honnête retenu : « à env. 15,7 km »**, précédé de l'icône `near_me`. Décision : la distance est conservée (elle situe le restaurant, utile en Click & collect) mais **jamais** présentée comme distance routière ni convertie en durée. « à env. » porte l'approximation ; aucune icône de trajet.

## 4 · Header
60 px, collant, fond flouté. Retour · nom (ellipsis) · partager · favori. Cibles 38 px.

## 5 · Hero
Image 21:8 (16:9 mobile), voile dégradé bas, nom 32 px blanc (23 px mobile), méta en une ligne (type · ville · distance), pastille **Ouvert** basil avec point + texte. **Fallback sans photo** : trame diagonale neutre — la lisibilité du nom ne dépend pas de l'image.

## 6 · Modes de service
Deux cartes seulement : **Click & collect** (actif, `storefront`) et **Sur place** (`table_restaurant`). Actif = bord + fond zest **+ ✓ après le libellé** (jamais couleur seule), `aria-pressed`. Mobile : sous-titres masqués.

## 7 · Menu
Nav catégories collante sous le header, chips scrollables, actif = encre pleine. Titre de section + compte réel de plats.

## 8 · Cartes plat
Grille 2 colonnes ≥ 1080, 1 colonne en dessous. Nom 16/800 · **rappel allergènes en pastille** (« Allergènes : Lactose · Céleri ») · prix 17/800 · vignette 104 px avec bouton `+` en médaillon. Sans photo : trame + icône `restaurant`. Toute la carte ouvre la modale.

## 9 · Panier
Desktop : panneau collant 352 px — titre + compte, rappel mode + restaurant, ligne article (vignette, nom, prix, stepper), sous-total, note « aucun frais ajouté », CTA. **Vide** : icône, « Votre panier est vide », une phrase, CTA désactivé. Mobile : le panneau disparaît, remplacé par une **barre basse collante** (libellé + total), désactivée à vide.

## 10 · Modale plat — rendu conditionnel (révision S1.1)
Ordre : **photo 16:9** → **nom + prix** → **description** → **labels** → **calories** → **allergènes** → **note** → **stepper + CTA**. Mobile : feuille montante 94 vh, corps défilant (`overscroll-behavior:contain`), pied stepper/CTA fixe — aucun contenu masqué derrière lui. Le détail avant ajout est conservé.

**Champs et règle d'affichage** (distinction champ inexistant / champ existant mais vide) :

| Champ | Règle | Rendu |
| --- | --- | --- |
| Photo | display if present, sinon fallback | trame neutre, jamais de bloc vide |
| Nom · Prix | toujours | nom 24/800 · prix 22/800 zest |
| **Description** | **DISPLAY IF NONEMPTY** | paragraphe 14,5/1.6 muted sous le prix ; vide ⇒ **bloc absent**, aucun placeholder |
| **Labels** | **DISPLAY IF LENGTH > 0** | pastilles basil (Veggie · Halal · Sans gluten · Épicé — les 4 existants, aucun nouveau) ; secondaires ; vide ⇒ absent |
| **Calories** | **DISPLAY IF NONNULL** | ligne discrète « 650 kcal » + icône ; null ⇒ absente |
| **Allergènes** | **DISPLAY ACCORDING TO REAL PRODUCT DATA** | bloc d'attention zest **inchangé et prioritaire** (§11) ; liste vide ⇒ bloc absent |
| Note client | toujours (fonction réelle) | « Ajouter une note » — jamais présentée comme personnalisation garantie |
| Quantité · CTA | toujours | stepper + « Ajouter au panier · prix » |

**NOT A CONSUMER DISPLAY FIELD** : identifiants, catégorie interne, best-seller (traité en liste, pas en modale), horodatages.
**N'EXISTE PAS — jamais dessiné** : variantes, tailles, suppléments, options, nutrition détaillée, ingrédients structurés, stock, disponibilité avancée.

**Hiérarchie de visibilité imposée** : les allergènes restent plus saillants que labels et calories (bloc encadré vs pastilles/ligne de texte). Aucun de ces trois blocs ne peut précéder le prix.

## 11 · Allergènes
Bloc d'attention en zest : titre **ALLERGÈNES** + icône `warning`, puis une pastille par allergène avec `check_circle` (**icône + texte**, jamais couleur seule), puis « Renseignés par le restaurant. En cas de doute, demandez confirmation sur place. » Présent **deux fois** dans le parcours : rappel sur la carte plat, détail complet en modale — lisible avant tout ajout. Si liste vide : le bloc disparaît (aucune fausse mention rassurante).

## 12 · À propos / adresse / horaires
Deux colonnes desktop, empilées ensuite. Gauche : description, adresse avec `place`, lien « Ouvrir dans Plans ». Droite : bandeau **« Ouvert aujourd'hui · 00:00 – 23:50 »** puis les 7 jours compacts (8 px de padding, jour surligné) — l'information reste entière sans occuper une demi-page.

## 13-15 · Compositions
**1440** — max 1200, grille `1fr / 352`, gap 28, panier collant à 84 px. **768** — une colonne : menu, puis panier, puis À propos ; panier 312 px de large en pleine largeur, non collant ; modale 560. **390** — gouttières 16, hero 16:9, sous-titres de modes masqués, vignette 88 px, panier→barre basse, modale en feuille ; aucun débordement horizontal.

## 16 · États
`empty` (panier vide, CTA désactivés) · `cart` (1 × Risotto 14,50 €, sous-total 14,50 €) · `product` — **état factuel rehearsal** : Risotto rehearsal, 14,50 €, allergènes Lactose · Céleri, **aucune description, aucun label, aucune calorie** (champs réellement vides) 

**`product-full` — DESIGN COMPONENT DEMO ONLY, pas un état produit.** Même plat, même prix que `product` (**Risotto rehearsal · 14,50 €**) afin de rester cohérent avec le panier affiché derrière ; seuls les **champs conditionnels** changent : description, 2 labels existants, 650 kcal, allergènes — coiffés du bandeau **« Design demo data — valeurs de démonstration, pas les données de Risotto rehearsal »**.

Il sert uniquement de référence visuelle pour le **rendu conditionnel** de `DishDetailModal`. Il ne doit **pas** : devenir un état métier · créer des données de démonstration dans l'application · figurer dans un parcours utilisateur · être implémenté comme bouton, mode ou route.

**ÉTATS PRODUIT CONTRACTUELS À IMPLÉMENTER ET COMPARER : 3 — `empty`, `cart`, `product`.**

## 17 · Primitives
`RestaurantHeader` · `RestaurantHero` (+fallback) · `ServiceModeSelector` (2 modes max) · `MenuCategoryNav` · `DishCard` (+fallback, +rappel allergènes) · `CartPanel` (empty/filled) · `MobileCartBar` · `DishDetailModal` · `AllergenDisclosure` · `RestaurantInfo` · `OpeningHours` (bandeau + 7 lignes).

## 18 · Tokens
`--gb-*` existants. S1 : max 1200 · panier 352/312 · gap 28/20 · radius sm 8 / md 12 / lg 18 / xl 26 / pill · header 60 · chip 38 · CTA 50 · cible min 38 (44 mobile) · ombres sh-1/sh-2 · focus ring zest 3 px.

## 19 · Accessibilité
`role="dialog" aria-modal` + croix labellisée + clic fond ; `aria-pressed` sur les modes ; steppers labellisés ; états à double canal (icône/texte + couleur) ; contrastes : texte hero sur voile, `--gb-muted` ≥ 4,5:1 sur fond clair ; ordre DOM = ordre de lecture ; cibles ≥ 38 px desktop, 44 px mobile.

## 20 · Implementation contract
Respecter l'ordre des sections §2, les compositions §13-15, les états §16, le wording ci-dessus. **Interdits absolus** : afficher un champ vide ou un placeholder de champ vide · implémenter les valeurs de `product-full` comme données réelles · ETA sous toute forme · frais/mode/icône de livraison quand delivery OFF · distance présentée comme routière ou en durée · calories/labels/variantes/tailles/suppléments pour ce plat (données absentes) · frais fictifs dans le panier. Comparaison Puppeteer contre `restaurant-menu.html` à 390/768/1440 × **3 états contractuels** (`empty`, `cart`, `product`) — `product-full` est une démo de composant, hors comparaison d'états runtime ; toute déviation FIXED ou EXPLICITLY ACCEPTED. **Hors périmètre** : home `/eat`, géoloc, recherche, checkout, QR, rewards, profil.

---

## 21 · Additions et déviations — ADDENDUM D'IMPLÉMENTATION

> ⚠️ Section **ajoutée par l'implémentation**, elle ne fait pas partie du handoff Claude Design (§1-§20 sont livrés verbatim, commit `20038d7`). Elle existe pour satisfaire §20 : « toute déviation FIXED ou EXPLICITLY ACCEPTED ». Elle donne à la comparaison Puppeteer une base déclarée : ce qui suit est attendu à l'écran en plus de la référence.

### 21.1 · Additions ACCEPTÉES — blocs rendus en plus de §2/§17

Chaque bloc affiche une donnée **réelle, calculée serveur**, et disparaît quand sa condition n'est pas remplie. Aucun n'invente de chiffre.

| Bloc | Position §2 | Condition de rendu |
| --- | --- | --- |
| `.hd__rate` — note ★ cliquable → `/reviews` | header, après le nom | `restaurant.rating != null` (gaté serveur, `api/restaurants/[id]`) |
| `.closure` — fermeture exceptionnelle annoncée | entre hero et modes | `hours.currentClosure` présent |
| `.promo-strip` — promotions actives | entre hero et modes | `promotions[]` non vide (`evaluatePromotion`, serveur) |
| `.dish__qty` — pastille « déjà N au panier » | vignette de la carte plat | `qty > 0` pour ce plat |
| `.cart__reserve` — « Réserver une table » | pied du panneau panier | `reservable === true` |
| `.cr` — encart « Recette du chef » (CD 81c4) | **modale, APRÈS la note**, hors séquence §10 | `dish.creator` présent (recette adoptée réelle) |
| `CreatorBadge` — « Recette signée {chef} » → `/chef/{slug}` | **carte plat**, ligne de prix (§8) | `dish.creator` présent (mêmes données réelles) |

`CreatorBadge` est maintenu SUR LA CARTE et pas seulement dans la modale : la modale ne s'ouvre qu'une fois le plat déjà choisi, donc après la découverte que cette attribution sert (levier 4-bis A1). Aucun des trois états comparés (`empty`, `cart`, `product` — Risotto rehearsal, sans créateur) ne le rend : impact nul sur la comparaison Puppeteer.

L'encart `.cr` était intercalé entre allergènes et note : **corrigé**, il est désormais rendu après la note, la séquence imposée §10 (photo → nom+prix → description → labels → calories → allergènes → note) n'est plus coupée.

### 21.2 · Déviations EXPLICITLY ACCEPTED

1. **`.alg__h` — contraste 3,09:1 — ⚠️ EN ATTENTE D'UNE DÉCISION FONDATEUR NOMMÉE.** Le titre ALLERGÈNES est `--gb-zest-600` #F2570E sur `--s1-zest-bg` #FFF1E7. Le texte fait 13 px / 800 : il est sous le seuil « large » (18,66 px gras), donc l'exigence AA applicable est 4,5:1 et 3,09 échoue. Ce qui est acquis : §11 est satisfait par le **double canal icône + texte**, les pastilles en-dessous sont à plein contraste, et §19 ne nomme explicitement que `--gb-muted`. Ce qui ne l'est pas : l'override WCAG fondateur documenté porte sur **l'accent `/eat` en général**, pas sur le titre du seul bloc de sécurité de la fiche — l'acceptation héritée est plus large que l'override qu'elle invoque. Le remède tient en une ligne (`#C2410C` = 4,68:1 sur le même fond, identité d'accent préservée) ; il n'est **pas** appliqué unilatéralement parce qu'il modifie une couleur d'un design approuvé. **À trancher explicitement par le fondateur, sélecteur par sélecteur.**
2. **`.cr__follow` et `.cr__ai` inertes.** Reproduction verbatim d'une seconde référence CD gelée. Motif d'acceptation : indisponibilité **déclarée** (bouton `disabled` + `aria-disabled`, raison portée par le nom accessible ; pastille « bientôt » sur le bloc IA) — le motif « Bientôt » est le pattern honnête déjà en vigueur dans le produit. Aucun chiffre non opéré n'est affiché (§1).
3. **`cartModeLine` — rappel de mode non porté par les données.** §9 impose « rappel mode + restaurant » ; le panier (`lib/eat-cart`) ne persiste aucun mode, le choix réel est fait au checkout. Le rappel est donc **visuel**, pas contractuel côté données. Porter le mode dans le payload panier est HORS PÉRIMÈTRE S1.1.
4. **Carte « Sur place » = navigation quand le restaurant a des tables.** Elle ouvre le tunnel de réservation au lieu de basculer le mode ; elle a donc perdu `aria-pressed` et porte un nom accessible de navigation. Motif : le panneau panier (seule autre entrée) est `display:none` sous 560 px — la retirer supprimerait toute entrée mobile vers la réservation. Conséquence assumée : sur un restaurant réservable, le mode `dinein` n'est jamais sélectionné, la ligne de mode du panier reste « Click & collect ».

5. **Ordre des blocs à 768 : menu → panier → À propos (la référence rend menu → À propos → panier).** La prose §14 impose « une colonne : menu, puis panier, puis À propos », et la référence porte bien `.about{order:3}` dans son bloc 900 — mais la règle y est **inerte** : `.about` est un enfant du `<div>` de colonne, donc pas un item de la grille `.body`, et `order` n'a aucun effet dessus (même famille que les tokens morts du §21.3). Mesure sur la référence rendue à 768 : `.about`.top = 784 < `.cart`.top = 1316 — À propos passe AVANT le panier. Le produit sort `<section class="about">` de la colonne pour en faire un item de `.body`, ce qui rend `order:3` effectif et exécute la prose. **Acceptée : la prose §14 prévaut sur la référence rendue.** Conséquence pour la comparaison Puppeteer à 768 : un bloc entier est déplacé, base déclarée ici. Corollaire CSS : `.about` n'a plus de `margin-top:28px` (c'est le row-gap de `.body` qui porte les 28 px de la référence — les cumuler ouvrirait 56 px).

6. **`--s1-muted-2` #6B7682 → #666F7B.** Assombrissement d'un cran du token de la référence, motivé §19 (« `--gb-muted` ≥ 4,5:1 sur fond clair ») : #6B7682 mesure 4,30:1 sur `--s1-surface-3` et 4,37:1 sur `--gb-bg`, sous le seuil. #666F7B donne 4,73 / 4,81 / 5,09. Impact mesuré : recolore `.tot__note` (la ligne de note du panier, §3 règle 2) et `.sec-h span` (le compte de plats) à toutes les largeurs.

7. **Cibles tactiles portées à 44 px sous 560 px.** §19 impose « cibles ≥ 38 px desktop, **44 px mobile** » ; la référence garde 38 px (`.hd__back`, `.hd__ic`, `.cat`, `.pm__x`) et même 30 px (`.qty button`) à toutes les largeurs, contre sa propre règle. Le produit corrige : `.qty button` 30 → **38** desktop puis **44** à ≤560 ; `.cat`, `.hd__back`, `.hd__ic`, `.pm__x` 38 → **44** à ≤560. Le glyphe ne bouge pas (18 px), seule la zone de contact grandit. Impact mesuré : `.qty` grandit dans le pied de modale et dans le stepper du panier (états `cart` et `product`, à 390 comme au-dessus pour le passage 30 → 38) et `.cats` passe de 62 à 68 px de haut à 390.

8. **`.mode span{display:none}` non reproduit tel quel.** La règle 560 de la référence blanchit toute la carte de mode (libellé compris) ; §6 ne demande que « Mobile : sous-titres masqués ». Le produit masque `.mode__sub` seul — icône et libellé restent. Impact mesuré : à 390 les deux cartes de mode portent leur libellé.

9. **Note du pied de panier — véracité argent.** §3 règle 2 et §9 fixent le texte « À régler au retrait. Aucun frais ajouté. » ; les deux moitiés sont fausses contre le serveur en place, la note est donc recomposée (le principe §3 est conservé, sa formulation littérale non) :
   - « **aucun frais ajouté** » — `POST /api/orders` applique `smallOrderFeeCents()` **sans aucun gating de mode** (`lib/pricing` : 1,00 € forfaitaire dès que le sous-total articles est sous 12,00 €), et `/eat/cart` facture cette ligne à l'écran suivant. La clause n'est donc rendue **qu'au-dessus du seuil** ; en-dessous, le panneau affiche le nudge réel `eat.cart.smallOrderNudge`, mot pour mot celui de `/eat/cart`. Le seuil vient de `smallOrder{feeCents,thresholdCents}`, déjà servi par `GET /api/restaurants/[id]` — aucun chiffre calculé ici.
   - « **à régler au retrait / sur place** » — le paiement en espèces est hors pilote et refusé côté serveur (`/eat/cart` force `payment = 'card'`, la carte est débitée au checkout). Aucun **moment** de paiement n'est donc plus annoncé. La clé `dineInNoFeeNote` (ajout d'implémentation, non contractuelle) est retirée avec.
   - Reste affiché au-dessus du seuil : `noDeliveryFeeNote` — la seule affirmation vérifiable, et l'exacte négation du « 1,99 € » supprimé. Les deux états comparés (`empty`, sous-total 0 ; `cart`, 14,50 € ≥ 12,00 €) rendent cette note : l'écart avec la référence se limite au texte d'une ligne.

10. **Sémantique des titres — `<h3>` de plat et `<h2>` « À propos » sortis des boutons.** La référence a une carte plat non interactive et un `.about__h` en `<div>`. L'implémentation a besoin des deux contrôles (§8 « toute la carte ouvre la modale » ; repli de la section). Un titre placé **dans** un `<button>` est absorbé dans le nom accessible du bouton et disparaît de la navigation par titres (§19 « ordre DOM = ordre de lecture »). Motifs retenus, à pixels constants : la carte plat est un `<article>` et sa cible pleine carte est un bouton **étendu** (`.dish__hit::after{inset:0}`) placé DANS le `<h3>` ; « À propos » est un `<h2>` qui **contient** le bouton de repli. L'anneau de focus est porté par l'overlay, donc toujours dessiné autour de la carte entière.

11. **`.about__b` mono-piste quand un seul bloc existe (`.is-single`).** La référence garde `1fr 1fr` en toutes circonstances. Sans horaires configurés (`hoursConfigured !== true`, cas courant en bêta) ou sans description ni adresse, la seconde piste resterait vide et §10 interdit qu'un champ absent réserve son espace. La grille tombe à une piste dans ces cas ; à deux blocs, rien ne change.

### 21.3 · Portage des seuils §13-15

La référence pilote ses ruptures par `@container s1` sur un wrapper de banc dont la largeur EST la largeur de page. Le produit rend la fiche dans `.eat-nav.is-framed .content`, décalé du rail gauche (`--gb-nav-w:236px`) au-dessus de 900 px. Les requêtes conteneur sont **inutilisables** ici (`container-type:inline-size` ⇒ `contain:layout` ⇒ l'overlay `position:fixed` de la modale se recalerait sur la page, et le contexte d'empilement passerait le header sous la bottom-nav du shell). Portage retenu, exact et continu :

| Référence | Produit | Vérification |
| --- | --- | --- |
| `@container s1 (max-width:1080px)` | `@media (max-width:1316px)` | 1316 − 236 = 1080 ; sous 900, rail masqué, déjà inclus |
| `@container s1 (max-width:900px)` | `@media (max-width:1136px)` | 1136 − 236 = 900 ; sous 900, identité |
| `@container s1 (max-width:560px)` | `@media (max-width:560px)` | rail déjà masqué — 1:1 |

**Tokens `--s1-cart` / `--s1-gap` — ils ne sont PAS déclinés.** §18 prévoit 312/20 sous le premier seuil et la référence porte bien `:root{--s1-cart:312px;--s1-gap:20px}` dans son bloc `@container s1 (max-width:1080px)` — mais cette déclaration est **morte** : `:root` est un ANCÊTRE du conteneur `.wrap`, et une requête conteneur ne s'applique jamais qu'aux DESCENDANTS de son conteneur. Mesure sur la référence RENDUE, à 768 comme à 390 : `--s1-cart` = 352px, `--s1-gap` = 28px, `.body` row-gap = column-gap = 28px — identiques à 1440. §20 fixe la comparaison sur la référence **rendue** : le produit garde donc 352/28 à toutes les largeurs et le bloc 1316 ne collapse que la grille de plats. Les 312/20 du §18 restent une intention que le CSS de la référence n'atteint pas.

*(Même famille de règles inertes dans la référence, pour mémoire : `.about{order:3}` du bloc 900 — voir §21.2 item 5 — et, à l'inverse, `.mode span{display:none}` du bloc 560, qui lui est bien actif mais blanchit toute la carte de mode : reproduit en n'y masquant que le sous-titre, conformément à la prose §6.)*
