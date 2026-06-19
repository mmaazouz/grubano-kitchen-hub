import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAffiliateEnabled, ensureAffiliateOperator, getAffiliateByOperator } from '@/lib/affiliate-account'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── /api/affiliate/join — instant self-serve affiliate onboarding (Brique A, Agent 58) ──
// POST: the SESSION user becomes an affiliate INSTANTLY (role 'affiliate' + an Affiliate
//   entity + a freshly-minted referral code) — NO upfront verification (doctrine).
// GET : whether the affiliate rail is enabled + the caller's affiliate identity (or null).
//
// GATED by AFFILIATE_ENABLED (OFF → 404, the whole surface is invisible). OWNER-SCOPED:
// the operator is the SESSION user (session.user.id — never a client value → no IDOR).
// IDEMPOTENT (a re-join returns the same entity/code). Light per-IP rate-limit on POST
// (the grant is session-gated, so abuse is already bounded; this caps link-minting
// bursts). NO money here — the grant only enables sharing a link; the credit = Brique B.

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

// Per-IP sliding window (process-local) — mirrors the partner-register limiter.
const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_MAX = 10
const ipHits = new Map<string, number[]>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  if (ipHits.size > 2000) {
    ipHits.forEach((v, k) => {
      const fresh = v.filter((t) => now - t < RATE_WINDOW_MS)
      if (fresh.length === 0) ipHits.delete(k)
      else ipHits.set(k, fresh)
    })
  }
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_MAX) { ipHits.set(ip, hits); return true }
  hits.push(now)
  ipHits.set(ip, hits)
  return false
}

function sessionOperatorId(session: unknown): string | null {
  const u = (session as { user?: { id?: string } } | null)?.user
  return u?.id ?? null
}

export async function GET() {
  if (!isAffiliateEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const operatorId = sessionOperatorId(await getServerSession(authOptions))
  if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const affiliate = await getAffiliateByOperator(operatorId)
  return NextResponse.json({ enabled: true, affiliate })
}

export async function POST(req: Request) {
  if (!isAffiliateEnabled()) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: 'Trop de tentatives. Réessayez plus tard.' }, { status: 429 })
  }

  const operatorId = sessionOperatorId(await getServerSession(authOptions))
  if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const res = await ensureAffiliateOperator(operatorId)
  if (!res.ok) {
    if (res.reason === 'disabled')           return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    if (res.reason === 'operator_not_found') return NextResponse.json({ error: 'Compte introuvable' }, { status: 401 })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }

  return NextResponse.json(
    {
      ok: true,
      created: res.created,
      affiliate: { referralCode: res.affiliate.referralCode, referralLinkSlug: res.affiliate.referralLinkSlug },
    },
    { status: res.created ? 201 : 200 },
  )
}
