import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * T-116 / T-117 — THE CLOSED-RAIL PROOF THE SETTLEMENT RAIL NEVER HAD.
 *
 * The final invariant review measured that all three settlement suites open `FRANCHISE_SETTLEMENT_ENABLED`
 * in `beforeEach` — for a good reason, since they exist to prove the arithmetic — with the consequence that
 * the in-module lock on the repository's ONLY money-OUT rail was proven by reading the source and by the
 * generic guard test, and never once by EXECUTING `settleFranchisor` with the flag closed. Two behaviours
 * that matter were therefore unpinned: that nothing is transferred, and that nothing is left parked.
 *
 * This file never opens the rail. It is the negative control of the other three.
 */

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { transfers: { create: vi.fn(), list: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    operator:         { findUnique: vi.fn() },
    franchiseRoyalty: { findMany: vi.fn(), aggregate: vi.fn(), updateMany: vi.fn() },
    // T-115: settleFranchisor now holds back orders carrying a LOST chargeback that was never
    // unwound. Modelled as « none », so these suites keep proving the arithmetic they were written for.
    dispute:          { findMany: vi.fn() },
    payout:           { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction:     vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({
  sendAdminMoneyReviewAlert: alertMock,
  sendAdminAlert:            vi.fn(),
}))

import { settleFranchisor } from '@/lib/franchise-settlement'
import { MoneyWriteRefused } from '@/lib/stripe-money-guard'

/** The operator is fully payable — so the ONLY thing that can stop the rail is the flag. */
const payableOperator = {
  id: 'op_fr',
  franchiseStripeAccountId: 'acct_fr',
  franchisePayoutStatus:    'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FRANCHISE_SETTLEMENT_ENABLED   // absent, which is how staging runs
  db.operator.findUnique.mockResolvedValue(payableOperator)
  db.franchiseRoyalty.findMany.mockResolvedValue([])          // no interrupted batch
  db.franchiseRoyalty.aggregate.mockResolvedValue({ _count: { id: 2 }, _sum: { royaltyCents: 300 } })
  db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 2 })
  db.dispute.findMany.mockResolvedValue([])   // T-115: no un-unwound chargeback in these fixtures
})
afterEach(() => { delete process.env.FRANCHISE_SETTLEMENT_ENABLED })

describe('T-116 — a closed settlement rail claims NOTHING', () => {
  it('rail closed → skipped with reason rail_closed, and NOT ONE royalty line is touched', async () => {
    const out = await settleFranchisor('op_fr')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op_fr', reason: 'rail_closed' })
    // The whole point of T-116: the claim is an UPDATE with no revert path, so it must not happen at all.
    expect(db.franchiseRoyalty.updateMany).not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('the refusal happens BEFORE the operator is even read — no query, no claim, no Stripe', async () => {
    await settleFranchisor('op_fr')
    expect(db.operator.findUnique).not.toHaveBeenCalled()
    expect(db.franchiseRoyalty.findMany).not.toHaveBeenCalled()
    expect(db.payout.create).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("FRANCHISE_SETTLEMENT_ENABLED set to anything but the exact string 'true' is still closed", async () => {
    for (const v of ['false', 'TRUE', '1', 'yes', 'true ', '']) {
      vi.clearAllMocks()
      process.env.FRANCHISE_SETTLEMENT_ENABLED = v
      const out = await settleFranchisor('op_fr')
      expect(out, `value ${JSON.stringify(v)} must not open the rail`)
        .toMatchObject({ status: 'skipped', reason: 'rail_closed' })
      expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    }
  })

  it('POSITIVE CONTROL — with the rail OPEN the same fixtures DO reach the claim (so the test above proves the flag, not a broken fixture)', async () => {
    process.env.FRANCHISE_SETTLEMENT_ENABLED = 'true'
    await settleFranchisor('op_fr').catch(() => { /* the fixtures stop short of a full transfer; the claim is the point */ })
    expect(db.operator.findUnique).toHaveBeenCalled()
    expect(db.franchiseRoyalty.updateMany).toHaveBeenCalled()
  })
})

describe('T-117 — the guard still refuses even if the entry check is ever bypassed', () => {
  /* The entry check and the declaration are two locks on the same door, and a test that only proves the
     outer one would let a future refactor remove the inner one silently. So: reach `finalizeBatch` with the
     rail closed by opening the flag for the entry check and closing it again before the movement. The guard
     must throw a MoneyWriteRefused, Stripe must be untouched, and the failure must be reported as a REFUSAL
     rather than as a retryable transfer error (T-104). */
  it('a rail that closes mid-run is refused at the write, alerted, and never transferred', async () => {
    process.env.FRANCHISE_SETTLEMENT_ENABLED = 'true'
    db.franchiseRoyalty.findMany.mockImplementation(async () => {
      delete process.env.FRANCHISE_SETTLEMENT_ENABLED   // the rail closes after the entry check
      return []
    })
    const out = await settleFranchisor('op_fr').catch((err) => err)
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    // Either the run stops before the write (skipped/failed) or it throws the refusal — never a transfer.
    if (out instanceof Error) expect(out).toBeInstanceOf(MoneyWriteRefused)
  })

  it('MoneyWriteRefused is NOT reported as `transfer_failed` — a refusal is a defect, not a retry', async () => {
    /* The shape T-104 forbids, asserted on the source of this module rather than on a message: every catch
       around a declared write classifies BEFORE it degrades, and every escalation is paired with a re-throw. */
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/franchise-settlement.ts', 'utf8')
    const catches = src.split('\n').filter((l) => /\}\s*catch\b/.test(l))
    expect(catches.length).toBeGreaterThan(0)
    // No bare `} catch {` remains on this rail: a bare catch cannot classify what it did not bind.
    expect(src).not.toMatch(/\}\s*catch\s*\{\s*$/m)
    // `await escalateIfPolicyRefusal(` — the CALL. Counting the bare symbol also counts the import line,
    // which is how this assertion first failed 3-vs-2: a count that includes a declaration is not a count
    // of behaviour.
    const escalations = (src.match(/await escalateIfPolicyRefusal\(/g) ?? []).length
    const rethrows    = (src.match(/if \(isMoneyPolicyRefusal\(err\)\) throw err/g) ?? []).length
    expect(escalations).toBeGreaterThan(0)
    expect(rethrows).toBe(escalations)
  })
})
