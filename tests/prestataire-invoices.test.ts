import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/prestataire-invoices/[missionId] (+ /pdf) — P6, Agent 79 ─────────────
// LAZY mission invoice: ensure-if-absent + return the PURE 5 % split + a PDF. Owner-scoped
// (resto party OR prestataire party OR admin — no IDOR), 'done'-gated, idempotent + gapless
// (PRS- series, dedicated counter). FLAG OFF → 404. MONEY-ADJACENT but ZERO money movement:
// status is always 'issued', nothing is charged. Real isPrestataireEnabled + resolveInvoiceForCaller
// + issueServiceInvoice + computeServiceEconomics + renderServiceInvoicePdf; prisma + sessions mocked.

const { db, op, prof } = vi.hoisted(() => ({
  db: {
    serviceMission:        { findUnique: vi.fn() },
    serviceInvoice:        { findUnique: vi.fn(), create: vi.fn() },
    serviceInvoiceCounter: { upsert: vi.fn(), update: vi.fn() },
    $transaction:          vi.fn(),
  },
  op:   vi.fn(),
  prof: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: op }))
vi.mock('@/lib/prestataire-account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/prestataire-account')>('@/lib/prestataire-account')
  return { ...actual, callerPrestataireProfile: prof } // keep the REAL isPrestataireEnabled (reads env)
})

import { GET as getJson } from '@/app/api/prestataire-invoices/[missionId]/route'
import { GET as getPdf } from '@/app/api/prestataire-invoices/[missionId]/pdf/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const json = (missionId: string) => getJson(new Request('http://x'), { params: { missionId } })
const pdf  = (missionId: string) => getPdf(new Request('http://x'), { params: { missionId } })

const ISSUED = new Date('2026-06-20T10:00:00.000Z')

// In-memory invoice + counter store so idempotency + gaplessness are exercised for real.
let invoices: Record<string, Record<string, unknown>>
let counters: Record<number, number>

const MISSION = (over: Record<string, unknown> = {}) => ({
  id: 'm1', status: 'done', quoteAmountCents: 15_000,
  restaurantOperatorId: 'op-resto', prestataireProfileId: 'pp1',
  restaurantOperator: { name: 'Resto Bidule' },
  prestataireProfile: { companyName: 'Presta SARL', city: 'Lyon', siren: '123456789' },
  serviceOffering: { title: 'Maintenance frigo' },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks(); ON()
  invoices = {}; counters = {}

  op.mockResolvedValue({ id: 'op-resto', role: 'restaurant' })   // the billed resto, by default
  prof.mockResolvedValue(null)

  db.serviceMission.findUnique.mockResolvedValue(MISSION())
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))

  db.serviceInvoice.findUnique.mockImplementation(({ where }: { where: { serviceMissionId: string } }) =>
    Promise.resolve(invoices[where.serviceMissionId] ?? null))
  db.serviceInvoiceCounter.upsert.mockImplementation(({ where, create }: { where: { year: number }, create: { seq: number } }) => {
    if (counters[where.year] == null) counters[where.year] = create.seq
    return Promise.resolve({ year: where.year, seq: counters[where.year] })
  })
  db.serviceInvoiceCounter.update.mockImplementation(({ where }: { where: { year: number } }) => {
    counters[where.year] = (counters[where.year] ?? 0) + 1
    return Promise.resolve({ year: where.year, seq: counters[where.year] })
  })
  db.serviceInvoice.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `inv_${data.serviceMissionId}`, issuedAt: ISSUED, createdAt: ISSUED, ...data }
    invoices[data.serviceMissionId as string] = row
    return Promise.resolve(row)
  })
})
afterEach(() => OFF())

describe('FLAG OFF → 404, no work done', () => {
  it('JSON + PDF both 404; no session, no mission, no invoice', async () => {
    OFF()
    expect((await json('m1')).status).toBe(404)
    expect((await pdf('m1')).status).toBe(404)
    expect(op).not.toHaveBeenCalled()
    expect(db.serviceMission.findUnique).not.toHaveBeenCalled()
    expect(db.serviceInvoice.create).not.toHaveBeenCalled()
  })
})

// Switch the caller to the issuing prestataire (a party to the mission via its profile).
const asPrestataire = () => {
  op.mockResolvedValue({ id: 'op-presta', role: 'prestataire' })
  prof.mockResolvedValue({ id: 'pp1', status: 'active' })
}

describe('happy path (JSON, RESTO) — the invoice, NO money, NO split on the wire', () => {
  it('amount == quote, status issued, gapless PRS number — and the split is WITHHELD', async () => {
    const res = await json('m1') // default caller = the billed resto
    expect(res.status).toBe(200)
    const d = await res.json()

    expect(d.invoice.amountCents).toBe(15_000)               // == the agreed quote (what the resto owes)
    expect(d.invoice.status).toBe('issued')                  // never 'paid' here — no money
    expect(d.invoice.number).toMatch(/^PRS-\d{4}-00001$/)    // dedicated PRS- series, first of the year
    expect(d.serviceLabel).toBe('Maintenance frigo')

    // CONFIDENTIALITY: Grubano's margin / the prestataire's net are NEVER sent to the resto.
    expect(d.economics).toBeUndefined()
    const wire = JSON.stringify(d)
    expect(wire).not.toContain('grubanoMargin')
    expect(wire).not.toContain('prestataireNet')

    // the create payload carried NO money/payment field
    const created = db.serviceInvoice.create.mock.calls[0][0].data
    expect(created.amountCents).toBe(15_000)
    expect(created.status).toBe('issued')
    expect(created).not.toHaveProperty('paidAt')
    expect(created).not.toHaveProperty('stripePaymentIntentId')
  })
})

describe('happy path (JSON, PRESTATAIRE/ADMIN) — the 5 % split IS revealed', () => {
  it('the issuing prestataire sees the exact split + invariant', async () => {
    asPrestataire()
    const d = await (await json('m1')).json()
    expect(d.economics.rate).toBe(0.05)
    expect(d.economics.restaurantPaysCents).toBe(15_000)
    expect(d.economics.grubanoMarginCents).toBe(750)
    expect(d.economics.prestataireNetCents).toBe(14_250)
    expect(d.economics.restaurantPaysCents).toBe(d.economics.prestataireNetCents + d.economics.grubanoMarginCents)
  })
  it('an admin also sees the split', async () => {
    op.mockResolvedValue({ id: 'op-admin', role: 'admin' })
    const d = await (await json('m1')).json()
    expect(d.economics.grubanoMarginCents).toBe(750)
    expect(d.economics.prestataireNetCents).toBe(14_250)
  })
})

describe('idempotency + gaplessness', () => {
  it('a 2nd call returns the SAME invoice — number not re-burned, counter not bumped', async () => {
    const a = await (await json('m1')).json()
    const b = await (await json('m1')).json()
    expect(b.invoice.number).toBe(a.invoice.number)
    expect(b.invoice.id).toBe(a.invoice.id)
    expect(db.serviceInvoice.create).toHaveBeenCalledTimes(1)        // created once
    expect(db.serviceInvoiceCounter.update).toHaveBeenCalledTimes(1) // counter bumped once
  })
  it('two distinct done missions get consecutive PRS numbers', async () => {
    const a = await (await json('m1')).json()
    db.serviceMission.findUnique.mockResolvedValue(MISSION({ id: 'm2', quoteAmountCents: 20_000 }))
    const b = await (await json('m2')).json()
    expect(a.invoice.number).toMatch(/-00001$/)
    expect(b.invoice.number).toMatch(/-00002$/)
    expect(b.invoice.amountCents).toBe(20_000)
  })
})

describe('owner-scoping (no IDOR) + business gates', () => {
  it('no session → 401', async () => {
    op.mockResolvedValue(null)
    expect((await json('m1')).status).toBe(401)
    expect(db.serviceInvoice.create).not.toHaveBeenCalled()
  })
  it('mission not found → 404', async () => {
    db.serviceMission.findUnique.mockResolvedValue(null)
    expect((await json('m1')).status).toBe(404)
  })
  it('a stranger (neither party, not admin) → 403, nothing issued', async () => {
    op.mockResolvedValue({ id: 'op-evil', role: 'restaurant' })
    prof.mockResolvedValue({ id: 'pp-evil', status: 'active' })
    expect((await json('m1')).status).toBe(403)
    expect(db.serviceInvoice.create).not.toHaveBeenCalled()
  })
  it('the PRESTATAIRE party (matched via profile) is authorized', async () => {
    op.mockResolvedValue({ id: 'op-other', role: 'prestataire' }) // not the resto
    prof.mockResolvedValue({ id: 'pp1', status: 'active' })        // but IS the mission's prestataire
    expect((await json('m1')).status).toBe(200)
  })
  it('an admin is authorized for any mission', async () => {
    op.mockResolvedValue({ id: 'op-admin', role: 'admin' })
    expect((await json('m1')).status).toBe(200)
  })
  it('mission NOT done → 409, nothing issued', async () => {
    db.serviceMission.findUnique.mockResolvedValue(MISSION({ status: 'accepted' }))
    expect((await json('m1')).status).toBe(409)
    expect(db.serviceInvoice.create).not.toHaveBeenCalled()
  })
  it('done but no agreed amount → 409', async () => {
    db.serviceMission.findUnique.mockResolvedValue(MISSION({ quoteAmountCents: null }))
    expect((await json('m1')).status).toBe(409)
  })
})

describe('PDF route — a real application/pdf document, same scoping', () => {
  it('200 with a %PDF body + the invoice number in the filename', async () => {
    const res = await pdf('m1')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('PRS-')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-') // valid PDF magic
    expect(bytes.length).toBeGreaterThan(500)
  })
  it('the prestataire also gets a valid PDF (with its split — server-rendered)', async () => {
    asPrestataire()
    const res = await pdf('m1')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
  })
  it('a stranger is refused the PDF too (403)', async () => {
    op.mockResolvedValue({ id: 'op-evil', role: 'restaurant' })
    prof.mockResolvedValue({ id: 'pp-evil', status: 'active' })
    expect((await pdf('m1')).status).toBe(403)
  })
})
