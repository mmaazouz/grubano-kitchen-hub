// ── Franchise POS order-tagging kill-switch (B5, Agent 45) ───────────────────────
//
// When ON, POST /api/orders stamps Order.pointOfSaleId = restaurant.pointOfSaleId
// (the 1:1 link posed by B2/B3), DERIVED SERVER-SIDE from the loaded restaurant —
// never from client input. This is what makes Franchise-A (held-back accrual, itself
// still gated by FRANCHISE_ROYALTY_ENABLED) and the franchise my-dashboard come alive.
//
// Default OFF: the order-creation `data` is byte-identical to before this brick
// (pointOfSaleId is not set on the create → stays null, exactly as today). Strict
// `=== 'true'` read, same pattern as isFranchiseRoyaltyEnabled / isFranchiseSettlementEnabled.
export function isFranchisePosTaggingEnabled(): boolean {
  return process.env.FRANCHISE_POS_TAGGING_ENABLED === 'true'
}
