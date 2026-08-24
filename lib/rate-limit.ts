import { NextResponse } from 'next/server'

// ── WP-SEC-03 — in-memory sliding-window rate limiter ─────────────────────────
// A dependency-free, per-process, per-(route+IP) sliding-window limiter for the
// always-on public write / PII endpoints (guest checkout, ticket pay, public
// reservation, loyalty wallet lookup). Design (pre-validated):
//   • GATED by RATE_LIMIT_ENABLED (default OFF). When OFF → rateLimit() returns
//     null immediately, so every wired route is BYTE-IDENTICAL to today.
//   • Limits are env-tunable and GENEROUS (a real single user never hits them).
//   • On exceed → HTTP 429 + Retry-After (seconds).
//   • FAIL-OPEN: any internal error (or a limiter bug) → null (allow). A rate
//     limiter must NEVER block a payment because of its own fault.
// LIMITATION (documented): the window is PER PROCESS (in-memory Map). With N
// server processes the effective limit is ~N× the configured value; it throttles
// abuse (card-testing / hold-spam / enumeration bursts) without external infra.
// For a hard global limit, a shared store (Redis) would be needed — out of scope.

const WINDOWS = new Map<string, number[]>() // key → ascending request timestamps (ms)

/** Kill-switch — default OFF. Only the exact string 'true' enables it. */
export function isRateLimitEnabled(): boolean {
  return process.env.RATE_LIMIT_ENABLED === 'true'
}

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

/** Last hop of an x-forwarded-for chain, or '' when absent/empty.
 *  ⚠️ The FIRST hop is CLIENT-FORGEABLE when the front proxy APPENDS to the
 *  incoming header (the common Apache/LiteSpeed behaviour): an attacker sending
 *  its own X-Forwarded-For would mint a fresh bucket on every request and walk
 *  around any IP-keyed limit. The LAST element is the address added by the
 *  trusted proxy sitting in front of the app in BOTH topologies (append and
 *  overwrite), so it is the only spoof-resistant choice available without
 *  proxy-configuration knowledge (the exact o2switch chain is not documented
 *  in-repo). */
function lastHopIp(raw: string | null | undefined): string {
  if (!raw) return ''
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/** Best-effort client IP — the LAST hop of x-forwarded-for, else x-real-ip.
 *  No usable header at all → the shared 'unknown' bucket (collective throttle
 *  rather than no throttle). */
function clientIp(req: Request): string {
  return (
    lastHopIp(req.headers.get('x-forwarded-for')) ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

/**
 * Core sliding-window check for one (routeKey, ip[, extraKey]) bucket.
 * Returns the Retry-After in SECONDS when the bucket is over its limit, else
 * records the hit and returns null. Assumes the flag check + try/catch are done
 * by the caller. Synchronous on purpose: the read-modify-write on WINDOWS has no
 * await point, so concurrent requests inside one process are serialised by the
 * event loop and the limit cannot be raced past.
 */
function consume(
  ip: string,
  routeKey: string,
  opts?: { extraKey?: string; limitDefault?: number; windowDefault?: number },
): number | null {
  const upper     = routeKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const limit     = intEnv(`RATE_LIMIT_${upper}_MAX`, opts?.limitDefault ?? 60)
  const windowSec = intEnv(`RATE_LIMIT_${upper}_WINDOW_SEC`, opts?.windowDefault ?? 60)
  const windowMs  = windowSec * 1000
  const now       = Date.now()
  const key       = `${routeKey}:${ip}${opts?.extraKey ? ':' + opts.extraKey : ''}`

  const recent = (WINDOWS.get(key) ?? []).filter((t) => now - t < windowMs)

  if (recent.length >= limit) {
    WINDOWS.set(key, recent) // keep the pruned window
    return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000))
  }

  recent.push(now)
  WINDOWS.set(key, recent)

  // Opportunistic GC so the Map cannot grow unbounded under abuse.
  if (WINDOWS.size > 5000) {
    WINDOWS.forEach((v, k) => {
      if (v.length === 0 || v.every((t) => now - t >= windowMs)) WINDOWS.delete(k)
    })
  }
  return null
}

/**
 * Returns a 429 NextResponse when the caller has exceeded `limit` requests in the
 * sliding `windowSec`, else null (allowed). NO-OP (null) when RATE_LIMIT_ENABLED is
 * OFF. Fail-open on any error. `routeKey` names the bucket; `extraKey` sub-keys it
 * (e.g. the looked-up email). Per-route limits come from
 * RATE_LIMIT_<ROUTEKEY>_MAX / RATE_LIMIT_<ROUTEKEY>_WINDOW_SEC, else the defaults.
 */
export function rateLimit(
  req: Request,
  routeKey: string,
  opts?: { extraKey?: string; limitDefault?: number; windowDefault?: number },
): NextResponse | null {
  try {
    if (!isRateLimitEnabled()) return null

    const retryAfter = consume(clientIp(req), routeKey, opts)
    if (retryAfter === null) return null

    return NextResponse.json(
      { error: 'Trop de requêtes, réessayez plus tard.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  } catch {
    return null // FAIL-OPEN — never block a request because of a limiter fault.
  }
}

/**
 * P0 auth wiring — throttle check for call-sites that do NOT hold a fetch
 * Request, e.g. NextAuth's `authorize(credentials, req)` where `req.headers` is
 * a PLAIN lower-cased record (RequestInternal), not a Headers instance.
 * Same bucket store, same env-tunable policy, same trust rule (last-hop XFF).
 * Returns true when the caller is over the limit. FAIL-OPEN: false when the
 * flag is OFF or on any internal fault — a limiter bug must never lock sign-in.
 */
export function rateLimitExceeded(
  headers: Record<string, unknown> | undefined,
  routeKey: string,
  opts?: { extraKey?: string; limitDefault?: number; windowDefault?: number },
): boolean {
  try {
    if (!isRateLimitEnabled()) return false

    const get = (name: string): string | null => {
      const v = headers?.[name]
      if (typeof v === 'string') return v
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
      return null
    }
    const ip = lastHopIp(get('x-forwarded-for')) || get('x-real-ip')?.trim() || 'unknown'
    return consume(ip, routeKey, opts) !== null
  } catch {
    return false // FAIL-OPEN — same contract as rateLimit().
  }
}

/** Test-only: reset the in-memory windows between cases. */
export function __resetRateLimit(): void {
  WINDOWS.clear()
}
