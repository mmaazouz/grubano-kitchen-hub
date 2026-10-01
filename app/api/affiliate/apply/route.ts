import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import { ensureAffiliateApplicant } from '@/lib/affiliate-signup'
import { resolveClientIp as clientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── POST /api/affiliate/apply — PRE-LOGIN affiliate signup (Agent 118, incr. 1/3) ──
// Self-serve, email-based, PASSWORDLESS — calqued on the supplier/creator register flow.
// A visitor who is NOT logged in submits { name, email, consent } → a passwordless Operator
// is provisioned BY EMAIL + the Affiliate entity/code is created (via the existing idempotent
// ensureAffiliateOperator). The client then triggers the EXISTING POST /api/auth/magic-link so
// the user receives a sign-in link. The session-only POST /api/affiliate/join (instant join for
// already-logged-in users) is UNTOUCHED and keeps working.
//
// GATED by AFFILIATE_ENABLED (OFF → 404, the whole surface invisible — like /affiliate/join).
// Anti-enumeration: ALWAYS a neutral { ok:true } for any accepted submission (honeypot, duplicate,
// fresh) so a bot/duplicate cannot fingerprint its path — the referral code is revealed only AFTER
// sign-in (the dashboard), never to an unauthenticated caller. Anti-bot: honeypot + too-fast +
// per-IP rate-limit. MONEY untouched: earning / payout / ledger / attribution / the 40% tier and
// the (OFF) customer discount are not referenced here.


// Per-IP sliding window (process-local) — mirrors /api/affiliate/join + the partner register limiter.
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

const applySchema = z.object({
  name:          z.string().min(2, 'Nom trop court').max(80),
  email:         z.string().trim().email('Email invalide'),
  consent:       z.boolean().refine((v) => v === true, { message: 'Consentement requis' }),
  // Anti-bot traps (mirror the supplier/partner register flow): a filled honeypot or an
  // impossibly fast submit → silent generic OK (no signal to the bot, no write).
  website:       z.string().optional(),
  formStartedAt: z.number().int().optional(),
})

export async function POST(req: Request) {
  if (!isAffiliateEnabled()) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  }
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json({ error: 'Trop de tentatives. Réessayez plus tard.' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    const parsed = applySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const data = parsed.data

    // Anti-bot: honeypot filled or submitted in < 2 s → neutral OK, never provision, never write.
    if (data.website && data.website.trim() !== '') return NextResponse.json({ ok: true })
    if (typeof data.formStartedAt === 'number' && Date.now() - data.formStartedAt < 2000) {
      return NextResponse.json({ ok: true })
    }

    const email = data.email.trim().toLowerCase()

    // Provision the passwordless Operator BY EMAIL + create the Affiliate (idempotent). Best-effort
    // (logged on failure): the response stays neutral so no enumeration signal leaks. The minted
    // referral code is NOT returned here — the user sees it on the dashboard after signing in.
    await ensureAffiliateApplicant(email, data.name.trim())

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/affiliate/apply]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
