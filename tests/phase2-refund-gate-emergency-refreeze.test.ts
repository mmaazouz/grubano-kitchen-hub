// tests/phase2-refund-gate-emergency-refreeze.test.ts
// BLOCKING defect found by the closeout audit (2026-09-09): the refund window's `finally` block only
// runs if the process REACHES it. A Ctrl-C, an SSH hangup, a kill, or an uncaught throw would leave
// REFUNDS_ENABLED=true in .env.local and the staging refund gate OPEN.
//
// The fix arms a synchronous emergency re-freeze the moment the flag is written to true. A real signal
// cannot be delivered to a child process on Windows, so these tests exercise the ACTUAL exported
// primitives against a real temp .env.local — the same function the signal handlers call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// The operator reads PHASE2_APP_ROOT ONCE, at module load (touchRestart writes APP_ROOT/tmp/restart.txt).
// Point it at a sandbox BEFORE requiring it, so nothing in this suite can touch the real app root.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-refreeze-root-'))
process.env.PHASE2_APP_ROOT = SANDBOX

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GATE = require('../scripts/server/phase2-refund-gate.js') as {
  writeFlag: (envFile: string, key: string, value: string, stamp: string) => { changed: boolean; backup: string | null }
  emergencyRefreeze: (reason: string) => boolean
  armRefreeze: (envFile: string, stamp: string) => void
  isRefreezeArmed: () => boolean
}

const ENV_BASE = 'DATABASE_URL=mysql://u:p@h/grubano_staging\nNEXTAUTH_URL=https://app.grubano.com\nSTRIPE_SECRET_KEY=sk_test_x\nREFUNDS_ENABLED=false\nSMTP_PASS=secret\n'
const effective = (text: string) => {
  let v: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (m && m[1] === 'REFUNDS_ENABLED') v = m[2].trim().replace(/^["']|["']$/g, '') // last occurrence wins
  }
  return v
}

let dir: string, envFile: string, logs: string[]
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-refreeze-'))
  envFile = path.join(dir, '.env.local')
  fs.writeFileSync(envFile, ENV_BASE)
  fs.rmSync(path.join(SANDBOX, 'tmp'), { recursive: true, force: true }) // restart marker starts absent
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')) })
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('emergency re-freeze — the refund gate must never survive an interrupted window', () => {
  it('does nothing when not armed (a precheck-only run must never touch the flag)', () => {
    expect(GATE.isRefreezeArmed()).toBe(false)
    expect(GATE.emergencyRefreeze('SIGINT')).toBe(false)
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV_BASE) // byte-identical
  })

  it('an interrupted OPEN window is re-frozen: REFUNDS_ENABLED goes back to false and a restart is triggered', () => {
    // simulate the window: arm, then open the gate exactly as the operator does
    GATE.armRefreeze(envFile, '2026-09-09T17-44-00-000Z')
    GATE.writeFlag(envFile, 'REFUNDS_ENABLED', 'true', '2026-09-09T17-44-00-000Z')
    expect(effective(fs.readFileSync(envFile, 'utf8'))).toBe('true') // gate is OPEN

    // ...and now the operator is killed (Ctrl-C / SSH hangup / uncaught throw)
    expect(GATE.emergencyRefreeze('SIGINT')).toBe(true)

    expect(effective(fs.readFileSync(envFile, 'utf8'))).toBe('false')
    expect(fs.existsSync(path.join(SANDBOX, 'tmp', 'restart.txt'))).toBe(true) // Passenger reload requested
    expect(logs.join('\n')).toMatch(/EMERGENCY REFREEZE \(SIGINT\)/)
    expect(logs.join('\n')).toMatch(/VERIFY THE GATE MANUALLY/)
  })

  it('every other secret in .env.local survives the emergency write untouched', () => {
    GATE.armRefreeze(envFile, '2026-09-09T17-44-00-000Z')
    GATE.writeFlag(envFile, 'REFUNDS_ENABLED', 'true', '2026-09-09T17-44-00-000Z')
    GATE.emergencyRefreeze('SIGHUP')
    const after = fs.readFileSync(envFile, 'utf8')
    expect(after).toMatch(/^DATABASE_URL=mysql:\/\/u:p@h\/grubano_staging$/m)
    expect(after).toMatch(/^STRIPE_SECRET_KEY=sk_test_x$/m)
    expect(after).toMatch(/^SMTP_PASS=secret$/m)
    expect(after).not.toMatch(/REFUNDS_ENABLED=true/)
  })

  it('never prints a secret value while re-freezing', () => {
    GATE.armRefreeze(envFile, '2026-09-09T17-44-00-000Z')
    GATE.writeFlag(envFile, 'REFUNDS_ENABLED', 'true', '2026-09-09T17-44-00-000Z')
    GATE.emergencyRefreeze('SIGTERM')
    const out = logs.join('\n')
    expect(out).not.toContain('sk_test_x')
    expect(out).not.toContain('secret')
    expect(out).not.toContain('mysql://')
  })

  it('fires once only — a second signal cannot re-write or re-trigger it', () => {
    GATE.armRefreeze(envFile, '2026-09-09T17-44-00-000Z')
    GATE.writeFlag(envFile, 'REFUNDS_ENABLED', 'true', '2026-09-09T17-44-00-000Z')
    expect(GATE.emergencyRefreeze('SIGINT')).toBe(true)
    expect(GATE.isRefreezeArmed()).toBe(false)
    const snapshot = fs.readFileSync(envFile, 'utf8')
    expect(GATE.emergencyRefreeze('SIGINT')).toBe(false)
    expect(fs.readFileSync(envFile, 'utf8')).toBe(snapshot)
  })

  it('is safe when the flag is somehow already false (idempotent, still reports)', () => {
    GATE.armRefreeze(envFile, '2026-09-09T17-44-00-000Z')
    expect(GATE.emergencyRefreeze('uncaughtException')).toBe(true)
    expect(effective(fs.readFileSync(envFile, 'utf8'))).toBe('false')
  })

  it('reports HUMAN ACTION REQUIRED instead of failing silently when the write is impossible', () => {
    GATE.armRefreeze(path.join(dir, 'does', 'not', 'exist', '.env.local'), '2026-09-09T17-44-00-000Z')
    expect(GATE.emergencyRefreeze('SIGINT')).toBe(false)
    expect(logs.join('\n')).toMatch(/EMERGENCY REFREEZE FAILED/)
    expect(logs.join('\n')).toMatch(/HUMAN ACTION REQUIRED NOW/)
  })
})
