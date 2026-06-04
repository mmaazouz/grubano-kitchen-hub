import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  parseVerificationToken,
  sha256,
  safeEqualHex,
} from '@/lib/partner-verification'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── GET /api/partners/verify-email?token=... ──────────────────────────────────
// Activates a pending partner account by proving ownership of the registration
// email. The link is clicked from the verification email sent by
// POST /api/partners/register.
//
// On success the account moves status 'pending' → 'pending_review' (email is
// confirmed, but the restaurant is NOT yet publishable — that needs admin
// approval). The single-use token is cleared and emailVerifiedAt is stamped.
// Idempotency: a token that was already consumed (hash cleared) returns the same
// "invalid / already used" error rather than 500.
//
// Backend-only brique: returns JSON. A later UI brique can wrap this in a
// friendly confirmation page / redirect.

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') ?? ''
    const parsed = parseVerificationToken(token)
    if (!parsed) return fail('Lien invalide')

    const operator = await prisma.operator.findUnique({
      where:  { id: parsed.operatorId },
      select: {
        id:                true,
        status:            true,
        verifyTokenHash:   true,
        verifyTokenExpiry: true,
      },
    })

    // No row, or token already consumed → uniform "invalid / used" message.
    if (!operator || !operator.verifyTokenHash || !operator.verifyTokenExpiry) {
      return fail('Lien invalide ou déjà utilisé')
    }
    if (operator.verifyTokenExpiry.getTime() < Date.now()) {
      return fail('Lien expiré. Demande un nouvel email de vérification.')
    }
    if (!safeEqualHex(sha256(parsed.secret), operator.verifyTokenHash)) {
      return fail('Lien invalide')
    }

    await prisma.operator.update({
      where: { id: operator.id },
      data: {
        // Promote ONLY a still-pending account; never downgrade one already
        // advanced (active / pending_review) by another path.
        status:            operator.status === 'pending' ? 'pending_review' : operator.status,
        emailVerifiedAt:   new Date(),
        verifyTokenHash:   null,   // single-use
        verifyTokenExpiry: null,
      },
    })

    return NextResponse.json({
      ok: true,
      message:
        'Email vérifié ✅. Ton compte partenaire est en cours de validation par ' +
        'notre équipe avant la mise en ligne.',
    })
  } catch (err) {
    console.error('[GET /api/partners/verify-email]', err)
    return fail('Erreur serveur', 500)
  }
}
