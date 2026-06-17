import type Stripe from 'stripe'
import { getStripe, createOnboardingLink, retrieveAccount, mapAccountStatus, type ConnectAccountStatus } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

// ── Connect onboarding for Creator / Logistics / Franchise — P4.1 (Agent 37) ──
//
// A GENERIC mirror of lib/supplier-connect.startSupplierOnboarding that extends
// Stripe Connect Express onboarding to the three remaining payout-receiving roles.
// It REUSES the shared lib/stripe primitives (getStripe / createOnboardingLink /
// retrieveAccount / mapAccountStatus) WITHOUT modifying them, and NEVER touches the
// B2C/B2B financial core, the commission engines, the ledger, the invoices, or the
// existing webhooks. TEST MODE only — NO charge / payout / application_fee here
// (= P4.3). Status is synced ON-DEMAND (no new webhook in P4.1).
//
// Account ↔ entity rattachement (decided by Agent 0):
//   creator   → Creator             (metadata.creatorId)
//   logistics → LogisticsProfile    (metadata.logisticsProfileId)
//   franchise → Operator (franchise*)(metadata.franchiseOperatorId)
//
// SECURITY: per-role kill-switch, DEFAULT OFF (mirror of SUPPLIER_CONNECT_ENABLED);
// the calling route resolves the entity from the SESSION only (never a client id)
// and is idempotent (reuses the stored accountId, never a 2nd Stripe account).

export type ConnectBeneficiaryType = 'creator' | 'logistics' | 'franchise'

export type ConnectPayoutStatus = 'none' | ConnectAccountStatus // none | pending | active | restricted

// Per-role immatriculation gate. Each is OFF until that role's payout rail is
// formally enabled (and never in LIVE before then). Separate flags so a role can
// be opened independently of the others, exactly like SUPPLIER_CONNECT_ENABLED.
const FLAG_ENV: Record<ConnectBeneficiaryType, string> = {
  creator:   'CREATOR_CONNECT_ENABLED',
  logistics: 'LOGISTICS_CONNECT_ENABLED',
  franchise: 'FRANCHISE_CONNECT_ENABLED',
}

export function isConnectOnboardingEnabled(type: ConnectBeneficiaryType): boolean {
  return process.env[FLAG_ENV[type]] === 'true'
}

// Stripe metadata marker per beneficiary type (distinct from the B2C restaurantId
// and the B2B supplierProfileId markers, so the connected accounts never collide).
const META_KEY: Record<ConnectBeneficiaryType, string> = {
  creator:   'creatorId',
  logistics: 'logisticsProfileId',
  franchise: 'franchiseOperatorId',
}

/** Create the beneficiary's Express account (FR, TEST), tagged with its id. Same
 *  shape as createExpressAccount / createSupplierExpressAccount (daily payouts set
 *  at creation), only the metadata marker differs. */
async function createConnectExpressAccount(type: ConnectBeneficiaryType, id: string): Promise<Stripe.Account> {
  return getStripe().accounts.create({
    type:    'express',
    country: 'FR',
    capabilities: {
      card_payments: { requested: true },
      transfers:     { requested: true },
    },
    settings: { payouts: { schedule: { interval: 'daily' } } },
    metadata: { [META_KEY[type]]: id },
  })
}

/** Persist a freshly-created account id on the right model + field names. */
async function persistNewAccount(type: ConnectBeneficiaryType, id: string, accountId: string): Promise<void> {
  if (type === 'creator') {
    await prisma.creator.update({ where: { id }, data: { stripeAccountId: accountId, payoutStatus: 'pending' } })
  } else if (type === 'logistics') {
    await prisma.logisticsProfile.update({ where: { id }, data: { stripeAccountId: accountId, payoutStatus: 'pending' } })
  } else {
    await prisma.operator.update({ where: { id }, data: { franchiseStripeAccountId: accountId, franchisePayoutStatus: 'pending' } })
  }
}

/** Persist the coarse status on the right model + field names. Stamps the
 *  onboarded timestamp the first time the account becomes 'active'. */
async function persistStatus(type: ConnectBeneficiaryType, id: string, status: ConnectAccountStatus): Promise<void> {
  const stampedAt = status === 'active' ? new Date() : null
  if (type === 'creator') {
    await prisma.creator.update({
      where: { id },
      data:  { payoutStatus: status, ...(stampedAt ? { stripeOnboardedAt: stampedAt } : {}) },
    })
  } else if (type === 'logistics') {
    await prisma.logisticsProfile.update({
      where: { id },
      data:  { payoutStatus: status, ...(stampedAt ? { stripeOnboardedAt: stampedAt } : {}) },
    })
  } else {
    await prisma.operator.update({
      where: { id },
      data:  { franchisePayoutStatus: status, ...(stampedAt ? { franchiseStripeOnboardedAt: stampedAt } : {}) },
    })
  }
}

/**
 * Ensure the beneficiary has an Express account, then mint a FRESH onboarding link.
 * IDEMPOTENT: reuses the stored account, creates one only if absent (so re-running
 * never opens a 2nd Stripe account). The entity is resolved from the SESSION by the
 * caller — `id`/`accountId` are never client-supplied. Mirror of
 * startSupplierOnboarding.
 */
export async function startConnectOnboarding(
  type: ConnectBeneficiaryType,
  entity: { id: string; accountId: string | null },
  urls: { returnUrl: string; refreshUrl: string },
): Promise<{ url: string; accountId: string }> {
  let accountId = entity.accountId
  if (!accountId) {
    const acct = await createConnectExpressAccount(type, entity.id)
    accountId = acct.id
    await persistNewAccount(type, entity.id, accountId)
  }
  const link = await createOnboardingLink(accountId, urls.refreshUrl, urls.returnUrl)
  return { url: link.url, accountId }
}

/**
 * Read the live connected account and persist its coarse status to THIS entity
 * (session-scoped). Tolerant: a Stripe/DB hiccup degrades to the last-known status,
 * never throws. Mirror of syncSupplierPayoutStatus.
 */
export async function syncConnectStatus(
  type: ConnectBeneficiaryType,
  entity: { id: string; accountId: string | null; status?: string | null },
): Promise<ConnectPayoutStatus> {
  if (!entity.accountId) return 'none'
  try {
    const acct = await retrieveAccount(entity.accountId)
    const status = mapAccountStatus(acct)
    await persistStatus(type, entity.id, status)
    return status
  } catch {
    return (entity.status as ConnectPayoutStatus) ?? 'none'
  }
}
