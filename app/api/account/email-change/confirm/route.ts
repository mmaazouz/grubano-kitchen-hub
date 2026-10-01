import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isEmailChangeEnabled, consumeEmailChange } from '@/lib/email-change'
import { sendEmailChangedAlert, sendEmailChangeConfirm } from '@/lib/transactional-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/account/email-change/confirm (Agent 147) ──────────────────────────
// STEP 2. Body { token } (from the link emailed to the NEW address). NO session required —
// possessing the link IS the proof of new-address possession (current identity was already
// proven at /request). consumeEmailChange validates the token (constant-time) and ATOMICALLY
// mutates operator.email := pendingEmail (race-safe; @unique backstop → P2002 = clean 409
// abort, current email kept). Gated by AUTH_EMAIL_CHANGE_ENABLED (404 OFF). After commit:
// best-effort security ALERT to the OLD address + CONFIRMATION to the NEW (never roll back).

const bodySchema = z.object({ token: z.string().min(3, 'Lien invalide') })

/** Mask an address for the security alert (n***@d***). */
function mask(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const l = local.length <= 1 ? local : `${local[0]}***`
  const d = domain.length <= 1 ? domain : `${domain[0]}***`
  return `${l}@${d}`
}

export async function POST(req: Request) {
  if (!isEmailChangeEnabled()) return NextResponse.json({ error: 'Indisponible' }, { status: 404 })
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 })

    const result = await consumeEmailChange(parsed.data.token)
    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: result.reason }, { status: result.reason === 'collision' ? 409 : 400 })
    }

    // After the committed mutation — best-effort notifications (never throw, never roll back).
    const key = `${result.oldEmail}->${result.newEmail}`
    await sendEmailChangedAlert({ to: result.oldEmail, newEmailMasked: mask(result.newEmail), dedupeKey: `email_changed:${key}` }).catch(() => {})
    await sendEmailChangeConfirm({ to: result.newEmail, dedupeKey: `email_change_done:${key}` }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/account/email-change/confirm]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
