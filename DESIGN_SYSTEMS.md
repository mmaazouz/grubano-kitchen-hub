# Grubano — Design Systems

> Grubano has **three coexisting UI layers**. They do not conflict (each is scoped),
> but you must know which one a route belongs to before touching it. This file is the
> map. (WP-DOC-01.)

---

## TL;DR — which layer am I in?

| If the route is… | Layer | Token prefix | Icons | Scope selector |
|---|---|---|---|---|
| `/eat/*` (consumer app) | **gb-foundation** | `--gb-*` | Material Symbols | `.gb` |
| operator app (`/dashboard`, `/menu`, `/orders`, `/marketplace`, `/more`, …) | **operator foundation** | `--op-*` | Material Symbols | `.gb-op` |
| `/design` catalog, a few legacy shared widgets | **legacy shadcn/lucide DS** | `lib/design-tokens.ts` (Tailwind theme) | `lucide-react` | Tailwind classes |

Rule of thumb: **Material Symbols everywhere new** (`<span className="ms">icon_name</span>`);
`lucide-react` only survives inside the legacy DS. Never mix `--gb-*` and `--op-*` on the
same element.

---

## 1. Legacy shadcn/lucide design system (oldest)

- **Where:** `components/design-system/` (barrel `index.ts`), `lib/design-tokens.ts`
  (brand orange `#F97316`, Gabarito/Inter, spacing/radii/shadows), `lib/food-images.ts`
  (curated food photos + restaurant covers).
- **Tech:** React + Tailwind + `lucide-react` icons. Radix/shadcn primitives.
- **Components:** `Button`, `Card`, `Input`, `Badge`, `EmptyState`, `Modal`, `Avatar`,
  `Skeleton*`, `ToastProvider`/`useToast`, `LanguageSwitcher`, `RestaurantCard`,
  `PriceTag`, `StarRating`, plus catalog-only pieces (`CategoryPill`, `DishCard`,
  `OrderCard`, `DocsLink`).
- **Who uses it:** the living style-guide route **`app/[locale]/design/page.tsx`**
  (imports and showcases the full DS, incl. the catalog-only pieces), plus a handful
  of shared consumer widgets. `Button`/`Card`/`Input`/`Badge`/`EmptyState` still have
  many importers; the catalog-only pieces are referenced **only** by `/design`.
- **`/design` ships on purpose.** It is an intentional living catalogue, not dead code.
  It carries `robots: noindex` (`app/[locale]/design/layout.tsx`) so it is not search-
  indexed. Consequently the four catalog-only components (`CategoryPill`, `DishCard`,
  `OrderCard`, `DocsLink`) and the `@deprecated currency` prop shims on `PriceTag` /
  `RestaurantCard` are **kept deliberately** — they are exercised by the catalogue and
  keep call sites compiling. Do not "clean them up" as unused (WONTFIX — see the A6
  CLEAN-02/04 decision).
- **Money/format rule:** the app is **EUR-only**; all amounts format via
  `lib/format-money` using the *active locale* (separator + symbol position). Any
  `currency` prop on `PriceTag` / `RestaurantCard` is `@deprecated` and **ignored**
  (kept purely for call-site compile-compat — a user's language never changes the
  currency).

## 2. gb-foundation — consumer app (`/eat/*`)

- **Where:** `app/gb-foundation/gb-tokens.css` (the `--gb-*` token layer, CD-verbatim)
  + `app/gb-foundation/gb-components.css` (buttons, inputs, cards, OTP, …).
- **Scope:** everything is under **`.gb`** (e.g. `.gb .hero`). Keep selectors tightly
  scoped — a bare `.gb .hero` once collided with an unrelated component (fixed by
  raising specificity). Pages import the two CSS files + their own page CSS.
- **Icons:** Material Symbols (`<span className="ms">…</span>`), **no lucide**.
- **Shell:** `components/EatSessionProvider` + `app/eat/layout.tsx` (the consumer
  nav shell — rail/topbar on desktop, bottom-nav + cart bar on mobile). Routes are
  **bare** w.r.t. the operator chrome (see `AppChrome` `BARE_PREFIXES`).
- **Responsive:** mobile-first 480px column + bottom-nav (≤ md); widened multi-column
  container + persistent left rail (≥ lg). RTL (Arabic) supported globally.

## 3. Operator foundation — operator app

- **Where:** `components/operator/OperatorShell.tsx` + `components/operator/operator-shell.css`
  (defines the `--op-*` tokens: navy chrome, Zest accent, JetBrains Mono for
  figures/ids, plus the shell parts `.op-side` / `.op-top` / `.op-bottomnav` /
  `.op-content`). Mounted by `components/AppChrome.tsx`.
- **Scope:** content is under **`.gb-op`** (e.g. `.gb-op .op-card`). Each operator page
  ships a **self-sufficient** CSS file that *recopies* the shared content classes it
  uses (`op-dash__head`, `op-card`, `set-block`, `set-row`, `set-badge`, `op-btn-primary`,
  `op-sk`, …) — it never redefines the tokens or the shell parts. Examples:
  `more.css`, `dashboard.css`, `menu.css`, `marketplace.css`.
- **Icons:** Material Symbols, **no lucide**. Figures/ids that must stay LTR under RTL
  use `.mono { font-family: var(--op-font-mono); direction: ltr; unicode-bidi: isolate }`.
- **Which routes:** all operator flat routes NOT in `AppChrome` `BARE_PREFIXES`
  (`/dashboard`, `/menu`, `/orders`, `/stocks`, `/analytics`, `/marketplace`, `/pricing`,
  `/more`, `/cashflow`, `/finance`, …). `/onboarding` is the founder-approved
  full-screen exception (bare).

---

## Cross-cutting rules

- **AppChrome routing** (`components/AppChrome.tsx`): strips the locale, then decides
  bare vs operator shell via `BARE_PREFIXES`. Consumer (`/eat`), partner portals
  (`/franchise`, `/creators`, `/supplier`, `/logistics`, `/business`), public
  (`/t`, `/legal`, `/login`, `/register`), and `/onboarding` are bare. Everything else
  → `OperatorShell`.
- **i18n:** all UI strings live in `messages/{fr,en,es,it,ar}.json` and must be
  balanced across the 5 locales (`scripts/check-translations.js`, enforced by
  `tests/i18n-completeness.test.ts`). No hardcoded UI strings.
- **Money display:** never fabricate figures. Amounts come from a real API/rail or show
  `—`; unbuilt integrations show an honest « bientôt » badge, never a fake connected /
  commission / rating state. CENTS are server-side only.
- **Icons:** new work uses Material Symbols; `lucide-react` is confined to the legacy DS
  and is being phased out of operator/consumer surfaces during re-skins.
