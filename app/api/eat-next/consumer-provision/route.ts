import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isConsumerRedesignEnabled } from '@/lib/consumer-redesign'
import { ensureConsumerByEmail } from '@/lib/consumer-signup'
import { resolveClientIp as clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/eat-next/consumer-provision (Agent 132, brick 2c — account-AT-payment) ──────
//
// AUTH-ONLY step 1 of the /eat-next checkout: ensure a passwordless 'consumer' Operator EXISTS
// (active) for the submitted email, so the UNCHANGED mint (POST /api/auth/magic-link) can then
// send a 6-digit code / link. The client calls THIS, then the existing /api/auth/magic-link.
// This route NEVER mints/sends an email itself, and NEVER touches the money engine.
//
// GATED by CONSUMER_REDESIGN_ENABLED (OFF → 404 — the whole /eat-next surface is invisible).
// ANTI-ENUMERATION: a VALID email always yields a generic { ok:true } (never reveals whether the
//   account existed or its state). Only a MALFORMED email shape → 400 (input validation, no leak).
// RATE-LIMIT: per-IP AND per-email sliding window — provisioning creates an account AND triggers a
//   downstream email, an abuse vector, so both axes are bounded.


// Process-local sliding windows (mirror app/api/affiliate/apply/route.ts).
const WINDOW_MS = 60 * 60 * 1000
const IP_MAX = 30 // generous per-IP (shared NAT / households)
const EMAIL_MAX = 5 // tight per-email (one buyer should not need many codes/hour)
const ipHits = new Map<string, number[]>()
const emailHits = new Map<string, number[]>()

function limited(map: Map<string, number[]>, key: string, max: number): boolean {
  const now = Date.now()
  if (map.size > 5000) {
    map.forEach((v, k) => {
      const fresh = v.filter((t) => now - t < WINDOW_MS)
      if (fresh.length === 0) map.delete(k)
      else map.set(k, fresh)
    })
  }
  const hits = (map.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= max) { map.set(key, hits); return true }
  hits.push(now)
  map.set(key, hits)
  return false
}

const schema = z.object({ email: z.string().trim().email() })

export async function POST(req: Request) {
  // Gate: the whole /eat-next redesign surface is invisible when the flag is OFF.
  if (!isConsumerRedesignEnabled()) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  }
  const GENERIC = { ok: true }
  try {
    if (limited(ipHits, clientIp(req), IP_MAX)) {
      return NextResponse.json({ error: 'Trop de tentatives. Réessayez plus tard.' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      // Malformed email shape — input validation, reveals nothing about accounts.
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()

    if (limited(emailHits, email, EMAIL_MAX)) {
      return NextResponse.json({ error: 'Trop de tentatives. Réessayez plus tard.' }, { status: 429 })
    }

    // Best-effort: the result is intentionally IGNORED so the response is identical whether the
    // email already existed, was freshly created, or provisioning failed (anti-enumeration).
    await ensureConsumerByEmail(email)

    return NextResponse.json(GENERIC)
  } catch {
    return NextResponse.json(GENERIC)
  }
}
