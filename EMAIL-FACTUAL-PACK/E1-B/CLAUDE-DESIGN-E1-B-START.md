# CLAUDE DESIGN — E1-B START · AUTH & ACCOUNT FAMILY ON THE APPROVED GRUBANO EMAIL SYSTEM

You are Claude Design. This bundle is **self-contained**: nothing is missing and nothing must be requested from the founder.

| Status | Value |
|---|---|
| APPROVED E1-A SYSTEM | **PRESENT** — `APPROVED-E1-A-SYSTEM/` holds the founder-approved contract, components sheet, design manifest, gallery and the three HTML references (with a text-only factual patch, see below) |
| AUTH FACTS | **CURRENT** (measured in code on 2026-09-06) |
| TRUTHFULNESS HOTFIX | **APPLIED** in the live product on 2026-09-06 — the `current-renders/` fossils are post-hotfix |
| E1-B MISSION | **AUTH / ACCOUNT FAMILY ONLY** |

Read in this order: this file → `APPROVED-E1-A-SYSTEM/CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md` and `E1-A-components.html` (your only visual authority) → `EMAIL-DESIGN-SYSTEM-FACTS.md` (binding product facts, short) → `E1-B-DESIGN-BRIEF.md`. Depth: `E1-B-MANIFEST.md` (the 10 emails), `E1-B-COPY.md` (post-hotfix copy verbatim), `E1-B-DATA-CONTRACTS.md`, `E1-B-CURRENT-VISUALS.md` + `current-renders/` (today's emails — fossils, not references).

## GATE STATUS (founder, 2026-09-06)
The E1-A system contract is **APPROVED TO CONTINUE**. Visual polish is **deferred**. Known reservation: the CTA treatment is acceptable but not fully convincing visually — **use it exactly as specified**; you may add a one-line "CTA note" per email in your design manifest, nothing more. **Do not reopen or redesign the system.** If an auth email needs a component or rule the contract cannot express, stop and report it in `E1-B-SYSTEM-FEEDBACK.md` as a *system problem* instead of improvising.

**E1-A factual patch (not a visual reopening):** the approved magic-link reference said « lien 10 minutes »; the code contract is **link 15 minutes, code 10 minutes** (`APPROVED-E1-A-SYSTEM/E1-A-FACTUAL-PATCH-2026-09-06.md`). The embedded reference, gallery and manifest already carry the corrected text. Use these two durations everywhere they apply.

## MISSION
Design the **remaining auth / account emails** as instances of the approved system — family-specific adaptation only. No new visual language, button system, footer, colour usage or status semantics.

| # | Email | State | What it is |
|---|---|---|---|
| 1 | AUTH_MAGIC_LINK_WITH_OTP | DORMANT (switch off) — the code state of E1-A's magic link | link **15 min** + 6-digit code **10 min**; the live sentence is « Ce lien est valable 15 minutes et ce code 10 minutes ; chacun ne fonctionne qu'une seule fois. » |
| 2 | AUTH_PASSWORD_RESET | CURRENT (password accounts only) | reset link, **1 hour**, single use |
| 3 | AUTH_PASSWORD_CHANGED | CURRENT | security notice after a reset |
| 4 | CONSUMER_WELCOME | CURRENT | account created and active (no verification step); live copy is formal, promises only Click & collect + points fidélité, CTA on the deployment base |
| 5 | AUTH_STEPUP_CODE | DORMANT | 6-digit code before a sensitive partner action (withdraw / bank details / email change), **10 min** |
| 6 | ACCOUNT_EMAIL_CHANGE_CODE | DORMANT | 6-digit code to the **current** address, **10 min** |
| 7 | ACCOUNT_EMAIL_CHANGE_LINK | DORMANT | confirmation link to the **new** address, **15 min**, single use |
| 8 | ACCOUNT_EMAIL_CHANGED_ALERT | DORMANT | security alert to the **old** address (new address masked) — the design adds the support channel |
| 9 | ACCOUNT_EMAIL_CHANGE_CONFIRM | DORMANT | the new address is now the login address |
| 10 | ACCOUNT_EMAIL_ALREADY_USED | DORMANT | anti-enumeration notice to the holder of an address someone tried to attach |

Dormant emails are real product code behind a switch that is off in the closed beta: design them fully, label them DORMANT, never present them as live.

## PRODUCT TRUTH (non-negotiable)
Formal French (vouvoiement) · **CLICK & COLLECT IN · DELIVERY OUT · SUR PLACE OUT** (never promise table booking or delivery) · validities exactly as above, all single use · every security email names the support channel `contact@grubano.com` and says what to do if it wasn't you · no marketing, no unsubscribe on these transactional emails · never expose database ids · status never by colour alone · no invented URLs (the only links are the mechanism links themselves and the app entry `…/eat`).

## PRODUCTION CONSTRAINTS (same as E1-A)
600–640 px; 320 / 390 / 600 / desktop; email-safe HTML (tables where needed, inline CSS, no JavaScript, system fonts, bulletproof buttons, `<html lang="fr">`, `<title>`, hidden preheader, `alt` on images, images-off resilient, AA contrast, one `<h1>`, dark-mode tolerant, RTL-ready layout). Codes and links must also appear in the plain-text part; the copyable raw-URL pattern from E1-A applies to every link email.

## REQUIRED OUTPUTS
1. `E1-B-DESIGN-MANIFEST.md` — the 10 emails × states (CURRENT / DORMANT), subject + preheader recommendation (FR), components used from the contract, CTA hierarchy (+ optional one-line CTA note), conditional states (empty name, code present/absent, masked address), plain-text recommendation.
2. `E1-B-email-gallery.html` — every email at 320 / 390 / 600 / desktop, plus images-off and plain-text views.
3. **Ten deterministic HTML email references** on the approved contract, using the fixture data in `E1-B-COPY.md` (Léa Martin, `lea.martin@example.invalid`, code `424242`, new address masked `l***@e***`).
4. `E1-B-SYSTEM-FEEDBACK.md` — empty if nothing, otherwise only **real system problems**. Taste remarks go to the CTA note field, not here.

## DO NOT
Design consumer order, partner, claims, refunds, safety, onboarding, courier, reservation or franchise emails (E1-C, E1-D, E2, E3). Do not implement, deploy or send anything. Do not touch the contract. Do not ask the founder for any file — everything is here.
