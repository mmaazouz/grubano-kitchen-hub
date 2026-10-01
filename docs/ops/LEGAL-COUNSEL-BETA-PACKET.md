# LEGAL-COUNSEL-BETA-PACKET.md

> **Purpose.** Give outside counsel everything needed to advise on the Grubano *closed-beta* launch without reading the codebase. This is a **state-of-the-code** report only. It contains **no legal opinion**. Every mechanism is labelled: **MECHANISM PRESENT / PARTIAL / ABSENT / CONTENT MISSING / LEGAL REVIEW REQUIRED / NON ÉTABLI**. Words such as "compliant", "non-compliant", "illegal", or "article X is violated" are deliberately not used — those are counsel's calls.
> **Repo baseline.** `develop @ 6361510419b5014d6e4c6d52e01730c0e552a7ac`. All `file:line` references are against this commit. Static analysis only (no DB, no network, no staging reached).
> **Founder decisions already frozen (do not re-litigate):** beta scope below; open registration + admin-gated go-live/activation (this is *not* an invite-only beta); 7 module flags forced OFF; `RATE_LIMIT_ENABLED` ON; Tiger Protect OFF; business-state names (Encaissement, Retrait, Opérationnel, Approuvé, Commandable) are not up for discussion.

---

## A. EXECUTIVE SUMMARY

Grubano is a multi-brand dark-kitchen platform (Next.js 14 / Prisma 5 / MySQL). The closed beta ships **only the restaurateur (operator) journey + the public consumer ordering surface**; six partner "economies" and the consumer redesign are code-complete but **flag-gated OFF** for beta.

State of the privacy/legal machinery today:

1. **Legal pages exist but are empty shells.** Three pages are built — `mentions-legales`, `confidentialite`, `cookies` — but **every required company/host/mediation/DPO/retention fact is still a placeholder** (`lib/legal-info.ts`). A guard (`isLegalInfoComplete()`) keeps all three pages `noindex` and shows a "finalisation" banner until they are filled. **CONTENT MISSING** across the board. **There is no CGU (Terms), no CGV (sale terms), no partner agreement, and no beta agreement — as pages or as text — anywhere in the repo.**
2. **Rights exist on paper, not in product.** The privacy page *states* the six data-subject rights and points users to "the data controller (DPO)" — whose contact is a placeholder. There is **no in-app account deletion** (the button is inert, shows a "coming soon" toast) and **no data export/portability** feature at all. So the *only* rights mechanism today is a manual email to an address that isn't filled in. **ABSENT (self-service) / PARTIAL (manual, undocumented).**
3. **Consent is captured for exactly one journey.** The restaurateur signup (the beta-in flow) records a timestamped `consentAt`. Consumer signup captures **no consent** (only an informational sentence, no checkbox, nothing persisted). Supplier/logistics/prestataire/affiliate validate a consent checkbox at the API but **do not persist it**; franchise/creator don't even validate it. **No consent version is stored anywhere.**
4. **Special-category data (allergies) is collected and shown** to operators (reservations, dine-in tickets, daily briefing) with **no retention limit and no deletion path.**
5. **No retention/purge for any PII model.** The single retention sweep that exists (courier geolocation) is itself flag-gated OFF. Emails are logged in cleartext to server stderr with no rotation policy in the repo.

Net: the *scaffolding* is unusually careful (placeholders, noindex, subprocessor list, consent timestamp on the one live flow, health-data comments in code), but the *content* (legal texts) and the *operational mechanisms* (delete, export, retention, consent coverage) are not yet in place. Counsel input is required to (a) author the missing texts and (b) confirm whether a manual rights process is sufficient for the beta window.

---

## B. BETA SCOPE (frozen)

**BETA-IN (live in closed beta):**
- Restaurateur acquisition & auth: `/business`, `/business/start`, `/business/register`, `/business/verified`, `/business/onboarding`, `/auth/magic`, `/login`, plus `/dashboard` and the ~23 operator sub-routes (menu, orders, stocks, loyalty, analytics, brands, reviews, wallet, suppliers-view, tables, customers, notifications, cashflow, prep, finance, pricing, dinein, more, briefing, premium, account…).
- Public consumer ordering surface `/eat/*` (browse, cart, order, track, reservations, loyalty wallet, consumer auth) — public, no auth required to browse (`middleware.ts`, CLAUDE.md §8).
- Legal pages `/legal/*`; admin approval console `/admin/approvals` (restaurant publication is admin-gated, `lib/publication-rule.ts`); dine-in `/t/[tableId]` if enabled.

**BETA-OUT (present in code, flag-gated OFF):** creator economy, supplier B2B, franchise, logistics/courier, prestataire (services marketplace), affiliate, and the consumer redesign (`eat-next`). Gating flags to be forced OFF: `CREATOR_ENABLED`, `SUPPLIER_ENABLED`, `FRANCHISE_ENABLED`, `LOGISTICS_ENABLED`, `PRESTATAIRE_ENABLED`, `AFFILIATE_ENABLED`, `CONSUMER_REDESIGN_ENABLED` (defaults confirmed OFF, e.g. `LOGISTICS_ENABLED` → 17 routes 404, `docs/ops/flags.md:42`). `RATE_LIMIT_ENABLED` stays ON.

**Consequence for this packet:** the *primary* privacy surface for beta is (1) the **consumer** (`/eat/*`, `Order`, `Reservation`, `LoyaltyCustomer`) and (2) the **restaurateur** (`Operator`, `/business/register`). Partner personas are documented for completeness but are OUT of the beta data-processing perimeter while their flags are OFF. Note two deliberate exceptions kept live even with `LOGISTICS_ENABLED` OFF: the geoloc **consent-withdrawal** and **RGPD access/erasure** endpoints and the retention **purge** cron (`docs/ops/flags.md:42`) — they are inert only because no courier data exists yet.

---

## C. PERSONAS

| Persona | Beta status | Identity model | Registration entry point | Consent captured? |
|---|---|---|---|---|
| **Consumer** (`role=consumer`) | **BETA-IN** | `Operator` (name, email, phone, city) + `LoyaltyCustomer` + `Address` + `Order` + `Reservation` | `/eat/auth` → `POST /api/auth/register` | **No** — informational text only, nothing persisted |
| **Restaurateur / partner** (`role=restaurant`) | **BETA-IN** | `Operator` + `Restaurant` + `Brand` | `/business/register` → `POST /api/partners/register` | **Yes** — checkbox required, `consentAt` timestamped (schema:39; route:254) |
| **Admin** (`role=admin`) | BETA-IN (internal) | `Operator` + `AdminAuditLog` | provisioned server-side (`docs/ops/provision-admin.md`) | n/a |
| **Loyalty-only member** | BETA-IN (public API) | `LoyaltyCustomer` (name, email, phone) | `POST /api/loyalty/register` (public) | **No** consent field |
| **Supplier** (`role=supplier`) | BETA-OUT (`SUPPLIER_ENABLED` OFF) | `SupplierProfile` (company, contact, phone, SIREN) | `/business/... ` → `POST /api/supplier/register` | Validated, **not persisted** |
| **Logistics / courier** (`role=logistics`) | BETA-OUT (`LOGISTICS_ENABLED` OFF) | `LogisticsProfile` (+ justificatifs, tracking consent, position) | `POST /api/logistics/register` | Validated, **not persisted**; separate `trackingConsent` IS persisted |
| **Prestataire / services** (`role=prestataire`) | BETA-OUT (`PRESTATAIRE_ENABLED` OFF) | `PrestataireProfile` | `POST /api/prestataire/register` | Validated, **not persisted** |
| **Affiliate** (`role=affiliate`) | BETA-OUT (`AFFILIATE_ENABLED` OFF) | `Operator` (passwordless) + `Affiliate` + `AudienceVerificationRequest` | `POST /api/affiliate/apply` / `join` | Validated, **not persisted** |
| **Creator / chef** (`role=creator`) | BETA-OUT (`CREATOR_ENABLED` OFF) | `Creator` + `CreatorApplication` (bio, instagram, youtube) | `POST /api/creators/apply` | **Not validated** at API |
| **Franchise / franchisee** (`role=franchise`) | BETA-OUT (`FRANCHISE_ENABLED` OFF) | `FranchiseApplication` / `FranchiseeApplication` (name, phone, email, motivation) | `POST /api/franchise/apply` | **Not validated** at API |

---

## D. DATA MAP (concise) — PII-bearing models, schema line, retention/purge

MySQL has no array type → arrays are `Json`. **No purge/retention job exists for any model below** except the geoloc sweep (flag-gated OFF). "Exposure" = who can read it.

| Model | Key PII fields (schema line) | Beta? | Retention / purge | Deletion path |
|---|---|---|---|---|
| `Operator` (schema:13) | `email`:16, `phone`:18, `city`:19, `password?`:17 (bcrypt), `dateOfBirth`:134, `registeredAddress`:131, `taxId`:132, `siren`:110; magic/verify/pending-email token **hashes** (SHA-256, nullable) | Consumer+partner **IN** | **None** | **ABSENT** (no delete endpoint; cascade children only) |
| `Address` (schema:188) | `street`, `complement`:floor/intercom, `postalCode`, `city`, `note`:driver instr. | Consumer **IN** | None | `DELETE /api/eat/addresses` deletes **one address**, not the account (route:127); cascade on Operator delete (which doesn't exist) |
| `LoyaltyCustomer` (schema:313) | `name`, `email`:316, `phone`:317 | **IN** (public register) | None | ABSENT |
| `Reservation` (schema:540) | `customerName`:567, `phone`:568, `email`:569, **`allergies`:575 (health)**, `notes`:@db.Text, `preOrder` | **IN** | None | ABSENT (residual **deposit** purge exists but is financial, not PII: `/api/reservations/purge-residual-deposits`) |
| `Order` (schema:2216) | `deliveryAddress`:2227 (formatted string), `deliveryLat/Lng`:2236-2237 (only if `LOGISTICS_DISTANCE_FEE_ENABLED` ON), `consumerId`, `items` JSON | **IN** | Lat/Lng swept on terminal orders by geoloc sweep **only when that cron runs** (OFF); **`deliveryAddress` string never purged** | ABSENT |
| `EmailLog` (schema:643) | `recipient`:645 (**email**), `subject`:646, `trigger`, `status`, `claudeTokens`, `sentAt` | **IN** | **None — indefinite** | ABSENT |
| `EmailOtp` (schema:1915) | `email`:1917, `codeHash`:1919 (never clear code), `expiresAt` | **IN** (flag-gated) | Single-use + TTL within flow; **no row purge** | ABSENT |
| `TicketItem` (dine-in) | `allergies`:2208 (**health**), `addedBy` | IN if dine-in | None | ABSENT |
| `Review` (schema:1562) | `userId`, free-text `text`:@db.Text | **IN** | None | Cascade on Operator/Restaurant delete |
| `SupplierProfile` (825) | `email`:827, `companyName`:828, `contactName`:829, `phone`:830, `siren`:859 | OUT | None | ABSENT |
| `LogisticsProfile` (887) | `email`:889, `contactName`:891, `contactPhone`:892, `siren`:903, `justificatifs*` (insurance/RC-Pro declared), `trackingConsent`:959, `trackingConsentAt`:960 | OUT | Geoloc sweep OFF | Consent-withdrawal purges live position (`/api/logistics/tracking-consent` PATCH → position deleteMany) |
| `Mission` (983) | `pickupAddress`:1010, `dropoffAddress`:1011 (**consumer address**; masked to coarse zone via `lib/mission-serialize.ts`) | OUT | None | ABSENT |
| `CourierPosition` (1885) | `lat/lng/accuracy` (last point only, no breadcrumb) | OUT | `POSITION_TTL_MINUTES` default 120, clamp [5,1440] (`lib/courier-position-sweep.ts:23`) but sweep flag OFF | Cascade with profile |
| `PrestataireProfile` (1076) | `email`, `companyName`, `contactName`, `phone`, `siren`:1111 | OUT | None | ABSENT |
| `Creator` (672) / `CreatorApplication` (770) | `name`, `email`, `bio`:@db.Text, `instagram`, `youtube` | OUT | None | ABSENT |
| `FranchiseApplication` (748) | `name`, `phone`:759, `email`:760, `motivation`:765 @db.Text | OUT | None | ABSENT |
| `AudienceVerificationRequest` (2508) | `handle`:2512, `declaredFollowers`, `proofUrl`:2514 | OUT | None | ABSENT |
| `Account`/`Session`/`VerificationToken` (NextAuth) | OAuth linkage, session tokens | IN | Session TTL only | Cascade with Operator (no delete) |

**Privacy-positive design notes (state of code, not a verdict):** `ReferralClick` (schema:2532) stores **no IP / no user-agent** (comment 2524-2531); `CourierPosition` keeps only the current point, not a trail; the consumer **allergen banner is per-order, explicitly "not kept at profile"** (`messages/fr.json:953`), though the underlying `Reservation.allergies`/`TicketItem.allergies` rows persist.

---

## E. MECHANISMS PRESENT (state of code)

**E1. Legal pages — shell PRESENT, content CONTENT MISSING.**
- Pages built: `app/[locale]/legal/mentions-legales/page.tsx`, `.../confidentialite/page.tsx`, `.../cookies/page.tsx`, shared shell `.../legal/layout.tsx`. Route group is public (`middleware.ts`) and rendered bare.
- Single source of truth: `lib/legal-info.ts`. **All required editor/host/mediation/privacy fields are `'[[À COMPLÉTER — …]]'` placeholders** (`LEGAL_INFO`, lib/legal-info.ts). `isLegalInfoComplete()` returns **false** while any required field is a placeholder (tvaIntra + telephone excluded as optional).
- Guardrails PRESENT: each page sets `robots:{index:false,follow:false}` while incomplete (mentions:19, confidentialite:24, cookies:18) and renders a `draftBanner` "⚠️ Mentions légales en cours de finalisation…" (`messages/fr.json:6958`).
- Privacy page **describes** the six rights (`confidentialite.rightsBody`: accès, rectification, effacement, limitation, portabilité, opposition → "contacter le responsable du traitement"), a CNIL note (`cnilNote`), a retention section (values are placeholders), and a **subprocessor list** `LEGAL_SUBPROCESSORS`: Stripe (payment), Anthropic/Claude (LLM), recherche-entreprises.api.gouv.fr (registry), Google/Apple (OAuth) — all `confirmed:true` — plus email/SMTP provider `confirmed:false` (placeholder).

**E2. Consumer registration — MECHANISM PARTIAL (no consent).**
- `POST /api/auth/register` (`app/api/auth/register/route.ts`): Zod schema is `{name,email,password}` **only** (route:19-23) — no consent field; `role` forced server-side to `consumer`; bcrypt cost 12; rate-limited (`auth_register`, 10/600s). UI `/eat/auth` shows a static line `t('legal')` = "En continuant, vous acceptez les Conditions et la Politique de confidentialité…" (`messages/fr.json:3545`, rendered `app/[locale]/eat/auth/page.tsx:267,396`) — **not a checkbox, not persisted**.

**E3. Restaurateur (partner) registration — MECHANISM PRESENT (consent persisted).**
- `/business/register` UI: consent checkbox, **never pre-checked**, required client-side (`app/[locale]/business/register/page.tsx:44,139-144`), links to `/legal/confidentialite`.
- `POST /api/partners/register`: Zod `consent: refine(v===true)` (route:116); on create, `consentAt: new Date()` persisted on `Operator` (route:254; schema field `consentAt`:39). Email-verification token is SHA-256-hashed, single-use, 24h. **This is the only journey that persists consent. No policy version string is stored.**

**E4. Partner consent (BETA-OUT) — MECHANISM PARTIAL (validated, not persisted).**
- Supplier `POST /api/supplier/register:38`, Logistics `.../logistics/register:39`, Prestataire `.../prestataire/register:36`, Affiliate `.../affiliate/apply:49` all enforce `consent: refine(v===true)` at the API, but the subsequent `profile.create`/`ensureAffiliateApplicant` **write no consent timestamp** (the profile models have no `consentAt` column; the only `consentAt` write in the codebase is `partners/register:254`).

**E5. Geolocation RGPD rail — MECHANISM PRESENT but DORMANT.**
- Gated by `LOGISTICS_TRACKING_ENABLED` (default OFF, `docs/ops/flags.md:45`). Opt-in only: `trackingConsent` default false (schema:959), stamped `trackingConsentAt`; capture is client-side `watchPosition` during an in-course mission; receiver re-checks consent (`/api/logistics/position:74` → 403 `consent_required`).
- Access/erasure endpoints kept live even when the role is OFF: `GET /api/logistics/my-position-data` (art. 15 self-access), `PATCH /api/logistics/tracking-consent` (withdraw → **purges live position**, route:71-79). Retention sweep `POST /api/logistics/positions/sweep` (`lib/courier-position-sweep.ts`) also purges terminal-order `Order.deliveryLat/Lng`. Scheduler is `cron.yml` `sweep` group, **inert until `cron.yml` reaches `main`** (`docs/ops/crons.md`).

**E6. Cookies — MECHANISM PRESENT (inventory), no CMP.**
- `LEGAL_COOKIES` (lib/legal-info.ts): `NEXT_LOCALE` (1y, locale), `next-auth.session-token` (30d, session), `grubano_estab` (1y, establishment), `grubano_ref` (90d, referral) — **all category `necessary`**. Code comment: "AUCUN cookie publicitaire / analytics tiers (aucun CMP dans l'app à ce jour)." No analytics/APM (`docs/ops/logs.md:35` "Aucun APM/Sentry"; CSP is report-only).

**E7. Email audit — MECHANISM PRESENT (`EmailLog`).** Every send attempt writes `{recipient,subject,trigger,status}` (`lib/transactional-emails.ts` sink; schema:643). Idempotency registry `EmailDispatch` (schema:661).

---

## F. MECHANISMS ABSENT / PARTIAL (state of code)

**F1. Account deletion — ABSENT.** No delete-account endpoint exists (grep of `app/api/account`, `app/api/eat` finds only `DELETE /api/eat/addresses` for a single address). The consumer UI "Supprimer mon compte" button is **inert**: it fires a "coming soon" toast (`app/[locale]/eat/account/edit/page.tsx:175-177`; comment 27-28 "is also inert (no delete-account endpoint)"). No operator-side deletion. **Question for counsel: is a manual, ticket-based deletion acceptable for the beta window?**

**F2. Data export / portability — ABSENT.** No export/download/portability feature anywhere (grep for portabilité/export/télécharger mes données → none). The right is *stated* on the privacy page but has no implementation. **Manual-only, undocumented.**

**F3. Consumer & loyalty consent — ABSENT/PARTIAL.** No checkbox, no API field, no persistence for `POST /api/auth/register` or `POST /api/loyalty/register`. **No consent version anywhere in the codebase** (no `policyVersion`/`consentVersion` field on any model). **Question: does the beta need an explicit consumer consent checkbox + versioning, or is the informational notice sufficient given the processing is order-necessary?**

**F4. Terms referenced in UI but non-existent — the 6 places (CONTENT MISSING).** No `/legal/cgu`, `/legal/cgv`, partner-terms, or beta-terms page exists (only `mentions-legales`, `confidentialite`, `cookies` route dirs). Yet the UI names "Conditions"/"les conditions":
1. **Consumer signup** `/eat/auth`: "…vous acceptez **les Conditions** et la Politique de confidentialité" — `messages/fr.json:3545`, rendered `app/[locale]/eat/auth/page.tsx:267,396`. No link target for "Conditions".
2. **Consumer profile** `/eat/account`: row labelled **"Conditions & confidentialité"** (`fr.json:3505`) links **only** to `/legal/confidentialite` (`app/[locale]/eat/account/page.tsx:256-258`).
3. **Operator "More" menu** `/more`: same **"Conditions & confidentialité"** row → links `mentions-legales` + `confidentialite` (`app/[locale]/more/MoreClient.tsx:193-194`); no distinct "Conditions".
4. **Affiliate apply** `/affiliate/apply`: consent text "J'accepte **les conditions du programme d'affiliation**…" (`fr.json:7728`) — no affiliate-conditions doc.
5. **Franchise apply** `/franchise/apply`: aside **"Conditions du réseau"** (`fr.json:1411`) and **"Conditions de franchise"** page label (`fr.json:1549`) — no franchise contract/terms doc surfaced.
6. **Logistics landing/register** `/business/logistics(/register)`: consent "…j'accepte **les** [conditions]" (`consentTermsLabel`, `fr.json:5075`) points to `/legal/mentions-legales`; source comments explicitly note **"never /legal/cgu (does not exist)"** (`app/[locale]/business/logistics/page.tsx:198`, `.../register/page.tsx:24`).

**F5. CGU (Terms of Service) — CONTENT MISSING.** No page, no text. Only refusal references in the onboarding assistant prompt (`lib/onboarding-chat.ts:18,71` — the AI is told to refuse CGU/CGV questions).

**F6. CGV (sale/consumer terms) — CONTENT MISSING.** None (grep "CGV / conditions de vente / conditions générales de vente" → only the onboarding-chat refusal comment). Relevant because `Order`/`Reservation` involve real charges via Stripe (TEST mode today per project memory).

**F7. Partner conditions — CONTENT MISSING.** Referenced (F4-#4,#5,#6) but no document exists.

**F8. Beta agreement — CONTENT MISSING.** No beta-terms/beta-accord page or text anywhere. (Founder model is open-registration + admin-gated activation, so a click-through beta agreement is a product/legal decision, not currently in code.)

**F9. `lib/legal-info.ts` — required fields still placeholder (CONTENT MISSING).** Exhaustive list of REQUIRED fields blocking `isLegalInfoComplete()` (all currently `[[À COMPLÉTER — …]]`): editor `raisonSociale, formeJuridique, capitalSocial, siren, siret, rcsVille, siegeAdresse, email, directeurPublication`; host `nom, adresse, contact`; mediation (consumer mediator) `nom, url, adresse`; privacy `dpoContact, retentionAccount, retentionOrders, nonEuTransfer`. Optional/non-blocking: `tvaIntra`, `telephone`. Subprocessor still to confirm: **email/SMTP provider** (`confirmed:false`). Guardrails: `noindex` + banner active while incomplete (E1).

**F10. `EmailLog` PII & retention — PARTIAL / ABSENT.** Stores `recipient` (email, schema:645) + `subject` + `trigger` + `status` + `sentAt`, **indefinitely, no purge**. `subject` can carry a name (e.g. welcome subject) but generally not. `recipient='(aucun destinataire)'` when skipped (`lib/transactional-emails.ts:104-107`).

**F11. General retention — ABSENT for ~18 PII models.** See Section D. No cron/lib purges `Operator, Address, LoyaltyCustomer, Reservation, Order, EmailLog, EmailOtp(rows), Review, Supplier/Logistics/Prestataire Profile, Mission, Creator/CreatorApplication, Franchise(e)Application, AudienceVerificationRequest`. The only retention sweep (`positions/sweep`) targets geoloc and is flag-gated OFF. Confirmed via `docs/ops/crons.md` (3 active cPanel crons: ledger-check, creator-earnings-mature, monthly-invoices — none purges PII).

**F12. `Order.deliveryAddress` — retained indefinitely (ABSENT purge).** Formatted address **string** (schema:2227), written by `placeOrder`; the geocoded `deliveryLat/Lng` (2236-2237) are populated only if `LOGISTICS_DISTANCE_FEE_ENABLED` ON and swept on terminal orders **when the sweep runs**; the **address string itself has no TTL**.

**F13. `Reservation` — PII + health, retained indefinitely (ABSENT purge/delete).** `customerName/phone/email` (567-569), `allergies` (575), free `notes`. Consumer bookings via `/eat` are masked in the operator view (`source='eat'` → masked name, no phone/email; schema comment 540-566), but the row still stores full data when booked by staff or logged-in. No deletion path.

**F14. Allergies (special-category) — collected, exposed, no retention/no deletion.**
- Stored: `Reservation.allergies` (schema:575), `TicketItem.allergies` (dine-in, schema:2208), `Reservation.preOrder`. Free-text dine-in allergies `z.string().max(280)` (`/api/t/[tableId]/order:36,141`).
- Exposed to operator: daily briefing reads reservation allergies and **the code itself labels it "RGPD art. 9 health data"** (`app/api/briefing/route.ts:14,96`); customer profile shows a **per-order** allergen banner explicitly "never a stored health" profile field (`app/[locale]/customers/[id]/CustomerProfileClient.tsx:8,194-200`; `fr.json:953`).
- Deletion: none. Logging: not printed to console. **Question: does the beta need explicit handling (consent/among rights) for allergy data as special-category?**

**F15. Emails in cleartext in application logs — PRESENT (exhaustive list).** These `console.*` calls print a real email value to stderr (`~/logs/`):
- `lib/transactional-emails.ts:150` (`{to,subject}` on SKIP), `:158` (`{to,subject}` on FAIL), `:104` (`logEmailSkipped`, `JSON.stringify(context)`) — **central sink, used by every transactional trigger**.
- `app/api/auth/register/route.ts:127` and `:133` (`data.email`).
- `app/api/auth/magic-link/route.ts:166` (`email`).
- `app/api/auth/step-up/request/route.ts:70` (`email`).
- `app/api/account/email-change/request-code/route.ts:62` (`elig.email`).
- `app/api/admin/onboarding-nudges/run/route.ts:276` (`cr.email`), `:318` (`sp.email`), `:359` (`pr.email`).
- `lib/affiliate-signup.ts:59`, `lib/consumer-signup.ts:54`, `lib/creator-account.ts:77`, `lib/franchise-account.ts:92` (`normEmail`), `lib/identity-propagation.ts:90` (`entity.email`), `lib/logistics-account.ts:176`, `lib/prestataire-account.ts:174`, `lib/supplier-account.ts:176`.
- (For contrast — NOT cleartext-email: the many `[EMAIL MISS] … failed` call-site lines print an **id** — `order.id`/`reservation.id`/`params.id` — e.g. `orders/[id]/status:220`, `reservations/public:258`, `admin/restaurants/[id]/approve:86`.)
- **Beta-relevant subset (BETA-IN flows):** `transactional-emails.ts:104/150/158`, `auth/register:127/133`, `auth/magic-link:166`, `account/email-change/request-code:62`, `consumer-signup.ts:54`. These fire in the consumer/partner journeys.

**F16. Log rotation — ABSENT (manual recommendation only).** `docs/ops/logs.md`: app logs to stderr, cron output + Passenger logs land in `~/logs/`; Apache access logs are "**à archiver régulièrement** (recommandation d'audit)" — i.e. a recommendation, **no rotation/retention mechanism in the repo**, no logrotate config committed.

**F17. Cookies / marketing — no marketing, no CMP (PARTIAL: no banner).** Only 4 `necessary` cookies (E6); no advertising/analytics cookies; no consent-management platform / cookie banner in the app. **Question: given only strictly-necessary cookies, is a cookie banner required for the beta?**

---

## G. THE 7 DECISIONAL QUESTIONS FOR COUNSEL

1. **Missing legal texts.** We need drafted, France-oriented **CGU (Terms of Service)**, **CGV (consumer sale terms — orders/reservations are charged via Stripe)**, **partner conditions** (restaurateur; later supplier/logistics/prestataire/affiliate/creator/franchise), and a **beta agreement** (or a decision that none is required for an admin-gated open beta). None exist in code (F5–F8). Which are strictly required to switch on the closed beta, and which can follow?
2. **Mentions légales + Politique de confidentialité content.** Confirm the exact fields to publish (`lib/legal-info.ts` list, F9), the **retention durations** for accounts / orders / reservations / EmailLog / allergies, the **consumer mediator** designation, the **DPO/contact** address, and the **non-EU transfer** statement (note: Anthropic/Claude is a subprocessor — F9/E1). Until filled, pages stay `noindex` + bannered by design.
3. **Sufficiency of a manual rights process during beta.** There is **no in-app deletion and no export** (F1–F2); the privacy page directs users to email the controller. Is a documented **manual** access/erasure/portability process acceptable for the beta window, and if so what SLA/records must we keep? What must exist before general availability?
4. **Consumer registration consent + versioning.** Consumer/loyalty signup captures **no consent and no policy version** (F3). Is an explicit consent checkbox required, or is an informational notice sufficient where processing is contract-necessary (order fulfilment)? If consent is required, what **versioning/timestamping** must we persist (we already do this for restaurateurs — `consentAt`)?
5. **Allergy data (special category).** Allergies are collected (reservations, dine-in tickets, pre-orders) and shown to operators, with the code itself flagging "art. 9 health data" (F14). What legal basis, notice, retention, and deletion handling do you require for this field for the beta?
6. **Emails in cleartext in server logs with no retention.** Recipient emails are logged to stderr/`~/logs/` by the transactional sink and several auth flows (F15), and there is **no log rotation/retention policy** in the repo (F16). What controls (redaction, rotation, retention limit, access restriction) do you require, and on what timeline?
7. **Data already sitting in staging.** `app.grubano.com` (staging) has been running these flows; some real-looking rows may exist there (not inspected in this static pass — DB not reached). What is the status/obligation for **pre-beta data in staging** (delete, ring-fence, treat as production PII), and does anything block go-live until it is addressed?

---

## H. DECISIONS / TEXTS REQUIRED FROM COUNSEL (deliverables)

| # | Deliverable | Feeds into (code) | Blocking for beta? |
|---|---|---|---|
| H1 | **Mentions légales** facts (editor, host, mediator, director) | `lib/legal-info.ts` `LEGAL_INFO.editor/host/mediation` | Yes to lift `noindex`/banner |
| H2 | **Politique de confidentialité** facts: `dpoContact`, `retentionAccount`, `retentionOrders`, `nonEuTransfer` (incl. Anthropic non-EU stance) | `lib/legal-info.ts` `LEGAL_INFO.privacy` + `LEGAL_SUBPROCESSORS` (confirm email/SMTP vendor) | Yes |
| H3 | **CGU** text (consumer + operator) | new `/legal/cgu` page + relink the 6 UI spots (F4) | Counsel to rule (F5) |
| H4 | **CGV** text (orders/reservations, refunds, Stripe) | new `/legal/cgv` page + checkout/reservation surfaces | Counsel to rule (F6) |
| H5 | **Partner conditions** + **beta agreement** (or waiver) | partner register + `/business/*` | Counsel to rule (F7–F8) |
| H6 | **Consumer consent** decision + versioning scheme | `POST /api/auth/register`, `/eat/auth`, new `policyVersion` field | Counsel to rule (F3, Q4) |
| H7 | **Retention schedule** per model (Section D) | future purge cron + privacy page durations | Needed for H2 |
| H8 | **Rights process** (manual vs self-service) + records/SLA | delete/export endpoints (F1–F2) | Counsel to rule (Q3) |
| H9 | **Allergy-data** handling instruction | reservation/ticket flows (F14) | Counsel to rule (Q5) |
| H10 | **Log redaction/rotation/retention** requirement | F15–F16 sites + ops | Counsel to rule (Q6) |
| H11 | **Staging data** instruction | ops (not a code change) | Possibly blocking (Q7) |

---

## I. CODE LOCATIONS FOR IMPLEMENTATION (once counsel decides)

| Task | Where to implement |
|---|---|
| Fill legal facts | `lib/legal-info.ts` (`LEGAL_INFO`, and set email subprocessor `confirmed:true` with real name). Banner/noindex auto-clear via `isLegalInfoComplete()`. |
| Add CGU/CGV pages | new dirs under `app/[locale]/legal/` (mirror `mentions-legales/page.tsx`); add nav in `app/[locale]/legal/layout.tsx:56-64`; add `robots` guard like `.../mentions-legales/page.tsx:19`. |
| Fix the 6 "Conditions" references | `messages/fr.json` keys `3545,3505,7728,1411,1549,5075` (+ `en/es/it/ar`); UI `app/[locale]/eat/auth/page.tsx:267,396`, `.../eat/account/page.tsx:256-258`, `.../more/MoreClient.tsx:193-194`, `.../affiliate/apply/page.tsx`, `.../franchise/apply/*`, `.../business/logistics(/register)/page.tsx`. |
| Consumer consent + version | `app/api/auth/register/route.ts:19-23` (add `consent` to Zod, persist `consentAt` + new `policyVersion`), `app/[locale]/eat/auth/page.tsx` (add checkbox); mirror `POST /api/loyalty/register`. Schema: add `consentAt`/`policyVersion` usage (Operator already has `consentAt` schema:39). |
| Persist partner-flow consent | supplier/logistics/prestataire/affiliate register routes (`:38/:39/:36/:49`) → add a `consentAt` write; add column to the respective profile models. |
| Account deletion | new `DELETE /api/account` (+ `/eat` variant); wire the inert button `app/[locale]/eat/account/edit/page.tsx:175-177`. Cascades already defined for `Address`, `OperatorRole`, `Review`, `CreatorFollow`, etc. |
| Data export | new `GET /api/account/export` aggregating Operator + Address + Order + Reservation + LoyaltyCustomer + Review. |
| Retention purge | extend the `cron.yml` `sweep`/`daily` groups (`docs/ops/crons.md`) with a PII-purge route mirroring `lib/courier-position-sweep.ts`. |
| Allergy handling | `app/api/reservations/route.ts:44,237`, `app/api/t/[tableId]/order/route.ts:36,141`, exposure in `app/api/briefing/route.ts:96`. |
| Log redaction | central sink `lib/transactional-emails.ts:104,150,158` + the auth/account/*-account.ts sites in F15. |
| Cookie banner (if required) | none exists — new CMP component; inventory already in `lib/legal-info.ts` `LEGAL_COOKIES`. |
| Geoloc rail (BETA-OUT) | already built and gated: `docs/ops/flags.md:45`, `lib/courier-position-sweep.ts`, `/api/logistics/{tracking-consent,my-position-data,positions/sweep}`. |

---

*End of packet. All findings are static-analysis observations at `develop @ 6361510`; no data store was queried and `.env.local` was not read. No legal conclusions are drawn — every "PRESENT/PARTIAL/ABSENT/CONTENT MISSING" label describes the code, not compliance.*
