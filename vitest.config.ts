import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Vitest harness for Grubano (Agent 8 — QA).
// - Node environment: these are unit/route tests, no DOM needed.
// - `@/*` alias mirrors tsconfig.json so `@/lib/...` imports resolve.
// - No real DB: Prisma is mocked per-test via vi.mock('@/lib/prisma').
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    // P0-38 — pool 'forks' : chaque worker est un PROCESSUS (env isolé). Le pool
    // 'threads' par défaut PARTAGE process.env entre workers concurrents : un
    // fichier qui arme un flag (ex. middleware.test arme les 4 rôles) polluait un
    // fichier voisin qui assert flag OFF (role-locks) — la classe exacte du flaky
    // signalé en vague 1 (webhook-ghost-order-reconcile : vert en isolation,
    // rouge en parallèle). Avec forks, l'env est par processus → classe éteinte.
    pool: 'forks',
    // D5 (closed beta) — le CONNECT-READY GATE refuse toute commande/paiement
    // vers un resto sans Connect actif. Les harnais historiques (fixtures sans
    // stripeAccountId) exercent le comportement plateforme : on ouvre le
    // danger-flag QA par défaut pour TOUTE la suite — les tests dédiés du gate
    // (tests/connect-gate.test.ts, orders-pay-route D5) le suppriment
    // explicitement pour prouver le refus par défaut.
    env: { ALLOW_PLATFORM_FALLBACK: 'true' },
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Healthcheck hits the network; keep it out of the default unit run.
    // (qa-report.js runs the healthcheck separately.)
    reporters: 'default',
  },
})
