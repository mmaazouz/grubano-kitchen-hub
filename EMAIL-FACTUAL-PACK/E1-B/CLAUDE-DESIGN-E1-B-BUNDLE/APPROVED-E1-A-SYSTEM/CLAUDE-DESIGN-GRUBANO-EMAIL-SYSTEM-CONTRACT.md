# CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT

**Autorité globale du système email Grubano.** Produit par E1-A, prouvé sur AUTH_MAGIC_LINK, CONSUMER_ORDER_READY (retrait) et PARTNER_NEW_ORDER. Les ~55 autres emails (E1-B/C/D, E2, E3) réutilisent ce contrat **sans dérive** : ils changent le contenu, jamais le shell, les jetons, les sémantiques de statut ni les règles de vérité.

Planche de référence : `E1-A-components.html` · galerie : `E1-A-email-gallery.html` · références : `emails/*.html`.

## 1 · Intention
Premium, chaleureux, food-first, professionnel, digne de confiance. Un email Grubano se reconnaît à son fond chaud `#FBF8F3`, sa carte blanche à coins doux, son en-tête compact symbole + nom, sa hiérarchie sobre et son unique bouton orange. Ni newsletter, ni dashboard SaaS, ni gadget de startup. Aucun emoji dans le corps.

## 2 · Marque en email
Symbole `grubano-symbol-color.svg` **exporté en PNG 32×32** (SVG non fiable en email), servi depuis `https://app.grubano.com/brand/`. **Aucun fichier wordmark n'existe** : le nom « Grubano » est du **texte**, jamais une image. Images bloquées → l'`alt="Grubano"` et le nom texte portent seuls la marque, et c'est suffisant. Material Symbols inutilisable en email : les glyphes de statut sont des entités Unicode (`&#10003;`, `!`, `&bull;`) toujours accompagnées d'un libellé texte.

## 3 · Shell du document
`<!doctype html>` · `<html lang="fr" dir="ltr|rtl">` · `<meta charset>` + `viewport` + `x-apple-disable-message-reformatting` + `color-scheme: light` · `<title>` = objet · **préheader caché** (div `display:none;max-height:0` + suite de `&zwnj;` pour purger l'aperçu) · conditionnel MSO `PixelsPerInch 96`.

Structure : table 100 % fond `#FBF8F3` → cellule centrée `padding:32px 12px` → **carte table 600 px**, `max-width:600px`, blanche, bordure `#ECE5D8`, rayon 16. Trois zones : en-tête (bordure basse), corps (rangées), pied (bordure haute). Tables partout où l'alignement compte, CSS **inline**, `<style>` réservé aux media queries — jamais porteur de la mise en page. **Aucun JavaScript.** Aucune webfont requise. Pas de Grid, pas de Flexbox, pas de `position`, pas d'états `:hover` porteurs de sens.

## 4 · En-tête
Table 2 colonnes : PNG 32 px, puis nom en 18/700 `#0F2742` avec `padding-left:10px` (`padding-right` en RTL). Hauteur ≈ 72 px — compact, jamais 200 px. Ligne restaurant optionnelle sous le nom pour les emails partenaires multi-restaurants.

## 5 · Typographie
Pile système unique : `-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif`. Mono : `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace` — réservée aux **références, codes, montants, URL**.

| Rôle | Taille / interligne | Poids | Couleur |
|---|---|---|---|
| h1 (un seul) | 27 / 34 (24/32 <620, 22/30 <360) | 700 | `#0F2742` |
| Corps | 16 / 25 | 400 | `#0F2742` |
| Secondaire | 13,5 / 21 | 400 | `#5A6672` |
| Libellé de bloc | 12, capitales, `letter-spacing:.4px` | 700 | `#5A6672` |
| Pied | 12 / 19 | 400 | `#5A6672` |
| Référence / code / montant | 20 / 32 mono | 700 | `#0F2742` |

**Jamais de corps sous 13,5 px.** `#6B7682` du foundation web est remplacé par `#5A6672` (5,7:1) : le premier échoue AA sur blanc en petit corps.

## 6 · Couleur et contraste
`#0F2742` texte (14,3:1) · `#5A6672` secondaire (5,7:1) · **bouton primaire = jeton email `--email-cta: #FF6A1F`, blanc dessus = 5,00:1** (mesuré ; `#CB490B` = 4,67:1 écarté pour sa marge plus faible en rendu réel). `#F2570E` avec du blanc = 3,42:1 et `#FF6A1F` = 2,9:1 : **interdits pour tout texte**. Ce jeton est propre à l'email — le jeton de marque web ne change pas ; le zest vif reste un accent non textuel. `#5A6672` secondaire = 5,54:1 sur `#FBF8F3` et 5,87:1 sur blanc (`#6B7682` = 4,37:1 sur le fond chaud : insuffisant, ne pas rétablir). Statuts : success `#EAF7EF`/`#1B5E3A` · action & warning `#FCF0D9`/`#8A5A00` · urgent `#FCEAE7`/`#96271A` · neutre `#F2F4F7`/`#5A6672`.

## 7 · Sémantiques de statut — jamais la couleur seule
Cinq bandes : **SUCCESS · ACTION REQUISE · NEUTRE · AVERTISSEMENT · URGENT**. Chacune = glyphe Unicode + **libellé texte en capitales** + fond teinté + bordure. Action requise et avertissement partagent l'ambre : ils se distinguent par le libellé, jamais par la nuance. **Composant OPTIONNEL** : une bande au plus, immédiatement sous le h1, uniquement quand un état opérationnel véridique gagne à être souligné (ORDER_READY oui ; AUTH_MAGIC_LINK non — aucune bande imposée par souci de cohérence). URGENT réservé aux familles money-review et sécurité, ton sobre et non promotionnel.

## 8 · Hiérarchie de contenu (ordre imposé)
1 en-tête · 2 h1 · 3 bande de statut *(si pertinente)* · 4 phrase d'adresse (« Bonjour {name}, » — `name` vide → « Bonjour, ») · 5 blocs de données (référence → articles/montant → restaurant) · 6 bouton primaire *(uniquement si une destination réelle et autorisée existe)* · 7 précisions secondaires · 8 pied. Un email = **un état**, jamais un méga-email couvrant plusieurs statuts (une seule notification par événement et par commande, garantie serveur).

## 9 · Composants (tous rendus dans `E1-A-components.html`)
`EmailShell` · `EmailHeader` · `StatusBand` (5 variantes) · `PrimaryButton` / `SecondaryButton` · `CopyableUrl` · `OrderRefBlock` · `ItemsTable` + `AmountRow` · `RestaurantBlock` · `CodeBlock` (dormant) · `Footer`. Aucun composant créé sans usage réel dans les 3 emails ou une famille confirmée.

**Blocs de données** : fond `#FBF8F3`, bordure `#ECE5D8`, rayon 12, `padding:14px 16px`, libellé capitales + valeur. **Un bloc dont la donnée est absente ne s'affiche pas** — pas de bloc vide, pas de « non renseigné », pas de placeholder.

## 10 · Boutons
Table + `<a>` inline-block, `padding:15px 30px`, rayon 10, `min-width:180px`, `bgcolor` sur la cellule (repli si le rayon est ignoré). **CTA OPTIONNEL** — présent seulement si l'email possède une destination réelle, autorisée et véridique ; pas d'URL valide → pas de bouton (décision bêta : CONSUMER_ORDER_READY = aucun CTA, « Voir ma commande » n'est pas inventé). Quand il existe : **un seul bouton primaire**, emplacement réutilisable du système. Sous 620 px : pleine largeur, texte centré. Tout bouton d'action est **doublé d'une URL copiable** visible. Les libellés supportent des chaînes longues (allemand, italien) sans casse : `min-width` et non `width`.

## 11 · Responsive
600 px par défaut. `<620 px` : carte 100 %, rayon 0, padding 20, h1 24/32, boutons pleine largeur. `<360 px` : padding 16, h1 22/30, code 24 px. **Aucun débordement horizontal à 320 px** — vérifié dans la galerie. Les URL longues utilisent `word-break:break-all`.

## 12 · Images bloquées
Toute vérité transactionnelle est **textuelle**. La seule image est le symbole d'en-tête, avec `alt="Grubano"`. Aucune photo de plat, aucune image distante décorative, aucun texte dans une image. L'email doit se lire intégralement images désactivées : vue dédiée dans la galerie.

## 13 · Mode sombre
`color-scheme: light` déclaré. Les fonds sont clairs et les textes foncés : une inversion forcée conserve la lisibilité. Contrôles retenus : le symbole PNG reste visible sur fond sombre (il est coloré, non blanc sur transparent), le bouton garde un `bgcolor` explicite, les bandes de statut gardent leur libellé texte même si la teinte est réécrite. **Aucune correspondance pixel n'est exigée** entre clients.

## 14 · Texte brut
**Une partie texte brut par email, obligatoire.** Structure : titre en capitales · adresse · lignes `Libellé : valeur` · URL seule sur sa ligne · code s'il existe · validité · phrase « ignorez si ce n'est pas vous » le cas échéant · séparateur `--` · identité + support + pourquoi cet email. Les trois parties sont rédigées dans la galerie (vue « Texte brut »).

## 15 · Objet et préheader
**Objet** : information avant marque, référence quand elle existe — `Commande GR-ABC123 prête — Gnocchi Bar`, `Nouvelle commande GR-ABC123 — Gnocchi Bar`, `Votre lien de connexion Grubano`. Pas d'emoji, pas de majuscules criées, ≤ 60 caractères visés. **Préheader** : jamais vide, jamais une répétition de l'objet — il ajoute le fait utile suivant (`GR-ABC123 · 25,50 € · Click & collect · à accepter.`).

## 16 · Ton et français
**Vouvoiement partout**, sans exception — les 3 emails d'auth actuels tutoient : le registre change. Sobre, précis, chaleureux, sans emphase. Lexique canonique : « Click & collect » · « mode » · « restaurant » (**jamais « établissement »**) · « retrait » · « cagnotte ». Conception en FR ; mise en page neutre pour la localisation (montants, dates et libellés jamais figés visuellement) et **prête RTL** (propriétés directionnelles, `dir` sur `<html>`).

## 17 · Accessibilité
Un seul `<h1>` · ordre de lecture linéaire (une colonne, tables de présentation avec `role="presentation"`) · contraste AA sur tout texte · statut jamais porté par la couleur seule · cibles ≥ 44 px en pratique (bouton 46 px de haut) · `alt` signifiant · aucun corps sous 13,5 px · liens soulignés dans les blocs d'URL.

## 18 · Contraintes client email
Compatibilité visée : Gmail (web, iOS, Android), Apple Mail, Outlook (Windows, web, Mac), Yahoo, Proton, Thunderbird. Renoncements assumés : rayons ignorés par Outlook Windows (repli carré acceptable), `word-break` variable, media queries ignorées par Gmail dans certains cas — la mise en page 600 px reste lisible sans elles.

## 19 · Règles d'implémentation
Le HTML des références est la **source visuelle** ; toute donnée est une variable. **Ne jamais figer** les valeurs de démonstration (Léa Martin, Gnocchi Bar, GR-ABC123, 25,50 €, 482913, le token de fixture) en constantes. Chaque email déclare : champs requis, champs optionnels et leur condition, comportement de repli, CTA et sa destination, structure d'objet et de préheader, partie texte brut. Détail par email : `E1-A-DESIGN-MANIFEST.md`.

## 20 · Motifs interdits
Aucun ETA, aucun « arrive bientôt », aucune durée de préparation · **aucune livraison, aucun coursier, aucun frais de livraison en état vivant** (Click & collect uniquement ; la variante livraison existe en **état dormant étiqueté**, jamais envoyée) · aucun frais non lu du serveur · aucun délai bancaire · « Remboursement effectué » **uniquement** sur Stripe `succeeded` (réclamation résolue ≠ remboursement abouti) · aucune promesse de fidélité au-delà de ce qui est crédité (les points ne sont pas exposés aujourd'hui) · aucune promesse juridique · aucune réservation en bêta · aucun id technique (`cuid`, `pi_…`, `re_…`, `Claim.id`) exposé au consommateur ou au partenaire · aucune clé i18n brute · aucun statut en avance sur la vérité serveur · aucun désabonnement sur un transactionnel · aucun réseau social · aucun emoji dans le corps · **aucune couleur porteuse d'information sans texte**.
