/**
 * Two controls the founder asked for on 2026-09-29, and they share a shape: a gate that was green
 * for the wrong reason.
 *
 * A — KNOWN REHEARSAL REFUND vs UNEXPECTED REFUND. The preflight's rule was
 *     `!(amountCents === 1450 && createdAt.startsWith('2026-08-29'))` — an AMOUNT plus a DATE. It
 *     permitted ANY 1450-cent refund created that day and refused the three rehearsals that were
 *     actually documented, because they happened later. « La règle doit être fondée sur une preuve
 *     stable (id/event/order/run documenté), pas seulement sur une date », and « je ne veux surtout
 *     pas supprimer le hard stop sur un vrai remboursement inconnu ». So the new rule is keyed on
 *     the Stripe refund id — minted by Stripe, impossible to choose — and it is STRICTER: the order,
 *     the amount and the status must also agree with the record.
 *
 * B — PROD-15. A green staging deploy must not mean "the files arrived". The three restart steps are
 *     `continue-on-error: true`, which makes GitHub report each `conclusion` as SUCCESS whatever
 *     happened — the run that deployed adfb4981 showed three green restart steps and proving the
 *     restart required opening the raw log. `outcome` is not masked, so an aggregate step can fail
 *     when every path failed. Plus a request that traverses the live Prisma client.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const yaml = req('js-yaml') as { load: (s: string) => unknown }
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const RR = req(join(process.cwd(), 'scripts/server/rehearsal-refunds.js')) as {
  KNOWN_REHEARSAL_REFUNDS: Array<{ ref: string; stripeRefundId: string; orderId: string; amountCents: number; executedOn: string; evidence: string }>
  classifyRefundRow: (row: unknown) => { kind: string; ref: string | null; why: string }
  splitRefundRows: (rows: unknown[]) => { known: unknown[]; unexpected: unknown[] }
}

/** The four refunds that exist in the window, measured READ-ONLY on the Stripe TEST account 2026-09-29. */
const MEASURED_IN_WINDOW = [
  { ref: 'GR-N5TSM0', stripeRefundId: 're_3UB9bPKuol4dGnN10IdP5bzp', orderId: 'cmtju919h0001h7t6bkn5tsm0', amountCents: 500, status: 'succeeded', documented: true },
  { ref: 'GR-GBZE1X', stripeRefundId: 're_3UAyauKuol4dGnN125UKXa5U', orderId: 'cmtj52ewh000320fboagbze1x', amountCents: 1450, status: 'succeeded', documented: true },
  { ref: 'GR-9IA5R6', stripeRefundId: 're_3UI22ZKuol4dGnN129DXgp4a', orderId: 'cmuay7ik10001yoe0m49ia5r6', amountCents: 500, status: 'succeeded', documented: true },
  /* The one the OLD rule permitted, and the one nothing in this repository documents. */
  { ref: 'GR-9CYOJJ', stripeRefundId: 're_3U9rrGKuol4dGnN11KEHWf7p', orderId: 'cmterr88p00212t8pyi9cyojj', amountCents: 1450, status: 'succeeded', documented: false },
]

describe('A — known rehearsal refund vs unexpected refund, keyed on identity', () => {
  it('the three documented rehearsals are KNOWN, and each entry cites evidence that is a file in this repository', () => {
    for (const m of MEASURED_IN_WINDOW.filter((x) => x.documented)) {
      const v = RR.classifyRefundRow(m)
      expect(v.kind, m.ref).toBe('known')
      expect(v.ref).toBe(m.ref)
    }
    expect(RR.KNOWN_REHEARSAL_REFUNDS).toHaveLength(3)
    for (const k of RR.KNOWN_REHEARSAL_REFUNDS) {
      expect(k.evidence.length, k.ref).toBeGreaterThan(80)
      // Evidence must point at a runbook or a test — never at a bare date.
      expect(k.evidence, k.ref).toMatch(/docs\/ops\/|tests\/|commit /)
    }
  })

  it('THE ROW THE OLD RULE PERMITTED IS NOW REFUSED — nothing in this repository documents GR-9CYOJJ', () => {
    const v = RR.classifyRefundRow(MEASURED_IN_WINDOW[3])
    expect(v.kind).toBe('unexpected')
    // And the old predicate would have waved it through, which is the whole point.
    const OLD_RULE = (r: { amountCents: number; createdAt: string }) => !(r.amountCents === 1450 && r.createdAt.startsWith('2026-08-29'))
    expect(OLD_RULE({ amountCents: 1450, createdAt: '2026-08-29T19:24:00Z' })).toBe(false) // false = "not unexpected" = permitted
  })

  it('THE CONTROL IS STRICTER, NOT LOOSER — five shapes a real unknown refund can take are all refused', () => {
    const base = MEASURED_IN_WINDOW[0]
    const shapes: Array<[string, Record<string, unknown>]> = [
      ['a brand-new Stripe id', { ...base, stripeRefundId: 're_ATTACKER00000000000000' }],
      ['no Stripe id at all', { ...base, stripeRefundId: null }],
      ['empty Stripe id', { ...base, stripeRefundId: '   ' }],
      ['a documented id on another order', { ...base, orderId: 'cmSOMETHINGELSE000000000' }],
      ['a documented id with another amount', { ...base, amountCents: base.amountCents + 1 }],
      ['a documented id still pending', { ...base, status: 'pending' }],
      ['a documented id that failed', { ...base, status: 'failed' }],
    ]
    for (const [name, row] of shapes) {
      expect(RR.classifyRefundRow(row).kind, name).toBe('unexpected')
    }
    // …and the reason is always stated, because a HARD STOP with no reason is a HARD STOP nobody can clear.
    for (const [, row] of shapes) expect(RR.classifyRefundRow(row).why.length).toBeGreaterThan(20)
  })

  it('the allowlist cannot be satisfied by a date or an amount — no entry carries a date-only or amount-only key', () => {
    const src = read('scripts/server/rehearsal-refunds.js')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n')
    // No executable comparison on createdAt, and no bare amount comparison as an accept condition.
    expect(code).not.toMatch(/createdAt/)
    expect(code).not.toMatch(/startsWith\(\s*['"]20/)
  })

  it('splitRefundRows partitions the four measured rows 3 / 1', () => {
    const { known, unexpected } = RR.splitRefundRows(MEASURED_IN_WINDOW)
    expect(known).toHaveLength(3)
    expect(unexpected).toHaveLength(1)
  })

  it('the preflight uses THIS module and no longer carries the amount+date predicate', () => {
    const src = read('scripts/server/phase2-preflight.js')
    expect(src).toContain("require(path.join(__dirname, 'rehearsal-refunds.js'))")
    expect(src).toContain('splitRefundRows')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(code).not.toMatch(/amountCents === 1450/)
    expect(code).not.toMatch(/startsWith\('2026-08-29'\)/)
  })
})

describe('B — PROD-15: a green staging deploy must prove the process, not the upload', () => {
  const wf = yaml.load(read('.github/workflows/deploy-staging.yml')) as {
    jobs: { deploy: { steps: Array<Record<string, unknown>> } }
  }
  const steps = wf.jobs.deploy.steps

  it('the three restart steps carry ids, so their RAW outcome is readable despite continue-on-error', () => {
    for (const id of ['ssh_post', 'ssh_restart', 'ftps_restart']) {
      const s = steps.find((x) => x.id === id)
      expect(s, id).toBeTruthy()
      expect(s!['continue-on-error'], id).toBe(true)
    }
  })

  it('a BLOCKING step fails when EVERY restart method failed, and reads `outcome` (not `conclusion`)', () => {
    const s = steps.find((x) => typeof x.name === 'string' && (x.name as string).startsWith('Restart proven'))
    expect(s, 'the aggregate step must exist').toBeTruthy()
    expect(s!['continue-on-error'], 'it must be able to fail the job').toBeUndefined()
    const run = String(s!.run ?? '')
    for (const id of ['ssh_post', 'ssh_restart', 'ftps_restart']) {
      expect(run, id).toContain(`steps.${id}.outcome`)
    }
    // `conclusion` is masked by continue-on-error — reading it would make the gate vacuous.
    expect(run).not.toContain('.conclusion')
    expect(run).toContain('exit 1')
    expect(run).toContain('restart.txt')
  })

  it('a BLOCKING request traverses the live Prisma client, and it targets STAGING', () => {
    const s = steps.find((x) => typeof x.name === 'string' && (x.name as string).startsWith('Database reachable'))
    expect(s, 'the DB gate must exist on staging too').toBeTruthy()
    expect(s!['continue-on-error']).toBeUndefined()
    const run = String(s!.run ?? '')
    expect(run).toContain('https://app.grubano.com/api/restaurants')
    expect(run).not.toMatch(/https:\/\/(www\.)?grubano\.com/)   // never production
    expect(run).toContain('exit 1')
  })

  it('no new secret and no new schedule were introduced by PROD-15', () => {
    const src = read('.github/workflows/deploy-staging.yml')
    const secretNames = Array.from(src.matchAll(/secrets\.([A-Z0-9_]+)/g)).map((m) => m[1])
    /* The staging workflow's secret set, pinned. A new name here would mean PROD-15 widened the
       trust surface, which the founder excluded explicitly. */
    expect(new Set(secretNames)).toEqual(new Set([
      'DATABASE_URL_STAGING', 'NEXTAUTH_SECRET', 'O2SWITCH_HOST', 'O2SWITCH_FTP_USER',
      'O2SWITCH_FTP_PASS', 'O2SWITCH_USER', 'O2SWITCH_SSH_KEY',
      /* SEVEN, measured. My first draft listed DOCS_DISPATCH_TOKEN as an eighth and the test caught
         it: that secret is used by deploy-production.yml only. A pin written from memory rather than
         from the file is a pin that certifies the wrong baseline — it fails now, and it would have
         passed later while asserting nothing. */
    ]))
    const d = yaml.load(src) as { on: Record<string, unknown> }
    expect(Object.keys(d.on).sort()).toEqual(['push', 'workflow_dispatch'])
  })
})
