// lib/claim-restaurant-view.ts — D′ L8 (S-19): WHAT A RESTAURANT MAY SEE OF A CLAIM, WRITTEN OUT BY NAME.
//
// THE DEFECT THIS FILE CLOSES. `listRestaurantClaims` ran `prisma.claim.findMany` with no `select` and
// serialised the WHOLE row to the restaurant: `consumerId`, `decidedBy`, `refundAttempted`, `refundId`,
// `refundError`, `activeOrderKey`, `contestReason`, `arbitratedBy`, every arbitration field, the raw
// `status`. Nothing rendered them, which is why it survived — the panel reads seven fields out of
// twenty-seven. "Nothing renders it" is not a privacy boundary: it is an accident that holds until
// someone adds a line of JSX, and `refundError` in particular is French operator prose PREFIXED with its
// own marker token and containing Refund row ids, Stripe refund ids (`re_…`) and other claims' ids.
//
// WHY THIS IS A BUILDER AND NOT A `select`. A curated `select` fixes today and leaks tomorrow: the next
// additive column on `Claim` is in the payload the moment someone widens the query, and a reviewer
// comparing a diff of a `select` list has to KNOW the model to notice. This module instead CONSTRUCTS the
// response object field by field, with no spread anywhere, so a new column cannot arrive by default — it
// has to be typed in, by name, in a file whose only purpose is to decide what a restaurant sees. The
// founder's §20 test builds a Claim with every sensitive field populated and asserts none of them appear;
// with a spread that test passes until the model changes, with a builder it cannot start failing silently.
//
// PURE ON PURPOSE. No Prisma, no Stripe, no clock. The caller reads; this decides. That keeps the DTO
// testable against hand-built evidence (including evidence the database cannot easily produce, like a
// ledger line that contradicts itself) and means the leak contract is provable without a database.
//
// WHAT IS DELIBERATELY ABSENT, and why each one is a decision rather than an omission:
//   • `consumerId` — the claimant's Operator id. The restaurant deals with an order, not with an account.
//   • `refundError` / `refundId` / `refundAttempted` / `activeOrderKey` — internal recovery state. The
//     ONLY thing a restaurant is told about money is the CONFIRMED figures of the T-46 block.
//   • `decidedBy` / `arbitratedBy` — who at Grubano acted. Not the restaurant's business, and a name or
//     an operator id is a person.
//   • `contestReason` — the CLIENT's justification for contesting a refusal. It is written to Grubano,
//     not to the restaurant; spec §1 admits it only if it is explicitly restaurant-facing, and it is not.
//   • `arbitrationReason` — Grubano's own decision motive. Not in the admitted list; the customer's view
//     gates it through `customerClaimReasons`, and the restaurant has no equivalent contract yet.
//   • the raw `Claim.status` — replaced by the derived `RestaurantStatus`. An unmapped raw value would
//     otherwise reach a screen as a key path.
//   • the raw `orderId` — replaced by the order's public reference, the same one the e-mails print.
//   • `Claim.selection` as stored — replaced by a rendered summary. The restaurant reads « 2 × Gnocchi »,
//     not `itemId` / `unitCents` / `modeSource`.

import type { RestaurantStatus } from '@/lib/claim-action-rules'
import type { ClaimFinancialEffect } from '@/lib/claim-financial-effect'
import { readClaimSelection, selectionLineSummary, type ClaimScopeMode } from '@/lib/claim-selection'

/**
 * The financial block AS THE RESTAURANT RECEIVES IT — spec §10's shape exactly: the three figures when
 * confirmed, and `{ confirmed: false }` with NOTHING else when not.
 *
 * The server's own reason (`ledger_line_missing`, `ledger_inconsistent`, `ledger_ambiguous`,
 * `claim_money_state_open`, …) is DIAGNOSIS VOCABULARY: it names what our accounting could not establish,
 * in words written for whoever fixes it. It belongs in the admin surface and the logs, not on a
 * restaurateur's screen, where « ledger_inconsistent » reads as an accusation nobody can act on. Dropping
 * it here is also why the panel has nothing to render but a neutral sentence.
 */
export type RestaurantFinancialEffect =
  | { confirmed: true; customerRefundCents: number; grubanoFeeReturnedCents: number; restaurantNetImpactCents: number; source: 'ledger' }
  | { confirmed: false }

/** What the customer asked for, as the restaurant reads it. Never the stored snapshot's internals. */
export interface RestaurantClaimSelectionView {
  /** The scope the customer chose. The UI turns this into a sentence; the DTO carries no prose. */
  mode: ClaimScopeMode
  /** « 2 × Gnocchi » per disputed line. Empty for 'amount' and 'whole' — those name no line. */
  lines: string[]
  /** What the claim asked for, in cents, as the snapshot froze it. */
  requestedCents: number
}

/** One earlier claim that already named a line of this order. INFORMATIONAL — see S-26. */
export interface PreviouslyClaimedEntryView {
  /** A display handle, not an id: the last six characters of the claim id, upper-cased. */
  claimRef: string
  status: RestaurantStatus
  /** The quantity that earlier claim recorded on this line. Informational. */
  qty: number
  /**
   * The ARTICLE, from the earlier claim's own snapshot. Without it a panel that flattens `byLine` prints
   * « réclamation ABC123 — 1 unité » twice for one claim that named two dishes, and never says WHICH dish —
   * which is the only thing the signal exists to tell a restaurateur.
   */
  name: string
}

export interface PreviouslyClaimedView {
  /** line index → the earlier claims that named it. */
  byLine: Record<number, PreviouslyClaimedEntryView[]>
  /**
   * How many earlier claims on this order name NO line (legacy, mode 'amount', mode 'whole', no lines).
   * Reported so a panel can never imply « no previous claim » when one exists with an unknown scope.
   */
  unattributableCount: number
  /**
   * True when the earlier-claims read was TRUNCATED or failed. « No earlier claim on this line » is then
   * not something we know, and a surface must not imply it. Same discipline as the unattributable count.
   */
  incomplete: boolean
}

/**
 * THE RESTAURANT'S CLAIM. Every key here was decided; there is no pass-through.
 * Adding a key is a deliberate act in this file, and the zero-leak test reads this type's own key list.
 */
export interface RestaurantClaimView {
  id: string
  /** The order's PUBLIC reference (GR-XXXXXX), never the internal id. */
  orderRef: string
  /** Canonical reason code; the UI renders `claims.reason.<code>`. */
  reason: string
  /** Derived business status — never `Claim.status`. */
  status: RestaurantStatus
  /** Batch-2 triage: a safety report floats to the top of the queue. Visibility only. */
  safety: boolean
  /** What the customer asked for. */
  requestedAmountCents: number
  /** What Grubano APPROVED, and only once Grubano has decided. null otherwise. */
  approvedAmountCents: number | null
  /** The customer's own description of the problem — the reason this panel exists. */
  customerMessage: string | null
  photoUrl: string | null
  createdAt: string
  responseDeadlineAt: string
  decidedAt: string | null
  /** The restaurant's own answer, echoed back so the panel can show what it said. */
  restaurantResponse: 'accepted' | 'refused' | null
  restaurantResponseReason: string | null
  /** L7's frozen snapshot, rendered. null = « Sélection non enregistrée » — NEVER read as « whole ». */
  selection: RestaurantClaimSelectionView | null
  previouslyClaimed: PreviouslyClaimedView
  /** T-46: confirmed ledger truth, or a bare « not confirmed » — the diagnosis stays server-side. */
  financialEffect: RestaurantFinancialEffect
  /**
   * Whether the RESPOND route would actually accept an answer right now. Stated rather than inferred
   * from the status, so a button can never name a control the server refuses (the control-parity rule
   * lib/claim-action-rules opens with).
   */
  canRespond: boolean
}

/** The exact key set of the view. Exported so the zero-leak test asserts against ONE list. */
export const RESTAURANT_VIEW_KEYS = [
  'id', 'orderRef', 'reason', 'status', 'safety', 'requestedAmountCents', 'approvedAmountCents',
  'customerMessage', 'photoUrl', 'createdAt', 'responseDeadlineAt', 'decidedAt',
  'restaurantResponse', 'restaurantResponseReason', 'selection', 'previouslyClaimed',
  'financialEffect', 'canRespond',
] as const

/**
 * Field names that must NEVER appear anywhere in a restaurant payload, at any depth. The founder's §20
 * list, plus the ones the customer projection already hides for the same reason. Used by the contract
 * test against the SERIALISED response, so a nested object cannot smuggle one in either.
 */
export const RESTAURANT_FORBIDDEN_KEYS = [
  'consumerId', 'userId', 'refundId', 'refundError', 'refundAttempted', 'activeOrderKey',
  'arbitratedBy', 'decidedBy', 'arbitrationDecision', 'arbitrationReason', 'contestReason', 'contestedAt',
  'stripeRefundId', 'paymentIntentId', 'stripePaymentIntentId', 'chargeId', 'stripeChargeId',
  'grossAmount', 'applicationFeeAmount', 'netToRestaurant', 'sourceEventId',
  'modeSource', 'itemId', 'unitCents',
  // D′ L8: the server's own diagnosis vocabulary. It is written for whoever repairs the accounting, and it
  // must not ride to a restaurant inside the unconfirmed shape.
  'ledger_line_missing', 'ledger_inconsistent', 'ledger_ambiguous', 'claim_money_state_open',
  'refund_not_succeeded', 'refund_id_unknown',
] as const

/** The facts the caller must have read. Written out so no row object can be handed in wholesale. */
export interface RestaurantClaimViewInput {
  id: string
  orderRef: string
  reason: string
  status: RestaurantStatus
  safety: boolean
  requestedAmountCents: number
  /** The stored value; surfaced only when `grubanoDecided` is true. */
  approvedAmountCents: number | null
  /** True when Grubano has taken a decision the restaurant may read an amount from. */
  grubanoDecided: boolean
  description: string | null
  photoUrl: string | null
  createdAt: Date | string
  responseDeadlineAt: Date | string
  decidedAt: Date | string | null
  restaurantResponse: string | null
  restaurantResponseReason: string | null
  /** The raw `Claim.selection` JSON value. Read through L7's reader, never trusted as-is. */
  selection: unknown
  /**
   * The internal order id — supplied ONLY so free text can be redacted against it, never emitted. A
   * system claim's description used to embed the raw cuid (« … commande payée (ckxyz…) »), and the
   * description is surfaced as the customer message: the one raw identifier this contract had missed. The
   * source now writes the public reference, and this replaces it in rows written before that.
   */
  redactOrderId?: string | null
  /** Earlier claims on the SAME order, excluding this one. */
  priorClaims: ReadonlyArray<{ id: string; status: RestaurantStatus; selection: unknown }>
  /** True when that list was truncated or unreadable. */
  priorClaimsIncomplete?: boolean
  financialEffect: ClaimFinancialEffect
  canRespond: boolean
}

const iso = (d: Date | string | null): string | null => {
  if (d === null || d === undefined) return null
  if (typeof d === 'string') return d
  const t = d.getTime()
  return Number.isFinite(t) ? d.toISOString() : null
}

/** A display handle for an earlier claim: six characters, upper-cased. Not an identifier to act on. */
export const claimDisplayRef = (id: string): string => String(id).slice(-6).toUpperCase()

/**
 * Replace the INTERNAL order id with the public reference inside free text, EXACTLY — by string equality
 * with the id we already hold, never by guessing what a cuid looks like. A pattern would either miss an id
 * or redact a customer's own words; this cannot do either.
 */
export function redactOrderId(text: string | null, orderId: string | null, orderRef: string): string | null {
  if (text === null || text === undefined) return null
  if (!orderId || typeof orderId !== 'string' || orderId.length < 8) return text
  return text.split(orderId).join(orderRef)
}

/**
 * Build the restaurant's view. Total and explicit: every output key is assigned here, so nothing can be
 * carried over from a row, and a field that must be hidden is hidden by not existing rather than by being
 * deleted afterwards (a delete list is one forgotten entry away from a leak).
 */
export function buildRestaurantClaimView(input: RestaurantClaimViewInput): RestaurantClaimView {
  const snap = readClaimSelection(input.selection)
  const selection: RestaurantClaimSelectionView | null = snap === null ? null : {
    mode: snap.mode,
    // Locale-free « 2 × Gnocchi » lines, and only for a selection that names lines.
    lines: selectionLineSummary(snap),
    requestedCents: snap.requestedCents,
  }

  // ── previouslyClaimed — A SIGNAL, WITH NOTHING TO CONSUME (S-26) ───────────────────────────────
  // Built here from snapshots the caller already read, and carrying no quantity budget, no ceiling and
  // no verdict: an earlier claim on the same dish is a reason for a human to look, never a reason for
  // the product to refuse. The unattributable COUNT is reported because an earlier claim whose scope is
  // unknown (legacy `null`) or order-wide must not read as « no previous claim on this line ».
  const byLine: Record<number, PreviouslyClaimedEntryView[]> = {}
  let unattributableCount = 0
  for (const prior of input.priorClaims) {
    const ps = readClaimSelection(prior.selection)
    if (!ps || ps.mode !== 'items' || ps.lines.length === 0) { unattributableCount += 1; continue }
    for (const l of ps.lines) {
      const bucket = byLine[l.index] ?? (byLine[l.index] = [])
      bucket.push({
        claimRef: claimDisplayRef(prior.id), status: prior.status,
        qty: Math.max(0, Math.floor(l.qty)),
        // The name the EARLIER claim froze, not the current one's: the two snapshots are independent, and
        // the article this line concerned is the point of the signal.
        name: typeof l.name === 'string' ? l.name : '',
      })
    }
  }

  const response = input.restaurantResponse === 'accepted' || input.restaurantResponse === 'refused'
    ? input.restaurantResponse
    : null

  return {
    id: input.id,
    orderRef: input.orderRef,
    reason: input.reason,
    status: input.status,
    safety: input.safety === true,
    requestedAmountCents: input.requestedAmountCents,
    // §1: visible only once Grubano has decided. Before that the number exists in the database and means
    // nothing to the restaurant — showing it would announce a decision that has not been taken.
    approvedAmountCents: input.grubanoDecided ? input.approvedAmountCents : null,
    customerMessage: redactOrderId(input.description ?? null, input.redactOrderId ?? null, input.orderRef),
    photoUrl: input.photoUrl ?? null,
    createdAt: iso(input.createdAt) ?? '',
    responseDeadlineAt: iso(input.responseDeadlineAt) ?? '',
    decidedAt: iso(input.decidedAt),
    restaurantResponse: response,
    // The restaurant's own words, echoed back. Only meaningful beside its own refusal.
    restaurantResponseReason: response === 'refused' ? (input.restaurantResponseReason ?? null) : null,
    selection,
    previouslyClaimed: { byLine, unattributableCount, incomplete: input.priorClaimsIncomplete === true },
    // The diagnosis is dropped here, deliberately — see RestaurantFinancialEffect.
    financialEffect: input.financialEffect.confirmed
      ? {
          confirmed: true,
          customerRefundCents: input.financialEffect.customerRefundCents,
          grubanoFeeReturnedCents: input.financialEffect.grubanoFeeReturnedCents,
          restaurantNetImpactCents: input.financialEffect.restaurantNetImpactCents,
          source: 'ledger',
        }
      : { confirmed: false },
    canRespond: input.canRespond === true,
  }
}
