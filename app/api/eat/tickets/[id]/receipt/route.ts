import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { reservationCode } from '@/lib/reservation-code'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/eat/tickets/[id]/receipt — Mission AU ─────────────────────────────
// DONNÉES du reçu post-paiement dine-in pour la surface privée /eat/receipt/[id].
// JSON brut : les LIBELLÉS vivent côté page (i18n ×5) — contrairement au PDF de
// la mission AR (document FR), la surface HTML est traduite.
//
// Gardes = patron AR REPRIS À L'IDENTIQUE (ordre inclus — propriété AVANT
// statut, pour qu'un tiers n'apprenne jamais si l'addition est payée) :
//   401 sans session → 404 ticket inexistant → 404 walk-in (reservationId est
//   un SCALAIRE sans relation Prisma : la propriété se juge en DEUX requêtes)
//   → 404 rattachement pendu → 403 non-propriétaire → 409 non payée.
// walk-in / inexistant / pendu = MÊME réponse (rien n'est révélé).
//
// Données : lignes/subtotal/amountPaid/paidAt/currency = HISTORIQUES (gelées au
// paiement) ; nom/adresse/table lus par relation = ACTUELS (la page l'annonce).
// amountPaid n'est JAMAIS recalculé ici. Select étroit de la mission AR : les
// notes/allergies/addedBy de ticketHistorySelect n'entrent pas ; AUCUN
// identifiant Stripe ni technique ne traverse cette route.

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = await getToken({ req })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    const ticket = await prisma.tableTicket.findUnique({
      where: { id: params.id },
      select: {
        status:   true,
        currency: true,
        subtotal: true,     // total STOCKÉ (gelé au paiement) — jamais recalculé
        amountPaid: true,   // montant de référence — jamais recalculé
        paidAt:   true,
        reservationId: true,
        items: {
          where:   { status: 'active' },
          select:  { name: true, unitPrice: true, quantity: true },
          orderBy: { createdAt: 'asc' },
        },
        restaurant: {
          select: {
            name: true, address: true, city: true,
            operator: { select: { officialName: true } }, // NULLABLE — jamais de placeholder
          },
        },
        restaurantTable: { select: { name: true } },
      },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    }
    // Walk-in : aucun rattachement conso → aucun accès privé, par construction.
    if (!ticket.reservationId) {
      return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    }
    const reservation = await prisma.reservation.findUnique({
      where:  { id: ticket.reservationId },
      select: { userId: true },
    })
    if (!reservation) {
      return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    }
    if (!reservation.userId || reservation.userId !== token.sub) {
      return NextResponse.json(
        { error: 'Cette addition n’est pas liée à votre compte.' },
        { status: 403 },
      )
    }
    if (ticket.status !== 'paid') {
      return NextResponse.json(
        { error: 'Addition non payée — aucun reçu disponible.' },
        { status: 409 },
      )
    }
    // Un ticket 'paid' porte toujours amountPaid + paidAt (écrits ensemble par
    // le webhook). Anomalie → refus honnête : on n'invente ni montant ni date.
    if (ticket.amountPaid == null || !ticket.paidAt) {
      console.error(`[receipt] [AU] ticket ${params.id} payé mais amountPaid/paidAt manquant — reçu refusé`)
      return NextResponse.json(
        { error: 'Reçu indisponible pour cette addition — le support peut vérifier le paiement.' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      receipt: {
        paidAt:      ticket.paidAt.toISOString(), // HISTORIQUE
        amountPaid:  ticket.amountPaid,           // référence, telle qu'en base
        subtotal:    ticket.subtotal,             // total STOCKÉ des consommations
        currency:    ticket.currency,
        lines:       ticket.items,                // name/unitPrice/quantity GELÉS
        sessionCode: reservationCode(ticket.reservationId),
        // ACTUELS (relations) — la page les présente comme tels.
        restaurantName: ticket.restaurant.name,
        officialName:   ticket.restaurant.operator?.officialName ?? null,
        address:        ticket.restaurant.address ?? null,
        city:           ticket.restaurant.city ?? null,
        tableName:      ticket.restaurantTable.name ?? null,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    console.error('[GET /api/eat/tickets/[id]/receipt]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
