// tests/prel11-refund-gate-window-t93.test.ts — T-93: the four window-mode defects of the refund gate.
//
// WHY THE FOUR EXISTED AT ALL, AND WHY NO TEST SAW THEM. Window mode has never been run: its whole
// sequence sat INLINE in main(), so the only exercisable surface was the emergency handler
// (tests/phase2-refund-gate-emergency-refreeze.test.ts). Three of the four defects were inside that
// inline block. The fix extracts the close sequence into closeRefundWindow() with an injectable gate
// proof, so every partial failure — a write that throws, a restart that throws, a gate that never
// proves closed — is reachable from a test without opening a real money gate.
//
// THE FOUR:
//   (a) the emergency re-freeze was DISARMED between the flag write and touchRestart(). A signal in that
//       gap left `false` on disk, NO restart requested, and a LIVE Passenger process still holding the
//       `true` it booted with — the gate stayed OPEN for the rest of the lease, handler already disarmed.
//   (b) emergencyRefreeze() put both flag writes and the restart in ONE try, so a throw on the FIRST (the
//       lease — the least important) suppressed the REFUNDS_ENABLED=false write and the restart.
//   (c) a non-numeric PHASE2_REFUND_WINDOW_MS became NaN and walked past the 30-minute ceiling guard,
//       because `NaN > 1800000` is FALSE, then threw a RangeError AFTER the handler had been armed.
//   (d) window mode never invoked, nor even named, phase2-backup-neutralize.js — while writeFlag() had
//       just left a .env.local.bak-refund-gate-<stamp> copy carrying REFUNDS_ENABLED=true in the app root.
//
// NOTHING HERE TOUCHES THE REAL APP ROOT, THE NETWORK OR STRIPE. PHASE2_APP_ROOT is pointed at a sandbox
// BEFORE the operator is required (it reads it once, at module load), the gate proof is injected, and the
// one test that runs the REAL neutralizer serves its probe from a loopback server on 127.0.0.1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** The two primitives the operator lets a test replace, so ONE of two writes can be made to fail. */
type WriteFlag = (envFile: string, key: string, value: string, stamp: string) => { changed: boolean; backup: string | null }
type Deps = { writeFlagFn?: WriteFlag; touchRestartFn?: () => void }

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-t93-root-'))
process.env.PHASE2_APP_ROOT = SANDBOX

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GATE = require('../scripts/server/phase2-refund-gate.js') as {
  writeFlag: (envFile: string, key: string, value: string, stamp: string) => { changed: boolean; backup: string | null }
  emergencyRefreeze: (reason: string, deps?: Deps) => boolean
  armRefreeze: (envFile: string, stamp: string) => void
  isRefreezeArmed: () => boolean
  windowMsRefusalFor: (raw: string | undefined) => string | null
  backupNames: () => string[] | null
  neutralizeOwnBackups: () => Promise<void>
  closeRefundWindow: (a: { envFile: string; stamp: string; base: string; waitCloseGate?: (b: string) => Promise<{ ok: boolean; last: string; elapsedMs: number }> } & Deps) => Promise<{ closeFailed: string[]; restartRequested: boolean; proven: boolean; disarmed: boolean }>
  WINDOW_MS_HARD_CEILING_MS: number
  WINDOW_MS_LEASE_MARGIN_MS: number
}
const SRC = readFileSync('scripts/server/phase2-refund-gate.js', 'utf8').replace(/\r\n/g, '\n')

const ENV_OPEN = [
  'DATABASE_URL=mysql://u:p@h/grubano_staging',
  'NEXTAUTH_URL=https://app.grubano.com',
  'STRIPE_SECRET_KEY=sk_test_x',
  'REFUNDS_ENABLED=true',
  'REFUNDS_WINDOW_UNTIL=2099-01-01T00:00:00.000Z',
  'SMTP_PASS=secret',
  '',
].join('\n')

const effective = (text: string, key: string) => {
  let v: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (m && m[1] === key) v = m[2].trim().replace(/^["']|["']$/g, '') // last occurrence wins
  }
  return v
}
const RESTART = path.join(SANDBOX, 'tmp', 'restart.txt')
const proofOk = async () => ({ ok: true, last: '403', elapsedMs: 1200 })
/**
 * The REAL writeFlag, made to throw for exactly ONE key. That asymmetry is T-93 (b) itself and cannot be
 * induced from outside the operator: both writes go through one primitive, to one backup path, on one
 * stamp — and `node:fs` exports cannot be redefined, so patching fs is not an option either.
 */
const failOnKey = (key: string): WriteFlag => (envFile, k, v, stamp) => {
  if (k === key) throw Object.assign(new Error('EDQUOT: disk quota exceeded (simulated)'), { code: 'EDQUOT' })
  return GATE.writeFlag(envFile, k, v, stamp)
}
const throwingRestart = () => { throw Object.assign(new Error('EROFS: read-only file system (simulated)'), { code: 'EROFS' }) }
const proofNever = async () => ({ ok: false, last: '401', elapsedMs: 240000 })

let dir: string, envFile: string, logs: string[]
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-t93-'))
  envFile = path.join(dir, '.env.local')
  fs.writeFileSync(envFile, ENV_OPEN)
  fs.rmSync(path.join(SANDBOX, 'tmp'), { recursive: true, force: true })
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')) })
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})
const out = () => logs.join('\n')

// ══ (c) THE WINDOW LENGTH IS REFUSED BY NAME, AND THE OLD GUARD REALLY WAS BYPASSABLE ══════════════
describe('T-93 (c) — a malformed window length is refused BY NAME, before anything is armed', () => {
  it('THE OLD GUARD WAS BYPASSABLE — the arithmetic, proven here so the fix is not taken on faith', () => {
    // This is the whole defect in one line: the guard was `if (ms + 120000 > 30*60*1000) refuse`, and
    // every comparison against NaN is false, so `Number('abc')` sailed through the ceiling check.
    const oldGuardWouldRefuse = (ms: number) => ms + GATE.WINDOW_MS_LEASE_MARGIN_MS > GATE.WINDOW_MS_HARD_CEILING_MS
    expect(Number('abc')).toBeNaN()
    expect(oldGuardWouldRefuse(Number('abc'))).toBe(false)   // ← walked past
    expect(oldGuardWouldRefuse(Number('1690000'))).toBe(true) // ← the shape it DID catch
    // and what came next: the lease arithmetic threw, AFTER the arm
    expect(() => new Date(Date.now() + Math.min(Number('abc') + 120000, 1800000)).toISOString()).toThrow(RangeError)
  })

  it('every malformed shape is refused, and the refusal NAMES the variable and the reason', () => {
    for (const raw of ['abc', '15min', '1e6', '0x10', 'NaN', 'Infinity', '-1', '0', '900000.5', '1_000_000']) {
      const r = GATE.windowMsRefusalFor(raw)
      expect(r, `PHASE2_REFUND_WINDOW_MS=${raw} must be refused`).toBeTruthy()
      expect(r as string, raw).toContain('PHASE2_REFUND_WINDOW_MS')
    }
    // the NaN refusal explains WHY a comparison guard could not have caught it
    expect(GATE.windowMsRefusalFor('abc') as string).toContain('NaN > x is FALSE')
  })

  it('POSITIVE CONTROL — legal values are accepted, so the validator is not simply refusing everything', () => {
    for (const raw of [undefined, '', '1', '6000', '900000', ' 900000 ', String(28 * 60 * 1000)]) {
      expect(GATE.windowMsRefusalFor(raw), `${JSON.stringify(raw)} must be accepted`).toBeNull()
    }
  })

  it('the 30-minute lease ceiling is still enforced, on the boundary', () => {
    const ceil = GATE.WINDOW_MS_HARD_CEILING_MS - GATE.WINDOW_MS_LEASE_MARGIN_MS // 28 min
    expect(GATE.windowMsRefusalFor(String(ceil))).toBeNull()
    expect(GATE.windowMsRefusalFor(String(ceil + 1))).toBeTruthy()
    expect(GATE.windowMsRefusalFor(String(ceil + 1)) as string).toContain('lease')
  })

  it('the refusal happens BEFORE the stamp, the arm and every write — asserted on the order in main()', () => {
    // A validator that runs after `armedRefreeze = { … }` would still leave the handler armed on a
    // refusal, which is the very sequencing the old code got wrong.
    const w = SRC.indexOf('const windowMsBad = windowMsRefusal()')
    const stamp = SRC.indexOf('const stamp = new Date().toISOString()', w - 4000)
    const arm = SRC.indexOf('armedRefreeze = { envFile, stamp }')
    expect(w).toBeGreaterThan(0)
    expect(stamp).toBeGreaterThan(w)   // refusal, THEN the stamp
    expect(arm).toBeGreaterThan(w)     // refusal, THEN the arm
    expect(SRC).toContain("if (windowMsBad) return fail('7 window: ' + windowMsBad + ' Nothing changed.')")
    // …and the bypassable inline ceiling check is GONE
    expect(SRC).not.toMatch(/if \(WINDOW_DEADLINE_MS \+ 120000 > 30 \* 60 \* 1000\)/)
  })
})

// ══ (b) EACH WRITE IN ITS OWN try — A FAILING LEASE MUST NOT SUPPRESS THE FLAG ══════════════════════
describe('T-93 (b) — one failing write can no longer suppress the write that closes the gate', () => {
  it('the lease write throws and REFUNDS_ENABLED=false is STILL written, and the restart STILL happens', () => {
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    // Before the fix all three statements shared one try: this throw took the other two with it.
    expect(GATE.emergencyRefreeze('SIGTERM', { writeFlagFn: failOnKey('REFUNDS_WINDOW_UNTIL') })).toBe(false)

    // THE POINT: the gate is closed on disk even though the lease write died.
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'REFUNDS_ENABLED')).toBe('false')
    // …and the live process was told to re-read it.
    expect(fs.existsSync(RESTART)).toBe(true)
    // …and the human is told WHICH key resisted, by name — a partial close reported as a failure.
    expect(out()).toMatch(/write REFUNDS_WINDOW_UNTIL FAILED/)
    expect(out()).toMatch(/unwritten key\(s\) REFUNDS_WINDOW_UNTIL/)
    expect(out()).toMatch(/HUMAN ACTION REQUIRED NOW/)
  })

  it('the FLAG write throws and the lease is still expired, so the authorization still dies', () => {
    // The reverse asymmetry. The lease is written FIRST precisely so that this case still ends the
    // authorization: the application re-checks REFUNDS_WINDOW_UNTIL on every refund call.
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    expect(GATE.emergencyRefreeze('SIGINT', { writeFlagFn: failOnKey('REFUNDS_ENABLED') })).toBe(false)
    const after = fs.readFileSync(envFile, 'utf8')
    expect(effective(after, 'REFUNDS_ENABLED')).toBe('true') // it genuinely could not be written
    expect(new Date(effective(after, 'REFUNDS_WINDOW_UNTIL') as string).getTime()).toBeLessThan(Date.now())
    expect(fs.existsSync(RESTART)).toBe(true)
    expect(out()).toMatch(/unwritten key\(s\) REFUNDS_ENABLED/)
    expect(out()).toMatch(/HUMAN ACTION REQUIRED NOW: set REFUNDS_ENABLED=false/)
  })

  it('a failing restart is reported as such, and never as a successful re-freeze', () => {
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    expect(GATE.emergencyRefreeze('SIGHUP', { touchRestartFn: throwingRestart })).toBe(false)
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'REFUNDS_ENABLED')).toBe('false') // flags still written
    expect(out()).toMatch(/tmp\/restart\.txt NOT written/)
    expect(out()).toMatch(/NO restart requested — the LIVE process keeps the flag it booted with/)
  })

  it('the source really does place each write in its OWN try, and attempts the restart regardless', () => {
    const fn = SRC.slice(SRC.indexOf('function emergencyRefreeze'), SRC.indexOf('for (const sig of ['))
    expect(fn).toContain('const writes = [[')
    expect(fn).toContain('for (const [k, v] of writes) {')
    expect(fn).toContain('failedKeys.push(k)')
    // the restart sits OUTSIDE the write loop's try, so no write failure can skip it
    expect(fn).toContain('try { tr(); restarted = true } catch (e) {')  // `tr` = the injectable restart
    // and it names the neutralizer, which (d) is about
    expect(fn).toContain('phase2-backup-neutralize.js')
  })

  it('the happy path still returns true and still says what it did', () => {
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    expect(GATE.emergencyRefreeze('SIGINT')).toBe(true)
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'REFUNDS_ENABLED')).toBe('false')
    expect(new Date(effective(fs.readFileSync(envFile, 'utf8'), 'REFUNDS_WINDOW_UNTIL') as string).getTime())
      .toBeLessThan(Date.now()) // the lease is expired, not merely absent
    expect(out()).toMatch(/EMERGENCY REFREEZE \(SIGINT\)/)
    expect(out()).not.toMatch(/HUMAN ACTION REQUIRED/)
  })
})

// ══ (a) THE HANDLER IS DISARMED LAST, AND ONLY ON PROOF ════════════════════════════════════════════
describe('T-93 (a) — the emergency handler outlives every step it protects', () => {
  it('the happy close: lease expired, flag false, restart requested, gate proven → DISARMED', async () => {
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    const r = await GATE.closeRefundWindow({ envFile, stamp: '2026-09-28T09-00-00-000Z', base: 'https://app.grubano.com', waitCloseGate: proofOk })
    expect(r).toMatchObject({ closeFailed: [], restartRequested: true, proven: true, disarmed: true })
    expect(GATE.isRefreezeArmed()).toBe(false)
    expect(effective(fs.readFileSync(envFile, 'utf8'), 'REFUNDS_ENABLED')).toBe('false')
    expect(fs.existsSync(RESTART)).toBe(true)
    expect(out()).toMatch(/EMERGENCY REFREEZE HANDLER = DISARMED/)
  })

  it('THE DEFECT: a gate that never proves CLOSED leaves the handler ARMED, not disarmed', async () => {
    // Before the fix the handler was nulled before the restart was even requested, so this state —
    // "written but not proven" — exited with nothing left to protect the gate.
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    const r = await GATE.closeRefundWindow({ envFile, stamp: '2026-09-28T09-00-00-000Z', base: 'https://app.grubano.com', waitCloseGate: proofNever })
    expect(r.proven).toBe(false)
    expect(r.disarmed).toBe(false)
    expect(GATE.isRefreezeArmed()).toBe(true)
    expect(out()).toMatch(/gate NOT proven CLOSED/)
    expect(out()).toMatch(/EMERGENCY REFREEZE HANDLER = STILL ARMED/)
    // and the still-armed handler genuinely still works
    expect(GATE.emergencyRefreeze('SIGINT')).toBe(true)
  })

  it('a restart that could not be requested leaves the handler ARMED even with a proven-looking gate', async () => {
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    const r = await GATE.closeRefundWindow({ envFile, stamp: '2026-09-28T09-00-00-000Z', base: 'https://app.grubano.com', waitCloseGate: proofOk, touchRestartFn: throwingRestart })
    expect(r.restartRequested).toBe(false)
    expect(r.disarmed).toBe(false)
    expect(GATE.isRefreezeArmed()).toBe(true)
    expect(out()).toMatch(/RESTART REQUESTED = NO — the file says closed, the process does not/)
  })

  it('a failed close WRITE leaves the handler ARMED, and names the key', async () => {
    GATE.armRefreeze(envFile, '2026-09-28T09-00-00-000Z')
    const r = await GATE.closeRefundWindow({ envFile, stamp: '2026-09-28T09-00-00-000Z', base: 'https://app.grubano.com', waitCloseGate: proofOk, writeFlagFn: failOnKey('REFUNDS_ENABLED') })
    expect(r.closeFailed).toEqual(['REFUNDS_ENABLED'])
    expect(r.disarmed).toBe(false)
    expect(GATE.isRefreezeArmed()).toBe(true)
    expect(out()).toMatch(/write REFUNDS_ENABLED FAILED/)
    expect(out()).toMatch(/HUMAN ACTION REQUIRED: set REFUNDS_ENABLED=false/)
    // the LEASE still went through, which is why it is written first
    expect(new Date(effective(fs.readFileSync(envFile, 'utf8'), 'REFUNDS_WINDOW_UNTIL') as string).getTime())
      .toBeLessThan(Date.now())
  })

  it('the ORDER in the source is lease → flag → restart → proof → disarm, and the disarm is conditional', () => {
    const fn = SRC.slice(SRC.indexOf('async function closeRefundWindow'), SRC.indexOf('async function main()'))
    const at = (needle: string) => { const i = fn.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i }
    const writes = at("const closeWrites = [['REFUNDS_WINDOW_UNTIL', past], ['REFUNDS_ENABLED', 'false']]")
    const restart = at('try { tr(); restartRequested = true }')
    const proof = at('const w2 = await wait(base)')
    const disarm = at('if (proven && !closeFailed.length && restartRequested) armedRefreeze = null')
    const neutralize = at('await neutralizeOwnBackups()')
    expect(writes).toBeLessThan(restart)
    expect(restart).toBeLessThan(proof)
    expect(proof).toBeLessThan(disarm)
    expect(disarm).toBeLessThan(neutralize)
    // there is exactly ONE disarm in this function, and it is the conditional one
    expect(fn.match(/armedRefreeze = null/g)).toHaveLength(1)
    // main() delegates the whole sequence — nothing was left inline to drift
    expect(SRC).toContain('await closeRefundWindow({ envFile, stamp, base })')
  })
})

// ══ (d) THE BACKUP THIS OPERATOR LEAVES BEHIND IS NEUTRALIZED, AND VERIFIED ════════════════════════
describe('T-93 (d) — the window neutralizes the restorable copy it created, and proves it', () => {
  it('writeFlag really does leave a restorable true-flag copy — the thing being neutralized', () => {
    const f = path.join(dir, '.env.local')
    fs.writeFileSync(f, 'REFUNDS_ENABLED=false\nSTRIPE_SECRET_KEY=sk_test_x\n')
    const r = GATE.writeFlag(f, 'REFUNDS_ENABLED', 'true', '2026-09-28T09-00-00-000Z')
    expect(r.changed).toBe(true)
    expect(r.backup).toMatch(/^\.env\.local\.bak-refund-gate-/)
    // the copy is a byte copy — it carries the SECRETS too, which is why .gitignore had to cover it
    const copy = fs.readFileSync(path.join(dir, r.backup as string), 'utf8')
    expect(copy).toContain('STRIPE_SECRET_KEY=sk_test_x')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NEUT = require('../scripts/server/phase2-backup-neutralize.js') as { dangerousFlags: (t: string) => string[] }
    // …and at this instant it is SAFE (it was taken before the flip). The dangerous one is the copy the
    // NEXT write takes, once the file already says true.
    expect(NEUT.dangerousFlags(copy)).toEqual([])
    const r2 = GATE.writeFlag(f, 'REFUNDS_WINDOW_UNTIL', '2099-01-01T00:00:00.000Z', '2026-09-28T09-00-01-000Z')
    expect(NEUT.dangerousFlags(fs.readFileSync(path.join(dir, r2.backup as string), 'utf8'))).toEqual(['REFUNDS_ENABLED'])
  })

  it('the app root is re-read with the NEUTRALIZER\'S OWN predicate, not a second regex', () => {
    const fn = SRC.slice(SRC.indexOf('async function neutralizeOwnBackups'), SRC.indexOf('async function closeRefundWindow'))
    expect(fn).toContain('NEUT.dangerousFlags(')
    expect(fn).not.toMatch(/REFUNDS_ENABLED\\s\*=/) // no home-made regex
    expect(SRC).toContain("const NEUT = require(path.join(__dirname, 'phase2-backup-neutralize.js'))")
    // A second definition would have been WRONG, not merely duplicated: dotenv is last-occurrence-wins.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NEUT = require('../scripts/server/phase2-backup-neutralize.js') as { dangerousFlags: (t: string) => string[] }
    expect(NEUT.dangerousFlags('REFUNDS_ENABLED=true\nREFUNDS_ENABLED=false\n')).toEqual([])
    expect(/^\s*REFUNDS_ENABLED\s*=\s*true\s*$/m.test('REFUNDS_ENABLED=true\nREFUNDS_ENABLED=false\n')).toBe(true) // the naive regex lies
  })

  it('nothing to neutralize → SKIPPED, no child process, no anomaly', async () => {
    // The sandbox app root holds no .env.local.bak* at this point.
    for (const n of GATE.backupNames() ?? []) fs.rmSync(path.join(SANDBOX, n), { force: true })
    await GATE.neutralizeOwnBackups()
    expect(out()).toMatch(/BACKUP NEUTRALIZER = SKIPPED/)
    expect(out()).not.toMatch(/ANOMALY/)
  })

  it('END TO END with the REAL neutralizer: a restorable true-flag copy is archived and removed', async () => {
    // A loopback gate the neutralizer can probe — it accepts 127.0.0.1 as a base by design. No internet.
    //
    // IT MUST LIVE IN ANOTHER PROCESS. `neutralizeOwnBackups` uses spawnSync, which BLOCKS this thread —
    // so a server on this thread's event loop could never accept the child's connection, and the child
    // would hang until its timeout. (That is how T-99 was found: Node's fetch has no default timeout, so
    // the neutralizer's probe hung forever rather than giving up.) One process per role, and the hit log
    // is the server's own stdout, which also PROVES nothing but loopback was contacted.
    const hitFile = path.join(dir, 'hits.log')
    const evidence = path.join(dir, 'evidence')
    const srvCode = `
      const http = require('http'), fs = require('fs')
      const s = http.createServer((req, res) => {
        fs.appendFileSync(${JSON.stringify(hitFile)}, req.method + ' ' + req.url + '\\n')
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'gated', gated: true }))
      })
      s.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + s.address().port + '\\n'))
    `
    const srvProc = spawn(process.execPath, ['-e', srvCode], { stdio: ['ignore', 'pipe', 'inherit'] })
    const port = await new Promise<number>((res, rej) => {
      const to = setTimeout(() => rej(new Error('loopback gate did not start')), 10000)
      srvProc.stdout.on('data', (b: Buffer) => {
        const m = /PORT (\d+)/.exec(String(b))
        if (m) { clearTimeout(to); res(Number(m[1])) }
      })
    })
    // The sandbox IS the app root the operator was loaded with: give it a closed .env.local plus a
    // DANGEROUS backup, exactly the state a finished window leaves behind.
    fs.writeFileSync(path.join(SANDBOX, '.env.local'), 'DATABASE_URL=mysql://u:p@h/grubano_staging\nNEXTAUTH_URL=https://app.grubano.com\nREFUNDS_ENABLED=false\nCLAIMS_ENABLED=false\n')
    const bak = '.env.local.bak-refund-gate-2026-09-28T09-00-00-000Z'
    fs.writeFileSync(path.join(SANDBOX, bak), 'DATABASE_URL=mysql://u:p@h/grubano_staging\nNEXTAUTH_URL=https://app.grubano.com\nREFUNDS_ENABLED=true\nCLAIMS_ENABLED=false\nSTRIPE_SECRET_KEY=sk_test_x\n')
    expect(GATE.backupNames()).toContain(bak)

    // NOTE assigning `undefined` to process.env stores the STRING "undefined" — restore by deleting.
    const saved = { base: process.env.PHASE2_BASE_URL, ev: process.env.PHASE2_EVIDENCE_DIR }
    process.env.PHASE2_BASE_URL = `http://127.0.0.1:${port}`
    process.env.PHASE2_EVIDENCE_DIR = evidence
    try {
      await GATE.neutralizeOwnBackups()
    } finally {
      if (saved.base === undefined) delete process.env.PHASE2_BASE_URL; else process.env.PHASE2_BASE_URL = saved.base
      if (saved.ev === undefined) delete process.env.PHASE2_EVIDENCE_DIR; else process.env.PHASE2_EVIDENCE_DIR = saved.ev
      srvProc.kill()
    }

    // The child ran, and it ran against OUR loopback gate — never the internet.
    const hits = fs.existsSync(hitFile) ? fs.readFileSync(hitFile, 'utf8') : ''
    expect(hits).toMatch(/POST \/api\/admin\/refunds\/run/)
    expect(out()).toMatch(/phase2-backup-neutralize\.js output/)
    expect(out()).toMatch(/BACKUP NEUTRALIZER EXIT = 0/)
    // The restorable copy is GONE from the app root…
    expect(fs.existsSync(path.join(SANDBOX, bak))).toBe(false)
    // …archived outside it, with the flag rewritten to false so the archive itself is not a footgun…
    const archived = fs.readdirSync(evidence, { recursive: true } as { recursive: true }) as unknown as string[]
    expect(archived.length).toBeGreaterThan(0)
    // …and the operator says so, from its OWN re-read rather than from the child's word.
    expect(out()).toMatch(/RESTORABLE TRUE-FLAG BACKUP LEFT BY THIS WINDOW = NO/)
    expect(out()).not.toMatch(/ANOMALY/)
  }, 60000)

  it('a neutralizer that cannot PROVE the gate is a NAMED anomaly carrying the command, never silence', async () => {
    fs.writeFileSync(path.join(SANDBOX, '.env.local'), 'NEXTAUTH_URL=https://app.grubano.com\nREFUNDS_ENABLED=false\nCLAIMS_ENABLED=false\n')
    const bak = '.env.local.bak-refund-gate-2026-09-28T09-99-99-999Z'
    const evidence = path.join(dir, 'evidence-unreachable')
    fs.writeFileSync(path.join(SANDBOX, bak), 'REFUNDS_ENABLED=true\n')
    const saved = { base: process.env.PHASE2_BASE_URL, ev: process.env.PHASE2_EVIDENCE_DIR }
    process.env.PHASE2_BASE_URL = 'http://127.0.0.1:1' // nothing listens on port 1 → gate UNREACHABLE
    process.env.PHASE2_EVIDENCE_DIR = evidence
    try { await GATE.neutralizeOwnBackups() } finally {
      if (saved.base === undefined) delete process.env.PHASE2_BASE_URL; else process.env.PHASE2_BASE_URL = saved.base
      if (saved.ev === undefined) delete process.env.PHASE2_EVIDENCE_DIR; else process.env.PHASE2_EVIDENCE_DIR = saved.ev
    }
    // The neutralizer REMOVES the copy (that part is unconditional) but REFUSES to call the run a pass,
    // because it could not prove the live gate is closed. Our operator must surface that, not swallow it.
    expect(out()).toMatch(/BACKUP NEUTRALIZER EXIT = [^0]/)
    expect(out()).toMatch(/ANOMALY: 7 neutralize: the neutralizer did not report success/)
    expect(out()).toMatch(/node .*phase2-backup-neutralize\.js/) // the command, so the human can act
    // …and the operator's OWN re-read is what decides whether anything restorable is left.
    expect(out()).toMatch(/RESTORABLE TRUE-FLAG BACKUP LEFT BY THIS WINDOW = (YES|NO)/)
    fs.rmSync(path.join(SANDBOX, bak), { force: true })
  }, 60000)

  it('the close sequence CALLS it — the omission was the defect, so the call is pinned', () => {
    expect(SRC).toContain('await neutralizeOwnBackups()')
    const fn = SRC.slice(SRC.indexOf('async function closeRefundWindow'), SRC.indexOf('async function main()'))
    expect(fn).toContain('await neutralizeOwnBackups()')
    // and the header of the operator tells the human about it too
    expect(SRC).toContain('phase2-backup-neutralize.js')
  })
})

// ══ THE OPERATOR BACKUPS ARE GIT-IGNORED — a byte copy of .env.local is a secret ═══════════════════
describe('T-98 — every operator backup shape is git-ignored, because each one is a copy of .env.local', () => {
  it('.gitignore anchors on the PREFIX, so a future stamp is covered before it is invented', () => {
    const gi = readFileSync('.gitignore', 'utf8')
    expect(gi).toContain('.env*.bak*')
    expect(gi).toContain('.env.local.bak*')
    // `.env*.bak` alone matched only a name ENDING in .bak — which is not what any operator writes.
    for (const stamp of ['refund-gate', 'modeb-gate', 'claims-gate', 'phase2', 'before-beta-flags']) {
      expect(`.env.local.bak-${stamp}-2026-09-28T09-00-00-000Z`).toMatch(/^\.env.*\.bak/)
    }
  })

  it('the names the operators ACTUALLY write are enumerated from their own source', () => {
    const shapes = ['phase2-refund-gate.js', 'phase2-modeb-gate.js', 'phase2-claims-gate.js', 'phase2-preflight.js']
      .map((f) => readFileSync(`scripts/server/${f}`, 'utf8'))
      .flatMap((src) => Array.from(src.matchAll(/envFile \+ '(\.bak-[a-z0-9-]+)'/g)).map((m) => m[1]))
    expect(shapes.length).toBeGreaterThanOrEqual(4)
    for (const shape of shapes) {
      // every one is `.env.local` + `.bak-…` + a stamp → covered by the prefix-anchored patterns
      expect(`.env.local${shape}2026-09-28T09-00-00-000Z`.startsWith('.env.local.bak-')).toBe(true)
    }
  })
})
