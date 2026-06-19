// ── Post-login landing per role (P1, Agent 17) ────────────────────────────────
//
// SINGLE SOURCE OF TRUTH for where /auth/magic sends a user after a successful
// passwordless sign-in. Each partner role lands on its OWN space (its private
// dashboard), never a public marketing/discovery landing:
//   restaurant/admin → /dashboard            franchise → /franchise/dashboard
//   creator          → /creators/dashboard   supplier  → /supplier/dashboard
//   logistics        → /logistics/dashboard  consumer  → /eat
//
// Extracted from the magic-link page (a client component) so it is PURE + unit-
// testable. The sign-in MECHANISM (token consume, signIn) is unchanged — only the
// destination string is sourced here. Unknown / missing role → /eat (the public
// consumer app, which always renders) — the same safe fallback as before.

export const POST_LOGIN_REDIRECTS: Record<string, string> = {
  restaurant: '/dashboard',
  admin:      '/dashboard',
  franchise:  '/franchise/dashboard',
  creator:    '/creators/dashboard',
  supplier:   '/supplier/dashboard',
  logistics:  '/logistics/dashboard',
  affiliate:  '/affiliate/dashboard',
  consumer:   '/eat',
}

/** The locale-less landing path for a role after sign-in (fallback: /eat). */
export function postLoginPath(role: string | undefined | null): string {
  return POST_LOGIN_REDIRECTS[role ?? ''] ?? '/eat'
}
