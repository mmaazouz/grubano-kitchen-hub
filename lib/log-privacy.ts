// ── Log privacy helpers — Lot 7 closed beta (legal + privacy) ─────────────────
//
// Server logs (Passenger stderr/stdout on o2switch) are an unbounded retention
// surface: an email logged in clear is PII kept outside every RGPD retention
// rail. Every console.* that used to log a clear email now goes through
// maskEmail() — the behaviour of the calling code is UNCHANGED, only the text
// logged differs.

/**
 * Mask an email for logs: keep the first 2 characters of the local part + the
 * full domain — 'ab***@site.fr'. Tolerant to non-email input (no '@', empty,
 * or non-string): masks what it can and never throws.
 */
export function maskEmail(email: string): string {
  if (typeof email !== 'string' || email.trim() === '') return '***'
  const at = email.indexOf('@')
  if (at <= 0) return `${email.slice(0, 2)}***` // no '@' (or it leads) — keep 2 chars max
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  return `${local.slice(0, 2)}***@${domain}`
}
