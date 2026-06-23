// ── Consumer redesign flag (Phase 1, Agent 127) ───────────────────────────────
// Gates the low-fidelity clickable WIREFRAMES of the new consumer purchase path
// (app/[locale]/eat-next/*). Default OFF → every eat-next route notFound()s and the
// CURRENT /eat app is byte-identical. NO money is wired behind this flag (the
// wireframe checkout is a structural mock — it never calls /api/orders or /pay).
export function isConsumerRedesignEnabled(): boolean {
  return process.env.CONSUMER_REDESIGN_ENABLED === 'true'
}
