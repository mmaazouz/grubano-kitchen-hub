import type Stripe from 'stripe'
import { getStripe, createOnboardingLink, retrieveAccount, mapAccountStatus, type ConnectAccountStatus } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { isPrestataireEnabled } from '@/lib/prestataire-account'

// ── Prestataire Stripe Connect (KYB onboarding) — SERVICES P7, Agent 80 ───────
//
// A CLONE of lib/supplier-connect (the FOURNISSEUR destination-charge Connect),
// adapted to the PrestataireProfile — a SEPARATE services path. It REUSES the shared
// Stripe primitives (lib/stripe: getStripe / createOnboardingLink / retrieveAccount /
// mapAccountStatus) WITHOUT modifying them, NEVER touches lib/supplier-connect,
// lib/connect-onboarding, the B2C core or any existing webhook. TEST MODE only —
// ⚠️ ONBOARDING ONLY: NO charge / PaymentIntent / payout / transfer / application_fee
// here. The real money movement is a LATER brick (P8). One Express account per
// PrestataireProfile, identified by metadata.prestataireProfileId. The P1 Connect
// columns (stripeAccountId / payoutStatus / stripeOnboardedAt) already exist → NO migration.

export type PrestatairePayoutStatus = 'none' | ConnectAccountStatus // none | pending | active | restricted

/**
 * Connect flag — the prestataire payout onboarding is OFF by default. Distinct from
 * the role flag PRESTATAIRE_ENABLED. Enable in TEST with PRESTATAIRE_CONNECT_ENABLED=true.
 * Default CLOSED on purpose (never in LIVE before Grubano is registered).
 */
export function isPrestataireConnectEnabled(): boolean {
  return process.env.PRESTATAIRE_CONNECT_ENABLED === 'true'
}

/**
 * DOUBLE-FLAG gate: the prestataire Connect is live only when BOTH the role
 * (PRESTATAIRE_ENABLED) AND the connect (PRESTATAIRE_CONNECT_ENABLED) flags are on.
 * Single source for the route + webhook + dashboard card → OFF = 404 / nothing shown.
 */
export function isPrestataireConnectLive(): boolean {
  return isPrestataireEnabled() && isPrestataireConnectEnabled()
}

/** Create the prestataire's Express account (FR, TEST), tagged with its profile id. */
async function createPrestataireExpressAccount(prestataireProfileId: string): Promise<Stripe.Account> {
  return getStripe().accounts.create({
    type:    'express',
    country: 'FR',
    capabilities: {
      card_payments: { requested: true },
      transfers:     { requested: true },
    },
    settings: { payouts: { schedule: { interval: 'daily' } } },
    metadata: { prestataireProfileId }, // ← services marker (distinct from the B2B supplierProfileId)
  })
}

/**
 * Ensure the prestataire has an Express account, then mint a FRESH onboarding link.
 * Idempotent: reuses the stored account, creates one only if absent. The profile is
 * resolved from the SESSION by the caller — never a client-supplied id. NO money moves.
 */
export async function startPrestataireOnboarding(
  profile: { id: string; stripeAccountId: string | null },
  urls: { returnUrl: string; refreshUrl: string },
): Promise<{ url: string; accountId: string }> {
  let accountId = profile.stripeAccountId
  if (!accountId) {
    const acct = await createPrestataireExpressAccount(profile.id)
    accountId = acct.id
    await prisma.prestataireProfile.update({
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
export async function syncPrestatairePayoutStatus(profile: {
  id: string
  stripeAccountId: string | null
  payoutStatus?: string | null
}): Promise<PrestatairePayoutStatus> {
  if (!profile.stripeAccountId) return 'none'
  try {
    const acct = await retrieveAccount(profile.stripeAccountId)
    const status = mapAccountStatus(acct)
    await prisma.prestataireProfile.update({
      where: { id: profile.id },
      data:  { payoutStatus: status, ...(status === 'active' ? { stripeOnboardedAt: new Date() } : {}) },
    })
    return status
  } catch {
    return (profile.payoutStatus as PrestatairePayoutStatus) ?? 'none'
  }
}

/**
 * Webhook persist (no session): set the status for whichever PrestataireProfile owns
 * `accountId`. Scoped by the connected-account id — never a client. Stamps the first
 * transition to 'active'. Best-effort. Returns the number of rows updated (0 = the
 * account is not a prestataire account → the caller no-ops).
 */
export async function applyPrestataireAccountStatus(accountId: string, status: PrestatairePayoutStatus): Promise<number> {
  if (!accountId) return 0
  try {
    const res = await prisma.prestataireProfile.updateMany({
      where: { stripeAccountId: accountId },
      data:  { payoutStatus: status },
    })
    if (status === 'active') {
      await prisma.prestataireProfile.updateMany({
        where: { stripeAccountId: accountId, stripeOnboardedAt: null },
        data:  { stripeOnboardedAt: new Date() },
      })
    }
    return res.count
  } catch (err) {
    console.error('[applyPrestataireAccountStatus] non-fatal:', accountId, err instanceof Error ? err.message : err)
    return 0
  }
}
