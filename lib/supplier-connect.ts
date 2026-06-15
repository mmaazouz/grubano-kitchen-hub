import type Stripe from 'stripe'
import { getStripe, createOnboardingLink, retrieveAccount, mapAccountStatus, type ConnectAccountStatus } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

// ── Supplier Stripe Connect (KYB onboarding) — B2B Slice 5b, Agent 14 ─────────
//
// A SEPARATE B2B path that REUSES the shared Stripe primitives (lib/stripe:
// getStripe / createOnboardingLink / retrieveAccount / mapAccountStatus) WITHOUT
// modifying them, and NEVER touches the B2C financial core or the B2C webhook.
// TEST MODE only — no charge / payout / application_fee here (= 5c). One Express
// account per SupplierProfile, identified by metadata.supplierProfileId.

export type SupplierPayoutStatus = 'none' | ConnectAccountStatus // none | pending | active | restricted

/**
 * Immatriculation gate. Supplier Connect onboarding is OFF by default — nothing
 * runs until Grubano is registered (and never in LIVE before then). Enable in TEST
 * with SUPPLIER_CONNECT_ENABLED=true. Default CLOSED on purpose.
 */
export function isSupplierConnectEnabled(): boolean {
  return process.env.SUPPLIER_CONNECT_ENABLED === 'true'
}

/** Create the supplier's Express account (FR, TEST), tagged with its profile id. */
async function createSupplierExpressAccount(supplierProfileId: string): Promise<Stripe.Account> {
  return getStripe().accounts.create({
    type:    'express',
    country: 'FR',
    capabilities: {
      card_payments: { requested: true },
      transfers:     { requested: true },
    },
    settings: { payouts: { schedule: { interval: 'daily' } } },
    metadata: { supplierProfileId }, // ← B2B marker (distinct from the B2C restaurantId)
  })
}

/**
 * Ensure the supplier has an Express account, then mint a FRESH onboarding link.
 * Idempotent: reuses the stored account, creates one only if absent. The profile
 * is resolved from the SESSION by the caller — never a client-supplied id.
 */
export async function startSupplierOnboarding(
  profile: { id: string; stripeAccountId: string | null },
  urls: { returnUrl: string; refreshUrl: string },
): Promise<{ url: string; accountId: string }> {
  let accountId = profile.stripeAccountId
  if (!accountId) {
    const acct = await createSupplierExpressAccount(profile.id)
    accountId = acct.id
    await prisma.supplierProfile.update({
      where: { id: profile.id },
      data:  { stripeAccountId: accountId, payoutStatus: 'pending' },
    })
  }
  const link = await createOnboardingLink(accountId, urls.refreshUrl, urls.returnUrl)
  return { url: link.url, accountId }
}

/**
 * Read the live connected account and persist its coarse status to THIS profile
 * (session-scoped). Stamps stripeOnboardedAt the first time it becomes 'active'.
 * Tolerant: a Stripe/DB hiccup degrades to the last-known status, never throws.
 */
export async function syncSupplierPayoutStatus(profile: {
  id: string
  stripeAccountId: string | null
  payoutStatus?: string | null
}): Promise<SupplierPayoutStatus> {
  if (!profile.stripeAccountId) return 'none'
  try {
    const acct = await retrieveAccount(profile.stripeAccountId)
    const status = mapAccountStatus(acct)
    await prisma.supplierProfile.update({
      where: { id: profile.id },
      data:  { payoutStatus: status, ...(status === 'active' ? { stripeOnboardedAt: new Date() } : {}) },
    })
    return status
  } catch {
    return (profile.payoutStatus as SupplierPayoutStatus) ?? 'none'
  }
}

/**
 * Webhook persist (no session): set the status for whichever SupplierProfile owns
 * `accountId`. Scoped by the connected-account id — never a client. Stamps the
 * first transition to 'active'. Best-effort. Returns the number of rows updated
 * (0 = the account is not a supplier account → the caller no-ops).
 */
export async function applySupplierAccountStatus(accountId: string, status: SupplierPayoutStatus): Promise<number> {
  if (!accountId) return 0
  try {
    const res = await prisma.supplierProfile.updateMany({
      where: { stripeAccountId: accountId },
      data:  { payoutStatus: status },
    })
    if (status === 'active') {
      await prisma.supplierProfile.updateMany({
        where: { stripeAccountId: accountId, stripeOnboardedAt: null },
        data:  { stripeOnboardedAt: new Date() },
      })
    }
    return res.count
  } catch (err) {
    console.error('[applySupplierAccountStatus] non-fatal:', accountId, err instanceof Error ? err.message : err)
    return 0
  }
}
