// tests/claims-dprime-l2-approve-decision-only.test.ts — D′ lot L2 (spec v2 §1.2, S-02, S-03, S-13, S-22, D1 v1.1).
//
// APPROVE = BUSINESS DECISION ONLY. Even with BOTH leases open (CLAIMS + REFUNDS), an admin approval must provoke
// 0 triggerClaimRefund, 0 executeRefund, 0 stripe.refunds.create, 0 Refund row, 0 « refunds_disabled » alert.
// The engine here is the REAL lib/refund.ts behind a spy, on the same in-memory world the loader reads, so the
// negative control can PROVE the world reaches Stripe when the old inline path is executed by hand.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db, stripeMock, engineSpy, alertMock, auditMock, emailMock, adminMock } = vi.hoisted(() => ({
  db: {
    claim:            { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund:           { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    order:            { findUnique: vi.fn(), findMany: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    dispute:          { aggregate: vi.fn() },
    payout:           { findUnique: vi.fn() },
    emailDispatch:    { create: vi.fn(), findFirst: vi.fn() },
  },
  stripeMock: {
    paymentIntents:  { retrieve: vi.fn() },
    refunds:         { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
    transfers:       { list: vi.fn(), listReversals: vi.fn(), createReversal: vi.fn() },
    applicationFees: { listRefunds: vi.fn() },
  },
  engineSpy: { fn: vi.fn() },
  alertMock: vi.fn(), auditMock: vi.fn(), emailMock: vi.fn(), adminMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// The REAL engine and the REAL lease reader (env-based): nothing about the money path is simulated away.
vi.mock('@/lib/refund', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/refund')>()
  engineSpy.fn.mockImplementation((input: Parameters<typeof real.executeRefund>[0]) => real.executeRefund(input))
  return { ...real, executeRefund: (input: Parameters<typeof real.executeRefund>[0]) => engineSpy.fn(input) }
})
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimDecisionEmail: emailMock, sendClaimAckEmail: vi.fn().mockResolvedValue({ status: 'sent' }) }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { POST as arbitrate } from '@/app/api/admin/claims/[id]/arbitrate/route'
import { arbitrateClaim, triggerClaimRefund, runClaimAutoApproval, autoResolveSmallClaim, respondToClaim } from '@/lib/claims'
import { acceptedExits, arbitrationRefusal, APPROVE_ALREADY_SET, REFUSE_APPROVED_AM_B3 } from '@/lib/claim-action-rules'
import { payableWorld, claimOf } from './support/claims-world'
import { wireEngineWorld, type EngineWorld } from './support/claims-engine-world'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

const HOUR = 3_600_000
let w: EngineWorld

const openRefundsLease = () => {
  process.env.REFUNDS_ENABLED = 'true'
  process.env.REFUNDS_WINDOW_UNTIL = new Date(Date.now() + 15 * 60_000).toISOString()
}
const closeRefundsLease = () => { delete process.env.REFUNDS_ENABLED; delete process.env.REFUNDS_WINDOW_UNTIL }

const approveViaRoute = async (id = 'cl1') => {
  const res = await arbitrate(new Request(`https://app.grubano.com/api/admin/claims/${id}/arbitrate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }),
  }), { params: { id } })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const moneyTouched = () => ({
  engine:  engineSpy.fn.mock.calls.length,
  create:  stripeMock.refunds.create.mock.calls.length,
  rows:    w.refunds.length,
  blocked: (alertMock.mock.calls as Array<[{ kind: string; facts?: { cause?: string } }]>).map((c) => c[0]).filter((a) => a.kind === 'claim_payment_blocked'),
})
const setWorld = (claim: Record<string, unknown>) => {
  w = payableWorld(claim) as EngineWorld
  for (const group of Object.values(db)) for (const m of Object.values(group)) (m as { mockReset: () => void }).mockReset()
  for (const group of Object.values(stripeMock)) for (const m of Object.values(group)) (m as { mockReset: () => void }).mockReset()
  wireEngineWorld(w, db, stripeMock)
  db.emailDispatch.create.mockResolvedValue({})
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  engineSpy.fn.mockClear()
  alertMock.mockReset(); alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockReset(); auditMock.mockResolvedValue(true)
  emailMock.mockReset(); emailMock.mockResolvedValue({ status: 'sent' })
  adminMock.mockReset(); adminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test' })
  openClaimsWindow()
  openRefundsLease()
  setWorld({ status: 'arbitration', arbitrationDecision: null, arbitratedBy: null, arbitratedAt: null, decidedBy: null, decidedAt: null })
})
afterEach(() => { closeClaimsWindow(); closeRefundsLease() })

describe('S-02 / S-03 — approve is a decision: both leases OPEN, still zero money', () => {
  it('POST arbitrate approve → 200, APPROVED_AWAITING_PAYMENT shape, 0 engine, 0 refunds.create, 0 Refund row, 0 refunds_disabled alert, no refund field', async () => {
    const r = await approveViaRoute()
    expect(r.status).toBe(200)
    expect(r.body).not.toHaveProperty('refund')
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', refundAttempted: false, refundId: null, refundError: null, decidedBy: 'admin' })
    expect(c.arbitratedBy).toBe('admin1')
    expect(c.arbitratedAt).toBeInstanceOf(Date)
    expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0, blocked: [] })
    // no token M was ever written: T1 never ran
    expect(w.writes.some((x) => String(x.data.refundError ?? '').startsWith('reconcile_required'))).toBe(false)
    // the audit tells the truth and the customer e-mail is the money-free 'approved'
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'claim.arbitrate', metadata: { decision: 'approve', moneyMoved: false } }))
    expect(emailMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approved', refundedCents: null }))
  })

  it('arbitrateClaim (lib) approve on an arbitration claim → ok, no refund field, zero money', async () => {
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(r.ok).toBe(true)
    expect(r).not.toHaveProperty('refund')
    expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0, blocked: [] })
  })

  it('NEGATIVE CONTROL — the same world DOES reach Stripe when the old inline path (triggerClaimRefund after the decision CAS) is executed by hand', async () => {
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(r.ok).toBe(true)
    expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0 })
    // what dab754d's arbitrateClaim did right after its CAS:
    const t = await triggerClaimRefund('cl1')
    expect(t.state).toBe('refunded')
    expect(moneyTouched()).toMatchObject({ engine: 1, create: 1, rows: 1 })
    expect(claimOf(w).status).toBe('refunded')
  })
})

describe('Ratification (T-08) — an approved claim whose amount is not fixed may be ratified, never re-driven, never rewritten', () => {
  it('legacy approved (arbitrationDecision null) → approve writes the decision fields ONCE; a second approve keeps arbitratedAt/decidedAt byte-identical; zero money', async () => {
    setWorld({ status: 'approved', arbitrationDecision: null, arbitratedBy: null, arbitratedAt: null, decidedBy: 'auto_timeout', decidedAt: new Date(Date.now() - 2 * HOUR) })
    const decidedAt0 = claimOf(w).decidedAt
    const r1 = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve', reason: 'ratifiée' })
    expect(r1.ok).toBe(true)
    const c1 = { ...claimOf(w) }
    expect(c1).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', arbitratedBy: 'admin1', decidedBy: 'auto_timeout', arbitrationReason: 'ratifiée' })
    expect(c1.decidedAt).toEqual(decidedAt0)               // S-06: a decision instant already set is never rewritten
    const r2 = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin2', decision: 'approve' })
    expect(r2.ok).toBe(true)
    const c2 = claimOf(w)
    expect(c2.arbitratedBy).toBe('admin1')
    expect(c2.arbitratedAt).toEqual(c1.arbitratedAt)
    expect(c2.decidedAt).toEqual(decidedAt0)
    expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0, blocked: [] })
  })

  it('refuse_final on an approved claim stays refused (AM-B3 v1.1 text names the rail and the withdraw, never a re-approval)', async () => {
    setWorld({ status: 'approved', arbitrationDecision: 'approved' })
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'refuse_final' })
    expect(r).toMatchObject({ ok: false, status: 409, error: REFUSE_APPROVED_AM_B3 })
    expect(REFUSE_APPROVED_AM_B3).toContain('Payer les approuvées')
    expect(REFUSE_APPROVED_AM_B3).toContain('Retirer l’approbation')
    expect(REFUSE_APPROVED_AM_B3).not.toMatch(/approuvez-la à nouveau|nouvelle approbation/)
  })
})

describe('S-13 — machine paths never write status=approved and never reach the engine', () => {
  it('runClaimAutoApproval: an expired restaurant_review claim is ROUTED to arbitration (restaurantResponse untouched); a safety claim is skipped; zero money', async () => {
    setWorld({ status: 'restaurant_review', arbitrationDecision: null, restaurantResponse: null, reason: 'quality', responseDeadlineAt: new Date(Date.now() - HOUR) })
    w.claims.push({ ...claimOf(w), id: 'cl_safety', orderId: 'o2', activeOrderKey: 'o2', reason: 'allergen_safety' })
    const s = await runClaimAutoApproval()
    expect(s).toEqual({ scannedExpired: 2, routedToArbitration: 1, skippedSafety: 1, skippedAlreadyHandled: 0 })
    expect(claimOf(w)).toMatchObject({ status: 'arbitration', restaurantResponse: null, arbitrationDecision: null })
    expect(claimOf(w, 'cl_safety').status).toBe('restaurant_review')
    expect(w.claims.some((c) => c.status === 'approved')).toBe(false)
    expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0, blocked: [] })
  })

  it('runClaimAutoApproval has NO step 2: an approved-unpaid claim beside an expired one is never driven, whatever the leases', async () => {
    setWorld({ status: 'approved', arbitrationDecision: 'approved' })
    w.claims.push({ ...claimOf(w), id: 'cl_exp', orderId: 'o3', activeOrderKey: 'o3', status: 'restaurant_review', arbitrationDecision: null, responseDeadlineAt: new Date(Date.now() - HOUR) })
    const s = await runClaimAutoApproval()
    expect(s.routedToArbitration).toBe(1)
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0 })
  })

  it('autoResolveSmallClaim is inert by construction: flag ON + ceiling + tiny amount → not_eligible, zero writes, zero money', async () => {
    process.env.CLAIM_AUTO_RESOLVE_ENABLED = 'true'
    process.env.CLAIM_AUTO_APPROVE_MAX_CENTS = '10000'
    try {
      setWorld({ status: 'restaurant_review', arbitrationDecision: null, requestedAmountCents: 100, reason: 'quality' })
      const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 100, status: 'restaurant_review', reason: 'quality' })
      expect(r).toEqual({ state: 'not_eligible' })
      expect(w.writes).toEqual([])
      expect(claimOf(w).status).toBe('restaurant_review')
      expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0 })
    } finally {
      delete process.env.CLAIM_AUTO_RESOLVE_ENABLED
      delete process.env.CLAIM_AUTO_APPROVE_MAX_CENTS
    }
  })

  it('S-01 — the restaurant accept routes to arbitration and reaches no money', async () => {
    setWorld({ status: 'restaurant_review', arbitrationDecision: null })
    const r = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
    expect(r.ok).toBe(true)
    expect(claimOf(w).status).toBe('arbitration')
    expect(moneyTouched()).toMatchObject({ engine: 0, create: 0, rows: 0 })
  })
})

describe('D1 v1.1 — exits of an approved claim', () => {
  const now = new Date()
  const base = { id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, refundError: null, arbitrationDecision: 'approved' as const }
  it('amount not fixed (null / undefined) → [ratify]; amount fixed → [pay, withdraw]; approve on a fixed amount → APPROVE_ALREADY_SET', () => {
    expect(acceptedExits({ claim: { ...base }, now })).toEqual(['ratify'])
    expect(acceptedExits({ claim: { ...base, approvedAmountCents: null }, now })).toEqual(['ratify'])
    expect(acceptedExits({ claim: { ...base, approvedAmountCents: 500 }, now })).toEqual(['withdraw', 'pay'])
    expect(arbitrationRefusal({ ...base, approvedAmountCents: 500 }, 'approve', now)).toEqual({ status: 409, error: APPROVE_ALREADY_SET })
    expect(arbitrationRefusal({ ...base }, 'approve', now)).toBeNull()
    expect(APPROVE_ALREADY_SET).not.toMatch(/approuvez-la à nouveau|nouvelle approbation/)
  })
  it("'approve' is never an exit of an approved claim; it remains the exit of an arbitration claim", () => {
    expect(acceptedExits({ claim: { ...base }, now })).not.toContain('approve')
    expect(acceptedExits({ claim: { ...base, status: 'arbitration', arbitrationDecision: null }, now })).toEqual(['approve', 'refuse_final'])
  })
})

describe('STATIC PINS — the shipped sources contain no inline money path and no re-approval copy', () => {
  const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const body = (source: string, fn: string) => {
    const start = source.indexOf(`function ${fn}(`)
    expect(start, `${fn} found`).toBeGreaterThan(0)
    const rest = source.slice(start)
    const next = rest.slice(1).search(/\n(export )?(async )?function |\n\/\/ ─{3}/)
    return next > 0 ? rest.slice(0, next + 1) : rest
  }
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('lib/claims.ts: arbitrateClaim, runClaimAutoApproval, routeClaimToArbitration, autoResolveSmallClaim call neither triggerClaimRefund nor executeRefund; no machine writer of status=approved', () => {
    const s = src('lib/claims.ts')
    for (const fn of ['arbitrateClaim', 'runClaimAutoApproval', 'routeClaimToArbitration', 'autoResolveSmallClaim']) {
      const b = strip(body(s, fn))
      expect(b, `${fn} calls no engine`).not.toMatch(/triggerClaimRefund\(|executeRefund\(/)
    }
    for (const fn of ['routeClaimToArbitration', 'runClaimAutoApproval', 'autoResolveSmallClaim']) {
      expect(strip(body(s, fn)), `${fn} never writes approved`).not.toMatch(/status:\s*'approved'/)
    }
    // triggerClaimRefund is exported and kept for the rail (D′ L5) — but lib/claims.ts itself has ZERO call sites of it.
    expect((strip(s).match(/triggerClaimRefund\(/g) ?? []).filter((m, i, a) => a.length && m).length).toBe(1) // the definition only
    expect(strip(s)).not.toMatch(/'refunds_disabled'\s*,?\s*\{/)                       // no alert cause
    expect(strip(s)).not.toMatch(/alertClaimPaymentBlocked\([^)]*'refunds_disabled'/)
    expect(s).not.toMatch(/\|\s*'refunds_disabled'\s*\|\s*'attempt_crashed'/)          // not in the cause enum
  })

  it('arbitrate route: no engine import, no refund field, audit moneyMoved:false, e-mail never refunded', () => {
    const s = strip(src('app/api/admin/claims/[id]/arbitrate/route.ts'))
    expect(s).not.toMatch(/triggerClaimRefund|executeRefund|@\/lib\/refund|refund:\s*result/)
    expect(s).toMatch(/moneyMoved:\s*false/)
    expect(s).not.toMatch(/'refunded'/)
  })

  it('no copy names a re-approval as the way to be paid, nor promises a payment (« sera payée », J-M31) — every claims copy file, messages ×5 claims.*', () => {
    const forbidden = /approuvez-la à nouveau|nouvelle approbation|remboursement déclenché|sera payée|sera remboursée/i
    // The L2 review (group B) found the residue in lib/claim-console-copy.ts (said.*) and lib/claims.ts (T-56 dead-row
    // text) that a scan of lib/claim-action-rules.ts alone had missed: every claims copy source is scanned.
    for (const p of ['lib/claim-action-rules.ts', 'lib/claim-console-copy.ts', 'lib/claims.ts', 'lib/claim-approval-toast.ts', 'lib/claim-email-toast.ts', 'components/claims/AdminClaimsArbitration.tsx']) {
      expect(strip(src(p)), p).not.toMatch(forbidden) // shipped copy: comments (which quote history) are stripped
    }
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8')) as { claims: Record<string, unknown> }
      expect(JSON.stringify(m.claims), loc).not.toMatch(forbidden)
      expect((m.claims.admin as Record<string, unknown>).approved, `${loc} dead key removed`).toBeUndefined()
    }
  })

  it('NEGATIVE CONTROL — the pins catch the dab754d shape (inline call after the CAS, refunds_disabled cause, the old AM-B3 sentence)', () => {
    const s = src('lib/claims.ts')
    const old = s.replace(/const moved = await prisma\.claim\.updateMany\(\{\n    where: casWhere,/,
      'const refund = await triggerClaimRefund(claim.id)\n  const moved = await prisma.claim.updateMany({\n    where: casWhere,')
    expect(old).not.toBe(s)
    expect(strip(body(old, 'arbitrateClaim'))).toMatch(/triggerClaimRefund\(/)
    expect("| 'reverted_after_refund' | 'refunds_disabled' | 'attempt_crashed'").toMatch(/\|\s*'refunds_disabled'\s*\|\s*'attempt_crashed'/)
    expect('Selon son état : approuvez-la à nouveau (réclamations et remboursements ouverts)').toMatch(/approuvez-la à nouveau/)
    // the two residues group B found, and the first L2 draft of AM-B3 (« sera payée »), are caught by the widened scan
    const widened = /approuvez-la à nouveau|nouvelle approbation|remboursement déclenché|sera payée|sera remboursée/i
    expect('Rien ne la paiera automatiquement : une nouvelle approbation admin, réclamations et remboursements ouverts, est acceptée au plus tôt le').toMatch(widened)
    expect('MAIS une nouvelle approbation ne paierait pas cette réclamation : refus du moteur').toMatch(widened)
    expect('Selon son état : elle sera payée par le rail financier (« Payer les approuvées »)').toMatch(widened)
    expect('Selon son état : elle relève du rail financier (« Payer les approuvées »)').not.toMatch(widened)
  })
})
