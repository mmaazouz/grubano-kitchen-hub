// ── WHICH EXISTING REFUND ROW MAY BE ATTRIBUTED TO A PARKED CLAIM (T-49, round-8 audit fix) ──
//
// WHY THIS IS A MODULE. Three times a guard was added to attributeClaimRefund without the matching
// disable in the console — round 3 (the binding), round 7 (another claim's stamp), round 8 (this
// claim's own stamp) — and each time the operator was offered « Attribuer » on a row the server
// was always going to refuse. The server and the console now ask ONE pure function the same
// question, so a refusal cannot exist on one side only. A parity test holds them together
// (tests/claims-t49-round9.test.ts).
//
// No I/O here: the caller reads the rows and the bindings; this decides.

export type AttributionRefusalCode =
  | 'stamped_for_other_claim'
  | 'own_stamp_exists'
  | 'bound_to_other_claim'
  | 'unusable_status'
  | 'pending_unconfirmed'

export type AttributionRefusal = { code: AttributionRefusalCode; status: 409; message: string }

/** The identity stamp the engine writes on a claim's Refund row. MUST equal lib/claims claimRefundReason. */
export const claimStamp = (claimId: string) => `claim:${claimId}`

export function attributionRefusal(input: {
  claimId: string
  row: { id: string; status: string; reason: string | null; stripeRefundId: string | null }
  /** Every Refund row of the claim's order (id + reason), the candidate included. */
  orderRows: ReadonlyArray<{ id: string; reason: string | null }>
  /** A claim OTHER than this one already bound to the row, or null. */
  boundToOtherClaimId: string | null
}): AttributionRefusal | null {
  const own = claimStamp(input.claimId)
  const { row } = input

  // T-51: reason IS identity. A row stamped for another claim answers for that claim.
  if (typeof row.reason === 'string' && row.reason.startsWith('claim:') && row.reason !== own) {
    return {
      code: 'stamped_for_other_claim', status: 409,
      message: `Ce remboursement porte l’identité de la réclamation ${row.reason.slice('claim:'.length)} — attribution refusée.`,
    }
  }
  // One identity, one row: while a row stamped for THIS claim exists, only that one may be bound.
  // Binding another would close the claim on somebody else's refund and leave the claim's own
  // refund claim-less — its later webhook would land as `no_claim`.
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
  // Our row pending with NO Stripe id is the crash window itself: nothing is confirmed at Stripe.
  // Binding it would take the claim out of the evidence population (round-8 audit, P1).
  if (row.status === 'pending' && !row.stripeRefundId) {
    return {
      code: 'pending_unconfirmed', status: 409,
      message: 'Cette ligne est en attente SANS identifiant Stripe : rien n’est confirmé chez Stripe. Elle n’avancera que si Stripe a réellement créé ce remboursement (son webhook l’appliquera) ou si le moteur de remboursement la reprend (fenêtre remboursements ouverte) ; réconciliez ensuite d’après la preuve.',
    }
  }
  return null
}
