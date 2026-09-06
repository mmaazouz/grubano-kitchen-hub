# CLAUDE DESIGN — E1-B START · AUTH & ACCOUNT FAMILY ON THE APPROVED GRUBANO EMAIL SYSTEM

You are Claude Design. This bundle is self-sufficient. Read in this order: this file → `APPROVED-E1-A-SYSTEM/` (the **approved** global contract and its components — your only visual authority) → `EMAIL-DESIGN-SYSTEM-FACTS.md` (binding product facts, short) → `E1-B-DESIGN-BRIEF.md`. Depth: `E1-B-MANIFEST.md` (the 10 emails, when they fire, who receives them), `E1-B-COPY.md` (current copy verbatim), `E1-B-DATA-CONTRACTS.md` (fields), `E1-B-CURRENT-VISUALS.md` + `current-renders/` (today's emails — fossils, not references).

## GATE STATUS (founder, 2026-09-06)
The E1-A system contract is **APPROVED TO CONTINUE**. Visual polish is **deferred**. Known reservation: the CTA treatment is acceptable but not fully convincing visually — **use it as specified anyway**; you may add a one-line "CTA note" per email in your design manifest, nothing more. **Do not reopen or redesign the system.** If (and only if) an auth email needs a component or rule the contract cannot express, stop and report it as a *system problem* instead of improvising.

## MISSION
Design the **remaining auth / account emails** as instances of the approved system — family-specific adaptation only. No new visual language, button system, footer, colour usage or status semantics.

| # | Email | State today | What it is |
|---|---|---|---|
| 1 | AUTH_MAGIC_LINK_WITH_OTP | DORMANT (feature switch off) — already designed as the code state of E1-A's magic link | reuse; confirm the code block reads "valable 10 minutes" (link 15) |
| 2 | AUTH_PASSWORD_RESET | CURRENT (password accounts only) | reset link, 1 hour, single use |
| 3 | AUTH_PASSWORD_CHANGED | CURRENT | security notice after a reset |
| 4 | CONSUMER_WELCOME | CURRENT | account created and active (no verification step) |
| 5 | AUTH_STEPUP_CODE | DORMANT (feature switch off) | 6-digit code before a sensitive partner action (withdraw / bank details / email change), 10 minutes |
| 6 | ACCOUNT_EMAIL_CHANGE_CODE | DORMANT (feature switch off) | 6-digit code to the **current** address, 10 minutes |
| 7 | ACCOUNT_EMAIL_CHANGE_LINK | DORMANT | confirmation link to the **new** address, 15 minutes, single use |
| 8 | ACCOUNT_EMAIL_CHANGED_ALERT | DORMANT | security alert to the **old** address (new address shown masked) |
| 9 | ACCOUNT_EMAIL_CHANGE_CONFIRM | DORMANT | the new address is now the login address |
| 10 | ACCOUNT_EMAIL_ALREADY_USED | DORMANT | anti-enumeration notice to the holder of an address someone tried to attach |

Dormant emails are real product code behind a switch that is off in the closed beta: design them fully, label them DORMANT, never present them as live.

## PRODUCT TRUTH (non-negotiable)
Formal French (vouvoiement — the current welcome and magic-link copy tutoie: change register) · `GR-XXXXXX` is the only order reference (not used in this family) · **CLICK & COLLECT IN · DELIVERY OUT · SUR PLACE OUT** — the welcome email currently promises « réserver une table »: **remove that promise**; say what the beta offers (commander en Click & collect, points fidélité) · validities exactly: magic link 15 min, reset link 1 h, email-change link 15 min, every code 10 min, all single use · every security email names the support channel `contact@grubano.com` and says what to do if it wasn't you · no marketing, no unsubscribe on these transactional emails · welcome CTA goes to the app (the base URL is set at implementation, never hardcoded to production) · never expose database ids · status never by colour alone.

## PRODUCTION CONSTRAINTS (same as E1-A)
600–640 px; 320 / 390 / 600 / desktop; email-safe HTML (tables where needed, inline CSS, no JavaScript, system fonts, bulletproof buttons, `<html lang="fr">`, `<title>`, hidden preheader, `alt` on images, images-off resilient, AA contrast, one `<h1>`, dark-mode tolerant, RTL-ready layout). Codes and links must also be present in the plain-text part; the copyable raw-URL pattern from E1-A applies to every link email.

## REQUIRED OUTPUTS
1. `E1-B-DESIGN-MANIFEST.md` — the 10 emails × states (CURRENT / DORMANT), subject + preheader recommendation (FR), components used from the contract, CTA hierarchy (+ optional one-line CTA note), conditional states (empty name, code present/absent, masked address), plain-text recommendation.
2. `E1-B-email-gallery.html` — every email at 320 / 390 / 600 / desktop, plus images-off and plain-text views.
3. **Ten deterministic HTML email references** on the approved contract, using the fixture data in `E1-B-COPY.md` (Léa Martin, `lea.martin@example.invalid`, code `424242`, new address masked `l***@e***`).
4. `E1-B-SYSTEM-FEEDBACK.md` — empty if nothing, otherwise only **real system problems** (a component or rule the contract cannot express). Taste remarks go to the CTA note field, not here.

## DO NOT
Design consumer order, partner, claims, refunds, safety, onboarding, courier, reservation or franchise emails (E1-C, E1-D, E2, E3). Do not implement, deploy or send anything. Do not touch the contract.
