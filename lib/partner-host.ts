/**
 * Partner subdomain detection — single source of truth for the host gate.
 *
 * Production host: `business.grubano.com`. In dev / staging / preview, the env
 * variable `PARTNER_REGISTER_ALLOW_HOST` (already consumed by
 * `/api/partners/register` — keep parity with Agent 12) opens up extra hosts:
 *   - a comma-separated list of explicit hostnames, or
 *   - the literal `*` to allow any host (useful for local testing).
 *
 * The helper accepts the raw value of the `Host` / `X-Forwarded-Host` header so
 * it works from both server-component contexts (`next/headers().get('host')`)
 * and middleware / route handlers (`NextRequest.headers.get('host')`).
 */

export const PARTNER_HOST = 'business.grubano.com'

export function isPartnerHostValue(raw: string | null | undefined): boolean {
  if (!raw) return false
  const host = raw.toLowerCase().split(',')[0].split(':')[0].trim()
  if (host === PARTNER_HOST) return true
  const allow = process.env.PARTNER_REGISTER_ALLOW_HOST
  if (!allow) return false
  const list = allow.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.includes('*') || list.includes(host)
}
