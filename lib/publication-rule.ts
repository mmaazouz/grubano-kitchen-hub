// ── Restaurant publication rule (B2.4 / SEC2, Agent 33) ───────────────────────
//
// The single source of truth for WHO may flip Restaurant.isActive and WHEN. It
// owns the SEC1 invariant + the SEC2 approvedAt rule, so both write surfaces
// (PATCH /api/restaurants/[id] and .../pause) share one tested decision.
//
// Definitions: a restaurant is "approved" once approvedAt != null. Visibility on
// /eat is gated by isActive only (unchanged) — this rule only governs the WRITE.
//
// RULES:
//   • OWNER, go live (isActive→true): allowed ONLY if approvedAt != null
//     (resume an already-approved resto). A never-approved resto (approvedAt==null)
//     can be brought live ONLY by an admin → rejected here (SEC1 invariant).
//   • OWNER, go offline (isActive→false): always allowed (pause / unpublish).
//   • PAUSE-CAPTURE (forward-only catch-up, no backfill): when a resto goes
//     true→false while approvedAt is still null, stamp approvedAt=now — it was
//     LIVE, therefore it had been approved, so its owner may resume it later. This
//     can never fabricate a false "approved": a never-approved resto is never live
//     (the rule above blocks owner-publish, and admin-publish stamps approvedAt),
//     so currentIsActive is false for it and no stamp occurs.
//   • ADMIN: may go live or offline at any time; publishing stamps approvedAt if
//     it was not yet set (admin go-live = approval).

export interface PublicationInput {
  isAdmin:         boolean
  /** The requested isActive value. */
  requested:       boolean
  /** The restaurant's current isActive (DB) — drives pause-capture. */
  currentIsActive: boolean
  /** The restaurant's approvedAt (DB): null = never approved. */
  approvedAt:      Date | null
}

export interface PublicationDecision {
  /** The isActive value to write (meaningful only when !rejected). */
  setIsActive:     boolean
  /** Also set approvedAt = now in the same write. */
  stampApprovedAt: boolean
  /** True when an OWNER tried to publish a never-approved resto → caller refuses
   *  (403 on /pause, silent strip on the profile PATCH) and writes NO isActive. */
  rejected:        boolean
}

export function decidePublication(o: PublicationInput): PublicationDecision {
  // Going (or staying) OFFLINE — always allowed. Pause-capture stamps a live-but-
  // unstamped resto so its owner can resume it after the pause.
  if (o.requested === false) {
    return {
      setIsActive:     false,
      stampApprovedAt: o.currentIsActive === true && o.approvedAt == null,
      rejected:        false,
    }
  }

  // Going LIVE.
  if (o.isAdmin) {
    // Admin may always publish; stamp the approval if not yet stamped.
    return { setIsActive: true, stampApprovedAt: o.approvedAt == null, rejected: false }
  }
  if (o.approvedAt != null) {
    // Owner resuming an already-approved resto.
    return { setIsActive: true, stampApprovedAt: false, rejected: false }
  }
  // Owner + never approved → cannot self-publish (SEC1 invariant).
  return { setIsActive: false, stampApprovedAt: false, rejected: true }
}
