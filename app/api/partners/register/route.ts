import { NextRequest, NextResponse } from 'next/server'
import { promises as dns } from 'dns'
import bcrypt from 'bcryptjs'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createVerificationToken } from '@/lib/partner-verification'

// Live network (DNS MX lookup + SMTP) + DB writes — must always run on demand on
// the Node.js runtime (dns / nodemailer are unavailable on the edge runtime).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── POST /api/partners/register ───────────────────────────────────────────────
// Secure SELF-SERVE partner (restaurateur) registration. Hardened against the
// privilege-escalation, enumeration and bot abuse called out in the Agent 12
// audit. The role is forced to 'restaurant' SERVER-SIDE — it is NEVER read from
// the body. The partner path is distinguished by HOST (business.grubano.com),
// not by any falsifiable body field.
//
// Flow:
//   1. Host gate   → endpoint only answers on business.grubano.com (404 elsewhere).
//   2. Rate limit  → max 5 submissions / IP / hour (in-memory sliding window).
//   3. Anti-bot    → honeypot field + minimum fill time (light, no dependency).
//   4. Validate    → Zod: name, email (format + MX), strong password, RGPD consent.
//   5. Anti-enum   → uniform generic response whether or not the email exists.
//   6. Create      → Operator status='pending', role='restaurant', consentAt set;
//                    SHA-256-hashed verification token (24h) stored on the row.
//                    NO Restaurant row is created here (data minimisation — the
//                    address/city are collected later at onboarding, and that
//                    Restaurant must start isActive=false until admin approval).
//   7. Email        → SMTP verification link → GET /api/partners/verify-email.
//
// A 'pending' partner cannot log in (lib/auth.ts) and has no live restaurant, so
// it can never publish or appear on /eat.

const PARTNER_HOST = 'business.grubano.com'

// ── Host gate ─────────────────────────────────────────────────────────────────
// The host is taken from the (proxy-set) Host / X-Forwarded-Host header — it
// cannot be spoofed via the request body, which is the property we need. In
// dev/staging, PARTNER_REGISTER_ALLOW_HOST opens extra hosts (comma-separated,
// or '*' to allow any) so the flow is testable WITHOUT the production subdomain.
// This is an env-only escape hatch — never a body field.
function hostAllowed(req: NextRequest): boolean {
  const raw = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const host = raw.toLowerCase().split(':')[0].trim()
  if (host === PARTNER_HOST) return true

  const allow = process.env.PARTNER_REGISTER_ALLOW_HOST
  if (allow) {
    const list = allow.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (list.includes('*') || list.includes(host)) return true
  }
  return false
}

// ── Per-IP rate limit (in-memory sliding window) ──────────────────────────────
// Process-local — fine on the long-running Passenger Node process. Not a
// distributed limiter; it's the "light anti-bot, no heavy dependency" the spec
// asks for.
const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_MAX = 5
const ipHits = new Map<string, number[]>()

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  // Opportunistic prune so the map can't grow unbounded.
  if (ipHits.size > 2000) {
    ipHits.forEach((v, k) => {
      const fresh = v.filter(t => now - t < RATE_WINDOW_MS)
      if (fresh.length === 0) ipHits.delete(k)
      else ipHits.set(k, fresh)
    })
  }
  const hits = (ipHits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_MAX) {
    ipHits.set(ip, hits)
    return true
  }
  hits.push(now)
  ipHits.set(ip, hits)
  return false
}

// ── Email domain MX check (typo / throwaway guard) ────────────────────────────
async function domainAcceptsMail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]
  if (!domain) return false
  try {
    const mx = await dns.resolveMx(domain)
    if (Array.isArray(mx) && mx.length > 0) return true
  } catch {
    /* fall through to implicit-MX (A/AAAA) check */
  }
  // RFC 5321 implicit MX: a domain with only an A/AAAA record can still receive mail.
  try {
    const a = await dns.resolve(domain)
    return Array.isArray(a) && a.length > 0
  } catch {
    return false
  }
}

// ── Validation ────────────────────────────────────────────────────────────────
const partnerSchema = z.object({
  name:     z.string().min(2, 'Nom trop court').max(80, 'Nom trop long'),
  email:    z.string().email('Email invalide'),
  password: z
    .string()
    .min(10, 'Mot de passe trop court (10 caractères minimum)')
    .max(100, 'Mot de passe trop long')
    .regex(/[a-z]/, 'Le mot de passe doit contenir une minuscule')
    .regex(/[A-Z]/, 'Le mot de passe doit contenir une majuscule')
    .regex(/[0-9]/, 'Le mot de passe doit contenir un chiffre'),
  // RGPD: explicit, mandatory consent — timestamped in DB (consentAt).
  consent:  z.boolean().refine(v => v === true, { message: 'Consentement requis' }),
  // Anti-bot (light) — both optional, checked only when present:
  //   website        → honeypot; a real form leaves it empty.
  //   formStartedAt  → epoch ms the form was rendered; a human takes ≥ 2s.
  website:       z.string().optional(),
  formStartedAt: z.number().int().optional(),
})

const MIN_FILL_MS = 2000

// Uniform response — identical whether the email is new or already registered,
// or whether a bot tripped the honeypot/timing trap. This is the anti-enumeration
// guarantee: the response never reveals whether an account exists.
function genericOk() {
  return NextResponse.json({
    ok: true,
    message:
      "Si ces informations sont valides, un email de vérification vient d'être " +
      'envoyé. Vérifie ta boîte de réception (pense à regarder les spams).',
  })
}

// ── SMTP (same transport config as the rest of the app) ───────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'mail.grubano.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'contact@grubano.com',
    pass: process.env.SMTP_PASS,
  },
})

function appBaseUrl(req: NextRequest): string {
  if (process.env.PARTNER_APP_URL) return process.env.PARTNER_APP_URL.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? PARTNER_HOST
  return `${proto}://${host}`
}

async function sendVerificationEmail(req: NextRequest, to: string, name: string, token: string) {
  const link = `${appBaseUrl(req)}/api/partners/verify-email?token=${encodeURIComponent(token)}`
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">Bienvenue sur Grubano, ${name} 👋</h2>
      <p>Pour activer ton espace partenaire, confirme ton adresse email :</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#F97316;color:#fff;text-decoration:none;
           padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">
           Vérifier mon email
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">Ce lien expire dans 24 heures. Si tu n'es
         pas à l'origine de cette demande, ignore simplement cet email.</p>
    </div>`

  await transporter.sendMail({
    from:    '"Grubano" <contact@grubano.com>',
    to,
    subject: 'Confirme ton email — espace partenaire Grubano',
    html,
  })
}

export async function POST(req: NextRequest) {
  // 1. Host gate — 404 on any host that isn't the partner subdomain. Returning
  //    404 (not 403) avoids advertising the endpoint's existence elsewhere.
  if (!hostAllowed(req)) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  }

  // 2. Rate limit per IP.
  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { error: 'Trop de tentatives. Réessaie dans une heure.' },
      { status: 429 },
    )
  }

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }

    // 3. Anti-bot — honeypot + minimum fill time. A tripped trap returns the SAME
    //    generic success so a bot can't tell it was caught.
    if (typeof (body as { website?: unknown }).website === 'string' &&
        (body as { website: string }).website.trim() !== '') {
      return genericOk()
    }
    const startedAt = (body as { formStartedAt?: unknown }).formStartedAt
    if (typeof startedAt === 'number' && Date.now() - startedAt < MIN_FILL_MS) {
      return genericOk()
    }

    // 4. Validation (specific 400s here are about the input format, NOT account
    //    existence, so they don't leak anything an enumerator could use).
    const parsed = partnerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }

    const name     = parsed.data.name.trim()
    const email    = parsed.data.email.trim().toLowerCase()
    const password = parsed.data.password

    if (!(await domainAcceptsMail(email))) {
      return NextResponse.json(
        { error: "Le domaine de cet email ne reçoit pas d'email." },
        { status: 400 },
      )
    }

    // 5. Anti-enumeration — if the email already exists, do nothing and return the
    //    generic response. We never confirm or deny the account's existence.
    const existing = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true },
    })
    if (existing) {
      return genericOk()
    }

    // 6. Create the pending partner account + hashed verification token.
    const hashedPassword = await bcrypt.hash(password, 12)
    const operator = await prisma.operator.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role:     'restaurant', // forced server-side — never client-controlled
        status:   'pending',    // email not verified yet → login refused
        consentAt: new Date(),  // RGPD: explicit consent, timestamped
      },
      select: { id: true },
    })

    const { token, hash, expiry } = createVerificationToken(operator.id)
    await prisma.operator.update({
      where: { id: operator.id },
      data:  { verifyTokenHash: hash, verifyTokenExpiry: expiry },
    })

    // 7. Send the verification email. A delivery failure is logged but must not
    //    500 (that would leak the account's creation) — the partner can retry via
    //    a future resend. We record the attempt in EmailLog for the audit trail.
    let emailStatus = 'sent'
    try {
      await sendVerificationEmail(req, email, name, token)
    } catch (mailErr) {
      emailStatus = 'failed'
      console.error('[POST /api/partners/register] verification email failed', mailErr)
    }
    try {
      await prisma.emailLog.create({
        data: {
          recipient: email,
          subject:   'Confirme ton email — espace partenaire Grubano',
          trigger:   'partner_verify',
          status:    emailStatus,
        },
      })
    } catch {
      /* audit log is best-effort */
    }

    return genericOk()
  } catch (err) {
    console.error('[POST /api/partners/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
