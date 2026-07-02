# Operator visual-QA tooling (`scripts/qa/`)

Lets a visual-QA robot **log in as a real STAGING test operator** and screenshot the
~29 auth-gated operator screens, pixel-diffing the ones that have a committed CD ref
(`scripts/design-qa-refs/op-*.html`).

> **STAGING ONLY — never production.** The seeded account logs in **normally** through
> the same NextAuth/`bcrypt` path a real operator uses. **No auth weakening.** This is
> pure tooling: it never touches app code, routes, money, `middleware.ts`, `lib/auth.ts`,
> or the Prisma schema — it only writes ordinary rows and calls public HTTP endpoints.

Artifacts land under `design-qa/operator/<screen>/<viewport>/{app,ref,diff}.png` + `resume.json`.

---

## 1. Seed the QA operator (STAGING DB only)

Point `DATABASE_URL` at **staging**, pick a strong password, and pass **both** confirmations:

```bash
DATABASE_URL="$DATABASE_URL_STAGING" \
QA_EMAIL='qa+op@grubano.test' \
QA_PASSWORD='<pick-a-strong-one>' \
QA_SEED_CONFIRM=STAGING_ONLY \
node scripts/qa/seed-qa-operator.mjs --confirm-staging
```

The seed prints a **pre-flight** (target DB host + database + `QA_EMAIL`) before writing,
then at the end prints the ids the robot needs:

```
QA_EMAIL         = qa+op@grubano.test
QA_RESTAURANT_ID = <cuid>
QA_BRAND_ID      = <cuid>
QA_SUPPLIER_ID   = <cuid>
```

Note those three ids — the robot uses them for the dynamic `[id]` routes
(`/marketplace/suppliers/<supplier>`, `/brands/<brand>/franchise`,
`/dashboard/establishments/<restaurant>`).

It seeds: 1 Operator (role `restaurant`, status `active`, KYB display fields so `/more`
shows data), 1 Restaurant (`QA Bistro`), 1 Brand (`QA Trattoria`), 3 MenuItems, 2
StockItems, 1 LoyaltyCustomer, **and the marketplace fixture**: 1 `SupplierProfile`
(`active`, **no Stripe KYB** → the `/pay` flow stays honestly gated), a 4-item catalogue
(CENTS), and 2 `SupplyOrder`s — one `confirmed`/`unpaid` (shows the **Payer** CTA →
gated 403) and one `delivered`/`paid` (shows in the **Livrées** tab with real 1 % economics).
So **Boutique fournisseur + Commandes fournisseurs** render **non-empty**. It is
**idempotent** — re-running upserts / find-or-creates, never duplicates.

### Prod-guard (why the seed refuses to run)

The seed **exits 1** unless **all** of these hold:

| Guard | Condition |
|---|---|
| Explicit flag | `--confirm-staging` is in the argv |
| Explicit env | `QA_SEED_CONFIRM === 'STAGING_ONLY'` |
| DB present | `DATABASE_URL` is non-empty |
| Creds present | `QA_EMAIL` **and** `QA_PASSWORD` are non-empty |
| Test-ish email | `QA_EMAIL` contains `+qa` **or** ends with `.test` / `.qa` (a plain real-looking address is rejected) |
| Not prod URL | `NEXTAUTH_URL !== 'https://grubano.com'` (override only with `FORCE=1` — **dangerous**) |

It also prints the parsed DB **host + database** and `QA_EMAIL` before any write, and
wraps all writes in `try/finally prisma.$disconnect()`.

---

## 2. Run the robot

```bash
QA_BASE_URL=https://app.grubano.com \
QA_EMAIL='qa+op@grubano.test' \
QA_PASSWORD='<same-password>' \
QA_RESTAURANT_ID='<from step 1>' \
QA_BRAND_ID='<from step 1>' \
QA_SUPPLIER_ID='<from step 1>' \
node scripts/qa/operator-visual-qa.mjs
```

- `QA_BASE_URL` defaults to `https://app.grubano.com` (staging).
- `CHROME_BIN` — set it if the installed Chrome/Edge isn't auto-detected.
- The robot **logs in first** (programmatic NextAuth Credentials over `fetch`) and fails
  fast with a clear message if the session cookie can't be obtained (wrong password, or
  the account doesn't exist / isn't active on staging).
- If a screen's final URL is still `/eat/auth` after login, the robot **warns** that the
  account may lack the operator role (expected `restaurant` / `admin`).

Dynamic `[id]` screens are **skipped with a warning** if their id env var
(`QA_RESTAURANT_ID` / `QA_BRAND_ID` / `QA_SUPPLIER_ID`) is missing.

---

## 3. Artifacts

```
design-qa/operator/
  <screen>/
    <viewport>/
      app.png     ← the real staging page (authenticated)
      ref.png     ← the CD reference mock       (only when a ref exists)
      diff.png    ← pixelmatch highlight         (only when a ref exists)
    resume.json   ← per-viewport diff %
  resume.json     ← run-wide summary
```

Screens with a committed CD ref get a `diff%`; the rest are **capture-only**. A final
`console.table` prints `{screen, viewport, hasRef, diff%}`.
