// Type surface of lib/ledger-check-core.js (plain CommonJS shared with the server operator).
export interface LedgerCheckEcart { kind: string; [k: string]: unknown }
export interface LedgerRefundsBlock {
  ledgerCount: number; stripeCount: number; ledgerSum: number; stripeSum: number; checked: boolean
}
export interface LedgerCheckResult {
  ok: boolean
  internalOk: boolean
  reconciliationOk: boolean
  refundsOk: boolean
  from: string; to: string
  ledgerCount: number; stripeCount: number; ledgerSum: number; stripeSum: number
  refunds: LedgerRefundsBlock
  aggregates: { gross: number; applicationFee: number; netToRestaurant: number }
  ecarts: LedgerCheckEcart[]
}
export interface ReconcileLedgerParams {
  // Structural: the Prisma client (ledgerEntry.findMany) and a Stripe client
  // (paymentIntents.list / refunds.list with autoPagingToArray).
  prisma: unknown
  stripe: unknown
  from: Date
  to: Date
  warn?: (msg: string) => void
}
export function reconcileLedger(p: ReconcileLedgerParams): Promise<LedgerCheckResult>
export function resolveWindow(fromParam: string | null, toParam: string | null, now?: Date):
  { from: Date; to: Date; error?: undefined } | { error: string; from?: undefined; to?: undefined }
export const DEFAULT_WINDOW_MS: number
export const STRIPE_PAGE_CAP: number
