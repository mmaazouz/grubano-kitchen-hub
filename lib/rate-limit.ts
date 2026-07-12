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

/** Best-effort client IP — the first hop of x-forwarded-for, else x-real-ip. */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim() || 'unknown'
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
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

    const upper     = routeKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    const limit     = intEnv(`RATE_LIMIT_${upper}_MAX`, opts?.limitDefault ?? 60)
    const windowSec = intEnv(`RATE_LIMIT_${upper}_WINDOW_SEC`, opts?.windowDefault ?? 60)
    const windowMs  = windowSec * 1000
    const now       = Date.now()
    const key       = `${routeKey}:${clientIp(req)}${opts?.extraKey ? ':' + opts.extraKey : ''}`

    const recent = (WINDOWS.get(key) ?? []).filter((t) => now - t < windowMs)

    if (recent.length >= limit) {
      WINDOWS.set(key, recent) // keep the pruned window
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000))
      return NextResponse.json(
        { error: 'Trop de requêtes, réessayez plus tard.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
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
  } catch {
    return null // FAIL-OPEN — never block a request because of a limiter fault.
  }
}

/** Test-only: reset the in-memory windows between cases. */
export function __resetRateLimit(): void {
  WINDOWS.clear()
}
