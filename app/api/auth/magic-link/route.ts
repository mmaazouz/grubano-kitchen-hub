import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'
import { createMagicLinkToken } from '@/lib/magic-link'
import { locales, defaultLocale } from '@/i18n'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/auth/magic-link ─────────────────────────────────────────────────
// Request a passwordless sign-in link. Body: { email, locale? }.
//
// Anti-enumeration: ALWAYS returns the same generic response — it never reveals
// whether an account exists or what state it is in. A usable link is minted +
// emailed ONLY for an ACTIVE operator (a pending/suspended account could not sign
// in anyway). Reuses the app-wide SMTP transport (same config as
// /api/partners/register). Never 500s on a mail/DB hiccup — degrades to generic.

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'mail.grubano.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'contact@grubano.com',
    pass: process.env.SMTP_PASS,
  },
})

function baseUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'grubano.com'
  return `${proto}://${host}`
}

const GENERIC = {
  ok: true,
  message: "Si un compte existe pour cet email, un lien de connexion vient d'être envoyé. Vérifie ta boîte de réception (et les spams).",
}

async function sendMagicEmail(name: string, to: string, link: string) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">Connexion à Grubano</h2>
      <p>Bonjour ${name || ''}, voici ton lien de connexion sécurisé :</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#F97316;color:#fff;text-decoration:none;
           padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">
           Me connecter
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">Ce lien est valable 15 minutes et ne fonctionne qu'une seule fois.
         Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>
    </div>`
  await transporter.sendMail({
    from:    '"Grubano" <contact@grubano.com>',
    to,
    subject: 'Ton lien de connexion Grubano',
    html,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body   = (await req.json().catch(() => null)) as { email?: unknown; locale?: unknown } | null
    const email  = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const locale = typeof body?.locale === 'string' && (locales as readonly string[]).includes(body.locale)
      ? body.locale
      : defaultLocale
    if (!email) return NextResponse.json(GENERIC)

    const operator = await prisma.operator
      .findUnique({ where: { email }, select: { id: true, name: true, status: true } })
      .catch((e) => { console.error('[magic-link] db lookup failed:', e instanceof Error ? e.message : e); return null })

    // Only an ACTIVE account gets a usable link. Everything else → generic (no leak).
    if (operator && operator.status === 'active') {
      try {
        const { token, hash, expiry } = createMagicLinkToken(operator.id)
        await prisma.operator.update({
          where: { id: operator.id },
          data:  { magicLinkTokenHash: hash, magicLinkTokenExpiry: expiry },
        })
        const link = `${baseUrl(req)}/${locale}/auth/magic?token=${encodeURIComponent(token)}`
        if (process.env.SMTP_PASS) {
          await sendMagicEmail(operator.name, email, link)
        } else {
          // No SMTP secret (e.g. staging) → log the link so a dev can still test.
          console.error('[magic-link] SMTP_PASS missing — link NOT emailed for', email)
        }
      } catch (e) {
        // Unmigrated column / mail failure → stay generic, never 500.
        console.error('[magic-link] non-fatal:', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json(GENERIC)
  } catch {
    return NextResponse.json(GENERIC)
  }
}
