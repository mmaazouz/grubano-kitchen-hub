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
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Healthcheck hits the network; keep it out of the default unit run.
    // (qa-report.js runs the healthcheck separately.)
    reporters: 'default',
  },
})
