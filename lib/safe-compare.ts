import { timingSafeEqual } from 'crypto'

// ── Constant-time secret comparison (ADM7 admin-hardening) ───────────────────────
// Replaces plain `===`/`!==` on auth tokens (INTERNAL_CRON_TOKEN, CRON_SECRET) to
// remove the byte-by-byte timing side-channel a string `===` leaks. UTF-8 bytes so it
// works for ANY token shape (hex, base64url, or a whole "Bearer <secret>" string).
//
// timingSafeEqual THROWS a RangeError on a length mismatch, so we length-check first
// (a length pre-check is itself a tiny, unavoidable, and industry-standard oracle) and
// wrap the compare in try/catch — this helper NEVER throws and returns false on any
// fault. Non-string / empty inputs return false (fail-closed): an empty expected secret
// must never authorise a request.

export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  try {
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

// Shared guard for the internal cron / probe routes: validates the `x-internal-token`
// header against INTERNAL_CRON_TOKEN in CONSTANT time. Mirrors the exact inline guard the
// routes carried (expected non-empty AND token is a string AND equal) — only the compare
// is now constant-time. Fail-closed when the env secret is unset/empty (never opens the
// route). Note: routes may keep their OWN inline block and just swap `===` → safeEqual();
// this helper is offered for the ones that want to DRY the whole dual-gate.
export function isInternalCronRequest(req: Request): boolean {
  const expected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
  if (expected.length === 0) return false
  const token = req.headers.get('x-internal-token')
  if (typeof token !== 'string') return false
  return safeEqual(token, expected)
}
