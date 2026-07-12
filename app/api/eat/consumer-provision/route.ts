import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureConsumerByEmail } from '@/lib/consumer-signup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/eat/consumer-provision (Agent 138 — passwordless account-AT-payment on the LIVE /eat) ──
//
// Step 1 of the passwordless checkout on the REAL /eat app: ensure a passwordless 'consumer' Operator
// EXISTS (active) for the submitted email, so the UNCHANGED mint (POST /api/auth/magic-link) can then
// send a 6-digit code / link. The client calls THIS, then the existing /api/auth/magic-link.
// This route NEVER mints/sends an email itself, and NEVER touches the money engine.
//
// This is the UN-GATED twin of /api/eat-next/consumer-provision (Agent 132): byte-for-byte the same
// logic MINUS the CONSUMER_REDESIGN_ENABLED gate — the /eat app is live and public, so the route must
// be reachable without the redesign flag. The shared mechanism (lib/consumer-signup.ensureConsumerByEmail,
// role 'consumer' only, safe-on-collision, never elevates) is REUSED unchanged.
//
// ANTI-ENUMERATION: a VALID email always yields a generic { ok:true } (never reveals whether the
//   account existed or its state). Only a MALFORMED email shape → 400 (input validation, no leak).
// RATE-LIMIT: per-IP AND per-email sliding window — provisioning creates an account AND triggers a
//   downstream email, an abuse vector, so both axes are bounded.

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

// Process-local sliding windows (mirror app/api/eat-next/consumer-provision/route.ts).
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
