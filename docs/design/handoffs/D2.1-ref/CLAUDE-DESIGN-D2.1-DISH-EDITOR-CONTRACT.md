# CLAUDE-DESIGN-D2.1-DISH-EDITOR-CONTRACT

**Surface** : modale `DishEditor` sur `/fr/menu` (onglet Plats) — CREATE et EDIT, même composant. **Référence visuelle rendable** : `dish-editor.html` (états via `?state=create|edit|error|saving`, mobile via `?device=mobile`). **Autorité fonctionnelle** : handoff factuel D2.1 — rien n'est ajouté au périmètre EXISTS.

## 1 · Design intent
L'éditeur reste une **modale** (jamais une route). La cible : un outil professionnel lisible en couches — identité du plat d'abord (photo + nom + description), chiffres ensuite (prix/calories), classement (catégorie), sécurité alimentaire (allergènes), mise en avant (labels, best-seller), destruction isolée, actions toujours visibles.

## 2 · Hiérarchie / ordre des sections (contractuel, DOM)
1 Photo + (Nom, Description) · 2 Prix (€) + Calories · 3 Catégorie · 4 Allergènes (UE 14) · 5 Labels · 6 Best-seller · 7 Supprimer ce plat (EDIT seul) · **Slot erreur** (fixe, hors scroll) · Pied Annuler / Enregistrer.
*Changement vs actuel* : le bandeau d'erreur quitte la position « sous la photo » pour un **slot fixe au-dessus du pied**, toujours visible au moment du clic Enregistrer. Une seule erreur à la fois (fait serveur), affichée verbatim.

## 3 · Contraintes factuelles respectées
Pas de `<form>` ; Enregistrer bloqué **uniquement** si nom vide ; prix défaut 0 mais serveur > 0 → **aide passive** « Supérieur à 0 € » (aucune validation client ajoutée) ; calories entier > 0 ou vide ; catégorie mono, défaut `Plats`, jamais désélectionnable ; **14 allergènes FR verbatim, ordre exact du code, marqueur `✓ ` + `is-on`** (jamais couleur seule) ; labels = 4 tuiles (`Veggie` `Halal` `Sans gluten` `Épicé`), seul le nom est stocké ; DIRTY et SAVED n'existent pas → **aucun** avertissement de fermeture, **aucun** toast succès (la modale se ferme) ; sorties : Annuler, croix (`aria-label` Fermer), clic fond ; pas de bouton Retour ; SAVING ne désactive que le bouton primaire.

## 4 · Compositions
**1440** — modale **720 px**, radius 16, ombre portée, centrée sur fond assombri ; zone identité en 2 colonnes (photo 240 px, 4:3 / champs) ; prix+calories en 2 colonnes ; padding 24 ; scroll interne, tête et pied fixes ; hauteur max 820.
**768** — modale **600 px** ; photo pleine largeur 16:7 ; le reste identique ; prix+calories restent en 2 colonnes.
**390** — **feuille plein écran** (radius 0) ; padding 16 ; photo 16:8 ; chips 40 px de haut ; labels en grille 2×2 ; pied collant, 2 boutons **48 px** en moitiés égales ; « Supprimer ce plat » au-dessus du slot erreur, jamais adjacent à Enregistrer.

## 5 · États (rendus dans le HTML)
`create` : titre **Ajouter un plat**, photo **Ajouter une photo**, champs vides, prix `0`, 0 allergène, Enregistrer désactivé (opacity .55), pas de Supprimer. · `edit` : titre **Modifier le plat**, photo **Changer la photo**, préremplis (démo : Risotto de démonstration, 14,5, ✓ Lactose ✓ Céleri), Supprimer visible. · `error` : bandeau rouge (`role="alert"`), texte serveur verbatim — démo : chaîne photo documentée ; saisie conservée. · `saving` : bouton primaire → spinner `progress_activity` + **Enregistrement…**, opacity .55, tout le reste actif (fait) ; `prefers-reduced-motion` coupe la rotation.

## 6 · Tokens D2.1
Réutilise `--op-*` (contexte OperatorShell). Spécifiques : modal-w 720/600/100 % · pad 24/16 · field-gap 16 · section-gap 24 · input-h 44 · btn-h 44 (48 mobile) · chip-h 36 (40 mobile) · radius md 8 / lg 12 / xl 16 / pill · focus ring zest ; catégorie active = **encre pleine + ✓** ; allergène actif = **fond zest-bg + bord zest-bd + texte zest-600 + ✓**.

## 7 · Primitives (candidates for reuse)
`DishEditorModal` (head/scroll/err-slot/foot) · `PhotoTile` · `FormField` (+help) · `MoneyField` · `ChipGroup` (mono=catégorie / multi=allergènes) · `LabelTile` · `SwitchRow` · `ErrorBanner` · `ModalActionBar`.

## 8 · Accessibilité
`role="dialog" aria-modal` ; labels persistants ; focus visible 3 px ; cibles ≥ 44 px mobile ; état coché = texte `✓ ` + fond (double canal) ; erreur en `role="alert"` ; icônes tuiles décoratives (texte porteur). Icônes labels retenues : `eco / mosque / grain / local_fire_department` — si le produit possède déjà d'autres icônes de tuiles, les conserver (EXPLICITLY ACCEPTED).

## 9 · Wording exact (inchangé sauf ajouts marqués)
Titres, libellés champs, pied, suppression, photo : chaînes du handoff verbatim. **Ajouts design (aides passives)** : « JPG, PNG ou WebP · 8 Mo max » (tuile) · « Supérieur à 0 € » (prix) · « Facultatif — nombre entier » (calories) · « Sans sélection, le client verra “Information non renseignée par le restaurant”. » (allergènes).

## 10 · Implementation contract — Claude Code
Respecter : ordre des sections §2 · dimensions/espacements §4 et §6 · états §5 · wording §9 · aucun champ hors matrice EXISTS · aucune validation client nouvelle · aucun toast/dirty/autosave · comparaison Puppeteer contre `dish-editor.html` à 390/768/1440 × états `create/edit/error/saving` — toute déviation FIXED ou EXPLICITLY ACCEPTED.
**PRODUCT GAPS (à arbitrer ailleurs, non dessinés)** : prix défaut 0 rejeté serveur · erreur 400 affichée avec le texte photo · SAVED sans aucun retour · échec de chargement = liste vide indistinguable.
**HORS PÉRIMÈTRE de cette référence** : écran Scan IA (S2) — même grammaire de champs, composition propre à concevoir dans une intervention dédiée.
