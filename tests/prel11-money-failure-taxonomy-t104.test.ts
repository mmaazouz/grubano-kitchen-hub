// tests/prel11-money-failure-taxonomy-t104.test.ts — T-104: three kinds of failure on a money path, and a
// guard refusal is never allowed to pass for the other two.
//
// FOUNDER ARBITRATION: « Un refus du money guard ne doit jamais être transformé silencieusement en erreur
// transitoire réessayable. Distingue explicitement : refus de politique / invariant de sécurité ; panne réseau
// ou fournisseur réellement réessayable ; état externe déjà effectué nécessitant uniquement une finalisation
// interne. Un refus du garde doit être visible, traçable et escaladable. Il ne doit pas être avalé par un
// catch générique. »
//
// WHAT THE REVIEW MEASURED. Four sites degraded a refusal into « retry me »: lib/refunds.ts returned a 502
// « Erreur paiement, réessayez. », lib/franchise-settlement.ts and lib/creator-payout.ts returned
// `'transfer_failed'` through a BARE `catch {}` that discarded the error entirely, and lib/dispute.ts answered
// HTTP 200. A refusal retried is a code defect repeated; a refusal answered 200 is a code defect erased.
//
// WHY A TYPE AND NOT A MESSAGE. `classifyMoneyFailure` recognises a refusal by `instanceof MoneyWriteRefused`.
// A string test on the message would break the day someone rewords it — and break SILENTLY, which is the one
// failure mode a money taxonomy cannot afford.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join, sep } from 'node:path'
import {
  classifyMoneyFailure,
  isMoneyPolicyRefusal,
  escalateIfPolicyRefusal,
  MoneyWriteRefused,
} from '@/lib/stripe-money-guard'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/* Derived from the FILESYSTEM, for the same reason the T-90 oracle is: a hand-written list is exactly what
   let `lib/refund.ts` be named in-scope and then skipped by every assertion. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(full, out) }
    else if (/\.(ts|tsx|js)$/.test(e.name)) out.push(full.split(sep).join('/'))
  }
  return out
}
const SOURCES = ['lib', 'app'].flatMap((r) => walk(r))
const refusal = () => new MoneyWriteRefused('transfers.create', 'rail_open', 'the caller did not assert its gate')

// ══ 1. THE THREE KINDS ═════════════════════════════════════════════════════════════════════════════
describe('T-104 — the three kinds are distinguished, and by TYPE not by message', () => {
  it('a guard refusal is POLICY_REFUSAL — recognised by type, whatever its wording', () => {
    expect(classifyMoneyFailure(refusal())).toBe('policy_refusal')
    expect(isMoneyPolicyRefusal(refusal())).toBe(true)
    // reword the message entirely: the classification must not move
    const reworded = new MoneyWriteRefused('refunds.create', 'dispute_rail_open', 'anything at all, in any language, 42')
    expect(classifyMoneyFailure(reworded)).toBe('policy_refusal')
    // and a plain Error carrying the SAME text is NOT a refusal — the type is the evidence
    expect(classifyMoneyFailure(new Error(refusal().message))).not.toBe('policy_refusal')
  })

  it('a provider or network failure is TRANSIENT — and so is anything unrecognised', () => {
    for (const e of [
      new Error('socket hang up'),
      new Error('ECONNRESET'),
      { type: 'StripeAPIError', code: 'api_error' },
      { type: 'StripeConnectionError' },
      { type: 'StripeRateLimitError', code: 'rate_limit' },
      null, undefined, 'a string', 42, {},
    ]) {
      expect(classifyMoneyFailure(e), JSON.stringify(e)).toBe('transient')
    }
    // Conservative in ONE direction only, and deliberately: a retry under an idempotency key is safe, while
    // swallowing a refusal is not. So « unrecognised » resolves to transient, never to policy_refusal.
    expect(read('lib/stripe-money-guard.ts')).toContain('anything it cannot recognise is `transient`')
  })

  it('an already-made movement is EXTERNAL_ALREADY_DONE — nothing may be initiated, only finalized', () => {
    for (const code of ['charge_already_refunded', 'charge_already_captured', 'transfer_already_reversed', 'idempotency_key_in_use', 'payment_intent_unexpected_state']) {
      expect(classifyMoneyFailure({ type: 'StripeInvalidRequestError', code }), code).toBe('external_already_done')
    }
    expect(classifyMoneyFailure({ type: 'StripeIdempotencyError' })).toBe('external_already_done')
    expect(classifyMoneyFailure({ rawType: 'idempotency_error' })).toBe('external_already_done')
    // a DIFFERENT invalid-request code is not this class
    expect(classifyMoneyFailure({ type: 'StripeInvalidRequestError', code: 'resource_missing' })).toBe('transient')
    // this is the class the third authorization exists for
    expect(read('lib/stripe-money-guard.ts')).toContain('what remains is internal finalization')
  })

  it('the three kinds are EXHAUSTIVE — there is no fourth, and no undefined', () => {
    const seen = new Set<string>()
    for (const e of [refusal(), new Error('x'), { type: 'StripeIdempotencyError' }]) seen.add(classifyMoneyFailure(e))
    expect(Array.from(seen).sort()).toEqual(['external_already_done', 'policy_refusal', 'transient'])
    const src = read('lib/stripe-money-guard.ts')
    expect(src).toContain("export type MoneyFailureKind = 'policy_refusal' | 'transient' | 'external_already_done'")
  })
})

// ══ 2. ESCALATION ══════════════════════════════════════════════════════════════════════════════════
describe('T-104 — a refusal is visible, traceable and escalatable', () => {
  it('it is logged as an ERROR and sent to MONEY REVIEW, with the action « do not retry »', async () => {
    const alerts: Array<Record<string, unknown>> = []
    const logs: string[] = []
    const realError = console.error
    console.error = (...a: unknown[]) => { logs.push(a.join(' ')) }
    try {
      await escalateIfPolicyRefusal(refusal(), { verb: 'transfers.create', where: 'lib/test', orderId: 'o1', amountCents: 500 },
        async (p) => { alerts.push(p as Record<string, unknown>); return { status: 'sent' } })
    } finally { console.error = realError }

    expect(logs.join('\n')).toContain('[MONEY WRITE] ESCALATED')
    expect(logs.join('\n')).toContain('where=lib/test')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].kind).toBe('money_write_refused')
    expect(String((alerts[0].facts as Record<string, unknown>).action)).toContain('NE PAS réessayer')
    // one alert per verb + site + order, so a loop mails once rather than a hundred times
    expect(alerts[0].dedupeKey).toBe('money_write_refused:transfers.create:lib/test:o1')
  })

  it('it does NOTHING for a transient failure — the taxonomy must not cry wolf', async () => {
    const alerts: unknown[] = []
    await escalateIfPolicyRefusal(new Error('socket hang up'), { verb: 'refunds.create', where: 'lib/test' },
      async (p) => { alerts.push(p); return { status: 'sent' } })
    await escalateIfPolicyRefusal({ type: 'StripeIdempotencyError' }, { verb: 'refunds.create', where: 'lib/test' },
      async (p) => { alerts.push(p); return { status: 'sent' } })
    expect(alerts).toHaveLength(0)
  })

  it('a FAILED alert never masks the refusal — the log line is the primary channel', async () => {
    const logs: string[] = []
    const realError = console.error
    console.error = (...a: unknown[]) => { logs.push(a.join(' ')) }
    try {
      await expect(escalateIfPolicyRefusal(refusal(), { verb: 'transfers.create', where: 'lib/test' },
        async () => { throw new Error('SMTP down') })).resolves.toBeUndefined()
    } finally { console.error = realError }
    expect(logs.join('\n')).toContain('[MONEY WRITE] ESCALATED')
  })

  it('the guard is still a LEAF — the alerter is INJECTED, not imported', () => {
    const src = read('lib/stripe-money-guard.ts')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).toContain('`alert` is injected rather than imported')
  })
})

// ══ 3. EVERY CATCH ENCLOSING A DECLARED WRITE CONSULTS THE TAXONOMY ════════════════════════════════
describe('T-104 — no catch around a financial write may degrade a refusal', () => {
  /* THE HOLE THE FINAL REVIEW FOUND IN THIS TEST. It declared this list and then iterated only FOUR of its
     six entries — so `lib/refund.ts`, the LARGEST declaring module, was named as in-scope and exempted from
     every assertion. Two independent surfaces reported the consequence: four of its catches turned a
     `MoneyWriteRefused` into a retryable 502, i.e. precisely what T-104 exists to forbid, while this suite
     stayed green. The list is now DERIVED from the guard import, so a file cannot be listed and skipped. */
  const DECLARING = SOURCES.filter((f) => read(f).includes("from '@/lib/stripe-money-guard'"))

  it('the derived list is not empty and contains the modules that declare — including lib/refund.ts', () => {
    expect(DECLARING.length, 'nothing imports the guard — every assertion below would be vacuous').toBeGreaterThanOrEqual(6)
    for (const f of ['lib/refund.ts', 'lib/refunds.ts', 'lib/dispute.ts', 'lib/franchise-settlement.ts', 'lib/creator-payout.ts', 'lib/deposit.ts']) {
      expect(DECLARING, f).toContain(f)
    }
  })

  it('EVERY declaring module classifies BEFORE it degrades — no file is exempt', () => {
    for (const f of DECLARING) {
      const src = read(f)
      // lib/stripe.ts declares but has no catch of its own (the caller owns the degradation), so the rule is
      // « if you CATCH around a declared write, you classify » — measured by the presence of a catch.
      if (!/catch\s*\(/.test(src)) continue
      expect(src, `${f} must escalate a refusal`).toContain('escalateIfPolicyRefusal(')
      expect(src, `${f} must re-throw a refusal`).toContain('if (isMoneyPolicyRefusal(err)) throw err')
    }
  })

  it('lib/refund.ts — the module the old list exempted — classifies at EVERY catch around a declared write', () => {
    const src = read('lib/refund.ts')
    // the clawback catch, and the three around driveRefund (which declares refunds.create)
    expect((src.match(/escalateIfPolicyRefusal\(/g) || []).length).toBeGreaterThanOrEqual(4)
    for (const where of ['finalizeRefund:clawback', 'finalizeRefundRowFromStripe', 'executeRefund:resume', 'executeRefund:fresh']) {
      expect(src, where).toContain(`where: 'lib/refund.${where}'`)
    }
    // and the escalation comes BEFORE the fatal() that would have reported a 502 « réessayez »
    const firstEsc = src.indexOf('escalateIfPolicyRefusal(')
    const clawFatal = src.indexOf('Remboursement émis, reprise de la royalty franchisé en échec')
    expect(firstEsc).toBeGreaterThan(-1)
    expect(clawFatal).toBeGreaterThan(firstEsc)
  })

  it('lib/dispute.ts escalates at BOTH of its declared writes', () => {
    expect((read('lib/dispute.ts').match(/escalateIfPolicyRefusal\(/g) || []).length).toBe(2)
  })

  it('lib/franchise-settlement.ts escalates on the FRESH and the RESUME path', () => {
    const src = read('lib/franchise-settlement.ts')
    expect(src).toContain("where: 'lib/franchise-settlement.settleFranchisor'")
    expect(src).toContain("where: 'lib/franchise-settlement.settleFranchisor:resume'")
    expect((src.match(/escalateIfPolicyRefusal\(/g) || []).length).toBe(2)
  })

  it('the BARE catches are gone — a discarded error cannot be classified at all', () => {
    // `catch {}` was the worst shape: it threw the evidence away before anyone could look at it.
    const settlement = read('lib/franchise-settlement.ts')
    expect(settlement).not.toContain('return await finalizeBatch(ref, settlementId, lines, false)\n  } catch {')
    const payout = read('lib/creator-payout.ts')
    expect(payout).not.toContain('return await settlePending(payout, ref, role, refData, false)\n  } catch {')
    expect(payout).not.toContain('return await settlePending(pending, ref, role, refData, true)\n    } catch {')
  })

  it('EVERY escalation is paired with a re-throw — escalating and then degrading would be worse than silence', () => {
    // Worse, because the alert would say « do not retry » while the code retried anyway.
    for (const f of DECLARING) {
      const src = read(f)
      const escalations = (src.match(/escalateIfPolicyRefusal\(/g) || []).length
      if (!escalations) continue
      const rethrows = (src.match(/if \(isMoneyPolicyRefusal\(err\)\) throw err/g) || []).length
      expect(rethrows, `${f}: ${escalations} escalation(s) but ${rethrows} re-throw(s)`).toBe(escalations)
    }
  })

  it('the retryable outcomes each site still returns are for GENUINE failures only', () => {
    // The degradation paths are KEPT — that part was right. What changed is that they are now unreachable
    // for a refusal, because the re-throw happens first. Asserted on the ORDER in the source.
    for (const f of ['lib/refunds.ts', 'lib/franchise-settlement.ts', 'lib/creator-payout.ts', 'lib/deposit.ts']) {
      const src = read(f)
      let from = 0
      for (let i = 0; i < 5; i++) {
        const esc = src.indexOf('escalateIfPolicyRefusal(', from)
        if (esc < 0) break
        const rethrow = src.indexOf('if (isMoneyPolicyRefusal(err)) throw err', esc)
        expect(rethrow, `${f}: no re-throw after the escalation at ${esc}`).toBeGreaterThan(esc)
        // the degradation must come AFTER the re-throw
        const degrade = src.slice(rethrow).search(/return (fatal\(err\)|\{ status: 'failed')/)
        expect(degrade, `${f}: the degradation must follow the re-throw`).toBeGreaterThan(0)
        from = rethrow + 1
      }
    }
  })

  it('the dispute rail does not answer 200 on a refusal either — it re-throws into the 500 branch', () => {
    const src = read('lib/dispute.ts')
    // both reversal catches escalate and re-throw before any `retryable` outcome is built
    for (const where of ['settleDisputeLost:net', 'settleDisputeLost:clawback']) {
      expect(src).toContain(`where: 'lib/dispute.${where}'`)
    }
    const route = read('app/api/webhooks/stripe/route.ts')
    // a thrown refusal reaches the handler's catch → 500, which is NOT a 200 and NOT a silent success
    expect(route).toContain("console.error('[stripe webhook] dispute handler error:'")
    expect(route).toContain("return NextResponse.json({ error: 'Handler error' }, { status: 500 })")
  })
})
