import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.4-B — GET /api/restaurants/[id]/invoices/[invoiceId]/pdf ──────────────────
// Owner-scoping (no IDOR) + NO-RECALC fidelity (the STORED invoice figures pass
// through verbatim) + correct PDF headers. prisma + auth mocked; renderInvoicePdf
// spied (captures the view); issuerIdentity + resolveVatRate run for real (pure).

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: {
    operator:    { findUnique: vi.fn() },
    restaurant:  { findUnique: vi.fn() },
    invoice:     { findUnique: vi.fn() },
    ledgerEntry: { groupBy: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { renderMock } = vi.hoisted(() => ({ renderMock: vi.fn() }))
vi.mock('@/lib/invoice-pdf', () => ({ renderInvoicePdf: renderMock }))

import { GET } from '@/app/api/restaurants/[id]/invoices/[invoiceId]/pdf/route'

const call = () => GET(new Request('https://app.grubano.com/x'), { params: { id: 'r1', invoiceId: 'inv1' } })

// Stored invoice with DELIBERATELY non-recomputable splits (999/201 ≠ round(1200/1.2)=1000/200)
// → proves the route passes the STORED values verbatim (no recalc).
const storedInvoice = {
  id: 'inv1', restaurantId: 'r1', number: 'GRB-2026-00042',
  issuedAt: new Date('2026-06-30T08:00:00Z'),
  periodStart: new Date('2026-06-01T00:00:00Z'), periodEnd: new Date('2026-07-01T00:00:00Z'),
  totalHt: 999, totalTva: 201, totalTtc: 1200, entriesCount: 7, status: 'issued',
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'op@x' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.restaurant.findUnique.mockResolvedValue({
    id: 'r1', operatorId: 'op1', name: 'Le Café', address: '1 rue', city: 'Paris',
    operator: { vatNumber: 'FR12345678901', country: 'FR' },
  })
  db.invoice.findUnique.mockResolvedValue(storedInvoice)
  db.ledgerEntry.groupBy.mockResolvedValue([
    { channel: 'pickup', type: 'payment', _sum: { applicationFeeAmount: 1200, grossAmount: 10000 }, _count: { _all: 7 } },
  ])
  renderMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) // %PDF-
})

describe('owner-scoping', () => {
  it('no session → 401, no render', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(renderMock).not.toHaveBeenCalled()
  })
  it('restaurant not found → 404', async () => {
    db.restaurant.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
  it('a non-owner non-admin → 403 (no IDOR)', async () => {
    db.restaurant.findUnique.mockResolvedValue({ id: 'r1', operatorId: 'SOMEONE_ELSE', name: 'x', address: '', city: '', operator: { vatNumber: null, country: 'FR' } })
    expect((await call()).status).toBe(403)
    expect(renderMock).not.toHaveBeenCalled()
  })
  it('invoice of another restaurant → 404', async () => {
    db.invoice.findUnique.mockResolvedValue({ ...storedInvoice, restaurantId: 'OTHER' })
    expect((await call()).status).toBe(404)
  })
  it('admin downloads any restaurant invoice → 200', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'admin1', role: 'admin' })
    db.restaurant.findUnique.mockResolvedValue({ id: 'r1', operatorId: 'someoneElse', name: 'x', address: '', city: '', operator: { vatNumber: null, country: 'FR' } })
    expect((await call()).status).toBe(200)
  })
})

describe('fidelity (no recalc) + headers', () => {
  it('passes the STORED figures verbatim — no recomputation', async () => {
    await call()
    expect(renderMock).toHaveBeenCalledTimes(1)
    const v = renderMock.mock.calls[0][0]
    expect(v.number).toBe('GRB-2026-00042')
    expect(v.totalHtCents).toBe(999)   // stored, NOT round(1200/1.2)=1000
    expect(v.totalTvaCents).toBe(201)  // stored, NOT 200
    expect(v.totalTtcCents).toBe(1200)
    expect(v.entriesCount).toBe(7)
    expect(v.vatPct).toBe('20')                       // resolveVatRate('FR') → 20
    expect(v.recipient.vat).toBe('FR12345678901')     // partner VAT from operator
    expect(v.issuer.siren.startsWith('[[')).toBe(true) // issuer from legal-info (placeholder)
    expect(v.lines).toHaveLength(1)
    expect(v.lines[0].feeCents).toBe(1200)
  })

  it('blank partner VAT → "—" on the invoice', async () => {
    db.restaurant.findUnique.mockResolvedValue({ id: 'r1', operatorId: 'op1', name: 'x', address: '', city: '', operator: { vatNumber: null, country: 'FR' } })
    await call()
    expect(renderMock.mock.calls[0][0].recipient.vat).toBe('—')
  })

  it('returns a PDF with download headers', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="Facture-GRB-2026-00042.pdf"')
  })
})
