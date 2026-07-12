import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { issueEmailOtp, isMoneyStepUpEnabled, type OtpPurpose } from '@/lib/email-otp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/auth/step-up/request — send a money step-up code (Agent 88) ─────────
// AUTHENTICATED. Body { purpose } ∈ the step-up set. Emails a fresh 6-digit code bound
// to the SESSION email + purpose; the sensitive action route then requires that code.
// Gated by AUTH_MONEY_STEPUP_ENABLED (404 OFF → byte-identical, no step-up anywhere).
// Throttled per (email, purpose) by issueEmailOtp. The code is emailed to the account
// owner — the response NEVER contains it. TEST/real SMTP via the app transport.

const PURPOSES = new Set<OtpPurpose>(['stepup:withdraw', 'stepup:bank', 'stepup:email_change'])

const PURPOSE_LABEL: Record<string, string> = {
  'stepup:withdraw':     'confirmer un retrait',
  'stepup:bank':         'modifier vos informations bancaires',
  'stepup:email_change': "modifier l'e-mail de votre compte",
}

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'mail.grubano.com',
  port:   587,
  secure: false,
  auth:   { user: process.env.SMTP_USER || 'contact@grubano.com', pass: process.env.SMTP_PASS },
})

async function sendStepUpEmail(to: string, code: string, purpose: string) {
  const action = PURPOSE_LABEL[purpose] ?? 'confirmer une action sensible'
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">Confirmation de sécurité</h2>
      <p>Pour ${action}, saisissez ce code de confirmation :</p>
      <p style="text-align:center;margin:24px 0"><span style="display:inline-block;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:7px;color:#1a1a2e;background:#f3f4f6;border-radius:10px;padding:12px 20px">${code}</span></p>
      <p style="font-size:13px;color:#6b7280">Ce code est valable 10 minutes et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail et vérifiez votre compte.</p>
    </div>`
  const text = [
    'Confirmation de sécurité Grubano.',
    `Pour ${action}, saisissez ce code : ${code}`,
    "Valable 10 minutes, une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  ].join('\n')
  await transporter.sendMail({ from: '"Grubano" <contact@grubano.com>', to, subject: 'Votre code de confirmation Grubano', html, text })
}

export async function POST(req: Request) {
  if (!isMoneyStepUpEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })
  try {
    const session = await getServerSession(authOptions)
    const email = (session?.user as { email?: string } | undefined)?.email
    if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const body = (await req.json().catch(() => null)) as { purpose?: unknown } | null
    const purpose = typeof body?.purpose === 'string' ? body.purpose : ''
    if (!PURPOSES.has(purpose as OtpPurpose)) {
      return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
    }

    const issued = await issueEmailOtp(email, purpose as OtpPurpose)
    if (!issued.ok) {
      // Throttled — generic 429, never reveals timing/state beyond "try later".
      return NextResponse.json({ ok: false, reason: 'throttled' }, { status: 429 })
    }
    if (process.env.SMTP_PASS) {
      await sendStepUpEmail(email, issued.code, purpose)
    } else {
      console.error('[step-up] SMTP_PASS missing — code NOT emailed for', email)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/auth/step-up/request]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
