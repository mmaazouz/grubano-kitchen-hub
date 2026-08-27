import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sha256 } from '@/lib/partner-verification'
import { sendPasswordResetEmail } from '@/lib/transactional-emails'
import { rateLimit } from '@/lib/rate-limit'

// ── POST /api/auth/forgot-password — Emails v2 FIX 3 (step 1/2) ────────────────
//
// PUBLIC (under the /api/auth middleware allowance). Body { email, space? }.
// ALWAYS answers 200 { ok:true } — whether the account exists or not (no user
// enumeration). When the account exists AND has a password (SSO-only accounts
// have nothing to reset):
//   - a SINGLE-USE random token (crypto, 64 hex chars) valid 1 HOUR is minted;
//     ONLY ITS SHA-256 is stored in the EXISTING VerificationToken table
//     (identifier 'pwreset:<email>' — namespaced, the table is unused by any
//     other flow; previous tokens for the identifier are deleted → one active
//     token at a time). Lot 7 (P1 sécurité) : même convention que le magic-link
//     (lib/magic-link) — un dump de la table ne donne plus de lien de reset
//     utilisable. Rétro-compatible par expiration naturelle (TTL 1 h : un token
//     en clair émis avant le déploiement ne matche plus, il expire seul),
//   - the reset email (best-effort, EmailLog trigger password_reset_request)
//     carries {NEXTAUTH_URL}/fr/eat/reset-password?token=…&email=…&space=…
//     (the page is PUBLIC via the /eat tree — middleware untouched; `space`
//     only routes the post-reset CTA: business vs consumer sign-in).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 h

const bodySchema = z.object({
  email: z.string().email(),
  space: z.enum(['eat', 'business']).optional(),
})

export async function POST(req: Request) {
  // P0 rate-limit (WP-SEC-03 wiring) — throttle BEFORE any DB lookup, token
  // mint or reset email. IP-keyed; gated by RATE_LIMIT_ENABLED (OFF →
  // byte-identical). The always-200 anti-enumeration contract is preserved:
  // the 429 depends on the caller's IP, never on the account's existence.
  const limited = rateLimit(req, 'auth_forgot_password', { limitDefault: 5, windowDefault: 600 })
  if (limited) return limited

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()
    const space = parsed.data.space ?? 'eat'

    const operator = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, name: true, email: true, password: true },
    })

    // Account exists with a credentials password → issue the token + email.
    // Anything else falls through to the same 200 (no enumeration).
    if (operator?.password) {
      const identifier = `pwreset:${email}`
      const token = randomBytes(32).toString('hex')
      // Purge en bande (best-effort) : les tokens EXPIRÉS de cet identifier ne
      // doivent jamais s'accumuler. La suppression inconditionnelle qui suit la
      // recouvre ici, mais elle, n'est PAS best-effort (elle garantit « un seul
      // token actif ») — la purge reste correcte si cette règle évolue.
      await prisma.verificationToken.deleteMany({
        where: { identifier, expires: { lt: new Date() } },
      }).catch(() => {})
      await prisma.verificationToken.deleteMany({ where: { identifier } })
      // Store ONLY the hash — the clear token exists in the emailed URL alone.
      await prisma.verificationToken.create({
        data: { identifier, token: sha256(token), expires: new Date(Date.now() + TOKEN_TTL_MS) },
      })

      const base = process.env.NEXTAUTH_URL || 'https://grubano.com'
      const resetUrl =
        `${base.replace(/\/$/, '')}/fr/eat/reset-password` +
        `?token=${token}&email=${encodeURIComponent(email)}&space=${space}`

      await sendPasswordResetEmail({
        to:       operator.email,
        name:     operator.name,
        resetUrl,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/auth/forgot-password]', err instanceof Error ? err.message : err)
    // Same shape on server hiccup — the caller can't distinguish anyway.
    return NextResponse.json({ ok: true })
  }
}
