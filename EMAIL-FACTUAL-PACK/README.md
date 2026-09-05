# EMAIL-FACTUAL-PACK — Grubano complete email product, factual pack for Claude Design

Established 2026-09-05 (`develop @ d221008`), read-only on the product. Purpose: give Claude Design everything it needs to design the whole Grubano email system in **three autonomous tranches**, without archaeology and without inventing emails.

## Core (shared facts — load selectively)
| File | What |
|---|---|
| `EMAIL-MANIFEST.md` | 60 candidates, one row each, status A–E + maturity + trigger + send + template + subject + recipient + CTA + contract + reachability + beta + tranche |
| `EMAIL-TRIGGER-MAP.md` | event → condition → code path → send → recipient → template → provider, with skip / failure / retry / dedupe |
| `EMAIL-COPY-VERBATIM.md` | current copy captured from deterministic renders (generated) + text-only cron templates + ×5 locale tables |
| `EMAIL-DATA-CONTRACTS.md` | required / optional / nullable / derived fields, formatting rules, source of truth |
| `EMAIL-INFRASTRUCTURE.md` | Nodemailer → o2switch Exim, identity, env, format, send semantics, defects |
| `EMAIL-DELIVERABILITY.md` | SPF / DKIM / DMARC / PTR / alignment facts, external-proof gate, severity |
| `EMAIL-AUTH-FACTS.md` | magic link, codes, password reset, welcome, partner verify, email change |
| `EMAIL-CLAIMS-REFUNDS-FACTS.md` | WIRED vs PRODUCT-CONFIRMED vs PROPOSAL, wording rules, refresh checklist |
| `EMAIL-CURRENT-VISUALS.md` + `current-gallery.html` + `current-renders/` | 60 fossils (html/json/txt) + 120 PNG (600/390) |
| `EMAIL-DESIGN-SYSTEM-FACTS.md` | **short** — brand tokens, assets, reference, voice, product boundaries, status semantics, truthfulness, email-safe rules (load in every design session) |
| `EMAIL-TRUTHFULNESS-REGISTER.md` | 24 findings, P0/P1/P2 |
| `EMAIL-DEAD-ORPHAN-REGISTER.md` | dead sends, orphan templates, duplicates, inert schedulers |
| `CLAUDE-CODE-IMPLEMENTATION-HANDOFF.md` | future implementation lots, tests, deliverability lot |

## Tranches (each self-contained: HANDOFF · MANIFEST · COPY · DATA-CONTRACTS · CURRENT-VISUALS · DESIGN-BRIEF)
- `E1/` — global email design system + auth + consumer order lifecycle + partner new order → produces `CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md` (authority for E2/E3).
- `E2/` — claims / refunds / safety / admin money review (WIRED vs CONTRACT vs PROPOSAL tagged).
- `E3/` — onboarding, partner approval, secondary account, courier waitlist, reservations (OUT), supplier PO, ops recaps.

## Tools (read-only, reusable for the implementation lot)
- `tools/render-current.test.ts` + `tools/vitest.config.ts` — deterministic renders, mocked transport + DB: `npx vitest run --config EMAIL-FACTUAL-PACK/tools/vitest.config.ts`
- `tools/screenshot.mjs` — headless Chrome 600/390 px PNGs
- `tools/build-copy-and-gallery.mjs` — regenerates COPY-VERBATIM, CURRENT-VISUALS, gallery

## Safety statement
No email was sent to anyone. No DNS, flag, Stripe, Claims, Refund, auth or product behaviour was changed. Recipients in every artefact are `*.example.invalid`. No secret value appears in this folder.
