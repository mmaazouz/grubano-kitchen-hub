import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { issuerIdentity } from '@/lib/invoice'
import { resolveVatRate } from '@/lib/tax'

// ── GET /api/restaurants/[id]/invoices/[invoiceId] ────────────────────────────
// Rail A4 — V1 render: a CLEAN, PRINTABLE HTML invoice (étape-0 inventory found
// no PDF lib in the project; strict PDF comes later). Owner-or-admin gate. The
// authoritative totals are the STORED Invoice amounts (frozen at issuance from
// the ledger); the per-channel detail is recomputed from the ledger for display
// and any post-issuance drift is surfaced honestly.
// Channel mapping V1: the ledger has no channel column yet (it lands with
// pickup/delivery charging) — type 'payment' = dine-in bill, 'deposit_capture'
// = reservation no-show penalty, which is exact for today's flows.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Real-channel labels (C1: LedgerEntry.channel) with legacy type fallback for
// lines written before the channel column existed (pre-backfill).
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

const eur = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const dateFr = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC' })
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function GET(
  _req: Request,
  { params }: { params: { id: string; invoiceId: string } },
) {
  try {
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
        // P4.4-A — partner fiscal id + VAT-rate country (from the owning operator).
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

    // Per-channel detail from the ledger (display; stored totals stay
    // authoritative). C1: grouped by the REAL channel when the line carries one
    // (refund/adjustment lines keep their type label), legacy type fallback else.
    const groups = await prisma.ledgerEntry.groupBy({
      by:     ['channel', 'type'],
      where:  {
        restaurantId: restaurant.id,
        createdAt:    { gte: invoice.periodStart, lt: invoice.periodEnd },
      },
      _sum:   { applicationFeeAmount: true, grossAmount: true },
      _count: { _all: true },
    })
    const detailFeeSum = groups.reduce((s, g) => s + (g._sum.applicationFeeAmount ?? 0), 0)
    const drifted = detailFeeSum !== invoice.totalTtc

    const labelFor = (g: { channel: string | null; type: string }) =>
      g.type === 'refund' || g.type === 'adjustment'
        ? TYPE_LABELS[g.type]
        : (g.channel && CHANNEL_LABELS[g.channel]) ?? TYPE_LABELS[g.type] ?? g.type

    const issuer = issuerIdentity()
    // P4.4-A — VAT rate from the partner's country (FR → 0.20, byte-identical). The
    // stored totalTva was split at the SAME rate at issuance, so the label matches.
    const vatRate = resolveVatRate(restaurant.operator?.country)
    const vatPct = (vatRate * 100).toFixed(0)
    const partnerVat = restaurant.operator?.vatNumber || '—'
    const rows = groups.map(g => `
      <tr>
        <td>${esc(labelFor(g))}</td>
        <td class="num">${g._count._all}</td>
        <td class="num">${eur(g._sum.grossAmount ?? 0)}</td>
        <td class="num">${eur(g._sum.applicationFeeAmount ?? 0)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Facture ${esc(invoice.number)} — Grubano</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a2e;
         margin: 0; background: #f6f6f8; }
  .sheet { max-width: 760px; margin: 24px auto; background: #fff; padding: 48px;
           border-radius: 12px; box-shadow: 0 2px 12px rgba(26,26,46,.08); }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .brand { font-size: 22px; font-weight: 800; color: #F97316; }
  .doc h1 { font-size: 18px; margin: 0 0 4px; text-align: right; }
  .doc p  { margin: 0; font-size: 13px; color: #555; text-align: right; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
  .party { font-size: 13px; line-height: 1.5; }
  .party h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #888; margin: 0 0 6px; }
  .party strong { display: block; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
       color: #888; border-bottom: 2px solid #1a1a2e; padding: 8px 6px; }
  td { padding: 10px 6px; border-bottom: 1px solid #eee; }
  .num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-left: auto; width: 280px; font-size: 14px; margin-top: 16px; }
  .totals td { padding: 6px; border: none; }
  .totals .grand td { font-weight: 800; font-size: 16px; border-top: 2px solid #1a1a2e; }
  .mention { margin-top: 28px; padding: 14px 16px; background: #fff7ed; border-left: 3px solid #F97316;
             font-size: 12.5px; line-height: 1.55; }
  .drift { margin-top: 12px; font-size: 12px; color: #b45309; }
  footer { margin-top: 36px; font-size: 11px; color: #888; line-height: 1.6; }
  .print { margin: 16px auto; max-width: 760px; text-align: right; }
  .print button { background: #1a1a2e; color: #fff; border: 0; border-radius: 8px;
                  padding: 10px 18px; font-size: 13px; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; border-radius: 0; max-width: none; }
    .print { display: none; }
  }
</style>
</head>
<body>
  <div class="print"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="sheet">
    <header>
      <div class="brand">GRUBANO</div>
      <div class="doc">
        <h1>FACTURE ${esc(invoice.number)}</h1>
        <p>Émise le ${dateFr(invoice.issuedAt)}</p>
        <p>Période : du ${dateFr(invoice.periodStart)} au ${dateFr(new Date(invoice.periodEnd.getTime() - 1))}</p>
      </div>
    </header>

    <div class="parties">
      <div class="party">
        <h2>Émetteur</h2>
        <strong>${esc(issuer.name)}</strong>
        ${esc(issuer.address)}<br>
        SIREN : ${esc(issuer.siren)}<br>
        TVA intracommunautaire : ${esc(issuer.vat)}
      </div>
      <div class="party">
        <h2>Destinataire</h2>
        <strong>${esc(restaurant.name)}</strong>
        ${esc(restaurant.address ?? '')}<br>
        ${esc(restaurant.city ?? '')}<br>
        N° TVA intracommunautaire : ${esc(partnerVat)}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Canal</th>
          <th class="num">Opérations</th>
          <th class="num">Encaissements</th>
          <th class="num">Commission prélevée (TTC)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="totals">
      <tr><td>Total HT</td><td class="num">${eur(invoice.totalHt)}</td></tr>
      <tr><td>TVA ${vatPct} %</td><td class="num">${eur(invoice.totalTva)}</td></tr>
      <tr class="grand"><td>Total TTC</td><td class="num">${eur(invoice.totalTtc)}</td></tr>
    </table>

    <div class="mention">
      <strong>Commission de service prélevée à la source sur vos encaissements — facture acquittée.</strong><br>
      Le montant TTC ci-dessus a déjà été retenu sur les paiements qui vous ont été reversés
      sur la période : aucun règlement n'est attendu. ${invoice.entriesCount} opération(s) couverte(s) par cette facture.
    </div>
    ${drifted ? `<p class="drift">Note : des écritures ont été ajoutées au registre après l'émission
      (détail affiché : ${eur(detailFeeSum)} — total facturé : ${eur(invoice.totalTtc)}). Les totaux
      facturés font foi ; l'écart sera repris sur la facture suivante.</p>` : ''}

    <footer>
      Facture établie par ${esc(issuer.name)} pour le compte de la plateforme Grubano.
      Numérotation continue ${esc(invoice.number)} — document généré électroniquement, valable sans signature.
      TVA sur les services de commission au taux normal de ${vatPct} %.
    </footer>
  </div>
</body>
</html>`

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    console.error('[invoice render]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
