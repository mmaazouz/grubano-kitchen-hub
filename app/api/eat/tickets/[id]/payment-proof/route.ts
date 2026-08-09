import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { reservationCode } from '@/lib/reservation-code'
import { buildPaymentProofView, renderPaymentProofPdf, isPrintable } from '@/lib/payment-proof-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/eat/tickets/[id]/payment-proof — Mission AR ────────────────────────
// Justificatif de paiement (PDF) d'une addition PAYÉE, réservé au CONSOMMATEUR
// propriétaire de la réservation liée. Périmètre fermé : consultation /
// téléchargement d'une preuve de paiement, rien d'autre.
//
// Propriété — patron RÉUTILISÉ (même chaîne que /api/eat/orders et
// /api/reservations/[id]/cancel) : TableTicket.reservationId → Reservation.userId
// === token.sub. Un ticket walk-in (reservationId null) n'appartient à personne
// côté conso → 404 (la vue privée n'est pas servie, décision établie ; /eat ne
// lui expose d'ailleurs aucun point d'entrée).
//
// Données : lignes/quantités/prix/subtotal/amountPaid/paidAt = HISTORIQUES
// (gelés au paiement — vérifié missions AM/AO/AP) ; nom/adresse/table = lus par
// relation, donc ACTUELS — le document les présente comme tels (date d'édition
// distincte + mention). amountPaid n'est JAMAIS recalculé ici.
// AUCUN identifiant Stripe ne traverse cette route (jamais sélectionné).
//
// Échec de génération : AUCUN fichier produit — erreur JSON propre, le client
// affiche une notice avec des issues réelles (réessayer / support).

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
        // ⚠️ reservationId est un SCALAIRE sans relation Prisma (« best-effort »,
        // cf. schéma) — la propriété se vérifie en DEUX temps, exactement comme
        // /api/eat/orders (prémisse « relation » invalidée par tsc, corrigée).
        reservationId: true,
        // Lignes ACTIVES uniquement (ce qui a été facturable), champs GELÉS
        // name/unitPrice/quantity. Volontairement PAS ticketHistorySelect : son
        // itemSelect embarque notes/allergies/addedBy (exclus du document) et
        // les lignes annulées (hors du montant payé).
        items: {
          where:   { status: 'active' },
          select:  { name: true, unitPrice: true, quantity: true },
          orderBy: { createdAt: 'asc' },
        },
        // Coordonnées ACTUELLES (relation) — présentées comme telles.
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
    // Walk-in : aucun rattachement conso → la vue privée n'est pas servie.
    if (!ticket.reservationId) {
      return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    }
    const reservation = await prisma.reservation.findUnique({
      where:  { id: ticket.reservationId },
      select: { userId: true },
    })
    // Rattachement pendu (réservation disparue) → personne ne peut prouver la
    // propriété : même réponse que le walk-in, rien n'est révélé.
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
        { error: 'Addition non payée — aucun justificatif disponible.' },
        { status: 409 },
      )
    }
    // Un ticket 'paid' porte toujours amountPaid + paidAt (écrits ensemble par le
    // webhook). Si une ligne historique anormale les a perdus : AUCUN fichier,
    // erreur honnête tracée — on n'invente ni montant ni date (règles 1 et 3).
    if (ticket.amountPaid == null || !ticket.paidAt) {
      console.error(`[payment-proof] [AR] ticket ${params.id} payé mais amountPaid/paidAt manquant — aucun document produit`)
      return NextResponse.json(
        { error: 'Justificatif indisponible pour cette addition — le support peut vérifier le paiement.' },
        { status: 500 },
      )
    }

    // Garde d'imprimabilité (revue adversariale) : la police WinAnsi du patron
    // ne rend pas l'arabe/CJK — un nom d'établissement ou de plat entièrement
    // non latin serait imprimé VIDE en silence. Un document amputé ne sort
    // JAMAIS : refus honnête, aucun fichier (règle 16).
    if (!isPrintable(ticket.restaurant.name) || ticket.items.some((i) => !isPrintable(i.name))) {
      console.error(`[payment-proof] [AR] ticket ${params.id} — libellé non imprimable (police Latin-1), aucun document produit`)
      return NextResponse.json(
        { error: 'Le justificatif n’a pas pu être généré pour cette addition — le support peut fournir la preuve du paiement.' },
        { status: 500 },
      )
    }

    const view = buildPaymentProofView({
      paidAt:      ticket.paidAt,
      amountPaid:  ticket.amountPaid,
      subtotal:    ticket.subtotal,
      currency:    ticket.currency,
      lines:       ticket.items,
      sessionCode: reservationCode(ticket.reservationId),
      // Relations OBLIGATOIRES au schéma → jamais de placeholder (règle 12 ; le
      // « ?? '—' » initial était littéralement le placeholder interdit).
      restaurantName: ticket.restaurant.name,
      officialName:   ticket.restaurant.operator?.officialName ?? null,
      address:        ticket.restaurant.address ?? null,
      city:           ticket.restaurant.city ?? null,
      tableName:      ticket.restaurantTable.name ?? null,
      editedAt:       new Date(),
    })
    const pdf = await renderPaymentProofPdf(view)

    // Nom de fichier : date de paiement (repère humain) — aucune numérotation.
    // Europe/Paris comme le corps du document (revue : l'UTC datait de la
    // veille tout paiement de 00:00-02:00 heure de Paris).
    const d = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(ticket.paidAt)
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="justificatif-paiement-${d}.pdf"`,
        'Cache-Control':       'private, no-store',
      },
    })
  } catch (err) {
    // Échec de génération → AUCUN fichier (règle 16), erreur tracée.
    console.error('[GET /api/eat/tickets/[id]/payment-proof]', err)
    return NextResponse.json(
      { error: 'Le justificatif n’a pas pu être généré — aucun fichier n’a été créé. Réessayez.' },
      { status: 500 },
    )
  }
}
