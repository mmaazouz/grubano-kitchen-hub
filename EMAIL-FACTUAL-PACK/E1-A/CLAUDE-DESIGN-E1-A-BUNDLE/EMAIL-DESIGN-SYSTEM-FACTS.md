# EMAIL-DESIGN-SYSTEM-FACTS — the short, reusable facts every Claude Design email tranche must load

> Compact by design (load this in every E1/E2/E3 session). Facts only; the design contract itself is produced by E1 as `CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md` and reused by E2/E3.

## 1 · Brand tokens (proven in `app/gb-foundation/gb-tokens.css`, the current consumer design foundation)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--gb-zest` | `#FF6A1F` (`-600 #F2570E`, `-300 #FF8A3D`) | `#FF7C39` | **ZEST orange** — primary accent, CTAs (founder override of WCAG for the vivid accent on product surfaces; **in email, white text on `#FF6A1F` ≈ 2.9:1 → use dark text or a darker zest for AA**) |
| `--gb-ink` | `#0F2742` (`-700 #16395A`) | text `#EEF3F9` | **INK navy** — headings/body |
| `--gb-basil` | `#2BA45C` (`-600 #1E9E57`) | `#41BD78` | **BASIL green** — success |
| `--gb-bg` / `--gb-surface` / `--gb-surface-2` | `#FBF8F3` / `#FFFFFF` / `#FBF8F3` | `#0C1826` / `#14253A` / `#0C1826` | warm off-white ground / card |
| `--gb-text` / `--gb-muted` / `--gb-muted-2` | `#0F2742` / `#6B7682` / `#9C7B5C` | `#EEF3F9` / `#93A3B5` / `#7E8FA3` | |
| `--gb-success` (+bg/bd/fg) | `#1E9E57` / `#EAF7EF` / `#CDEBD8` / `#235C3A` | `#41BD78` … | SUCCESS |
| `--gb-warning` (+bg) | `#EA9410` / `#FCF0D9` | `#F0B249` | WARNING / ACTION REQUIRED |
| `--gb-danger` (+bg/bd) | `#E0402E` / `#FCEAE7` / `#F4CFC9` | `#FF6B5C` | URGENT / safety |
| Fonts | `--gb-font-display: 'Gabarito'`, `--gb-font-ui: 'Hanken Grotesk'`, `--gb-font-mono: 'JetBrains Mono'`, `--gb-font-ar: 'Cairo'` (self-hosted on the web app) | | **Email: not embeddable reliably → system stack fallback mandatory** (Arial/Helvetica/-apple-system). |

Legacy tokens still used by the **current** emails (to be replaced, not kept): `#F97316` orange, `#1a1a2e` navy, `#6b7280`/`#9ca3af` greys, `border-radius:12px` buttons, `Inter` stack. Operator app (`CLAUDE.md §3`) uses `#E8593C`/`#1a1a2e` — not the consumer foundation.

## 2 · Assets
- `public/brand/grubano-symbol-color.svg`, `public/brand/grubano-symbol-white.svg` (symbol only; **no wordmark file in the repo**). Favicons `public/favicon.svg|ico`, `favicon-96x96.png`, `apple-touch-icon.png`. SVG is unsafe in most email clients → a PNG export (hosted on `https://app.grubano.com/...` or inline data URI where accepted) must be produced at implementation time. Current emails contain **zero images**.
- Material Symbols are the icon set of the web foundation (`gb-foundation/material-symbols.css`); not usable as a font in email → icons must be images or Unicode glyphs with text labels.

## 3 · Canonical references and formats
- Order reference **`GR-XXXXXX`** (`lib/order-ref.ts`), identical on client, kitchen, pass QR and emails. Reservation code `#XXXX` ("N° de session"). Never expose `cuid`s, `pi_…`, `re_…`, `Claim.id` to consumers or partners.
- Amounts in cents → `fr-FR` EUR "12,50 €" (recipient locale for localized families). Dates "samedi 12 septembre à 19:30", Europe/Paris.
- Restaurant display name = `Restaurant.name` (e.g. "Gnocchi Bar"); brand names exist separately (multi-brand).

## 4 · Voice, register, language
- **Formal French (vouvoiement) is the target** for every email (current state: 3 auth emails tutoient). Sober, precise, warm, no hype, no emoji in body (current dish-adopted uses 🎉; dead LLM emails used emoji subjects).
- Lexicon (canonical, `grubano-glossaire`): « Click & collect » · « mode » · « cagnotte » · « restaurant » (⛔ « établissement » — currently used in PARTNER_ACCOUNT_VALIDATED "votre établissement") · « retrait » for pickup.
- Localization: only claims + nudges are ×5 (fr en es it ar, RTL ar). A designed system must be RTL-capable and locale-neutral in layout, but **design in FR**; translations are a separate implementation step.
- Sign-off today: one footer sentence "Grubano — cet email a été envoyé automatiquement, vous pouvez y répondre si besoin." (no address, no legal, no unsubscribe except nudges).

## 5 · Product truth boundaries (closed beta, 2026-09)
- **Delivery OUT** (`DELIVERY_FULFILLMENT_ENABLED` effective false; only pickup/Click & collect is sold). Delivery wording exists in code — do not design delivery states as live.
- **Courier waitlist IN** (`LOGISTICS_SIGNUP_ENABLED` required true; measured false 2026-09-04 pending operator v3) · courier **operations OUT**.
- **Franchise OUT** (`FRANCHISE_ENABLED` OFF; only admin MONEY REVIEW kinds mention it).
- **Sur place / reservations OUT** (routes live, product out of beta).
- **Claims OFF** whole beta (D4) → consumer claim emails are post-beta designs against the confirmed contract. **Refunds** engine frozen (`REFUNDS_ENABLED` false, measured) → REFUND_SUCCEEDED designed against the contract.
- Payments: **Stripe TEST only** on staging; never LIVE.
- Cash / wallet payment refused server-side — card only.
- Human support = `contact@grubano.com` (the only escalation channel promised in copy).

## 6 · Status semantics the system must support
`SUCCESS` (confirmed, ready, validated, refund succeeded) · `ACTION REQUIRED` (magic link, verify, code, admin "à valider/à instruire") · `NEUTRAL` (ack, accepted-transmitted, waitlist registered) · `WARNING` (cancelled, rejected, refused) · `URGENT / SAFETY` (money review, stale PI, ghost order; allergen — proposal only). **Never colour-only**: every status also as text (heading + label) and, where useful, a glyph with alt text. Serious/minimal/non-promotional tone for safety and money-review families.

## 7 · Truthfulness rules (binding for design copy)
No ETA or "arrive bientôt" · no delivery while delivery OFF · no fee not read from the server · no banking-delay figure without a product source · **"Remboursement effectué" only on Stripe `succeeded`** (requested ≠ pending ≠ failed ≠ succeeded; **claim resolved ≠ refund succeeded**) · refund actor = Grubano, not the restaurant · no loyalty promise beyond what the PATCH credits (points are not surfaced today) · no legal promise (30-day contest window exists only in the gated no-show email) · no "table reservation" promise in beta (welcome copy currently makes one) · pickup semantics: "récupérer au restaurant", never "livrée" for pickup.

## 8 · Email-safe requirements
600–640 px max container; responsive at 320 / 390 / 600 / desktop; table-based layout where alignment matters; inline CSS (no `<style>` reliance), no JS, no web fonts required; system font stack; images optional with meaningful `alt` (images-off must still read); buttons as bulletproof `<a>` (VML for Outlook optional); `<html lang="fr" dir="ltr|rtl">` + `<title>` + hidden **preheader**; plain-text alternative for every email; contrast AA for body and CTA text; heading hierarchy (one h1); footer with sender identity, why-you-receive-this line, support contact; List-Unsubscribe + link **only** for the nudge/marketing-like family (transactional emails must not carry an unsubscribe that would suppress required notices).

## 9 · Idempotency & audience facts that shape conditional states
One email per (trigger, entity) via `EmailDispatch`; distinct statuses of the same order are distinct emails → design **one shell, many states**, not one mega-email. Audiences: consumer (FR, later ×5) · restaurant owner (dashboard user) · admin (`ALERT_EMAIL`, dense operational, raw ids acceptable) · partner applicants (restaurant, supplier, influencer, courier) · external supplier contact (purchase order) · creator.
