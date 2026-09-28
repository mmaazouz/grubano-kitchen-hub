// tests/prel11-money-write-guard.test.ts — T-90: EVERY financial Stripe write declares itself, and the
// declaration cannot be loose.
//
// THE DEFECT. The money-write recon confirmed from six independent directions that the product flags are
// read at CALLERS and nowhere else. lib/refund.ts's own header states the policy — « All routes are GATED
// by REFUNDS_ENABLED » — and lib/dispute.ts:341 states « called ONLY when CHARGEBACKS_ENABLED is ON (the
// webhook gates it) ». Both were TRUE and neither was ENFORCED: `executeRefund`,
// `finalizeRefundRowFromStripe` and `handleDisputeEvent` each reached `stripe.refunds.create` or
// `transfers.createReversal` with no flag consulted inside the module. An invariant that lives in a comment
// is one refactor away from being false, and the refactor that breaks it moves money.
//
// WHAT THIS FILE PROVES, in order of strength:
//   1. ENUMERATION — every financial write verb in lib/ and app/ is IMMEDIATELY preceded by
//      `assertMoneyWriteAllowed`. No allowlist, no exceptions. A new write site fails this test.
//   2. THE EXPRESSION — each `rail_open` / `dispute_rail_open` site passes the REAL gate
//      (`refundGateState().open`, `isRefundsEnabled()`, `isChargebacksEnabled()`), not a literal.
//   3. RUNTIME — the guard refuses a closed rail, and refuses a `completing_settled_movement` that cannot
//      name the movement. Both with negative AND positive controls.
//   4. THE EXCEPTION IS NAMED — the one authorization that bypasses every flag is the one that completes a
//      movement Stripe already made, it requires a proof id, and exactly one site in the repository uses it.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join, sep } from 'node:path'
import {
  assertMoneyWriteAllowed,
  MoneyWriteRefused,
  FINANCIAL_STRIPE_WRITE_VERBS,
} from '@/lib/stripe-money-guard'
import { refundGateState } from '@/lib/refund'
import { openRefundWindow, closeRefundWindow, openChargebackRail, closeChargebackRail } from './support/refund-window'

/** Files that may contain a financial Stripe write. Walked, not assumed: see the enumeration test. */
/* THE ORACLE WALKS THE FILESYSTEM, NOT A LIST — and this is the SECOND version.
   The first walked six hand-written filenames. FOUR independent reviewers pointed at the same hole within
   minutes: `lib/creator-payout.ts` calls `transfers.create` to pay a creator, an affiliate or a courier,
   from a rail a scheduled job can poke, and a six-file list could never see it. One of those six entries
   (`lib/payouts.ts`) did not even exist, and nothing said so.
   An allowlist is not an enumeration. It answers « are the writes I already knew about declared? » — which
   is exactly the question that cannot find the write you forgot. */
const SOURCE_ROOTS = ['lib', 'app', 'scripts']
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/
function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '__snapshots__') continue
      walk(full, out)
    } else if (CODE_EXT.test(e.name)) out.push(full.split(sep).join('/'))
  }
  return out
}
/** Every code file under lib/, app/ and scripts/. The breadth is asserted below, not assumed. */
const SOURCES = SOURCE_ROOTS.flatMap((r) => walk(r))
const read = (p: string) => { try { return readFileSync(p, 'utf8').replace(/\r\n/g, '\n') } catch { return null } }

afterEach(() => { closeRefundWindow(); closeChargebackRail() })

// ══ 1. ENUMERATION — no financial write without a declaration ══════════════════════════════════════
describe('T-90 — every financial Stripe write in the repository declares itself', () => {
  /**
   * Find every call to a verb in FINANCIAL_STRIPE_WRITE_VERBS, anywhere under lib/ and app/, and return
   * {file, line, verb, guarded} for each. «Guarded» means an `assertMoneyWriteAllowed(` appears in the 30
   * lines above with no other call to the same verb in between — i.e. the declaration belongs to THIS write.
   */
  const writeSites = () => {
    const sites: Array<{ file: string; line: number; verb: string; guarded: boolean }> = []
    for (const file of SOURCES) {
      const src = read(file)
      if (src === null) continue
      // strip line comments and JSDoc bodies so a verb NAMED in prose is never counted as a call
      const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
      code.forEach((l, i) => {
        for (const verb of FINANCIAL_STRIPE_WRITE_VERBS) {
          if (!l.includes(`${verb}(`)) continue
          /* «GUARDED» IS NOT MERE PROXIMITY — and the first version of this oracle only pretended it was.
             Its docstring promised « no other call to the same verb in between » while the code simply
             searched the 30 lines above for a declaration. Two reviewers named the consequence: a second,
             entirely undeclared write placed just after a guarded one ADOPTS its neighbour's declaration and
             passes — the normal shape of lib/dispute.ts, which has two reversals. The clause is implemented
             now: the nearest preceding declaration must be CLOSER than the nearest preceding call to the
             same verb. The negative control below builds exactly that shape and requires a miss. */
          let declAt = -1, priorCallAt = -1
          for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
            if (declAt < 0 && code[j].includes('assertMoneyWriteAllowed(')) declAt = j
            if (priorCallAt < 0 && code[j].includes(`${verb}(`)) priorCallAt = j
            if (declAt >= 0 && priorCallAt >= 0) break
          }
          sites.push({ file, line: i + 1, verb, guarded: declAt >= 0 && declAt > priorCallAt })
        }
      })
    }
    return sites
  }

  it('the walk covers the whole source tree, and every file it names exists', () => {
    // The first version listed six files, one of which did not exist. A walk cannot name a missing file —
    // but it CAN silently cover nothing, so the breadth is asserted.
    expect(SOURCES.length, 'the walk found almost no files — it is not walking').toBeGreaterThan(400)
    for (const f of SOURCES.slice(0, 50)) expect(read(f), f).not.toBeNull()
    expect(SOURCES.some((f) => f.startsWith('lib/'))).toBe(true)
    expect(SOURCES.some((f) => f.startsWith('app/api/'))).toBe(true)
    expect(SOURCES.some((f) => f.startsWith('scripts/'))).toBe(true)
    expect(SOURCES.every((f) => !f.includes('node_modules'))).toBe(true)
    // and the file four reviewers found is now in scope, which a six-file list could never have been
    expect(SOURCES).toContain('lib/creator-payout.ts')
  })

  it('the walk FINDS the writes — an enumeration that found nothing would pass vacuously', () => {
    const sites = writeSites()
    // Measured at the time of writing: refunds.create ×2 (lib/refund.ts, lib/refunds.ts) and
    // transfers.createReversal ×3 (lib/refund.ts ×1, lib/dispute.ts ×2).
    expect(sites.length, JSON.stringify(sites)).toBeGreaterThanOrEqual(7)
    const verbs = new Set(sites.map((s) => s.verb))
    expect(verbs.has('refunds.create')).toBe(true)
    expect(verbs.has('transfers.createReversal')).toBe(true)
    expect(verbs.has('transfers.create')).toBe(true)
    const files = new Set(sites.map((s) => s.file))
    for (const f of ['lib/refund.ts', 'lib/refunds.ts', 'lib/dispute.ts', 'lib/franchise-settlement.ts', 'lib/creator-payout.ts']) {
      expect(files.has(f), f).toBe(true)
    }
  })

  it('EVERY one of them is preceded by assertMoneyWriteAllowed — no allowlist, no exception', () => {
    const naked = writeSites().filter((s) => !s.guarded)
    expect(naked, `undeclared financial Stripe write(s): ${JSON.stringify(naked)}`).toEqual([])
  })

  it('NEGATIVE CONTROL — a second write ADOPTING its neighbour\'s declaration is caught', () => {
    // Run the SHIPPED rule over a fabricated file, so the control and the oracle cannot drift apart.
    const fabricated = [
      "  assertMoneyWriteAllowed({ authorization: 'settlement_rail_open', railOpen: x })",
      '  const a = await getStripe().transfers.create({ amount: 1 })',
      '  const b = await getStripe().transfers.create({ amount: 2 })',
    ]
    const verdicts: Array<{ line: number; guarded: boolean }> = []
    fabricated.forEach((l, i) => {
      if (!l.includes('transfers.create(')) return
      let declAt = -1, priorCallAt = -1
      for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
        if (declAt < 0 && fabricated[j].includes('assertMoneyWriteAllowed(')) declAt = j
        if (priorCallAt < 0 && fabricated[j].includes('transfers.create(')) priorCallAt = j
        if (declAt >= 0 && priorCallAt >= 0) break
      }
      verdicts.push({ line: i + 1, guarded: declAt >= 0 && declAt > priorCallAt })
    })
    expect(verdicts).toEqual([{ line: 2, guarded: true }, { line: 3, guarded: false }])
    // …and the shipped oracle really implements that rule rather than proximity
    const self = read('tests/prel11-money-write-guard.test.ts')!
    // Asserted on the FUNCTION's body, not on the file: a test file that quotes the old expression in
    // order to ban it would ban itself. (It just did — hence this note.)
    const fn = self.slice(self.indexOf('const writeSites = () => {'), self.indexOf("  it('the walk covers"))
    expect(fn).toContain('guarded: declAt >= 0 && declAt > priorCallAt')
    expect(fn).not.toContain('above.includes(')
    expect(fn).toContain('if (priorCallAt < 0 && code[j].includes(`${verb}(`)) priorCallAt = j')
  })

  it('NEGATIVE CONTROL — the walk really would catch an undeclared write', () => {
    // The oracle is only worth what it would refuse. Feed it a fabricated file and require a miss.
    const fabricated = [
      'export async function sneak() {',
      '  return await getStripe().transfers.createReversal(tr, { amount: 1 })',
      '}',
    ].join('\n')
    const lines = fabricated.split('\n')
    let found = false
    lines.forEach((l, i) => {
      if (!l.includes('transfers.createReversal(')) return
      found = true
      expect(lines.slice(Math.max(0, i - 30), i).join('\n').includes('assertMoneyWriteAllowed(')).toBe(false)
    })
    expect(found, 'the fabricated write was not even detected').toBe(true)
  })

  it('a verb NAMED IN PROSE is not counted as a call — the walk strips comments', () => {
    // lib/refund.ts's header names transfers.createReversal in a comment. Counting it would report a
    // permanent false positive and train a reader to ignore this test.
    const header = read('lib/refund.ts')!.split('\n').slice(0, 40).join('\n')
    expect(header).toContain('transfers.createReversal')
    expect(writeSites().every((s) => s.line > 40 || s.guarded)).toBe(true)
  })
})

// ══ 2. THE EXPRESSION — a rail_open site passes the REAL gate, never a literal ═════════════════════
describe('T-90 — each initiating write passes its module\'s own gate, not a hardcoded true', () => {
  it('lib/refund.ts declares rail_open with refundGateState().open', () => {
    const src = read('lib/refund.ts')!
    expect(src).toContain("authorization: 'rail_open',")
    expect(src).toContain('railOpen: refundGateState().open,')
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/refunds.ts declares rail_open with isRefundsEnabled()', () => {
    const src = read('lib/refunds.ts')!
    expect(src).toContain("authorization: 'rail_open',")
    expect(src).toContain('railOpen: isRefundsEnabled(),')
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/dispute.ts declares dispute_rail_open with isChargebacksEnabled(), at BOTH reversals', () => {
    const src = read('lib/dispute.ts')!
    expect(src.match(/authorization: 'dispute_rail_open',/g)).toHaveLength(2)
    expect(src.match(/railOpen: isChargebacksEnabled\(\),/g)).toHaveLength(2)
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/franchise-settlement.ts declares settlement_rail_open with isFranchiseSettlementEnabled()', () => {
    // The site the ENUMERATION found. It pays a franchisor — the only financial write that credits a third
    // party instead of recovering from one, and therefore the one whose gate matters most.
    const src = read('lib/franchise-settlement.ts')!
    expect(src).toContain("authorization: 'settlement_rail_open',")
    expect(src).toContain('railOpen: isFranchiseSettlementEnabled(),')
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/creator-payout.ts names WHICH payout rail authorized the transfer', () => {
    const src = read('lib/creator-payout.ts')!
    expect(src).toContain("authorization: 'partner_payout_rail_open',")
    expect(src).toContain('flag: PAYOUT_FLAG_BY_ROLE[role],')
    expect(src).toContain('railOpen: ADAPTERS[role].enabled(),')
    expect(src).not.toContain('railOpen: true')
    expect(src).toContain("creator:   'CREATOR_PAYOUT_ENABLED',")
    expect(src).toContain("affiliate: 'AFFILIATE_CONNECT_ENABLED',")
    expect(src).toContain("logistics: 'LOGISTICS_PAYOUT_ENABLED',")
    // AND THE RESIDUAL, STATED WHERE IT LIVES: the creator rail's own gate is `() => true`.
    expect(src).toContain('enabled:        () => true,')
    expect(src).toContain('for `creator` that gate is literally `() => true`')
  })

  it('NO site anywhere passes a literal — that is the one way to make the declaration meaningless', () => {
    // every file that declares, whichever they turn out to be — not a list
    const declaring = SOURCES.filter((f) => (read(f) ?? '').includes('assertMoneyWriteAllowed('))
    expect(declaring.length, 'no file declares — the check would be vacuous').toBeGreaterThanOrEqual(5)
    for (const f of declaring) {
      /* Scoped to the ASSERTION's own argument list. A first version scanned the whole file and reported
         `lib/refund.ts` — because `logMoneyWrite({ … railOpen: false … })` at the entry of `executeRefund`
         says, correctly, that the rail is closed. A log is not a declaration, and a check that cannot tell
         them apart reports the honest line as the defect. Fourth time in this chantier that a lexical rule
         had to be narrowed from the token to the construct. */
      const src = read(f)!
      for (const m of Array.from(src.matchAll(/assertMoneyWriteAllowed\(\{([\s\S]{0,600}?)\}\)/g))) {
        expect(m[1], `${f}: a declaration hardcodes its gate`).not.toMatch(/railOpen:\s*(true|false)\b/)
        expect(m[1], f).not.toMatch(/railOpen:\s*!!\s*1/)
      }
    }
  })
})

// ══ 3. RUNTIME — the guard refuses, and the refusal is not vacuous ════════════════════════════════
describe('T-90 — the guard refuses a closed rail and an unprovable completion', () => {
  const decl = (over: Record<string, unknown> = {}) => ({
    verb: 'refunds.create',
    authorization: 'rail_open' as const,
    why: 'test',
    railOpen: refundGateState().open,
    ...over,
  })

  it('rail CLOSED → refused, and the refusal names the rail', () => {
    closeRefundWindow()
    expect(refundGateState().open).toBe(false)
    expect(() => assertMoneyWriteAllowed(decl())).toThrow(MoneyWriteRefused)
    try { assertMoneyWriteAllowed(decl()) } catch (e) {
      expect((e as Error).message).toContain('did not assert its gate')
    }
  })

  it('POSITIVE CONTROL — rail OPEN (flag AND live lease) → allowed', () => {
    openRefundWindow()
    expect(refundGateState().open).toBe(true)
    expect(() => assertMoneyWriteAllowed(decl({ railOpen: refundGateState().open }))).not.toThrow()
  })

  it('a bare flag with NO lease is still closed — the guard cannot be opened by half an authorization', () => {
    closeRefundWindow()
    process.env.REFUNDS_ENABLED = 'true' // flag only, no REFUNDS_WINDOW_UNTIL
    expect(refundGateState()).toEqual({ open: false, reason: 'no_lease' })
    expect(() => assertMoneyWriteAllowed(decl({ railOpen: refundGateState().open }))).toThrow(MoneyWriteRefused)
  })

  it('a caller that ASSERTS a gate the process contradicts is refused, not trusted', () => {
    // The floor: railOpen says open while the raw flag is absent. Those two cannot both be right, and
    // guessing which is exactly what a money guard must not do.
    closeRefundWindow()
    expect(() => assertMoneyWriteAllowed(decl({ railOpen: true }))).toThrow(/cannot both be right/)
  })

  it('completing_settled_movement WITHOUT a proof is refused — that authorization bypasses every flag', () => {
    closeRefundWindow()
    const d = { verb: 'transfers.createReversal', authorization: 'completing_settled_movement' as const, why: 'test' }
    expect(() => assertMoneyWriteAllowed(d)).toThrow(/no proof id/)
    expect(() => assertMoneyWriteAllowed({ ...d, proof: '' })).toThrow(/no proof id/)
    expect(() => assertMoneyWriteAllowed({ ...d, proof: 'not-an-id' })).toThrow(/not a settled-movement/)
    // a PaymentIntent proves an INTENTION, not a movement
    expect(() => assertMoneyWriteAllowed({ ...d, proof: 'pi_3AbcDef' })).toThrow(/not a settled-movement/)
  })

  it('completing_settled_movement WITH a proof is allowed even with every flag closed — by design', () => {
    closeRefundWindow()
    closeChargebackRail()
    for (const proof of ['re_1', 're_rf_A', 're_3AbcDefGhi', 'tr_x1', 'trr_abc', 'ch_1', 'fr_9', 'py_z']) {
      expect(() => assertMoneyWriteAllowed({
        verb: 'transfers.createReversal', authorization: 'completing_settled_movement',
        why: 'completing a movement Stripe already made', proof,
      }), proof).not.toThrow()
    }
  })

  it('the dispute rail obeys its OWN flag, independently of the refund rail', () => {
    closeRefundWindow(); closeChargebackRail()
    const d = { verb: 'transfers.createReversal', authorization: 'dispute_rail_open' as const, why: 'test', railOpen: false }
    expect(() => assertMoneyWriteAllowed(d)).toThrow(MoneyWriteRefused)
    openChargebackRail()
    expect(() => assertMoneyWriteAllowed({ ...d, railOpen: true })).not.toThrow()
    // …and opening the REFUND rail does not open the dispute one
    closeChargebackRail(); openRefundWindow()
    expect(() => assertMoneyWriteAllowed({ ...d, railOpen: true })).toThrow(/CHARGEBACKS_ENABLED/)
  })
})

// ══ 4. THE EXCEPTION IS NAMED, AND IT IS EXACTLY ONE SITE ═════════════════════════════════════════
describe('T-90 — the one authorization that bypasses the flags is used in exactly one place', () => {
  it('only the royalty clawback completing an already-paid refund claims it', () => {
    const sites: string[] = []
    for (const f of SOURCES) {
      const src = read(f)
      if (src === null) continue
      const n = (src.match(/authorization: 'completing_settled_movement',/g) || []).length
      for (let i = 0; i < n; i++) sites.push(f)
    }
    expect(sites, 'a second bypass appeared — it must be justified in the report, not added quietly')
      .toEqual(['lib/refund.ts'])
    const src = read('lib/refund.ts')!
    expect(src).toContain('proof: stripeRefund.id,')
    expect(src).toContain('royalty clawback completing a refund Stripe has already paid the customer')
  })

  it('and the T-90 bound is written down where the write is, not only in a report', () => {
    const src = read('lib/refund.ts')!
    expect(src).toContain('THE ONE FINANCIAL WRITE REACHABLE WITH THE FOUR PRODUCT FLAGS CLOSED')
    expect(src).toContain('bounded by the 20 h resume')
    expect(src).toContain('pendingRowsUnder20hWithSettledRoyalty')
  })

  it('the 20 h brake it relies on is REAL and already pinned by the engine suite', () => {
    const src = read('lib/refund.ts')!
    expect(src).toContain('export const RESUME_CREATE_WINDOW_MS = 20 * 60 * 60 * 1000')
    expect(src).toContain('throw new ResumeIdempotencyExpired(row.id + \':clawback\')')
    const engine = readFileSync('tests/refund-engine.test.ts', 'utf8')
    expect(engine).toContain('clawback RESUME AFTER the idempotency window with no adoptable reversal')
    expect(engine).toContain('expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()')
  })

  it('the audit line exists, and a refusal is logged as an ERROR — a warning nobody reads is not a control', () => {
    const src = read('lib/stripe-money-guard.ts')!
    expect(src).toContain('[MONEY WRITE]')
    expect(src).toContain('if (refusal) console.error(parts.join')
    expect(src).toContain("else console.warn(parts.join")
    // no secret may ride along: the line carries a verb, an authorization, a Stripe id, an order and cents
    expect(src).not.toMatch(/process\.env\.(STRIPE_SECRET_KEY|DATABASE_URL|SMTP_PASS|NEXTAUTH_SECRET)/)
  })

  it('the guard is a LEAF — it is imported by three money modules and imports nothing itself', () => {
    const src = read('lib/stripe-money-guard.ts')!
    expect(src).not.toMatch(/^\s*import\s/m)
    for (const f of ['lib/refund.ts', 'lib/refunds.ts', 'lib/dispute.ts']) {
      expect(read(f)!, f).toContain("from '@/lib/stripe-money-guard'")
    }
  })
})
