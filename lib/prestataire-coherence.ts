/**
 * Prestataire marketplace-COHERENCE trigger (Agent 112 — lean signup, calque of
 * lib/supplier-coherence / Agent 111).
 *
 * The anti-abuse coherence check (vetPrestataire) used to run at SIGNUP on the declared
 * offer. With the lean signup that offer no longer exists at signup, so the check is
 * DEPLACED here — to the "ready to publish" transition — where it runs on the
 * prestataire's REAL profile offer + service listings, BEFORE the prestataire becomes
 * visible to restaurants. The anti-abuse is PRESERVED, not removed: a coherence failure
 * keeps the prestataire HIDDEN from the directory (marketplaceCoherencePending stays true)
 * until an admin clears it.
 *
 * VISIBILITY MODEL: a SIREN-verified prestataire is created status='active' (can log in +
 * list its services) but marketplaceCoherencePending=true (invisible). The marketplace
 * reader gates on status='active' AND marketplaceCoherencePending=false. This helper is the
 * ONLY automatic path that clears the flag (legit verdict);
 * /api/admin/prestataires/coherence is the admin override.
 *
 * IDEMPOTENT + QUOTA-SAFE under concurrency: vetPrestataire runs AT MOST ONCE per
 * prestataire, ever. A fast-path read skips the obvious cases (already cleared, already
 * vetted, offer not filled, no service) WITHOUT a write. When genuinely eligible, it then
 * performs an ATOMIC DB-LEVEL CLAIM — a conditional updateMany that flips vettingAt from
 * null to now ONLY for a still-unclaimed/unvetted row. Exactly ONE concurrent request wins
 * the claim (count===1) and proceeds to vetPrestataire; every other concurrent request gets
 * count===0 and bails out, so two simultaneous profile-saves / service-adds can never
 * double-call the (quota-metered) LLM. It REUSES vetPrestataire (lib/prestataire-vetting) +
 * the capped LLM gateway unchanged — no new LLM surface. A cleared (pending=false)
 * prestataire is never re-vetted on later edits. The final write is itself a GUARDED
 * updateMany (where pending:true + verdict:null) so an admin override
 * (/api/admin/prestataires/coherence) landing DURING the in-flight vet call is never
 * clobbered — the admin decision always wins.
 *
 * Best-effort: it NEVER throws — a failure leaves the prestataire safely invisible
 * (pending) and never breaks the profile-save / service call that triggered it. NON-money:
 * it only flips a visibility flag (any future payout stays hard-gated by Stripe Connect KYB;
 * login + service mutation stay on `status`).
 */

import { prisma } from '@/lib/prisma'
import { vetPrestataire } from '@/lib/prestataire-vetting'

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Run the coherence check at the "ready to publish" transition, if and only if the
 * prestataire is eligible (see the fast-path guard + the atomic claim). On 'legit' → clear
 * the flag (visible); on 'doubt'/'bad' → leave it set (invisible, surfaced to the admin
 * review queue).
 */
export async function maybeRunPrestataireCoherenceCheck(profileId: string): Promise<void> {
  try {
    const p = await prisma.prestataireProfile.findUnique({
      where:  { id: profileId },
      select: {
        id: true, status: true, marketplaceCoherencePending: true, vettingVerdict: true,
        companyName: true, contactName: true, city: true,
        serviceCategories: true, coverageZones: true, indicativeRate: true,
        _count: { select: { serviceOfferings: true } },
      },
    })
    if (!p) return

    // ── FAST-PATH guard — skip the obvious non-eligible cases without any write ──
    if (p.status !== 'active') return                  // not operational (SIREN not verified) → nothing to publish
    if (p.marketplaceCoherencePending !== true) return // already visible (cleared) → never re-vet
    if (p.vettingVerdict !== null) return              // already auto-vetted (doubt/bad → admin) → never auto-retry

    const serviceCategories = asStringArray(p.serviceCategories)
    const coverageZones     = asStringArray(p.coverageZones)
    if (serviceCategories.length === 0) return         // offer not filled yet → wait
    if (p._count.serviceOfferings < 1) return          // no service listing yet → wait

    // ── ATOMIC CLAIM — exactly ONE concurrent request may proceed to vet ──
    // Conditional updateMany on scalar columns only: flip vettingAt null→now for a row that is
    // STILL active + pending + unvetted (verdict null) + unclaimed (vettingAt null). The DB
    // serializes this, so concurrent profile-saves / service-adds cannot both win →
    // vetPrestataire (quota-metered) runs AT MOST ONCE. A lost claim (count===0) bails out.
    const claim = await prisma.prestataireProfile.updateMany({
      where: {
        id: p.id, status: 'active', marketplaceCoherencePending: true,
        vettingVerdict: null, vettingAt: null,
      },
      data: { vettingAt: new Date() },
    })
    if (claim.count === 0) return // another concurrent request already claimed/cleared it — no double vet

    // We own the check → reuse the EXISTING vetPrestataire (not forked) on the REAL offer + services.
    const vet = await vetPrestataire({
      companyName:       p.companyName,
      contactName:       p.contactName,
      city:              p.city ?? undefined,
      serviceCategories,
      coverageZones,
      indicativeRate:    p.indicativeRate ?? undefined,
    })

    // GUARDED write (updateMany, not update) — persist the verdict ONLY if the row is STILL the
    // one we claimed (pending + unvetted). If an admin cleared marketplaceCoherencePending (made
    // it visible) via /api/admin/prestataires/coherence DURING the vetPrestataire call above, this
    // matches 0 rows and we DO NOT clobber the admin decision — the admin override always wins. (A
    // 'doubt'/'bad' verdict completing after an admin approval must never silently re-hide it.)
    await prisma.prestataireProfile.updateMany({
      where: { id: p.id, marketplaceCoherencePending: true, vettingVerdict: null },
      data: {
        vettingVerdict: vet.verdict,
        vettingReason:  vet.reason,
        vettingAt:      new Date(),
        // 'legit' → publish (visible to restaurants). 'doubt'/'bad' → stay invisible (pending)
        // and surface in the admin review queue — the anti-abuse holds before visibility.
        marketplaceCoherencePending: vet.verdict !== 'legit',
      },
    })
  } catch (err) {
    // Best-effort: leave the prestataire safely invisible (pending) and never break the caller.
    console.error('[prestataire-coherence] non-fatal:', err instanceof Error ? err.message : err)
  }
}
