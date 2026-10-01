import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  parseVerificationToken,
  sha256,
  safeEqualHex,
} from '@/lib/partner-verification'
import { locales, defaultLocale, type Locale } from '@/i18n'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── GET /api/partners/verify-email?token=... ──────────────────────────────────
// Activates a pending partner account by proving ownership of the registration
// email. The link is clicked from the verification email sent by
// POST /api/partners/register.
//
// On success the account moves status 'pending' → 'active' (email confirmed). P6
// ANTI-LOCKOUT: the restaurateur signup is now PASSWORDLESS, so the ONLY sign-in is
// the magic-link — and POST /api/auth/magic-link mints a link ONLY for an 'active'
// account. Landing the verified partner on 'active' (instead of the old
// intermediate 'pending_review') is what lets a passwordless partner actually sign
// in. The restaurant is still NOT publishable on /eat until admin approval — that
// gate is Restaurant.isActive (forced false), NOT Operator.status. The single-use
// token is cleared and emailVerifiedAt is stamped.
// Idempotency: a token that was already consumed (hash cleared) is reported as
// `used` rather than 500 so the friendly page can reassure the user.
//
// ── UI brique (Agent 3) — response shape only ────────────────────────────────
// The token-validation logic written by Agent 12 (timing-safe equal, single-use,
// expiry, status promotion) is UNCHANGED. Only the HTTP response was swapped
// from `NextResponse.json` to a 303 redirect to /{locale}/business/verified so
// the click on the email link lands on a real branded page, not raw JSON.
// Status param values: success | invalid | expired | used | error.

/** Read NEXT_LOCALE cookie (set by next-intl) to honour the partner's language. */
function pickLocale(req: NextRequest): string {
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
    return cookieLocale as Locale
  }
  return defaultLocale
}

/**
 * 303 See Other with a RELATIVE Location — the browser resolves it against
 * the public domain in the address bar. Same trick the /api/ref route uses to
 * sidestep the o2switch / Passenger internal-host issue (commit bbe88ef).
 */
function redirectToVerified(req: NextRequest, status: string): NextResponse {
  const locale = pickLocale(req)
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `/${locale}/business/verified?status=${status}` },
  })
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') ?? ''
    const parsed = parseVerificationToken(token)
    if (!parsed) return redirectToVerified(req, 'invalid')

    const operator = await prisma.operator.findUnique({
      where:  { id: parsed.operatorId },
      select: {
        id:                true,
        status:            true,
        verifyTokenHash:   true,
        verifyTokenExpiry: true,
      },
    })

    // No row → invalid. Hash cleared → already consumed (single-use).
    if (!operator) return redirectToVerified(req, 'invalid')
    if (!operator.verifyTokenHash || !operator.verifyTokenExpiry) {
      return redirectToVerified(req, 'used')
    }
    if (operator.verifyTokenExpiry.getTime() < Date.now()) {
      return redirectToVerified(req, 'expired')
    }
    if (!safeEqualHex(sha256(parsed.secret), operator.verifyTokenHash)) {
      return redirectToVerified(req, 'invalid')
    }

    await prisma.operator.update({
      where: { id: operator.id },
      data: {
        // Promote ONLY a still-pending account to 'active' (P6: a passwordless
        // partner can only sign in by magic-link, which requires 'active'); never
        // downgrade one already advanced (active / pending_review) by another path.
        status:            operator.status === 'pending' ? 'active' : operator.status,
        emailVerifiedAt:   new Date(),
        verifyTokenHash:   null,   // single-use
        verifyTokenExpiry: null,
      },
    })

    return redirectToVerified(req, 'success')
  } catch (err) {
    console.error('[GET /api/partners/verify-email]', err)
    return redirectToVerified(req, 'error')
  }
}
