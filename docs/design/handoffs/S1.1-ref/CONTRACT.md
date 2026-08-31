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
