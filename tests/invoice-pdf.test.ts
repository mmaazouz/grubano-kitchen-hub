import { describe, it, expect } from 'vitest'
import { renderInvoicePdf, type InvoicePdfView } from '@/lib/invoice-pdf'

// ── P4.4-B — the PDF renderer is pure-JS (pdf-lib), produces valid PDF bytes, and
// never throws on accented FR / euro / exotic input (WinAnsi-safe encoding). ──────

const view = (over: Partial<InvoicePdfView> = {}): InvoicePdfView => ({
  number: 'GRB-2026-00001',
  issuedAt: new Date('2026-06-30T08:00:00Z'),
  periodStart: new Date('2026-06-01T00:00:00Z'),
  periodEnd: new Date('2026-07-01T00:00:00Z'),
  totalHtCents: 1000, totalTvaCents: 200, totalTtcCents: 1200, entriesCount: 5,
  vatPct: '20',
  issuer:    { name: 'Grubano SAS', address: '1 rue de la Paix, Paris', siren: '123456789', vat: 'FR12345678901' },
  recipient: { name: 'Le Café Crème', address: "2 av. de l'Opéra", city: 'Paris', vat: '—' },
  lines: [
    { label: 'À emporter', count: 5, grossCents: 10000, feeCents: 800 },
    { label: 'Livraison',  count: 3, grossCents: 6000,  feeCents: 400 },
  ],
  driftDetailFeeCents: null,
  ...over,
})

const isPdf = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString('latin1') === '%PDF-'

describe('renderInvoicePdf', () => {
  it('(a) produces valid PDF bytes (%PDF header, non-empty)', async () => {
    const bytes = await renderInvoicePdf(view())
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(500)
    expect(isPdf(bytes)).toBe(true)
  })

  it('never throws on accented FR + euro + em-dash + ellipsis + smart quotes', async () => {
    const bytes = await renderInvoicePdf(view({
      issuer: { name: 'Société Générale Éàçûœ', address: '— rue « test » …', siren: '«…»', vat: 'FR—00' },
    }))
    expect(isPdf(bytes)).toBe(true)
  })

  it('never throws on emoji / non-Latin chars in a partner name (sanitised, not crash)', async () => {
    const bytes = await renderInvoicePdf(view({
      recipient: { name: 'Pizza 🍕 مطعم 北京', address: 'x', city: 'y', vat: '—' },
    }))
    expect(isPdf(bytes)).toBe(true)
  })

  it('renders the drift note path without error', async () => {
    const bytes = await renderInvoicePdf(view({ driftDetailFeeCents: 1150 }))
    expect(isPdf(bytes)).toBe(true)
  })

  it('handles an empty line set + zero totals', async () => {
    const bytes = await renderInvoicePdf(view({ lines: [], totalHtCents: 0, totalTvaCents: 0, totalTtcCents: 0, entriesCount: 0 }))
    expect(isPdf(bytes)).toBe(true)
  })
})
