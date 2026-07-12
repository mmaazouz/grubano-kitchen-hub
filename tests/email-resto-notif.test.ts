import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'

// ── Email B2 — restaurant notifications (Agent 143) ────────────────────────────
// « nouvelle commande reçue » (from orders/[id]/confirm, post-payment — NEVER the webhook) and
// « nouvelle réservation reçue » (from reservations/public). Both dispatch through the B0 rail:
// sendOnce(trigger, dedupeKey). DISTINCT triggers from the consumer emails sharing the same
// dedupeKey (order:<id> / resv:<id>) → no collision. Best-effort, FR, order amount = SERVER raw.

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
const { dispatchCreate, dispatchDeleteMany, logCreate } = vi.hoisted(() => ({
  dispatchCreate: vi.fn(), dispatchDeleteMany: vi.fn(), logCreate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { emailDispatch: { create: dispatchCreate, deleteMany: dispatchDeleteMany }, emailLog: { create: logCreate } },
}))

import { sendRestaurantNewOrderEmail, sendRestaurantNewReservationEmail } from '@/lib/transactional-emails'

const P = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: '5.22.0' })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SMTP_PASS = 'x'
  dispatchCreate.mockResolvedValue({ id: 'd1' })
  dispatchDeleteMany.mockResolvedValue({ count: 1 })
  logCreate.mockResolvedValue({ id: 'l1' })
  sendMail.mockResolvedValue({ messageId: 'm1' })
})

describe('sendRestaurantNewOrderEmail — resto_order_received / order:<id>', () => {
  const call = () => sendRestaurantNewOrderEmail({
    orderId: 'o1', to: 'owner@resto.com', restaurantName: 'Gnocchi Bar', orderRef: '#AB12CD',
    fulfillmentType: 'delivery', items: [{ name: 'Gnocchi', qty: 2 }], totalCents: 2580,
  })

  it('dispatches to the OWNER via sendOnce with the right trigger + dedupeKey', async () => {
    const r = await call()
    expect(r.status).toBe('sent')
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'resto_order_received', dedupeKey: 'order:o1' } })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0].to).toBe('owner@resto.com')
    expect(sendMail.mock.calls[0][0].subject).toContain('Nouvelle commande')
    const html = sendMail.mock.calls[0][0].html as string
    expect(html).toContain('Gnocchi')          // items listed
    expect(html).toContain('25,80')             // SERVER total formatted (display only)
  })

  it('a 2nd attempt for the same order is deduped (P2002 → no resend)', async () => {
    dispatchCreate.mockRejectedValueOnce(P('P2002'))
    const r = await call()
    expect(r.status).toBe('duplicate')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('best-effort: a send failure never throws', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const r = await call()
    expect(r.status).toBe('failed')
  })

  it('uses a DISTINCT trigger from the consumer order_confirmation (no dedupeKey collision)', async () => {
    await call()
    expect(dispatchCreate.mock.calls[0][0].data.trigger).not.toBe('order_confirmation')
  })
})

describe('sendRestaurantNewReservationEmail — resto_reservation_received / resv:<id>', () => {
  it('dispatches to the OWNER via sendOnce with the right trigger + dedupeKey', async () => {
    const r = await sendRestaurantNewReservationEmail({
      reservationId: 'r1', to: 'owner@resto.com', restaurantName: 'Gnocchi Bar',
      customerName: 'Léa', date: new Date('2026-07-01T19:30:00Z'), guests: 4, code: '#R1AB',
    })
    expect(r.status).toBe('sent')
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'resto_reservation_received', dedupeKey: 'resv:r1' } })
    expect(sendMail.mock.calls[0][0].to).toBe('owner@resto.com')
    expect(sendMail.mock.calls[0][0].subject).toContain('Nouvelle réservation')
    expect(sendMail.mock.calls[0][0].html as string).toContain('Léa')
  })

  it('best-effort: a send failure never throws', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const r = await sendRestaurantNewReservationEmail({
      reservationId: 'r2', to: 'o@x.com', restaurantName: 'R', customerName: 'A',
      date: new Date('2026-07-01T19:30:00Z'), guests: 2, code: '#R2',
    })
    expect(r.status).toBe('failed')
  })
})

describe('wiring + invariants (source-scan)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

  it('confirm route fires the resto email best-effort, money logic intact, from confirm not webhook', () => {
    const c = read('app/api/orders/[id]/confirm/route.ts')
    expect(/import \{ sendOrderConfirmation, sendRestaurantNewOrderEmail \}/.test(c)).toBe(true)
    expect(/try \{[\s\S]*sendRestaurantNewOrderEmail[\s\S]*\} catch/.test(c)).toBe(true)
    // money logic untouched
    expect(/order\.paymentStatus !== 'paid'/.test(c)).toBe(true)
    expect(/order\.consumerId !== token\.sub/.test(c)).toBe(true)
    expect(/paidCents:\s*Math\.round\(order\.total \* 100\)/.test(c)).toBe(true)
    // no money lib pulled into the route
    expect(/lib\/commission|lib\/ledger|lib\/pricing|lib\/stripe/.test(c)).toBe(false)
  })

  it('reservations/public fires the resto email best-effort', () => {
    const r = read('app/api/reservations/public/route.ts')
    expect(/sendRestaurantNewReservationEmail/.test(r)).toBe(true)
    expect(/try \{[\s\S]*sendRestaurantNewReservationEmail[\s\S]*\} catch/.test(r)).toBe(true)
  })

  it('GOLDEN RULE — the Stripe webhook still imports no email sender', () => {
    const wh = read('app/api/webhooks/stripe/route.ts')
    expect(/transactional-emails|sendOnce|sendRestaurantNewOrderEmail|sendTransactional/.test(wh)).toBe(false)
  })

  it('orders/route (creation, money engine) does NOT send the resto email here (cash flagged, untouched)', () => {
    const o = read('app/api/orders/route.ts')
    expect(/sendRestaurantNewOrderEmail|resto_order_received/.test(o)).toBe(false)
  })
})
