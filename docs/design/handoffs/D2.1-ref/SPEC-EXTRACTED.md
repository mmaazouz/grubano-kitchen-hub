# D2.1 — SPEC EXTRAITE DE `dish-editor.html` (S1-SPEC, lecture seule du produit)

> **Objet** — traduire la référence visuelle `docs/design/handoffs/D2.1-ref/dish-editor.html` en
> spécification EXACTE et implémentable pour la modale `DishEditor` de `/[locale]/menu`.
> **Sources** : `dish-editor.html` (numéros de ligne cités = ce fichier), le contrat
> `CLAUDE-DESIGN-D2.1-DISH-EDITOR-CONTRACT.md`, et l'autorité fonctionnelle
> `docs/design/handoffs/D2.1/D2.1-DISH-EDITOR-FACTUAL-HANDOFF.md`.
> **Produit visé** : `app/[locale]/menu/page.tsx:1942-2242` (`DishEditor`) + `app/[locale]/menu/menu.css`.
> **Aucun code produit n'a été modifié par cet agent.** Ce document est le seul fichier écrit.

---

## 0 · Règles de lecture

1. **Rien n'est ajouté au périmètre EXISTS.** Aucun champ, aucune validation client, aucun toast,
   aucun DIRTY/autosave, aucune touche Échap, aucune confirmation de suppression.
2. Les 4 **PRODUCT GAPS** (prix 0 rejeté serveur · erreur 400 affichée avec le texte photo ·
   SAVED sans retour · échec de chargement = liste vide) **ne sont PAS corrigés ici**.
3. Le harnais de la référence (barre `.demo`, `.stage`, `.wrapm`, `.force-mobile`, le script
   `setState/setDev/setDir`, les container queries) **n'est pas reproduit** : c'est un banc de
   prévisualisation. Voir §6.
4. **Nouvelles classes CSS obligatoires** (préfixe `de-` / `dem`, vérifié sans collision dans
   `app/**/*.css` + `components/**/*.css`) : `menu.css` est un import global Next.js et
   `.op-field / .op-chips / .op-chip.allergen / .op-labels / .op-label-tile / .op-callout /
   .photo-upload / .avail-row / .op-modal*` sont **partagés** avec l'écran Scan IA
   (`ResultStep`, `page.tsx:1853-1924`, HORS PÉRIMÈTRE), les modales Catégorie et Suppression
   (`page.tsx:1046-1120`) et `supplier/catalog`. **Restyler un `op-*` existant = régression
   hors périmètre.**

---

## 1 · ARBRE DOM CONTRACTUEL

Ordre du contrat §2. `{…}` = valeur dynamique produit. Texte FR = verbatim.

```
div.op-modal-backdrop                         [onClick fond → onClose, inchangé]
└── div.de-modal                              role="dialog" aria-modal="true"
    │                                         aria-labelledby="de-modal-title"
    │                                         data-state="create|edit"  (facultatif, cf. §4)
    ├── header.de-modal__head
    │   ├── h2.de-modal__title#de-modal-title  → « Ajouter un plat » | « Modifier le plat »
    │   └── button.de-modal__close             type="button" aria-label="Fermer"
    │       └── span.ms aria-hidden="true"     → close
    │
    ├── div.de-modal__scroll                   [seul conteneur de défilement]
    │   │
    │   ├── input[type=file] hidden            accept="image/jpeg,image/png,image/webp"
    │   │
    │   ├── ① div.de-id                        [grille photo | champs]
    │   │   ├── div.de-photo                   role="button" tabIndex={0}
    │   │   │   ├── img                        [SI photo — alt="Photo de {nom}"]
    │   │   │   ├── span.ms aria-hidden="true" → add_photo_alternate
    │   │   │   ├── b                          → « Ajouter une photo » | « Changer la photo »
    │   │   │   └── span                       → « JPG, PNG ou WebP · 8 Mo max »      [NOUVEAU]
    │   │   └── div.de-id__f
    │   │       ├── div.de-fld
    │   │       │   ├── label[for=de-f-name]   → « Nom du plat »
    │   │       │   └── input#de-f-name.de-inp type="text" placeholder="Nom du plat"
    │   │       └── div.de-fld
    │   │           ├── label[for=de-f-desc]   → « Description »
    │   │           └── textarea#de-f-desc.de-inp rows={3} placeholder="Description"
    │   │
    │   ├── ② div.de-row2                      [2 colonnes à TOUTES les largeurs]
    │   │   ├── div.de-fld
    │   │   │   ├── label[for=de-f-price]      → « Prix (€) »
    │   │   │   ├── input#de-f-price.de-inp.mono type="number" step="0.1" min="0"
    │   │   │   └── div.de-fld__help
    │   │   │       ├── span.ms aria-hidden="true" → info
    │   │   │       └── « Supérieur à 0 € »                                          [NOUVEAU]
    │   │   └── div.de-fld
    │   │       ├── label[for=de-f-cal]        → « Calories »
    │   │       ├── input#de-f-cal.de-inp.mono type="number" min="0"
    │   │       └── div.de-fld__help
    │   │           ├── span.ms aria-hidden="true" → info
    │   │           └── « Facultatif — nombre entier »                                [NOUVEAU]
    │   │
    │   ├── ③ div.de-sec                       [Catégorie]
    │   │   ├── label                          → « Catégorie »
    │   │   └── div.de-chips
    │   │       └── button.de-chip[.is-cat-on] type="button"  ×N  → {nom} · actif = « ✓ {nom} »
    │   │
    │   ├── ④ div.de-sec                       [Allergènes]
    │   │   ├── label                          → « Allergènes (UE 14) »
    │   │   ├── div.de-chips
    │   │   │   └── button.de-chip.de-chip--allergen[.is-on] type="button" ×14
    │   │   │       → actif = « ✓ {nom} », inactif = « {nom} »
    │   │   └── div.de-fld__help.de-help--block
    │   │       ├── span.ms aria-hidden="true" → info
    │   │       └── « Sans sélection, le client verra « Information non renseignée
    │   │            par le restaurant ». »                                          [NOUVEAU]
    │   │
    │   ├── ⑤ div.de-sec                       [Labels]
    │   │   ├── label                          → « Labels »
    │   │   └── div.de-tiles
    │   │       └── button.de-tile[.is-on] type="button" ×4
    │   │           ├── span.ms aria-hidden="true" → {icône}
    │   │           └── {nom}  → Veggie · Halal · Sans gluten · Épicé
    │   │
    │   ├── ⑥ div.de-sec
    │   │   └── div.de-switchrow
    │   │       ├── div.m
    │   │       │   ├── b                      → « Best-seller »
    │   │       │   └── span                   → « Mis en avant auprès des clients »
    │   │       └── {contrôle switch existant}  cf. §5.3
    │   │
    │   └── ⑦ div.de-del                       [EDIT SEUL — !isNew]
    │       └── button type="button"
    │           ├── span.ms aria-hidden="true" → delete
    │           └── « Supprimer ce plat »
    │
    ├── SLOT ERREUR — div.de-modal__err        role="alert"   [HORS SCROLL, rendu SI erreur]
    │   ├── span.ms aria-hidden="true"         → error
    │   └── span                               → {texte serveur verbatim, source inchangée}
    │
    └── footer.de-modal__foot
        ├── button.de-btn.de-btn--cancel       type="button" → « Annuler »
        └── button.de-btn.de-btn--save         type="button" disabled={saving || !d.name}
            ├── IDLE : span.ms(check) + « Enregistrer »
            └── SAVING : span.ms.de-spin(progress_activity) + « Enregistrement… »
```

**Sources DOM** : `dish-editor.html:168` (dialog) · `:170-173` (head) · `:175` (scroll) ·
`:178-194` (identité) · `:197-208` (prix/calories) · `:211-219` (catégorie) · `:222-241`
(allergènes) · `:244-252` (labels) · `:255-260` (best-seller) · `:263-265` (supprimer) ·
`:270-273` (slot erreur) · `:275-281` (pied).

### 1.1 Textes FR exacts (verbatim)

| Nœud | Texte | Origine |
|---|---|---|
| Titre CREATE | `Ajouter un plat` | `menu.editor.modalNewTitle` (existe) |
| Titre EDIT | `Modifier le plat` | `menu.editor.modalEditTitle` (existe) |
| Croix | `Fermer` (aria-label) | `menu.editor.close` (existe) |
| Photo CREATE | `Ajouter une photo` | `menu.photo.pick` (existe) |
| Photo EDIT | `Changer la photo` | `menu.photo.change` (existe) |
| Aide photo | `JPG, PNG ou WebP · 8 Mo max` | **NOUVELLE clé** (≠ `menu.photo.replaceHint`) |
| Nom | `Nom du plat` (label + placeholder) | `menu.editor.fName` / `fNamePlaceholder` |
| Description | `Description` (label + placeholder) | `menu.editor.fDesc` |
| Prix | `Prix (€)` | `menu.editor.fPrice` |
| Aide prix | `Supérieur à 0 €` | **NOUVELLE clé** |
| Calories | `Calories` | `menu.editor.fCalories` |
| Aide calories | `Facultatif — nombre entier` | **NOUVELLE clé** |
| Catégorie | `Catégorie` | `menu.editor.fCategory` |
| Allergènes | `Allergènes (UE 14)` | `menu.editor.fAllergens` |
| Aide allergènes | `Sans sélection, le client verra « Information non renseignée par le restaurant ».` | **NOUVELLE clé** |
| Labels | `Labels` | `menu.editor.fLabels` |
| Best-seller | `Best-seller` / `Mis en avant auprès des clients` | `menu.editor.fBest` / `fBestSub` |
| Supprimer | `Supprimer ce plat` | `menu.editor.deleteThisDish` |
| Erreur démo | `Photo invalide (format ou taille). Acceptés : JPG, PNG, WebP — 8 Mo max.` | **= `menu.photo.err400` déjà en base — coïncidence vérifiée, ne rien changer** |
| Annuler | `Annuler` | `menu.editor.cancel` |
| Enregistrer | `Enregistrer` | `menu.editor.save` |
| Enregistrement | `Enregistrement…` | `menu.editor.saving` |
| Allergènes ×14 | `Gluten · Lactose · Œuf · Soja · Arachide · Fruits à coque · Poisson · Crustacés · Mollusques · Céleri · Moutarde · Sésame · Sulfites · Lupin` | `ALL_EU`, `page.tsx:114` — **ordre et chaînes inchangés** |
| Labels ×4 | `Veggie · Halal · Sans gluten · Épicé` | `ALL_LABELS`, `page.tsx:116-121` |

### 1.2 `i18nNeeds` (à faire fusionner par l'agent central — NE PAS éditer `messages/*.json`)

Espace `menu.editor` :

| Clé proposée | FR |
|---|---|
| `helpPhoto` | `JPG, PNG ou WebP · 8 Mo max` |
| `helpPrice` | `Supérieur à 0 €` |
| `helpCalories` | `Facultatif — nombre entier` |
| `helpAllergens` | `Sans sélection, le client verra « Information non renseignée par le restaurant ».` |

Aucune autre chaîne nouvelle. `messages/*.json` contiennent des clés dupliquées → **jamais**
de `JSON.parse`/`stringify` : insertion ancrée textuelle uniquement.

---

## 2 · MESURES PAR BREAKPOINT

### 2.0 Constantes (identiques aux 3 largeurs sauf mention)

| Grandeur | Valeur | Règle SOURCE |
|---|---|---|
| gap entre champs | **16 px** | `:28` `--de-field-gap:16px` ; `:69` `.de-id{gap:var(--de-field-gap)}` ; `:74` `.de-id__f{gap:…}` ; `:84` `.de-row2{gap:…}` |
| gap entre sections | **24 px** | `:29` `--de-section-gap:24px` ; `:69`/`:84`/`:86` `margin-bottom:var(--de-section-gap)` |
| hauteur input | **44 px** | `:30` `--de-input-h:44px` ; `:77` `.inp{height:var(--de-input-h)}` |
| hauteur textarea | **min 84 px**, `resize:vertical` | `:80` `textarea.inp{height:auto;min-height:84px;padding:11px 13px;line-height:1.5}` |
| hauteur bouton pied | **44 px** (48 en 390) | `:30` `--de-btn-h:44px` ; `:122` `.btn{height:var(--de-btn-h)}` ; `:151` `@container ≤560 .dem__foot .btn{height:48px}` |
| hauteur chip | **36 px** (40 en 390) | `:30` `--de-chip-h:36px` ; `:91` `.chip{height:var(--de-chip-h)}` ; `:149` `@container ≤560 .chip{height:40px}` |
| hauteur tuile label | **56 px** | `:99` `.tile{height:56px}` |
| hauteur max modale | **820 px** (annulée en 390) | `:55` `.dem{max-height:820px}` ; `:142` `max-height:none` |
| gouttière chips | **8 px** | `:90` `.chips{gap:8px}` |
| gouttière tuiles | **8 px** | `:98` `.tiles{gap:8px}` |
| gap pied | **10 px** | `:61` `.dem__foot{gap:10px}` |
| padding pied | **14 px `var(--de-pad)`** | `:61` |
| padding tête | **18 px `var(--de-pad)`** (14 px 16 px en 390) | `:56` ; `:145` |
| marge slot erreur | **`0 var(--de-pad) 12px`** | `:64` |
| padding slot erreur | **11 px 14 px** | `:64` |

### 2.1 — 1440 px (composition « wide »)

| Élément | Valeur | Règle SOURCE |
|---|---|---|
| Largeur modale | **720 px** | `:25` `--de-modal-w:720px` ; `:55` `.dem{width:var(--de-modal-w)}` |
| Radius | **16 px** (`--op-r-xl`) | `:55` `border-radius:var(--op-r-xl)` ; `:23` `--op-r-xl:16px` |
| Padding interne | **24 px** | `:27` `--de-pad:24px` ; `:60` `.dem__scroll{padding:var(--de-pad)}` |
| Hauteur max | **820 px**, défilement interne | `:55` `max-height:820px;overflow:hidden` + `:60` `.dem__scroll{flex:1;overflow-y:auto}` |
| Tête / pied | **fixes** (flex-shrink:0 hors du scroll) | `:56` / `:61` `flex-shrink:0` |
| Zone identité | **grille `240px 1fr`**, gap 16 | `:69` `.de-id{grid-template-columns:240px 1fr}` |
| Photo | **240 × 180** (`aspect-ratio:4/3`) | `:70` `.de-photo{aspect-ratio:4/3}` |
| Prix + Calories | **2 colonnes `1fr 1fr`** → 328 px chacune | `:84` `.de-row2{grid-template-columns:1fr 1fr}` |
| Tuiles labels | **4 colonnes** → 4 × 156 px | `:98` `.tiles{grid-template-columns:repeat(4,1fr)}` |
| Boutons pied | 44 px, **alignés à droite**, gap 10 | `:61` `justify-content:flex-end` |
| Bouton primaire | `min-width:150px` | `:125` |

*Contenu utile* : 720 − 2×24 = **672 px** → identité 240 + 16 + 416 ; row2 328 + 16 + 328 ;
tuiles (672 − 3×8)/4 = 162 px.

### 2.2 — 768 px (composition « md »)

| Élément | Valeur | Règle SOURCE |
|---|---|---|
| Largeur modale | **600 px** | `:26` `--de-modal-w-md:600px` ; `:140` `@container de (max-width:900px){.dem{width:var(--de-modal-w-md)}}` |
| Radius / padding / hauteur max | **inchangés** (16 / 24 / 820) | aucune règle contraire dans `:140` |
| Zone identité | **1 colonne** (photo au-dessus des champs) | `:140` `.de-id{grid-template-columns:1fr}` |
| Photo | **pleine largeur**, `aspect-ratio:16/7` → 552 × 241 | `:140` `.de-photo{aspect-ratio:16/7}` |
| Prix + Calories | **restent 2 colonnes** | `.de-row2` non surchargé |
| Tuiles labels | **4 colonnes** (non surchargées) | `.tiles` non surchargé |
| Chips | 36 px | `.chip` non surchargé |

*Contenu utile* : 600 − 48 = **552 px** → row2 268 + 16 + 268 ; tuiles (552 − 24)/4 = 132 px.

### 2.3 — 390 px (feuille plein écran)

| Élément | Valeur | Règle SOURCE |
|---|---|---|
| Largeur modale | **100 %** (`max-width:100%`) | `:142` `.dem{width:100%;max-width:100%}` |
| Radius | **0** | `:142` `border-radius:0` |
| Hauteur max | **aucune** (feuille) | `:142` `max-height:none` — cf. §6-R3 sur `min-height:900px` |
| Fond de scène | `padding:0` (la feuille touche les bords) | `:143` `.stage{padding:0}` |
| Padding interne | **16 px** | `:144` `:root{--de-pad:16px}` — **règle INOPÉRANTE dans la référence, cf. §6-R1** |
| Padding tête | **14 px 16 px** (valeur explicite, elle s'applique) | `:145` |
| Photo | pleine largeur, `aspect-ratio:16/8` → 358 × 179 | `:146` |
| Prix + Calories | **2 colonnes** (réaffirmé) | `:147` `.de-row2{grid-template-columns:1fr 1fr}` |
| Tuiles labels | **grille 2×2** | `:148` `.tiles{grid-template-columns:repeat(2,1fr)}` |
| Chips | **40 px** de haut | `:149` |
| Pied | **collant**, 2 boutons `flex:1` en **moitiés égales**, **48 px** | `:150-152` `.dem__foot{gap:10px}` `.dem__foot .btn{flex:1;height:48px}` `.btn--save{min-width:0}` |
| Supprimer | dans le scroll, **au-dessus du slot erreur** — jamais adjacent à Enregistrer | ordre DOM `:263` avant `:270` |

*Contenu utile* : 390 − 32 = **358 px** → row2 171 + 16 + 171 ; tuiles 175 × 56 ;
boutons pied (358 − 10)/2 = 174 px chacun.

### 2.4 Traduction des breakpoints (container → viewport)

La référence interroge un **container** (`.stage{container-type:inline-size;container-name:de}`,
`:48`) dont la largeur vaut `viewport − 48` en desktop et `viewport` en `force-mobile`.
**Le produit doit utiliser de VRAIES media queries viewport** (la modale est `position:fixed`,
elle n'a pas de container). Seuils qui reproduisent exactement le contrat aux 3 largeurs :

```
(défaut)                     → 720 px   ✔ 1440
@media (max-width:900px)     → 600 px   ✔ 768   (1440 exclu)
@media (max-width:560px)     → feuille  ✔ 390   (768 exclu)
```

Les breakpoints du shell (880 / 700, `operator-shell.css:150,178`) et du contenu
(1040 / 880 / 460, `menu.css:304,310,330`) **ne pilotent pas** la modale : celle-ci est
`position:fixed; z-index:100` au-dessus de tout le chrome (handoff PART 12.0/12.5).

---

## 3 · TOKENS

### 3.1 Variables `--de-*` de la référence (`dish-editor.html:25-30`)

| Variable | Valeur | Devenir dans le produit |
|---|---|---|
| `--de-modal-w` | `720px` | à porter sur `.de-modal` (défaut) |
| `--de-modal-w-md` | `600px` | à porter dans `@media (max-width:900px)` |
| `--de-pad` | `24px` → `16px` ≤560 | **à définir sur `.de-modal` lui-même**, jamais sur `:root` (§6-R1) |
| `--de-field-gap` | `16px` | idem |
| `--de-section-gap` | `24px` | idem |
| `--de-input-h` | `44px` | idem |
| `--de-btn-h` | `44px` → `48px` ≤560 | idem |
| `--de-chip-h` | `36px` → `40px` ≤560 | idem |

> Portée recommandée : `.gb-op .de-modal{--de-pad:24px; …}` puis surcharge dans les media
> queries **sur le même sélecteur** → les descendants héritent, la règle s'applique vraiment.

### 3.2 Correspondance avec les `--op-*` du produit (`components/operator/operator-shell.css:16-33`)

| Référence | Valeur réf. | `--op-*` produit | Identique ? |
|---|---|---|---|
| `--op-zest` | `#FF6A1F` | `--op-zest` | ✅ |
| `--op-zest-600` | `#F2570E` | `--op-zest-600` | ✅ |
| `--op-zest-bg` | `#FFF1E7` | `--op-zest-bg` | ✅ |
| `--op-zest-bd` | `#F8D3BC` | **ABSENT du produit** | ⚠️ **à créer** (§3.3) |
| `--op-ink` | `#0F2742` | **ABSENT** — équivalent exact `--op-chrome-1` (`#0F2742`, navy permanent clair+sombre) | ⚠️ utiliser `--op-chrome-1` |
| `--op-surface` | `#FFFFFF` | `--op-surface` | ✅ (sombre : `#101B2D`) |
| `--op-surface-2` | `#F7F8FA` | `--op-surface-2` | ✅ |
| `--op-canvas-dim` | `rgba(10,18,32,.55)` | **ABSENT** comme token, mais valeur **identique en dur** dans `menu.css:208` `.op-modal-backdrop` | ✅ de fait |
| `--op-border` | `#E3E7EE` | `--op-border` | ✅ |
| `--op-border-strong` | `#D2D8E1` | `--op-border-strong` | ✅ |
| `--op-text` | `#101828` | `--op-text` | ✅ |
| `--op-muted` | `#5B6472` | `--op-muted` | ✅ |
| `--op-muted-2` | `#8992A3` | `--op-muted-2` | ✅ |
| `--op-danger` / `-bg` / `-bd` | `#D5372A` / `#FCEAE7` / `#F5C9C0` | idem | ✅ |
| `--op-font-display` / `-ui` / `-mono` | Gabarito / Hanken Grotesk / JetBrains Mono | idem | ✅ |
| `--op-r-md/lg/xl/pill` | 8 / 12 / 16 / 999 | idem | ✅ |
| `--op-focus` | `0 0 0 3px rgba(255,106,31,.18)` | `0 0 0 3px rgba(255,106,31,.16)` | ⚠️ **écart .18 vs .16** → garder la valeur PRODUIT |

### 3.3 Valeurs EN DUR de la référence sans équivalent `--op-*`

| Règle | Valeur | Recommandation |
|---|---|---|
| `:14` `--op-zest-bd` | `#F8D3BC` | **manque au shell.** Ne PAS l'ajouter à `operator-shell.css` (hors périmètre) → déclarer un fallback local `.gb-op .de-modal{--de-zest-bd:var(--op-zest-bd,#F8D3BC)}` ou utiliser `#F8D3BC` en dur commenté. **Sombre : aucune valeur fournie par la référence** → prévoir `[data-theme="dark"]` (piste : `--op-zest` à 24 % ou `--op-border-strong`). |
| `:55` ombre modale | `0 32px 80px -24px rgba(4,10,20,.6)` | pas d'équivalent (`--op-shadow-pop` = `0 16px 40px -12px rgba(16,24,40,.28)`). Reproduire la valeur de la référence en dur. |
| `:70` fond photo | `repeating-linear-gradient(135deg,#EDF0F4 0 14px,#E5E9EF 14px 28px)` | le produit a déjà l'équivalent **tokenisé** (`menu.css:240` `--op-surface-2`/`--op-border`, pas 12/24) → **garder la version tokenisée** (sinon la tuile reste claire en thème sombre). Écart de pas 12/24 → 14/28 : accepté ou aligné, sans impact perceptible. |
| `:110` pastille switch | `#fff` | acceptable en dur (identique au produit `menu.css:126`). |
| `:111` piste switch active | `var(--op-zest-600)` | **le produit utilise `--op-success`** (`menu.css:127`) → §5.3. |
| `:125` dégradé bouton primaire | `linear-gradient(135deg,#FF8A3D,#F2570E)` | **identique** au produit (`menu.css:185`) → réutiliser tel quel. |
| `:34`, `:41-52` | `#0E1D33`, `.demo`, `.stage` | **harnais** — ne rien reproduire. |
| Thème sombre | **absent de la référence** | toute couleur nouvelle DOIT passer par un `--op-*` ou recevoir sa contrepartie `[data-theme="dark"] .gb-op …`. |

---

## 4 · ÉTATS — ce qui change EXACTEMENT

| État | Titre | Libellé photo | Valeurs | Supprimer | Slot erreur | Bouton primaire |
|---|---|---|---|---|---|---|
| **create** | `Ajouter un plat` | `Ajouter une photo` | champs vides, `price=0`, 0 allergène, catégorie par défaut sélectionnée | **absent** | absent | **désactivé** (`opacity:.55; cursor:not-allowed`) |
| **edit** | `Modifier le plat` | `Changer la photo` | préremplis (démo réf. : `Risotto de démonstration`, `14.5`, `✓ Lactose` `✓ Céleri`, best-seller ON) | **visible** | absent | actif |
| **error** | selon create/edit | selon create/edit | **saisie conservée** | selon mode | **visible**, `role="alert"`, texte serveur **verbatim** | actif |
| **saving** | selon create/edit | selon create/edit | inchangées | selon mode (reste affiché) | selon cas | `progress_activity` en rotation + `Enregistrement…`, `opacity:.55`, `cursor:not-allowed` |

**Règles SOURCE** : `:66` `.dem[data-state="error"] .dem__err{display:flex}` ·
`:117` `.dem[data-state="edit"] .de-del,.dem[data-state="saving"][data-from="edit"] .de-del{display:block}` ·
`:126` `.btn--save[disabled]{opacity:.55;cursor:not-allowed;box-shadow:none}` ·
`:128-129` `@keyframes spin` + `@media (prefers-reduced-motion:reduce){.btn--save .spin{animation:none}}` ·
`:130-134` bascule `.save-idle` / `.save-busy` · `:137` `.dem[data-state="create"] .btn--save{opacity:.55}`.

### 4.1 Traduction en React (pas de `data-state` piloté par CSS)

Le produit rend déjà ces variantes en JSX conditionnel — **conserver ce mécanisme** (le
`data-state` de la référence est un artefact du banc) :

| Réf. CSS | Équivalent produit |
|---|---|
| `[data-state="create"]` / `[data-state="edit"]` | `const isNew = item.id === 'new'` (`page.tsx:1958`) |
| `.de-del` masqué/affiché | `{!isNew && (<div className="de-del">…</div>)}` |
| `.dem__err` masqué/affiché | `{photoError && (<div className="de-modal__err" role="alert">…</div>)}` |
| `[disabled]` create + saving | `disabled={saving || !d.name}` — **inchangé** |
| `.save-idle` / `.save-busy` | ternaire `saving ?` existant — **inchangé** |
| rotation | classe CSS `.de-spin` avec `@keyframes` + `prefers-reduced-motion` (aujourd'hui : `style={{animation:'op-scan-spin 1s linear infinite'}}` inline, **sans coupure reduced-motion**) |

`data-state` peut être posé sur `.de-modal` **à titre documentaire / QA Puppeteer**
(`data-state={isNew ? 'create' : 'edit'}`), à condition qu'aucune règle CSS de mise en page ne
dépende de lui.

---

## 5 · DIFF vs PRODUIT ACTUEL (`page.tsx:1942-2242`)

### 5.1 À CHANGER — structure

| # | Actuel | Cible | Impact |
|---|---|---|---|
| 1 | `.op-modal.wide` (max-width **580**, `max-height:92vh`, `overflow-y:auto` sur la boîte, tête/pied `sticky`) | `.de-modal` : `display:flex;flex-direction:column;overflow:hidden`, largeur **720 / 600 / 100 %**, `max-height:820px`, tête/pied `flex-shrink:0`, scroll **interne** `.de-modal__scroll{flex:1;overflow-y:auto}` | **prérequis du slot erreur hors scroll** |
| 2 | Photo **pleine largeur, 150 px de haut**, seule, AVANT le nom (`page.tsx:2126-2135`) | `.de-id` grille `240px 1fr` : tuile photo (4:3) **à gauche**, Nom + Description **à droite** | recomposition §2 du contrat |
| 3 | Bandeau d'erreur `.op-callout.danger` **entre la photo et le nom** (`page.tsx:2136-2141`) | **DÉPLACÉ** dans le slot fixe `.de-modal__err` entre `.de-modal__scroll` et `.de-modal__foot`, `role="alert"` | **déplacement du RENDU uniquement — source `photoError` et texte inchangés** |
| 4 | `.op-modal__body{display:flex;flex-direction:column;gap:16px}` | `.de-modal__scroll{padding:var(--de-pad)}` + marges portées par `.de-id/.de-row2/.de-sec{margin-bottom:24px}` | rythme 16 champ / 24 section |
| 5 | `.op-field-row{display:flex;gap:12px}` | `.de-row2{display:grid;grid-template-columns:1fr 1fr;gap:16px}` aux 3 largeurs | gouttière 12 → 16 |
| 6 | Aucune aide passive | 4 `.de-fld__help` (photo, prix, calories, allergènes) | §9 du contrat — **texte seul, aucune validation** |
| 7 | Catégorie active = `is-on` teinte zest, **sans ✓** (`page.tsx:2172-2176`) | `.is-cat-on` = **encre pleine `--op-chrome-1` + `#fff` + préfixe `✓ `** | double canal §8 |
| 8 | Allergène actif = **teinte danger** (`menu.css:251`) | `.de-chip--allergen.is-on` = `--op-zest-bg` + bord `#F8D3BC` + texte `--op-zest-600` (préfixe `✓ ` **déjà présent**) | §6 du contrat |
| 9 | Bouton Supprimer = `.op-btn-ghost` + **styles inline** (`page.tsx:2223-2226`) | `.de-del > button` : lien-danger sans bordure, `13px/700`, `--op-danger`, icône 17 px | retirer les styles inline |
| 10 | Tuile photo = `<div onClick>` sans rôle | `role="button" tabIndex={0}` (verbatim réf. `:179`) | cf. §6-R6 |
| 11 | `<h3>` sans `id` ; conteneur sans `role` | `<h2 id="de-modal-title">` + `role="dialog" aria-modal="true" aria-labelledby` sur `.de-modal` | §8 du contrat |
| 12 | Spinner en `style` inline sans coupure | classe `.de-spin` + `@media (prefers-reduced-motion:reduce){animation:none}` | §5 du contrat |
| 13 | Labels : `.op-labels` 4→3→2 colonnes (880/460) | `.de-tiles` 4 colonnes, **2×2 seulement ≤560**, tuile **56 px** | §4 du contrat |
| 14 | Backdrop `padding:20px`, centrage vertical à toutes largeurs | `@media (max-width:560px)` : `padding:0` + feuille `height:100dvh` | feuille plein écran |

### 5.2 À CHANGER — typographie / métriques (réf. → produit actuel)

| Élément | Référence | Produit actuel |
|---|---|---|
| Titre modale | `19px / 800` display | `16px / 800` (`menu.css:213`) |
| Croix | `36 × 36`, `.ms` 20 px | `30 × 30`, `.ms` 18 px (`menu.css:214-215`) |
| Label de champ | `12.5px / 700`, couleur héritée `--op-text` | `11.5px / 700`, `--op-muted` (`menu.css:222`) |
| Input | `height:44`, `padding:0 13px`, `font-size:14.5px` | `padding:10px 12px`, `font-size:13.5px` (hauteur libre ≈ 40) (`menu.css:225`) |
| Textarea | `min-height:84`, `padding:11px 13px` | `min-height:64` (`menu.css:228`) |
| Chip | `height:36/40`, `padding:0 14px`, `13px / 600`, couleur `--op-text` | `padding:6px 12px`, `11.5px / 700`, `--op-muted` (`menu.css:248`) |
| Tuile label | `height:56`, `12px / 700`, `.ms` 19 px, radius 12 | `padding:10px 6px`, `9.5px / 700`, `.ms` 16 px, radius 8 (`menu.css:253-254`) |
| Rangée best-seller | `padding:14px 16px`, radius **12**, **bordure** `1px --op-border`, `b` 13.5 px | `padding:12px 14px`, radius 8, **sans bordure** (`menu.css:259-261`) |
| Bouton pied | `height:44/48`, `padding:0 20px`, `14px`, save `800` + `min-width:150` | `padding:11-12px 18-20px`, `13-13.5px` (`menu.css:185,218`) |
| Bandeau erreur | `13px`, `padding:11px 14px`, icône 18 px, texte `--op-text` | `12px`, `padding:12px`, texte `--op-danger` (`menu.css:231-234`) |

### 5.3 Point d'arbitrage : le switch Best-seller

- Référence `:109-113` : `.sw` **44 × 25**, pastille 20 px, actif = **`--op-zest-600`**.
- Produit `menu.css:123-130` : `.op-switch` **38 × 22**, pastille 18 px, actif = **`--op-success`** (vert),
  et le contrôle est un vrai `<input type="checkbox">` (`page.tsx:2217-2219`) — **partagé** avec
  d'autres surfaces (`.op-switch` est recopié dans plusieurs CSS d'écrans).

**Recommandation** : conserver l'`<input type="checkbox">` (accessibilité + handler inchangés) et
**surcharger uniquement sous l'éditeur** :
`.gb-op .de-switchrow .op-switch .track{width:44px;height:25px}` …
`.gb-op .de-switchrow .op-switch input:checked + .track{background:var(--op-zest-600)}`.
**Interdit** : modifier `.gb-op .op-switch` globalement.

### 5.4 À NE PAS TOUCHER — strictement identique

- `handleSave()` (`page.tsx:2036-2098`), `mapUploadError()` (`:2019-2033`), `handlePhotoPick()`
  (`:1981-2007`), l'`useEffect` de révocation d'objectURL (`:1974-1979`), `photoSrc` (`:2100`).
- Les appels réseau : `POST /api/menu`, `POST /api/menu/photo`, la délégation `onSave` (PUT côté
  parent), `onDelete(item.id)`, `onClose()`. **Aucune route `app/api/**` touchée.**
- `disabled={saving || !d.name}` — **la seule condition de blocage**.
- Le filtre de type client (`image/jpeg|png|webp`) + le seuil 8 Mo + le texte `tPhoto('err400')`.
- L'absence de `Escape`, l'absence de confirmation de suppression, l'absence de toast, l'absence
  de suivi DIRTY, l'absence de bouton « Retour », le clic-fond `e.target === e.currentTarget`.
- `ALL_EU` (`page.tsx:114`) : 14 chaînes, ordre exact. `ALL_LABELS` (`:116-121`) : **garder
  l'icône `verified` pour Halal** (la référence dit `mosque` ; contrat §8 : icônes existantes
  conservées = **EXPLICITLY ACCEPTED**).
- Les catégories viennent de la prop `categories` (`allCats = categories`, `:2014`) — **ne
  pas réintroduire de liste en dur**, ne pas rendre la catégorie désélectionnable.
- `ResultStep` / Scan IA (`page.tsx:1758-1937`), `OperatorShell`, `operator-shell.css`, les
  modales Catégorie et Suppression (`page.tsx:1046-1120`) : **aucune modification**.
- Toutes les clés i18n existantes listées §1.1 : réutilisées telles quelles.

---

## 6 · RISQUES DE DÉVIATION

| # | Risque | Fait | Consigne |
|---|---|---|---|
| **R1** | **`:root{--de-pad:16px}` dans une container query** (`dish-editor.html:144`) | `:root` (html) est un **ancêtre** du container `.stage` : une `@container` ne peut cibler qu'un **descendant** → **cette règle ne s'applique JAMAIS**, même dans la référence. Le padding 16 px de la feuille mobile est une **intention de contrat** (§4), pas un rendu du HTML. | Définir `--de-pad` **sur `.de-modal`** et le surcharger dans `@media (max-width:560px)` sur ce même sélecteur. Ne jamais écrire de `:root` dans `menu.css`. |
| **R2** | **Copier les container queries** | La référence utilise `container-type:inline-size` sur `.stage` — un artefact de son banc de prévisualisation. La modale produit est `position:fixed`, sans container ancêtre. | **Vraies `@media` viewport** aux seuils **900 px** et **560 px** (§2.4). |
| **R3** | **`min-height:900px` en mobile** (`:142`) | Artefact de banc (forcer une feuille haute dans la page de démo). Reproduit tel quel, il crée une feuille plus haute que le viewport → double scroll et pied non collant. | Feuille = `height:100dvh; max-height:none; border-radius:0` + backdrop `padding:0`, scroll interne. |
| **R4** | **Restyler les classes `op-*` partagées** | `menu.css` est un import **global** ; `.op-field/.op-chips/.op-chip.allergen/.op-labels/.op-label-tile/.op-callout/.op-modal*/.photo-upload/.avail-row` sont utilisées par le **Scan IA** (hors périmètre), les modales Catégorie/Suppression et `supplier/catalog`. | **Nouvelles classes `de-*`** exclusivement (préfixe vérifié libre). Les `op-*` restent inchangées. |
| **R5** | **Le texte du bandeau d'erreur** | La référence affiche `Photo invalide (format ou taille)…` = `menu.photo.err400`. C'est le **PRODUCT GAP** « erreur 400 affichée avec le texte photo », **non corrigé**. | Déplacer le **rendu** ; **ne pas** changer `mapUploadError`, ni la clé, ni ajouter de message par champ, ni `aria-invalid`. |
| **R6** | **`role="button" tabIndex=0` sur la tuile photo** | La référence (`:179`) la rend focusable **sans gestionnaire clavier** → contrôle focusable non actionnable. | Reproduire la référence **telle quelle** ; ajouter un `onKeyDown` serait une **interaction nouvelle** hors contrat → à arbitrer par le parent, pas par l'implémenteur. |
| **R7** | **`aria-modal="true"` sans piège de focus** | Le contrat §8 l'exige ; le produit n'a ni focus trap ni gestion d'`Escape` (handoff PART 6.3). | Poser `role="dialog" aria-modal="true" aria-labelledby` (attributs seuls). **Ne pas** ajouter de focus trap ni d'`Escape` (comportements nouveaux). |
| **R8** | **`--op-zest-bd` inexistant** dans `operator-shell.css` | La référence l'utilise pour les allergènes actifs et les tuiles actives. | Ne PAS l'ajouter au shell (hors périmètre) : fallback local sur `.de-modal` + **contrepartie `[data-theme="dark"]` obligatoire** (la référence n'a pas de thème sombre). |
| **R9** | **Thème sombre absent de la référence** | Toute valeur en dur (fond photo `#EDF0F4/#E5E9EF`, `--op-ink`, bords) casse le mode sombre du produit. | Passer par `--op-*` partout où c'est possible ; garder le fond tokenisé existant de `.photo-upload` pour la tuile. |
| **R10** | **`--op-ink` n'existe pas** | La catégorie active en « encre pleine » utilise `--op-ink:#0F2742`. | Utiliser **`--op-chrome-1`** (`#0F2742`, navy permanent clair **et** sombre) — pas `--op-text` (qui devient clair en sombre et rendrait la chip illisible). |
| **R11** | **`--op-focus` .18 vs .16** | Écart de la référence avec le shell. | Garder `var(--op-focus)` du produit ; ne pas redéfinir le token. |
| **R12** | **Reproduire le harnais** (`.demo`, `.stage`, `.wrapm`, `.force-mobile`, `setState/setDev/setDir`, `?state=`, `?device=`) | Ce sont des outils de prévisualisation. | Rien de tout cela dans le produit. Le seul vestige toléré : `data-state="create|edit"` **documentaire**, sans règle CSS de layout attachée. |
| **R13** | **Croire que `.de-row2` doit passer en 1 colonne en mobile** | La référence **réaffirme** `1fr 1fr` à ≤560 (`:147`) et le handoff PART 12.3 prouve que le produit garde déjà 2 colonnes. | Prix + Calories **toujours côte à côte**. |
| **R14** | **Déplacer « Supprimer » près du pied** | Contrat §4 : « au-dessus du slot erreur, jamais adjacent à Enregistrer » ; DOM `:263` **dans le scroll**. | `de-del` reste le **dernier enfant du scroll**. |
| **R15** | **Ajouter le champ « Disponible »** dans la modale | La classe `avail-row` héberge « Best-seller » par héritage historique (handoff PART 10.2) ; la disponibilité vit sur la **ligne de liste**. | Aucun champ hors matrice EXISTS. La nouvelle classe `de-switchrow` lève l'ambiguïté de nommage. |
| **R16** | **Corriger le prix par défaut 0, la double écriture POST+PUT, l'absence de retour SAVED** | **PRODUCT GAPS** — train séparé. | **Interdit** dans ce train. L'aide passive « Supérieur à 0 € » est le seul geste autorisé. |
| **R17** | **Éditer `messages/*.json`** | Ces fichiers contiennent des **clés dupliquées** ; toute re-sérialisation les détruit. | Déclarer les 4 clés en `i18nNeeds` (§1.2) ; l'agent central fusionne par insertion ancrée. |
| **R18** | **Ordre des chips d'allergènes** | La référence liste les 14 chaînes dans l'ordre exact de `ALL_EU`. | Rendre depuis `ALL_EU`, jamais depuis une liste recopiée du HTML. |

---

## 7 · Récapitulatif des classes à créer (`menu.css`, scope `.gb-op`)

`de-modal` · `de-modal__head` · `de-modal__title` · `de-modal__close` · `de-modal__scroll` ·
`de-modal__err` · `de-modal__foot` · `de-id` · `de-id__f` · `de-photo` · `de-fld` ·
`de-fld__help` · `de-help--block` · `de-inp` · `de-row2` · `de-sec` · `de-chips` · `de-chip` ·
`de-chip--allergen` · `is-cat-on` / `is-on` (modificateurs) · `de-tiles` · `de-tile` ·
`de-switchrow` · `de-del` · `de-btn` · `de-btn--cancel` · `de-btn--save` · `de-spin`
(+ `@keyframes de-spin` ou réutilisation de `op-scan-spin`, déjà défini `menu.css:288`).

Backdrop : réutiliser `.op-modal-backdrop` (fond `rgba(10,18,32,.55)` **déjà conforme**) en lui
ajoutant une surcharge `@media (max-width:560px){padding:0}` — **surcharge ciblée**, à vérifier
sans effet indésirable sur les 2 autres modales de la page (`.op-modal.narrow`), sinon poser un
modificateur `.op-modal-backdrop.de-backdrop`.
