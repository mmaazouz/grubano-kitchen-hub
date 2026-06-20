import { NextResponse } from 'next/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { resolveInvoiceForCaller } from '@/lib/service-invoice'

export const dynamic = 'force-dynamic'

// ── GET /api/prestataire-invoices/[missionId] — the mission invoice (P6, Agent 79) ──
// LAZY: for a 'done' mission owned by the caller (the billed resto OR the issuing prestataire,
// or admin), ensure-if-absent + return the ServiceInvoice + the PURE 5% economics. Owner-scoped
// (no IDOR) via lib/service-invoice.resolveInvoiceForCaller. 404 when PRESTATAIRE_ENABLED is
// OFF. MONEY-ADJACENT but ZERO money movement — no charge / payout / Connect.

export async function GET(_req: Request, { params }: { params: { missionId: string } }) {
  if (!isPrestataireEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ctx = await resolveInvoiceForCaller(params.missionId)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body: Record<string, unknown> = {
    invoice: {
      id:          ctx.invoice.id,
      number:      ctx.invoice.number,
      amountCents: ctx.invoice.amountCents,
      status:      ctx.invoice.status,
      issuedAt:    ctx.invoice.issuedAt,
    },
    serviceLabel: ctx.serviceLabel,
  }
  // The 5 % split is CONFIDENTIAL to the prestataire side — it is NEVER put on the wire for the
  // billed restaurant. Only the issuing prestataire (or admin) receives the economics object.
  if (ctx.revealSplit) body.economics = ctx.economics // { rate, restaurantPaysCents, grubanoMarginCents, prestataireNetCents }

  return NextResponse.json(body)
}
