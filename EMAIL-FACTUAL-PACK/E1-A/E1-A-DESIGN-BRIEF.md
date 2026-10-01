# E1-A-DESIGN-BRIEF — the system, proven on three emails

## Goal
One global email design system contract for Grubano, demonstrated on AUTH_MAGIC_LINK, CONSUMER_ORDER_READY (pickup) and PARTNER_NEW_ORDER. The founder approves the **system**; the ~55 other emails are then designed as instances of it (E1-B/C/D, E2, E3) with no new visual language.

## What each representative must prove

### AUTH_MAGIC_LINK (ACTION REQUIRED · consumer + every partner role)
- Header + brand; headline "Connexion à Grubano" (formal French — current copy tutoie, change register); one primary button « Me connecter » on an absolute link; **a visible copyable URL under the button** (survives clients that strip button styles — a real bug already happened); expiry sentence "valable 15 minutes, utilisable une seule fois"; "si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail"; footer with support.
- **Code state** (dormant, flag `AUTH_EMAIL_OTP_ENABLED`): adds a 6-digit code block (mono, large, AA contrast, also in plain text) with "valable 10 minutes" — the current copy says 15 (wrong).
- Plain-text part: greeting, the URL on its own line, the code if any, validity, ignore-if-not-you.
- No status chip needed beyond the ACTION REQUIRED semantic; no order components.

### CONSUMER_ORDER_READY — pickup (ACTION REQUIRED → the customer must come)
- Status band "Votre commande est prête" (SUCCESS/ACTION hybrid — the customer must act: come to the restaurant); restaurant block (name; address/hours are **not passed today** — design the block with an "if available" slot flagged "requires data"); reference block `GR-ABC123` prominent (this is what the customer shows at the counter; the pickup pass page exists at `/eat/order/[id]/pickup` — a CTA « Voir mon pass de retrait » is a legitimate proposal, flag "link not passed today"); no items/amount (status-only by design — or a conditional items slot flagged "requires data").
- **Dormant delivery variant** (OUT-OF-BETA): "prête, part bientôt en livraison" — design once, label loudly, never as live.
- Never: ETA, "arrive bientôt", courier, delivery fee.

### PARTNER_NEW_ORDER (ACTION REQUIRED · URGENT tone, restaurant owner)
- Dense operational hierarchy readable in 5 seconds on a phone: "Nouvelle commande payée à accepter" · `GR-ABC123` · items table (qty × name) · mode « Click & collect » · amount « 25,50 € » (server value) · CTA « Ouvrir le tableau de bord » (path `/orders` — flag "link not passed today", today the copy only says "Retrouvez-la dans votre tableau de bord").
- Explain nothing about payment mechanics; no consumer name (privacy — not passed); no time promise.
- Product truth (CURRENT): new paid-order restaurant notifications are **server-side reachable and do not require any browser tab to remain open** — the design may state « commande payée » as a fact (payment is confirmed server-side before this email exists).

## System components to settle (contract)
1. Document shell (`<!doctype>`, `<html lang dir>`, `<title>`, hidden preheader, 600 px card on `#FBF8F3`, 320/390/600/desktop).
2. Header band (symbol PNG + wordmark as text; optional restaurant name line).
3. Status band — SUCCESS (basil) · ACTION REQUIRED (zest) · NEUTRAL (ink/muted) · WARNING (`#EA9410`) · URGENT (`#E0402E`); text + glyph + colour, never colour alone.
4. Reference block (`GR-XXXXXX`, mono/bold, copy-friendly).
5. Restaurant block (name; optional address/hours/phone slots).
6. Order lines table (qty × name; total row optional).
7. Key/value rows.
8. Buttons — primary (bulletproof, AA), secondary text link, copyable raw URL pattern.
9. Code block (6 digits).
10. Note / helper text ≥ 14 px, muted `#6B7682`.
11. Support block + footer (identity, why-you-receive-this, `contact@grubano.com`; **no unsubscribe on transactional emails**).
12. Plain-text pattern; subject/preheader pattern (≤ 60 / ≤ 90 chars, no emoji, reference + restaurant where relevant).
13. RTL + dark-mode notes; images-off behaviour (text carries everything).

## Acceptance for E1-A
Contract published · 3 emails × states rendered at 320/390/600/desktop · images-off + plain-text views · components sheet · subject/preheader table · formal French · no truthfulness violation (no delivery/ETA as live, correct validities, no fee/delay/guarantee, `GR-` only) · AA contrast on body and CTA text.
