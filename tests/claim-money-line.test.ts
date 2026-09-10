// tests/claim-money-line.test.ts — T-49, round-4 audit fix
//
// Four audit rounds each found the money queue asserting something about money that the code had
// never established. The last one was subtle and is the reason this file exists: `refundId` being
// set was used as a proxy for "a refund answers for this claim", but RESUME-FIRST binds a claim to
// a row it did not create and records exactly that. On those rows a bound refund answers for
// somebody else, and the card told the operator its state settled the claim.
//
// The audit also found that NONE of the component fixes was pinned by any test: reverting each
// left the suite green. The decision is a pure function now, so it can be.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { moneyLineFor, isResumeMismatch, RESUME_MISMATCH } from '@/lib/claim-money-line'

// ROUND-5 AUDIT FIX: this fixture was a hand-typed string, so the module's contract was bound to
// no shipped writer — the same tautology that let the inert regex through in round 2. The strings
// are now READ OUT OF lib/claims.ts, so a writer that stops emitting the marker fails this suite.
const CLAIMS_SRC = readFileSync('lib/claims.ts', 'utf8')
/** Every refundError literal the engine writes for a mismatch, taken from the source itself. */
const SHIPPED_MISMATCH_WRITERS = (CLAIMS_SRC.match(/refundError: `resume_mismatch:[^`]*`/g) ?? [])
  .map((m) => m.replace(/^refundError: `/, '').replace(/`$/, ''))
const MISMATCH = SHIPPED_MISMATCH_WRITERS[0] ?? ''

describe('the two ambiguous buckets never claim to know anything', () => {
  it('a claim parked in financial verification reads INDETERMINATE, bound or not', () => {
    for (const refundId of [null, 'rf1']) {
      const l = moneyLineFor({ kind: 'financial_verification', refundId, refundError: null })
      expect(l.certainty).toBe('unknown')
      expect(l.text).toContain('INDÉTERMINÉ')
    }
  })

  it('an interrupted attempt reads INDETERMINATE too', () => {
    expect(moneyLineFor({ kind: 'reconcile_required', refundId: null, refundError: null }).certainty)
      .toBe('unknown')
  })
})

describe('RESUME-MISMATCH — a bound refund that answers for somebody else', () => {
  it('is NOT reported as settling this claim, even though a refund is bound', () => {
    const l = moneyLineFor({ kind: 'other_unsettled', refundId: 'rf9', refundError: MISMATCH })
    expect(l.certainty).toBe('bound_but_not_ours')
    expect(l.text).toContain('n’appartient PAS')
    expect(l.text).not.toContain('fait foi')
  })

  it('the mismatch test wins over the binding test — order matters', () => {
    // Both conditions are true on this row. If the binding branch were checked first, the card
    // would say the refund's state is authoritative, which is the defect the audit found.
    const l = moneyLineFor({ kind: 'other_unsettled', refundId: 'rf9', refundError: MISMATCH })
    expect(l.certainty).not.toBe('bound')
  })

  it('recognises the engine marker, and nothing else', () => {
    expect(isResumeMismatch(MISMATCH)).toBe(true)
    expect(isResumeMismatch('stripe_failed: la banque a refusé')).toBe(false)
    expect(isResumeMismatch('reconcile_required: …')).toBe(false)
    expect(isResumeMismatch(null)).toBe(false)
    expect(isResumeMismatch(undefined)).toBe(false)
  })
})

describe('the honest cases still read honestly', () => {
  it('a genuinely bound refund answers for the claim', () => {
    const l = moneyLineFor({ kind: 'other_unsettled', refundId: 'rf1', refundError: null })
    expect(l.certainty).toBe('bound')
    expect(l.text).toContain('fait foi')
  })

  it('nothing bound means nothing is established here', () => {
    const l = moneyLineFor({ kind: 'other_unsettled', refundId: null, refundError: null })
    expect(l.certainty).toBe('unbound')
    expect(l.text).toContain('n’est pas établi')
  })

  it('a recorded failure that is NOT a mismatch still counts as bound', () => {
    expect(moneyLineFor({ kind: 'other_unsettled', refundId: 'rf1', refundError: 'stripe_failed: …' }).certainty)
      .toBe('bound')
  })
})

describe('no line ever asserts a cash outcome', () => {
  const ALL = [
    { kind: 'financial_verification' as const, refundId: null,  refundError: null },
    { kind: 'reconcile_required' as const,     refundId: null,  refundError: 'reconcile_required: …' },
    { kind: 'other_unsettled' as const,        refundId: 'rf1', refundError: null },
    { kind: 'other_unsettled' as const,        refundId: 'rf9', refundError: MISMATCH },
    { kind: 'other_unsettled' as const,        refundId: null,  refundError: null },
  ]

  it('never says the customer was paid, nor that nothing reached them', () => {
    // The exact phrasings three earlier rounds had to remove.
    for (const row of ALL) {
      const t = moneyLineFor(row).text
      expect(t).not.toContain('rien n’a encore atteint le client')
      expect(t).not.toMatch(/le client a été (remboursé|payé)/)
      expect(t).not.toContain('état connu')
    }
  })

  it('every row gets a non-empty line — silence is not an option here', () => {
    for (const row of ALL) expect(moneyLineFor(row).text.length).toBeGreaterThan(20)
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
describe('negative control — the shipped-and-audited refundId proxy would be caught', () => {
  it('the round-3 rule calls a mismatch row authoritative; the real rule does not', () => {
    const roundThreeRule = (row: { refundId: string | null }) =>
      row.refundId ? 'son état fait foi' : 'rien n’est lié'
    const mismatchRow = { kind: 'other_unsettled' as const, refundId: 'rf9', refundError: MISMATCH }
    expect(roundThreeRule(mismatchRow)).toBe('son état fait foi')          // ← the defect
    expect(moneyLineFor(mismatchRow).certainty).toBe('bound_but_not_ours') // ← fixed
  })

  it('the round-2 rule called the whole bucket known; the real rule does not', () => {
    const roundTwoRule = () => 'état connu mais NON SOLDÉ'
    expect(roundTwoRule()).toContain('état connu')                          // ← the defect
    expect(moneyLineFor({ kind: 'other_unsettled', refundId: null, refundError: null }).text)
      .not.toContain('état connu')                                          // ← fixed
  })
})

// ══ ROUND-5 AUDIT FIX — THE CONTRACT IS BOUND TO THE SHIPPED WRITERS ════════════
describe('every mismatch string the engine actually writes is recognised', () => {
  it('the engine has mismatch writers at all (if this fails, the marker moved)', () => {
    expect(SHIPPED_MISMATCH_WRITERS.length).toBeGreaterThanOrEqual(4)
  })

  it('EVERY one of them is recognised by the predicate', () => {
    for (const w of SHIPPED_MISMATCH_WRITERS) expect(isResumeMismatch(w)).toBe(true)
  })

  it('EVERY one of them produces the not-ours line, pending path included', () => {
    // Two of the writers sit on the PENDING path. They must get the same treatment: a bound
    // refund that is not this claim's, with no assertion about what moved.
    for (const w of SHIPPED_MISMATCH_WRITERS) {
      const l = moneyLineFor({ kind: 'other_unsettled', refundId: 'rf9', refundError: w })
      expect(l.certainty).toBe('bound_but_not_ours')
    }
  })

  it('the line never ASSERTS that money moved — two writers are only PENDING', () => {
    // The check is on the assertion, not on vocabulary: the honest line legitimately contains the
    // words "a été versé" inside a NEGATION ("it says nothing about what was paid"). A blunt
    // keyword match would fail on the correct text and pass on a reworded wrong one.
    const l = moneyLineFor({ kind: 'other_unsettled', refundId: 'rf9', refundError: MISMATCH })
    expect(l.text).not.toContain('de l’argent a bougé')       // the round-4 over-claim, verbatim
    expect(l.text).not.toMatch(/^(?!.*ne dit rien).*a été versé/) // "was paid", outside a negation
    expect(l.text).toContain('ne dit rien')                    // it explicitly declines to say
  })

  it('NEGATIVE CONTROL — a hand-typed fixture would not have caught a writer change', () => {
    const handTyped = 'resume_mismatch: something I made up'
    expect(isResumeMismatch(handTyped)).toBe(true)   // passes regardless of what ships
    expect(SHIPPED_MISMATCH_WRITERS.every((w) => isResumeMismatch(w))).toBe(true) // ← bound to source
  })
})
