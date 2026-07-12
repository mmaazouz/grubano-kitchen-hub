import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sha256 } from '@/lib/partner-verification'
import { verifyEmailOtp } from '@/lib/email-otp'
import { isEmailChangeEnabled, checkEmailChangeEligibility, setPendingEmail, domainAcceptsMail, normEmail } from '@/lib/email-change'
import { sendEmailChangeLink, sendEmailAlreadyUsedNotice } from '@/lib/transactional-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/account/email-change/request (Agent 147) ──────────────────────────
// STEP 1. AUTHENTICATED. Body { newEmail, currentEmailCode }. Proves CURRENT identity
// (verifyEmailOtp DIRECT — never requireStepUp), validates the new address, enforces uniqueness
// with ANTI-ENUMERATION, and on success parks the pending change + emails a single-use
// confirmation LINK to the NEW address. NEVER mutates operator.email here. Gated by
// AUTH_EMAIL_CHANGE_ENABLED (404 OFF). ⭐ Current email is read from the DB, not the JWT.

const bodySchema = z.object({
  newEmail:         z.string().email('E-mail invalide'),
  currentEmailCode: z.string().trim().min(1, 'Code requis'),
})

function appBaseUrl(req: NextRequest): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'grubano.com'
  return `${proto}://${host}`
}

// Identical generic success whether the new email is free or already taken → no enumeration.
const genericOk = () =>
  NextResponse.json({
    ok: true,
    message: "Si tout est correct, un e-mail de confirmation vient d'être envoyé à votre nouvelle adresse. Cliquez le lien qu'il contient pour finaliser le changement.",
  })

export async function POST(req: NextRequest) {
  if (!isEmailChangeEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })
  try {
    const session = await getServerSession(authOptions)
    const operatorId = (session?.user as { id?: string } | undefined)?.id
    if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    // (a) SCOPE guard — email-keyed partner roles/profiles + OAuth accounts refused.
    const elig = await checkEmailChangeEligibility(operatorId)
    if (!elig.ok) return NextResponse.json({ error: "Changement d'e-mail indisponible pour ce type de compte" }, { status: 403 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })

    const currentEmail = elig.email            // ⭐ from DB
    const newEmail     = normEmail(parsed.data.newEmail)

    // (b) PROOF OF CURRENT IDENTITY — single-use OTP on the CURRENT address. verifyEmailOtp
    // DIRECT (NOT requireStepUp, which is inert when AUTH_MONEY_STEPUP_ENABLED is OFF). Done
    // BEFORE the uniqueness probe so the endpoint can't be used as an email-existence oracle
    // without first proving control of the current account.
    const proven = await verifyEmailOtp(currentEmail, 'stepup:email_change', parsed.data.currentEmailCode)
    if (!proven) return NextResponse.json({ error: 'Code invalide ou expiré' }, { status: 400 })

    // (c) same-address + MX guards (format already enforced by zod).
    if (newEmail === currentEmail) return NextResponse.json({ error: 'Cette adresse est déjà la vôtre' }, { status: 400 })
    if (!(await domainAcceptsMail(newEmail))) return NextResponse.json({ error: 'Le domaine de cet e-mail ne reçoit pas de courrier.' }, { status: 400 })

    // (d) UNIQUENESS — anti-enum: already a Grubano account → notify THAT address, generic
    // response, NO pending stored (the requester learns nothing about the address's existence).
    const existing = await prisma.operator.findUnique({ where: { email: newEmail }, select: { id: true } })
    if (existing) {
      await sendEmailAlreadyUsedNotice({ to: newEmail }).catch(() => {})
      return genericOk()
    }

    // (e) free → park the pending change + email the single-use confirmation LINK to the NEW address.
    const { token } = await setPendingEmail(operatorId, newEmail)
    const link = `${appBaseUrl(req)}/eat/account/email/confirm?token=${encodeURIComponent(token)}`
    await sendEmailChangeLink({ to: newEmail, link, dedupeKey: `email_change_link:${sha256(token)}` }).catch(() => {})
    return genericOk()
  } catch (err) {
    console.error('[POST /api/account/email-change/request]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
