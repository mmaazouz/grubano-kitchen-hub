# E1-A FACTUAL PATCH — 2026-09-06 (NOT a visual reopening)

Founder approval of the E1-A visual system stands unchanged (colours, CTA treatment, typography, layout, spacing, components untouched).

**Real factual system problem found by measuring current code:** the approved E1-A stated « lien 10 minutes » (magic link) while the code contract is:

| Mechanism | Code constant | Value |
|---|---|---|
| Magic link | `lib/magic-link.ts` `MAGIC_TTL_MS = 15 * 60 * 1000` | **15 min** |
| 6-digit code (login OTP, step-up, email-change code) | `lib/email-otp.ts` `OTP_TTL_MS = 10 * 60 * 1000` | **10 min** |
| Password reset link | `app/api/auth/forgot-password/route.ts` `TOKEN_TTL_MS = 60 * 60 * 1000` | 1 h |
| Email-change confirmation link | `lib/email-change.ts` `EMAIL_CHANGE_TTL_MS = 15 * 60 * 1000` | 15 min |
| Partner e-mail verification link | `lib/partner-verification.ts` `TOKEN_TTL_MS = 24 * 60 * 60 * 1000` | 24 h |

**Smallest correction applied (text only):** preheader and validity sentence of the magic-link reference (`emails/auth-magic-link.html`), the same strings in `E1-A-email-gallery.html`, the preheader cell and the validity note in `E1-A-DESIGN-MANIFEST.md`. The code-block component (`E1-A-components.html`, « Valable 10 minutes ») is correct and unchanged. The dormant combined state must read: « Ce lien est valable 15 minutes et ce code 10 minutes ; chacun ne fonctionne qu'une seule fois. » — never one duration for both.

Live product copy was aligned the same day (`lib/auth-email-copy.ts` derives the sentence from the two constants).
