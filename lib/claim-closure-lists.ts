// lib/claim-closure-lists.ts — T-49 round 13, slice W7: H10 listMissingClaimClosureNotices (« Avis client non envoyés »).
//
// READ-ONLY. Prisma reads only (no raw SQL, no Stripe, no write). It imports prisma and the pure rules only.
// IMPLEMENTATION NOTE (W7) on H10 / ER-C17: the list lives here, not in lib/claim-emails, so the importers of the senders
// stay the 8 H15 routes (tests/claims-closure-imports.test.ts) and no console route bundles a sender. The binder where of
// F03 is restated here (lib/claim-emails restates it too) so this module never imports lib/claims.
import { prisma } from '@/lib/prisma'
import {
  claimClosureKind, CLOSURE_TRIGGER, CLOSURE_RECORD_TRIGGER, closureRecordKey, refundedRowProven,
  RESTAURANT_REFUNDED_TRIGGER, restaurantRefundedKey, type ClosureKind,
} from '@/lib/claim-action-rules'
import type { ClosureNoticeBlocker } from '@/lib/claim-console-copy'

export type { ClosureNoticeBlocker } from '@/lib/claim-console-copy'

/** H10: records read per page, the scan cap, and the items returned. */
export const CLOSURE_SCAN_PAGE = 500
export const CLOSURE_SCAN_CAP = 5000
export const CLOSURE_ITEMS_CAP = 200

/**
 * D′ L8 (§18) — WAS THE RESTAURANT TOLD, AND IF NOT, WHY. Read from EmailDispatch and the ledger; this
 * module writes nothing and calls no sender.
 *   'not_due'              the closure is not a refund — no money moved, so no financial notice exists
 *   'refund_not_succeeded' a refunded closure whose bound row is not settled, or carries no `re_…`
 *   'ledger_incomplete'    settled at Stripe, but no ledger line for that `re_…`: §16 forbids the mail
 *   'already_sent'         a dispatch exists under the restaurant trigger for this exact refund
 *   'pending'              due, sendable, and not yet sent
 *   'unknown'              a probe could not be read — NOT reported as sendable and NOT as blocked
 * There is deliberately no 'failed': sendTransactional RELEASES its dispatch claim when a send does not
 * succeed, so a failed attempt comes back here as 'pending' — which is the truth, because it will be
 * retried. The attempt itself is in EmailLog.
 *
 * WHY THESE TWO READS DO NOT TAKE THE LIST DOWN. This list exists for the CUSTOMER notice; the restaurant
 * state is an extra column on it. A ledger or dispatch read that fails must not hide the customer rows,
 * and it must not silently become 'pending' either — claiming sendability we did not verify is how an
 * admin presses a button that then refuses. So it degrades to 'unknown', visibly.
 */
export type RestaurantNoticeState = 'not_due' | 'refund_not_succeeded' | 'ledger_incomplete' | 'already_sent' | 'pending' | 'unknown'

export type MissingClosureNotice = {
  claimId: string
  orderId: string
  kind: ClosureKind
  decidedAt: Date | null
  blocker: ClosureNoticeBlocker | null
  /** D′ L8 (§18): the state of the RESTAURANT's post-money notice for this claim. */
  restaurantNotice: RestaurantNoticeState
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

  // ── D′ L8 (§18) — the RESTAURANT notice state, per claim ────────────────────────────────────────
  // Two extra reads, both batched: the dispatches under the restaurant trigger (keyed on the proven
  // `re_…`, so the state is per REFUND, not per claim), and whether a ledger line exists for that `re_…`.
  // The second is what distinguishes « not sent yet » from « cannot be sent » (§16): a settled refund with
  // no ledger line will never produce a financial e-mail, and an admin must be able to see that without
  // pressing the button to find out.
  const reByClaim = new Map<string, string>()
  for (const x of notSent) {
    if (x.kind !== 'refunded' || !x.c.refundId) continue
    const row = rowById.get(x.c.refundId)
    if (row && row.status === 'succeeded' && row.stripeRefundId) reByClaim.set(x.c.id, row.stripeRefundId)
  }
  const reIds = Array.from(new Set(Array.from(reByClaim.values())))
  const restoKeys = Array.from(reByClaim.entries()).map(([claimId, re]) => restaurantRefundedKey(claimId, re))
  let restoSent: Set<string> | null = new Set<string>()
  let ledgered: Set<string> | null = new Set<string>()
  if (reIds.length) {
    try {
      const ds = await prisma.emailDispatch.findMany({
        where:  { trigger: RESTAURANT_REFUNDED_TRIGGER, dedupeKey: { in: restoKeys } },
        select: { dedupeKey: true },
      })
      restoSent = new Set(ds.map((d) => d.dedupeKey))
    } catch { restoSent = null }
    try {
      const ls = await prisma.ledgerEntry.findMany({
        where:  { type: 'refund', sourceEventId: { in: reIds } },
        select: { sourceEventId: true },
      })
      ledgered = new Set(ls.map((l) => l.sourceEventId))
    } catch { ledgered = null }
  }

  return notSent.map(({ c, kind }) => {
    let restaurantNotice: RestaurantNoticeState = 'not_due'
    if (kind === 'refunded') {
      const re = reByClaim.get(c.id) ?? null
      restaurantNotice = !re ? 'refund_not_succeeded'
        : restoSent === null || ledgered === null ? 'unknown'
          : restoSent.has(restaurantRefundedKey(c.id, re)) ? 'already_sent'
            : !ledgered.has(re) ? 'ledger_incomplete'
              : 'pending'
    }
    return {
      claimId:   c.id,
      orderId:   c.orderId,
      kind,
      decidedAt: c.decidedAt ?? null,
      blocker:   kind === 'refunded'
        ? closureNoticeBlocker(c.refundId ? rowById.get(c.refundId) ?? null : null, c.refundId ? binders.get(c.refundId) ?? 0 : 0, c.orderId)
        : null,
      restaurantNotice,
    }
  })
}

/**
 * D′ L8 (§18) — « LE RESTAURANT N'A PAS ÉTÉ PRÉVENU » : SA PROPRE POPULATION.
 *
 * WHY THIS LIST EXISTS AT ALL — found by the adversarial review, and it was a P1. The restaurant notice was
 * first surfaced as one COLUMN on `listMissingClaimClosureNotices`, whose population is « claims whose
 * CUSTOMER closure notice was never dispatched ». On the ORDINARY settlement path the customer's notice IS
 * dispatched by the rail, so the claim never appears in that list — no admin would ever see a pending
 * restaurant notice, and the whole §11 feature would have been unreachable in exactly the case it was built
 * for. §16's withheld case disappeared the same way.
 *
 * So the restaurant notice gets its own question, asked independently: which SETTLED refunds, whose figures
 * the ledger can state, have no restaurant dispatch yet? Read-only, Prisma only, no sender imported.
 */
export type PendingRestaurantNotice = {
  claimId: string
  orderId: string
  decidedAt: Date | null
  /** 'pending' = sendable now · 'ledger_incomplete' = settled at Stripe, no accounting line (§16). */
  state: Extract<RestaurantNoticeState, 'pending' | 'ledger_incomplete'>
}
export type PendingRestaurantNotices = { items: PendingRestaurantNotice[]; total: number }

export async function listPendingRestaurantRefundNotices(): Promise<PendingRestaurantNotices> {
  // Candidates: a claim whose closure is a REFUND. `refundError` must be null — a set marker is our own
  // record that the money truth is open (a disowned binding, a reversal after settlement), and such a
  // claim is not a case to notify anyone about.
  const claims = await prisma.claim.findMany({
    where:  { status: 'refunded', refundError: null, refundId: { not: null } },
    select: { id: true, orderId: true, refundId: true, decidedAt: true },
    orderBy: { decidedAt: 'desc' },
    take:   CLOSURE_ITEMS_CAP,
  })
  if (claims.length === 0) return { items: [], total: 0 }
  const rowIds = Array.from(new Set(claims.map((c) => c.refundId as string)))
  const rows = await prisma.refund.findMany({
    where:  { id: { in: rowIds } },
    select: { id: true, orderId: true, status: true, stripeRefundId: true },
  })
  const rowById = new Map(rows.map((r) => [r.id, r] as const))
  // A-S43: a row bound by two claims settles neither — nothing is announced for either.
  const groups = await prisma.claim.groupBy({ by: ['refundId'], where: { refundId: { in: rowIds }, OR: BINDER_OR }, _count: { _all: true } })
  const binders = new Map(groups.map((g) => [g.refundId as string, g._count._all] as const))

  const settled = claims
    .map((c) => ({ c, row: rowById.get(c.refundId as string) ?? null }))
    .filter((x) => !!x.row && x.row.status === 'succeeded' && !!x.row.stripeRefundId
      && x.row.orderId === x.c.orderId && (binders.get(x.c.refundId as string) ?? 0) < 2)
  if (settled.length === 0) return { items: [], total: 0 }

  const keys = settled.map((x) => restaurantRefundedKey(x.c.id, x.row!.stripeRefundId as string))
  const sent = new Set((await prisma.emailDispatch.findMany({
    where:  { trigger: RESTAURANT_REFUNDED_TRIGGER, dedupeKey: { in: keys } },
    select: { dedupeKey: true },
  })).map((d) => d.dedupeKey))
  const reIds = Array.from(new Set(settled.map((x) => x.row!.stripeRefundId as string)))
  const ledgered = new Set((await prisma.ledgerEntry.findMany({
    where:  { type: 'refund', sourceEventId: { in: reIds } },
    select: { sourceEventId: true },
  })).map((l) => l.sourceEventId))

  const items = settled
    .filter((x) => !sent.has(restaurantRefundedKey(x.c.id, x.row!.stripeRefundId as string)))
    .map((x) => ({
      claimId:   x.c.id,
      orderId:   x.c.orderId,
      decidedAt: x.c.decidedAt ?? null,
      // The §16 split, made visible: sendable, or blocked for want of an accounting line.
      state:     (ledgered.has(x.row!.stripeRefundId as string) ? 'pending' : 'ledger_incomplete') as 'pending' | 'ledger_incomplete',
    }))
  return { items, total: items.length }
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
