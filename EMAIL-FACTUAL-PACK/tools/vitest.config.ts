// EMAIL FACTUAL PACK — render harness config. Run from the repo root:
//   npx vitest run --config EMAIL-FACTUAL-PACK/tools/vitest.config.ts
// Nothing is sent: nodemailer + prisma are mocked inside render-current.test.ts.
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')
export default defineConfig({
  root: ROOT,
  resolve: { alias: { '@': ROOT } },
  test: {
    pool: 'forks',
    environment: 'node',
    globals: true,
    include: ['EMAIL-FACTUAL-PACK/tools/render-current.test.ts'],
    testTimeout: 120000,
    reporters: 'default',
  },
})
