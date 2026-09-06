# P0 AUTH HYDRATION — 2026-09-06 · magic-auth skeleton never resolved (app + business)

## Symptom (founder, staging, several machines, incognito)
`/fr/auth/magic` rendered the shell, title and « Inscrire mon entreprise » link but the card stayed as **three grey skeleton blocks**: no email field, no submit. `/fr/eat/auth` looked inert. Both `app.grubano.com` and `business.grubano.com`.

## Reproduction (Claude Code, headless browser, before any change)
- `GET /fr/auth/magic` → 200, server HTML contains the Suspense bailout (`BAILOUT_TO_CLIENT_SIDE_RENDERING`) + skeleton, `0` inputs.
- Console: `Refused to execute script from …/_next/static/chunks/webpack-7b07d51efce9f933.js because its MIME type ('text/html')` — the **webpack runtime chunk answered 404** (Next 404 page). Every other chunk 200.
- No React error, no hydration warning: **no client JavaScript ran at all**, on every page (hence the inert consumer form too).

## Root cause (MEASURED)
Deploy run 34006442266 (`fb994f6`, a docs commit carrying `[no-restart]`) built and **FTP-synced a new build** (28 uploads incl. `webpack-7b07d51…js`, `_buildManifest.js`, several page chunks; the previous build's files **deleted**) and, because of the marker, **skipped the three Passenger restart steps**. The Next.js standalone process spawned by the previous deploy (`ca0e19a`, 01:51 UTC) kept running. That process **snapshots the `.next/static` file list at boot**: every asset uploaded by the new deploy → **404** (unknown), every asset deleted by it → **400** (known but missing), unchanged content-hashed files → 200. The HTML it served referenced the NEW build (`buildId RuM3dnLQ0LRNmxPxp-yui`), so the browser asked for chunks the process refused. `/version.json` is a static file ⇒ the SHA health check stayed green.

| Class of file | Example | Live answer |
|---|---|---|
| uploaded by the deploy | `chunks/webpack-7b07d51efce9f933.js`, `RuM3dnLQ0LRNmxPxp-yui/_buildManifest.js` | 404 text/html |
| deleted by the deploy | `chunks/webpack-2244381ae6f2edb0.js` | 400 |
| unchanged | `chunks/main-app-31363f316a2458b6.js`, `auth/magic/page-3ab960a5….js` | 200 |

**ROOT CAUSE COMMIT** = `c7cc60e` (introduced the `[no-restart]` marker, 2026-09-04), **triggered** by every `[no-restart]` deploy since (latest `fb994f6`). **ROOT CAUSE FILE** = `.github/workflows/deploy-staging.yml`. Not a React/Suspense defect: `a1/auth-magic-bare` (`1cfad63`) and `ca0e19a` are innocent (the Suspense fallback only made the dead-JS state look like a skeleton instead of a blank card).

False leads: RATE LIMIT = NOT CAUSE (no request ever left the browser) · MAGIC-LINK TOKEN = NOT REACHED · SESSION PRESENCE = NOT CAUSE (fresh incognito reproduces) · SMTP = NOT REACHED.

## Fix (minimal)
1. `deploy-staging.yml`: the `[no-restart]` conditions are **removed** — a deploy that ships a build always restarts Passenger (SSH ×2 + FTPS fallback, unchanged).
2. `deploy-staging.yml`: new **blocking** last step « Client bundle integrity » — fetches `/fr/auth/magic` and `/fr/eat/auth`, extracts every `/_next/static` asset they reference and requires HTTP 200 on each (retries over the Passenger swap window). This is the exact signature of the incident; `/version.json` alone can never prove it again.
3. `scripts/qa/auth-hydration-smoke.mjs`: real headless-Chrome smoke (fresh profile, logged out, desktop + mobile) on both surfaces — skeleton gone, email + submit visible and enabled, typing reflected (hydration proof), sign-up link visible, no `pageerror`, no hydration error, no `_next` asset ≥ 400. Nothing submitted.
4. `app/[locale]/eat/auth/page.tsx`: an already-authenticated visitor is routed to their space (existing `routeByRole`); logged-out behaviour unchanged.
5. `tests/auth-hydration-p0.test.ts`: pins 1–4 and the magic-link facts (link 15 min, code 10 min, clickable anchor + raw URL + text part, consumption route).

No auth mechanism, TTL, email copy, rate limit, API contract, flag, DNS or Stripe change. The truthfulness hotfix `ca0e19a` is fully preserved.

## Post-fix measurement (deploy `50d418e`, run 34010395629)
- CI: test PASS · FTP · the three restart steps PASS · SHA health PASS · **Client bundle integrity PASS (44 referenced assets served 200 for /fr/auth/magic + /fr/eat/auth)**.
- `scripts/qa/auth-hydration-smoke.mjs https://app.grubano.com` → **4/4 PASS** (magic + consumer auth, desktop + mobile: skeleton gone, email + submit visible/enabled, typing reflected, sign-up link, no pageerror, no hydration error, every asset < 400).
- `business.grubano.com` (same app root, same build) in an interactive real Chrome: `/fr/eat/auth` loads 55/55 requests at 200 (webpack runtime `webpack-69a6c9e9…`, page chunk, CSS), React effects fire (`/api/auth/providers`, `/api/auth/session`), no skeleton; `/fr/auth/magic` see the session record.

### Secondary finding — hosting WAF on business.grubano.com (NOT the P0 cause)
The headless-Chrome smoke against `business.grubano.com` receives **HTTP 429 from the o2switch hosting layer** on the HTML page and on CSS/SVG assets (body marker `Security_Rule … HTTP_Code = "429" … faq.o2switch.fr/…/tiger-protect`, `Server: o2switch-PowerBoost-v3`). Deterministic per run, from the very first request, business domain only; `app.grubano.com` never throttled; curl bursts (12 parallel) and single requests with a HeadlessChrome user agent all 200; the app has no middleware rate limit and its API limiter never touches `_next/static`. Classification: **Tiger Protect (cPanel, per-domain) reacting to the automation-flagged browser** — hosting configuration, not code. The smoke now labels this case `HOST WAF 429 … hydration NOT MEASURABLE` instead of a false hydration FAIL. Founder-side knob if real testers ever see a 429 "Too many requests" page on business.grubano.com: cPanel → Tiger Protect sensitivity for that domain (NOT changed here).

## Rule going forward
Never ship a build without a restart. An ops operator that must reach the server without a restart is delivered by its own operator, never by a build deploy. Post-deploy proof = the CI bundle-integrity gate **plus** `node scripts/qa/auth-hydration-smoke.mjs https://app.grubano.com https://business.grubano.com`.
