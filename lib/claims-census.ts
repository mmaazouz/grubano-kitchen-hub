// lib/claims-census.ts — T-49 round 13, slice W5: I-06 / H16 census counts (legacy and closure populations).
//
// COUNTS ONLY: every field is an integer, or null when its own read threw (never 0 on a failure). Each field has its own
// catch, so one failed query nulls only the fields that depend on it. All reads are Prisma (no raw SQL), no Stripe, no
// write. scripts/server/phase2-claims-gate.js computes the same counts on its own DB handle (I-07); a parity test runs
// both on one fixture (tests/claims-t49-round13-census.test.ts).
//
// NOT COUNTED: E-09 (a settled claim on a succeeded row whose Stripe failure event was lost) — it needs a Stripe read.
// AMF-1's bounded re-verification (POST /api/admin/claims/reconcile-refunds) reads it instead.
import { prisma } from '@/lib/prisma'
import { VOID_KEY_MARK } from '@/lib/refund-void-state'
import { RESUME_CREATE_WINDOW_MS } from '@/lib/refund'
import { isAdminAuditEnabled } from '@/lib/admin-audit'
import {
  TERMINAL, MARKERS, claimClosureKind, CLOSURE_TRIGGER, CLOSURE_RECORD_TRIGGER, closureRecordKey, refundedRowProven, type ClosureKind,
} from '@/lib/claim-action-rules'

export type ClaimsLegacyCensus = {
  legacyPayableProofs: number | null
  refundedBoundToFailedRow: number | null
  refundedRowUnproven: number | null
  ownRowResumeMismatch: { nonTerminal: number | null; terminal: number | null }
  terminalDeclarationWithArbitrationReason: number | null
  refundedAfterContradictionAttribution: number | null
  refundedBoundToOtherClaimStamp: number | null
  rowsBoundToMultipleClaims: number | null
  pendingRowsOver20hWithSettledRoyalty: number | null
  approvedUnpaid: number | null
  /** MODE B commit B — lignes LIBEREES (prouvees jamais etablies chez Stripe) : une mesure, pas une simple alerte. */
  voidedRefundRows: number | null
}
export type ClaimsClosureCensus = { missing: number | null; terminalWithoutRecord: number | null }

/** One field: an integer, or null when the read threw or did not produce an integer. */
async function measure(field: string, read: () => Promise<number>): Promise<number | null> {
  try {
    const n = await read()
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null
  } catch (e) {
    console.error('[claims census] ' + field + ' NOT MEASURED —', e instanceof Error ? e.message : e)
    return null
  }
}

const RESUME_MISMATCH_PREFIX = 'resume_mismatch'
/** Track B §M: the sendOnce record of the claim_financial_verification alert for a contradiction park (lib/admin-alerts). */
const CONTRADICTION_PARK_TRIGGER = 'admin_money_review_claim_financial_verification'
const CONTRADICTION_PARK_KEY_HEAD = 'claim_fv:'
const CONTRADICTION_PARK_KEY_TAIL = ':stripe_refund_contradiction'

/** I-06 claims.legacy. */
export async function claimsLegacyCensus(now: Date = new Date()): Promise<ClaimsLegacyCensus> {
  const [
    legacyPayableProofs, refundedBoundToFailedRow, refundedRowUnproven, ownRows, terminalDeclarationWithArbitrationReason,
    refundedAfterContradictionAttribution, refundedBoundToOtherClaimStamp, rowsBoundToMultipleClaims, pendingRowsOver20hWithSettledRoyalty, approvedUnpaid, voidedRefundRows,
  ] = await Promise.all([
    // A-S32-*: a pre-v13 proof of absence (approval suspended, D14 (1)).
    measure('legacyPayableProofs', () => prisma.claim.count({
      where: { status: 'approved', refundError: { startsWith: `${MARKERS.NO_REFUND_PROVEN}:` }, NOT: { refundError: { startsWith: MARKERS.PROOF_PAYABLE_V13 } } },
    })),
    // E-07 A-S31c: a settled claim on a row FAILED with a Stripe id, not yet marked.
    measure('refundedBoundToFailedRow', async () => {
      const ids = (await prisma.refund.findMany({ where: { status: 'failed', stripeRefundId: { not: null } }, select: { id: true } })).map((r) => r.id)
      return ids.length ? prisma.claim.count({ where: { status: 'refunded', refundError: null, refundId: { in: ids } } }) : 0
    }),
    // E-13 (H10 / F03-false, excluding A-S31c).
    measure('refundedRowUnproven', async () => {
      const claims = await prisma.claim.findMany({ where: { status: 'refunded', refundError: null }, select: { id: true, orderId: true, refundId: true } })
      const refundIds = claims.map((c) => c.refundId).filter((x): x is string => !!x)
      const rows = refundIds.length
        ? await prisma.refund.findMany({ where: { id: { in: refundIds } }, select: { id: true, orderId: true, status: true, stripeRefundId: true, amountCents: true } })
        : []
      const byId = new Map(rows.map((r) => [r.id, r]))
      return claims.filter((c) => {
        const row = c.refundId ? byId.get(c.refundId) ?? null : null
        const failedWithIdOwnOrder = !!row && row.orderId === c.orderId && row.status === 'failed' && !!row.stripeRefundId
        return !refundedRowProven(row, c.orderId) && !failedWithIdOwnOrder
      }).length
    }),
    // E-05 / E-14: a resume_mismatch on the claim's OWN stamped row, split by terminal status (one read, both fields).
    (async () => {
      try {
        const claims = await prisma.claim.findMany({ where: { refundError: { startsWith: RESUME_MISMATCH_PREFIX }, refundId: { not: null } }, select: { id: true, status: true, refundId: true } })
        const ids = claims.map((c) => c.refundId as string)
        const rows = ids.length ? await prisma.refund.findMany({ where: { id: { in: ids } }, select: { id: true, reason: true } }) : []
        const reason = new Map(rows.map((r) => [r.id, r.reason]))
        const own = claims.filter((c) => reason.get(c.refundId as string) === `claim:${c.id}`)
        return { nonTerminal: own.filter((c) => !TERMINAL.includes(c.status)).length, terminal: own.filter((c) => TERMINAL.includes(c.status)).length }
      } catch (e) {
        console.error('[claims census] ownRowResumeMismatch NOT MEASURED —', e instanceof Error ? e.message : e)
        return { nonTerminal: null, terminal: null }
      }
    })(),
    // Track B §M (source definition, W5 fixer): a terminal claim with a recorded refundError AND an arbitrationReason.
    measure('terminalDeclarationWithArbitrationReason', () => prisma.claim.count({
      where: { status: { in: [...TERMINAL] }, refundError: { not: null }, arbitrationReason: { not: null } },
    })),
    // E-15, Track B §M (source definition, W5 fixer): refunded claims with an AdminAuditLog 'claim.attribute_refund' AND the
    // EmailDispatch of the contradiction park alert (trigger admin_money_review_claim_financial_verification, dedupeKey
    // claim_fv:<id>:stripe_refund_contradiction). null while admin audit is off. A LOWER BOUND: sendOnce releases a key whose
    // alert was not sent, and relabels into that reason sent no alert before round 13.
    (async (): Promise<number | null> => {
      try { if (!isAdminAuditEnabled()) return null } catch { return null }
      return measure('refundedAfterContradictionAttribution', async () => {
        const parks = await prisma.emailDispatch.findMany({
          where:  { trigger: CONTRADICTION_PARK_TRIGGER, dedupeKey: { startsWith: CONTRADICTION_PARK_KEY_HEAD } },
          select: { dedupeKey: true },
        })
        const parked = Array.from(new Set(parks.map((d) => d.dedupeKey)
          .filter((k) => k.endsWith(CONTRADICTION_PARK_KEY_TAIL) && k.length > CONTRADICTION_PARK_KEY_HEAD.length + CONTRADICTION_PARK_KEY_TAIL.length)
          .map((k) => k.slice(CONTRADICTION_PARK_KEY_HEAD.length, k.length - CONTRADICTION_PARK_KEY_TAIL.length))))
        if (!parked.length) return 0
        const audited = await prisma.adminAuditLog.findMany({
          where:  { targetType: 'claim', action: 'claim.attribute_refund', targetId: { in: parked } },
          select: { targetId: true },
        })
        const attributed = Array.from(new Set(audited.map((a) => a.targetId).filter((x): x is string => !!x)))
        if (!attributed.length) return 0
        return prisma.claim.count({ where: { id: { in: attributed }, status: 'refunded' } })
      })
    })(),
    // E-04: a standing row stamped for a claim that is not settled on it.
    measure('refundedBoundToOtherClaimStamp', async () => {
      const rows = await prisma.refund.findMany({ where: { status: 'succeeded', reason: { startsWith: 'claim:' } }, select: { id: true, reason: true } })
      const stampIds = Array.from(new Set(rows.map((r) => String(r.reason).slice(6))))
      const claims = stampIds.length ? await prisma.claim.findMany({ where: { id: { in: stampIds } }, select: { id: true, status: true, refundId: true } }) : []
      const byId = new Map(claims.map((c) => [c.id, c]))
      return rows.filter((r) => {
        const c = byId.get(String(r.reason).slice(6))
        return !(c && c.status === 'refunded' && c.refundId === r.id)
      }).length
    }),
    // E-12 / B9 (d): rows with two or more binders in the B1 OR form (a resume_mismatch binder is not counted).
    measure('rowsBoundToMultipleClaims', async () => {
      const groups = await prisma.claim.groupBy({
        by:     ['refundId'],
        where:  { refundId: { not: null }, OR: [{ refundError: null }, { NOT: { refundError: { startsWith: RESUME_MISMATCH_PREFIX } } }] },
        having: { refundId: { _count: { gt: 1 } } },
        _count: { _all: true },
      })
      return groups.length
    }),
    // E-01 A-S10c: a pending row past the engine's resume window whose order carries a settled or settling royalty.
    measure('pendingRowsOver20hWithSettledRoyalty', async () => {
      const rows = await prisma.refund.findMany({
        where:  { status: 'pending', royaltyRefundCents: { gt: 0 }, createdAt: { lt: new Date(now.getTime() - RESUME_CREATE_WINDOW_MS) } },
        select: { id: true, orderId: true },
      })
      if (!rows.length) return 0
      const royalties = await prisma.franchiseRoyalty.findMany({ where: { orderId: { in: Array.from(new Set(rows.map((r) => r.orderId))) }, status: { in: ['settled', 'settling'] } }, select: { orderId: true } })
      const settled = new Set(royalties.map((r) => r.orderId))
      return rows.filter((r) => settled.has(r.orderId)).length
    }),
    // E-10: approved and unpaid (this build's claims included).
    measure('approvedUnpaid', () => prisma.claim.count({ where: { status: 'approved', refundAttempted: false } })),
    // MODE B commit B — une ligne LIBEREE = (failed, stripeRefundId NULL) ET cle marquee.
    measure('voidedRefundRows', () => prisma.refund.count({ where: { status: 'failed', stripeRefundId: null, idempotencyKey: { contains: VOID_KEY_MARK } } })),
  ])
  return {
    legacyPayableProofs, refundedBoundToFailedRow, refundedRowUnproven, ownRowResumeMismatch: ownRows,
    terminalDeclarationWithArbitrationReason, refundedAfterContradictionAttribution, refundedBoundToOtherClaimStamp,
    rowsBoundToMultipleClaims, pendingRowsOver20hWithSettledRoyalty, approvedUnpaid, voidedRefundRows,
  }
}

/**
 * H16 / I-06 claims.closure, read from EmailDispatch only (never AdminAuditLog, whatever the audit flag).
 * IMPLEMENTATION NOTE (W5) on H16 / ER-C17: `missing` is computed here with the E-16 predicate (terminal, a closure kind,
 * the H05 record, no dispatch under CLOSURE_TRIGGER[kind]) rather than through lib/claim-emails
 * listMissingClaimClosureNotices, which the email slice adds; the census route therefore stays out of the pinned importer
 * list of lib/claim-emails (H15).
 */
export async function claimsClosureCensus(): Promise<ClaimsClosureCensus> {
  let terminal: Array<{ id: string; kind: ClosureKind }>
  let recorded: Set<string>
  try {
    const claims = await prisma.claim.findMany({
      where:  { status: { in: [...TERMINAL] } },
      select: { id: true, status: true, refundError: true, arbitrationDecision: true, restaurantResponse: true },
    })
    terminal = claims.map((c) => ({ id: c.id, kind: claimClosureKind(c) })).filter((c): c is { id: string; kind: ClosureKind } => c.kind !== null)
    const keys = terminal.map((c) => closureRecordKey(c.id))
    recorded = new Set(keys.length ? (await prisma.emailDispatch.findMany({ where: { trigger: CLOSURE_RECORD_TRIGGER, dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((d) => d.dedupeKey) : [])
  } catch (e) {
    console.error('[claims census] closure NOT MEASURED —', e instanceof Error ? e.message : e)
    return { missing: null, terminalWithoutRecord: null }
  }
  const terminalWithoutRecord = terminal.filter((c) => !recorded.has(closureRecordKey(c.id))).length
  const withRecord = terminal.filter((c) => recorded.has(closureRecordKey(c.id)))
  const missing = await measure('closure.missing', async () => {
    if (!withRecord.length) return 0
    const triggers = Array.from(new Set(withRecord.map((c) => CLOSURE_TRIGGER[c.kind])))
    const sent = new Set((await prisma.emailDispatch.findMany({
      where:  { trigger: { in: triggers }, dedupeKey: { in: withRecord.map((c) => closureRecordKey(c.id)) } },
      select: { trigger: true, dedupeKey: true },
    })).map((d) => `${d.trigger}|${d.dedupeKey}`))
    return withRecord.filter((c) => !sent.has(`${CLOSURE_TRIGGER[c.kind]}|${closureRecordKey(c.id)}`)).length
  })
  return { missing, terminalWithoutRecord }
}
