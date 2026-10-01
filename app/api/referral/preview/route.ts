/**
 * Referral welcome-discount PREVIEW — Brick 5B companion (read-only).
 *
 * GET /api/referral/preview
 *
 * Why this route exists:
 *   The `grubano_ref` cookie set by 5A is **httpOnly**, so the consumer cart
 *   (client JS) cannot read it. Without a server hint the welcome discount only
 *   appears AFTER checkout (5B computes it server-side) — bad for conversion.
 *   This endpoint lets the cart ask the server, on load, whether the current
 *   visitor is eligible for the welcome discount, and shows an INDICATIVE line.
 *
 * Contract (read-only — NEVER writes, never creates a Referral):
 *   { eligible: boolean, discountPct: number, discountCap: number, creatorName?: string }
 *
 *   - eligible      true only when ALL of 5B's CAS-1 conditions hold:
 *                     • a valid creator referralCode is carried in the cookie
 *                       (or ?code= override), AND
 *                     • the buyer is authenticated (we need a customerId to
 *                       check first-order status), AND
 *                     • the buyer is NOT the creator (anti-self-referral, by
 *                       email — same rule as 5B), AND
 *                     • the buyer has NO active Referral row yet (5B only grants
 *                       the discount when `!existing`; an existing active row —
 *                       even expired — yields no discount).
 *   - discountPct   ReferralConfig.customerDiscountPct (fallback 0.10).
 *   - discountCap   ReferralConfig.customerDiscountCapEur (fallback 5).
 *   - creatorName   the referring creator's display name, when resolved.
 *
 * ⚠️ INDICATIVE ONLY. The cart must treat the amount as a hint. The server
 *    (POST /api/orders, 5B) remains the single source of truth and recomputes
 *    the real discount at checkout. Never trust a client-sent amount.
 *
 * Mirrors the 5B resolution logic in app/api/orders/route.ts so the preview and
 * the real charge agree. Everything here is wrapped so a hiccup degrades to
 * `{ eligible: false }` and never breaks the cart.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

// Reads cookies + session → inherently per-request. Force dynamic so Next never
// tries to statically prerender this handler.
export const dynamic = 'force-dynamic'

const COOKIE_NAME = 'grubano_ref'

// Default response: not eligible, with the launch-default discount params so the
// cart still has sane numbers to show if it ever wants them.
function notEligible(discountPct = 0.10, discountCap = 5) {
  return NextResponse.json({ eligible: false, discountPct, discountCap })
}

export async function GET(req: NextRequest) {
  try {
    // 1. Resolve the code: explicit ?code= override (future-proof, mirrors the
    //    body field in 5B) then the httpOnly attribution cookie.
    const url       = new URL(req.url)
    const override  = url.searchParams.get('code') ?? ''
    const rawCode   = (override || req.cookies.get(COOKIE_NAME)?.value || '').trim().toUpperCase()
    if (!rawCode) return notEligible()

    // 2. We need an authenticated buyer to judge first-order eligibility — the
    //    discount depends on this customer's referral history (customerId).
    const token = await getToken({ req })
    if (!token?.sub) return notEligible()

    // 3. Resolve the creator by canonical referralCode.
    const creator = await prisma.creator.findFirst({
      where:  { referralCode: rawCode },
      select: { id: true, name: true, email: true },
    })
    if (!creator) return notEligible()

    // 4. Anti-self-referral (by email — same rule as 5B; no Creator→Operator FK).
    const buyerEmail = typeof token.email === 'string' ? token.email.toLowerCase() : null
    if (buyerEmail && creator.email.toLowerCase() === buyerEmail) return notEligible()

    // 5. Discount params from ReferralConfig (single active row), launch fallbacks.
    const cfg = await prisma.referralConfig.findFirst({ where: { active: true } })
    const discountPct = cfg?.customerDiscountPct    ?? 0.10
    const discountCap = cfg?.customerDiscountCapEur  ?? 5

    // 6. First-order check — 5B grants the welcome discount ONLY when the buyer
    //    has no active Referral row at all (CAS 1 = `!existing`). An existing
    //    active row (even expired) yields no discount.
    const existing = await prisma.referral.findFirst({
      where:  { customerId: token.sub, active: true },
      select: { id: true },
    })
    if (existing) {
      // Already bound → no welcome discount, but report the params for context.
      return notEligible(discountPct, discountCap)
    }

    // Eligible: brand-new referred customer on their first order.
    return NextResponse.json({
      eligible:    true,
      discountPct,
      discountCap,
      creatorName: creator.name,
    })
  } catch (err) {
    // Degrade gracefully — the cart still works, just without the preview line.
    console.error('[GET /api/referral/preview]', err)
    return notEligible()
  }
}
