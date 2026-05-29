# Grubano Design System

> Single source of truth for visual components across the operator app, consumer app, and portals.
>
> **Owner:** Agent 6
> **Live showcase:** [`/design`](https://app.grubano.com/design)
> **Tokens:** [`lib/design-tokens.ts`](../../lib/design-tokens.ts)
> **Food photo catalogue:** [`lib/food-images.ts`](../../lib/food-images.ts)

---

## Why this exists

Before Agent 6, each agent (`/dashboard`, `/eat`, `/franchise`, `/creators`) was reinventing the same primitives — buttons, cards, badges, restaurant tiles — with subtly different paddings, radii, and shades of orange. This system collapses all of that into one importable surface so the brand stays consistent and every new screen lands faster.

**Rule of thumb:** if you find yourself styling a `<div>` for the third time, look here first. If it doesn't exist, ping Agent 6 in the Notion inbox.

---

## How to consume

```tsx
import {
  Button,
  RestaurantCard,
  DishCard,
  Badge,
  Modal,
  useToast,
} from '@/components/design-system'

import { getFoodImage, getRestaurantCover } from '@/lib/food-images'
```

Everything is exported from the barrel — never reach into individual files. Types are exported with each component.

For Tailwind classes, prefer the unified token palette:

```tsx
className="bg-grubano-primary text-white rounded-grubano-xl shadow-grubano-md"
```

Legacy aliases (`grubano-orange`, `bolt-primary`, etc.) still resolve to the same colors for backward compat — but **do not use them in new code**.

---

## Components

### Layout & primitives

| Component | Purpose | Key props |
|---|---|---|
| [`Button`](Button.tsx) | All CTAs. | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`<br>`size: 'sm' \| 'md' \| 'lg' \| 'pill'`<br>`fullWidth`, `loading`, `leftIcon`, `rightIcon` |
| [`Card`](Card.tsx) | Base surface with shadow + radius. Compose for higher-level cards. | `elevation: 'flat' \| 'sm' \| 'md' \| 'lg' \| 'premium'`<br>`padding: 'none' \| 'sm' \| 'md' \| 'lg'`<br>`interactive`, `as` |
| [`Input`](Input.tsx) | Text/email/password/number with built-in label + hint + error. | `label`, `hint`, `error`, `leftIcon`, `rightIcon` (and all native `<input>` props) |
| [`Badge`](Badge.tsx) | Status pills, ribbons, count chips. | `tone: 'neutral' \| 'primary' \| 'success' \| 'danger' \| 'warning' \| 'info' \| 'dark'`<br>`size: 'sm' \| 'md'`, `dot`, `icon` |
| [`Avatar`](Avatar.tsx) | User/restaurant photo with deterministic initials fallback. | `name` (required, drives the colour), `src`, `size: 'xs'…'xl'`, `square` |
| [`PriceTag`](PriceTag.tsx) | Formatted price. Auto-handles strikethrough for promos. | `amount`, `originalAmount`, `cents`, `currency`, `size`, `hideCurrency` |
| [`StarRating`](StarRating.tsx) | Read-only (display + numeric value + reviews) or interactive (1..5). | `value`, `onChange`, `size`, `reviewCount`, `showValue` |
| [`CategoryPill`](CategoryPill.tsx) | The orange pills with emoji used in /eat. | `emoji`, `active`, `size`, all `<button>` props |

### Composite cards

| Component | Use in | Key props |
|---|---|---|
| [`RestaurantCard`](RestaurantCard.tsx) | `/eat` home & search, `/dashboard/brands`, `/franchise/restaurants` | `layout: 'grid' \| 'list' \| 'hero'`<br>`name`, `cover`, `cuisine`, `rating`, `reviewCount`, `deliveryTime`, `deliveryFee`, `minOrder`, `ribbon`, `unavailable`, `onClick` |
| [`DishCard`](DishCard.tsx) | `/eat/r/[id]` menu, `/dashboard/menu`, carousels | `layout: 'horizontal' \| 'vertical'`<br>`name`, `description`, `price`, `originalPrice`, `cents`, `photo`, `labels`, `popular`, `unavailable`, `meta`, `quantityInCart`, `onClick`, `onAdd` |
| [`OrderCard`](OrderCard.tsx) | `/dashboard/orders`, `/eat/account` history, `/eat/track` | `orderId`, `status`, `counterparty`, `total`, `time`, `address`, `items`, `etaMinutes`, `actionLabel`, `onAction`, `onClick` |

### Feedback & overlays

| Component | Purpose |
|---|---|
| [`Modal`](Modal.tsx) | Bottom-sheet on mobile, dialog on desktop. Escape + backdrop close. Pass `footer` for actions. |
| [`Toast`](Toast.tsx) | Global notification system. Mount `<ToastProvider>` once near root, then `const { success, error, warning, info } = useToast()`. |
| [`EmptyState`](EmptyState.tsx) | Designed empty pages with emoji, headline, optional CTA. `compact` for small slots. |
| [`SkeletonLoader`](SkeletonLoader.tsx) | `Skeleton` (base block), `SkeletonRow`, `SkeletonCard`, `SkeletonList`. Use while loading. |

---

## Tokens

All tokens live in [`lib/design-tokens.ts`](../../lib/design-tokens.ts). Tailwind consumes them via [`tailwind.config.ts`](../../tailwind.config.ts).

### Colours

| Token | Hex | Tailwind class |
|---|---|---|
| `primary` | `#F97316` | `bg-grubano-primary`, `text-grubano-primary` |
| `primaryHover` | `#EA6A0C` | `hover:bg-grubano-primaryHover` |
| `primaryTint` | `#FFF3ED` | `bg-grubano-tint` (badges, pills wash) |
| `dark` | `#1a1a2e` | `bg-grubano-dark` (sidebar, wallet) |
| `background` | `#FAFAFA` | `bg-grubano-bg` (page) |
| `card` | `#FFFFFF` | `bg-grubano-surface` (card) |
| `ink` / `inkMuted` / `inkFaint` | `#1a1a1a` / `#6B6B6B` / `#9B9B9B` | `text-grubano-ink`, `text-grubano-ink-muted`, `text-grubano-ink-faint` |
| `success` / `danger` / `warning` / `info` | semantic | `bg-grubano-success`, etc. + `-tint` variants |

> The legacy `#E8593C` orange (operator app) is **deprecated**. `--primary` CSS var was updated to `#F97316` so any `bg-primary`/`text-primary` instance automatically picks up the new colour without code changes. Re-run a build after pulling.

### Radii

`sm 8 · md 12 · lg 16 · xl 20 · 2xl 28 · pill 9999`. Tailwind: `rounded-grubano-{sm|md|lg|xl|2xl|pill}`.

### Shadows

`sm` (hairline) · `md` (default card) · `lg` (hover lift) · `premium` (modals, hero) · `cta` (orange-tinted glow under primary buttons). Tailwind: `shadow-grubano-{sm|md|lg|premium|cta}`.

### Spacing

4-px scale: 4, 8, 12, 16, 24, 32, 48, 64 (px). Tailwind helpers: `p-grubano-{1..16}`, `m-grubano-{1..16}`, `gap-grubano-{1..16}`. You can keep using native Tailwind (`p-4`, `gap-3`) — the named tokens exist for explicit-intent code (e.g. `p-grubano-6` reads as "section padding").

### Typography

- Display: **Space Grotesk** (h1–h4, hero headlines). Tailwind: `font-display`.
- Body: **Inter**. Tailwind default `font-sans`.
- Sizes: `text-grubano-xs` (12) → `text-grubano-5xl` (48). Native Tailwind sizes also work.

---

## Food photo catalogue

85 curated Unsplash photos live in `public/images/food/{category}/{slug}.jpg` plus 10 restaurant covers in `public/images/restaurants/`.

```ts
import { getFoodImage, getRestaurantCover, inferCategory } from '@/lib/food-images'

// Deterministic by key — same dish ID always returns the same photo.
<DishCard photo={getFoodImage('pizza', dish.id)} ... />

// Restaurant covers
<RestaurantCard cover={getRestaurantCover(restaurant.id)} ... />

// Infer category from a free-form cuisine string
const cat = inferCategory(restaurant.cuisine[0])   // → 'pizza' | 'asian' | ...
```

### To refresh / re-download

```bash
node scripts/download-food-images.js          # idempotent
node scripts/download-food-images.js --force  # re-download all
```

If you swap a photo, edit `FOOD_CATALOG` in `lib/food-images.ts` in place (don't reorder the array — indices are stable so the same dish keeps the same photo).

### Categories

`pizza · burgers · asian · healthy · desserts · wraps · pasta · drinks` (10 photos each, 5 for drinks).

---

## Migration guide for Agents 2 / 3 / 4

You don't have to migrate everything at once. The legacy classes still work. But for any **new** code, prefer the design-system primitives:

| You currently write… | …switch to |
|---|---|
| Hand-rolled `<button class="bg-orange-500 text-white …">` | `<Button>` |
| `<div class="bg-white rounded-2xl shadow p-4">` | `<Card>` |
| Custom restaurant tile JSX | `<RestaurantCard layout="grid" \| "list" \| "hero" />` |
| `components/eat/FoodImage` w/o photo | Keep using it for the gradient backstop, but pair with `getFoodImage()` when you have a real image |
| `react-hot-toast` / ad-hoc divs for notifications | `<ToastProvider>` + `useToast()` |
| `bg-bolt-primary` | `bg-grubano-primary` (same colour now) |
| `bg-grubano-orange` | `bg-grubano-primary` (same colour now) |

---

## Adding a new component

1. Add the file under `components/design-system/`. Mirror the patterns: `'use client'`, `React.forwardRef`, accept `className`, prop-typed exports, Tailwind only.
2. Export from `index.ts` (both component & its prop types).
3. Add a section to `app/design/page.tsx` showing every variant.
4. Update this README's "Components" table.
5. Notify other agents in the Notion inbox.

---

## Open questions / known gaps

- Dark mode is not handled by the design system yet. Token names are dark-mode-friendly (`background` / `surface` / `ink` rather than `white` / `black`), so the migration will be a CSS-variables swap. Not blocking v1.
- `<Toast>` mounts no provider by default — you need to add `<ToastProvider>` at app root (recommended in `app/layout.tsx` once Agent 1 reviews) or per-section (e.g. `/eat/layout.tsx` already wraps in `EatSessionProvider`).
- The legacy `lib/utils.cn` is used everywhere — no plan to replace it.

---

_v1.0 — 2026-05-30 · Agent 6_
