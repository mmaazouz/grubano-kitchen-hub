import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Do NOT reimplement the completeness logic — delegate to Agent 7's authoritative
// gate (scripts/check-translations.js). This makes a missing/empty translation
// key fail `npm test` too, not just `npm run check:i18n`.
describe('i18n completeness (delegates to scripts/check-translations.js)', () => {
  it('all locales are complete (exit code 0)', () => {
    const script = path.resolve(__dirname, '..', 'scripts', 'check-translations.js')
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    if (r.status !== 0) {
      // Surface the script's own report so the failing keys are visible in CI.
      throw new Error(`check-translations.js failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`)
    }
    expect(r.status).toBe(0)
  })
})
