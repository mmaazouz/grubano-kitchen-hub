import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { z } from 'zod'
import { isClaimsEnabled, contestClaim } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/claims/[id]/contest (P4.5-C2) ───────────────────────────────────────
// The CLIENT who owns a REFUSED claim contests it within CLAIM_CONTEST_HOURS → the
// claim goes to neutral admin arbitration. Gated by CLAIMS_ENABLED. Owner-scoped from
// the session (token.sub) — a claim that is not the caller's is 404 (no IDOR).
const bodySchema = z.object({ reason: z.string().max(1000).optional() })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isClaimsEnabled()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const token = await getToken({ req })
  if (!token?.sub) return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const result = await contestClaim({ claimId: params.id, consumerId: token.sub, reason: parsed.data.reason })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ claim: result.claim })
}
