import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveAdmin } from '@/lib/admin-guard'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit, isAdminAuditEnabled } from '@/lib/admin-audit'
import { schemaReady } from '@/lib/schema-ready'
import { isClaimsSurfaceEnabled, claimNoticeGate } from '@/lib/claim-flags'
import { isRefundsEnabled, refundGateState } from '@/lib/refund'
import { preflightRefundFunding } from '@/lib/refund-preflight'
import { triggerClaimRefund, reconcileClaimEvidence, buildClaimScopeForOrder } from '@/lib/claims'
import { sendClaimClosureEmail, type ClosureEmailResult, type ClosureEvidence } from '@/lib/claim-emails'
import { orderRef } from '@/lib/order-ref'
import { PAY_CONFIRM_WORD } from '@/lib/claim-action-rules'
import {
  MAX_BATCH, PAYABLE_WHERE, PAYABLE_ORDER_BY, PAYABLE_SELECT, clampTake, sumApprovedCents, itemIdentity,
} from '@/lib/claims-payable-core'
import { signPayToken, verifyPayToken, deployedSha, PayTokenSecretMissing, PAY_TOKEN_TTL_MS, type PayTokenItem } from '@/lib/claims-pay-token'
import {
  classifyRailResult, preflightVerdict, payableShapeRefusal, leaseUsable, bucketOf, noticeDue, tally, moneyMovedOf,
  PAY_BUDGET_MS, LEASE_SAFETY_MARGIN_MS,
  type RailOutcome, type PreflightHold,
} from '@/lib/claims-pay-rail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/pay-approved (D′ L5 · spec v2 §8.1-§8.7) ───────────────────────────────
//
// THE FINANCIAL RAIL. It is the separate, human-opened step of D′: a claim decided by Grubano waits
// here, with its amount, until an admin pays a batch inside a REFUNDS window. Deciding and paying are
// two different acts by two different gates — that separation is the whole point of the architecture,
// and this file is where the second one lives.
//
// TWO CALLS, NEVER ONE.
//   dryRun  — read-only. Selects what the rail WOULD pay, runs a preflight per claim, and returns the
//             list with a signed token. It needs no window and no product flag: an admin must be able
//             to see what is waiting before anyone opens anything.
//   PAYER   — pays EXACTLY the claims the token carries, in order, and re-reads each one first. It
//             never re-selects the queue: the admin approved a list of numbers, not a query.
//
// WHAT IT NEVER DOES (§8.7). It writes no claim field of its own — not the decision, not the instants,
// not the amount; it creates no refund row and no Stripe object; it never reaches the engine directly,
// only through `triggerClaimRefund`, which owns every safety rule, every CAS and every alert; and it
// never accepts the internal cron token. A machine cannot pay a claim on this rail. Only a named admin
// can, with an audit row per claim and one for the batch.
//
// THE LEASE IS RE-READ BEFORE EVERY CLAIM (S-05), with a 60-second margin: a window that is about to
// close is treated as closed, because « it was open when I started » is not a fact anyone can check
// afterwards. When it closes mid-batch the rest is reported `not_attempted` — never « failed ».

const MIN_TAKE = 1

const bodySchema = z.object({
  dryRun:   z.literal(true).optional(),
  /** Explicit claims (§8.5): the ONLY way a v13 payable proof is ever offered to the engine (S-14b). */
  claimIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH).optional(),
  take:     z.number().int().min(MIN_TAKE).max(MAX_BATCH).optional(),
  confirm:  z.string().max(16).optional(),
  token:    z.string().max(20_000).optional(),
}).strict()

/** The fields the rail re-reads per claim, before and after an attempt. */
const RAIL_SELECT = {
  id: true, orderId: true, status: true, arbitrationDecision: true, refundAttempted: true,
  refundId: true, refundError: true, approvedAmountCents: true, requestedAmountCents: true,
  arbitratedAt: true, arbitrationReason: true, createdAt: true,
} as const

type RailClaim = {
  id: string; orderId: string; status: string; arbitrationDecision: string | null
  refundAttempted: boolean; refundId: string | null; refundError: string | null
  approvedAmountCents: number | null; requestedAmountCents: number
  arbitratedAt: Date | null; arbitrationReason: string | null; createdAt: Date
}

interface DryRunRow {
  claimId: string
  orderId: string
  orderRef: string
  requestedAmountCents: number
  approvedAmountCents: number | null
  arbitratedAt: string | null
  payable: boolean
  hold: PreflightHold | null
  holdDetail: string | null
}

interface PayItem {
  claimId: string
  orderRef: string
  approvedAmountCents: number
  outcome: RailOutcome
  refundRowId: string | null
  /** What the engine actually refunded, from the refund row it drove (never the approved figure). */
  engineAmountCents: number | null
  stripeRefundId: string | null
  error: string | null
  until: string | null
  evidence: string | null
  /** The post-money notice result, when one was due. */
  customerEmail: ClosureEmailResult | null
}

const GATED = { error: 'Réclamations indisponibles', gated: true }
const SCHEMA_NOT_READY = {
  error: 'Rail indisponible : le schéma des réclamations n’est pas prêt sur ce serveur. Rien n’a été lu ni écrit.',
  reason: 'schema_not_ready', schemaReady: false,
}

export async function POST(req: Request) {
  // (0) Flag-gated rate limit (§8.1: 5/60). No-op when RATE_LIMIT_ENABLED is off.
  const limited = rateLimit(req, 'admin_claims_pay_approved', { limitDefault: 5, windowDefault: 60 })
  if (limited) return limited

  // (1) A named admin, re-read over the live role set. NEVER the internal cron token: no machine pays
  //     a claim (S-04). There is no header path into this route at all.
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  const body = parsed.data
  const isPay = body.confirm !== undefined || body.token !== undefined
  // `dryRun` states an intent to change nothing. A body carrying it AND a payment authorization is
  // contradictory, so it is refused rather than resolved one way or the other: neither silently paying
  // nor silently not paying is an answer an admin could rely on.
  if (body.dryRun && isPay) {
    return NextResponse.json({ error: 'Requête contradictoire : une simulation ne paie pas.', reason: 'dry_run_with_payment' }, { status: 400 })
  }

  // (2) The three columns D′ added must be usable in THIS process, or nothing is read: a stale Prisma
  //     client would make the selection throw mid-batch instead of answering « not right now » (S-27).
  const schema = await schemaReady()
  if (!schema.ready) return NextResponse.json(SCHEMA_NOT_READY, { status: 503 })

  return isPay ? payBatch(req, operator, body) : dryRun(req, operator, body)
}

// ── A. dryRun — read-only, ungated on the window and on the product flag (§8.2) ────────────────────

async function dryRun(
  req: Request,
  operator: { id: string; email: string },
  body: z.infer<typeof bodySchema>,
): Promise<NextResponse> {
  const nowMs = Date.now()
  // Deduplicated: the same id twice would be signed twice and offered to the engine twice. The engine's
  // own attempt CAS refuses the second (already_handled, 0 writes), but a report that lists one claim
  // twice — once paid, once « changed » — is a report an admin would have to decode.
  const explicit = body.claimIds ? Array.from(new Set(body.claimIds)) : null

  let claims: RailClaim[]
  try {
    claims = explicit
      ? await prisma.claim.findMany({ where: { id: { in: explicit } }, select: RAIL_SELECT })
      : (await prisma.claim.findMany({
          where:   PAYABLE_WHERE,
          orderBy: [...PAYABLE_ORDER_BY],
          take:    clampTake(body.take),
          select:  { ...PAYABLE_SELECT, ...RAIL_SELECT },
        })) as RailClaim[]
  } catch {
    return NextResponse.json({ error: 'La file n’a pas pu être lue. Rien n’a été écrit.' }, { status: 500 })
  }

  // An explicitly named batch keeps the caller's order and rejects anything outside the selection;
  // the automatic batch is already FIFO by decision instant.
  const ordered = explicit
    ? explicit.map((id) => claims.find((c) => c.id === id) ?? null)
    : claims.map((c) => c as RailClaim | null)

  const rows: DryRunRow[] = []
  const signable: PayTokenItem[] = []
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i]
    if (!c) {
      // A named claim that does not exist is SAID, never dropped: an admin who asked about three claims
      // and is shown two has no statement at all about the third.
      if (explicit) rows.push(missingRow(explicit[i]))
      continue
    }
    const shape = payableShapeRefusal(c, { nowMs, allowV13: !!explicit })
    if (shape) {
      // §8.5: an id the selection does not accept is reported as such, with the clause that refused it —
      // never as a payable row and never as a silent omission.
      rows.push(row(c, false, shape === 'amount_not_ratified' ? 'amount_not_ratified' : 'not_selectable', shape))
      continue
    }
    const facts = await preflightFacts(c)
    const verdict = preflightVerdict({
      approvedAmountCents:  c.approvedAmountCents,
      requestedAmountCents: c.requestedAmountCents,
      ...facts,
    })
    if (verdict.payable) {
      rows.push(row(c, true, null, null))
      signable.push(itemIdentity(c) as PayTokenItem)
    } else {
      rows.push(row(c, false, verdict.hold, verdict.detail ?? null))
    }
  }

  const gate = refundGateState(nowMs)
  let token: string | null = null
  let tokenExpiresAt: string | null = null
  if (signable.length) {
    try {
      token = signPayToken({
        adminId: operator.id,
        items:   signable.slice(0, MAX_BATCH),
        lease:   gate.open ? gate.expiresAt.toISOString() : null,
        nowMs,
        // S-14b travels WITH the batch: only a batch an admin named claim by claim may pay a v13 proof.
        explicit: !!explicit,
      })
      tokenExpiresAt = new Date(nowMs + PAY_TOKEN_TTL_MS).toISOString()
    } catch (e) {
      if (!(e instanceof PayTokenSecretMissing)) throw e
      return NextResponse.json({
        error: 'Rail indisponible : ce serveur ne peut pas signer un lot (secret de session absent). Rien n’a été écrit.',
        reason: 'token_unsignable',
      }, { status: 503 })
    }
  }

  // A dryRun reads Stripe and the database and writes nothing — it is still an admin action on the
  // money surface, so it leaves a trail saying what was shown and to whom.
  await audit(req, operator, 'claim.pay_dry_run', null, {
    mode: 'dry_run', moneyMoved: false, requested: rows.length,
    payable: signable.length, held: rows.filter((r) => !r.payable).length,
    totalPayableCents: sumApprovedCents(rows.filter((r) => r.payable).map((r) => ({ approvedAmountCents: r.approvedAmountCents }))),
    leaseOpen: gate.open, sha: deployedSha(), explicit: !!body.claimIds,
  })

  return NextResponse.json({
    mode:              'dry_run',
    schemaReady:       true,
    sha:               deployedSha(),
    claims:            rows,
    payableCount:      signable.length,
    heldCount:         rows.filter((r) => !r.payable).length,
    totalPayableCents: sumApprovedCents(rows.filter((r) => r.payable).map((r) => ({ approvedAmountCents: r.approvedAmountCents }))),
    lease: gate.open
      ? { open: true, expiresAt: gate.expiresAt.toISOString(), remainingMs: gate.remainingMs, usable: leaseUsable(gate) }
      : { open: false, reason: gate.reason, usable: false },
    /** The product surface must be ON for PAYER; the legacy lease never opens the rail (S-14). */
    surfaceEnabled:    isClaimsSurfaceEnabled(),
    auditEnabled:      isAdminAuditEnabled(),
    token,
    tokenExpiresAt,
  })
}

/** A claim an admin named that the database does not hold. It is reported, not omitted. */
function missingRow(claimId: string): DryRunRow {
  return {
    claimId, orderId: '', orderRef: '', requestedAmountCents: 0, approvedAmountCents: null,
    arbitratedAt: null, payable: false, hold: 'not_selectable', holdDetail: 'not_found',
  }
}

function row(c: RailClaim, payable: boolean, hold: PreflightHold | null, detail: string | null): DryRunRow {
  return {
    claimId:              c.id,
    orderId:              c.orderId,
    orderRef:             orderRef(c.orderId),
    requestedAmountCents: c.requestedAmountCents,
    approvedAmountCents:  c.approvedAmountCents,
    arbitratedAt:         c.arbitratedAt ? c.arbitratedAt.toISOString() : null,
    payable,
    hold,
    holdDetail:           detail,
  }
}

/**
 * The three live reads of the preflight (§8.2), each fail-closed: what we could not establish is a
 * hold, never a pass. None of them writes anything.
 */
async function preflightFacts(c: RailClaim): Promise<{
  funding: 'ok' | 'routed_without_fee' | 'unreadable' | null
  maxRefundableCents: number | null
  ceilingReadable: boolean
  orderHasPendingRow: boolean
}> {
  type OrderFacts = { total: number; items: unknown; stripePaymentIntentId: string | null }
  let order: OrderFacts | null = null
  try {
    order = (await prisma.order.findUnique({
      where:  { id: c.orderId },
      select: { total: true, items: true, stripePaymentIntentId: true },
    })) as OrderFacts | null
  } catch {
    return { funding: 'unreadable', maxRefundableCents: null, ceilingReadable: false, orderHasPendingRow: true }
  }
  if (!order) return { funding: 'unreadable', maxRefundableCents: null, ceilingReadable: false, orderHasPendingRow: true }

  // (i) the terminal Stripe rejection the repository can prove: a routed charge carrying no commission.
  //     No PaymentIntent ⇒ not read: the engine refuses that itself, before writing anything.
  let funding: 'ok' | 'routed_without_fee' | 'unreadable' | null = null
  if (order.stripePaymentIntentId) {
    try {
      const f = await preflightRefundFunding({ paymentIntentId: order.stripePaymentIntentId })
      funding = f.ok ? 'ok' : f.cause === 'routed_without_fee' ? 'routed_without_fee' : 'unreadable'
    } catch {
      funding = 'unreadable'
    }
  }

  // (ii) the live remaining refundable of the ORDER, through the ONE scope builder the customer path
  //      and the ceiling route already use — never a second definition of the ceiling.
  let maxRefundableCents: number | null = null
  let ceilingReadable = false
  try {
    const scope = await buildClaimScopeForOrder({
      orderId:               c.orderId,
      orderTotalEur:         order.total,
      items:                 order.items,
      stripePaymentIntentId: order.stripePaymentIntentId,
    })
    maxRefundableCents = scope.maxAuthorityCents
    // T-59, applied to a PAYMENT decision: the DB-derived cap is an over-estimate (it ignores refunds
    // issued outside this rail), so a claim judged « inside the remainder » against it could still be
    // unpayable. Only live Stripe truth, on a charge that is not disputed, counts as a read ceiling —
    // anything else is UNKNOWN, and an unknown ceiling holds the claim instead of clearing it.
    ceilingReadable = scope.ceilingSource === 'stripe' && !scope.ceilingContested
  } catch {
    ceilingReadable = false
  }

  // (iii) another refund of this order still pending: a second one would race its cumulative key.
  let orderHasPendingRow = true
  try {
    orderHasPendingRow = (await prisma.refund.count({ where: { orderId: c.orderId, status: 'pending' } })) > 0
  } catch {
    orderHasPendingRow = true
  }

  return { funding, maxRefundableCents, ceilingReadable, orderHasPendingRow }
}

// ── B. PAYER — the only path on which money moves (§8.2) ───────────────────────────────────────────

async function payBatch(
  req: Request,
  operator: { id: string; email: string },
  body: z.infer<typeof bodySchema>,
): Promise<NextResponse> {
  // (1) the typed word. A batch payment is never one click away from a list.
  if (body.confirm !== PAY_CONFIRM_WORD) {
    return NextResponse.json({ error: 'Confirmation requise : saisissez PAYER.', reason: 'confirm_required' }, { status: 400 })
  }

  // (2) THE MONEY BOUNDARY, both halves, before anything is read (S-14). The REFUNDS lease says money
  //     may move at all; the claims PRODUCT surface says this feature is on. The legacy claims lease —
  //     the rehearsal flag — is deliberately absent here: it never opens the rail.
  if (!isRefundsEnabled() || !isClaimsSurfaceEnabled()) {
    return NextResponse.json({ ...GATED, reason: !isRefundsEnabled() ? 'refunds_closed' : 'surface_closed' }, { status: 403 })
  }

  // (3) no audit, no payment (S-30). A rail that cannot say who paid what must not pay.
  if (!isAdminAuditEnabled()) {
    return NextResponse.json({
      error: 'Paiement indisponible : le journal d’audit admin est désactivé. Rien n’a été tenté.',
      reason: 'audit_disabled',
    }, { status: 409 })
  }

  // (4) the batch itself, signed by a dryRun this admin ran on this build within the last 10 minutes.
  const verdict = verifyPayToken(body.token, { adminId: operator.id, nowMs: Date.now() })
  if (!verdict.ok) {
    return NextResponse.json({
      error: TOKEN_REFUSAL[verdict.reason] ?? TOKEN_REFUSAL.malformed,
      reason: `token_${verdict.reason}`,
    }, { status: verdict.reason === 'expired' ? 409 : 400 })
  }
  const signed = verdict.payload

  const startedAt = Date.now()
  const items: PayItem[] = []
  let stoppedBy: 'lease_expired' | 'crashed' | 'budget' | null = null
  /** Per-claim audit rows the database refused. Reported, never swallowed. */
  let auditGaps = 0

  for (const it of signed.items) {
    if (stoppedBy) { items.push(notAttempted(it)); continue }

    // Wall-clock budget: a request that runs past it stops offering claims rather than being cut off
    // by a proxy in the middle of an engine call.
    if (Date.now() - startedAt > PAY_BUDGET_MS) { stoppedBy = 'budget'; items.push(notAttempted(it)); continue }

    // S-05: the window, re-read, with its safety margin. Closed or nearly closed ⇒ stop, nothing read.
    if (!leaseUsable(refundGateState())) { stoppedBy = 'lease_expired'; items.push(notAttempted(it)); continue }

    // The identity the dryRun signed must still be the claim's identity, and the claim must still be
    // in a shape the rail may offer. Anything else is skipped with ZERO writes.
    let fresh: RailClaim | null = null
    let readFailed = false
    try {
      fresh = await prisma.claim.findUnique({ where: { id: it.claimId }, select: RAIL_SELECT }) as RailClaim | null
    } catch {
      readFailed = true
    }
    // « I could not look » is neither « the decision moved » nor « its state refuses it »: a read that
    // failed gets its own word, so the report never asserts a fact the rail did not establish.
    if (readFailed) {
      const unread = base(it, null, 'skipped:claim_unreadable')
      unread.evidence = 'claim_unreadable'
      items.push(unread)
      if (!(await auditItem(req, operator, unread))) auditGaps++
      continue
    }
    // Two DIFFERENT skips, said with two different words (§8.5 / §8.2), because an admin needs to know
    // which one happened: the DECISION moved under the batch (someone withdrew and re-decided), or the
    // decision is intact but the claim is no longer one the rail may offer (a money state was recorded).
    // A claim that is simply GONE is « not selectable » (its state — absence — refuses it), not « moved ».
    const identityMoved = !!fresh
      && (fresh.approvedAmountCents !== it.approvedAmountCents
        || (fresh.arbitratedAt ? fresh.arbitratedAt.toISOString() : null) !== it.arbitratedAt)
    // S-14b re-enforced HERE, not only at selection time: a claim that acquired a v13 payable proof between
    // the dryRun and the payment must not be paid by a batch nobody named. `allowV13` is the signed
    // fact, never a constant — an automatic batch stays automatic all the way to the engine.
    const shapeRefusal = fresh ? payableShapeRefusal(fresh, { nowMs: Date.now(), allowV13: signed.explicit }) : 'not_found'
    if (identityMoved || shapeRefusal) {
      const skipped = base(it, fresh, identityMoved ? 'skipped:stale_dryrun' : 'skipped:not_selectable')
      skipped.evidence = identityMoved ? 'identity_moved' : shapeRefusal
      items.push(skipped)
      if (!(await auditItem(req, operator, skipped))) auditGaps++
      continue
    }

    // THE ONE CALL. Everything money-critical — the pre-image, the attempt CAS pinning the decision and
    // the amount, the safety holds, the identity checks, the alerts — belongs to the trigger.
    let result: Awaited<ReturnType<typeof triggerClaimRefund>>
    try {
      result = await triggerClaimRefund(it.claimId)
    } catch {
      stoppedBy = 'crashed'
      const crashed = base(it, fresh, 'crashed')
      crashed.evidence = 'engine_called_unknown'
      items.push(crashed)
      if (!(await auditItem(req, operator, crashed))) auditGaps++
      continue
    }

    // Read what the attempt recorded: it is what tells an engine refusal that created nothing apart
    // from one that may have moved money (see lib/claims-pay-rail classifyRailResult).
    let after: { status: string; refundError: string | null; refundId: string | null } | null = null
    try {
      after = await prisma.claim.findUnique({ where: { id: it.claimId }, select: { status: true, refundError: true, refundId: true } })
    } catch {
      after = null
    }

    const cls = classifyRailResult(result, after)
    if (cls.stop) stoppedBy = stoppedBy ?? 'lease_expired'
    const item = base(it, fresh, cls.outcome)
    item.error = cls.error ?? null
    item.until = cls.until ?? null
    item.evidence = cls.evidence ?? null
    if (result.state === 'refunded') { item.refundRowId = result.refundId; item.engineAmountCents = result.amountCents }
    if (result.state === 'pending' && result.reason === 'stripe_pending') item.refundRowId = result.refundId

    // The Stripe id of the row the engine drove, for the audit. A read; never a condition of anything.
    if (item.refundRowId) {
      try {
        const rowRead = await prisma.refund.findUnique({ where: { id: item.refundRowId }, select: { stripeRefundId: true, amountCents: true } })
        item.stripeRefundId = rowRead?.stripeRefundId ?? null
        if (item.engineAmountCents === null && rowRead) item.engineAmountCents = rowRead.amountCents
      } catch { /* the audit says what it knows; it never blocks a payment that already happened */ }
    }

    // §8.6: the post-money notice, and ONLY on a proven payment. `accepted_pending` sends nothing —
    // nothing is proven yet — and no refusal ever notifies a customer about money.
    if (noticeDue(cls.outcome)) item.customerEmail = await postMoneyNotice(it.claimId)

    items.push(item)
    if (!(await auditItem(req, operator, item))) auditGaps++
  }

  const counts = tally(items.map((i) => i.outcome))
  const gate = refundGateState()
  await audit(req, operator, 'claim.pay_batch', null, {
    moneyMoved:     counts.paid > 0 ? true : items.some((i) => moneyMovedOf(i.outcome) === 'unknown') ? 'unknown' : false,
    requested:      counts.requested,
    paid:           counts.paid,
    pending:        counts.pending,
    held:           counts.held,
    review:         counts.review,
    failed:         counts.failed,
    skipped:        counts.skipped,
    notAttempted:   counts.notAttempted,
    // S-30 can require the FLAG before a payment, never that the WRITE succeeded — by then the money has
    // moved. What it can require is that a missing row is SAID: a silent gap read as a complete trail is
    // how a paid claim becomes unaccounted for.
    auditGaps,
    stoppedBy,
    leaseExpiresAt: gate.open ? gate.expiresAt.toISOString() : null,
    sha:            signed.sha,
  })

  return NextResponse.json({
    mode:  'pay',
    stoppedBy,
    /** > 0 ⇒ that many per-claim audit rows could not be written. The payments themselves stand. */
    auditGaps,
    leaseExpiresAt: gate.open ? gate.expiresAt.toISOString() : null,
    items,
    counts,
  })
}

const TOKEN_REFUSAL: Record<string, string> = {
  missing:       'Lot introuvable : relancez la simulation.',
  no_secret:     'Ce serveur ne peut pas vérifier un lot (secret de session absent). Rien n’a été tenté.',
  malformed:     'Lot illisible : relancez la simulation.',
  bad_signature: 'Lot non authentifié : il n’a pas été produit par ce serveur. Rien n’a été tenté.',
  wrong_version: 'Lot produit par une autre version du rail : relancez la simulation.',
  expired:       'Lot expiré (10 minutes) : relancez la simulation pour revoir les montants avant de payer.',
  not_yet_valid: 'Lot daté dans le futur : relancez la simulation. Rien n’a été tenté.',
  ttl_too_long:  'Lot invalide : durée de validité non conforme. Rien n’a été tenté.',
  wrong_admin:   'Ce lot a été simulé par un autre administrateur : relancez la simulation vous-même.',
  wrong_build:   'Ce lot a été simulé sur une autre version déployée : relancez la simulation.',
  no_items:      'Lot vide : rien à payer.',
  too_many_items: 'Lot trop grand : 20 réclamations au maximum.',
}

function base(it: PayTokenItem, fresh: RailClaim | null, outcome: RailOutcome): PayItem {
  return {
    claimId:             it.claimId,
    orderRef:            fresh ? orderRef(fresh.orderId) : '',
    approvedAmountCents: it.approvedAmountCents,
    outcome,
    refundRowId:         null,
    engineAmountCents:   null,
    stripeRefundId:      null,
    error:               null,
    until:               null,
    evidence:            null,
    customerEmail:       null,
  }
}

const notAttempted = (it: PayTokenItem): PayItem => base(it, null, 'not_attempted')

/**
 * The customer notice for a claim the rail just paid. The sender decides everything (record, gate,
 * bound row, recipient, wording); its only external input is Stripe's OWN refund object, re-read here,
 * so the amount the customer reads is the amount Stripe settled — never the approved figure and never
 * the refund row's prediction. No evidence ⇒ the sender skips and the claim surfaces in the « notices
 * not sent » list, which is the truthful outcome: we do not tell a customer money arrived until it did.
 *
 * Best-effort throughout (the money already moved): it never throws into the batch.
 */
async function postMoneyNotice(claimId: string): Promise<ClosureEmailResult> {
  let evidence: ClosureEvidence | undefined
  try {
    const ev = await reconcileClaimEvidence({ claimId })
    if (ev && ev.ok && ev.outcome === 'refund_still_standing' && ev.stripeStatus === 'succeeded'
      && Number.isInteger(ev.amountCents) && ev.amountCents > 0) {
      evidence = { basis: 'stripe_read', amountCents: ev.amountCents }
    }
  } catch { /* no evidence is a reason to say less, never a reason to fail a payment */ }
  try {
    // FIN-EMAIL-01 (§6.1/§6.2): the rail's notice is POST-MONEY — always sendable, whatever the
    // product flags say. Hiding a refund that reached a customer behind a feature flag is how money
    // questions go silent.
    return await sendClaimClosureEmail({ claimId, evidence, claimsOpen: claimNoticeGate('post_money') })
  } catch {
    return { status: 'failed', kind: null, why: 'sender_error' }
  }
}

/** Returns false when the audit row was NOT written, so the batch can say so instead of implying a trail. */
async function auditItem(req: Request, operator: { id: string; email: string }, item: PayItem): Promise<boolean> {
  return audit(req, operator, 'claim.pay', item.claimId, {
    outcome:             item.outcome,
    bucket:              bucketOf(item.outcome),
    // Three-valued on purpose (lib/claims-pay-rail moneyMovedOf): « not established » is its own answer.
    moneyMoved:          moneyMovedOf(item.outcome),
    approvedAmountCents: item.approvedAmountCents,
    engineAmountCents:   item.engineAmountCents,
    refundRowId:         item.refundRowId,
    stripeRefundId:      item.stripeRefundId,
    error:               item.error,
    evidence:            item.evidence,
    customerEmail:       item.customerEmail ? item.customerEmail.status : null,
  })
}

/**
 * true ⇔ the audit row was actually written. S-30 requires the FLAG to be on before PAYER attempts
 * anything; it cannot require the WRITE to succeed, because by then the money has already moved. What it
 * can require is that a failed write is SAID rather than swallowed — the report and the batch row carry
 * the count, so nobody reads a silent gap as a complete trail.
 */
async function audit(
  req: Request,
  operator: { id: string; email: string },
  action: string,
  targetId: string | null,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  try {
    return await recordAdminAudit({
      actorId: operator.id, actorEmail: operator.email, action,
      targetType: 'claim', targetId, metadata, req,
    })
  } catch {
    // the trail is best-effort; it never changes what happened to the money
    return false
  }
}
