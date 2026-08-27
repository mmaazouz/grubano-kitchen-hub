import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sha256 } from '@/lib/partner-verification'
import { sendPasswordChangedEmail } from '@/lib/transactional-emails'
import { rateLimit } from '@/lib/rate-limit'

// ── POST /api/auth/reset-password — Emails v2 FIX 3 (step 2/2) ─────────────────
//
// PUBLIC (under /api/auth). Body { email, token, password }. Verifies the
// pwreset token issued by /forgot-password (identifier 'pwreset:<email>',
// expiry 1 h). Lot 7 (P1 sécurité) : la table stocke le SHA-256 du token (même
// convention que lib/magic-link) — la vérification compare sha256(token reçu)
// au hash stocké. Then:
//   - bcryptjs cost 12 (app-wide convention — mirrors registration),
//   - CONSUMES the token: every token of the identifier is deleted (single
//     use; a re-POST with the same link → 400 invalid),
//   - sends the security email « Votre mot de passe a été changé »
//     (best-effort, trigger password_changed).
// Errors are deliberately generic ("lien invalide ou expiré") — no oracle.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email:    z.string().email(),
  token:    z.string().min(32).max(128),
  password: z.string().min(8).max(100),
})

export async function POST(req: Request) {
  // P0 rate-limit (WP-SEC-03 wiring) — throttle BEFORE the token lookup and
  // the bcrypt hash (cost 12) of the new password. IP-keyed; gated by
  // RATE_LIMIT_ENABLED (OFF → byte-identical). Token guessing is already
  // entropy-infeasible; this caps the per-request DB + hash cost.
  const limited = rateLimit(req, 'auth_reset_password', { limitDefault: 10, windowDefault: 600 })
  if (limited) return limited

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'Données invalides'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()
    const identifier = `pwreset:${email}`

    // The URL carries the CLEAR token; the table holds only its SHA-256. A clear
    // token stored by the pre-hash code can no longer match — it dies by its own
    // 1 h TTL (deliberate retro-compat by natural expiry). Error paths and shapes
    // below are UNCHANGED (anti-enumeration preserved).
    const row = await prisma.verificationToken.findFirst({
      where: { identifier, token: sha256(parsed.data.token) },
    })
    if (!row || row.expires.getTime() < Date.now()) {
      // Expired rows are purged on the way out so the table never accumulates.
      await prisma.verificationToken.deleteMany({
        where: { identifier, expires: { lt: new Date() } },
      }).catch(() => {})
      return NextResponse.json(
        { error: 'Lien invalide ou expiré — refaites une demande de réinitialisation.' },
        { status: 400 },
      )
    }

    const operator = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, name: true, email: true, password: true },
    })
    if (!operator?.password) {
      return NextResponse.json(
        { error: 'Lien invalide ou expiré — refaites une demande de réinitialisation.' },
        { status: 400 },
      )
    }

    const hashed = await bcrypt.hash(parsed.data.password, 12)
    await prisma.operator.update({
      where: { id: operator.id },
      data:  { password: hashed },
    })

    // Single use: consume EVERY token of this identifier.
    await prisma.verificationToken.deleteMany({ where: { identifier } }).catch(() => {})

    // Security notice — best-effort, never blocks the reset.
    await sendPasswordChangedEmail({ to: operator.email, name: operator.name })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/auth/reset-password]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
