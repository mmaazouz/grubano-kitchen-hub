import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P0 OPERATIONAL (2026-09-05) — restaurant new-order notification WITHOUT any browser ─
// Required invariant: ONE paid, actionable order ⇒ the restaurant notification is
// eventually sent even when no customer/restaurant tab is open, the customer closes the
// browser right after paying, SMTP fails once, or the server retries — and never as an
// uncontrolled duplicate. The mechanism under test is the REAL rail (sendOnce + EmailLog)
// + the REAL sweep (lib/order-email-sweep) + the REAL /confirm route (browser poll),
// against an in-memory simulation of the DB tables that matter (Order, EmailDispatch
// with its @@unique, EmailLog). Transport = mocked Nodemailer (nothing is sent).

const { sim, sendMail } = vi.hoisted(() => {
  type Order = { id: string; consumerId: string; paymentStatus: string; status: string; total: number; fulfillmentType: string; items: unknown; updatedAt: Date; restaurant: { name: string; operator: { email: string | null } } }
  const sim = {
    orders: [] as Order[],
    dispatch: new Set<string>(),                   // `${trigger}|${dedupeKey}` — the @@unique
    log: [] as Array<{ recipient: string; subject: string; trigger: string; status: string; sentAt: Date }>,
    now: new Date('2026-09-12T17:30:00Z'),
    reset() { this.orders = []; this.dispatch.clear(); this.log = [] },
  }
  return { sim, sendMail: vi.fn() }
})

const P2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: '5.22.0' })

vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('next-auth/jwt', () => ({ getToken: async () => ({ sub: 'c1' }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: {
      findMany: async ({ where }: { where: { paymentStatus: string; status: { notIn: string[] }; updatedAt: { gte: Date } } }) =>
        sim.orders.filter((o) => o.paymentStatus === where.paymentStatus && !where.status.notIn.includes(o.status) && o.updatedAt >= where.updatedAt.gte),
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
        const o = sim.orders.find((x) => x.id === where.id)
        if (!o) return null
        if (select && Object.keys(select).length === 1 && 'restaurant' in select) return { restaurant: o.restaurant }
        return o
      },
    },
    operator: { findUnique: async () => ({ email: 'lea.martin@example.invalid', name: 'Léa Martin' }) },
    emailDispatch: {
      create: async ({ data }: { data: { trigger: string; dedupeKey: string } }) => {
        const k = `${data.trigger}|${data.dedupeKey}`
        if (sim.dispatch.has(k)) throw P2002()
        sim.dispatch.add(k); return { id: k }
      },
      deleteMany: async ({ where }: { where: { trigger: string; dedupeKey: string } }) => {
        const k = `${where.trigger}|${where.dedupeKey}`; const had = sim.dispatch.delete(k); return { count: had ? 1 : 0 }
      },
      findMany: async ({ where }: { where: { dedupeKey: { in: string[] }; trigger: { in: string[] } } }) =>
        [...sim.dispatch].map((k) => { const [trigger, dedupeKey] = k.split('|'); return { trigger, dedupeKey } })
          .filter((d) => where.dedupeKey.in.includes(d.dedupeKey) && where.trigger.in.includes(d.trigger)),
      findFirst: async ({ where }: { where: { trigger: string; dedupeKey: string } }) =>
        sim.dispatch.has(`${where.trigger}|${where.dedupeKey}`) ? { id: 'd' } : null,
    },
    emailLog: {
      create: async ({ data }: { data: { recipient: string; subject: string; trigger: string; status: string } }) => { sim.log.push({ ...data, sentAt: new Date() }); return { id: 'l' } },
      findMany: async ({ where, take }: { where: { trigger: string; status: string; subject: { contains: string }; sentAt: { gte: Date } }; take: number }) =>
        sim.log.filter((l) => l.trigger === where.trigger && l.status === where.status && l.subject.includes(where.subject.contains) && l.sentAt >= where.sentAt.gte)
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()).slice(0, take).map((l) => ({ sentAt: l.sentAt })),
    },
  },
}))

import { sweepUnconfirmedPaidOrders, retryDecision, MAX_ATTEMPTS, BACKOFF_MS } from '@/lib/order-email-sweep'
import { POST as confirmPOST } from '@/app/api/orders/[id]/confirm/route'

const restoMails = () => sendMail.mock.calls.filter((c) => c[0].to === 'gnocchi.bar@example.invalid')
const consumerMails = () => sendMail.mock.calls.filter((c) => c[0].to === 'lea.martin@example.invalid')

const paidOrder = (id = 'clx0fixtureabc123', over: Partial<(typeof sim.orders)[number]> = {}) => ({
  id, consumerId: 'c1', paymentStatus: 'paid', status: 'received', total: 25.5, fulfillmentType: 'pickup',
  items: [{ name: 'Gnocchi 4 fromages', qty: 2 }], updatedAt: new Date(),
  restaurant: { name: 'Gnocchi Bar', operator: { email: 'gnocchi.bar@example.invalid' } },
  ...over,
})

const poll = (id: string) => confirmPOST(new Request(`http://x/api/orders/${id}/confirm`, { method: 'POST' }) as never, { params: { id } })

beforeEach(() => {
  vi.clearAllMocks()
  sim.reset()
  process.env.SMTP_PASS = 'fixture'
  process.env.ALERT_EMAIL = 'admin-alerts@example.invalid'
  delete process.env.DELIVERY_FULFILLMENT_ENABLED
  sendMail.mockResolvedValue({ messageId: 'm' })
})

describe('P0 — restaurant new-order notification does NOT depend on a browser', () => {
  it('TEST 1 — paid actionable order + NO poll at all → the server sweep sends the restaurant email (and the consumer confirmation)', async () => {
    sim.orders.push(paidOrder())
    const r = await sweepUnconfirmedPaidOrders()
    expect(r).toMatchObject({ scanned: 1, restoSent: 1, consumerSent: 1, errors: 0 })
    expect(restoMails()).toHaveLength(1)
    expect(restoMails()[0][0].subject).toBe('Nouvelle commande GR-ABC123 — Gnocchi Bar')
    expect(sim.dispatch.has('resto_order_received|order:clx0fixtureabc123')).toBe(true)
  })

  it('TEST 2 — customer closes the browser right after payment (webhook set paid, /confirm never called) → still sent', async () => {
    sim.orders.push(paidOrder('clx0closedtab0001'))
    // no poll() — the tab is gone
    await sweepUnconfirmedPaidOrders()
    expect(restoMails()).toHaveLength(1)
    expect(restoMails()[0][0].subject).toContain('GR-TAB0001'.replace('TAB0001', 'AB0001')) // ref = last 6 chars uppercased
  })

  it('TEST 3 — restaurant dashboard closed (no restaurant-side request exists in the chain) → still sent to the owner address', async () => {
    sim.orders.push(paidOrder())
    await sweepUnconfirmedPaidOrders()
    expect(restoMails()[0][0].to).toBe('gnocchi.bar@example.invalid')
  })

  it('TEST 4 — browser poll AFTER the server notification → NO duplicate (the @@unique claim wins)', async () => {
    sim.orders.push(paidOrder())
    await sweepUnconfirmedPaidOrders()
    const res = await poll('clx0fixtureabc123')
    expect((await res.json())).toMatchObject({ paymentStatus: 'paid', emailSent: true, alreadySent: true })
    expect(restoMails()).toHaveLength(1)
    expect(consumerMails()).toHaveLength(1)
  })

  it('TEST 5 — multiple polls (before and after the sweep) → exactly one restaurant email', async () => {
    sim.orders.push(paidOrder())
    await poll('clx0fixtureabc123')
    await poll('clx0fixtureabc123')
    await sweepUnconfirmedPaidOrders()
    await poll('clx0fixtureabc123')
    expect(restoMails()).toHaveLength(1)
    expect(consumerMails()).toHaveLength(1)
  })

  it('TEST 6 — server retry (the sweep runs 5 times, concurrently once) → no uncontrolled duplicate', async () => {
    sim.orders.push(paidOrder())
    await Promise.all([sweepUnconfirmedPaidOrders(), sweepUnconfirmedPaidOrders()])
    await sweepUnconfirmedPaidOrders(); await sweepUnconfirmedPaidOrders(); await sweepUnconfirmedPaidOrders()
    expect(restoMails()).toHaveLength(1)
    expect(consumerMails()).toHaveLength(1)
  })

  it('TEST 7 — SMTP fails on the first attempt, then succeeds → eventually sent exactly once (claim released, backoff respected)', async () => {
    sim.orders.push(paidOrder())
    sendMail.mockRejectedValueOnce(new Error('smtp down')) // first send = the restaurant (sweep order: resto first)
    const r1 = await sweepUnconfirmedPaidOrders()
    expect(r1.restoSent).toBe(1)            // counted as attempted by the sweep…
    expect(sim.dispatch.has('resto_order_received|order:clx0fixtureabc123')).toBe(false) // …but the claim was RELEASED (failed)
    expect(sim.log.filter((l) => l.trigger === 'resto_order_received' && l.status === 'failed')).toHaveLength(1)
    // Immediate retry is deferred by the backoff (1 failure → wait 60 s)
    const r2 = await sweepUnconfirmedPaidOrders()
    expect(r2.backoffSkipped).toBe(1)
    // Age the failure past the backoff → the retry goes through
    sim.log[0].sentAt = new Date(Date.now() - 61_000)
    const r3 = await sweepUnconfirmedPaidOrders()
    expect(r3.restoSent).toBe(1)
    expect(restoMails().filter((c) => c[0].subject.startsWith('Nouvelle commande'))).toHaveLength(2) // 1 failed attempt + 1 success
    expect(sim.dispatch.has('resto_order_received|order:clx0fixtureabc123')).toBe(true)
    const r4 = await sweepUnconfirmedPaidOrders()
    expect(r4.alreadyDone).toBe(1)
  })

  it('TEST 8 — unpaid order (awaiting_payment) → NO restaurant email, NO consumer confirmation', async () => {
    sim.orders.push(paidOrder('clx0unpaid0000001', { paymentStatus: 'awaiting_payment', status: 'awaiting_payment' }))
    const r = await sweepUnconfirmedPaidOrders()
    expect(r.scanned).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
    const res = await poll('clx0unpaid0000001')
    expect(await res.json()).toMatchObject({ paymentStatus: 'awaiting_payment', emailSent: false })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('TEST 9 — failed payment → NO actionable new-order email', async () => {
    sim.orders.push(paidOrder('clx0failed0000001', { paymentStatus: 'failed', status: 'awaiting_payment' }))
    await sweepUnconfirmedPaidOrders()
    await poll('clx0failed0000001')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('TEST 10 — cancelled / expired paid orders are NOT actionable → no « nouvelle commande » (the cancellation email family covers the consumer)', async () => {
    sim.orders.push(paidOrder('clx0cancel0000001', { status: 'cancelled' }))
    sim.orders.push(paidOrder('clx0expire0000001', { status: 'expired' }))
    const r = await sweepUnconfirmedPaidOrders()
    expect(r.scanned).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('bounded retry — give up after MAX_ATTEMPTS with a durable marker + one admin alert', () => {
  it('retryDecision: try / wait / give_up schedule (pure)', () => {
    const now = new Date('2026-09-12T18:00:00Z')
    expect(retryDecision(0, null, now)).toBe('try')
    expect(retryDecision(1, new Date(now.getTime() - 10_000), now)).toBe('wait')
    expect(retryDecision(1, new Date(now.getTime() - BACKOFF_MS[1]), now)).toBe('try')
    expect(retryDecision(3, new Date(now.getTime() - BACKOFF_MS[3] + 1), now)).toBe('wait')
    expect(retryDecision(MAX_ATTEMPTS, new Date(0), now)).toBe('give_up')
    expect(retryDecision(MAX_ATTEMPTS + 5, null, now)).toBe('give_up')
  })

  it('after MAX_ATTEMPTS failures: marker `<trigger>:gave_up` written, admin alerted ONCE, no further SMTP attempt', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sim.orders.push(paidOrder())
    // consumer already done; restaurant has MAX_ATTEMPTS old failures in the window
    sim.dispatch.add('order_confirmation|order:clx0fixtureabc123')
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      sim.log.push({ recipient: 'gnocchi.bar@example.invalid', subject: 'Nouvelle commande GR-ABC123 — Gnocchi Bar', trigger: 'resto_order_received', status: 'failed', sentAt: new Date(Date.now() - (i + 1) * 3_600_000) })
    }
    const r = await sweepUnconfirmedPaidOrders()
    expect(r.gaveUp).toBe(1)
    expect(r.restoSent).toBe(0)
    expect(sim.dispatch.has('resto_order_received:gave_up|order:clx0fixtureabc123')).toBe(true)
    // exactly one admin alert, to ALERT_EMAIL, naming the GR- reference
    const alerts = sendMail.mock.calls.filter((c) => c[0].to === 'admin-alerts@example.invalid')
    expect(alerts).toHaveLength(1)
    expect(alerts[0][0].subject).toContain('GR-ABC123')
    expect(sim.dispatch.has('admin_email_giveup|resto_order_received:order:clx0fixtureabc123')).toBe(true)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL GIVE-UP]'), expect.any(String))
    // next sweeps: nothing more, ever
    sendMail.mockClear()
    const r2 = await sweepUnconfirmedPaidOrders()
    expect(r2).toMatchObject({ alreadyDone: 1, gaveUp: 0, restoSent: 0 })
    expect(sendMail).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('an unreadable EmailLog never blocks a legitimate send (best-effort read)', async () => {
    sim.orders.push(paidOrder())
    const mod = await import('@/lib/prisma')
    const orig = mod.prisma.emailLog.findMany
    ;(mod.prisma.emailLog as { findMany: unknown }).findMany = async () => { throw new Error('P2021 table missing') }
    const r = await sweepUnconfirmedPaidOrders()
    ;(mod.prisma.emailLog as { findMany: unknown }).findMany = orig
    expect(r.restoSent).toBe(1)
  })
})
