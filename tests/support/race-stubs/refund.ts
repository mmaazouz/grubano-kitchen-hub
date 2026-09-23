// tests/support/race-stubs/refund.ts — the refund engine, as the D′ L5 database rehearsal sees it.
//
// The rehearsal proves EXCLUSION, not payment: that two concurrent rails reach the engine at most once for one
// claim, and that a withdrawal and a payment cannot both win. Stripe has no part in that question, and a
// rehearsal that could reach Stripe would be a rehearsal that could move money. So this module replaces
// lib/refund at BUNDLE time (esbuild alias) and does only what the real engine does to OUR database: it inserts
// the refund row that carries the claim's identity, and answers ok.
//
// Every call appends one line to the file named by RACE_ENGINE_LOG. Both processes append to the SAME file, so
// « exactly one engine call for this claim » is measured across processes rather than inferred from either one.
import { appendFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'

export const RESUME_CREATE_WINDOW_MS = 20 * 60 * 60 * 1000

/** The rehearsal always runs with the gate open: what is under test is the CAS, not the lease. */
export function isRefundsEnabled(): boolean {
  return true
}

export function refundGateState(): { open: true; expiresAt: Date; remainingMs: number } {
  return { open: true, expiresAt: new Date(Date.now() + 15 * 60_000), remainingMs: 15 * 60_000 }
}

export async function executeRefund(input: { orderId: string; amountCents?: number; reason?: string }): Promise<{
  ok: true; refundId: string; stripeRefundId: string; amountCents: number; resumed: boolean
  resumedIgnoredAmount: boolean; restaurantReverseCents: number; applicationFeeRefundCents: number
  royaltyRefundCents: number; royaltyClawbackCents: number; cumulativeRefundedCents: number
  remainingRefundableCents: number; routed: boolean
}> {
  const amountCents = input.amountCents ?? 0
  const stamp = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const log = process.env.RACE_ENGINE_LOG
  if (log) {
    appendFileSync(log, `${JSON.stringify({ orderId: input.orderId, reason: input.reason ?? null, amountCents, pid: process.pid, at: Date.now() })}\n`, 'utf8')
  }
  const row = await prisma.refund.create({
    data: {
      orderId:        input.orderId,
      restaurantId:   'r_race',
      amountCents,
      reason:         input.reason ?? null,
      status:         'succeeded',
      stripeRefundId: `re_race${stamp.replace(/[^0-9]/g, '').slice(0, 20)}`,
      idempotencyKey: `refund:${input.orderId}:${stamp}`,
    },
    select: { id: true, stripeRefundId: true },
  })
  return {
    ok: true,
    refundId:                 row.id,
    stripeRefundId:           row.stripeRefundId ?? '',
    amountCents,
    resumed:                  false,
    resumedIgnoredAmount:     false,
    restaurantReverseCents:   0,
    applicationFeeRefundCents: 0,
    royaltyRefundCents:       0,
    royaltyClawbackCents:     0,
    cumulativeRefundedCents:  amountCents,
    remainingRefundableCents: 0,
    routed:                   false,
  }
}
