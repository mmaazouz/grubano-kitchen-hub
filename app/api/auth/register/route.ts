import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import nodemailer from 'nodemailer'
import { z } from 'zod'

// nodemailer needs the Node runtime (it is the default for app routes, made
// explicit here like /api/partners/register).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SECURITY: `role` is deliberately NOT accepted from the request body. This
// endpoint only ever creates a CONSUMER account — the role is forced
// server-side below. A client-supplied role here would be a privilege-escalation
// vector (anyone could mint a `restaurant`/`admin` account). Partner accounts go
// through POST /api/partners/register, which forces role='restaurant' + email
// verification. Any extra key (e.g. a stray `role`) is silently stripped by Zod.
const registerSchema = z.object({
  name:     z.string().min(2).max(80),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
})

// ── Welcome / confirmation email (best-effort) ────────────────────────────────
// The confirmation email was NEVER wired on consumer registration (the partner
// flow has one; this flow had none — the root cause of "no email ever received").
// Same transport config as the rest of the app (partners/register, suppliers,
// email-agent): port 587 + secure:false are the app-wide convention, and only
// SMTP_HOST / SMTP_USER / SMTP_PASS are read — no SMTP_PORT/SMTP_FROM needed.
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'mail.grubano.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'contact@grubano.com',
    pass: process.env.SMTP_PASS,
  },
})

async function sendWelcomeEmail(to: string, name: string) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">Bienvenue sur Grubano, ${name} 👋</h2>
      <p>Ton compte est créé et déjà actif. Tu peux commander, réserver une table
         et suivre tes points fidélité depuis ton espace.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="https://grubano.com/eat" style="background:#F97316;color:#fff;text-decoration:none;
           padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">
           Découvrir les restaurants
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">Si tu n'es pas à l'origine de cette
         inscription, réponds simplement à cet email.</p>
    </div>`

  await transporter.sendMail({
    from:    '"Grubano" <contact@grubano.com>',
    to,
    subject: 'Bienvenue sur Grubano — ton compte est prêt',
    html,
  })
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = registerSchema.parse(body)

    // Check existing
    const existing = await prisma.operator.findUnique({ where: { email: data.email } })
    if (existing) {
      return NextResponse.json(
        { error: 'Un compte avec cet email existe déjà' },
        { status: 409 },
      )
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)

    const operator = await prisma.operator.create({
      data: {
        name:     data.name,
        email:    data.email,
        password: hashedPassword,
        role:     'consumer',   // forced server-side — never client-controlled
        status:   'active',
      },
    })

    // Loyalty is an AUTOMATIC acquis (chantier fidélité): create the consumer's
    // LoyaltyCustomer at signup so the balance EXISTS before the first delivery
    // (the earn path in orders/[id]/status also upserts as a safety net for
    // pre-existing accounts). Created at 0 pts: the 10-pt welcome bonus stays
    // reserved to the explicit /api/loyalty/register opt-in, NOT duplicated for
    // every signup. Best-effort + idempotent (upsert) — never fails registration,
    // leaves an existing row untouched. No financial amount involved.
    try {
      await prisma.loyaltyCustomer.upsert({
        where:  { email: data.email },
        update: {},
        create: { name: data.name, email: data.email, pointsBalance: 0 },
      })
    } catch (loyErr) {
      console.error('[POST /api/auth/register] loyalty account creation failed (non-fatal):',
        data.email, loyErr instanceof Error ? loyErr.message : loyErr)
    }

    // Welcome email — BEST-EFFORT and NEVER silent. The account is already
    // created (and the client signs in right after), so an email failure must not
    // fail the registration; but it MUST be visible: clear console.error + an
    // EmailLog row (status sent | failed | skipped) for the audit trail. A missing
    // SMTP_PASS is logged as 'skipped' instead of producing a cryptic auth error.
    let emailStatus = 'sent'
    try {
      if (!process.env.SMTP_PASS) {
        emailStatus = 'skipped'
        console.error('[POST /api/auth/register] SMTP_PASS missing — welcome email SKIPPED for', data.email)
      } else {
        await sendWelcomeEmail(data.email, data.name)
      }
    } catch (mailErr) {
      emailStatus = 'failed'
      console.error('[POST /api/auth/register] welcome email FAILED for', data.email,
        mailErr instanceof Error ? mailErr.message : mailErr)
    }
    try {
      await prisma.emailLog.create({
        data: {
          recipient: data.email,
          subject:   'Bienvenue sur Grubano — ton compte est prêt',
          trigger:   'consumer_welcome',
          status:    emailStatus,
        },
      })
    } catch {
      /* audit log is best-effort */
    }

    return NextResponse.json(
      { id: operator.id, email: operator.email, role: operator.role },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    console.error('[POST /api/auth/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
