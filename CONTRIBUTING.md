# Contributing to Grubano

## Branch strategy

```
main ──────────────────────────────────────────► grubano.com (production)
  ▲                                                  auto-deploy on merge
  │  Pull Request (1 approval required)
  │
develop ──────────────────────────────────────► app.grubano.com (staging)
  ▲                                                  auto-deploy on push
  │
feature/your-feature
```

**Rule:** Code always flows `feature → develop → main`. Never push directly to `main`.

---

## Daily development workflow

### 1 — Start a new feature

```bash
git checkout develop
git pull origin develop          # always start from the latest develop

git checkout -b feature/my-feature
```

### 2 — Make changes and push to staging

```bash
# ... write code ...

git add .
git commit -m "feat: add loyalty tier display"
git push origin feature/my-feature

# Or push directly to develop for small fixes:
git checkout develop
git merge feature/my-feature
git push origin develop          # ← triggers staging deploy automatically
```

GitHub Actions will:
1. Build Next.js on Ubuntu (Linux Prisma binaries — correct for o2switch)
2. Package and upload to `/home/deyi0010/app.grubano.com`
3. Restart Passenger
4. Health-check `https://app.grubano.com/dashboard`

**Test your changes at:** https://app.grubano.com

### 3 — When staging looks good: open a Pull Request

On GitHub:
1. Go to **Pull requests** → **New pull request**
2. Base: `main` ← Compare: `develop`
3. Write a clear description of what changed and why
4. Request a review from a team member
5. Wait for **1 approval** + all CI checks to pass

### 4 — Merge to production

After approval:
- Click **Merge pull request** (use **Squash and merge** for a clean history)
- GitHub Actions deploys to `grubano.com` automatically
- Deployment takes ~2 minutes (build + SCP + Passenger restart)
- Health check hits `/dashboard` — if it fails, the deploy is marked ❌

---

## Commit message format

```
type(scope): short description

Types:  feat | fix | refactor | style | docs | chore | perf
Scope:  dashboard | orders | menu | stocks | auth | api | ci | deps

Examples:
  feat(menu): add AI photo scanner for menu items
  fix(stocks): correct quantity unit display in stock list
  chore(deps): upgrade lucide-react to v0.400
```

---

## Environment variables

**Never commit `.env.local`** — it's in `.gitignore`.

| Variable | Where it lives |
|---|---|
| Local dev | `.env.local` (create from `.env.example`) |
| Staging CI | GitHub Secret `DATABASE_URL_STAGING` |
| Production CI | GitHub Secret `DATABASE_URL_PROD` |
| On server | Written by CI from GitHub Secrets each deploy |

To add a new env variable:
1. Add it to `.env.local` locally
2. Add it to GitHub Secrets (Settings → Secrets → Actions)
3. Add it to both workflow files (`deploy-production.yml` and `deploy-staging.yml`) in the "Write .env.local" step
4. Document it in `.env.example`

---

## Database schema changes

Schema lives in `prisma/schema.prisma`.

```bash
# Make your changes to the schema, then:
npx prisma generate          # update the local client
npx prisma db push           # sync to local/dev DB

# CI runs `prisma db push --accept-data-loss` on every deploy.
# For production, prefer creating proper migrations once the schema is stable:
# npx prisma migrate dev --name your_migration_name
```

---

## Emergency production fix (bypass staging)

Only for critical production bugs that need immediate deployment:

```bash
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug
# ... fix ...
git push origin hotfix/critical-bug
```

Then open a PR directly from `hotfix/critical-bug` → `main`.
Get 1 approval, merge → production deploys.
Then merge `main` back into `develop` to keep them in sync:

```bash
git checkout develop
git merge main
git push origin develop
```

---

## CI/CD reference

| Workflow | Trigger | Deploys to | Health check |
|---|---|---|---|
| `deploy-production.yml` | Push to `main` | `grubano.com` | `grubano.com/dashboard` → must be 200 |
| `deploy-staging.yml` | Push to `develop` | `app.grubano.com` | `app.grubano.com/dashboard` → warning only |

Both workflows can be manually triggered from:
**GitHub → Actions → (select workflow) → Run workflow**

---

## Local development setup

```bash
git clone https://github.com/YOUR_ORG/grubano.git
cd grubano

# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your local DB credentials

# Generate Prisma client + sync DB schema
npx prisma generate
npx prisma db push

# Start dev server
npm run dev
```

Open http://localhost:3000

---

## What NOT to do

| ❌ Don't | ✅ Do instead |
|---|---|
| `git push origin main` | Push to `develop`, open PR |
| `git push --force origin main` | Never. Contact the team. |
| Commit `.env.local` | Keep it in `.gitignore`, use GitHub Secrets |
| Skip the staging test | Always verify on `app.grubano.com` before merging |
| Merge your own PR | Get at least 1 teammate review |
| Run `prisma db push` on prod manually | Let CI handle it; use migrations for prod |
