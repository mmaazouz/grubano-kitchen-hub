import { redirect } from 'next/navigation'

/**
 * Thin bridge: the public link printed on the creator dashboard is
 * grubano.com/ref/{slug} (no /api). The next-intl middleware excludes /api
 * from its matcher, but rewrites bare /ref to /{locale}/ref. This page catches
 * that locale-prefixed request and forwards to the real capture handler at
 * /api/ref/{slug}, which sets the attribution cookie and redirects to /eat.
 *
 * Why a server-side redirect (308) and not a client one: the handler must
 * set an HttpOnly cookie, which is only possible in the server response chain.
 * `next/navigation`'s `redirect()` throws a `NEXT_REDIRECT` error that the
 * framework converts into a 307/308 response, preserving the cookie flow.
 *
 * Optional ?to= forwarding: the public creator page sends visitors through
 * /ref/{code}?to=/{locale}/eat/r/{restaurantId} so the cookie is dropped AND
 * the funnel lands on the adopting restaurant. The API handler whitelists
 * the value — we just pass it through.
 *
 * Brick 5A — no DB write happens here; this file only rewrites the URL.
 */
export default function RefBridge({
  params,
  searchParams,
}: {
  params: { code: string; locale: string }
  searchParams?: { to?: string | string[] }
}) {
  const safe = encodeURIComponent(params.code || '')
  const rawTo = Array.isArray(searchParams?.to) ? searchParams?.to[0] : searchParams?.to
  const qs = rawTo ? `?to=${encodeURIComponent(rawTo)}` : ''
  redirect(`/api/ref/${safe}${qs}`)
}
