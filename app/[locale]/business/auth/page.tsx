import { redirect } from 'next/navigation'

// ── /business/auth — UNIFIED LOGIN redirect (S2, Agent 14) ────────────────────
// The restaurateur password login no longer exists as a separate page: a single
// passwordless login serves EVERY partner at /auth/magic. This route now REDIRECTS
// there, which keeps every existing /business/auth link working (operator 401
// re-auth, /business/onboarding gate, /business/verified) by funnelling them to the
// unified login. Restaurateur SIGN-UP moved to /business/register. Existing
// restaurateurs sign in via magic-link (role-agnostic authorizeMagicLink), so no
// account is locked out. The CredentialsProvider password mechanism is untouched.
export default function BusinessAuthRedirect({ params: { locale } }: { params: { locale: string } }) {
  redirect(`/${locale}/auth/magic`)
}
