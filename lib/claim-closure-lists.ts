// lib/claim-closure-lists.ts — T-49 round 13, slice W7: H10 listMissingClaimClosureNotices (« Avis client non envoyés »).
//
// READ-ONLY. Prisma reads only (no raw SQL, no Stripe, no write). It imports prisma and the pure rules only.
// IMPLEMENTATION NOTE (W7) on H10 / ER-C17: the list lives here, not in lib/claim-emails, so the importers of the senders
// stay the 8 H15 routes (tests/claims-closure-imports.test.ts) and no console route bundles a sender. The binder where of
// F03 is restated here (lib/claim-emails restates it too) so this module never imports lib/claims.
import { prisma } from '@/lib/prisma'
import {
  claimClosureKind, CLOSURE_TRIGGER, CLOSURE_RECORD_TRIGGER, closureRecordKey, refundedRowProven, type ClosureKind,
} from '@/lib/claim-action-rules'
import type { ClosureNoticeBlocker } from '@/lib/claim-console-copy'

export type { ClosureNoticeBlocker } from '@/lib/claim-console-copy'

/** H10: records read per page, the scan cap, and the items returned. */
export const CLOSURE_SCAN_PAGE = 500
export const CLOSURE_SCAN_CAP = 5000
export const CLOSURE_ITEMS_CAP = 200

export type MissingClosureNotice = {
  claimId: string
  orderId: string
  kind: ClosureKind
  decidedAt: Date | null
  blocker: ClosureNoticeBlocker | null
}
export type MissingClosureNotices = { items: MissingClosureNotice[]; total: number; scanTruncated: boolean }

/** F03 binders: a resume_mismatch binding is disowned (null error branch explicit, B1). */
const BINDER_OR = [{ refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } }]

/**
 * H10 blocker of a refunded closure. It is non-null exactly when the sender refuses at H06 step 6 (two or more binders, a
 * failed row, or a row refundedRowProven rejects), but its VALUE follows the section that lists the claim, not the sender's
 * why: two or more binders → refunded_row_ambiguous (the row settles no claim, A-S43; listed in no section, so its line names
 * none); a failed row with a Stripe id on the claim's own order → refunded_row_failed (the A-S31c row listed in « Vérification
 * financière requise »); any other unproven row → refunded_row_unproven (the E-13 row listed in « Réclamations remboursées
 * dont la ligne liée n’est pas établie »). IMPLEMENTATION NOTE (W7 fixer) on H10 / ER-C22: the sender answers
 * refunded_row_failed for ANY failed row — without a Stripe id, or on another order, too — while this blocker answers
 * refunded_row_unproven for those two shapes; both block the button and both map to the rowUnproven toast, and the
 * unproven line points to section A, which lists them. Pinned by tests/claim-closure-lists.test.ts (step-6 parity).
 */
export function closureNoticeBlocker(
  row: { orderId?: string | null; status?: string | null; amountCents?: number | null; stripeRefundId?: string | null } | null | undefined,
  binders: number,
  claimOrderId: string,
): ClosureNoticeBlocker | null {
  if (binders >= 2) return 'refunded_row_ambiguous'
  if (row && row.orderId === claimOrderId && row.status === 'failed' && !!row.stripeRefundId) return 'refunded_row_failed'
  if (!refundedRowProven(row, claimOrderId)) return 'refunded_row_unproven'
  return null
}

type ClaimRead = {
  id: string; orderId: string; status: string; refundId: string | null; refundError: string | null
  arbitrationDecision: string | null; restaurantResponse: string | null; decidedAt: Date | null
}

async function missingAmong(ids: string[]): Promise<MissingClosureNotice[]> {
  const claims = (await prisma.claim.findMany({
    where:  { id: { in: ids } },
    select: { id: true, orderId: true, status: true, refundId: true, refundError: true, arbitrationDecision: true, restaurantResponse: true, decidedAt: true },
  })) as ClaimRead[]
  const closures = claims
    .map((c) => ({ c, kind: claimClosureKind(c) }))
    .filter((x): x is { c: ClaimRead; kind: ClosureKind } => x.kind !== null)
  if (!closures.length) return []
  const triggers = Array.from(new Set(closures.map((x) => CLOSURE_TRIGGER[x.kind])))
  const dispatched = new Set((await prisma.emailDispatch.findMany({
    where:  { trigger: { in: triggers }, dedupeKey: { in: closures.map((x) => closureRecordKey(x.c.id)) } },
    select: { trigger: true, dedupeKey: true },
  })).map((d) => `${d.trigger}|${d.dedupeKey}`))
  // Only a dispatch under the SAME trigger as the closure kind excludes the claim.
  const notSent = closures.filter((x) => !dispatched.has(`${CLOSURE_TRIGGER[x.kind]}|${closureRecordKey(x.c.id)}`))
  const rowIds = Array.from(new Set(notSent.filter((x) => x.kind === 'refunded' && x.c.refundId).map((x) => x.c.refundId as string)))
  const rows = rowIds.length
    ? await prisma.refund.findMany({ where: { id: { in: rowIds } }, select: { id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true } })
    : []
  const rowById = new Map(rows.map((r) => [r.id, r] as const))
  const groups = rowIds.length
    ? await prisma.claim.groupBy({ by: ['refundId'], where: { refundId: { in: rowIds }, OR: BINDER_OR }, _count: { _all: true } })
    : []
  const binders = new Map(groups.map((g) => [g.refundId as string, g._count._all] as const))
  return notSent.map(({ c, kind }) => ({
    claimId:   c.id,
    orderId:   c.orderId,
    kind,
    decidedAt: c.decidedAt ?? null,
    blocker:   kind === 'refunded'
      ? closureNoticeBlocker(c.refundId ? rowById.get(c.refundId) ?? null : null, c.refundId ? binders.get(c.refundId) ?? 0 : 0, c.orderId)
      : null,
  }))
}

/**
 * H10 listMissingClaimClosureNotices: this build's closure records (EmailDispatch trigger claim_closure_record, AMF-2 — never
 * AdminAuditLog) whose claim is still a closure and has no dispatch under CLOSURE_TRIGGER[kind]. Records are paged newest first
 * with an id cursor (500 per page, a stable order under concurrent inserts), up to 5000 scanned (scanTruncated past that).
 * Items: the first 200 by decidedAt desc. A read that throws propagates: the route reports the list as unreadable.
 */
export async function listMissingClaimClosureNotices(): Promise<MissingClosureNotices> {
  const missing: MissingClosureNotice[] = []
  let scanned = 0
  let cursor: string | null = null
  let scanTruncated = false
  for (;;) {
    const page: Array<{ id: string; dedupeKey: string }> = await prisma.emailDispatch.findMany({
      where:   { trigger: CLOSURE_RECORD_TRIGGER },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take:    CLOSURE_SCAN_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select:  { id: true, dedupeKey: true },
    })
    if (!page.length) break
    scanned += page.length
    cursor = page[page.length - 1].id
    const ids = Array.from(new Set(page.map((r) => r.dedupeKey).filter((k) => k.startsWith('claim:')).map((k) => k.slice('claim:'.length))))
    if (ids.length) missing.push(...await missingAmong(ids))
    if (page.length < CLOSURE_SCAN_PAGE) break
    if (scanned >= CLOSURE_SCAN_CAP) {
      const more = await prisma.emailDispatch.findMany({
        where: { trigger: CLOSURE_RECORD_TRIGGER }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, cursor: { id: cursor }, skip: 1, select: { id: true },
      })
      scanTruncated = more.length > 0
      break
    }
  }
  // decidedAt desc; a claim without decidedAt sorts last.
  const at = (d: Date | null) => (d ? new Date(d).getTime() : 0)
  const items = [...missing].sort((a, b) => at(b.decidedAt) - at(a.decidedAt)).slice(0, CLOSURE_ITEMS_CAP)
  return { items, total: missing.length, scanTruncated }
}
