import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPartnerStatusEmail } from '@/lib/transactional-emails'
import { isInfluencerEnabled, listVerificationRequests, decideVerification } from '@/lib/influencer-verification'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/admin/influencer-verifications — ADMIN review console (INF-1, Agent 66) ──────
// GET  → list audience-verification requests (optionally ?status=pending).
// POST → { id, action: 'approve' | 'reject' } — decide ONE request. APPROVE flips the
//        affiliate's audienceVerified=true (snapshot). NO auto-approval: the admin role is
//        verified server-side (mirror of /api/admin/restaurants/[id]/approve). Gated by
//        INFLUENCER_ENABLED (404 OFF). 100% OFF the money path (no commission/payout effect
//        — the verified tier's better commission is the separate INF-3 brick).

function adminFromSession(user: { id?: string; email?: string; role?: string; roles?: string[] } | undefined): { ok: boolean; id: string | null } {
  if (!user) return { ok: false, id: null }
  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  return { ok: isAdmin, id: user.id ?? user.email ?? null }
}

export async function GET(req: Request) {
  if (!isInfluencerEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; email?: string; role?: string; roles?: string[] } | undefined
  const admin = adminFromSession(user)
  if (!user)     return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!admin.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const status = new URL(req.url).searchParams.get('status') ?? undefined
  const requests = await listVerificationRequests(status && ['pending', 'approved', 'rejected'].includes(status) ? status : undefined)
  return NextResponse.json({ ok: true, requests })
}

const decideSchema = z.object({
  id:     z.string().min(1).max(64),
  action: z.enum(['approve', 'reject']),
})

export async function POST(req: Request) {
  const limited = rateLimit(req, 'admin_influencer_verify', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited
  if (!isInfluencerEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; email?: string; role?: string; roles?: string[] } | undefined
  const admin = adminFromSession(user)
  if (!user)     return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!admin.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = decideSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

  const out = await decideVerification(parsed.data.id, parsed.data.action, admin.id ?? 'admin')
  if (out.ok) {
    // Email B4 (Agent 144) — notify the influencer/affiliate of the decision. POST-success,
    // BEST-EFFORT (never blocks the response); idempotent via sendOnce (validated once;
    // rejected re-sendable after a re-application resets the request to pending). No money.
    try {
      const reqRow = await prisma.audienceVerificationRequest.findUnique({
        where:  { id: parsed.data.id },
        select: { operatorId: true },
      })
      if (reqRow?.operatorId) {
        const op = await prisma.operator.findUnique({
          where:  { id: reqRow.operatorId },
          select: { email: true, name: true },
        })
        if (op?.email) {
          await sendPartnerStatusEmail({
            role:        'influencer',
            status:      out.status === 'approved' ? 'validated' : 'rejected',
            to:          op.email,
            partnerName: op.name ?? op.email,
            dedupeScope: `affiliate:${reqRow.operatorId}`,
          })
        }
      }
    } catch (e) {
      console.error('[EMAIL MISS] [admin/influencer-verifications] partner email failed (non-fatal):',
        parsed.data.id, e instanceof Error ? e.message : e)
    }
    await recordAdminAudit({
      actorId:    admin.id ?? 'admin',
      actorEmail: user.email ?? null,
      action:     'influencer.verify',
      targetType: 'affiliate',
      targetId:   parsed.data.id,
      metadata:   { action: parsed.data.action },
      req,
    })
    return NextResponse.json({ ok: true, status: out.status })
  }
  switch (out.reason) {
    case 'not_found':       return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
    case 'already_decided': return NextResponse.json({ error: 'Demande déjà traitée' }, { status: 409 })
    case 'disabled':        return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    default:                return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
