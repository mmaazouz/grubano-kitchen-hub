import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { ticketSelect } from '@/lib/ticket'

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

    // ── EMPREINTE HOOK — Agent 14, étape 2 ──────────────────────────────────────
    // On an UNPAID walk-out the operator may KEEP the guarantee (capture) or WAIVE it
    // (release). Everything needed is in `reservation`: the manual-capture empreinte
    // is reservation.stripePaymentIntentId, with depositAmount + noShowPenalty.
    // Branch on `deposit` and call lib/deposit:
    //   • 'capture' → captureHold(reservation.stripePaymentIntentId, noShowPenalty, depositAmount)
    //   • 'release' → releaseHold(reservation.stripePaymentIntentId)
    //   • 'none' / undefined → leave the hold as-is (current étape-1 behaviour)
    // Then persist reservation.depositStatus from the SettleResult and set
    // `depositSettled` to that result. DO NOT change the ticket close above (the
    // closure must succeed even if the empreinte settle fails — wrap in try/catch
    // and surface the outcome, never throw past the close). Agent 2 leaves this a
    // no-op so the closure + trace already work end-to-end before étape 2.
    const depositSettled: { depositStatus?: string; capturedAmount?: number } | null = null
    // (Agent 14 fills `depositSettled` here.)

    return NextResponse.json({
      ticket,
      closedReason: REASON_TO_CLOSED[reason],
      // Empreinte hook contract for Agent 14. `choice` is what the operator asked;
      // `settled` is null until étape 2 wires capture/release.
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
