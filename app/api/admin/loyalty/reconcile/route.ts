import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveAdmin } from '@/lib/admin-guard'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'
import { replayLoyaltyProrata } from '@/lib/loyalty-prorata'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/loyalty/reconcile (D′ L6 · D-15, LOYALTY-REFUND-CONTRACT §24 (5)) ─────────────
//
// THE REPAIR PATH, and the only one. A refund can land BEFORE an order is delivered; at the delivered
// transition the earning is credited and then its refund prorata is replayed. If that replay fails — the
// database blinked, a lock timed out — the transition still succeeds, because a delivery that happened is
// never rolled back for a points reconciliation. The customer is then over-credited by a known amount, an
// alert names the order, and THIS route settles it.
//
// WHAT IT DOES: exactly the replay the delivered transition runs, on the same DB-known refund set, with the
// same rounding rule and the same idempotency key (the Stripe `re_`). Replaying an order that is already
// settled writes nothing — the unique `(re_, type)` makes every effect a no-op — so it is safe to call
// twice, or on an order that never needed it.
//
// WHAT IT NEVER DOES: no Stripe call of any kind; no cash; no claim; no order field. It moves POINTS, and
// only by replaying a plan derived from refunds the database already proves. It is NOT gated by any claims
// or refunds flag: a customer's points being wrong is not a feature to be switched on, and refusing to fix
// it because a beta flag is off would leave a known error standing.
const bodySchema = z.object({ orderId: z.string().min(1) }).strict()

export async function POST(req: Request) {
  // Flag-gated rate limit (no-op when RATE_LIMIT_ENABLED is off).
  const limited = rateLimit(req, 'admin_loyalty_reconcile', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  // A named admin, over the live role set — the same guard every admin claims route uses.
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide (orderId requis).' }, { status: 400 })
  const { orderId } = parsed.data

  // `notifyOnFailure: false` — the alert already exists for this order (it is why an admin is here). A
  // second one on a failed repair would add noise to a thread that is already open; the answer below says
  // it failed, and the log keeps the marker.
  const outcome = await replayLoyaltyProrata(prisma, orderId, { via: 'admin_repair', notifyOnFailure: false })

  await recordAdminAudit({
    actorId:    operator.id,
    actorEmail: operator.email,
    action:     'loyalty.reconcile',
    targetType: 'order',
    targetId:   orderId,
    metadata:   outcome.ok
      ? outcome.replayed
        ? {
            replayed: true, moneyMoved: false,
            knownRefunds:    outcome.set.refunds.length,
            chargeSource:    outcome.set.chargeSource,
            chargeAmountCents: outcome.set.chargeAmountCents,
            applied:         outcome.result.applied,
            skipped:         outcome.result.skipped,
            earnReversed:    outcome.result.earnReversed,
            spentRestored:   outcome.result.spentRestored,
            offsetAdded:     outcome.result.offsetAdded,
            grandfathered:   outcome.result.grandfathered,
            /** A gap against the §9 target for the set now known — reported, never silently repaired. */
            drift:           outcome.drift ? `booked ${outcome.drift.bookedEarnReversal} ≠ cible ${outcome.drift.targetEarnReversal}` : null,
          }
        : { replayed: false, moneyMoved: false, reason: outcome.reason }
      /**
       * NOT « replayed: false ». The reconciliation commits one transaction per effect, so a failure can
       * leave part of the plan applied; the audit trail records what was measured, not an assumption.
       */
      : {
          replayed: 'partial', moneyMoved: false, error: outcome.error.slice(0, 200),
          appliedEarnReversalRows: outcome.applied ? outcome.applied.earnReversal : null,
          appliedRefundRows:       outcome.applied ? outcome.applied.refund : null,
        },
    req,
  })

  if (!outcome.ok) {
    // The replay applies its plan one transaction per effect, so a failure part-way leaves the earlier
    // effects COMMITTED. Telling an admin « nothing was written » here would be false, and would invite a
    // manual correction on top of rows that already exist. Replaying is safe — the unique `(re_, type)`
    // makes every applied effect a no-op — so the honest answer is: some of it may be done, call it again.
    const wrote = outcome.applied
    return NextResponse.json({
      error: wrote && (wrote.earnReversal > 0 || wrote.refund > 0)
        ? `La réconciliation fidélité s'est interrompue APRÈS avoir écrit une partie du plan (${wrote.earnReversal} reprise(s) de points gagnés, ${wrote.refund} restitution(s)). Rappelez cette route : les effets déjà appliqués ne seront pas rejoués.`
        : wrote
          ? 'La réconciliation fidélité n’a pas abouti et n’a rien écrit lors de cette tentative ; réessayez.'
          : 'La réconciliation fidélité n’a pas abouti. Ce qui a été écrit n’a pas pu être mesuré — rappelez cette route (les effets déjà appliqués ne sont jamais rejoués) et vérifiez le solde.',
      reason: 'reconcile_failed',
      /**
       * Rows written by THIS attempt, or null when the count itself could not be read. Named `appliedRows`
       * and not `applied`: on a 200, `applied` is the NUMBER of effects the plan applied, and two different
       * shapes under one name is how a client ends up reading a count as an object.
       */
      appliedRows: wrote,
    }, { status: 500 })
  }
  if (!outcome.replayed) {
    // Not a failure: there was nothing to prorate. Said as what it is.
    return NextResponse.json({
      ok: true, replayed: false, reason: outcome.reason,
      message: outcome.reason === 'no_order'
        ? 'Commande introuvable : rien n’a été réconcilié.'
        : 'Aucun remboursement connu sur cette commande : les points restent entiers, rien n’a été écrit.',
    })
  }
  return NextResponse.json({
    ok: true,
    replayed: true,
    /** 0 applied with a non-empty set ⇒ the order was already settled: the replay is a no-op, not a failure. */
    applied:       outcome.result.applied,
    skipped:       outcome.result.skipped,
    earnReversed:  outcome.result.earnReversed,
    spentRestored: outcome.result.spentRestored,
    offsetAdded:   outcome.result.offsetAdded,
    grandfathered: outcome.result.grandfathered,
    knownRefunds:  outcome.set.refunds.length,
    chargeAmountCents: outcome.set.chargeAmountCents,
    /**
     * Non-null ⇒ the replay ran, but the booked total does not match §9 for the refund set now visible: a
     * delta was frozen against a different set (see lib/loyalty-prorata header). Nothing is rewritten here
     * — the gap is at most one point per refund event and its resolution is a contract decision.
     */
    drift:         outcome.drift,
    /** 'order_total' ⇒ no ledger payment line was found: the denominator is derived, and it is named as such. */
    chargeSource:  outcome.set.chargeSource,
  })
}
