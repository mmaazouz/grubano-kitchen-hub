# GRUBANO — Claude Code Reference
> Read this file before starting any task. All decisions here are frozen unless the user explicitly says otherwise.

---

## RÈGLES D'EXÉCUTION AGENTS

**RÈGLE ABSOLUE :** aucun agent ne demande JAMAIS d'autorisation, de validation ou de confirmation à l'utilisateur en cours de tâche (ni avant un commit, ni avant un push, ni avant de déployer). Le déploiement est automatique au push sur `develop` (GitHub Actions). Tu exécutes tout de bout en bout : **code → commits → push origin develop → END**. Tu ne t'arrêtes QUE si techniquement bloqué (clé/info indispensable manquante). Toute pause pour attendre un accord est une faute.

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
#    For SHORT messages (< 500 chars, no special chars), inline is fine:
node scripts/notion-sync.js write <your-agent-id> "What you built. Commits: abc123. Next: X. HTTP 200."
#
#    For LONG reports OR any content with special chars (! () "" accents / \ &),
#    write to a file FIRST and use the file mode — shell quoting is bypassed
#    and Notion's 2000-char-per-text limit is handled automatically:
echo "Long multi-paragraph report with accents éàç, parens (), quotes…" > /tmp/report.md
node scripts/notion-sync.js write-file <your-agent-id> /tmp/report.md

# 2. Report cross-agent info / decisions / blockers to the shared inbox
#    Same rules — inline for short, file mode for long:
node scripts/notion-sync.js write inbox "[AGENT X] [INFO/DECISION/BLOCKER] short message. Action required: yes/no"
# OR (recommended for any non-trivial report):
node scripts/notion-sync.js write-inbox-file /tmp/inbox-report.md
# Inbox page ID: 384fd2c9-8146-810e-9138-ff595f550629  (📥 Inbox rapports v22)

# 3. ALWAYS check the LAST line of stdout — the script does a read-back:
#       ✅ Inbox mise à jour, entrée confirmée présente            → success
#       ❌ ÉCHEC : l'entrée n'apparaît pas après écriture           → failed, retry
#    If you see ❌ on inline mode, RETRY with the file mode (write-file /
#    write-inbox-file). The script also exits 1 on failure, so a CI pipeline
#    can `&& git push` and refuse to push on failed sync.

# 4. Commit and push
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
inbox:  38dfd2c9-8146-8108-8ccd-d663ca1274a3   (v73 — archives READ-ONLY : v72 38cfd2c9-8146-8155-9159-e8e5e823644d, v71 38cfd2c9-8146-8178-9538-fcd261f09041, v70 38bfd2c9-8146-818f-a810-e8c714ebcba6, v69 38bfd2c9-8146-81d6-91c5-f534857f23a4, v68 38bfd2c9-8146-81c4-9f2c-e9cb8661aea8, v67 38afd2c9-8146-817f-810c-e89b1ba312e9, v66 38afd2c9-8146-81d1-93dc-f030fa82eeb5, v65 38afd2c9-8146-8105-b288-d8874e586f9f, v64 38afd2c9-8146-8107-b229-d06c0bb734b9, v63 389fd2c9-8146-816e-8168-f7320621f85c, v62 389fd2c9-8146-8116-b2d6-f605e46aa157, v61 389fd2c9-8146-817b-bc3c-dc4213c44cc7, v60 389fd2c9-8146-8153-b692-c804fbd52054, v59 389fd2c9-8146-81bc-9329-c1459129421e, v58 389fd2c9-8146-81d9-8527-e8e0a2884a45, v57 388fd2c9-8146-81ce-9293-f27b93f09653, v56 388fd2c9-8146-8150-ac4c-e5ad739964bb, v55 388fd2c9-8146-8164-bf5b-cc10b26dba00, v54 388fd2c9-8146-81c7-9338-cdfb636b1d79, v53 388fd2c9-8146-81d4-9a65-ce8a227d3c77, v52 388fd2c9-8146-814c-93b4-ef07f6d31509, v51 388fd2c9-8146-8145-995e-c48c6219cece, v50 388fd2c9-8146-8148-a88f-ccc5152f6877, v49 388fd2c9-8146-8192-9e4c-d6bcefd017c6, v48 388fd2c9-8146-81c5-a040-c65333d64e13, v47 387fd2c9-8146-8143-bd95-e75e38b3324a, v46 387fd2c9-8146-81a7-a47b-dad512478efa, v45 387fd2c9-8146-81cf-b25c-ddd2458c4429, v44 387fd2c9-8146-8177-af76-d9891be98e12, v43 387fd2c9-8146-8160-b95b-f0f5513ad659, v42 387fd2c9-8146-8162-8caf-f0b53562d168, v41 387fd2c9-8146-8140-86ff-fd9cabb35d0d, v40 387fd2c9-8146-8173-92ad-f4dec6ed503a, v39 387fd2c9-8146-818f-888d-df6bc8478b89, v38 387fd2c9-8146-8114-a255-f60013f3d991, v37 386fd2c9-8146-810a-b8ed-d90702b2fb93, v36 386fd2c9-8146-81ac-9e40-e0ea6d0b687d, v35 386fd2c9-8146-81d0-9f0d-e08288f76c52, v34 385fd2c9-8146-8184-9859-cb12b48d6054, v33 385fd2c9-8146-811c-9021-e794c348f019, v32 385fd2c9-8146-814c-a7b5-d2174c410255, v31 385fd2c9-8146-8145-a6e9-ccb082c5ce05, v30 385fd2c9-8146-81bc-9e2b-c0e2571796d0, v29 385fd2c9-8146-813a-b46d-f3387d3486dc, v28 385fd2c9-8146-8146-8641-dbe950e28977, v27 384fd2c9-8146-814c-bccc-f3de65b0bafb, v26 384fd2c9-8146-81d2-8997-f784acfcda94, v25 384fd2c9-8146-81e0-beb1-c422265a8c1a, v24 384fd2c9-8146-81c9-a712-caf377890dd8, v23 384fd2c9-8146-81e6-91a3-f73041f700b7, v22 384fd2c9-8146-810e-9138-ff595f550629, v21 383fd2c9-8146-8127-b725-eba2f0fa375c, v20 383fd2c9-8146-816d-8439-cfb4c8d00d53, v19 383fd2c9-8146-8155-a904-f1b7d23a54ef, v18 383fd2c9-8146-816b-a199-f2234c066a76, v17 382fd2c9-8146-81cd-a328-ca0627138786, v16 382fd2c9-8146-81ed-baaf-f6e81c119aa4, v15 382fd2c9-8146-8108-911a-fe4febc65e8d, v14 381fd2c9-8146-81bb-947e-f7d0f8ab0cb5, v13 381fd2c9-8146-81f7-bff1-fedc1a2acb4e, v12 380fd2c9-8146-811b-a76b-f436a57b170c, v11 380fd2c9-8146-81aa-8e51-c732972fe4b5, v10 37ffd2c9-8146-8173-ab59-dbd3d7011fcf, v9 37ffd2c9-8146-81d9-b80b-dc038617c533, v8 37ffd2c9-8146-81da-867a-e5b1882c8e94, v7 37ffd2c9-8146-815f-adae-de59909bc765, v6 37efd2c9-8146-814a-aaed-ef6112fa41be, v5 37dfd2c9-8146-817f-8920-c5ad7fe80eae, v4 37dfd2c9-8146-81ab-8cdf-cb8c26038bfc, v3 37cfd2c9-8146-8137-9889-ec75eea3b2e2, v2 37cfd2c9-8146-81d8-860e-c19723e09b15, v1 36efd2c9-8146-8195-a65a-d146cfed0642)
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
| Responsive (Agent 150) | `/eat/*` consumer app: **mobile-first** centered 480px column + bottom-nav (≤md); **desktop (≥lg)** = widened responsive container (cap ~1200px, multi-column) + persistent left rail (bottom-nav → side rail). Breakpoints = Tailwind defaults (sm 640 / lg 1024 / xl 1280). The operator app is unaffected. |
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
