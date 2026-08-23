import { locales } from '@/i18n'

// ── Chrome decision rules (pure, host-independent, testable without React) ───
// Single source of truth consumed by components/AppChrome.tsx. The decision
// depends ONLY on the pathname (locale stripped) — never on the hostname, the
// session or a post-mount effect — so the FIRST render (SSR) and every later
// render agree. Routes that must render WITHOUT the operator dashboard chrome
// (Sidebar + MobileHeader + operator BottomNav):
//
//   /eat/*          → consumer app, has its own BottomNav (app/eat/layout.tsx)
//   /franchise/*    → franchise portal (Agent 4 mounts its own sidebar here)
//   /creators/*     → creator portal  (Agent 4 mounts its own sidebar here)
//   /supplier/*     → B2B supplier space (Slice 0 — its own sober shell)
//   /admin/*        → admin console (ADM1 — its own navy AdminShell, mounted per page,
//                     like /supplier; sheds the mismatched operator sidebar. Screens not
//                     yet wrapped in AdminShell render bare until their ADM lot.)
//   /logistics/*    → courier/logistics space (P1 — its own sober shell, like /supplier)
//   /business/*     → partner space (PartnerShell / PartnerChrome mounted by the pages)
//   /t/*            → public "table bill" QR landing (consumer, sober, no chrome)
//   /legal/*        → public legal pages (mentions légales…) — own sober shell
//   /login          → public auth page (/register nu retiré — B1 : jamais eu de page)
//   /add-activity   → operator "add an activity" — bare, wrapped by PartnerChrome itself
//   /affiliate/*    → affiliate space (own AffiliateShell / marketing chrome)
//   /onboarding     → operator FIRST-establishment wizard (CD LOT 7) — a
//                     FULL-SCREEN assistant by design (« assistant plein écran,
//                     PAS la coquille », founder-approved). It renders its OWN
//                     layout, NOT wrapped by OperatorShell.
//   /auth/magic     → PUBLIC passwordless sign-in (exact path, not /auth/*): an
//                     anonymous visitor must never receive the operator furniture
//                     (founder decision ⑩, smoke staging 2026-08-23). Bare on EVERY
//                     host from the first render — the page mounts its own chrome
//                     (PartnerChrome on the business host, plain light shell elsewhere).
//   /               → redirects to /dashboard, never renders content
//
// Note: the locale prefix is stripped BEFORE matching, so these patterns work
// across /fr/franchise, /en/creators, /es/eat, /ar/auth/magic, etc.
// Note: /deliveries is INTENTIONALLY absent → it renders UNDER the navy OperatorShell
// (founder-approved « aperçu visible sous la coquille » exception for the gated Livraisons
// screen; every other bare route is unchanged).
export const BARE_PREFIXES = [
  '/eat', '/eat-next', '/franchise', '/creators', '/supplier', '/admin', '/logistics',
  '/business', '/t', '/legal', '/login', '/add-activity', '/affiliate', '/onboarding',
  '/auth/magic',
] as const

/** Strip the leading locale segment (e.g. /fr/eat → /eat) so chrome rules stay locale-agnostic. */
export function normalizeChromePathname(raw: string | null | undefined): string {
  const path = raw || '/'
  const segments = path.split('/')
  const stripped = locales.includes(segments[1] as (typeof locales)[number])
    ? '/' + segments.slice(2).join('/')
    : path
  return stripped === '' ? '/' : stripped
}

/** True when the route must render WITHOUT OperatorShell (bare). Pathname only — no host, no session. */
export function isBarePathname(raw: string | null | undefined): boolean {
  const normalized = normalizeChromePathname(raw)
  return normalized === '/' || BARE_PREFIXES.some((p) => normalized === p || normalized.startsWith(`${p}/`))
}
