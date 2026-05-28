# GRUBANO — Claude Code Reference
> Read this file before starting any task. All decisions here are frozen unless the user explicitly says otherwise.

---

## SYNC PROTOCOL (mandatory)

### START of every session

```bash
# 1. Set your token (or add NOTION_TOKEN to .env.local permanently)
export NOTION_TOKEN=ntn_xxxx   # ask Mohammed for the token

# 2. Read all agent pages before touching anything
node scripts/notion-sync.js read
```

Read the output fully. Check for:
- Any agent that modified `prisma/schema.prisma` → pull latest + coordinate before touching schema
- Any agent that modified `middleware.ts` → coordinate before touching middleware
- What each agent built last session → avoid duplicating work

### END of every session

```bash
# 1. Write your session summary to Notion
node scripts/notion-sync.js write <your-agent-id> "What you built. Commits: abc123. Next task: X. HTTP status: 200."

# 2. Report cross-agent info / decisions / blockers to the shared inbox
node scripts/notion-sync.js write inbox "[AGENT X] [INFO/DECISION/BLOCKER] message. Action required: yes/no"
# Inbox page ID: 36efd2c9-8146-8195-a65a-d146cfed0642

# 3. Commit and push
git add .
git commit -m "feat|fix|docs: description"
git push origin develop
```

### Agent IDs

| ID | Territory |
|---|---|
| `agent1` | DevOps — CI/CD, deploy scripts, infra |
| `agent2` | Dashboard — operator app (`/dashboard`, `/menu`, `/orders`, `/stocks`, etc.) |
| `agent3` | Consumer — consumer app (`/eat/*`, consumer API routes) |
| `agent4` | Portails — franchise, creators, onboarding portals |

### Notion page IDs (for reference)

```
brain:  36dfd2c9-8146-81ae-bfab-e5e09076ea8e
agent1: 36dfd2c9-8146-8143-9d64-f7efde1029e3
agent2: 36dfd2c9-8146-8106-8049-cc92a50a9112
agent3: 36dfd2c9-8146-81b4-91ec-ecdc8013bad0
agent4: 36dfd2c9-8146-8132-9fd0-f53fc6e12226
inbox:  36efd2c9-8146-8195-a65a-d146cfed0642
```

---

## 1. Project Overview

Multi-brand dark kitchen management platform for Mohammed Maazouz.
- **Operator app** (restaurant dashboard): `grubano.com` and `app.grubano.com`
- **Consumer app** (food ordering): `/eat/*` routes on the same domain
- **Hosting**: o2switch shared hosting, cPanel, Phusion Passenger, Node 24 via nodevenv virtualenv

---

## 2. Stack — FROZEN, do not upgrade without explicit instruction

| Layer | Choice | Version / Note |
|---|---|---|
| Framework | Next.js App Router | 14.2.35, `output: 'standalone'` |
| Database | MySQL on o2switch | via Prisma ORM |
| ORM | Prisma | **5.22.0 pinned** — no `^` caret. Server has global Prisma v7 which breaks things. Always use `./node_modules/.bin/prisma` on server. |
| Auth | NextAuth.js | v4, JWT strategy, CredentialsProvider, bcryptjs |
| Styling | Tailwind CSS + shadcn/ui | Radix primitives |
| AI | Anthropic SDK | `@anthropic-ai/sdk`, model `claude-sonnet-4-5` |
| Email/SMS | Brevo | `@getbrevo/brevo` |
| Validation | Zod | all API routes |
| Password | bcryptjs | cost 12, never bcrypt (native) |
| Forms | react-hook-form + zod | |

---

## 3. Design System — FROZEN

| Token | Value |
|---|---|
| Primary orange | `#E8593C` — Tailwind: `orange-500` equivalent |
| Dark navy | `#1a1a2e` — sidebar, headers |
| Font | Inter (system stack fallback) |
| Component library | shadcn/ui — DO NOT add other UI libraries |
| Mobile-first | Max-width 480px centered for `/eat/*` consumer app |
| Icon library | lucide-react only |

---

## 4. Branch Rules — CRITICAL

```
develop  →  staging   (app.grubano.com)   — all development happens here
main     →  production (grubano.com)      — merge only when staging is verified
```

- **NEVER push broken code to main**
- **NEVER commit `.env.local`** — it is in `.gitignore`
- **NEVER commit private keys** — `deploy_key`, `deploy_key.pub` are in `.gitignore`
- All work goes to `develop`. When staging is confirmed working, user merges to `main`.
- GitHub Actions auto-deploys: push to `develop` → staging CI; push to `main` → production CI.

---

## 5. Agent Territories

### Operator App (restaurant/admin only)
Pages under `/app/(root)` — authenticated, role-gated by `middleware.ts`

| Route | Purpose |
|---|---|
| `/dashboard` | KPIs: revenue, orders, loyalty stats |
| `/menu` | Menu item CRUD, AI dish scan |
| `/orders` | Order management |
| `/stocks` | Stock journal (quantities, DLC, AI suggestions) |
| `/loyalty` | Loyalty program admin |
| `/analytics` | Charts and performance |
| `/brands` | Multi-brand management |
| `/reviews` | Customer reviews |
| `/wallet` | Financial wallet |
| `/suppliers` | Supplier management + orders |
| `/tables` | Table layout + reservations |
| `/customers` | Customer list |
| `/notifications` | Notification center |
| `/cashflow` | Cash flow tracking |
| `/prep` | Prep sheet generator |
| `/onboarding` | Operator onboarding flow |
| `/finance` | Finance overview |
| `/pricing` | Pricing strategy |
| `/marketplace` | B2B marketplace |
| `/dinein` | Dine-in order management |
| `/more` | Settings / more menu |
| `/briefing` | Daily AI briefing |
| `/premium` | Premium plan upsell |
| `/franchise` | Franchise management (role: `franchise`) |
| `/creators` | Creator economy (role: `creator`) |
| `/account` | Account settings (role: `consumer`) |

### Consumer App (`/eat/*`) — PUBLIC, no auth required to browse
Mobile-optimised (max-width 480px). Wrapped in `EatSessionProvider` via `app/eat/layout.tsx`.

| Route | Purpose |
|---|---|
| `/eat` | Home: restaurant list, categories, hero search |
| `/eat/search` | Search + filter (cuisine, delivery time, rating) |
| `/eat/r/[id]` | Restaurant menu, add-to-cart, cart sheet |
| `/eat/cart` | Cart review, address, payment, place order |
| `/eat/track/[orderId]` | Live order tracking with 15s polling |
| `/eat/account` | Consumer loyalty wallet, order history |
| `/eat/auth` | Login / Register (tabs) |

### Auth Pages
| Route | Purpose |
|---|---|
| `/login` | Operator login → redirects by role |
| `/register` | (currently unused — consumers register via `/eat/auth`) |

---

## 6. API Routes

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | — | NextAuth handler |
| `/api/auth/register` | POST | — | Consumer registration (bcrypt, role: consumer) |
| `/api/dashboard` | GET | session | KPI aggregates |
| `/api/brands` | GET, POST | session | Brand CRUD |
| `/api/menu` | GET, POST, PATCH, DELETE | session | Menu item CRUD |
| `/api/menu/scan-dish` | POST | session | AI-assisted dish creation |
| `/api/orders` | GET, POST | session/public | Consumer orders |
| `/api/orders/[id]` | GET | session | Single order |
| `/api/orders/[id]/status` | PATCH | session | Order status update (state machine) |
| `/api/restaurants` | GET | public | Restaurant list (supports q, city, cuisine, sort, take, skip) |
| `/api/restaurants/[id]` | GET | public | Restaurant detail + menu grouped by category |
| `/api/stocks` | GET, POST | session | Stock journal |
| `/api/stocks/update-ai` | POST | session | AI stock suggestions |
| `/api/loyalty/register` | POST | — | Loyalty customer registration |
| `/api/loyalty/validate` | POST | — | UberEats order validation + points credit |
| `/api/loyalty/wallet` | GET | session | Consumer loyalty wallet |
| `/api/reservations` | GET, POST, PATCH | session | Table reservations |
| `/api/email-agent` | POST | CRON_SECRET | Cron-triggered AI email agent |

---

## 7. Database

**MySQL** on o2switch. **Prisma 5.22.0 — pinned, no caret.**

```
binaryTargets = ["native", "debian-openssl-3.0.x", "debian-openssl-1.1.x", "linux-musl-openssl-3.0.x"]
```

### Models summary

| Model | Purpose |
|---|---|
| `Operator` | All users: restaurant/franchise/creator/consumer/admin. Has `password String?` (bcrypt, null for SSO). |
| `Brand` | Multi-brand per operator |
| `LoyaltyCustomer` | Loyalty programme members |
| `LoyaltyOrder` | Points-earning orders (UberEats) |
| `Reward` | Redeemable rewards |
| `MenuItem` | Menu items per brand |
| `Promotion` | Promotions (percent/fixed/bundle/flash) |
| `StockItem` | Stock journal entries |
| `Supplier` / `SupplierProduct` / `SupplierOrder` | Supplier management |
| `RestaurantTable` / `Reservation` | Table management |
| `Account` / `Session` / `VerificationToken` | NextAuth tables |
| `EmailLog` | Email audit log |
| `Creator` / `CreatorDish` | Creator economy |
| `Restaurant` | Consumer-facing restaurant profile (1-to-1 with Operator) |
| `Order` | Consumer orders (state machine: received→preparing→ready→picked_up→delivered→cancelled) |

**MySQL note**: no native array types. Use `Json @default("[]")` for arrays (cuisine, allergens, labels, etc.).

### Schema changes
Always use `./node_modules/.bin/prisma db push` on the server (never global `prisma`):
```bash
bash ~/grubano.com/scripts/server/prisma-push.sh
```

---

## 8. Auth / Role System

**Strategy**: NextAuth.js v4, JWT, CredentialsProvider (bcrypt password check).

| Role | Accessible routes |
|---|---|
| `restaurant` | `/dashboard/*` |
| `franchise` | `/franchise/*` |
| `creator` | `/creators/*` |
| `consumer` | `/account/*`, `/eat/*` |
| `admin` | all routes |

**Public routes** (no auth required — defined in `middleware.ts`):
```
/    /login    /register    /api/auth    /eat
```
The entire `/eat/*` tree is public. Auth within `/eat/*` is optional and handled per-page via `useSession()`.

---

## 9. Key Files

| File | Role |
|---|---|
| `server.js` (root) | Passenger entry point — loads `.env.local`, chmod `.next/`, calls `next/dist/server/lib/start-server`. This is the startup file, NOT `.next/standalone/server.js`. |
| `.next/standalone/server.js` | Auto-generated by build — patched by `fix-server.js` to replace Windows paths. |
| `scripts/fix-server.js` | Patches `outputFileTracingRoot` in `.next/standalone/server.js` from `C:\Users\...` to `/home/deyi0010/grubano.com`. No-op on Linux CI. |
| `scripts/prepare-deploy.ps1` | Windows deploy script: build → patch → copy standalone (with node_modules) → copy .next/static → ZIP. |
| `scripts/server/prisma-push.sh` | Run on server after deploy to sync schema. Uses `./node_modules/.bin/prisma`. |
| `lib/auth.ts` | NextAuth `authOptions` — CredentialsProvider, JWT callbacks injecting `role`. |
| `lib/prisma.ts` | Prisma singleton (global to avoid hot-reload leaks in dev). |
| `middleware.ts` | Route auth + role enforcement. Uses `getToken()` — requires `NEXTAUTH_SECRET`. |
| `components/EatSessionProvider.tsx` | `'use client'` SessionProvider wrapper for `/eat/*` layout. |
| `app/eat/layout.tsx` | Consumer app shell: `EatSessionProvider` + bottom nav (Home/Search/Orders/Account). |
| `next.config.js` | `output: standalone`. No `outputFileTracingRoot` — fix-server.js handles it post-build. |

---

## 10. Deployment Process

### Correct deploy structure
```
deploy-temp/
├── server.js             ← from .next/standalone/server.js (patched)
├── package.json          ← from .next/standalone/package.json
├── node_modules/         ← from .next/standalone/node_modules/ — DO NOT DELETE
│   ├── next/             ← Next.js runtime (required)
│   └── ...               ← ~17 trimmed runtime packages
├── .next/
│   ├── server/           ← from .next/standalone/.next/server/
│   └── static/           ← from .next/static/ (CSS/JS bundles)
├── prisma/
│   └── schema.prisma
├── public/
├── .env.local            ← runtime secrets
└── .htaccess             ← Passenger config (ASCII, no BOM)
```

### Critical: standalone node_modules
`.next/standalone/node_modules/` is a **trimmed runtime set** (~17 packages) built by Next.js standalone mode. It is NOT the root `node_modules`. **Never delete it.** The server cannot start without it (`Cannot find module 'next'`).

### Windows local deploy
```powershell
npm run build
# (fix-server.js is called automatically inside prepare-deploy.ps1)
.\scripts\prepare-deploy.ps1
# ZIP size should be 30-100 MB with node_modules/next verified
```

### GitHub Actions (automated)
- Push to `develop` → `.github/workflows/deploy-staging.yml` → FTP to `app.grubano.com`
- Push to `main` → `.github/workflows/deploy-production.yml` → FTP to `grubano.com`
- Both workflows: copy full standalone (with node_modules) → no `npm ci` on server

### Post-deploy steps (manual, via cPanel Terminal)
```bash
chmod -R 755 ~/grubano.com/.next/
chmod 600    ~/grubano.com/.env.local
mkdir -p ~/grubano.com/tmp
touch ~/grubano.com/tmp/restart.txt
```

### Schema sync (only when schema changed)
```bash
bash ~/grubano.com/scripts/server/prisma-push.sh
```

### Health check
```bash
curl -I https://grubano.com/eat
# Expect: HTTP 200
```

---

## 11. Environment Variables

Names only — values live in `.env.local` (never committed) and GitHub Secrets.

### Runtime (`.env.local` on server)
```
DATABASE_URL          MySQL connection string
NEXTAUTH_SECRET       Required for JWT + middleware.ts getToken()
NEXTAUTH_URL          https://grubano.com (prod) or https://app.grubano.com (staging)
ANTHROPIC_API_KEY     Claude API
SMTP_HOST             Email sending
SMTP_USER
SMTP_PASS
CRON_SECRET           Protects /api/email-agent endpoint
NODE_ENV              production
NOTION_TOKEN          Notion integration token — for scripts/notion-sync.js (dev only, not deployed)
```

### GitHub Secrets (CI/CD)
```
DATABASE_URL_PROD        Production DB
DATABASE_URL_STAGING     Staging DB
NEXTAUTH_SECRET
ENV_LOCAL_CONTENT        Full .env.local file content (replaces per-secret sprawl)
ANTHROPIC_API_KEY
SMTP_HOST / SMTP_USER / SMTP_PASS
CRON_SECRET
O2SWITCH_HOST            FTP + SSH hostname
O2SWITCH_FTP_USER        FTP username
O2SWITCH_FTP_PASS        FTP password
O2SWITCH_USER            SSH username
O2SWITCH_SSH_KEY         SSH private key (PEM)
```

---

## 12. Code Rules

- **TypeScript strict** everywhere — no `any` without comment
- **Server components by default** — only add `'use client'` when the component needs state, effects, or browser APIs
- **Never raw SQL** — use Prisma for all DB access
- **Zod** for all API route input validation
- **`useSearchParams()` requires `<Suspense>`** wrapper in Next.js 14 App Router (build fails without it)
- **bcryptjs** (not `bcrypt`) — cost 12 for registration, `bcrypt.compare()` for login
- Error messages in French (UI-facing), English in comments and logs
- No new UI libraries — use existing shadcn/ui components

---

## 13. Loyalty Programme

- 1 point = 1 € spent (floor)
- Signup bonus: 10 points
- Tiers: Bronze 50 pts → Silver 100 pts → Gold 200 pts → Platinum 400 pts
- Points credited on `Order.status = 'delivered'` via `loyaltyCustomer.updateMany`

---

## 14. Brands

| Brand | Status |
|---|---|
| Gnocchi Bar | Active (~66% revenue) |
| Le Riz Gourmand | Active |
| Pasta Fresca | Active |
| Rollix (wraps) | Active, new |
| Bowl Healthy | Launching |
| Mac & Cheese Co | Launching |

---

## 15. Common Gotchas

| Problem | Cause | Fix |
|---|---|---|
| `Cannot find module 'next'` | Standalone `node_modules` was deleted from deploy | Copy `.next/standalone/` entirely — never delete its `node_modules` |
| Server 500 on every request | `NEXTAUTH_SECRET` missing from `.env.local` | Ensure `.env.local` on server has all required vars |
| Blank page (styles missing) | `.next/static/` not copied to deploy | Deploy script copies `.next/static/` separately — standalone does not include it |
| Windows path in server.js on Linux | Build run on Windows embeds `C:\Users\...` | `scripts/fix-server.js` patches it post-build |
| `prisma: command not found` or wrong version | Server has global Prisma v7 | Always use `./node_modules/.bin/prisma` (see `scripts/server/prisma-push.sh`) |
| `useSearchParams()` build error | Missing `<Suspense>` boundary | Wrap component using `useSearchParams()` in `<Suspense fallback={...}>` |
| FTP blocks node_modules | CloudLinux o2switch restriction | Resolved — standalone node_modules is now uploaded via FTP (it's trimmed, not the full root node_modules) |
