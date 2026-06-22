/**
 * Supplier marketplace-COHERENCE trigger (Agent 111 — lean signup étape 2).
 *
 * The anti-abuse coherence check (vetSupplier) used to run at SIGNUP on the
 * declared offer. With the lean signup that offer no longer exists at signup, so
 * the check is DEPLACED here — to the "ready to publish" transition — where it runs
 * on the supplier's REAL profile offer + catalogue, BEFORE the supplier becomes
 * visible to restaurants. The anti-abuse is PRESERVED, not removed: a coherence
 * failure keeps the supplier HIDDEN from the marketplace (marketplaceCoherencePending
 * stays true) until an admin clears it.
 *
 * VISIBILITY MODEL: a SIREN-verified supplier is created status='active' (can log in
 * + build its catalogue) but marketplaceCoherencePending=true (invisible). The
 * marketplace reader gates on status='active' AND marketplaceCoherencePending=false.
 * This helper is the ONLY automatic path that clears the flag (legit verdict);
 * /api/admin/suppliers/coherence is the admin override.
 *
 * IDEMPOTENT + QUOTA-SAFE under concurrency: vetSupplier runs AT MOST ONCE per
 * supplier, ever. A fast-path read skips the obvious cases (already cleared, already
 * vetted, offer not filled, no catalogue) WITHOUT a write. When genuinely eligible,
 * it then performs an ATOMIC DB-LEVEL CLAIM — a conditional updateMany that flips
 * vettingAt from null to now ONLY for a still-unclaimed/unvetted row. Exactly ONE
 * concurrent request wins the claim (count===1) and proceeds to vetSupplier; every
 * other concurrent request gets count===0 and bails out, so two simultaneous
 * profile-saves / item-adds can never double-call the (quota-metered) LLM. It REUSES
 * vetSupplier (lib/supplier-vetting) + the capped LLM gateway unchanged — no new LLM
 * surface. A cleared (pending=false) supplier is never re-vetted on later edits.
 *
 * Best-effort: it NEVER throws — a failure leaves the supplier safely invisible
 * (pending) and never breaks the profile-save / catalogue-item call that triggered it.
 * NON-money: it only flips a visibility flag (payouts stay hard-gated by Stripe
 * Connect KYB; login + catalogue mutation stay on `status`).
 */

import { prisma } from '@/lib/prisma'
import { vetSupplier } from '@/lib/supplier-vetting'

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Run the coherence check at the "ready to publish" transition, if and only if the
 * supplier is eligible (see the fast-path guard + the atomic claim). On 'legit' →
 * clear the flag (visible); on 'doubt'/'bad' → leave it set (invisible, surfaced to
 * the admin review queue).
 */
export async function maybeRunSupplierCoherenceCheck(profileId: string): Promise<void> {
  try {
    const p = await prisma.supplierProfile.findUnique({
      where:  { id: profileId },
      select: {
        id: true, status: true, marketplaceCoherencePending: true, vettingVerdict: true,
        companyName: true, contactName: true, city: true,
        categories: true, deliveryZones: true, paymentTerms: true,
        _count: { select: { catalogItems: true } },
      },
    })
    if (!p) return

    // ── FAST-PATH guard — skip the obvious non-eligible cases without any write ──
    if (p.status !== 'active') return                  // not operational (SIREN not verified) — nothing to publish
    if (p.marketplaceCoherencePending !== true) return // already visible (cleared) — never re-vet
    if (p.vettingVerdict !== null) return              // already auto-vetted (doubt/bad → admin) — never auto-retry

    const categories    = asStringArray(p.categories)
    const deliveryZones = asStringArray(p.deliveryZones)
    if (categories.length === 0) return                // offer not filled yet — wait
    if (p._count.catalogItems < 1) return              // no catalogue item yet — wait

    // ── ATOMIC CLAIM — exactly ONE concurrent request may proceed to vet ──
    // Conditional updateMany on scalar columns only: flip vettingAt null→now for a row
    // that is STILL active + pending + unvetted (verdict null) + unclaimed (vettingAt null).
    // The DB serializes this, so concurrent profile-saves / item-adds cannot both win →
    // vetSupplier (quota-metered) runs AT MOST ONCE. A lost claim (count===0) bails out.
    const claim = await prisma.supplierProfile.updateMany({
      where: {
        id: p.id, status: 'active', marketplaceCoherencePending: true,
        vettingVerdict: null, vettingAt: null,
      },
      data: { vettingAt: new Date() },
    })
    if (claim.count === 0) return // another concurrent request already claimed/cleared it — no double vet

    // We own the check → reuse the EXISTING vetSupplier (not forked) on the REAL offer + catalogue.
    const vet = await vetSupplier({
      companyName:   p.companyName,
      contactName:   p.contactName,
      city:          p.city ?? undefined,
      categories,
      deliveryZones,
      paymentTerms:  p.paymentTerms ?? undefined,
    })

    await prisma.supplierProfile.update({
      where: { id: p.id },
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
    // Best-effort: leave the supplier safely invisible (pending) and never break the caller.
    console.error('[supplier-coherence] non-fatal:', err instanceof Error ? err.message : err)
  }
}
