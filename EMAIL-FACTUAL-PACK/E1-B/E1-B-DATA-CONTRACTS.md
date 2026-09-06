# E1-B-DATA-CONTRACTS — fields available to the auth / account emails

Base URL = deployment origin (staging `https://app.grubano.com`; the welcome CTA follows it since the 2026-09-06 hotfix). No order data in this family. All codes are 6 digits; all links are absolute and single use.

| Email | Passed today | Conditional / nullable | Available but NOT passed (needs plumbing) |
|---|---|---|---|
| AUTH_MAGIC_LINK_WITH_OTP | `to`, `link`, `code` | `name` (empty → « Bonjour, ») | recipient locale |
| AUTH_PASSWORD_RESET | `to`, `name`, `resetUrl` (absolute; today carries token + email + space in the query) | — | expiry timestamp (1 h constant) |
| AUTH_PASSWORD_CHANGED | `to`, `name` | — | date/time, device, IP (not tracked) |
| CONSUMER_WELCOME | `to`, `name` | — | loyalty balance (0 at signup) |
| AUTH_STEPUP_CODE | `to`, `code`, `purpose` → label (confirmer un retrait / modifier vos informations bancaires / modifier l'e-mail de votre compte; fallback « confirmer une action sensible ») | — | expiry timestamp (10 min constant) |
| ACCOUNT_EMAIL_CHANGE_CODE | `to` (current address), `code` | — | — |
| ACCOUNT_EMAIL_CHANGE_LINK | `to` (new address), `link` | — | expiry (15 min constant) |
| ACCOUNT_EMAIL_CHANGED_ALERT | `to` (old address), `newEmailMasked` (`l***@e***`) | — | date/time; support address may be hardcoded (`contact@grubano.com` is the product channel) |
| ACCOUNT_EMAIL_CHANGE_CONFIRM | `to` (new address) | — | — |
| ACCOUNT_EMAIL_ALREADY_USED | `to` (existing holder) | — | — |

Idempotency facts that shape states: codes and links are never de-duplicated (a re-request re-sends); password reset/changed never de-duplicated (legitimate repeats); email-change notices once per change; already-used notice at most once per address ever.

Conditional states: empty name · code present/absent · masked address · long URL wrapping · RTL readiness · dark mode · images-off · plain text.
