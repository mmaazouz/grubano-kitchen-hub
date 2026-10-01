import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { addRoleToOperator } from '@/lib/operator-roles'

// ── Affiliate account bridge (Phase 6 Brique A, Agent 58) ─────────────────────────
//
// Promotes a connected Operator to a FIRST-CLASS affiliate (decision Agent 0 /
// Mohammed — DISTINCT from the creator's `isInfluencer` sub-flag). UNLIKE the four
// existing bridges (ensureCreator/Supplier/Logistics/Franchise) which grant their role
// ONLY at activate:true (post-vetting), the affiliate is granted INSTANTLY at signup,
// with NO upfront verification (doctrine "lien de parrainage instantané"):
//   (a) addRoleToOperator(operatorId, 'affiliate') — the role SET grant (idempotent),
//   (b) create the Affiliate entity (1:1 with the Operator, operatorId @unique),
//   (c) mint a referral code/slug INSTANTLY (unique across BOTH Affiliate AND Creator
//       so Brique B can resolve either rail without collision).
//
// SECURITY: the instant grant gives NO money access — it only lets the user share a
// link. The credit (attribution) is Brique B; the withdrawal+KYC gate is Brique D. So
// the abuse surface is "minting links": bounded by (1) the AFFILIATE_ENABLED flag,
// (2) the route-level rate-limit, and (3) IDEMPOTENCE here — a re-join NEVER creates a
// second entity or a second code (operatorId @unique + the read-before-write below).
//
// MONEY: this module writes ONLY the role SET + the Affiliate identity row. It NEVER
// touches an Order / charge / commission / ledger / payout. Best-effort role grant
// (addRoleToOperator is tolerant): if it ever fails, the Affiliate row is still the
// durable artifact and a re-join re-attempts the grant.

/** Kill-switch — default OFF. Only the exact string 'true' enables the affiliate role. */
export function isAffiliateEnabled(): boolean {
  return process.env.AFFILIATE_ENABLED === 'true'
}

export interface AffiliateIdentity {
  id:               string
  operatorId:       string
  referralCode:     string
  referralLinkSlug: string
  status:           string
}

export type EnsureAffiliateResult =
  | { ok: true; created: boolean; roleAdded: boolean; affiliate: AffiliateIdentity }
  | { ok: false; reason: 'disabled' | 'operator_not_found' | 'error' }

/**
 * Mint a referral code unique across BOTH the Affiliate AND the Creator tables (so the
 * /ref namespace stays collision-free and Brique B can resolve either rail). Same shape
 * as the creator mint: <FIRST WORD OF NAME, A-Z0-9> + short random suffix. Deliberately
 * NOT extracted from the creator verify route — that file stays byte-identical; this is
 * a self-contained twin checking the union of both code spaces.
 */
async function mintUniqueAffiliateCode(name: string): Promise<{ code: string; slug: string }> {
  const base =
    (name || '')
      .trim()
      .split(/\s+/)[0]
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10) || 'AFFILIE'

  for (let attempt = 0; attempt < 12; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
    const code   = `${base}${suffix}`
    const slug   = code.toLowerCase()
    const [affClash, creatorClash] = await Promise.all([
      prisma.affiliate.findFirst({
        where:  { OR: [{ referralCode: code }, { referralLinkSlug: slug }] },
        select: { id: true },
      }),
      prisma.creator.findFirst({
        where:  { OR: [{ referralCode: code }, { referralLinkSlug: slug }] },
        select: { id: true },
      }),
    ])
    if (!affClash && !creatorClash) return { code, slug }
  }
  // Astronomically unlikely fallback — append a time-based tail.
  const code = `${base}${Date.now().toString(36).toUpperCase().slice(-6)}`
  return { code, slug: code.toLowerCase() }
}

/**
 * Grant the 'affiliate' role + create the affiliate identity (with an instantly-minted
 * referral code) for the SESSION operator. The caller MUST resolve `operatorId` from the
 * session (never a client value → no IDOR). Gated by AFFILIATE_ENABLED. IDEMPOTENT: a
 * second call returns the existing affiliate WITHOUT minting a second code (read-before-
 * write + operatorId @unique as the race backstop).
 */
export async function ensureAffiliateOperator(operatorId: string): Promise<EnsureAffiliateResult> {
  if (!isAffiliateEnabled()) return { ok: false, reason: 'disabled' }
  try {
    const operator = await prisma.operator.findUnique({
      where:  { id: operatorId },
      select: { id: true, name: true },
    })
    if (!operator) return { ok: false, reason: 'operator_not_found' }

    // IDEMPOTENCE — a re-join never creates a 2nd entity / 2nd code.
    const existing = await prisma.affiliate.findUnique({
      where:  { operatorId },
      select: { id: true, operatorId: true, referralCode: true, referralLinkSlug: true, status: true },
    })
    if (existing) {
      // Ensure the role is present too (cheap, idempotent) — covers a row created before
      // a transient role-grant failure.
      const roleAdded = await addRoleToOperator(operatorId, 'affiliate')
      return { ok: true, created: false, roleAdded, affiliate: existing }
    }

    // Grant the role FIRST (idempotent + tolerant), then mint + create the entity.
    const roleAdded = await addRoleToOperator(operatorId, 'affiliate')

    const { code, slug } = await mintUniqueAffiliateCode(operator.name)
    try {
      const affiliate = await prisma.affiliate.create({
        data:   { operatorId, referralCode: code, referralLinkSlug: slug, status: 'active' },
        select: { id: true, operatorId: true, referralCode: true, referralLinkSlug: true, status: true },
      })
      return { ok: true, created: true, roleAdded, affiliate }
    } catch (err) {
      // A concurrent join won the operatorId @unique race → reuse the existing row
      // (idempotent, no duplicate entity/code).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const row = await prisma.affiliate.findUnique({
          where:  { operatorId },
          select: { id: true, operatorId: true, referralCode: true, referralLinkSlug: true, status: true },
        })
        if (row) return { ok: true, created: false, roleAdded, affiliate: row }
      }
      throw err
    }
  } catch (err) {
    console.error('[ensureAffiliateOperator] non-fatal:', operatorId, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}

/** Read the SESSION operator's affiliate identity (or null). Owner-scoped by the caller. */
export async function getAffiliateByOperator(operatorId: string): Promise<AffiliateIdentity | null> {
  return prisma.affiliate.findUnique({
    where:  { operatorId },
    select: { id: true, operatorId: true, referralCode: true, referralLinkSlug: true, status: true },
  })
}
