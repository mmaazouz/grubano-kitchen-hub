// tests/phase2-claims-gate-emergency-close.test.ts — T-55
//
// The claims operator arms a synchronous emergency close the moment it writes the flag true. Its
// refund twin has had seven tests since the closeout audit; this one had none, and an untested
// safety mechanism is not a safety mechanism.
//
// A real signal cannot be delivered to a child process on Windows, so these tests drive the
// ACTUAL exported primitives — the very functions the signal handlers call — against a real temp
// .env.local.
//
// IMPORTANT, and asserted below: this is process-local cleanup, NOT a SIGKILL handler. No such
// handler can exist. The property that actually holds under process death is the T-53 lease:
// after the deadline the surface is denied even if this cleanup never ran.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// The operator reads PHASE2_APP_ROOT ONCE at module load (touchRestart writes tmp/restart.txt).
// Point it at a sandbox BEFORE requiring it so nothing here can touch the real app root.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-claims-close-root-'))
process.env.PHASE2_APP_ROOT = SANDBOX

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GATE = require('../scripts/server/phase2-claims-gate.js') as {
  writeFlag: (envFile: string, key: string, value: string, stamp: string) => { changed: boolean; backup: string | null }
  emergencyClose: (reason: string) => boolean
  armClose: (envFile: string, stamp: string) => void
  isCloseArmed: () => boolean
  CONFIRM_SENTENCE: string
}

const ENV_BASE = [
  'DATABASE_URL=mysql://u:p@h/grubano_staging',
  'NEXTAUTH_URL=https://app.grubano.com',
  'CLAIMS_ENABLED=false',
  'REFUNDS_ENABLED=false',
  'SMTP_PASS=secret',
  '',
].join('\n')

/** Last-occurrence-wins read, matching the loader the deployed app uses. */
const effective = (text: string, key: string) => {
  let v: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (m && m[1] === key) v = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return v
}

let dir: string, envFile: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-claims-close-'))
  envFile = path.join(dir, '.env.local')
  fs.writeFileSync(envFile, ENV_BASE)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('NORMAL CLOSE — the flag comes back to false and the disarm follows the disk', () => {
  it('writeFlag flips the value and leaves a backup', () => {
    const r = GATE.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', 'S1')
    expect(r.changed).toBe(true)
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'CLAIMS_ENABLED')).toBe('true')
    const back = GATE.writeFlag(envFile, 'CLAIMS_ENABLED', 'false', 'S1Z')
    expect(back.changed).toBe(true)
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'CLAIMS_ENABLED')).toBe('false')
  })

  it('closing NEVER touches the refund flag', () => {
    GATE.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', 'S2')
    GATE.armClose(envFile, 'S2')
    GATE.emergencyClose('SIGINT')
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'REFUNDS_ENABLED')).toBe('false')
  })
})

describe('CATCHABLE SIGNAL / UNCAUGHT THROW — the armed close runs synchronously', () => {
  it('armed → emergencyClose writes false and reports that it acted', () => {
    GATE.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', 'S3')
    GATE.armClose(envFile, 'S3')
    expect(GATE.isCloseArmed()).toBe(true)
    expect(GATE.emergencyClose('SIGINT')).toBe(true)
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'CLAIMS_ENABLED')).toBe('false')
  })

  it('it disarms itself, so a second signal cannot re-run it', () => {
    GATE.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', 'S4')
    GATE.armClose(envFile, 'S4')
    expect(GATE.emergencyClose('SIGTERM')).toBe(true)
    expect(GATE.isCloseArmed()).toBe(false)
    expect(GATE.emergencyClose('SIGTERM')).toBe(false)
  })

  it('NOT armed → it does nothing and says so (never writes on a whim)', () => {
    const before = fs.readFileSync(envFile, 'utf8')
    expect(GATE.emergencyClose('SIGHUP')).toBe(false)
    expect(fs.readFileSync(envFile, 'utf8')).toBe(before)
  })

  it('it also expires the lease, not only the flag', () => {
    GATE.writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', new Date(Date.now() + 900_000).toISOString(), 'S5')
    GATE.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', 'S5')
    GATE.armClose(envFile, 'S5')
    GATE.emergencyClose('SIGINT')
    const text = fs.readFileSync(envFile, 'utf8')
    expect(effective(text, 'CLAIMS_ENABLED')).toBe('false')
    const lease = effective(text, 'CLAIMS_WINDOW_UNTIL')
    expect(Date.parse(lease ?? '')).toBeLessThan(Date.now()) // in the past ⇒ the app refuses
  })
})

describe('CLEANUP FAILURE — the lease is the property that actually holds', () => {
  it('if the cleanup never runs at all, the on-disk flag stays true', () => {
    // This is the honest statement of the limit: no handler can cover SIGKILL.
    GATE.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', 'S6')
    GATE.armClose(envFile, 'S6')
    // …process is killed with -9 here. Nothing runs.
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'CLAIMS_ENABLED')).toBe('true')
  })

  it('…and the application still refuses, because the lease expires on its own', async () => {
    const { isClaimsEnabled } = await import('@/lib/claims')
    vi.stubEnv('CLAIMS_ENABLED', 'true')                                   // the stale on-disk flag
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', new Date(Date.now() - 1000).toISOString())
    expect(isClaimsEnabled()).toBe(false)                                   // ← T-53 carries it
    vi.unstubAllEnvs()
  })

  it('an unwritable env file does not throw out of the handler', () => {
    GATE.armClose(path.join(dir, 'does', 'not', 'exist', '.env.local'), 'S7')
    expect(() => GATE.emergencyClose('SIGINT')).not.toThrow()
  })
})

describe('THE OPERATOR STILL REQUIRES AN EXPLICIT FOUNDER SENTENCE', () => {
  it('the confirmation sentence is a real non-empty constant', () => {
    expect(typeof GATE.CONFIRM_SENTENCE).toBe('string')
    expect(GATE.CONFIRM_SENTENCE.length).toBeGreaterThan(10)
  })

  it('the operator source claims no SIGKILL handler', () => {
    const src = fs.readFileSync('scripts/server/phase2-claims-gate.js', 'utf8')
    expect(src).toMatch(/NOT and cannot be a SIGKILL handler/)
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
describe('negative control — an unarmed-but-writing close would be caught', () => {
  it('a handler that wrote regardless of arming would clobber an untouched file', () => {
    const naive = () => { fs.writeFileSync(envFile, 'CLAIMS_ENABLED=false\n') } // the wrong design
    const before = fs.readFileSync(envFile, 'utf8')
    expect(GATE.emergencyClose('SIGINT')).toBe(false)
    expect(fs.readFileSync(envFile, 'utf8')).toBe(before) // ← real behaviour: untouched
    naive()
    expect(fs.readFileSync(envFile, 'utf8')).not.toBe(before) // ← what the defect would do
  })
})

// ══ AUDIT FIX — THE OPERATOR'S PRECONDITIONS ARE PINNED ═════════════════════════
// The audit noted every precondition lives in an unexported main(), so the section claiming the
// operator "still requires an explicit founder sentence" proved only that a constant exists.
// These pin the guards themselves at source level: crude, but they fail if a guard is deleted.
describe('the claims window operator refuses to open unless every precondition holds', () => {
  const src = fs.readFileSync('scripts/server/phase2-claims-gate.js', 'utf8')

  it('it refuses to become a money-moving rehearsal', () => {
    expect(src).toContain("process.env.PHASE2_CLAIMS_WITH_REFUNDS === '1'")
    expect(src).toMatch(/REFUSED BY DESIGN/)
  })

  it('it requires the founder sentence, and refuses on any precheck anomaly', () => {
    expect(src).toContain('PHASE2_CLAIMS_WINDOW_CONFIRM !== CONFIRM_SENTENCE')
    expect(src).toContain("if (anomalies.length) return fail('3 window: precheck anomalies")
  })

  it('it requires BOTH gates closed before opening — claims and refunds', () => {
    expect(src).toContain("if (claimsGate0 !== 'CLOSED')")
    expect(src).toContain("if (refundGate0 !== 'CLOSED')")
  })

  it('it writes the T-53 lease BEFORE the flag, and expires it FIRST on close', () => {
    const openAt  = src.indexOf("writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', leaseUntil, stamp)")
    const flagAt  = src.indexOf("const opened = writeFlag(envFile, 'CLAIMS_ENABLED', 'true', stamp)")
    expect(openAt).toBeGreaterThan(-1)
    expect(flagAt).toBeGreaterThan(openAt) // lease first: no instant where the flag stands alone
    const closeLease = src.indexOf("writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', new Date(Date.now() - 1000).toISOString(), stamp + 'Z')")
    const closeFlag  = src.indexOf("const closed = writeFlag(envFile, 'CLAIMS_ENABLED', 'false', stamp + 'Z')")
    expect(closeLease).toBeGreaterThan(-1)
    expect(closeFlag).toBeGreaterThan(closeLease) // expire first: belt before braces
  })

  it('it refuses a TTL its own lease could not cover', () => {
    expect(src).toContain('if (TTL_MS + RELOAD_DEADLINE_MS + 120000 > 60 * 60 * 1000)')
  })

  it('it treats a claim already stuck, or parked in financial verification, as blocking', () => {
    expect(src).toContain("prisma.claim.count({ where: { status: 'refunding' } })")
    expect(src).toContain("prisma.claim.count({ where: { status: 'financial_verification' } })")
  })

  it('its active-status list mirrors the library, financial_verification included', () => {
    expect(src).toContain("['restaurant_review', 'approved', 'refunding', 'arbitration', 'financial_verification']")
  })

  it('it reports residue on every exit path, and says NOT MEASURED rather than NONE when blind', () => {
    expect(src).toContain('await reportResidue()')
    expect(src).toMatch(/NOT MEASURED — the before-snapshot failed/)
  })
})
