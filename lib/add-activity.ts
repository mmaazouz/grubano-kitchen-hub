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
 *  (a restaurateur sees exactly these four; see the mission spec). */
export type AddableActivity = 'supplier' | 'creator' | 'logistics' | 'franchise'

export const ADDABLE_ACTIVITIES: readonly AddableActivity[] = ['supplier', 'creator', 'logistics', 'franchise']

/** The verified company identity read from the account anchor (B1.1), used for
 *  prudent PREFILL only. Editable downstream; verification is never skipped. */
export interface AnchorIdentity {
  siren?:        string | null
  officialName?: string | null
}

/** Activities the account can add = the partner activities it does NOT hold yet.
 *  Tolerant of a missing/empty role set (→ all four). */
export function addableActivities(roles: string[] | undefined | null): AddableActivity[] {
  const have = new Set(Array.isArray(roles) ? roles : [])
  return ADDABLE_ACTIVITIES.filter((a) => !have.has(a))
}

/** 'apply' = admin-approved (franchise, a candidature); 'register' = self-serve. */
export function activityMode(activity: AddableActivity): 'register' | 'apply' {
  return activity === 'franchise' ? 'apply' : 'register'
}

const BASE: Record<AddableActivity, string> = {
  supplier:  '/supplier/register',
  creator:   '/creators/apply',
  logistics: '/business/logistics/register',
  franchise: '/franchise/apply',
}

/** Only the company-backed journeys can prefill a verified siren/company name. */
function collectsCompanyIdentity(activity: AddableActivity): boolean {
  return activity === 'supplier' || activity === 'logistics'
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
