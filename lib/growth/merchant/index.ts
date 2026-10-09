// ── Growth / merchant — barrel ────────────────────────────────────────────────────────
//
// Single import surface for consumers of the merchant qualification lot. Export-only;
// no logic.

export * from './normalize'
export * from './dedup'
export * from './scoring'
export * from './lifecycle'
export * from './next-action'
export * from './approval'
export * from './pipeline'
export * as merchantFixtures from './fixtures'
