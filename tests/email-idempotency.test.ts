import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'

// ── Email B0 — sendOnce idempotency foundation (Agent 141) ─────────────────────
// Race-safe dedup via the EmailDispatch @@unique([trigger,dedupeKey]) constraint: a 2nd send
// with the same (trigger,dedupeKey) loses the unique INSERT (P2002) → SKIP, no resend. Best-effort:
// sendOnce/sendTransactional NEVER throw. A non-sent status releases the claim so retries work.

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))

const { dispatchCreate, dispatchDeleteMany, logCreate } = vi.hoisted(() => ({
  dispatchCreate: vi.fn(), dispatchDeleteMany: vi.fn(), logCreate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailDispatch: { create: dispatchCreate, deleteMany: dispatchDeleteMany },
    emailLog:      { create: logCreate },
  },
}))

import { sendOnce, sendTransactional, sendOrderConfirmation } from '@/lib/transactional-emails'

const P = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: '5.22.0' })
const mail = { to: 'a@b.com', subject: 'S', html: '<p>x</p>' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SMTP_PASS = 'x' // so a send is actually attempted
  dispatchCreate.mockResolvedValue({ id: 'd1' })
  dispatchDeleteMany.mockResolvedValue({ count: 1 })
  logCreate.mockResolvedValue({ id: 'l1' })
  sendMail.mockResolvedValue({ messageId: 'm1' })
})

describe('sendOnce — race-safe dedup via unique constraint', () => {
  it('first call claims + sends (status sent, exactly one email)', async () => {
    const r = await sendOnce('order_confirmation', 'order:o1', mail)
    expect(r.status).toBe('sent')
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'order_confirmation', dedupeKey: 'order:o1' } })
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('a duplicate (trigger,dedupeKey) → status duplicate, NO email sent (the unique INSERT lost)', async () => {
    dispatchCreate.mockRejectedValueOnce(P('P2002'))
    const r = await sendOnce('order_confirmation', 'order:o1', mail)
    expect(r.status).toBe('duplicate')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('concurrent callers → exactly ONE send (winner sends, loser gets P2002 → skip)', async () => {
    dispatchCreate.mockResolvedValueOnce({ id: 'd1' }) // winner
    dispatchCreate.mockRejectedValueOnce(P('P2002'))   // loser
    const [a, b] = await Promise.all([
      sendOnce('refund_confirmation', 'order:o1:500', mail),
      sendOnce('refund_confirmation', 'order:o1:500', mail),
    ])
    expect([a.status, b.status].sort()).toEqual(['duplicate', 'sent'])
    expect(sendMail).toHaveBeenCalledTimes(1) // never twice
  })

  it('NEVER throws + releases the claim when the send fails (so a retry can re-send)', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const r = await sendOnce('order_confirmation', 'order:o2', mail) // must resolve, not reject
    expect(r.status).toBe('failed')
    expect(dispatchDeleteMany).toHaveBeenCalledWith({ where: { trigger: 'order_confirmation', dedupeKey: 'order:o2' } })
  })

  it('degrades to a normal send if the idempotency store is unavailable (non-P2002, e.g. table not pushed)', async () => {
    dispatchCreate.mockRejectedValueOnce(P('P2021')) // table does not exist yet
    const r = await sendOnce('order_confirmation', 'order:o3', mail)
    expect(r.status).toBe('sent')        // a real email is never swallowed by a store hiccup
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('sendTransactional — backward-compatible when no dedupeKey', () => {
  it('without dedupeKey: sends + logs as before, never touches EmailDispatch', async () => {
    const r = await sendTransactional({ ...mail, trigger: 'consumer_welcome' })
    expect(r.status).toBe('sent')
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(dispatchCreate).not.toHaveBeenCalled() // unchanged path for non-deduped callers
    expect(logCreate).toHaveBeenCalledTimes(1)    // EmailLog audit still written
  })
})

describe('money-adjacent template fns thread the dedupeKey through', () => {
  it('sendOrderConfirmation claims EmailDispatch with its dedupeKey', async () => {
    await sendOrderConfirmation({
      to: 'a@b.com', customerName: 'A', restaurantName: 'R', orderRef: '#ABC123',
      fulfillmentType: 'pickup', items: [{ name: 'Plat', qty: 1 }], paidCents: 1290,
      dedupeKey: 'order:o9',
    })
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'order_confirmation', dedupeKey: 'order:o9' } })
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('GOLDEN RULE + money engine — source invariants', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

  it('the Stripe webhook NEVER imports sendTransactional / sendOnce / transactional-emails', () => {
    const wh = read('app/api/webhooks/stripe/route.ts')
    expect(/transactional-emails|sendTransactional|sendOnce/.test(wh)).toBe(false)
  })

  it('the confirm route deduplicates via EmailDispatch (not an EmailLog read) and passes dedupeKey', () => {
    const c = read('app/api/orders/[id]/confirm/route.ts')
    expect(/emailDispatch/.test(c)).toBe(true)
    expect(/dedupeKey/.test(c)).toBe(true)
    expect(/emailLog\.findFirst/.test(c)).toBe(false) // old non-race-safe guard removed
  })
})
