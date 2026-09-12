// ── WHICH EXISTING REFUND ROW MAY BE ATTRIBUTED TO A PARKED CLAIM, AND WHAT PROVES IDENTITY (T-49) ──
//
// WHY THIS IS A MODULE. Three times a guard was added to attributeClaimRefund without the matching
// disable in the console — round 3 (the binding), round 7 (another claim's stamp), round 8 (this
// claim's own stamp) — and each time the operator was offered « Attribuer » on a row the server
// was always going to refuse. The server and the console now ask ONE pure function the same
// question, so a refusal cannot exist on one side only. A parity test holds them together
// (tests/claims-t49-round9.test.ts).
//
// ROUND 13 (spec slice W1): the identity predicates live here too — the stamp reader (B1), the owners
// of a Stripe refund (B3), the three identity proofs (B2) — and the refusal order of B10.
//
// No I/O here: the caller reads the rows and the bindings; this decides.

export type AttributionRefusalCode =
  | 'other_order'
  | 'stamped_for_other_claim'
  | 'own_stamp_exists'
  | 'bound_to_other_claim'
  | 'unusable_status'
  | 'row_failed'

export type AttributionRefusal = { code: AttributionRefusalCode; status: 400 | 409; message: string }

/** The identity stamp the engine writes on a claim's Refund row. MUST equal lib/claims claimRefundReason. */
export const claimStamp = (claimId: string) => `claim:${claimId}`

/** B1: the claim a row's reason stamps, or null for an unstamped row. */
export function stampedClaimId(reason: string | null | undefined): string | null {
  return typeof reason === 'string' && reason.startsWith('claim:') ? reason.slice('claim:'.length) : null
}

/**
 * B3 owners(s): the order's rows that record this Stripe refund — by its id, or by the engine's
 * grubano_refund_row tag — whatever the row status. Exactly one owner: the refund belongs to whatever
 * claim that row belongs to (B2). Zero or several: it belongs to no claim.
 */
export function ownersOf<R extends { id: string; stripeRefundId?: string | null }>(
  refund: { id: string; metadata?: { grubano_refund_row?: string | null } | null },
  rows: ReadonlyArray<R>,
): R[] {
  const tag = refund.metadata?.grubano_refund_row ?? null
  return rows.filter((row) => (!!row.stripeRefundId && row.stripeRefundId === refund.id) || (!!tag && row.id === tag))
}

/**
 * B2: the identity proof a row carries for a claim — 'stamp' (row.reason === claim:C) or 'bind'
 * (C.refundId === row.id, C not resume_mismatch, row unstamped). A row stamped for another claim proves
 * nothing for C, and nothing else — amount, order, timing, the operator's word — ever proves identity.
 * (P-attr is the binding the attribution transaction writes: once written it reads as 'bind'.)
 */
export function identityProof(
  row: { id: string; reason: string | null | undefined },
  claim: { id: string; refundId?: string | null; refundError?: string | null },
): 'stamp' | 'bind' | null {
  if (row.reason === claimStamp(claim.id)) return 'stamp'
  const mismatch = typeof claim.refundError === 'string' && claim.refundError.startsWith('resume_mismatch')
  if (claim.refundId === row.id && !mismatch && stampedClaimId(row.reason) === null) return 'bind'
  return null
}

/** B10 (6): the refusal text of a FAILED row. */
export const ROW_FAILED_MESSAGE =
  'Cette ligne est ÉCHOUÉE : elle ne verse rien et ne peut solder aucune réclamation. Rien n’a été écrit. « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande.'

/**
 * B10 attributionRefusal, evaluated in this order: (1) a row of another order (400); (2) another
 * claim's stamp; (3) this claim's own stamp beside an unstamped row; (4) a binding to another claim
 * (its id from boundToWhere, B1); (5) an unusable status; (6) a failed row.
 */
export function attributionRefusal(input: {
  claimId: string
  /** The claim's order. With row.orderId, (1) applies; the console lists rows of the claim's order only. */
  claimOrderId?: string
  row: { id: string; orderId?: string; status: string; reason: string | null; stripeRefundId: string | null }
  /** Every Refund row of the claim's order (id + reason), the candidate included. */
  orderRows: ReadonlyArray<{ id: string; reason: string | null }>
  /** A claim OTHER than this one counted as a binder of the row (boundToWhere), or null. */
  boundToOtherClaimId: string | null
}): AttributionRefusal | null {
  const own = claimStamp(input.claimId)
  const { row } = input

  // THE anchor: a claim may only ever be attributed a refund of its OWN order.
  if (input.claimOrderId !== undefined && row.orderId !== undefined && row.orderId !== input.claimOrderId) {
    return { code: 'other_order', status: 400, message: 'Ce remboursement appartient à une autre commande — attribution refusée.' }
  }
  // T-51: reason IS identity. A row stamped for another claim answers for that claim.
  const stamp = stampedClaimId(row.reason)
  if (stamp !== null && row.reason !== own) {
    return {
      code: 'stamped_for_other_claim', status: 409,
      message: `Ce remboursement porte l’identité de la réclamation ${stamp} — attribution refusée.`,
    }
  }
  // One identity, one row: while a row stamped for THIS claim exists, only that one may be bound.
  if (row.reason !== own) {
    const stamped = input.orderRows.find((r) => r.reason === own && r.id !== row.id)
    if (stamped) {
      return {
        code: 'own_stamp_exists', status: 409,
        message: `Une ligne de remboursement porte déjà l’identité de cette réclamation (${stamped.id}) — attribuez celle-là, ou utilisez « Réconcilier d’après la preuve ».`,
      }
    }
  }
  // One refund cannot settle two claims.
  if (input.boundToOtherClaimId) {
    return {
      code: 'bound_to_other_claim', status: 409,
      message: `Ce remboursement est déjà lié à la réclamation ${input.boundToOtherClaimId} — une même somme ne peut pas solder deux réclamations.`,
    }
  }
  if (row.status !== 'succeeded' && row.status !== 'failed' && row.status !== 'pending') {
    return { code: 'unusable_status', status: 409, message: 'Statut de remboursement inexploitable.' }
  }
  // B10 (6): a failed row pays nothing and can settle no claim.
  if (row.status === 'failed') return { code: 'row_failed', status: 409, message: ROW_FAILED_MESSAGE }
  // A pending row is attributable: Stripe's evidence for it decides what the binding means.
  return null
}
