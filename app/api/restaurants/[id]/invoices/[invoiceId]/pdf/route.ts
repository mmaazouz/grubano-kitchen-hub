import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { issuerIdentity } from '@/lib/invoice'
import { resolveVatRate } from '@/lib/tax'
import { renderInvoicePdf, type InvoicePdfLine } from '@/lib/invoice-pdf'

// ── GET /api/restaurants/[id]/invoices/[invoiceId]/pdf (P4.4-B) ───────────────────
// A real, downloadable PDF of an EXISTING invoice. SAME owner-or-admin scoping + SAME
// data as the printable HTML route (id sibling) — it formats the STORED figures
// (totalHt/totalTva/totalTtc, gapless number, fiscal identities), it recomputes NO
// money. Pure-JS pdf-lib (no headless browser → o2switch-safe). Generated on the fly.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHANNEL_LABELS: Record<string, string> = {
  dinein:      'Sur place — additions de table',
  pickup:      'À emporter',
  delivery:    'Livraison',
  reservation: 'Réservations — pénalités no-show',
}
const TYPE_LABELS: Record<string, string> = {
  payment:         'Sur place — additions de table',
  deposit_capture: 'Réservations — pénalités no-show',
  refund:          'Remboursements',
  adjustment:      'Ajustements',
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string; invoiceId: string } },
) {
  try {
    // ── Auth + owner-scoping (identical to the HTML invoice route) ─────────────
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true },
    })
    if (!operator) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })
    }
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: params.id },
      select: {
        id: true, operatorId: true, name: true, address: true, city: true,
        operator: { select: { vatNumber: true, country: true } },
      },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })
    }
    if (restaurant.operatorId !== operator.id && operator.role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: params.invoiceId } })
    if (!invoice || invoice.restaurantId !== restaurant.id) {
      return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })
    }

    // ── Per-channel detail (DISPLAY only — stored totals stay authoritative) ───
    const groups = await prisma.ledgerEntry.groupBy({
      by:     ['channel', 'type'],
      where:  { restaurantId: restaurant.id, createdAt: { gte: invoice.periodStart, lt: invoice.periodEnd } },
      _sum:   { applicationFeeAmount: true, grossAmount: true },
      _count: { _all: true },
    })
    const detailFeeSum = groups.reduce((s, g) => s + (g._sum.applicationFeeAmount ?? 0), 0)
    const labelFor = (g: { channel: string | null; type: string }) =>
      g.type === 'refund' || g.type === 'adjustment'
        ? TYPE_LABELS[g.type]
        : (g.channel && CHANNEL_LABELS[g.channel]) ?? TYPE_LABELS[g.type] ?? g.type
    const lines: InvoicePdfLine[] = groups.map((g) => ({
      label:      labelFor(g),
      count:      g._count._all,
      grossCents: g._sum.grossAmount ?? 0,
      feeCents:   g._sum.applicationFeeAmount ?? 0,
    }))

    const issuer = issuerIdentity()
    const vatPct = (resolveVatRate(restaurant.operator?.country) * 100).toFixed(0)

    // NO recalculation — the stored invoice figures are passed through verbatim.
    const pdf = await renderInvoicePdf({
      number:        invoice.number,
      issuedAt:      invoice.issuedAt,
      periodStart:   invoice.periodStart,
      periodEnd:     invoice.periodEnd,
      totalHtCents:  invoice.totalHt,
      totalTvaCents: invoice.totalTva,
      totalTtcCents: invoice.totalTtc,
      entriesCount:  invoice.entriesCount,
      vatPct,
      issuer,
      recipient: {
        name:    restaurant.name,
        address: restaurant.address ?? '',
        city:    restaurant.city ?? '',
        vat:     restaurant.operator?.vatNumber || '—',
      },
      lines,
      driftDetailFeeCents: detailFeeSum !== invoice.totalTtc ? detailFeeSum : null,
    })

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="Facture-${invoice.number}.pdf"`,
        'Cache-Control':       'private, no-store',
      },
    })
  } catch (err) {
    console.error('[invoice pdf]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
