// ── Payout minimum threshold — SINGLE SOURCE (Brique D2, Agent 64) ────────────────────
// Both the CREATOR rail (lib/creator-payout.minPayoutCents → payPartner, and
// lib/creator-earnings.PAYOUT_THRESHOLD_CENTS → the earnings progress UI) and the
// AFFILIATE rail read this ONE function. Before D2 the threshold was split across two
// constants both at 2000 €c; D2 unifies them to the doctrine 25 € (2500 €c) — env
// CREATOR_PAYOUT_MIN_CENTS overrides. Zero deps so it never creates an import cycle
// between the payout and earnings modules. NOT money movement — a read-only constant.

export function payoutMinCents(): number {
  const v = Number.parseInt(process.env.CREATOR_PAYOUT_MIN_CENTS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 2500
}
