import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'
import { createMagicLinkToken } from '@/lib/magic-link'
import { issueEmailOtp, isEmailOtpEnabled } from '@/lib/email-otp'
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

// Grubano runs MULTIPLE portals on different domains (app.grubano.com for
// consumer/restaurant, business.grubano.com for suppliers, plus the apex). A magic
// link must point back to the portal the user actually came from — a supplier
// signing in on business.grubano.com must receive a business.grubano.com link, not
// an app.grubano.com one. Allow-list configurable via ALLOWED_MAGIC_HOSTS.
const DEFAULT_ALLOWED_HOSTS = 'app.grubano.com,business.grubano.com,grubano.com'

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.ALLOWED_MAGIC_HOSTS || DEFAULT_ALLOWED_HOSTS)
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
}

// Canonical configured origin — the SAFE fallback. NEXTAUTH_URL is set per env in
// .env.local (https://app.grubano.com staging, https://grubano.com prod); apex as a
// last resort. Never derived from the request.
function canonicalBase(): string {
  const configured = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(configured) ? configured : 'https://grubano.com'
}

function baseUrl(req: NextRequest): string {
  // Use the REQUEST host ONLY when it is an explicitly allow-listed grubano domain,
  // so the link follows the origin portal WITHOUT reopening host-injection: a forged,
  // missing, or internal (127.0.0.1:PORT) host is never allow-listed → it falls back
  // to the canonical base, never to an attacker-chosen domain. Forced to https (all
  // grubano portals are https; an x-forwarded-proto downgrade cannot apply).
  const fwd      = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const hostname = fwd.split(',')[0].trim().toLowerCase().split(':')[0] // first host, no port
  if (hostname && allowedHosts().has(hostname)) {
    return `https://${hostname}`
  }
  return canonicalBase()
}

const GENERIC = {
  ok: true,
  message: "Si un compte existe pour cet email, un lien de connexion vient d'être envoyé. Vérifie ta boîte de réception (et les spams).",
}

async function sendMagicEmail(name: string, to: string, link: string, code?: string | null) {
  // Two ways to follow the link so it is ALWAYS actionable, whatever the client does
  // with our HTML: (1) the styled "Me connecter" button, and (2) the FULL URL printed
  // as visible, copyable, clickable text. The button's style is kept on ONE line and
  // its label hugs the tags (no stray whitespace) — embedded newlines inside an <a>
  // are what some clients render as a non-clickable blob. We also send a plain-text
  // alternative (multipart/alternative) so text-only / sanitizing clients still get a
  // bare URL they can tap or copy.
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">Connexion à Grubano</h2>
      <p>Bonjour${name ? ' ' + name : ''}, voici ton lien de connexion sécurisé :</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#F97316;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">Me connecter</a>
      </p>
      <p style="font-size:13px;color:#6b7280;margin:0 0 6px">Le bouton ne s'affiche pas ? Copie-colle ce lien dans ton navigateur :</p>
      <p style="font-size:13px;margin:0 0 24px"><a href="${link}" style="color:#F97316;word-break:break-all">${link}</a></p>
      ${code ? `<p style="font-size:13px;color:#6b7280;margin:0 0 6px">Le lien s'ouvre dans le mauvais navigateur ? Saisis plutôt ce code sur la page de connexion :</p>
      <p style="text-align:center;margin:0 0 24px"><span style="display:inline-block;font-family:monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#1a1a2e;background:#f3f4f6;border-radius:10px;padding:10px 18px">${code}</span></p>` : ''}
      <p style="font-size:13px;color:#6b7280">Ce lien${code ? ' et ce code sont valables' : ' est valable'} 15 minutes et ne fonctionne${code ? 'nt' : ''} qu'une seule fois. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>
    </div>`
  const text = [
    `Bonjour${name ? ' ' + name : ''},`,
    '',
    'Voici ton lien de connexion sécurisé à Grubano. Clique dessus ou copie-colle-le dans ton navigateur :',
    '',
    link,
    ...(code ? ['', `Ou saisis ce code à 6 chiffres sur la page de connexion : ${code}`] : []),
    '',
    `Ce lien${code ? ' et ce code sont valables' : ' est valable'} 15 minutes et ne fonctionne${code ? 'nt' : ''} qu'une seule fois.`,
    "Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.",
  ].join('\n')
  await transporter.sendMail({
    from:    '"Grubano" <contact@grubano.com>',
    to,
    subject: 'Ton lien de connexion Grubano',
    html,
    text,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body   = (await req.json().catch(() => null)) as { email?: unknown; locale?: unknown; space?: unknown } | null
    const email  = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const locale = typeof body?.locale === 'string' && (locales as readonly string[]).includes(body.locale)
      ? body.locale
      : defaultLocale
    // Consumer routing (additive): a CONSUMER request (space:'eat') gets a link back to the
    // CONSUMER /eat/magic screen; every existing caller (no space) keeps /auth/magic. Only this
    // destination PATH differs — the token security, the verify, and the email body are unchanged.
    const callbackPath = body?.space === 'eat' ? 'eat/magic' : 'auth/magic'
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
        // Phase 3 (Agent 88) — when the login OTP is enabled, mint a 6-digit code
        // (purpose 'login', bound to this email) and include it in the SAME email as
        // the link. Throttled → no code (the link still works). OFF → no code, email
        // byte-identical. Best-effort: a code failure never blocks the link.
        let otpCode: string | null = null
        if (isEmailOtpEnabled()) {
          try {
            const issued = await issueEmailOtp(email, 'login')
            if (issued.ok) otpCode = issued.code
          } catch (e) {
            console.error('[magic-link] otp issue non-fatal:', e instanceof Error ? e.message : e)
          }
        }
        const link = `${baseUrl(req)}/${locale}/${callbackPath}?token=${encodeURIComponent(token)}`
        if (process.env.SMTP_PASS) {
          await sendMagicEmail(operator.name, email, link, otpCode)
        } else {
          // No SMTP secret (e.g. staging) → log the link so a dev can still test.
          console.error('[magic-link] SMTP_PASS missing — link NOT emailed for', email)
        }
      } catch (e) {
        // Unmigrated column / mail failure → stay generic, never 500.
        console.error('[magic-link] non-fatal:', e instanceof Error ? e.message : e)
      }
    }

    // The login-OTP availability is a GLOBAL config flag (not account-specific) → it
    // leaks no enumeration signal. OFF → exactly GENERIC (byte-identical response).
    return NextResponse.json(isEmailOtpEnabled() ? { ...GENERIC, otpEnabled: true } : GENERIC)
  } catch {
    return NextResponse.json(GENERIC)
  }
}
