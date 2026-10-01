# CLAUDE DESIGN — E1-A START · GRUBANO GLOBAL EMAIL DESIGN SYSTEM

You are Claude Design. This bundle is complete and self-sufficient. Read this file first, then `EMAIL-DESIGN-SYSTEM-FACTS.md` (binding facts, short), then `E1-A-DESIGN-BRIEF.md`. The other files are depth: `E1-A-MANIFEST.md` (what the 3 emails are, when they fire, who receives them), `E1-A-COPY.md` (current copy verbatim), `E1-A-DATA-CONTRACTS.md` (which fields exist), `E1-A-CURRENT-VISUALS.md` + `current-renders/` (what the emails look like today — fossils, not references). Every fact is measured on the product; nothing here is a guess.

## MISSION
**Create the global Grubano email design system** — one contract every future Grubano email will reuse — and prove it on exactly **three** representative emails:

| Class | Email | Why this one |
|---|---|---|
| AUTH | **AUTH_MAGIC_LINK** — the passwordless sign-in link, sent to every role (consumers, restaurants, partners). Two states: link only (live), link + 6-digit code (gated, dormant). | the most-sent, most security-sensitive auth email: actionable button, copyable URL fallback, code block, expiry sentence, "ignore if not you". |
| CONSUMER ORDER | **CONSUMER_ORDER_READY (pickup)** — « votre commande est prête, venez la récupérer ». | exercises status semantics, restaurant block, order reference `GR-XXXXXX`, pickup truth, CTA hierarchy; the delivery state is a labelled dormant variant. |
| PARTNER | **PARTNER_NEW_ORDER** — « nouvelle commande payée à accepter » to the restaurant owner. Mandatory. | operational urgency + actionability: reference, items, mode, amount, next action in the dashboard. |

Design **only** the global system and these three emails (plus their explicitly listed states). Do **not** design: the other auth emails, the other consumer order emails, the other partner emails, claims, refunds, safety, onboarding, courier waitlist, franchise, reservations. Those come later (E1-B/C/D, E2, E3) and will **reuse your contract without drift**.

## PRODUCT TRUTH (non-negotiable)
- **CLICK & COLLECT IN · DELIVERY OUT · SUR PLACE OUT.** Only pickup is sold in the closed beta. Never write "livraison", "en route", "arrive bientôt", an ETA, courier tracking or a delivery fee as a live state. A delivery variant may exist only as a clearly labelled **OUT-OF-BETA dormant** state.
- Canonical order reference **`GR-XXXXXX`** (never a database id, never a Stripe id).
- **Formal French** (vouvoiement) everywhere. Lexicon: « Click & collect », « restaurant » (never « établissement »), « retrait ».
- Amounts come from the server (e.g. « 25,50 € »); never invent fees, delays or guarantees. Loyalty points are not surfaced today — an optional points line may be designed only as a conditional state flagged "requires data".
- Magic link: valid **15 minutes**, single use; the optional code: valid **10 minutes** (say both correctly or say neither).
- Support channel promised in copy: `contact@grubano.com`. Replies to emails land in that mailbox.
- New paid-order restaurant notifications are **server-side reachable and do not require a browser tab to remain open** (CURRENT). PARTNER_NEW_ORDER is therefore a reliable operational alert; any older wording about "browser polling" is PRE-FIX / HISTORICAL.
- Feature state for context only (never design around switches): refunds frozen, courier tips off, courier **waitlist** open (courier operations OUT), reservations (« sur place ») OUT.
- Status must never be communicated by colour alone.

## DESIGN QUALITY
Premium, warm, food-first, professional, trustworthy. Not startup-gimmicky, not visually noisy, no emoji in body copy. ZEST orange `#FF6A1F` accent (AA-correct in email: dark text on zest, or white on `#F2570E`), INK navy `#0F2742` voice, BASIL green `#2BA45C` success, warm off-white `#FBF8F3` ground, white cards, system font stack (Gabarito / Hanken Grotesk are web-only). Exact tokens in `EMAIL-DESIGN-SYSTEM-FACTS.md §1`. Asset: `public/brand/grubano-symbol-color.svg` (symbol only — export a PNG; there is no wordmark file, set the name as text).

## PRODUCTION EMAIL CONSTRAINTS
600–640 px container; responsive at **320 / 390 / 600 / desktop**; email-safe HTML: tables where alignment matters, inline CSS, no JavaScript, no web fonts required, bulletproof buttons, `<html lang="fr">`, `<title>`, hidden preheader, images with `alt`, images-off resilience, plain-text alternative, AA contrast, one `<h1>`, dark-mode resilience where practical, RTL-ready layout (Arabic exists in two other families).

## SYSTEM SCOPE (what the contract must settle)
layout · grid · width · header + logo · typography · spacing · colour hierarchy · buttons (primary/secondary) · status chips/bands (SUCCESS · ACTION REQUIRED · NEUTRAL · WARNING · URGENT) · cards · order-details table · restaurant block · reference block · code block · support block · footer · mobile behaviour · images-off behaviour · plain-text structure · subject/preheader pattern · formal French tone rules.

## REQUIRED OUTPUTS
1. `CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md` — the global authority (tokens, components, states, copy rules, accessibility, subject/preheader/plain-text patterns).
2. `E1-A-DESIGN-MANIFEST.md` — the 3 emails × their states, subject + preheader recommendation, components used, CTA hierarchy, conditional states, plain-text recommendation.
3. `E1-A-email-gallery.html` — the 3 emails at 320 / 390 / 600 / desktop, plus images-off and plain-text views.
4. `E1-A-components.html` — the component sheet (every component, every status semantic).
5. **Three deterministic HTML email references** (email-safe, using the fixture data in `E1-A-COPY.md`: Léa Martin, Gnocchi Bar, `GR-ABC123`, 25,50 €, 2× Gnocchi 4 fromages + 1× Tiramisu maison) — plus the dormant delivery variant of READY and the code state of the magic link, each labelled.

## GATE
Founder visual approval of the **system** (not of thirty templates) is required before any implementation and before E1-B/C/D, E2, E3 start. Do not implement anything in the product; do not send anything.
