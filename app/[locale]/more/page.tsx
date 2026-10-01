// ── /more — operator RÉGLAGES / PLUS screen. VERBATIM CD v1 (Notion
// 390fd2c9-8146-81d6-9b4e-c344f3f9f4aa — LOT 7, écran 4 : Réglages/Plus). ──────────
//
// The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome,
// « Réglages » active in the rail). This file renders ONLY the screen content.
//
// 🔒 DATA INTEGRITY. This stays a SERVER COMPONENT that reads Prisma directly to load
// the REAL account-level KYB identity (siren / officialName / legalForm / kybStatus /
// kybVerifiedAt / country) for the session operator — OWNER-SCOPED via the session
// email, never a client id. These fields are passed to <MoreClient/> and DISPLAYED
// exactly as stored — NO declaration/verification logic is invented here.
//
// The interactive parts (real signOut auth, the embedded byte-identical VAT + DAC7 POST
// forms, honest « bientôt » rows) live in <MoreClient/>. ⚠️ ZERO money on this screen —
// « Facturation » rows are simple links to the real pages.

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import MoreClient, { type KybIdentity } from './MoreClient'

export const dynamic = 'force-dynamic'

async function getKyb(): Promise<KybIdentity> {
  const empty: KybIdentity = { siren: null, officialName: null, legalForm: null, kybStatus: null, kybVerifiedAt: null, country: null }
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return empty
    const op = await prisma.operator.findUnique({
      where: { email: session.user.email },
      // read ONLY the account-level KYB identity fields we display (no mutation)
      select: { siren: true, officialName: true, legalForm: true, kybStatus: true, kybVerifiedAt: true, country: true },
    })
    if (!op) return empty
    return {
      siren: op.siren ?? null,
      officialName: op.officialName ?? null,
      legalForm: op.legalForm ?? null,
      kybStatus: op.kybStatus ?? null,
      kybVerifiedAt: op.kybVerifiedAt ? op.kybVerifiedAt.toISOString() : null,
      country: op.country ?? null,
    }
  } catch {
    return empty
  }
}

export default async function MorePage() {
  const kyb = await getKyb()
  return <MoreClient kyb={kyb} />
}
