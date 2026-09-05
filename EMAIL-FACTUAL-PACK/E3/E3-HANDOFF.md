# E3-HANDOFF — Claude Design tranche 3: SECONDARY ACCOUNT · RESTAURANT ONBOARDING · PARTNER APPROVAL/REJECTION · COURIER WAITLIST · RESERVATIONS (OUT) · OTHER OPS

> Self-contained. Load `../EMAIL-DESIGN-SYSTEM-FACTS.md` + the E1 contract `CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md` (mandatory) + the E2 admin sub-shell. Depth here: `E3-MANIFEST.md` (26 emails), `E3-COPY.md`, `E3-DATA-CONTRACTS.md`, `E3-CURRENT-VISUALS.md` (26 fossils), `E3-DESIGN-BRIEF.md`.
>
> Beta boundaries that shape this tranche: **courier waitlist IN, courier operations OUT**; **franchise OUT** (no franchise email exists except admin money kinds in E2 — nothing to design here); **reservations / sur place OUT** (code live, product out); **supplier / influencer / creator roles behind flags** (default OFF). Nothing below is a delivery lifecycle email — none exists.

## 1 · The set

| Group | ID | Status / gate | Audience | Role |
|---|---|---|---|---|
| Secondary account | AUTH_STEPUP_CODE | B `AUTH_MONEY_STEPUP_ENABLED` | partner | 6-digit code (10 min) before withdraw / bank / email change |
| | ACCOUNT_EMAIL_CHANGE_CODE | B `AUTH_EMAIL_CHANGE_ENABLED` | account | code to the **current** address (same visual as step-up) |
| | ACCOUNT_EMAIL_CHANGE_LINK | B | new address | confirm link (15 min, single-use) |
| | ACCOUNT_EMAIL_CHANGED_ALERT | B | old address | security alert (masked new address; no contact channel today) |
| | ACCOUNT_EMAIL_CHANGE_CONFIRM | B | new address | address now active |
| | ACCOUNT_EMAIL_ALREADY_USED | B | existing holder | anti-enumeration notice |
| Restaurant onboarding | PARTNER_EMAIL_VERIFY | **A** | restaurant applicant (business.grubano.com) | verify link 24 h; tutoiement today; base = request host |
| | ADMIN_PARTNER_PENDING | **A** (restaurant path) / flags for supplier, influencer, logistics | admin | new dossier to validate (role label) |
| | PARTNER_ACCOUNT_VALIDATED | **A** (restaurant) / flags | partner | account validated; no link today; « établissement » (lexicon ⛔) |
| | PARTNER_ACCOUNT_REJECTED | B (supplier/influencer flags; **no restaurant rejection route**) | partner | not validated + reason; re-decision re-notifies |
| | PARTNER_DOCS_NEEDED | B **no caller** (KYC step not a confirmed product contract) | partner | documents needed |
| | ONBOARDING_NUDGE_RESTAURANT / GENERIC | B `ONBOARDING_NUDGE_ENABLED` + scheduler inert | restaurant / other roles | J+1/J+3/J+7 reminders, ×5 locales, **unsubscribe link** (only family with one) |
| Courier waitlist | COURIER_WAITLIST_CONFIRMATION | **A** (flag `LOGISTICS_SIGNUP_ENABLED` required true; measured 404 on 2026-09-04 pending operator v3) | courier applicant | honest waitlist confirmation: no date, no revenue, no active account |
| Reservations (OUT) | CONSUMER_RESERVATION_CONFIRMED (+deposit) · PARTNER_NEW_RESERVATION · CONSUMER/PARTNER_RESERVATION_CANCELLED_BY_CLIENT · CONSUMER_RESERVATION_CANCELLED_BY_OWNER · …_BY_CLOSURE | **A** code, product OUT | guest / owner | table booking lifecycle; `#XXXX` session code; deposit paragraph conditional (V4-1) |
| | CONSUMER_NOSHOW_PENALTY_CHARGED | B `PUNITIVE_CAPTURE_ENABLED` (legal decision, OFF whole pilot) | guest | penalty charged + 30-day contest (unsupported) |
| Ops | OPERATOR_SUPPLIER_PURCHASE_ORDER | **A** | **external supplier contact** | purchase order table; raw id as reference; English money format |
| | CREATOR_DISH_ADOPTED | **A** (creator role gated elsewhere) | creator | recipe adopted, price, royalty % |
| | PARTNER_WAITLIST_OFFER | **A** | restaurant | city-exclusive recipe slot freed, TTL hours |
| | CRON_CREATOR_EARNINGS_RECAP · CRON_MONTHLY_INVOICES_RECAP | **A** (cPanel cron, text-only) | admin | ops recaps |

## 2 · Constraints
- **Courier**: keep the honest promise set exactly (registered on a waitlist, will be contacted when the zone opens, no account, no action). No mission/earnings/activation wording. No courier decision email exists (approval/rejection of a courier) — may be listed as a proposal only.
- **Franchise**: nothing to design; do not add.
- **Reservations**: design as **OUT-OF-BETA dormant states** on the same system (they are live code and will return post-beta); deposit copy must stay conditional ("peut être demandée … rien n'est débité"); the no-show penalty email must not claim "conditions annoncées" while the confirmation announces none (T10) — flag it "reactivation checklist".
- **Partner lifecycle**: add the missing CTA to the validated email (dashboard entry); « établissement » → « restaurant » (lexicon); rejection must carry the reason and the re-submit path; docs-needed only as a prepared state tagged "no caller".
- **Nudges**: the only family with unsubscribe — keep it (HMAC link) and never add unsubscribe to the transactional families. ICU plural on `steps` in 5 locales.
- **Supplier PO**: external audience (not a Grubano user) — B2B tone; reference should not be a raw cuid (propose a `PO-…` display ref as DESIGN PROPOSAL; today only `SupplierOrder.id` exists).
- **Security emails** (email change): must name a contact channel (support address) — today "contactez-nous immédiatement" has none.
- Formal French everywhere (partner verify currently tutoie).

## 3 · Deliverables
1. Designed HTML references for the 26 emails on the E1 contract (+ E2 admin sub-shell for ADMIN_PARTNER_PENDING and the two cron recaps as HTML+text proposals).
2. `E3-gallery.html` desktop/mobile + images-off + text.
3. Subject/preheader recommendations (FR), states: reason present/absent · deposit/none · closure reason · role labels (restaurant/fournisseur/influenceur/livreur) · steps plural · RTL.
4. Clear tags on every artefact: LIVE (A) · GATED (B) · OUT-OF-BETA · NO-CALLER · PROPOSAL.
5. Plain-text recommendation per email.

## 4 · OUT-OF-SCOPE
E1 and E2 emails; any delivery/courier operational email; franchise emails; Connect onboarding emails (none exist — proposal appendix only); translations; implementation.

## 5 · Gate
Founder approval → Claude Code implementation (`../CLAUDE-CODE-IMPLEMENTATION-HANDOFF.md`).
