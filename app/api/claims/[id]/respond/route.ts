import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { respondToClaim } from '@/lib/claims'
import { claimsSurfaceOpen, claimNoticeGate } from '@/lib/claim-flags'
import { prisma } from '@/lib/prisma'
import { sendClaimDecisionEmail } from '@/lib/claim-emails'
import { restaurantClaimStatus, type ClaimFacts } from '@/lib/claim-action-rules'
import { orderRef } from '@/lib/order-ref'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/claims/[id]/respond (P4.5-C1 · P0-24) ───────────────────────────────
// The owning restaurant accepts or refuses a claim. Gated by CLAIMS_ENABLED.
// Owner-scoped via the establishment scope → a claim on another operator's order is
// INVISIBLE (404, not 403 — no IDOR/enumeration).
// P0-24 (Q3 volet 2) : ACCEPT ne déclenche PLUS aucun remboursement — il route la
// réclamation vers la FILE ADMIN ('arbitration') où seul un admin Grubano décide et
// déclenche (POST /api/admin/claims/[id]/arbitrate). `refund` est donc toujours null
// sur un accept. REFUSE → terminal 'refused' + motive (contest = C2).
const bodySchema = z.object({
  action: z.enum(['accept', 'refuse']),
  reason: z.string().max(1000).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!claimsSurfaceOpen()) { // D′ L1: SURFACE
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const result = await respondToClaim({
    claimId:       params.id,
    restaurantIds: scope.ownedIds,
    action:        parsed.data.action,
    reason:        parsed.data.reason,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // ── T43 (vague 3) — notification de DÉCISION au client, post-succès, BEST-
  // EFFORT. Additif : la transition (P0-24 accept → arbitration / refuse →
  // refused) est INTOUCHÉE ; l'email dit CE QUI a été décidé et PAR QUI (le nom
  // du restaurant). Idempotent (trigger claim_decision_<décision>, dedupeKey
  // claim:<id>) — rejouer la même décision ne renvoie rien.
  {
    const c = result.claim as { id: string; consumerId: string; orderId: string; restaurantId: string }
    let restaurantName: string | null = null
    try {
      const resto = await prisma.restaurant.findUnique({ where: { id: c.restaurantId }, select: { name: true } })
      restaurantName = resto?.name ?? null
    } catch { /* best-effort — le sender a un libellé de repli */ }
    await sendClaimDecisionEmail({
      claimId:        c.id,
      consumerId:     c.consumerId,
      orderId:        c.orderId,
      decision:       parsed.data.action === 'accept' ? 'accepted' : 'refused',
      reason:         parsed.data.reason ?? null,
      restaurantName,
      // ROUND 13 (H02, R-D7): the lease read at send time — one that closed since the entry gate skips the e-mail.
      claimsOpen:     claimNoticeGate('pre_money'), // D′ L1 (FIN-EMAIL-01): a restaurant decision is a pre-money notice
    })
  }

  // ── D′ L8 (S-19) — WHAT COMES BACK IS BUILT, NOT FORWARDED ──────────────────────────────────────
  //
  // This line used to be `claim: result.claim`, and `respondToClaim` returns
  // `prisma.claim.findUnique({ where: { id } })` with no `select` — so answering a claim handed the
  // restaurant the WHOLE row: `consumerId`, `refundError`, `refundId`, `activeOrderKey`, `arbitratedBy`,
  // `contestReason`, `Claim.selection`, every arbitration field. It was the same leak as the list, on the
  // one endpoint a restaurant hits deliberately, and the panel never read any of it.
  //
  // Four fields, each assigned by name. The derived status uses UNREAD row facts (`null, null`) on
  // purpose: a claim that has just been answered has no refund bound, and a response is not the place to
  // assert anything about money. `refund` stays in the shape and stays null — P0-24 means accepting a
  // claim triggers NOTHING, and the panel's « remboursement en attente » branch has been unreachable
  // since (recorded as T-65); removing the key would be a silent contract change for no gain.
  // Defensive on the two derivations, because this block runs AFTER the write has succeeded: a throw here
  // would answer 500 on a response that WAS recorded, and the restaurant would answer again (and get 409).
  const answered = result.claim as { id: string; orderId?: string | null; status?: string; restaurantResponse?: string | null; decidedAt?: Date | string | null; refundError?: string | null; refundId?: string | null; refundAttempted?: boolean; arbitrationDecision?: string | null }
  const decidedAt = answered.decidedAt instanceof Date ? answered.decidedAt.toISOString()
    : typeof answered.decidedAt === 'string' ? answered.decidedAt : null
  return NextResponse.json({
    claim: {
      id:                 answered.id,
      orderRef:           typeof answered.orderId === 'string' ? orderRef(answered.orderId) : null,
      status:             restaurantClaimStatus(answered as ClaimFacts, null, null),
      restaurantResponse: answered.restaurantResponse === 'accepted' || answered.restaurantResponse === 'refused'
        ? answered.restaurantResponse : null,
      decidedAt,
      // The respond route has just consumed the only state it accepts, so it would refuse a second answer.
      canRespond:         false,
    },
    refund: result.refund ?? null,
  })
}
