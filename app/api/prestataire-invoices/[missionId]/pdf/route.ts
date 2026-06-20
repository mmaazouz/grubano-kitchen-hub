import { NextResponse } from 'next/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { resolveInvoiceForCaller } from '@/lib/service-invoice'
import { renderServiceInvoicePdf } from '@/lib/service-invoice-pdf'
import { SERVICE_COMMISSION_RATE } from '@/lib/service-pricing'

export const dynamic = 'force-dynamic'

// ── GET /api/prestataire-invoices/[missionId]/pdf — the mission invoice PDF (P6, Agent 79) ──
// Same owner-scoping + 'done' gate as the JSON route (resolveInvoiceForCaller); renders the
// stored figures via the NEW lib/service-invoice-pdf (lib/invoice-pdf exports stay byte-
// identical). 404 when PRESTATAIRE_ENABLED is OFF. MONEY-ADJACENT but ZERO money movement.

export async function GET(_req: Request, { params }: { params: { missionId: string } }) {
  if (!isPrestataireEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ctx = await resolveInvoiceForCaller(params.missionId)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const pdf = await renderServiceInvoicePdf({
    number:              ctx.invoice.number,
    issuedAt:            ctx.invoice.issuedAt,
    amountCents:         ctx.invoice.amountCents,
    grubanoMarginCents:  ctx.economics.grubanoMarginCents,
    prestataireNetCents: ctx.economics.prestataireNetCents,
    ratePct:             String(Math.round(SERVICE_COMMISSION_RATE * 100)),
    serviceLabel:        ctx.serviceLabel,
    issuer:              ctx.issuer,
    recipient:           ctx.recipient,
    // The commission split is confidential to the prestataire side: the billed restaurant gets a
    // valid invoice (header + parties + prestation + total) but WITHOUT the RÉPARTITION block.
    revealSplit:         ctx.revealSplit,
  })

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${ctx.invoice.number}.pdf"`,
      'Cache-Control':       'no-store',
    },
  })
}
