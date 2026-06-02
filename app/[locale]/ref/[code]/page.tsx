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
 * Brick 5A — no DB write happens here; this file only rewrites the URL.
 */
export default function RefBridge({ params }: { params: { code: string; locale: string } }) {
  // Pass the raw code through untouched — the API handler normalises casing.
  const safe = encodeURIComponent(params.code || '')
  redirect(`/api/ref/${safe}`)
}
