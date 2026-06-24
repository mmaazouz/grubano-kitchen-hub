import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'

// ── Email B1 — consumer order-status emails (Agent 142) ────────────────────────
// sendOrderStatusEmail maps each order-status transition to a status email and dispatches it through
// the B0 rail: sendOnce(trigger=`order_<status>`, dedupeKey=`order:<id>`). DISTINCT triggers share the
// dedupeKey without colliding (one email per status per order). Best-effort (never throws). FR, no
// amount. Fires from the restaurant/admin PATCH — never the webhook (golden rule).

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
const { dispatchCreate, dispatchDeleteMany, logCreate } = vi.hoisted(() => ({
  dispatchCreate: vi.fn(), dispatchDeleteMany: vi.fn(), logCreate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { emailDispatch: { create: dispatchCreate, deleteMany: dispatchDeleteMany }, emailLog: { create: logCreate } },
}))

import { sendOrderStatusEmail } from '@/lib/transactional-emails'

const P = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: '5.22.0' })
const base = { orderId: 'o1', to: 'buyer@x.com', customerName: 'Léa', restaurantName: 'Gnocchi Bar', orderRef: '#AB12CD' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SMTP_PASS = 'x'
  dispatchCreate.mockResolvedValue({ id: 'd1' })
  dispatchDeleteMany.mockResolvedValue({ count: 1 })
  logCreate.mockResolvedValue({ id: 'l1' })
  sendMail.mockResolvedValue({ messageId: 'm1' })
})

describe('sendOrderStatusEmail — status → email via sendOnce(order_<status>, order:<id>)', () => {
  it('preparing → trigger order_accepted, dedupeKey order:<id>, to the consumer, 1 email', async () => {
    const r = await sendOrderStatusEmail({ ...base, status: 'preparing', fulfillmentType: 'delivery' })
    expect(r.status).toBe('sent')
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'order_accepted', dedupeKey: 'order:o1' } })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0].to).toBe('buyer@x.com')
    expect(sendMail.mock.calls[0][0].subject).toContain('acceptée')
  })

  it('a 2nd email for the SAME status is deduped (P2002 → duplicate, no resend)', async () => {
    dispatchCreate.mockRejectedValueOnce(P('P2002'))
    const r = await sendOrderStatusEmail({ ...base, status: 'preparing', fulfillmentType: 'delivery' })
    expect(r.status).toBe('duplicate')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('DIFFERENT statuses → DIFFERENT triggers, both send (no collision on the shared order:<id>)', async () => {
    await sendOrderStatusEmail({ ...base, status: 'preparing', fulfillmentType: 'delivery' })
    await sendOrderStatusEmail({ ...base, status: 'ready', fulfillmentType: 'delivery' })
    const triggers = dispatchCreate.mock.calls.map((c) => c[0].data.trigger)
    expect(triggers).toEqual(['order_accepted', 'order_ready'])
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('best-effort: a send failure NEVER throws (status failed, claim released for retry)', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const r = await sendOrderStatusEmail({ ...base, status: 'delivered', fulfillmentType: 'delivery' })
    expect(r.status).toBe('failed')
    expect(dispatchDeleteMany).toHaveBeenCalledWith({ where: { trigger: 'order_delivered', dedupeKey: 'order:o1' } })
  })

  it("a non-notifiable status ('received') is skipped — no claim, no email", async () => {
    const r = await sendOrderStatusEmail({ ...base, status: 'received', fulfillmentType: 'delivery' })
    expect(r.status).toBe('skipped')
    expect(dispatchCreate).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('fulfillment-aware wording: pickup vs delivery for ready / picked_up / delivered', async () => {
    await sendOrderStatusEmail({ ...base, status: 'ready', fulfillmentType: 'pickup' })
    expect(sendMail.mock.calls[0][0].html).toContain('récupérer')

    sendMail.mockClear()
    await sendOrderStatusEmail({ ...base, status: 'picked_up', fulfillmentType: 'delivery' })
    expect(sendMail.mock.calls[0][0].subject).toContain('en route')

    sendMail.mockClear()
    await sendOrderStatusEmail({ ...base, status: 'delivered', fulfillmentType: 'pickup' })
    expect(sendMail.mock.calls[0][0].subject).toContain('récupérée')

    sendMail.mockClear()
    await sendOrderStatusEmail({ ...base, status: 'delivered', fulfillmentType: 'delivery' })
    expect(sendMail.mock.calls[0][0].subject).toContain('livrée')
  })

  it('shows NO price/amount (status-only email)', async () => {
    await sendOrderStatusEmail({ ...base, status: 'preparing', fulfillmentType: 'delivery' })
    const html = sendMail.mock.calls[0][0].html as string
    expect(/€|montant|total/i.test(html)).toBe(false)
  })
})

describe('status route wiring + invariants (source-scan)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
  const route = read('app/api/orders/[id]/status/route.ts')

  it('fires the status email AFTER the update, best-effort, with status:newStatus', () => {
    expect(/import \{ sendOrderStatusEmail \}/.test(route)).toBe(true)
    expect(/await prisma\.order\.update/.test(route)).toBe(true)
    expect(/sendOrderStatusEmail\(\{[\s\S]*status:\s*newStatus/.test(route)).toBe(true)
    // wrapped in try/catch (best-effort) and placed before the success response
    expect(/try \{[\s\S]*sendOrderStatusEmail[\s\S]*\} catch/.test(route)).toBe(true)
  })

  it('the state machine is unchanged and no money lib / amount recompute was added', () => {
    expect(/const TRANSITIONS: Record<string, string\[\]> = \{/.test(route)).toBe(true)
    expect(/lib\/commission|lib\/ledger|lib\/pricing|lib\/stripe|webhooks\/stripe/.test(route)).toBe(false)
    expect(/order\.total/.test(route)).toBe(false) // status emails never touch the amount
  })

  it('GOLDEN RULE — the Stripe webhook still imports no email sender', () => {
    const wh = read('app/api/webhooks/stripe/route.ts')
    expect(/transactional-emails|sendOrderStatusEmail|sendOnce|sendTransactional/.test(wh)).toBe(false)
  })
})
