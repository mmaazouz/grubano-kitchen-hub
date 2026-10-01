import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import { isAffiliateConnectEnabled, payPartner } from '@/lib/creator-payout'
import { startConnectOnboarding, syncConnectStatus } from '@/lib/connect-onboarding'
import { computePartnerBalance } from '@/lib/partner-balance'
import { payoutMinCents } from '@/lib/payout-threshold'
import { requireStepUp } from '@/lib/step-up'
import { isMoneyStepUpEnabled } from '@/lib/email-otp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/affiliate/withdraw — affiliate self-service payout (Brique D2, Agent 64) ──────
// THE money-movement endpoint: it ORCHESTRATES (it does not re-implement) the D1 plumbing.
//   GET  → status (available, threshold, Connect/KYC status, fiscal completeness, history).
//   POST → request a withdrawal of the matured balance:
//          available < threshold      → below_threshold (no transfer)
//          Connect NOT active          → start onboarding (KYC déclenché au 1er retrait),
//                                        return the link, NO transfer
//          DAC7 fiscal info missing    → fiscal_required, NO transfer
//          otherwise                   → payPartner('affiliate', operatorId) TEL QUEL
//
// SAFETY:
//  - OWNER-SCOPED: the operator is the SESSION operator id (never a body id → no IDOR).
//  - KYC BEFORE MONEY: no transfer unless the affiliate Connect account is ACTIVE.
//  - AMOUNT: never a client value — payPartner pays exactly computePartnerBalance
//    ('affiliate', operatorId) (matured remainder). The request body is ignored.
//  - IDEMPOTENCE: payPartner's deterministic paid-cursor key + @unique → a double-click /
//    rejeu yields ONE Payout (already_in_progress → in_progress here). No 2nd transfer.
//  - Gated by AFFILIATE_ENABLED + AFFILIATE_CONNECT_ENABLED (both default OFF → 404).
//  - payPartner + connect-onboarding are REUSED unchanged. Mode TEST.

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host  = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

function flagsOn(): boolean {
  return isAffiliateEnabled() && isAffiliateConnectEnabled()
}

type OperatorRow = {
  id: string
  email: string
  affiliateStripeAccountId: string | null
  affiliatePayoutStatus: string | null
  registeredAddress: string | null
  taxId: string | null
  taxIdCountry: string | null
  dateOfBirth: Date | null
  sellerType: string | null
}

/** SESSION operator (must be a real affiliate). Owner-scoped — never a client id. */
async function callerOperator(): Promise<OperatorRow | null> {
  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) return null
  const affiliate = await getAffiliateByOperator(operatorId)
  if (!affiliate) return null
  return prisma.operator.findUnique({
    where:  { id: operatorId },
    select: {
      id: true, email: true, affiliateStripeAccountId: true, affiliatePayoutStatus: true,
      registeredAddress: true, taxId: true, taxIdCountry: true, dateOfBirth: true, sellerType: true,
    },
  })
}

/** DAC7 self-declaration complete enough to pay out (captured at the 1st withdrawal). */
function isFiscalComplete(op: OperatorRow): boolean {
  if (!op.registeredAddress || !op.taxId || !op.taxIdCountry || !op.sellerType) return false
  if (op.sellerType === 'individual' && !op.dateOfBirth) return false
  return true
}

async function recentPayouts(operatorId: string) {
  const rows = await prisma.payout.findMany({
    where:   { role: 'affiliate', operatorId },
    orderBy: { createdAt: 'desc' },
    take:    20,
    select:  { id: true, amountCents: true, currency: true, status: true, createdAt: true, paidAt: true, stripeTransferId: true },
  })
  return rows.map(p => ({
    id: p.id, amountCents: p.amountCents, currency: p.currency, status: p.status,
    createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null,
    stripeTransferId: p.stripeTransferId,
  }))
}

export async function GET() {
  if (!flagsOn()) return NextResponse.json({ error: 'Indisponible', gated: true }, { status: 404 })
  const op = await callerOperator()
  if (!op) return NextResponse.json({ error: 'Profil affilié introuvable' }, { status: 401 })

  // Freshen the Connect status from Stripe (tolerant) — same lib the creator rail uses.
  const connectStatus = await syncConnectStatus('affiliate', {
    id: op.id, accountId: op.affiliateStripeAccountId, status: op.affiliatePayoutStatus,
  })
  const balance = await computePartnerBalance('affiliate', op.id)

  return NextResponse.json({
    enabled:        true,
    availableCents: balance.availableCents,
    thresholdCents: payoutMinCents(),
    connectStatus,
    hasAccount:     !!op.affiliateStripeAccountId,
    fiscalComplete: isFiscalComplete(op),
    payouts:        await recentPayouts(op.id),
    // Phase 3 (Agent 88): tell the client a step-up code is required before a withdrawal.
    // Included ONLY when the flag is ON → OFF response is byte-identical.
    ...(isMoneyStepUpEnabled() ? { stepUp: true } : {}),
  })
}

export async function POST(req: Request) {
  try {
    if (!flagsOn()) return NextResponse.json({ error: 'Indisponible', gated: true }, { status: 404 })
    const op = await callerOperator()
    if (!op) return NextResponse.json({ error: 'Profil affilié introuvable' }, { status: 401 })

    // ── Phase 3 (Agent 88) — money STEP-UP guard, BEFORE any money logic. Gated by
    //    AUTH_MONEY_STEPUP_ENABLED: OFF → requireStepUp returns ok → the withdrawal
    //    behaves EXACTLY as before (byte-identical). ON → a fresh single-use email code
    //    (purpose 'stepup:withdraw', bound to the SESSION email) is required; without it
    //    → stepup_required, with a wrong/expired one → stepup_invalid. The body carries
    //    ONLY the code — the amount stays server-derived (computePartnerBalance) below.
    const body = (await req.json().catch(() => null)) as { stepUpCode?: unknown } | null
    const stepUp = await requireStepUp(
      op.email, 'stepup:withdraw',
      typeof body?.stepUpCode === 'string' ? body.stepUpCode : null,
    )
    if (!stepUp.ok) return NextResponse.json({ status: stepUp.reason }, { status: stepUp.status })

    // 1. Amount = the SERVER matured balance (NEVER a client value; the body is ignored).
    const balance        = await computePartnerBalance('affiliate', op.id)
    const thresholdCents = payoutMinCents()
    if (balance.availableCents < thresholdCents) {
      return NextResponse.json({ status: 'below_threshold', availableCents: balance.availableCents, thresholdCents })
    }

    // 2. KYC BEFORE MONEY — the affiliate Connect account must be ACTIVE. Freshen from
    //    Stripe; if not active, START the onboarding (KYC déclenché au 1er retrait) and
    //    return its link. NO transfer.
    const connectStatus = await syncConnectStatus('affiliate', {
      id: op.id, accountId: op.affiliateStripeAccountId, status: op.affiliatePayoutStatus,
    })
    if (connectStatus !== 'active') {
      const origin = baseUrl(req)
      const { url } = await startConnectOnboarding(
        'affiliate',
        { id: op.id, accountId: op.affiliateStripeAccountId },
        {
          returnUrl:  `${origin}/affiliate/dashboard?connect=return`,
          refreshUrl: `${origin}/affiliate/dashboard?connect=refresh`,
        },
      )
      return NextResponse.json({ status: 'kyc_required', onboardingUrl: url, fiscalComplete: isFiscalComplete(op) })
    }

    // 3. FISCAL CAPTURE at the 1st withdrawal — DAC7 self-declaration required before payout.
    if (!isFiscalComplete(op)) {
      return NextResponse.json({ status: 'fiscal_required', fiscalComplete: false })
    }

    // 4. Pay — DEFER to payPartner TEL QUEL (server amount, KYC re-checked, triple idempotence).
    const out = await payPartner('affiliate', op.id)
    switch (out.status) {
      case 'paid':
        return NextResponse.json({ status: 'paid', amountCents: out.amountCents, stripeTransferId: out.stripeTransferId })
      case 'failed':
        return NextResponse.json({ status: 'failed' }, { status: 502 })
      default: { // skipped — surface the reason honestly (idempotence / race guards)
        if (out.reason === 'already_in_progress') return NextResponse.json({ status: 'in_progress' })
        if (out.reason === 'no_active_connect')   return NextResponse.json({ status: 'kyc_required' })
        if (out.reason === 'below_threshold')     return NextResponse.json({ status: 'below_threshold', availableCents: balance.availableCents, thresholdCents })
        return NextResponse.json({ status: 'unavailable', reason: out.reason })
      }
    }
  } catch (err) {
    console.error('[POST /api/affiliate/withdraw]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
