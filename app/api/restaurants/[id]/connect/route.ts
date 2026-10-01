import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import {
  createExpressAccount, createOnboardingLink, retrieveAccount, mapAccountStatus,
} from '@/lib/stripe'

// ── /api/restaurants/[id]/connect ─────────────────────────────────────────────
// Rail financier A1 — the establishment's Stripe Express connected account (KYC).
// OWNER ONLY (same ownership rule as /api/restaurants/[id]/fulfillment). SERVER
// ONLY for now: the future settings UI (A7) consumes these two endpoints as-is.
//
//   POST → ensure the Express account exists (creates it ONCE — idempotent, a
//          re-call NEVER creates a second account) and return a fresh
//          Stripe-hosted onboarding link { url }. Links are short-lived: the
//          caller requests a new one each time the resto (re)starts onboarding.
//   GET  → read the LIVE account at Stripe, map + persist the coarse status
//          (pending | active | restricted) and return it with the raw flags.
//
// NOTHING in the existing payment flows reads stripeAccountId yet (routing =
// A2): a restaurant without an active connected account behaves exactly as
// today. Stripe SDK + session → Node runtime, never static.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function stripeError(err: unknown) {
  if (err instanceof Error && err.message === 'stripe_not_configured') {
    return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
  }
  console.error('[connect] stripe error', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Erreur Stripe, réessayez.' }, { status: 502 })
}

// Owner-or-admin gate (same shape as the fulfillment endpoint). Returns the
// restaurant row on success, or an error response to return immediately.
async function authorize(restaurantId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }
  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) }
  }
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: {
      id: true, operatorId: true,
      stripeAccountId: true, stripeAccountStatus: true, stripeOnboardedAt: true,
    },
  })
  if (!restaurant) {
    return { error: NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 }) }
  }
  if (restaurant.operatorId !== operator.id && operator.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }
  return { restaurant }
}

// Where Stripe sends the resto back after / during onboarding. Markers let the
// future UI (A7) show the right state; today the dashboard simply loads.
function onboardingUrls(restaurantId: string) {
  const base = (process.env.NEXTAUTH_URL ?? 'https://app.grubano.com').replace(/\/$/, '')
  return {
    refreshUrl: `${base}/fr/dashboard?connect=refresh&restaurant=${restaurantId}`,
    returnUrl:  `${base}/fr/dashboard?connect=return&restaurant=${restaurantId}`,
  }
}

/** Persist a freshly-mapped status (+ stamp stripeOnboardedAt on the FIRST pass
 *  to 'active'). No-op when nothing changed. */
async function persistStatus(
  restaurant: { id: string; stripeAccountStatus: string | null; stripeOnboardedAt: Date | null },
  status: string,
) {
  if (restaurant.stripeAccountStatus === status) return
  await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      stripeAccountStatus: status,
      ...(status === 'active' && !restaurant.stripeOnboardedAt ? { stripeOnboardedAt: new Date() } : {}),
    },
  })
}

// ── POST — ensure account + return a fresh onboarding link ────────────────────
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error
    const restaurant = auth.restaurant

    // 1) Ensure the Express account exists — created ONCE, then always reused.
    let accountId = restaurant.stripeAccountId
    if (!accountId) {
      const acct = await createExpressAccount(restaurant.id)
      accountId = acct.id
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data:  { stripeAccountId: acct.id, stripeAccountStatus: 'pending' },
      })
    }

    // 2) Fresh onboarding link. Self-repair: if the STORED account no longer
    //    exists at Stripe (deleted in the dashboard), recreate it ONCE and retry
    //    — never a second account next to a live one.
    const { refreshUrl, returnUrl } = onboardingUrls(restaurant.id)
    try {
      const link = await createOnboardingLink(accountId, refreshUrl, returnUrl)
      return NextResponse.json({ url: link.url, accountId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!/No such account|does not have access to account/i.test(msg)) throw err
      console.warn(`[connect] stored account ${accountId} gone at Stripe — recreating (restaurant ${restaurant.id})`)
      const acct = await createExpressAccount(restaurant.id)
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data:  { stripeAccountId: acct.id, stripeAccountStatus: 'pending', stripeOnboardedAt: null },
      })
      const link = await createOnboardingLink(acct.id, refreshUrl, returnUrl)
      return NextResponse.json({ url: link.url, accountId: acct.id })
    }
  } catch (err) {
    return stripeError(err)
  }
}

// ── GET — live status, mapped + persisted ─────────────────────────────────────
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error
    const restaurant = auth.restaurant

    if (!restaurant.stripeAccountId) {
      return NextResponse.json({
        status: 'none', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
      })
    }

    const acct   = await retrieveAccount(restaurant.stripeAccountId)
    const status = mapAccountStatus(acct)
    await persistStatus(restaurant, status)

    return NextResponse.json({
      status,
      chargesEnabled:   acct.charges_enabled  ?? false,
      payoutsEnabled:   acct.payouts_enabled  ?? false,
      detailsSubmitted: acct.details_submitted ?? false,
    })
  } catch (err) {
    return stripeError(err)
  }
}
