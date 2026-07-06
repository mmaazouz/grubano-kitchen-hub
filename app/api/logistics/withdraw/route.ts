import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isLogisticsPayoutEnabled, payPartner } from '@/lib/creator-payout'
import { isConnectOnboardingEnabled, syncConnectStatus } from '@/lib/connect-onboarding'
import { computePartnerBalance } from '@/lib/partner-balance'
import { payoutMinCents } from '@/lib/payout-threshold'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/logistics/withdraw — courier self-service payout (P4.3 ÉTAPE 5) ──────────────
// Calque of /api/affiliate/withdraw for the LOGISTICS entity. ORCHESTRATES the P4.3 rail;
// it does NOT re-implement it.
//   GET  → the honest state feeding LO7's 4 UI states (nocfg / below / ready / pending):
//          available, threshold, Connect/KYC status, hasAccount, payout history + the two
//          rail flags. NOT hard-gated → with the rails OFF it returns the real (empty)
//          state so the client shows « bientôt »/nocfg honestly, never a 404.
//   POST → request a withdrawal of the MATURED balance. Gated by LOGISTICS_PAYOUT_ENABLED:
//          rail OFF                → rail_disabled (no transfer)
//          available < threshold   → below_threshold (no transfer)
//          Connect NOT active      → kyc_required (the client sends the courier to onboard
//                                    via POST /api/logistics/connect — the EXISTING route)
//          otherwise               → payPartner('logistics', profileId) TEL QUEL
//
// SAFETY:
//  - OWNER-SCOPED: the courier is the SESSION email → LogisticsProfile (never a body id → no IDOR).
//  - KYC BEFORE MONEY: no transfer unless the courier's Connect account is ACTIVE.
//  - AMOUNT: never a client value — payPartner pays exactly computePartnerBalance('logistics')
//    (matured remainder). The request body is ignored.
//  - IDEMPOTENCE: payPartner's deterministic paid-cursor key + @unique → a double-click / rejeu
//    yields ONE Payout (already_in_progress → in_progress here). No 2nd transfer.
//  - payPartner + connect-onboarding are REUSED unchanged. Mode TEST. NEVER stores an IBAN.

async function callerLogistics() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  return prisma.logisticsProfile.findUnique({
    where:  { email },
    select: { id: true, status: true, partnerType: true, stripeAccountId: true, payoutStatus: true },
  })
}

async function recentPayouts(logisticsProfileId: string) {
  const rows = await prisma.payout.findMany({
    where:   { role: 'logistics', logisticsProfileId },
    orderBy: { createdAt: 'desc' },
    take:    20,
    select:  { id: true, amountCents: true, currency: true, status: true, createdAt: true, paidAt: true, stripeTransferId: true },
  })
  return rows.map(p => ({
    id: p.id, amountCents: p.amountCents, currency: p.currency, status: p.status,
    createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null,
    stripeTransferId: p.stripeTransferId, // tr_… reference only — NEVER an IBAN
  }))
}

export async function GET() {
  const profile = await callerLogistics()
  if (!profile) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 401 })

  // Freshen the Connect status from Stripe (tolerant) — the SAME lib the creator/affiliate
  // rails use; degrades to the last-known status, never throws.
  const connectStatus = await syncConnectStatus('logistics', {
    id: profile.id, accountId: profile.stripeAccountId, status: profile.payoutStatus,
  })
  const balance = await computePartnerBalance('logistics', profile.id)

  return NextResponse.json({
    payoutEnabled:  isLogisticsPayoutEnabled(),
    connectEnabled: isConnectOnboardingEnabled('logistics'),
    availableCents: balance.availableCents,
    paidCents:      balance.paidCents,
    thresholdCents: payoutMinCents(),
    connectStatus,               // none | pending | active | restricted
    hasAccount:     !!profile.stripeAccountId,
    accountActive:  profile.status === 'active',
    partnerType:    profile.partnerType, // independent | company (onboarding business_type hint)
    payouts:        await recentPayouts(profile.id),
  })
}

export async function POST() {
  try {
    // The Retirer button requires the payout rail. OFF → inert (no transfer, honest status).
    if (!isLogisticsPayoutEnabled()) {
      return NextResponse.json({ status: 'rail_disabled', gated: true })
    }
    const profile = await callerLogistics()
    if (!profile) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 401 })

    // 1. Amount = the SERVER matured balance (NEVER a client value; the body is ignored).
    const balance        = await computePartnerBalance('logistics', profile.id)
    const thresholdCents = payoutMinCents()
    if (balance.availableCents < thresholdCents) {
      return NextResponse.json({ status: 'below_threshold', availableCents: balance.availableCents, thresholdCents })
    }

    // 2. KYC BEFORE MONEY — the courier Connect account must be ACTIVE. Freshen from Stripe;
    //    if not active, the client sends the courier to onboard via POST /api/logistics/connect
    //    (the existing route, gated by LOGISTICS_CONNECT_ENABLED). NO transfer here.
    const connectStatus = await syncConnectStatus('logistics', {
      id: profile.id, accountId: profile.stripeAccountId, status: profile.payoutStatus,
    })
    if (connectStatus !== 'active') {
      return NextResponse.json({ status: 'kyc_required' })
    }

    // 3. Pay — DEFER to payPartner TEL QUEL (server amount, KYC re-checked, triple idempotence).
    const out = await payPartner('logistics', profile.id)
    switch (out.status) {
      case 'paid':
        return NextResponse.json({ status: 'paid', amountCents: out.amountCents, stripeTransferId: out.stripeTransferId })
      case 'failed':
        return NextResponse.json({ status: 'failed' }, { status: 502 })
      default: { // skipped — surface the reason honestly (idempotence / race / gate guards)
        if (out.reason === 'already_in_progress') return NextResponse.json({ status: 'in_progress' })
        if (out.reason === 'no_active_connect')   return NextResponse.json({ status: 'kyc_required' })
        if (out.reason === 'below_threshold')     return NextResponse.json({ status: 'below_threshold', availableCents: balance.availableCents, thresholdCents })
        if (out.reason === 'rail_disabled')       return NextResponse.json({ status: 'rail_disabled', gated: true })
        return NextResponse.json({ status: 'unavailable', reason: out.reason })
      }
    }
  } catch (err) {
    console.error('[POST /api/logistics/withdraw]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
