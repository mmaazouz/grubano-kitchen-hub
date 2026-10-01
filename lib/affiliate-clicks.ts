import { prisma } from '@/lib/prisma'

// ── Affiliate click tracking (Phase 6 Brique C, Agent 60) — privacy-safe ─────────────
// recordAffiliateClick resolves the AFFILIATE owning a clicked /ref code and inserts a
// privacy-safe ReferralClick (operator id + code + timestamp; NO PII). It is called
// BEST-EFFORT from GET /api/ref/[code] (the caller gates on AFFILIATE_ENABLED and swallows
// any error so the cookie/redirect stay byte-identical). NO money — a pure counter.

/** Record a click if `rawCode` belongs to a top-level affiliate. Returns true if recorded.
 *  Resolves by referralCode (upper) OR referralLinkSlug (lower), mirroring /api/ref. */
export async function recordAffiliateClick(rawCode: string): Promise<boolean> {
  const code = (rawCode || '').trim()
  if (!code) return false
  const affiliate = await prisma.affiliate.findFirst({
    where:  { OR: [{ referralCode: code.toUpperCase() }, { referralLinkSlug: code.toLowerCase() }] },
    select: { operatorId: true, referralCode: true },
  })
  if (!affiliate) return false
  await prisma.referralClick.create({
    data: { affiliateId: affiliate.operatorId, code: affiliate.referralCode },
  })
  return true
}

/** Total clicks recorded for an affiliate (operator id). READ-ONLY. */
export async function countAffiliateClicks(operatorId: string): Promise<number> {
  return prisma.referralClick.count({ where: { affiliateId: operatorId } })
}
