import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureFranchiseOperator } from '@/lib/franchise-account'
import { setVerifiedCompanyIdentity } from '@/lib/operator-identity'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'
import { isFranchiseEnabled } from '@/lib/franchise-account'

export const dynamic = 'force-dynamic'

// ── POST /api/franchise/approve ───────────────────────────────────────────────
// ADMIN-only. MIRROR of POST /api/supplier/approve: makes a FranchiseApplication
// approval EFFECTIVE (today nothing is read at approval — the franchisee never gets
// the 'franchise' role). Body: { applicationId } (FranchiseApplication.email is NOT
// unique, so we key off the application id, not the email). On approval:
//   (1) ensureFranchiseOperator → provisions/activates the passwordless login and
//       grants the 'franchise' role (VERIFIED — a failed grant never yields an
//       'approved' status, so there is no phantom approval);
//   (2) persists the declared company identity on the Operator via the B1.1 helper
//       (admin approval IS the manual verification → kybStatus='verified') —
//       BEST-EFFORT (see note);
//   (3) flips FranchiseApplication.status to 'approved' (idempotent).
//
// Authorization is from the SESSION only (never a client id → no IDOR): 401 without
// a session, 403 if signed in but not an admin, BEFORE any read/write.
//
// No admin review UI yet — that is a fast-follow (SEC2 / B2.4). An admin triggers
// this route directly (see the report's "how to test").

const bodySchema = z.object({ applicationId: z.string().min(1) })

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isFranchiseEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const limited = rateLimit(req, 'admin_franchise_approve', { limitDefault: 20, windowDefault: 60 })
  if (limited) return limited

  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; email?: string; role?: string; roles?: string[] } | undefined
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  if (!isAdmin) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'applicationId requis' }, { status: 400 })
    }

    const application = await prisma.franchiseApplication.findUnique({
      where: { id: parsed.data.applicationId },
    })
    if (!application) {
      return NextResponse.json({ error: 'Candidature introuvable' }, { status: 404 })
    }

    // (1) Grant the 'franchise' role — VERIFIED. Gate everything on this: a failed
    // grant must NEVER produce an 'approved' status (no phantom approval).
    const bridge = await ensureFranchiseOperator(application.email, application.name, { activate: true })
    if (!bridge.ok) {
      console.error('[POST /api/franchise/approve] role grant failed:', bridge.reason, application.id)
      return NextResponse.json({ error: "L'octroi du rôle franchiseur a échoué" }, { status: 500 })
    }

    // (2) Persist the declared company identity — BEST-EFFORT. Admin approval IS the
    // manual verification → kybStatus='verified'. `siren` is derived from the SIRET
    // (first 9 digits). FranchiseApplication has NO officialName / legalForm column,
    // so officialName is sourced from the admin-reviewed applicant name and legalForm
    // is left null (flagged for Agent 0 — a richer franchise intake / verifyBusiness
    // should populate these later). NON-FATAL + depends on the B1.1 columns (whose db
    // push is pending): wrapped so the approval (role + status) succeeds regardless,
    // and starts persisting identity automatically once B1.1 is migrated.
    try {
      const sirenDigits = (application.siret ?? '').replace(/\D/g, '')
      await setVerifiedCompanyIdentity(bridge.operatorId, {
        siren:         sirenDigits.length >= 9 ? sirenDigits.slice(0, 9) : null,
        officialName:  application.name,
        kybStatus:     'verified',
        kybVerifiedAt: new Date(),
      })
    } catch (e) {
      console.error('[POST /api/franchise/approve] identity persist (non-fatal):', e instanceof Error ? e.message : e)
    }

    // (3) Mark the application approved — idempotent (re-approval is a safe no-op).
    if (application.status !== 'approved') {
      await prisma.franchiseApplication.update({ where: { id: application.id }, data: { status: 'approved' } })
    }

    await recordAdminAudit({
      actorId: user.id ?? '',
      actorEmail: user.email ?? null,
      action: 'franchise.approve',
      targetType: 'franchise',
      targetId: parsed.data.applicationId,
      metadata: {},
      req,
    })

    return NextResponse.json({ ok: true, status: 'approved', bridge })
  } catch (err) {
    console.error('[POST /api/franchise/approve]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
