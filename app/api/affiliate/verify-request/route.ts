import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import {
  isInfluencerEnabled, getVerificationState, createVerificationRequest, VERIFY_PLATFORMS,
} from '@/lib/influencer-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/affiliate/verify-request — affiliate AUDIENCE-verification (INF-1, Agent 66) ──
// GET  → the SESSION affiliate's verification state (verified flag + current request).
// POST → create / re-apply a verification request (owner-scoped: the operator is the
//        SESSION operator id, never a body value → no IDOR). Idempotent (no 2nd pending).
// Gated by INFLUENCER_ENABLED (404 when OFF → the UI card hides itself, byte-identical).
// 100% OFF the money path — this only writes the audience-verification state machine.

export async function GET() {
  if (!isInfluencerEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const state = await getVerificationState(operatorId)
  return NextResponse.json(state)
}

const bodySchema = z.object({
  platform:          z.enum(VERIFY_PLATFORMS),
  handle:            z.string().trim().min(1).max(120),
  declaredFollowers: z.number().int().min(0).max(1_000_000_000),
  proofUrl:          z.string().trim().max(500).optional(),
})

export async function POST(req: Request) {
  if (!isInfluencerEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

  const out = await createVerificationRequest(operatorId, parsed.data)
  if (out.ok) return NextResponse.json({ ok: true, status: out.status })
  switch (out.reason) {
    case 'not_affiliate':    return NextResponse.json({ error: 'Profil affilié introuvable' }, { status: 404 })
    case 'already_verified': return NextResponse.json({ error: 'Déjà vérifié', reason: out.reason }, { status: 409 })
    case 'already_pending':  return NextResponse.json({ error: 'Demande déjà en attente', reason: out.reason }, { status: 409 })
    case 'disabled':         return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    default:                 return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
