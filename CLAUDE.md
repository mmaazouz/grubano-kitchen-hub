---
# GHOSTOS / GRUBANO — Guide Claude Code

## Contexte du projet
Application web de gestion de dark kitchens multi-marques pour Mohammed Maazouz.
Nom de l'app : Grubano (domaine : app.grubano.com)
Hébergement : o2switch (shared hosting, cPanel, Phusion Passenger)

## Stack technique
- Framework : Next.js 14 avec output standalone
- Base de données : MySQL sur o2switch (via Prisma ORM)
- Auth : NextAuth.js avec adapter Prisma MySQL
- Styles : Tailwind CSS + shadcn/ui
- IA : API Anthropic Claude (claude-sonnet-4-20250514)
- SMS/Emails : Brevo API
- Déploiement : scripts/prepare-deploy.ps1 (Windows) ou scripts/deploy.sh (Linux/WSL)

## Structure du projet
/app              — Pages et layouts Next.js 14 (App Router)
/app/api          — Routes API (backend)
  /dashboard      — GET : KPIs du jour (CA, commandes, clients fidélité)
  /loyalty
    /register     — POST : inscription client fidélité
    /validate     — POST : validation commande UberEats + crédit points
  /stocks         — GET/POST : journal de stock (quantités mL, DLC)
/components       — Composants React réutilisables
  Sidebar.tsx     — Navigation latérale (desktop fixe / mobile drawer)
  SidebarContext.tsx — Contexte open/close sidebar
  MobileHeader.tsx   — Barre hamburger mobile
/lib              — Utilitaires
  prisma.ts       — Singleton PrismaClient
/prisma           — Schéma MySQL (Operator, Brand, LoyaltyCustomer, LoyaltyOrder, StockItem…)
/public           — Assets statiques
/scripts
  deploy.sh           — Déploiement SSH (Linux/WSL)
  prepare-deploy.ps1  — Préparation ZIP/deploy (Windows PowerShell)
CLAUDE.md         — Ce fichier

## Variables d'environnement (.env.local)
DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/grubano_db"
ANTHROPIC_API_KEY="sk-ant-..."
BREVO_API_KEY="..."
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="https://app.grubano.com"

## Déploiement o2switch (Phusion Passenger)

### Pourquoi un server.js custom ?
Le `server.js` généré par `next build` (standalone) contient des chemins ABSOLUS
codés en dur pointant vers le poste de build (ex. C:\Users\Lenovo\grubano\...).
Sur o2switch ces chemins n'existent pas → page blanche silencieuse.

Notre `server.js` racine appelle `startServer` de Next.js avec `dir: __dirname`
et remplace le généré à chaque deploy.

### Processus de déploiement Windows
```powershell
# 1. Préparer + zipper
.\scripts\prepare-deploy.ps1

# 2a. Upload via SSH (WSL recommandé)
rsync -avz --delete deploy/ deyi0010@<IP>:/home/deyi0010/grubano.com/

# 2b. Ou upload deploy.zip via cPanel > Gestionnaire de fichiers
```

### Processus de déploiement Linux/WSL
```bash
export GRUBANO_SSH_HOST=<IP_O2SWITCH>
./scripts/deploy.sh
```

### Configuration cPanel > Setup Node.js App
- Node.js version  : 18.x / 20.x (LTS)
- App root         : /home/deyi0010/grubano.com
- App startup file : server.js   ← notre wrapper (PAS le généré par Next.js)
- App URL          : app.grubano.com
- Cliquer "Restart" après chaque déploiement

### Structure remote après déploiement
```
/home/deyi0010/grubano.com/
  server.js          ← wrapper Passenger (dir: __dirname, startServer)
  node_modules/      ← depuis .next/standalone (trimmed)
  package.json
  .next/
    server/          ← code serveur Next.js (depuis standalone)
    static/          ← bundles CSS/JS (CRITIQUE — copiés par deploy)
  public/            ← assets publics (copiés par deploy)
  .env.local         ← variables d'environnement
```

### Diagnostic page blanche
1. Vérifier que `.next/static/` existe sur le remote (cause #1 de page blanche)
2. Vérifier les logs Passenger dans cPanel > Errors
3. Vérifier que `server.js` n'est pas le généré (doit appeler `startServer`)
4. Redémarrer l'app dans cPanel > Setup Node.js App > Restart

## Règles de code
- TypeScript strict partout
- Composants server-side par défaut (Next.js 14 App Router)
- 'use client' uniquement si nécessaire (formulaires, état, effets)
- Prisma pour toutes les requêtes DB (jamais de SQL brut)
- Toujours valider les inputs avec Zod dans les API routes
- Messages d'erreur en français
- Design : Tailwind + shadcn/ui, couleurs Grubano (#E8593C orange, #1a1a2e marine)

## Marques Grubano actuelles
- Gnocchi Bar (best-seller, ~66 % du CA)
- Le Riz Gourmand
- Pasta Fresca
- Rollix (wraps, nouveau)
- Bowl Healthy (à lancer)
- Mac & Cheese Co (à lancer)

## Programme fidélité
- 1 point = 1 € dépensé (arrondi à l'entier inférieur)
- Bonus inscription : 10 points
- Bronze  50 pts → boisson offerte
- Silver 100 pts → dessert offert
- Gold   200 pts → plat offert
- Platine 400 pts → repas complet offert
- Tier calculé automatiquement sur le solde total
---
