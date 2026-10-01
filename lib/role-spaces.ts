// ── Role → space map (Phase 4 refonte, Agent 14) ──────────────────────────────
//
// A DISPLAY-ONLY source of truth that maps a NextAuth role to the "space" (home)
// it unlocks. The nav (Sidebar / CreatorSidebar / RoleSwitcher) consumes the role
// SET (session.user.roles, posed in Phase 1) to decide which spaces a user can
// see + switch to. This changes NOTHING about access control (middleware is the
// gate) — it only stops showing other roles' entries (the "fuite") and powers the
// multi-role switcher. Extensible: add a row to register a future role's space.

export type RoleSpaceKey = 'consumer' | 'restaurant' | 'creator' | 'franchise' | 'admin' | 'supplier' | 'logistics' | 'affiliate' | 'prestataire'

export interface RoleSpace {
  key:      RoleSpaceKey
  href:     string
  /** i18n key under the `roleSwitcher` namespace. */
  labelKey: string
}

// One canonical space per role. Order = display priority in the switcher.
// `admin` shares /dashboard with `restaurant` (deduped by href below).
const SPACES: { role: string; space: RoleSpace }[] = [
  { role: 'restaurant', space: { key: 'restaurant', href: '/dashboard',          labelKey: 'spaceRestaurant' } },
  { role: 'franchise',  space: { key: 'franchise',  href: '/franchise',          labelKey: 'spaceFranchise' } },
  { role: 'creator',    space: { key: 'creator',    href: '/creators/dashboard', labelKey: 'spaceCreator' } },
  { role: 'supplier',   space: { key: 'supplier',   href: '/supplier/dashboard', labelKey: 'spaceSupplier' } },
  { role: 'logistics',  space: { key: 'logistics',  href: '/logistics/dashboard', labelKey: 'spaceLogistics' } },
  { role: 'prestataire', space: { key: 'prestataire', href: '/prestataire/dashboard', labelKey: 'spacePrestataire' } },
  { role: 'affiliate',  space: { key: 'affiliate',  href: '/affiliate/dashboard', labelKey: 'spaceAffiliate' } },
  { role: 'consumer',   space: { key: 'consumer',   href: '/eat',                labelKey: 'spaceConsumer' } },
  { role: 'admin',      space: { key: 'admin',      href: '/dashboard',          labelKey: 'spaceAdmin' } },
]

/** True when the role SET contains at least one of `allowed`. Tolerant of a
 *  missing/empty set (→ false). The nav's display-time role check. */
export function hasAnyRole(roles: string[] | undefined | null, allowed: string[]): boolean {
  if (!Array.isArray(roles)) return false
  return roles.some((r) => allowed.includes(r))
}

/**
 * The DISTINCT spaces a user can reach, given their role SET. Deduped by href
 * (so [restaurant, admin] yields a single /dashboard space), ordered by the
 * SPACES priority. Never includes a space for a role the user does NOT hold.
 */
export function spacesForRoles(roles: string[] | undefined | null): RoleSpace[] {
  const have = new Set(Array.isArray(roles) ? roles : [])
  const out: RoleSpace[] = []
  const seenHref = new Set<string>()
  for (const { role, space } of SPACES) {
    if (have.has(role) && !seenHref.has(space.href)) {
      out.push(space)
      seenHref.add(space.href)
    }
  }
  return out
}

/**
 * The space whose home matches the current (locale-stripped) pathname, or null.
 * Longest-href-wins so /creators/dashboard beats a hypothetical shorter prefix.
 */
export function currentSpace(pathname: string, spaces: RoleSpace[]): RoleSpace | null {
  let best: RoleSpace | null = null
  for (const s of spaces) {
    if (pathname === s.href || pathname.startsWith(s.href + '/')) {
      if (!best || s.href.length > best.href.length) best = s
    }
  }
  return best
}
