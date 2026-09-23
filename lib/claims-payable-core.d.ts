// Type surface of lib/claims-payable-core.js (plain CommonJS shared with the server operator).
// D′ lot L5, spec v2 §8.5 / §8.8 — ONE definition of « payable by the financial rail ».

/** A row of the payable selection, as `PAYABLE_SELECT` projects it. */
export interface PayableClaimRow {
  id: string
  orderId: string
  requestedAmountCents: number
  approvedAmountCents: number | null
  arbitratedAt: Date | null
  arbitrationReason: string | null
  createdAt: Date
}

/** What a dryRun signs and a PAYER re-checks, per claim (spec v2 §8.2). */
export interface PayableItemIdentity {
  claimId: string
  approvedAmountCents: number | null
  arbitratedAt: string | null
}

export const MAX_BATCH: 20

/**
 * APPROVED_AWAITING_PAYMENT. Declared with literal types so it is assignable to
 * `Prisma.ClaimWhereInput` without widening `refundId: null` to `string | null`.
 */
export const PAYABLE_WHERE: {
  readonly status: 'approved'
  readonly arbitrationDecision: 'approved'
  readonly refundAttempted: false
  readonly refundId: null
  readonly refundError: null
  readonly approvedAmountCents: { readonly not: null }
}

export const PAYABLE_ORDER_BY: readonly [{ readonly arbitratedAt: 'asc' }, { readonly createdAt: 'asc' }]

export const PAYABLE_SELECT: {
  readonly id: true
  readonly orderId: true
  readonly requestedAmountCents: true
  readonly approvedAmountCents: true
  readonly arbitratedAt: true
  readonly arbitrationReason: true
  readonly createdAt: true
}

export function clampTake(take: unknown): number

/** Structural: any client exposing `claim.findMany` (the app singleton, an operator's own, a double). */
export function selectPayableClaims(
  prisma: { claim: { findMany: (args: unknown) => Promise<unknown[]> } },
  options?: { take?: number },
): Promise<PayableClaimRow[]>

/** null ⇔ 1 ≤ approvedAmountCents ≤ requestedAmountCents (S-10); otherwise the reason. */
export function approvedAmountRefusal(
  row: { approvedAmountCents?: number | null; requestedAmountCents?: number | null } | null | undefined,
): 'missing' | 'amount_not_ratified' | 'amount_above_requested' | null

export function sumApprovedCents(rows: ReadonlyArray<{ approvedAmountCents: number | null }>): number

export function itemIdentity(row: { id: string; approvedAmountCents: number | null; arbitratedAt: Date | string | null }): PayableItemIdentity

export function sameIdentity(
  signed: PayableItemIdentity | null | undefined,
  row: { id: string; approvedAmountCents: number | null; arbitratedAt: Date | string | null } | null | undefined,
): boolean
