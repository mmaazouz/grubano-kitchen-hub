# EMAIL TRUTHFULNESS HOTFIX — 2026-09-06 (auth + refund e-mails; refund rehearsal e-mail contract)

Scope: copy and data-binding truth only. No auth mechanism, token lifetime, refund engine, Stripe, loyalty, flag or visual change.

## Measured validity contracts (source of truth for every e-mail sentence)

| Mechanism | Constant | Value |
|---|---|---|
| Magic link | `lib/magic-link.ts` `MAGIC_TTL_MS` | 15 min |
| 6-digit code (login OTP · step-up · email-change code) | `lib/email-otp.ts` `OTP_TTL_MS` | 10 min |
| Password reset link | `app/api/auth/forgot-password/route.ts` `TOKEN_TTL_MS` | 1 h |
| Email-change confirmation link | `lib/email-change.ts` `EMAIL_CHANGE_TTL_MS` | 15 min |
| Partner verification link | `lib/partner-verification.ts` `TOKEN_TTL_MS` | 24 h |

`lib/auth-email-copy.ts` derives the magic-link sentence from the first two: « Ce lien est valable 15 minutes et ne fonctionne qu'une seule fois. » / with a code: « Ce lien est valable 15 minutes et ce code 10 minutes ; chacun ne fonctionne qu'une seule fois. »

## Auth fixes (live)
Formal French on magic link, welcome, partner verify (subjects + bodies + text parts) · welcome: no « réserver une table », CTA on the `NEXTAUTH_URL` base, name escaped · generic magic-link message in formal French · `lib/mail-transport-config.ts`: when `SMTP_PASS` is absent, magic-link / forgot-password / partner-register answer **503 `mail_unavailable`** before any lookup (global config fact → no enumeration signal; a pending partner account is never created un-activatable).

## Refund e-mail fixes (live code, engine untouched)
- Template `sendRefundConfirmation`: neutral actor (« Votre remboursement … est confirmé … renvoyé sur le moyen de paiement utilisé pour votre commande chez {resto} »), no numeric bank delay, cash only (loyalty restoration is never presented as cash).
- Engine routes (`orders/[id]/refund`, `admin/refunds/run`): unchanged contract — e-mail only after Stripe `succeeded` (202 pending → no e-mail), amount = engine `result.amountCents` (the refund's cash amount, finalized only on `succeeded`).
- Claims: `RefundTriggerResult` `refunded` now carries `amountCents` (engine actual); the arbitrate and auto-small e-mails use it, never `Claim.requestedAmountCents`.
- Rail A (`tickets/[id]/refund`, `reservations/[id]/refund-deposit`): `refundPayment` returns ok on Stripe **acceptance**; the e-mail is now guarded by `result.refund.status === 'succeeded'` and uses `result.refund.amount`; the deposit route gains the dedupe key `resv:<id>:<cents>`.

## Phase 2 refund rehearsal — e-mail contract
**REFUND EMAIL SAFE FOR THE REHEARSAL = YES → SEND IF STRIPE SUCCEEDED.** The consumer receives exactly one « Votre remboursement partiel est confirmé — {resto} » e-mail carrying the ACTUAL Stripe cash amount of the succeeded refund (whatever the engine refunds, read from the result — never a hard-coded figure); pending/failed produce no consumer e-mail (admin MONEY REVIEW only). No temporary e-mail suppression is needed for copy reasons. Nothing in this hotfix moves money; `REFUNDS_ENABLED` stays false until the founder's rehearsal authorisation.

## Tests
`tests/email-truthfulness-hotfix.test.ts` (17): validity constants + sentences; magic link formal French, 15/10 distinction, 503 without transport, formal generic message; welcome (no table promise, base URL, subject, EmailLog subject); partner verify (formal, 24 h, 503 before account creation); forgot-password 503; refund template (actor, delay, amount format, no loyalty wording); source scans (engine routes pending branch before e-mail, rail A guard + amount, claims engine amount, template code free of the old strings); rail A route behaviour pending/succeeded/failed with the Stripe amount ≠ estimate.
