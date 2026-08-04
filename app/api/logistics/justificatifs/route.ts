import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isLogisticsEnabled } from '@/lib/logistics-account'

export const dynamic = 'force-dynamic'

// ── /api/logistics/justificatifs — the courier submits / reads their own compliance
// declaration (Agent 125). OWNER-ONLY: resolved from the session e-mail → their own
// LogisticsProfile (no client id → no IDOR), exactly like /api/logistics/profile. A
// STRUCTURED DECLARATION (insurance + RC Pro) — no file upload in this brick. Submitting
// sets justificatifsStatus='submitted'; it does NOT activate the account (activation is a
// gated ADMIN action — see /api/admin/logistics/activation). NO money. The GET is column-
// tolerant so it degrades gracefully BEFORE the additive migration is db-pushed.

const submitSchema = z.object({
  insuranceInsurer:      z.string().trim().min(2, 'Assureur requis').max(120),
  insurancePolicyNumber: z.string().trim().min(2, 'N° de police requis').max(80),
  insuranceExpiry:       z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date d’expiration (AAAA-MM-JJ) requise'),
  rcProInsurer:          z.string().trim().min(2, 'Assureur RC Pro requis').max(120),
  rcProPolicyNumber:     z.string().trim().min(2, 'N° RC Pro requis').max(80),
})

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const email = await sessionEmail()
  if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })
  try {
    const p = await prisma.logisticsProfile.findUnique({
      where:  { email },
      select: {
        status: true,
        insuranceInsurer: true, insurancePolicyNumber: true, insuranceExpiry: true,
        rcProInsurer: true, rcProPolicyNumber: true,
        justificatifsStatus: true, justificatifsSubmittedAt: true, justificatifsVerifiedAt: true,
      },
    })
    if (!p) return NextResponse.json({ ok: false, error: 'Profil livreur introuvable' }, { status: 403 })
    return NextResponse.json({ ok: true, justificatifs: {
      status:                p.justificatifsStatus,
      insuranceInsurer:      p.insuranceInsurer ?? '',
      insurancePolicyNumber: p.insurancePolicyNumber ?? '',
      insuranceExpiry:       p.insuranceExpiry ?? '',
      rcProInsurer:          p.rcProInsurer ?? '',
      rcProPolicyNumber:     p.rcProPolicyNumber ?? '',
      accountStatus:         p.status,
    } })
  } catch (err) {
    // Column-tolerant: before the additive migration is db-pushed, the new columns do not
    // exist → degrade to an empty 'none' declaration instead of a hard 500 (feature inert).
    console.error('[GET /api/logistics/justificatifs] (column-tolerant)', err)
    return NextResponse.json({ ok: true, justificatifs: { status: 'none', insuranceInsurer: '', insurancePolicyNumber: '', insuranceExpiry: '', rcProInsurer: '', rcProPolicyNumber: '', accountStatus: 'pending' } })
  }
}

export async function PATCH(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const email = await sessionEmail()
  if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })
  try {
    const existing = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!existing) return NextResponse.json({ ok: false, error: 'Profil livreur introuvable' }, { status: 403 })

    const parsed = submitSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // Record the declaration + mark it SUBMITTED. This NEVER changes status/auth — activation
    // remains a gated admin action. The courier may re-submit (updates the declaration; an
    // already-verified profile is NOT re-opened here — admins own 'verified').
    await prisma.logisticsProfile.update({
      where: { email },
      data: {
        insuranceInsurer:      d.insuranceInsurer,
        insurancePolicyNumber: d.insurancePolicyNumber,
        insuranceExpiry:       d.insuranceExpiry,
        rcProInsurer:          d.rcProInsurer,
        rcProPolicyNumber:     d.rcProPolicyNumber,
        justificatifsStatus:   'submitted',
        justificatifsSubmittedAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/logistics/justificatifs]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
