import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { issueEmailOtp } from '@/lib/email-otp'
import { isEmailChangeEnabled, checkEmailChangeEligibility } from '@/lib/email-change'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/account/email-change/request-code (Agent 147) ─────────────────────
// STEP 0 of the email change. AUTHENTICATED. Emails a fresh 6-digit code (purpose
// 'stepup:email_change') to the account's CURRENT address — ⭐ read from the DB (by
// token.sub), NEVER from the JWT (token.email can be stale). Gated by AUTH_EMAIL_CHANGE_ENABLED
// (404 OFF → byte-identical). Throttled per (email,purpose) by issueEmailOtp; the response
// NEVER contains the code. Reuses lib/email-otp UNMODIFIED. NO money / NO requireStepUp.
//
// The OTP-CODE email uses a DIRECT transport (calque of /api/auth/step-up/request), NOT the
// sendOnce notification rail: a one-time CODE must never be deduplicated (a re-issued code must
// stay deliverable). This route performs NO mutation, so a send failure can never roll back any
// state. (The flow's 4 NOTIFICATION emails — link / alert / confirm / already-used — DO use sendOnce.)

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'mail.grubano.com',
  port:   587,
  secure: false,
  auth:   { user: process.env.SMTP_USER || 'contact@grubano.com', pass: process.env.SMTP_PASS },
})

async function sendCode(to: string, code: string) {
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">Confirmation de sécurité</h2>
      <p>Pour modifier l'e-mail de votre compte, saisissez ce code de confirmation :</p>
      <p style="text-align:center;margin:24px 0"><span style="display:inline-block;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:7px;color:#1a1a2e;background:#f3f4f6;border-radius:10px;padding:12px 20px">${code}</span></p>
      <p style="font-size:13px;color:#6b7280">Ce code est valable 10 minutes et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail et vérifiez votre compte.</p>
    </div>`
  const text = [
    'Confirmation de sécurité Grubano.',
    `Pour modifier l'e-mail de votre compte, saisissez ce code : ${code}`,
    "Valable 10 minutes, une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  ].join('\n')
  await transporter.sendMail({ from: '"Grubano" <contact@grubano.com>', to, subject: 'Votre code de confirmation Grubano', html, text })
}

export async function POST() {
  if (!isEmailChangeEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })
  try {
    const session = await getServerSession(authOptions)
    const operatorId = (session?.user as { id?: string } | undefined)?.id
    if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    // Scope guard (email-keyed partner roles/profiles + OAuth) — refuse cleanly, no code sent.
    const elig = await checkEmailChangeEligibility(operatorId)
    if (!elig.ok) return NextResponse.json({ error: "Changement d'e-mail indisponible pour ce type de compte" }, { status: 403 })

    const issued = await issueEmailOtp(elig.email, 'stepup:email_change') // ⭐ current email from DB
    if (!issued.ok) return NextResponse.json({ ok: false, reason: 'throttled' }, { status: 429 })
    if (process.env.SMTP_PASS) {
      await sendCode(elig.email, issued.code)
    } else {
      console.error('[email-change/request-code] SMTP_PASS missing — code NOT emailed for', elig.email)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/account/email-change/request-code]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
