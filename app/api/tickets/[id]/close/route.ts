import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketSelect } from '@/lib/ticket'
import { releaseHold, captureHold } from '@/lib/deposit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/tickets/[id]/close ──────────────────────────────────────────────
// Owner-scoped TABLE CLOSURE with a traced reason. Closes an OPEN ticket WITHOUT
// ever deleting its lines (decision T1.Q2 / T5: keep the proof of what was ordered).
//
//   reason:
//     • 'unpaid' → 'void_unpaid' : the client LEFT WITHOUT PAYING. items+subtotal
//       are KEPT as the record of the unpaid amount. This is also where the operator
//       decides what to do with the guarantee empreinte (capture / waive) — see the
//       EMPREINTE HOOK below (Agent 14, étape 2).
//     • 'empty'  → 'void_empty'  : an empty addition (no items) released to free the
//       table for the next service.
//     • 'manual' → 'void_manual' : the operator deliberately cancels the addition.
//
// The PAID case needs NO endpoint: the bill payment webhook (Agent 14) sets
// status='paid', after which the table simply has no open ticket → it is free for
// the next service. Closing a PAID ticket here is refused (409).
//
// `deposit` is the operator's empreinte choice carried for étape 2 — Agent 2 does
// NOT act on it (capture/release lives in lib/deposit = Agent 14). It is parsed,
// echoed in the response, and the linked reservation's empreinte info is resolved
// so Agent 14 can branch capture/release at the clearly-marked hook with no rework.
const closeSchema = z.object({
  reason:  z.enum(['unpaid', 'empty', 'manual']),
  deposit: z.enum(['capture', 'release', 'none']).optional(),
})

const REASON_TO_CLOSED: Record<z.infer<typeof closeSchema>['reason'], string> = {
  unpaid: 'void_unpaid',
  empty:  'void_empty',
  manual: 'void_manual',
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { reason, deposit } = closeSchema.parse(await req.json())

    const existing = await prisma.tableTicket.findUnique({
      where:  { id: params.id },
      select: { id: true, restaurantId: true, status: true, reservationId: true, subtotal: true },
    })
    if (!existing) return NextResponse.json({ error: 'Addition introuvable' }, { status: 404 })
    if (!scope.ownedIds.includes(existing.restaurantId)) {
      return NextResponse.json({ error: 'Addition non autorisée' }, { status: 403 })
    }
    if (existing.status === 'paid') {
      return NextResponse.json({ error: 'Addition déjà payée — la table est déjà libérée.' }, { status: 409 })
    }
    if (existing.status === 'void') {
      return NextResponse.json({ error: 'Addition déjà clôturée.' }, { status: 409 })
    }

    // Close the ticket: void + traced reason + closedAt. Items/subtotal are KEPT.
    const ticket = await prisma.tableTicket.update({
      where:  { id: params.id },
      data:   { status: 'void', closedReason: REASON_TO_CLOSED[reason], closedAt: new Date() },
      select: ticketSelect,
    })

    // Resolve the linked reservation's empreinte info for the hook below / response.
    const reservation = existing.reservationId
      ? await prisma.reservation.findUnique({
          where:  { id: existing.reservationId },
          select: { id: true, stripePaymentIntentId: true, depositStatus: true, depositAmount: true, noShowPenalty: true },
        })
      : null

    // ── EMPREINTE HOOK — Agent 14, étape 2 (WIRED) ──────────────────────────────
    // On an UNPAID walk-out the operator KEEPS the guarantee (capture = penalty) or
    // WAIVES it (release = nothing charged). Stripe is the source of truth: both
    // settles read the LIVE manual-capture PI (reservation.stripePaymentIntentId).
    //   • 'capture' → captureHold(pi, noShowPenalty, depositAmount) — the penalty
    //     defaults to noShowPenalty (or the full depositAmount when penalty is 0,
    //     per lib/deposit), capped at what Stripe actually authorised.
    //   • 'release' → releaseHold(pi) — authorisation cancelled, nothing charged.
    //   • 'none' / undefined → the hold is left untouched.
    // The ticket closure + trace ABOVE are already committed — this block NEVER
    // throws past them: any Stripe/DB failure is caught, logged, and surfaced in
    // deposit.settled.error while the ticket stays void/traced. capturedAmount is
    // in CENTS (same unit as the dedicated /deposit/capture endpoint). Idempotent:
    // lib/deposit treats an already-canceled release / already-captured capture
    // as success, and conflicting states come back as a clean error.
    let depositSettled: { depositStatus?: string; capturedAmount?: number; error?: string } | null = null
    if (deposit === 'capture' || deposit === 'release') {
      if (!reservation?.stripePaymentIntentId) {
        depositSettled = { error: 'Aucune empreinte à régler pour cette addition.' }
      } else {
        try {
          const settle = deposit === 'capture'
            ? await captureHold(reservation.stripePaymentIntentId, reservation.noShowPenalty, reservation.depositAmount)
            : await releaseHold(reservation.stripePaymentIntentId)
          if (settle.ok) {
            const newStatus = settle.depositStatus ?? (deposit === 'capture' ? 'captured' : 'released')
            await prisma.reservation.update({
              where: { id: reservation.id },
              data:  {
                depositStatus: newStatus,
                ...(newStatus === 'captured' ? { depositPaid: true } : {}),
              },
            })
            depositSettled = {
              depositStatus: newStatus,
              ...(settle.capturedAmount != null ? { capturedAmount: settle.capturedAmount } : {}),
            }
          } else {
            console.warn(`[close] empreinte settle refused (${settle.status}): ${settle.error} — ticket ${ticket.id}`)
            depositSettled = { error: settle.error }
          }
        } catch (e) {
          console.error('[close] empreinte settle failed', e instanceof Error ? e.message : e)
          depositSettled = { error: 'Erreur paiement — empreinte non réglée, à traiter manuellement.' }
        }
      }
    }

    // Terminal reservation transition (fix "session collée"): closing the table
    // ends the session, so move the linked reservation arrived→completed — else it
    // stays 'arrived' and keeps resurfacing in GET /api/eat/my-session. Applies to
    // ALL close reasons (unpaid/empty/manual). updateMany with a status:'arrived'
    // guard is atomic + idempotent and never overwrites noshow/cancelled/confirmed.
    // Best-effort: the closure + trace above must succeed even if this fails.
    if (existing.reservationId) {
      try {
        await prisma.reservation.updateMany({
          where: { id: existing.reservationId, status: 'arrived' },
          data:  { status: 'completed' },
        })
      } catch (e) {
        console.error('[close] reservation complete failed', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({
      ticket,
      closedReason: REASON_TO_CLOSED[reason],
      // Empreinte settle outcome. `choice` is what the operator asked; `settled`
      // is null when choice='none', else { depositStatus, capturedAmount? (cents) }
      // on success or { error } when the settle was refused/failed (ticket stays
      // closed either way).
      deposit: {
        choice:                deposit ?? 'none',
        reservationId:         reservation?.id ?? null,
        stripePaymentIntentId: reservation?.stripePaymentIntentId ?? null,
        depositStatus:         reservation?.depositStatus ?? null,
        depositAmount:         reservation?.depositAmount ?? null,
        noShowPenalty:         reservation?.noShowPenalty ?? null,
        settled:               depositSettled,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/tickets/[id]/close]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
