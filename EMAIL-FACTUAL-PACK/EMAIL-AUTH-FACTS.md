# EMAIL-AUTH-FACTS — the authentication emails as they actually work

> Read first-hand on `develop` @ `d221008`. Nothing invented: there is **no** email-verification email for consumers, **no** "new device / login alert", **no** account-deletion email. Password reset exists only for accounts that still have a password.

## 1 · Mechanisms in force

| Mechanism | Who | Route | Email | Flag |
|---|---|---|---|---|
| **Magic link** (primary, passwordless) | consumers (`/eat/auth`, checkout sheet, `/eat/magic`), partners (`/auth/magic`, affiliate apply), suppliers on `business.grubano.com` | `POST /api/auth/magic-link` → `GET /{locale}/eat/magic?token=` or `/auth/magic?token=` | AUTH_MAGIC_LINK | none (always on) |
| Magic link **+ 6-digit code** in the same email | same | same, code verified by the OTP provider (`authorizeEmailOtpLogin`) | AUTH_MAGIC_LINK_WITH_OTP | `AUTH_EMAIL_OTP_ENABLED` (default OFF; staging NOT MEASURED) |
| Password (legacy credentials) | consumers who registered with a password; some operators | NextAuth CredentialsProvider (bcryptjs) | none on login | — |
| Password reset | password accounts | `POST /api/auth/forgot-password` → `/fr/eat/reset-password?token=&email=&space=` → `POST /api/auth/reset-password` | AUTH_PASSWORD_RESET, AUTH_PASSWORD_CHANGED | none |
| Consumer registration (welcome) | consumers | `POST /api/auth/register` | CONSUMER_WELCOME | none |
| Partner email verification | restaurant applicants | `POST /api/partners/register` (host `business.grubano.com`) → `GET /api/partners/verify-email?token=` promotes `pending → active` | PARTNER_EMAIL_VERIFY | none (host-gated) |
| Money step-up code | partners before withdraw / bank / email change | `POST /api/auth/step-up/request` | AUTH_STEPUP_CODE | `AUTH_MONEY_STEPUP_ENABLED` (OFF) |
| Account email change (3 steps) | any eligible account | `request-code` → `request` → `confirm` | ACCOUNT_EMAIL_CHANGE_* (5) | `AUTH_EMAIL_CHANGE_ENABLED` (OFF) |
| Login OTP standalone | — | — | **does not exist** as its own email (the code rides in the magic-link email) | — |

## 2 · AUTH_MAGIC_LINK — facts

| Fact | Value | Source |
|---|---|---|
| Sender | `"Grubano" <contact@grubano.com>` (inline transport) | `app/api/auth/magic-link/route.ts:108` |
| Subject | `Ton lien de connexion Grubano` | `:110` |
| Copy | see `EMAIL-COPY-VERBATIM.md` §AUTH. Register: **tu**. Headline "Connexion à Grubano". Button « Me connecter », visible raw URL fallback, optional code block. | `:84-95` |
| Text part | yes (`multipart/alternative`) | `:96-106` |
| Recipient resolution | body `email` → trim/lowercase → `operator.findUnique({email})`; **only `status==='active'`** gets a link; every other case returns the same generic JSON (anti-enumeration). | `:127-143` |
| Token | `createMagicLinkToken(operatorId)` → clear token in URL, **sha256 hash + expiry stored** on `Operator.magicLinkTokenHash/Expiry`; a new request overwrites the previous (single live token). | `lib/magic-link.ts:21-27` |
| Expiry | **15 minutes** (`MAGIC_TTL_MS`). Copy says "valable 15 minutes et ne fonctionne qu'une seule fois" — consistent. | `lib/magic-link.ts:17` |
| One-time | yes: verification consumes the token atomically (`updateMany` count===1 under concurrency). | `lib/magic-link.ts:55-60` |
| URL class | `https://{host}/{locale}/{eat/magic \| auth/magic}?token=<opId.secret>`. Host = request host **only if allow-listed** (`app.grubano.com`, `business.grubano.com`, `grubano.com`, or `ALLOWED_MAGIC_HOSTS`), else `NEXTAUTH_URL`/`APP_URL`/`https://grubano.com`. Never derived from an arbitrary Host header. | `:37-68` |
| Locale | path locale from body `locale` (validated against `@/i18n` locales, default `fr`) — **the email body itself is FR only**. | `:128-131` |
| Callback | `/{locale}/eat/magic` (consumer, `space:'eat'`) or `/{locale}/auth/magic` (operators) → the page posts the token to the verify endpoint → NextAuth session → role redirect. | `:135` |
| Success path | active account → token minted → email sent (if `SMTP_PASS`) → generic `{ok:true, message}` (+ `otpEnabled:true` when the OTP flag is on — a global flag, no enumeration leak). | `:143-178` |
| Error paths | unknown/inactive email → generic; DB error → generic; mail error → generic (logged `[magic-link] non-fatal`); **`SMTP_PASS` missing → generic response but no email** (the UI says "un lien vient d'être envoyé" — untrue in that config). Rate-limit 5/10 min per IP → 429 when `RATE_LIMIT_ENABLED`. | `:122-124, :163-172` |
| Throttling of the code | OTP: max 5 codes per (email, purpose) / 10 min; a throttled code request never blocks the link. | `lib/email-otp.ts:29-30`, route `:155-161` |
| Client-facing message | `"Si un compte existe pour cet email, un lien de connexion vient d'être envoyé. Vérifie ta boîte de réception (et les spams)."` | `:70-73` |

## 3 · AUTH_MAGIC_LINK_WITH_OTP — delta
Same email; when `AUTH_EMAIL_OTP_ENABLED==='true'` and `issueEmailOtp(email,'login')` succeeds, the HTML adds "Le lien s'ouvre dans le mauvais navigateur ? Saisis plutôt ce code sur la page de connexion :" + a monospace 6-digit block, and the validity sentence becomes plural ("Ce lien et ce code sont valables 15 minutes…"). **Fact check:** the link is valid 15 min but the **code is valid 10 min** (`OTP_TTL_MS`) — the sentence over-states the code's validity by 5 minutes (see truthfulness register, P2). Code is 6 digits from `crypto.randomInt`, stored hashed (`sha256(pepper:purpose:email:code)`), max 5 verify attempts, superseded by a new issue.

## 4 · CONSUMER_WELCOME — facts
Sent **synchronously after** `operator.create` on `POST /api/auth/register` (name 2–80, email, password ≥ 8; role forced `consumer`, status `active` — no email verification step exists for consumers). Subject `Bienvenue sur Grubano — ton compte est prêt`. CTA « Découvrir les restaurants » → **hardcoded `https://grubano.com/eat`** (production, even from staging). Footer: "Si tu n'es pas à l'origine de cette inscription, réponds simplement à cet email." Own EmailLog row `consumer_welcome` (`sent|failed|skipped`). `name` is interpolated **without HTML escaping**. Duplicate email → 409 before any send.

## 5 · AUTH_PASSWORD_RESET / AUTH_PASSWORD_CHANGED — facts
- Only when the account row has a non-null `password`; otherwise identical 200 (no enumeration).
- Token: 32 random bytes hex; **only the sha256 is stored** in `VerificationToken` (identifier `pwreset:<email>`); all previous tokens for the identifier deleted first (single active token); TTL **1 h** (copy: "valable 1 heure et ne peut être utilisé qu'une seule fois" — consistent).
- Link: `{NEXTAUTH_URL}/fr/eat/reset-password?token=<clear>&email=<email>&space=<eat|…>` — **locale segment hardcoded `/fr/`**, email address travels in the query string (privacy/security note, register P2).
- After a successful reset: every token of the identifier deleted, then AUTH_PASSWORD_CHANGED (no dedupe by design; wording "Réinitialisez immédiatement … ou répondez à cet email").
- Both via the rail (EmailLog `password_reset_request`, `password_changed`); register **vous**.

## 6 · PARTNER_EMAIL_VERIFY — facts
`POST /api/partners/register` accepts `{name, email, consent:true, formStartedAt, password?}`; host must be `business.grubano.com` (404 elsewhere); anti-enum: an existing email returns the same generic OK **without any email**; fresh ⇒ `Operator{role restaurant, status pending, password null or hash, consentAt, verifyTokenHash, verifyTokenExpiry = +24 h}` ⇒ inline email (register **tu**, subject `Confirme ton email — espace partenaire Grubano`, CTA « Vérifier mon email » → `{PARTNER_APP_URL || proto://host}/api/partners/verify-email?token=`) ⇒ own EmailLog `partner_verify`. Login is refused while `pending`; the verify GET stamps `emailVerifiedAt` and activates. The response message tells the applicant to "connectez-vous par lien magique" afterwards. `name` unescaped.

## 7 · AUTH_STEPUP_CODE — facts (flag OFF)
Authenticated `POST {purpose}` with `purpose ∈ {stepup:withdraw, stepup:bank, stepup:email_change}`; label map: "confirmer un retrait" / "modifier vos informations bancaires" / "modifier l'e-mail de votre compte". Code 6 digits, **10 min**, single-use, hashed; throttled 5/10 min → 429 `{reason:'throttled'}`. Subject `Votre code de confirmation Grubano`; HTML + text; no EmailLog; not deduped (by design). Consumed by `requireStepUp` on the sensitive route (inert when the flag is OFF).

## 8 · ACCOUNT EMAIL CHANGE — facts (flag OFF)
1. `request-code` → AUTH-style code to the **current DB email** (not the JWT) — ACCOUNT_EMAIL_CHANGE_CODE.
2. `request {newEmail, currentEmailCode}` → verify code → same-address 400 → MX check of the new domain (`domainAcceptsMail`) → if the new address already has an account ⇒ ACCOUNT_EMAIL_ALREADY_USED to **that** address (fixed dedupe key ⇒ at most once ever per address) + generic OK; else `pendingEmail` + token (15 min, sha256 stored) ⇒ ACCOUNT_EMAIL_CHANGE_LINK to the **new** address (`/eat/account/email/confirm?token=`).
3. `confirm {token}` → atomic swap (collision ⇒ 409) ⇒ ACCOUNT_EMAIL_CHANGED_ALERT to the **old** address (masked new address) + ACCOUNT_EMAIL_CHANGE_CONFIRM to the **new** address.
Eligibility refuses email-keyed partner roles (supplier/logistics/prestataire profiles) and OAuth accounts (403). Login keys on `email` unchanged until confirmation.

## 9 · Consumer-facing auth promises vs facts (for the design contract)
- "lien valable 15 minutes, une seule fois" — TRUE. "code valable 15 minutes" — **FALSE by 5 min** (10 min).
- "Si un compte existe … un lien vient d'être envoyé" — TRUE except when `SMTP_PASS` is unset (then nothing is sent).
- "Ton compte est créé et déjà actif" (welcome) — TRUE (no verification step).
- "Tu peux commander, réserver une table et suivre tes points fidélité" (welcome) — **table reservation is OUT of the closed beta** (sur place) → unsupported promise for the beta (register P1).
- Tutoiement in 3 auth emails vs vouvoiement everywhere else — terminology inconsistency (target: formal French).
