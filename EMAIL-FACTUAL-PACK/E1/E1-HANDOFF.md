# E1-HANDOFF — Claude Design tranche 1: GLOBAL EMAIL DESIGN SYSTEM + AUTH + CONSUMER ORDER LIFECYCLE + PARTNER CORE ORDER

> Self-contained. Load with `../EMAIL-DESIGN-SYSTEM-FACTS.md` (short, binding). Everything else in this folder is optional depth: `E1-MANIFEST.md` (13 emails, status + trigger + recipient), `E1-COPY.md` (current copy verbatim), `E1-DATA-CONTRACTS.md` (fields), `E1-CURRENT-VISUALS.md` (16 fossils + PNGs), `E1-DESIGN-BRIEF.md` (what to produce). Source facts are file:line-anchored in the core pack if you need to verify one.
>
> **You are designing (a) the Grubano email design system and (b) the first 13 emails on it.** You are **not** touching Claims, Refunds, admin money alerts, onboarding, reservations, courier or supplier emails (E2/E3). Do not invent emails that do not exist in `E1-MANIFEST.md`.

## 1 · What exists today (facts you design against)
- One transactional rail sends all 13 emails from `"Grubano" <contact@grubano.com>` over the o2switch SMTP; HTML fragments, **no images, no logo, no preheader, no `<html>` wrapper**, plain-text part only for the magic link; FR only; legacy colours `#F97316` / `#1a1a2e`; 480 px column; status = heading text + "✓" + orange.
- Idempotent per (event, order): each status is its **own email**, so the system is "one shell × many states", never a digest.
- Reference `GR-XXXXXX` everywhere; amounts "12,50 €"; dates "samedi 12 septembre à 19:30".
- Audiences: consumer (FR now, ×5 later, RTL-capable), restaurant owner (dashboard user), all partner roles for the magic link.

| ID | Status | Reachable in beta | One-line role |
|---|---|---|---|
| AUTH_MAGIC_LINK | A | yes | passwordless sign-in link (15 min, single-use), every role, tutoiement today |
| AUTH_MAGIC_LINK_WITH_OTP | B (flag `AUTH_EMAIL_OTP_ENABLED`) | no | same email + 6-digit code (**10 min**, copy wrongly says 15) |
| AUTH_PASSWORD_RESET | A | yes (password accounts only) | reset link 1 h single-use |
| AUTH_PASSWORD_CHANGED | A | yes | security notice after reset |
| CONSUMER_WELCOME | A | yes | account created & active (no verification step); CTA hardcoded to production; promises table reservation (OUT) |
| CONSUMER_ORDER_CONFIRMATION | A | yes | paid order recap (items, total, mode), CTA « Suivre ma commande »; fired by the checkout poll, never by the webhook |
| PARTNER_NEW_ORDER | A | yes (depends on the consumer's poll; server sweep unscheduled) | restaurant: new paid order, items, mode, amount |
| CONSUMER_ORDER_ACCEPTED | A | yes | restaurant accepted / preparing |
| CONSUMER_ORDER_READY | A | yes | ready — pickup wording ("venir la récupérer"); delivery wording exists but delivery is OUT |
| CONSUMER_ORDER_ENROUTE | A | reachable but **must not be designed as live** (delivery OUT; P0 truthfulness T1) | "en route" |
| CONSUMER_ORDER_COMPLETED | A | yes | récupérée (pickup) / livrée (delivery OUT); invite to rate; loyalty points credited but not mentioned |
| CONSUMER_ORDER_CANCELLED_GENERIC | A | yes (unpaid orders) | neutral cancellation, "contactez le restaurant" |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF | A | yes (**the live beta money-adjacent email**) | paid order cancelled → refund handled by support `contact@grubano.com`, quote `GR-…`; localized ×5 today |

## 2 · Truthfulness constraints for E1 (from `../EMAIL-TRUTHFULNESS-REGISTER.md`)
- **No delivery states as live** (delivery OUT). Design pickup as the primary flow; provide the delivery/en-route variants as **dormant states** clearly labelled "OUT OF BETA — do not enable", with no ETA ("arrive bientôt" is forbidden).
- Welcome: no "réserver une table" promise; CTA must use the deployment base URL (staging ≠ prod).
- Magic link + code: code validity 10 min, link 15 min — state both correctly or neither.
- Paid cancellation (claims OFF): keep the exact product truth — money is handled by a human at support during the beta; **no** "remboursement effectué", **no** delay, **no** amount promise. Reference `GR-XXXXXX` must be quoted (the support flow relies on it).
- Completed: the points-earned figure is available at the call site (`Order.pointsEarned`) but **not passed today** — you may design an optional "points crédités" line **as a conditional state**, flagged "requires data plumbing".
- Never expose raw ids. Never colour-only status.

## 3 · Deliverables expected from E1
1. `CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md` — the **global authority** reused by E2/E3: tokens (from `../EMAIL-DESIGN-SYSTEM-FACTS.md §1`, AA-corrected for email), typography (system stack), layout grid (600–640 px, 320/390/600 breakpoints), components (header/logo band, status band with the 5 semantics SUCCESS · ACTION REQUIRED · NEUTRAL · WARNING · URGENT, key/value rows, order-lines table, CTA primary/secondary, code block, note, footer with identity + why-you-receive + support), states (images-off, RTL, dark-mode tolerance), copy rules (formal French, lexicon, truthfulness), subject/preheader pattern, plain-text pattern, accessibility rules.
2. Designed HTML references for the 13 emails (16 states incl. pickup/delivery-dormant variants) — email-safe (inline CSS, tables, no JS, system fonts, images with `alt`, bulletproof buttons).
3. `E1-gallery.html` — desktop (600) + mobile (390) states side by side, plus images-off and plain-text views.
4. Subject + preheader recommendations per email (FR), respecting the facts (reference in subject where useful, restaurant name, no ETA).
5. Component usage map + CTA hierarchy per email; conditional states list (empty name, empty items, pickup vs delivery-dormant, code present/absent, partial data).
6. Plain-text recommendation per email.

## 4 · Explicit OUT-OF-SCOPE for E1
Claims, refunds, admin/money alerts, safety (E2). Onboarding nudges, partner approval, email-change, step-up code, courier waitlist, reservations, supplier PO, creator/waitlist, cron recaps (E3). Any new email not in the manifest (e.g. payment-failed, receipt/invoice, loyalty-earned, partner cancellation) — you may list them as **future proposals** in one appendix, tagged DESIGN_PROPOSAL_NOT_YET_PRODUCT, nothing more. No implementation, no translation.

## 5 · Gate after E1
Founder visual / design-system approval → E2 starts and **must reuse** the contract without drift.
