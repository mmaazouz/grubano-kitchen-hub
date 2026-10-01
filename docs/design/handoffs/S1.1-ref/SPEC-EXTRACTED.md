# S1.1 — SPEC EXTRAITE (implémentable) — fiche restaurant + menu consommateur

> **Rôle de ce document** : traduire `restaurant-menu.html` + `CONTRACT.md` en spécification exécutable pour le BUILDER.
> **Surface** : `app/[locale]/eat/r/[id]/page.tsx` (+ `restaurant.css`, `dish-detail.css`).
> **Statut** : extraction en LECTURE SEULE du produit. Aucun fichier produit modifié par S1-SPEC.
>
> **Autorité** : `CONTRACT.md` prime sur le rendu de `restaurant-menu.html` partout où les deux divergent.
> Les divergences prouvées sont listées en **§6** (dont deux bugs de la référence à NE PAS reproduire).

---

## §0 · Méthode et provenance des chiffres

| Source | Usage |
| --- | --- |
| `docs/design/handoffs/S1.1-ref/CONTRACT.md` | contrat écrit, 20 sections — autorité |
| `docs/design/handoffs/S1.1-ref/restaurant-menu.html` | référence rendable (452 lignes) — CSS source cité tel quel |
| Mesure headless Chrome (puppeteer-core, DPR 1, viewports 1440×1000 / 768×1000 / 390×1000, 4 états) | **toutes les valeurs « mesuré »** ci-dessous |
| `app/[locale]/eat/r/[id]/page.tsx` (891 l.), `restaurant.css` (190 l.), `dish-detail.css` (112 l.) | état actuel du produit |
| `app/gb-foundation/gb-tokens.css`, `app/tokens.css` | tokens existants |
| `prisma/schema.prisma`, `app/api/restaurants/[id]/route.ts` | champs réellement disponibles |

Toutes les valeurs marquées **`(src)`** sont copiées littéralement de la feuille de style de la référence ;
celles marquées **`(mesuré)`** proviennent de `getBoundingClientRect()` / `getComputedStyle()` sur le rendu réel.

⚠️ Les coordonnées `y` mesurées sont décalées de la barre `.demo` du harnais (50 px à 1440/768, 91 px à 390).
Ce document n'expose donc que des **tailles, espacements et relations**, jamais des `y` absolus.

---

## §1 · Arbre DOM contractuel (ordre du §2 du contrat)

Convention : `LITTÉRAL` = texte figé (i18n) · `DONNÉE` = champ réel, jamais inventé · `SI` = rendu conditionnel §10.

```
.gb.gb-resto                                   ← racine de page, porte les tokens S1 (§3)
│
├── header.hd  [role implicite banner]         ← collant, 60 px, fond flouté (§4)
│   └── div.hd__in                             ← max-width 1200, padding 0 24
│       ├── button.hd__back   aria-label="Retour"        → <span class="ms">arrow_back</span>
│       ├── span.hd__t                                    DONNÉE restaurant.name (ellipsis)
│       └── div.hd__act
│           ├── button.hd__ic aria-label="Partager"       → <span class="ms">ios_share</span>
│           └── button.hd__ic aria-label="Ajouter aux favoris"
│                                                          → <span class="ms">favorite_border</span>
│                                            (état actif : favorite + aria-pressed="true")
│
├── div.body                                   ← max 1200 · grid `1fr 352px` · gap 28
│   │
│   ├── div  (colonne principale, sans classe dans la réf.)
│   │   │
│   │   ├── div.hero                           ← §5
│   │   │   ├── div.hero__img                  DONNÉE coverPhoto — SINON trame diagonale (pas de photo inventée)
│   │   │   ├── div.hero__veil                 (voile dégradé, décoratif)
│   │   │   └── div.hero__id
│   │   │       ├── div.hero__nm
│   │   │       │   ├── h1                     DONNÉE restaurant.name
│   │   │       │   └── div.hero__meta
│   │   │       │       ├── span.it            <span class="ms">restaurant</span> DONNÉE cuisine[0]
│   │   │       │       ├── span.sep           (point 4 px, décoratif)
│   │   │       │       ├── span.it            <span class="ms">place</span> DONNÉE city
│   │   │       │       ├── span.sep
│   │   │       │       └── span.it  SI coords ← <span class="ms">near_me</span>
│   │   │       │                                 LITTÉRAL « à env. {distance} »   ⚠️ §3 règle 3
│   │   │       └── span.badge-open            <i></i> + DONNÉE état d'ouverture (« Ouvert »)
│   │   │
│   │   ├── div.modes  role="group" aria-label="Mode de service"     ← §6
│   │   │   ├── button.mode.is-on  aria-pressed="true"
│   │   │   │     <span class="ms">storefront</span>
│   │   │   │     <span><b>Click & collect</b><span>À récupérer sur place</span></span>
│   │   │   └── button.mode        aria-pressed="false"
│   │   │         <span class="ms">table_restaurant</span>
│   │   │         <span><b>Sur place</b><span>À consommer au restaurant</span></span>
│   │   │   ⛔ AUCUNE carte Livraison, AUCUNE icône two_wheeler / pedal_bike quand delivery OFF
│   │   │   ✓ actif = bord + fond zest **+ « ✓ » après le libellé** (`.mode.is-on b::after`)
│   │   │
│   │   ├── nav.cats  aria-label="Catégories du menu"                ← §7, collante top:60
│   │   │   ├── button.cat.is-on   LITTÉRAL « Tout »
│   │   │   └── button.cat …       DONNÉE category (une par catégorie réelle)
│   │   │
│   │   ├── div.sec-h    (une par section)
│   │   │   ├── h2                 DONNÉE nom de catégorie
│   │   │   └── span               DONNÉE compte réel « 1 plat » / « N plats »
│   │   │
│   │   ├── div.dishes             (grille 2 col ≥ seuil, 1 col en dessous)
│   │   │   └── button.dish        ← la carte ENTIÈRE ouvre la modale (§8)
│   │   │       ├── div.dish__m
│   │   │       │   ├── h3                     DONNÉE dish.name
│   │   │       │   ├── span.dish__al  SI allergens.length>0
│   │   │       │   │     <span class="ms">info</span> LITTÉRAL « Allergènes : » + DONNÉE join(' · ')
│   │   │       │   └── div.dish__p            DONNÉE prix formaté « 14,50 € »
│   │   │       └── div.dish__ph               DONNÉE photo — SINON trame + fallback
│   │   │           ├── div.fb  <span class="ms">restaurant</span>   (si pas de photo)
│   │   │           └── span.dish__add  aria-hidden  <span class="ms">add</span>
│   │   │               ⚠️ SPAN, pas un <button> (pas de bouton imbriqué dans .dish)
│   │   │
│   │   └── section.about                                            ← §12, DÉPLIÉE par défaut
│   │       ├── div.about__h   <h2>À propos</h2> <span class="ms">expand_less</span>
│   │       └── div.about__b   (grid 1fr 1fr desktop)
│   │           ├── div
│   │           │   ├── p.about__desc      SI description non vide → DONNÉE
│   │           │   ├── div.about__addr    <span class="ms">place</span> DONNÉE « adresse, ville »
│   │           │   └── a.about__map       LITTÉRAL « Ouvrir dans Plans » + ms open_in_new
│   │           └── div.hours
│   │               ├── div.hours__now     ms schedule + LITTÉRAL « Ouvert aujourd'hui · » + DONNÉE plage
│   │               └── div.hrow ×7        DONNÉE jour + plages (`.today` = jour courant)
│   │
│   └── aside.cart  aria-label="Votre commande"                      ← §9, collant top:84
│       ├── div.cart__h    <h2>Votre commande</h2> <span class="n">DONNÉE « N article(s) »</span>
│       ├── div.cart__mode ms storefront + DONNÉE « {mode} · {nom du restaurant} »
│       ├── div.cart__b
│       │   ├── div.cart__empty         SI panier vide
│       │   │     <span class="ms">shopping_bag</span>
│       │   │     <b>Votre panier est vide</b>
│       │   │     <p>Ajoutez un plat du menu pour commencer.</p>
│       │   └── div.ci …                SI panier non vide (une par ligne réelle)
│       │         div.ci__ph (vignette) · div.ci__m > b DONNÉE nom · .pr DONNÉE prix
│       │         div.qty > button aria-label="Retirer un" / <span>DONNÉE qty</span> /
│       │                   button aria-label="Ajouter un"
│       └── div.cart__f
│           ├── div.tot        <span>Sous-total</span><span class="v">DONNÉE total</span>
│           ├── div.tot__note  LITTÉRAL « À régler au retrait. Aucun frais ajouté. »  ⚠️ §3 règle 2
│           └── button.btn-go  ms arrow_forward + LITTÉRAL « Voir le panier »
│                              (attribut `disabled` quand le panier est vide)
│
├── div.mbar                                    ← barre panier mobile (≤ seuil mobile) §9
│   └── button.btn-go  [disabled si vide]
│         <span>« Panier vide » | « Voir le panier · N article(s) »</span>
│         <span>DONNÉE total</span>
│
└── div.ov  (overlay modale, monté seulement quand un plat est ouvert)
    └── div.pm  role="dialog" aria-modal="true" aria-labelledby="pmT"
        ├── div.pm__ph                 DONNÉE photo du plat — SINON trame
        │   └── button.pm__x  aria-label="Fermer"  <span class="ms">close</span>
        ├── div.pm__b                  (corps défilant)
        │   ├── div.pm__t   <h2 id="pmT">DONNÉE name</h2> <span class="pr">DONNÉE prix</span>
        │   ├── p.pm__desc       SI description non vide          ← ORDRE IMPOSÉ §10
        │   ├── div.pm__labels   SI labels.length > 0
        │   │     span.pm__lab ×N : <span class="ms">{icône du label}</span> DONNÉE label
        │   ├── span.pm__kcal    SI calories non null
        │   │     <span class="ms">local_fire_department</span> DONNÉE « {n} kcal »
        │   ├── div.alg          TOUJOURS (vide ⇒ .alg--none)     ← bloc PRIORITAIRE §11
        │   │   ├── div.alg__h   <span class="ms">warning</span> « Allergènes » (uppercase CSS)
        │   │   ├── div.alg__l   span.alg__i ×N : ms check_circle + DONNÉE allergène (verbatim)
        │   │   └── p.alg__n     LITTÉRAL « Renseignés par le restaurant. En cas de doute,
        │   │                                demandez confirmation sur place. »
        │   └── div.note-f       <label for>Ajouter une note</label> <textarea placeholder…>
        └── div.pm__f
            ├── div.qty          (steppers labellisés, cf. panier)
            └── button.btn-go    <span>Ajouter au panier</span><span>DONNÉE prix × qty</span>
```

**Ordre de lecture = ordre DOM** (§19). Les trois blocs conditionnels description / labels / calories
sont **après** `.pm__t` (nom + prix) et **avant** `.alg` — aucun ne peut précéder le prix.
La saillance décroît strictement : `.alg` (bloc encadré zest) > `.pm__labels` (pastilles) > `.pm__kcal` (ligne de texte).

---

## §2 · Mesures aux 3 largeurs, avec sélecteur CSS source

### 2.1 Invariants (identiques aux 3 largeurs)

| Élément | Valeur | Source |
| --- | --- | --- |
| Hauteur header | **60 px** (mesuré 60,00) | `.hd{height:60px}` |
| Header fond | `rgba(251,248,243,.9)` + `backdrop-filter:blur(12px)` + `border-bottom:1px solid var(--gb-border)` | `.hd` |
| Header sticky | `position:sticky; top:0; z-index:40` | `.hd` |
| Cibles header | **38 × 38** px, `border-radius:12px`, `border:1px solid var(--gb-border-2)`, `background:var(--gb-surface)` ; `.ms` 20 px | `.hd__back`, `.hd__ic` |
| Titre header | 17 px / 800, Gabarito, `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` | `.hd__t` |
| Chip catégorie | **hauteur 38 px** (mesuré 38,00), `padding:0 16px`, `border-radius:999px`, 13,5 px / 700 | `.cat` |
| Chip actif | `background:var(--gb-ink); border-color:var(--gb-ink); color:#fff` | `.cat.is-on` |
| Nav catégories | `position:sticky; top:60px; z-index:30; padding:12px 0; gap:8px; margin-bottom:6px; overflow-x:auto` (scrollbar masquée) — hauteur totale **62 px** | `.cats` |
| Fond nav catégories | `linear-gradient(180deg,var(--gb-bg) 70%,rgba(251,248,243,0))` | `.cats` |
| CTA principal | **hauteur 50 px**, `border-radius:12px`, dégradé `--gb-sunrise`, 15 px / 800, gap 9, `box-shadow:0 8px 22px -10px rgba(242,87,14,.55)` | `.btn-go` |
| CTA désactivé | `background:var(--gb-border-2); color:var(--gb-muted); box-shadow:none; cursor:not-allowed` | `.btn-go[disabled]` |
| Stepper | **96 × 36** px : `padding:2px`, `gap:2px`, `border:1px solid var(--gb-border-2)`, `border-radius:999px` ; boutons **30 × 30** ronds, `.ms` 18 px ; compteur `min-width:26px`, 14 px / 800, `tabular-nums` | `.qty`, `.qty button`, `.qty span` |
| Anneau de focus | `box-shadow:0 0 0 3px rgba(255,106,31,.2)` + `outline:none` | `button:focus-visible,a:focus-visible,textarea:focus-visible` |
| Ombre sh-1 | `0 1px 2px rgba(15,39,66,.04), 0 2px 8px rgba(15,39,66,.05)` | `--gb-sh-1` (cartes plat, À propos) |
| Ombre sh-2 | `0 2px 8px rgba(15,39,66,.06), 0 14px 34px -16px rgba(15,39,66,.16)` | `--gb-sh-2` (hero, panier) |
| Ombre modale | `0 32px 80px -24px rgba(4,10,20,.55)` | `.pm` |
| Rayons | sm 8 · md 12 · lg 18 · xl 26 · pill 999 | `:root` de la référence |
| Trames « sans photo » | hero/modale `repeating-linear-gradient(135deg,#EFE7DA 0 16px,#E8DFCF 16px 32px)` · vignette plat `… 0 12px, 12px 24px` · vignette panier `… 0 10px, 10px 20px` | `.hero__img`, `.pm__ph`, `.dish__ph`, `.ci__ph` |

### 2.2 — 1440 px (desktop)

| Nœud | Mesuré | Source CSS |
| --- | --- | --- |
| `.hd__in` | largeur **1200**, `padding:0 24px`, `gap:14px` | `.hd__in{max-width:var(--s1-max);padding:0 24px}` |
| `.body` | largeur **1200**, `padding:24px 24px 96px`, `grid-template-columns:772px 352px`, `column-gap:28px`, `row-gap:28px`, `align-items:start` | `.body{max-width:var(--s1-max);grid-template-columns:1fr var(--s1-cart);gap:var(--s1-gap)}` |
| `.hero` | **772 × 294,09**, ratio **21/8**, `border-radius:26px`, `margin-bottom:20px`, ombre sh-2 | `.hero`, `.hero__img{aspect-ratio:21/8}` |
| `.hero__id` | `padding:22px 24px`, `gap:16px`, ancré bas | `.hero__id` |
| `h1` du hero | **32 px** / 800, `#fff`, `letter-spacing:-.025em` (= −0,8 px) | `.hero__nm h1` |
| `.hero__meta .it` | 13 px / 600, `rgba(255,255,255,.92)`, `gap:5px`, `.ms` 16 px ; `.sep` = point 4 px `rgba(255,255,255,.5)` | `.hero__meta` |
| `.badge-open` | **76,83 × 28,75**, `padding:5px 12px`, 12,5 px / 800, pill, `background:#2BA45C`, point `<i>` 7 px blanc | `.badge-open` |
| `.modes` | `gap:10px`, `margin-bottom:18px` ; chaque `.mode` = **381 × 63**, `flex:1`, `min-width:150px`, `padding:13px 16px`, `border-radius:18px`, **`border:1.5px solid var(--gb-border-2)`** | `.modes`, `.mode` |
| `.mode` contenu | `.ms` 22 px · `<b>` 14 px / 700 · sous-titre 12 px muted | `.mode .ms`, `.mode b`, `.mode span` |
| `.mode.is-on` | `border-color:var(--gb-zest)`, `background:var(--gb-zest-bg)`, `.ms` → `--gb-zest-600`, `b::after{content:" ✓"}` | `.mode.is-on` |
| `.sec-h` | `margin:20px 0 12px`, `gap:10px` ; `h2` 21 px / 800 ; `span` 13 px / 600 `--gb-muted-2` | `.sec-h` |
| `.dishes` | **2 colonnes de 379 px**, `gap:14px` (379 + 14 + 379 = 772) | `.dishes{grid-template-columns:1fr 1fr}` |
| `.dish` | **379 × 134**, `padding:14px`, `gap:14px`, `border-radius:18px`, `border:1px solid var(--gb-border)`, ombre sh-1 ; hover `border-color:var(--gb-zest-bd)` + `translateY(-1px)` | `.dish`, `.dish:hover` |
| `.dish__m h3` | 16 px / 800 | `.dish__m h3` |
| `.dish__al` | hauteur 21, `margin-top:6px`, 11,5 px / 700, `padding:3px 9px`, pill, `background:var(--gb-surface-2)`, `.ms` 14 px | `.dish__al` |
| `.dish__p` | `margin-top:auto`, `padding-top:10px`, **17 px / 800** Gabarito | `.dish__p` |
| `.dish__ph` | **104 × 104**, `border-radius:12px` ; fallback `.fb .ms` 32 px `#C7B9A2` | `.dish__ph` |
| `.dish__add` | **32 × 32** rond, dégradé sunrise, `border:2px solid var(--gb-surface)`, `inset-block-end:6px; inset-inline-end:6px`, `.ms` 18 px, ombre `0 4px 12px -4px rgba(242,87,14,.6)` | `.dish__add` |
| `.about` | `margin-top:28px`, `border-radius:18px`, ombre sh-1 ; `.about__h` `padding:16px 20px`, `h2` 17 px / 800, chevron `.ms` 20 px poussé par `margin-inline-start:auto` | `.about`, `.about__h` |
| `.about__b` | **2 colonnes de 353 px**, `gap:24px`, `padding:20px` | `.about__b{grid-template-columns:1fr 1fr}` |
| Textes À propos | desc 14,5 px / 1.6 muted · adresse `margin-top:14px`, 14 px / 600, `.ms` 19 px zest-600 · lien Plans `margin-top:12px`, 13 px / 700 zest-600, `.ms` 17 px | `.about__desc`, `.about__addr`, `.about__map` |
| `.hours__now` | `padding:11px 14px`, 13,5 px / 700, `background:#E8F6EE`, `border-bottom:1px solid #C9E9D6`, `color:#1E8A4A`, `.ms` 18 px | `.hours__now` |
| `.hrow` | `padding:8px 14px`, 13 px, séparateur 1 px (sauf dernier) ; `.today` `background:var(--gb-surface-3)` + 700 ; heures `tabular-nums` | `.hrow`, `.hrow.today` |
| `.cart` | **352 px** de large, `position:sticky; top:84px`, `border-radius:18px`, ombre sh-2 | `.cart{position:sticky;top:84px}` |
| Sous-blocs panier | `.cart__h` `padding:16px 18px` (h2 16/800, `.n` 12,5/700 muted) · `.cart__mode` `padding:10px 18px`, 12,5/700, `background:var(--gb-zest-bg)`, `border-bottom:1px solid var(--gb-zest-bd)`, `.ms` 17 · `.cart__b` `padding:16px 18px`, **`min-height:190px`** · `.cart__f` `padding:16px 18px`, `background:var(--gb-surface-3)`, `border-top` | `.cart__*` |
| `.cart__empty` | `padding:26px 4px`, `.ms` 38 px `--gb-border-2`, `<b>` 15,5/800 Gabarito `margin-top:10px`, `<p>` 13 px muted `margin-top:5px` | `.cart__empty` |
| `.ci` | `gap:12px` ; `.ci__ph` **52 × 52** radius 8 ; `.ci__m b` 14/700 ; `.pr` 13,5/800 Gabarito `margin-top:2px` ; `.qty` `margin-top:9px` | `.ci` |
| `.tot` / `.tot__note` | 14 px / 700 ; valeur 19 px / 800 Gabarito ; note 11,5 px `--gb-muted-2` `margin-top:6px` | `.tot`, `.tot__note` |
| `.btn-go` du panier | **314 × 50** (352 − 2×18 padding − 2×1 bordure), `margin-top:14px` | `.cart__f .btn-go` |
| `.mbar` | `display:none` | `@container … (>560)` |

**Modale (1440)**

| Nœud | Mesuré | Source |
| --- | --- | --- |
| `.ov` | `position:fixed; inset:0; z-index:70`, `background:rgba(15,39,66,.55)`, `padding:24px`, `align-items:center; justify-content:center` | `.ov` |
| `.pm` | **520** de large, `max-height:88vh` (mesuré 880 px @1000), `border-radius:26px` | `.pm{width:520px;max-height:88vh}` |
| `.pm__ph` | **520 × 292,5** — ratio **16/9** | `.pm__ph{aspect-ratio:16/9}` |
| `.pm__x` | **38 × 38** rond, `top:14px; inset-inline-start:14px`, `background:rgba(255,255,255,.94)`, `.ms` 20 px | `.pm__x` |
| `.pm__b` | `padding:22px 24px`, `overflow-y:auto`, `flex:1` | `.pm__b` |
| `.pm__t` | `gap:14px` ; `h2` **24 px / 800** ; `.pr` **22 px / 800** Gabarito `#F2570E`, `white-space:nowrap` | `.pm__t` |
| `.pm__desc` | `margin-top:12px`, **14,5 px**, `line-height:1.6` (23,2 px), `--gb-muted` | `.pm__desc` |
| `.pm__labels` | `margin-top:14px`, `gap:7px` ; `.pm__lab` `padding:4px 11px`, 12,5/700, pill, basil-bg/basil-bd/basil-600, `.ms` 15 px | `.pm__labels`, `.pm__lab` |
| `.pm__kcal` | `margin-top:12px`, 13 px / 600, `--gb-muted-2`, `gap:6px`, `.ms` 16 px | `.pm__kcal` |
| `.alg` | largeur **472** (520 − 48), hauteur 118, `margin-top:18px`, `padding:14px 16px`, `border-radius:12px`, `background:#FFF1E7`, `border:1px solid #F8D3BC` | `.alg` |
| `.alg__h` | 13 px / 800, `text-transform:uppercase`, `letter-spacing:.05em` (0,65 px), `#F2570E`, `.ms` 18 px (`warning`) | `.alg__h` |
| `.alg__i` | hauteur 32,25, `padding:5px 12px`, 13,5 px / 700, pill, `background:var(--gb-surface)`, `border:1px solid var(--gb-zest-bd)`, `.ms` 15 px `#F2570E` (`check_circle`) ; liste `margin-top:10px; gap:8px` | `.alg__i`, `.alg__l` |
| `.alg__n` | `margin-top:9px`, 11,5 px, `--gb-muted` | `.alg__n` |
| `.note-f` | `margin-top:18px` ; label 12,5/700 `margin-bottom:6px` ; textarea **min-height 74**, `padding:11px 13px`, radius 12, `background:var(--gb-surface-3)`, `border:1px solid var(--gb-border-2)`, 14 px, `line-height:1.5`, `resize:vertical` | `.note-f` |
| `.pm__f` | `padding:14px 24px`, `gap:12px`, `border-top:1px solid var(--gb-border)`, `flex-shrink:0` ; CTA **364 × 50** (`flex:1`, `justify-content:space-between`, `padding:0 18px`) | `.pm__f` |

### 2.3 — 768 px (une colonne)

Déclencheurs : `@container s1 (max-width:1080px)` puis `(max-width:900px)`.

| Nœud | Mesuré | Écart vs 1440 | Source |
| --- | --- | --- | --- |
| `.hd__in` | largeur 768, `padding:0 24px` | plus de centrage (768 < 1200) | — |
| `.body` | largeur 768, **`grid-template-columns:720px` (1 colonne)**, `padding:24px` | `padding-bottom` 96 → **24** | `@container (max-width:900px){.body{grid-template-columns:1fr;padding-bottom:24px}}` |
| `.hero` | **720 × 274,28**, toujours **21/8**, radius 26 | ratio inchangé (16/9 seulement ≤560) | — |
| `h1` du hero | **26 px** | 32 → 26 | `@container (max-width:900px){.hero__nm h1{font-size:26px}}` |
| `.modes` | 2 cartes de **355** | sous-titres **toujours visibles** | — |
| `.dishes` | **1 colonne de 720** | 2 → 1 | `@container (max-width:1080px){.dishes{grid-template-columns:1fr}}` |
| `.about__b` | **1 colonne (678)**, `gap:18px` | 2 → 1, gap 24 → 18 | `@container (max-width:900px){.about__b{grid-template-columns:1fr;gap:18px}}` |
| `.cart` | **`position:static`, `order:2`, largeur 720 (pleine colonne)** | ⚠️ **PAS 312 px** — voir §6.1 | `@container (max-width:900px){.cart{position:static;order:2}}` |
| `.about` | `order:3` → passe **après** le panier | ordre menu → panier → À propos | `@container (max-width:900px){.about{order:3}}` |
| `.mbar` | `display:none` | — | — |
| `.pm` | **560** de large | 520 → 560 | `@container (max-width:900px){.pm{width:560px}}` |
| `.pm` reste | `max-height:88vh`, `padding` `.pm__b` 22/24, `h2` 24 px | inchangé | — |

### 2.4 — 390 px (mobile)

Déclencheur : `@container s1 (max-width:560px)` (en plus des deux précédents).

| Nœud | Mesuré | Source |
| --- | --- | --- |
| Gouttières | `.hd__in` et `.body` `padding-inline:**16px**` | `@container (max-width:560px){.hd__in,.body{padding-inline:16px}}` |
| `.body` | `padding:16px 16px 8px`, 1 colonne de **358** | `.body{padding-top:16px;padding-bottom:8px}` |
| `.hero` | **358 × 201,38** — ratio **16/9**, `border-radius:18px` (lg), `margin-bottom:16px` | `.hero{border-radius:var(--gb-r-lg);margin-bottom:16px}` + `.hero__img{aspect-ratio:16/9}` |
| `.hero__id` | `padding:16px` | `.hero__id{padding:16px}` |
| `h1` du hero | **23 px** | `.hero__nm h1{font-size:23px}` |
| `.hero__meta` | passe sur **2 lignes** (type · ville, puis distance) ; badge Ouvert reste aligné à droite | `flex-wrap:wrap` |
| `.mode` | `padding:11px 13px`, `min-width:0` → **174** de large | `.mode{min-width:0;padding:11px 13px}` |
| Sous-titres de mode | **doivent être masqués — l'icône et le libellé RESTENT** | ⚠️ bug de la référence, voir §6.2 |
| `.cats` | `top:60px` (inchangé) | `.cats{top:60px}` |
| `.dish__ph` | **88 × 88** | `.dish__ph{width:88px;height:88px}` |
| `.cart` | **`display:none`** (`order:9`) | `.cart{order:9;display:none}` |
| `.mbar` | **`display:block`**, hauteur **75** (12 + 50 + 12 + bordure), `position:sticky; bottom:0; z-index:45`, `padding:12px 16px calc(12px + env(safe-area-inset-bottom))`, `background:rgba(251,248,243,.95)` + blur 12, `border-top` ; bouton `justify-content:space-between; padding:0 18px` | `.mbar`, `.mbar .btn-go` |
| `.ov` | `padding:0`, `align-items:flex-end` (feuille montante) | `.ov{padding:0;align-items:flex-end}` |
| `.pm` | largeur **100 % (390)**, **`max-height:94vh`** (mesuré 940 @1000), `border-radius:26px 26px 0 0` | `.pm{width:100%;max-height:94vh}` |
| `.pm__b` | `padding:18px 16px`, **`overscroll-behavior:contain`**, `-webkit-overflow-scrolling:touch` | `.pm__b` |
| `.pm__f` | `padding:12px 16px calc(12px + env(safe-area-inset-bottom))` ; CTA **250 × 50** (390 − 32 − 96 − 12) | `.pm__f` |
| `.pm__t h2` | **20 px** | `.pm__t h2{font-size:20px}` |
| `.pm__desc` | **14 px** | `.pm__desc{font-size:14px}` |
| Débordement horizontal | **aucun** (mesuré : `scrollWidth === clientWidth` à 390, 768 et 1440) | — |

---

## §3 · Tokens — correspondance avec le produit

Tokens du produit lus dans `app/gb-foundation/gb-tokens.css` (portée `.gb`) et `app/tokens.css` (`:root`, noms `--zest-*`, non `--gb-*`).

### 3.1 Identiques — réutiliser tels quels

`--gb-zest` `#FF6A1F` · `--gb-zest-600` `#F2570E` · `--gb-basil` `#2BA45C` · `--gb-ink` `#0F2742` ·
`--gb-bg` `#FBF8F3` · `--gb-surface` `#FFFFFF` · `--gb-border` `#ECE5D8` · `--gb-text` `#0F2742` ·
`--gb-r-sm` 8 · `--gb-r-md` 12 · `--gb-r-pill` 999.

### 3.2 ⚠️ Noms identiques, VALEURS DIFFÉRENTES — ne JAMAIS redéfinir globalement

| Token | Référence S1 | Produit `.gb` | Conséquence si redéfini sur `.gb` |
| --- | --- | --- | --- |
| `--gb-r-lg` | **18 px** | **16 px** | casse tous les écrans conso (`.cr`, `.about`, cartes) |
| `--gb-r-xl` | **26 px** | **20 px** | casse `.gb-dish .dish` (modale partagée) et le hero actuel |
| `--gb-muted` | `#5A6672` | `#6B7682` | teinte de tout le texte secondaire de l'app |
| `--gb-muted-2` | `#6B7682` | `#9C7B5C` (brun) | régression visible partout |
| `--gb-surface-2` | `#F5EFE6` | `#FBF8F3` | fonds de champs / chips de toute l'app |
| `--gb-basil-600` | `#1E8A4A` | `#1E9E57` | badges de succès |
| `--gb-focus` | `…rgba(255,106,31,**.2**)` | `….16` | anneau de focus global |
| `--gb-sunrise` | `linear-gradient(**140deg**,#FFB020,#FF6A1F 55%,#F2570E)` | `linear-gradient(**130deg**,…)` | tous les CTA |

**Règle imposée** : déclarer ces valeurs **uniquement sur la racine de page** `.gb-resto`, jamais sur `.gb`.
Précédent déjà en place dans le dépôt : `app/[locale]/eat/order/[orderId]/pickup/pickup.css:33`
(`.gb-pickup{ --gb-basil-bg:#EAF7EF; --gb-basil-bd:#CDEBD8 }`) et `app/[locale]/eat/dietary/dietary.css:24`.
Pour les 8 tokens ci-dessus, préférer des **noms neufs `--s1-*`** (aucun risque d'héritage vers un
composant partagé rendu à l'intérieur : `FoodImage`, `CreatorBadge`, toasts…).

### 3.3 Absents du produit — à déclarer (portée `.gb-resto`)

| Token | Valeur | Déjà utilisé ailleurs ? |
| --- | --- | --- |
| `--gb-zest-bg` | `#FFF1E7` | oui, en dur dans `dish-detail.css:86` et redéclaré par 6 CSS de landing |
| `--gb-zest-bd` | `#F8D3BC` | non |
| `--gb-basil-bg` | `#E8F6EE` | redéclaré par 6 CSS ; **référencé sans définition** par `restaurant.css:103` (règle morte, cf. §5.4) |
| `--gb-basil-bd` | `#C9E9D6` | idem |
| `--gb-surface-3` | `#FAF6F0` | non |
| `--gb-border-2` | `#E0D6C4` (≠ `--gb-border-strong` `#E2D9CC`) | redéclaré par 6 CSS de landing |
| `--gb-ink-2` | `#1B3A5E` (≈ `--gb-ink-700` `#16395A`) | — |
| `--gb-sh-1` / `--gb-sh-2` | cf. §2.1 (≠ `--gb-shadow-card`) | non |
| `--s1-max` / `--s1-cart` / `--s1-gap` | 1200 / 352 / 28 | non |

### 3.4 Renommages

| Référence | Produit |
| --- | --- |
| `--gb-display` | `--gb-font-display` (`'Gabarito',system-ui,sans-serif`) |
| `--gb-ui` | `--gb-font-ui` (`'Hanken Grotesk',system-ui,sans-serif`) |

Polices : **auto-hébergées** via `app/brand-fonts.css` — ne PAS reprendre les `<link>` Google Fonts
de la référence (fiche mémoire « TYPO SELF-HOST » : les `@import` bundlés ne se chargent jamais en prod).
Material Symbols : déjà chargé par `app/gb-foundation/material-symbols.css` ; utiliser `.ms` (déjà
`font-family:'Material Symbols Rounded' !important` sous `.gb`).

### 3.5 Valeurs en dur sans équivalent (à conserver telles quelles, scopées)

`#C7B9A2` (glyphe de la vignette vide) · `#EFE7DA`/`#E8DFCF` (trames) · `rgba(255,255,255,.92)` et
`rgba(255,255,255,.5)` (méta du hero sur voile) · `rgba(15,39,66,.55)` (fond d'overlay) ·
`0 4px 12px -4px rgba(242,87,14,.6)` (ombre du `+`) · `0 32px 80px -24px rgba(4,10,20,.55)` (ombre modale) ·
voile `linear-gradient(180deg,rgba(15,39,66,0) 38%,rgba(15,39,66,.72) 100%)`.

### 3.6 Thème sombre — non couvert par la référence

La référence est **light-only**. Le produit définit un thème sombre pour tous les `--gb-*` sous
`[data-theme="dark"] .gb`. Chaque nouveau token `--s1-*` doit recevoir son équivalent sombre
(convention déjà appliquée partout dans le dépôt), sinon la page devient illisible en sombre.
**Arbitrage requis** (§7-D6).

---

## §4 · Les 3 états contractuels (+ la démo de composant)

Le seul commutateur DOM de la référence est `data-state` sur `.page`. En production, ces états
ne sont **pas** des modes : ce sont les conséquences de deux données réelles — *le panier a-t-il des
lignes ?* et *un plat est-il ouvert ?*.

| | `empty` | `cart` | `product` |
| --- | --- | --- | --- |
| Déclencheur réel | panier vide | ≥ 1 ligne | `modalDish != null` (panier au même état que `cart`) |
| `.cart__empty` | `display:block` | `display:none` | `display:none` |
| `.ci` (ligne) | `display:none` | `display:flex` | `display:flex` |
| `.cart__h .n` | « 0 article » | « 1 article » | « 1 article » |
| `.tot .v` | « 0,00 € » | « 14,50 € » | « 14,50 € » |
| `.btn-go` (panier) | `disabled` | actif | actif |
| `.mbar .btn-go` | `disabled`, « Panier vide » / « 0,00 € » | actif, « Voir le panier · 1 article » / « 14,50 € » | idem `cart` |
| `.ov` | `display:none` | `display:none` | `display:flex` |
| `.pm__desc` / `.pm__labels` / `.pm__kcal` | — | — | **absents** (champs réellement vides du Risotto rehearsal) |
| `.alg` | — | — | **présent** : Lactose · Céleri |
| `.pm__demo` | — | — | `display:none` |

**Note** : la fermeture de la modale dans la référence renvoie à `cart` (`onclick="setState('cart')"`)
parce que l'ajout est simulé. En production, **fermer ≠ ajouter** : `.pm__x` et le clic sur le fond
ferment sans rien ajouter ; seul `.pm__f .btn-go` ajoute.

### `product-full` — DÉMO DE COMPOSANT, NE PAS IMPLÉMENTER

`product-full` n'est **pas** un état produit. Il n'existe que pour montrer le rendu conditionnel de
`DishDetailModal` lorsque les 4 champs optionnels sont renseignés. Il est coiffé du bandeau
`.pm__demo` (`background:var(--gb-ink)`, `padding:9px 24px`, 11,5 px / 800, uppercase, `.ms science`) :
« Design demo data — valeurs de démonstration, pas les données de Risotto rehearsal ».

**Interdits absolus qui en découlent** :
- ⛔ aucune route, aucun bouton, aucun `?state=`, aucun flag runtime `product-full` ;
- ⛔ la description « Risotto crémeux au parmesan, cuit minute, finition huile d'olive et poivre du
  moulin. », les labels « Veggie » / « Sans gluten » et « 650 kcal » **ne doivent jamais être écrits
  dans l'application** (ni seed, ni fixture, ni valeur par défaut, ni storybook livré) ;
- ⛔ `.pm__demo` n'est pas porté en production (aucun bandeau de démo dans le produit) ;
- ⛔ `product-full` est **hors comparaison** Puppeteer.

Ce qu'il faut en retenir — et **seulement** cela : l'ordre `photo → nom+prix → description → labels →
calories → allergènes → note → stepper+CTA`, et le fait que chaque bloc **disparaît** quand la donnée
est absente (le suivant remonte, sans placeholder ni espace réservé).

---

## §5 · DIFF vs le produit actuel

Fichiers concernés : `app/[locale]/eat/r/[id]/page.tsx`, `app/[locale]/eat/r/[id]/restaurant.css`,
`app/[locale]/eat/r/[id]/dish-detail.css`.

### 5.1 🔴 Les 3 règles de véracité — où agir exactement

**Règle 1 — FAUX ETA.** `Restaurant.deliveryTime` (défaut schéma **30**) n'est **PAS rendu** sur cette
surface aujourd'hui. Une seule occurrence, non visuelle :

- `page.tsx:272` — `deliveryTime: restaurant.deliveryTime` dans l'objet `cart.restaurant` écrit en
  localStorage par `addLine()`.
  **Ne PAS y toucher** : ce champ est relu par `/eat/cart` (`cart/page.tsx:457`, `:621`, `:757` →
  « ~N min », « prêt vers … ») et par `/eat/orders`. Le supprimer d'ici casserait le panier.
  ⇒ **Action S1.1 : aucune.** Le champ reste dans le contrat de données du panier, il n'apparaît
  simplement nulle part sur cet écran. *(Le faux ETA de `/eat/cart` est hors périmètre.)*

**Règle 2 — FAUX FRAIS.** `Restaurant.deliveryFee` (défaut schéma **1.99**) **EST rendu** :

- `page.tsx:505-508` — bloc à **SUPPRIMER** intégralement :
  ```tsx
  <span className="ok">
    <span className="ms" aria-hidden="true">pedal_bike</span>
    {restaurant.deliveryFee === 0 ? t('freeDelivery') : formatEuros(restaurant.deliveryFee, locale)}
  </span>
  ```
  C'est exactement le finding : icône deux-roues + « 1,99 € » affichés alors que la livraison est OFF.
- `page.tsx:268` — `deliveryFee: restaurant.deliveryFee` dans `cart.restaurant` : **CONSERVER**
  (relu par `/eat/cart:276` pour le calcul livraison ; supprimer casserait le panier).
- `restaurant.css:63-67` (`.il`, `.il .ok`) — la ligne d'info disparaît en tant que composant ;
  ses deux informations survivantes (cuisine, statut d'ouverture) migrent dans `.hero__meta` /
  `.badge-open`.
- Nouveau : `.tot__note` « À régler au retrait. Aucun frais ajouté. » dans le pied du panier.

**Règle 3 — DISTANCE.** **Aucune distance n'est rendue aujourd'hui sur cette page** (vérifié : aucune
occurrence de `distanceKm` / `formatDistance` dans `app/[locale]/eat/r/[id]/`). Il n'y a donc **pas de
wording à corriger, mais un affichage à créer**, à partir de données réelles déjà disponibles :

- `GET /api/restaurants/[id]` renvoie déjà `restaurant.lat` / `restaurant.lng`
  (`app/api/restaurants/[id]/route.ts:280-281`) — non typés côté client (`RestaurantInfo`, `page.tsx:51-65`) ;
- position utilisateur : `lib/use-geolocation.ts` (`useGeolocation()` → `coords {lat,lng,capturedAt,label}`,
  cache localStorage `grubano_geo`, TTL 7 j). **Ne jamais appeler `request()`** depuis cette page :
  lecture passive du cache uniquement (la géolocalisation est hors périmètre) ;
- calcul : `haversineKm(a,b)` (`lib/geocode.ts:192`). `lib/geocode.ts` embarque aussi le client de
  géocodage IGN → préférer une petite fonction pure locale, comme le fait déjà `lib/courier-tracking.ts:22`
  (« Inlined … to keep this a pure … »), plutôt que d'importer tout `lib/geocode` dans le bundle conso ;
- formatage : `formatDistance(km, locale, tc('km'))` (`lib/format.ts:74`) → « 15,7 km » en FR ;
- wording : `« à env. {distance} »` + `.ms near_me`, **jamais** converti en durée, jamais présenté
  comme distance routière ;
- **rendu conditionnel** : pas de coords utilisateur **ou** `lat/lng` du restaurant à `null`
  ⇒ le `span.it` entier disparaît (ni « — », ni « distance inconnue »). Rappel bêta : 9 restos sur 10
  du staging n'ont pas de coordonnées.

### 5.2 🔴 Deux mensonges supplémentaires trouvés sur la surface (même famille que les 3 findings)

1. **Horaires fabriqués** — `page.tsx:649-654` :
   ```tsx
   {!hours && (<div className="info-row"><span className="ms">schedule</span><span>{t('openingHours')}</span></div>)}
   ```
   avec `messages/fr.json` → `"openingHours": "Lun–Dim : 10h00 – 23h00"`. Quand le restaurateur n'a
   **pas** configuré ses horaires, l'app affiche des horaires **inventés**. À supprimer (§10 : champ
   absent ⇒ bloc absent). Le bandeau « Ouvert aujourd'hui · … » et les 7 lignes ne se rendent que si
   `hours.hoursConfigured === true`.
2. **Photos de plats fabriquées** — `page.tsx:236-241` (`photoFor`) retombe sur
   `getFoodImage(cat, dish.id)` = une **vraie photo Unsplash** (`/images/food/…`, `lib/food-images.ts:169`)
   d'un plat qui n'est pas celui du restaurant ; idem `getRestaurantCover(restaurant.id)` pour le hero
   (`page.tsx:368`). Le contrat impose une **trame diagonale neutre** (§5) et « trame + icône `restaurant` »
   (§8) en l'absence de photo. ⇒ remplacer les fallbacks photo par les trames ; ne garder l'image que
   si `dish.photos[0]` / `restaurant.coverPhoto` existent réellement.

### 5.3 Ce qui doit rester **STRICTEMENT identique** (aucune modification tolérée)

| Zone | Fichier / lignes | Raison |
| --- | --- | --- |
| `readCart` / `writeCart` / `showToast` / `isFav` / `toggleFav` | `lib/eat-cart.ts` (import `page.tsx:11-20`) | contrat panier partagé (`/eat/cart`, `/eat/orders`, shell) |
| `signatureOf` / `lineKeyFor` / `summariseOptions` / `normalizeAllergens` | `page.tsx:120-160` | groupement des lignes + compat des anciens paniers |
| `addLine()` | `page.tsx:251-294` | prix unitaire = `dish.price` exact (acquis LOT 2 « carte honnête ») ; forme de `cart.restaurant` (dont `deliveryFee`/`deliveryTime`) |
| `setLineQty()` | `page.tsx:299-307` | mutation de quantité pure, prix figé à l'ajout |
| `cartCount` / `cartTotal` | `page.tsx:309-310` | — |
| Appel réseau unique `fetch('/api/restaurants/'+id)` + parsing défensif | `page.tsx:198-226` | contrat API ; `hours` additif ; `fulfillment.delivery` (garde V5-2) ; `reservable` (garde V5-1b) |
| Navigation checkout `router.push('/eat/cart')` | `page.tsx:722`, `:744` | chemin argent réel |
| Prix affichés via `formatEuros(...)` | partout | séparateur localisé |
| `itemPromo` / `promotions` **calculés serveur** | `page.tsx:188-189`, `:582-595` | aucune remise calculée côté client |
| Garde V5-2 (`deliveryAvailable`) et V5-1b (`reservable`) | `page.tsx:178-182`, `:218-220` | anti-cul-de-sac prouvés |

Le re-skin est **présentation seule** : aucune signature de fonction du panier ne change.

### 5.4 Diff structurel, nœud par nœud

| # | Aujourd'hui | Cible S1.1 | Nature |
| --- | --- | --- | --- |
| 1 | `.gb-resto` = grille de page `1fr var(--gb-cart-w:360px)`, panier pleine hauteur collé à droite avec `border-left` (`restaurant.css:17-26`, `:132`) | colonne unique centrée `max-width:1200`, panier = **carte flottante 352 px arrondie** dans la grille `.body`, `sticky top:84px` | **restructuration** |
| 2 | `.rmain` + `.content-pad{max-width:900px;padding:22px 28px 60px}` | `.body{max-width:1200;padding:24px 24px 96px}` | remplacement |
| 3 | `.topbar` `padding:17px 28px` (≈ 74 px), fond opaque `--gb-surface`, boutons 40 px sans bordure, titre 18 px, bouton ★ note | `.hd` **60 px**, fond flouté, cibles 38 px bordées, titre 17 px, inner `max-width:1200` | remplacement (+ décision D1 pour ★) |
| 4 | `.hero` = bandeau 230 px **sans identité superposée** ; nom uniquement dans la barre du haut | hero 21/8 (16/9 mobile) + **voile + nom 32 px + méta + pastille Ouvert** | nouveau contenu |
| 5 | `.il` (cuisine · horaires · **frais de livraison**) + `.closure` | supprimée ; cuisine + ville + distance → `.hero__meta` ; ouverture → `.badge-open` ; **frais supprimés** (§5.1) | suppression |
| 6 | `.promo-strip` (promos réelles serveur) `page.tsx:513-524` | **aucun emplacement dans la référence** | décision D3 |
| 7 | `.modes` = segmented control 3 modes, `role="tablist"` / `aria-selected`, « Sur place » **navigue** vers `/reserver` | 2 **cartes** `role="group"` / `aria-pressed`, icône + titre + sous-titre, actif = bord/fond zest + ✓ | remplacement (+ décisions D2, D4) |
| 8 | `.chips` non collantes, `<span role="button" tabIndex=0>` | `nav.cats` **collante `top:60`**, `<button class="cat">` scrollables | remplacement (a11y améliorée) |
| 9 | `.catsec h2` seul | `.sec-h` = `h2` + **compte réel** « N plat(s) » | ajout |
| 10 | `.dish` = `<div role="button">` : nom → **description (clamp 2 lignes)** → prix/promo/creator ; vignette 96 px ; `+` = `<button>` ; badge quantité `.dish__qty` | `<button class="dish">` : nom → **pastille allergènes** → prix ; vignette **104 px** (88 mobile) ; `+` = `<span>` décoratif | remplacement (+ décisions D5, D7) |
| 11 | `<details class="about">` **repliée**, une colonne, liste des 7 jours sans jour courant, sans bandeau, sans lien Plans | `section.about` **dépliée**, 2 colonnes, bandeau « Ouvert aujourd'hui · … », `.today` surligné, lien « Ouvrir dans Plans » | remplacement (+ décision D8) |
| 12 | Panier : `.cc-head` / `.cc-items` / `.cc-foot`, vide = emoji 🛒 + phrase + bouton fantôme « Réserver une table » | `.cart__h` + **`.cart__mode`** + `.cart__b` + `.cart__f` (sous-total + **note « aucun frais ajouté »** + CTA), vide = `.ms shopping_bag` + titre + phrase + **CTA désactivé** | remplacement (+ décision D2) |
| 13 | `.mcartbar` rendue **seulement si `cartCount > 0`**, `position:fixed`, encart 12/16 px, `bottom:74px` sous 900 | `.mbar` **toujours rendue** (désactivée à vide), `position:sticky; bottom:0`, pleine largeur | remplacement (+ contrainte shell, §6.5) |
| 14 | Modale = `.gb-dish` (`dish-detail.css`) : hero 200 px fixe, bouton favori dans le hero, titre 23 px, prix 19 px, **allergènes en ligne pointillée grise** avec repli « Information non renseignée… », encart créateur, note | `.pm` : photo **16/9**, pas de favori, titre 24 px / prix 22 px sur la même ligne, **bloc d'attention zest** (§11) **supprimé si liste vide**, ordre §10 strict | remplacement (+ décisions D9, D10) |
| 15 | Modale mobile : plein écran `min-height:100dvh`, radius 0 (`dish-detail.css:58-61`) | **feuille montante 94 vh**, radius 26 en haut, corps `overscroll-behavior:contain`, pied fixe | remplacement |
| 16 | `.tag` (variante non-promo) référence `var(--gb-basil-bg)` / `var(--gb-basil-bd)` **jamais définis** (`restaurant.css:103`) | règle **morte** (seul `.tag.promo` est rendu, `page.tsx:611`) — à supprimer ou à alimenter par les tokens §3.3 | nettoyage |

### 5.5 Champs de données à ajouter côté client (déjà servis par l'API)

`interface MenuItem` (`page.tsx:25-46`) doit gagner :

```ts
  /** MenuItem.calories (Int?) — displayed only when non-null (contract §10). */
  calories?: number | null
  /** MenuItem.labels (Json → string[]) — the 4 operator labels, displayed verbatim. */
  labels?: string[]
```

Les deux sont **déjà sélectionnés** par l'API (`app/api/restaurants/[id]/route.ts:49-51`) et existent
au schéma (`MenuItem.calories Int?`, `MenuItem.labels Json @default("[]")`). Normaliser `labels`
comme `allergens` (`normalizeAllergens`, `page.tsx:120-124` — filtre les non-chaînes, ne réinvente rien).

`interface RestaurantInfo` doit gagner `lat?: number | null` et `lng?: number | null` (déjà servis,
`route.ts:280-281`).

**Icônes de labels** — les 4 valeurs sont produites par l'app opérateur avec leur icône
(`app/[locale]/menu/page.tsx:117-120`, source de vérité) :

| Valeur stockée | Icône Material |
| --- | --- |
| `Veggie` | `eco` |
| `Halal` | `verified` |
| `Sans gluten` | `grain` |
| `Épicé` | `local_fire_department` |

La référence utilise `eco` et `grain` — **cohérent**. Afficher la chaîne **verbatim** (donnée
opérateur, non traduite) ; valeur inconnue ⇒ icône neutre, jamais de label inventé.
Idem pour les allergènes : la liste IA opérateur est **désaccentuée** (`Celeri`, `Crustaces` —
`app/api/menu/scan-dish/route.ts:125`), la référence affiche « Céleri ». **Afficher verbatim**,
ne pas ré-accentuer (transformation de donnée = hors périmètre S1.1, train D2.1).

---

## §6 · Risques de déviation — artefacts du harnais à NE PAS reproduire

### 6.1 ⚠️ `:root` dans un `@container` : règle morte (prouvé par la mesure)

```css
@container s1 (max-width:1080px){
  :root{--s1-cart:312px;--s1-gap:20px}   /* ← NE S'APPLIQUE JAMAIS */
  .dishes{grid-template-columns:1fr}     /* ← s'applique bien */
}
```
Une règle dans `@container` ne cible que les **descendants** du conteneur ; `:root` (= `html`) est un
**ancêtre** de `.wrap`. **Mesuré** : à 768 comme à 390, `--s1-cart` vaut toujours `352px` et `--s1-gap`
`28px`. Conséquences :

- le **gap ne passe jamais à 20 px** dans la référence rendue ;
- à 768 le panier n'est **pas large de 312 px** : la grille est déjà à une colonne (`@container ≤900`),
  donc `.cart` occupe **720 px** (pleine largeur), mesuré.

Le §14 du contrat (« panier 312 px de large en pleine largeur ») décrit donc **l'intention**, que le
CSS de la référence n'atteint pas. ⇒ **Arbitrage D11** requis (largeur du panier à 768).

### 6.2 ⚠️ Boutons de mode VIDES à 390 : bug de la référence

```css
@container s1 (max-width:560px){ .mode span{display:none} }
```
Le sélecteur touche **tous** les `<span>` de `.mode`, dont l'icône `.ms` et le `<span>` d'enrobage qui
contient le `<b>`. **Mesuré à 390** : `iconDisplay:"none"`, `wrapDisplay:"none"`, `bRect:{w:0,h:0}`,
`innerText:""` — les deux boutons sont des pastilles **vides de 174 × 24 px** (confirmé par capture).
Le contrat §6 dit explicitement : « Mobile : **sous-titres** masqués ».

⇒ **Implémenter le contrat, pas la référence** : masquer uniquement le sous-titre —
`.mode > span > span{display:none}` (ou classer le sous-titre, ex. `.mode__sub`).
Conséquence : **la comparaison Puppeteer à 390 divergera nécessairement** sur ce bloc.
À porter en déviation **EXPLICITLY ACCEPTED** (bug de référence), pas en « à corriger ».
Note : la hauteur du bloc `.modes` passera d'environ 24 px (référence) à ~46-48 px (produit), ce qui
**décale verticalement tout le contenu sous les modes à 390** — la comparaison pixel à 390 doit être
lue en conséquence (comparer par bloc, pas en diff plein écran).

### 6.3 Container queries → media queries viewport

`.wrap{container-type:inline-size;container-name:s1}` et les trois `@container s1 (…)`.
**Interdits** en production (règle de mission). Correspondance à appliquer :

| Référence | Produit |
| --- | --- |
| `@container s1 (max-width:1080px)` | `@media (max-width:1080px)` |
| `@container s1 (max-width:900px)` | `@media (max-width:900px)` |
| `@container s1 (max-width:560px)` | `@media (max-width:560px)` |

**Vérifié aux 3 largeurs contractuelles** : la traduction naïve donne le **même résultat** qu'en
container query, parce que le rail du shell (`--gb-nav-w:236px`) est masqué sous 900 :

| Viewport | Rail | Largeur de contenu | Réf. (conteneur) | Produit (viewport) |
| --- | --- | --- | --- | --- |
| 1440 | visible | 1204 → `.body` 1200 | > 1080 → 2 colonnes | > 1080 → 2 colonnes ✓ |
| 768 | masqué | 768 | ≤ 900 → 1 colonne | ≤ 900 → 1 colonne ✓ |
| 390 | masqué | 390 | ≤ 560 → mobile | ≤ 560 → mobile ✓ |

⚠️ Zone imprécise **entre 901 et 1316 px** : le contenu réel y mesure 665-1080 px alors que le
viewport dépasse 1080 → la grille reste à 2 colonnes de plats et le panier 352 px dans une colonne
étroite. Ce défaut **existe déjà** dans `restaurant.css:171` (`@media (max-width:1080px)`), donc
l'aligner sur 1080/900/560 ne crée **aucune régression**. Alternative : décaler les seuils de la
largeur du rail (1316 / 1136 / 560). ⇒ **Arbitrage D12**.

### 6.4 Autres artefacts de banc

| Artefact | Où | À ne pas reproduire |
| --- | --- | --- |
| Barre `.demo` (sélecteurs État / Écran) | `restaurant-menu.html:251-254` + CSS `:40-44` | aucun sélecteur d'état dans le produit |
| `.page{min-height:960px}` | `:48` | hauteur de banc — utiliser `min-height:100vh/100dvh` comme aujourd'hui (`restaurant.css:22`) |
| `.wrap{max-width:1440px}` / `.wrap.mob{max-width:390px;box-shadow:…}` | `:46-47` | simulateur de téléphone |
| `body{background:#E7E1D8}` | `:31` | fond de banc — la page utilise `--gb-bg` |
| `container-type:inline-size` ⇒ `contain:layout` | `.wrap` | **effet caché** : `.ov{position:fixed}` est positionné par rapport à `.wrap`, pas au viewport. En production (pas de conteneur), `position:fixed` reprend le viewport — comportement voulu, mais la **capture de référence de la modale n'est pas alignée verticalement** avec le rendu produit |
| `onclick="setState(...)"` inline, `<script>` de démo | `:423-450` | tout l'état vient de React |
| `<link>` Google Fonts | `:7-10` | polices auto-hébergées (`app/brand-fonts.css`) |
| `state=product` ⇒ le panier est **déjà rempli** | script `:435` | en production, ouvrir une modale **n'ajoute rien** au panier |
| Fermeture de modale ⇒ `setState('cart')` | `:378`, `:381` | fermer ne doit **jamais** ajouter au panier |
| Rehearsal Beta Grubano / Fournès / 15,7 km / 14,50 € / 00:00 – 23:50 | tout le HTML | **données du restaurant de répétition**, à lier aux vraies données |

### 6.5 Contraintes propres au produit, absentes de la référence

1. **Le shell** (`components/eat/EatShell.tsx`, `app/[locale]/eat/nav-shell.css`) : rail gauche
   `--gb-nav-w:236px` ≥ 901 px, **bottom-nav fixe** ≤ 900 px. En mode `is-framed`, `m-appbar` et
   `fab-cart` sont masqués, **mais pas la bottom-nav** (`nav-shell.css:112`). La barre panier mobile
   doit donc rester **au-dessus** de la bottom-nav — le produit le fait déjà via
   `@media (max-width:900px){.gb-resto .mcartbar{bottom:74px}}` (`restaurant.css:188-190`).
   La `.mbar` de la référence (`sticky; bottom:0`) **passerait sous la bottom-nav** si on la copiait telle quelle.
2. **Centrage horizontal** : à 1440, la référence centre 1200 px dans 1440 ; le produit centre 1200 px
   dans 1204 (1440 − 236). La **géométrie interne est identique** (1200 − 48 = 1152 = 772 + 28 + 352),
   seule l'origine `x` de la page diffère (~120 px). Comparer **par bloc**, pas en superposition d'écran.
3. **RTL** : `app/gb-foundation/gb-rtl.css` est actif pour `ar`. La référence utilise déjà
   `inset-inline-*` / `margin-inline-start` aux bons endroits — conserver les propriétés logiques
   (`.dish__add`, `.pm__x`, `.hd__act`, `.about__h .ms`).
4. **Thème sombre** : cf. §3.6.
5. **États de chargement / erreur** : le squelette (`page.tsx:331-348`) et l'écran « Restaurant
   introuvable » (`:350-366`) n'existent pas dans la référence ; les conserver, réalignés sur la
   nouvelle structure.

---

## §7 · Arbitrages requis avant implémentation

> Chaque point oppose le contrat à une fonction **réelle et prouvée** du produit. Aucun ne peut être
> tranché silencieusement par le builder.

| # | Sujet | Enjeu | Recommandation |
| --- | --- | --- | --- |
| **D1** | ★ note dans la barre du haut (`page.tsx:445-449`) → `/eat/r/[id]/reviews` | Le contrat §4 ne liste que Retour · nom · partager · favori. Le ★ n'apparaît **que si `rating != null`** (avis réels) — donc **absent** des 3 états comparés ⇒ zéro impact pixel. L'autre entrée vers les avis est `/eat/receipt/[id]:269` (après commande seulement). | **CONSERVER** le ★ (déviation acceptée, invisible dans la comparaison) |
| **D2** | 🔴 **Entrée réservation** | `/eat/r/[id]/reserver` n'a **que deux entrées dans toute l'application**, toutes deux sur cette page : la carte « Sur place » (`page.tsx:544`) et le bouton fantôme du panier vide (`page.tsx:733-737`). Le contrat transforme « Sur place » en **bascule `aria-pressed`** et le panier vide en **CTA désactivé**. Appliquer les deux **orpheline le tunnel de réservation** (empreinte Stripe incluse). | **NE PAS supprimer les deux.** Garder une entrée explicite — de préférence un lien « Réserver une table » sous le CTA désactivé du panier — et l'assumer en déviation |
| **D3** | Bandeau promotions (`page.tsx:513-524`) + pastilles promo par plat (`:611`) | Données **réelles calculées serveur**. Aucun emplacement dans la référence. Les masquer cacherait une remise active réelle. | **CONSERVER**, placé entre le hero et les modes ; déviation acceptée |
| **D4** | Carte « Livraison » | §6 dit « deux cartes seulement » ; le produit affiche la 3ᵉ **uniquement si le serveur accepterait une commande en livraison** (garde V5-2, `page.tsx:531`). | **Garder la garde serveur** (ne jamais coder « 2 » en dur) : delivery OFF ⇒ 2 cartes, conforme |
| **D5** | Description sur la carte plat (`page.tsx:607`) | La composition §8 ne comporte pas de description ; §10 la place dans la modale. Donnée réelle aujourd'hui visible. | **Retirer de la carte** (conforme), la modale la porte |
| **D6** | Thème sombre des tokens `--s1-*` | La référence est light-only ; toute la conso est theme-aware. | Décliner chaque `--s1-*` sous `[data-theme="dark"]`, comme le reste du dépôt |
| **D7** | Badge quantité `.dish__qty` sur la carte (`page.tsx:619`) | Retour d'état honnête, absent de la référence ⇒ diff pixel dans l'état `cart`. | **CONSERVER** (déviation acceptée) ou retirer — à trancher, impact pixel réel |
| **D8** | Cible du lien « Ouvrir dans Plans » | La référence a `href="#"` (inerte) ⇒ **non spécifié**. Lien sortant vers un tiers. | Lien `https` de cartographie construit sur l'adresse réelle, `target="_blank" rel="noopener noreferrer"` — à valider (fuite de l'adresse du restaurant vers un tiers) |
| **D9** | Encart « Recette du chef » de la modale (`page.tsx:813-856`) | Rendu **uniquement si `dish.creator`** ⇒ absent des 3 états comparés. **Mais** il affiche une citation d'exemple (`tcr('quotePlaceholder')`) et deux blocs inertes « bientôt » — proche des interdits §20. | Conserver hors périmètre S1.1, **signaler la citation placeholder** au train qui l'a produit |
| **D10** | Allergènes vides dans la modale (`page.tsx:866`, `t('allergensNone')`) | Aujourd'hui : « Information non renseignée par le restaurant — contactez-le en cas d'allergie. » §11 impose la **disparition du bloc** si la liste est vide (« aucune fausse mention rassurante »). | **TRANCHÉ 2026-09-01 — le bloc est CONSERVÉ.** Le fondateur a refusé la perte d'information de sécurité : liste vide ⇒ bloc maintenu, pastilles remplacées par « Informations allergènes non renseignées par le restaurant. En cas d'allergie, contactez l'établissement avant de commander. ». Motif : D2.1 §9 promet cet écran au restaurateur ; §11 est respecté sur le fond (aucune mention rassurante, aucun état vert) |
| **D11** | Largeur du panier à 768 | Contrat : 312 px. Référence rendue : **720 px** (règle `:root` morte, §6.1). | Suivre la **référence rendue** (pleine largeur), la comparaison Puppeteer étant faite contre elle ; noter l'écart au contrat |
| **D12** | Seuils responsive | 1080/900/560 (identiques à la référence et au CSS actuel) vs 1316/1136/560 (compensant le rail). | **1080/900/560** — résultat identique aux 3 largeurs contractuelles, aucune régression |

---

## §8 · `i18nNeeds` — à déclarer par le BUILDER (il n'édite pas `messages/*.json`)

### 8.1 Existantes et réutilisables (`eat.restaurant` sauf mention)

`common.back` « Retour » · `common.close` « Fermer » · `common.km` « km » · `share` « Partager » ·
`favorite` « Favori » · `categoryAll` « Tout » · `yourOrder` « Votre commande » · `subtotal` « Sous-total » ·
`cartEmpty` « Votre panier est vide » · `viewCart` « Voir le panier » · `viewCartCount` ·
`addToCart` « Ajouter au panier » · `decrease` / `increase` · `addNote` « Ajouter une note » ·
`notePlaceholder` « Ex. cuisson saignante, pas de coriandre… » *(identique à la référence)* ·
`allergensTitle` « Allergènes » · `tabAbout` « À propos » · `modeTakeaway` « Click & collect » ·
`modeDineIn` « Sur place » · `hoursOpenNow` « Ouvert » · `noItemsFound` · `restaurantNotFound` ·
`addedToCart` · `addedToFavorites` / `removedFromFavorites` / `shareCopied` / `shareError`.

### 8.2 À créer

| Clé proposée | FR (verbatim référence/contrat) |
| --- | --- |
| `distanceApprox` | `à env. {distance}` |
| `modeTakeawaySub` | `À récupérer sur place` |
| `modeDineInSub` | `À consommer au restaurant` |
| `serviceModeAria` | `Mode de service` |
| `menuCategoriesAria` | `Catégories du menu` |
| `dishCount` | `{count, plural, =0 {# plat} =1 {# plat} other {# plats}}` |
| `allergensOnCard` | `Allergènes : {list}` |
| `allergensNotice` | `Renseignés par le restaurant. En cas de doute, demandez confirmation sur place.` |
| `cartModeLine` | `{mode} · {restaurant}` |
| `cartEmptyHint` | `Ajoutez un plat du menu pour commencer.` |
| `pickupNoFeeNote` | `À régler au retrait. Aucun frais ajouté.` |
| `cartBarEmpty` | `Panier vide` |
| `openToday` | `Ouvert aujourd'hui · {range}` |
| `openInMaps` | `Ouvrir dans Plans` |
| `caloriesValue` | `{count} kcal` |
| `favoriteAdd` / `favoriteRemove` | `Ajouter aux favoris` / `Retirer des favoris` (aria du header) |

### 8.3 À **modifier** (clé existante, valeur incorrecte pour cet écran)

| Clé | Actuel | Problème |
| --- | --- | --- |
| `itemCountShort` | `{count, plural, =1 {# article} other {# articles}}` | `count = 0` tombe dans `other` ⇒ « 0 articles ». La référence affiche **« 0 article »** (règle FR : 0 au singulier). Ajouter `=0 {# article}` |

### 8.4 À **supprimer** de l'usage (mensonge, §5.2)

| Clé | Valeur | Action |
| --- | --- | --- |
| `openingHours` | `Lun–Dim : 10h00 – 23h00` | ne plus être rendue (horaires fabriqués) ; la clé peut rester orpheline dans `messages/*.json` |

### 8.5 Rappels

- Les 4 **labels** (`Veggie`, `Halal`, `Sans gluten`, `Épicé`) et les **allergènes** sont des **données
  opérateur** : affichage **verbatim**, jamais traduits, jamais complétés.
- `messages/*.json` contient des **clés dupliquées** (trois blocs `restaurant` distincts) :
  ne jamais faire `JSON.parse` / `stringify` sur ces fichiers.
- 5 locales à alimenter (`fr`, `en`, `es`, `ar`, `it`) ; l'arabe reste une traduction machine en
  attente de relecture.

---

## §9 · Check-list de conformité (à rejouer avant clôture)

1. Aucune occurrence de `deliveryTime`, `pedal_bike`, `two_wheeler`, `freeDelivery`, « min », « ETA »
   dans le rendu de la surface.
2. `deliveryFee` n'apparaît **que** dans l'objet `cart.restaurant` (`page.tsx:268`), jamais à l'écran.
3. La distance, quand elle est affichée, l'est **exclusivement** sous la forme « à env. X km » + `near_me` ;
   absente si l'une des deux coordonnées manque.
4. Un champ vide (description, labels, calories, allergènes, horaires, photo) **fait disparaître son bloc** :
   zéro placeholder, zéro « non renseigné », zéro bloc vide.
5. Dans la modale : `.alg` toujours **après** le prix et **plus saillant** que labels et calories.
6. Aucune des valeurs de `product-full` (description, `Veggie`, `Sans gluten`, `650 kcal`) n'existe
   dans le code, les seeds ou les fixtures.
7. Aucune variante, taille, supplément, option, nutrition détaillée, ingrédient structuré, stock ni
   disponibilité avancée n'est dessiné.
8. Aucune `@container` ni `container-type` dans le CSS livré ; aucune `min-height` de banc.
9. Pas de débordement horizontal à 390 / 768 / 1440 (`scrollWidth === clientWidth`).
10. Cibles ≥ 38 px desktop / 44 px mobile ; `aria-pressed` sur les modes ; `role="dialog"` +
    `aria-modal` + croix labellisée + fermeture au clic sur le fond ; steppers labellisés ;
    états à double canal (icône + texte, jamais la couleur seule).
11. `lib/eat-cart` et les 6 fonctions listées en §5.3 sont **inchangées** (diff vide).
12. L'entrée vers `/eat/r/[id]/reserver` existe toujours quelque part (D2).
