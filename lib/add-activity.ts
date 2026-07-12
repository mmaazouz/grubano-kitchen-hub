// ── "Add an activity" hub logic (B1.3-C, Agent 32) ───────────────────────────
//
// PURE helpers for the unified "add an activity" hub. The hub GRANTS NO ROLE: it
// only ROUTES a connected operator to the EXISTING vetted journeys (supplier /
// creator / logistics registration, franchise application), carrying the SESSION
// email so the new activity attaches to the SAME account (never a 2nd Operator).
//
// No I/O here — the page passes in the already-loaded role SET + account anchor.
// Verification is NOT touched: each journey re-runs its own vetting normally.

/** Partner activities a user can ADD on top of their account. The primary
 *  'restaurant' role has its own dedicated onboarding and is NOT offered here
 *  (a restaurateur sees exactly these four; see the mission spec). 'affiliate'
 *  (Phase 6 Brique A) is offered ONLY behind the AFFILIATE_ENABLED flag — see
 *  `addableActivities(roles, { includeAffiliate })`. */
export type AddableActivity = 'supplier' | 'creator' | 'logistics' | 'franchise' | 'affiliate' | 'prestataire'

// The always-on activities (the four vetted journeys). 'affiliate' is intentionally
// NOT here so the default behaviour is byte-identical when the flag is OFF.
export const ADDABLE_ACTIVITIES: readonly AddableActivity[] = ['supplier', 'creator', 'logistics', 'franchise']

/** The verified company identity read from the account anchor (B1.1), used for
 *  prudent PREFILL only. Editable downstream; verification is never skipped. */
export interface AnchorIdentity {
  siren?:        string | null
  officialName?: string | null
}

/** Activities the account can add = the partner activities it does NOT hold yet.
 *  Tolerant of a missing/empty role set (→ all four). `includeAffiliate` (default
 *  false → byte-identical to before) appends the 'affiliate' activity when the
 *  AFFILIATE_ENABLED flag is ON (resolved by the caller, never read here so this
 *  stays pure). When OFF, the affiliate activity is NEVER offered. */
export function addableActivities(
  roles: string[] | undefined | null,
  opts?: { includeAffiliate?: boolean; includePrestataire?: boolean },
): AddableActivity[] {
  const have = new Set(Array.isArray(roles) ? roles : [])
  let out: AddableActivity[] = ADDABLE_ACTIVITIES.filter((a) => !have.has(a))
  // 'prestataire' (Phase 6 P1) is offered ONLY when PRESTATAIRE_ENABLED is ON (resolved by
  // the caller, never read here so this stays pure). When OFF it is NEVER offered → byte-
  // identical to before this brick.
  if (opts?.includePrestataire && !have.has('prestataire')) out = [...out, 'prestataire']
  if (opts?.includeAffiliate && !have.has('affiliate')) out = [...out, 'affiliate']
  return out
}

/** 'apply' = admin-approved (franchise, a candidature); 'register' = self-serve
 *  (incl. 'affiliate', whose grant is INSTANT — no vetting). */
export function activityMode(activity: AddableActivity): 'register' | 'apply' {
  return activity === 'franchise' ? 'apply' : 'register'
}

const BASE: Record<AddableActivity, string> = {
  supplier:    '/supplier/register',
  creator:     '/creators/apply',
  logistics:   '/business/logistics/register',
  franchise:   '/franchise/apply',
  affiliate:   '/affiliate/join',
  prestataire: '/business/prestataire/register',
}

/** Only the company-backed journeys can prefill a verified siren/company name. */
function collectsCompanyIdentity(activity: AddableActivity): boolean {
  return activity === 'supplier' || activity === 'logistics' || activity === 'prestataire'
}

/**
 * Locale-less href to the EXISTING journey, carrying the SESSION email (the target
 * form prefills + LOCKS it → attaches to the connected account) and, for the
 * company-backed journeys, the verified siren/company as an EDITABLE prefill. The
 * email is ALWAYS the session email passed by the (session-protected) hub — never a
 * free/client value. (`@/navigation` Link adds the locale prefix.)
 */
export function activityHref(
  activity: AddableActivity,
  sessionEmail: string,
  anchor?: AnchorIdentity | null,
): string {
  const params = new URLSearchParams()
  if (sessionEmail) params.set('email', sessionEmail)
  if (collectsCompanyIdentity(activity)) {
    if (anchor?.siren) params.set('siren', anchor.siren)
    // Only the supplier form has a company-name field to prefill.
    if (activity === 'supplier' && anchor?.officialName) params.set('company', anchor.officialName)
  }
  const qs = params.toString()
  return qs ? `${BASE[activity]}?${qs}` : BASE[activity]
}
