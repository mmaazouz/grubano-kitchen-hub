// ── Creator identity — shared helper for the CreatorShell top bar (CR0) ──────────
// Mirrors lib/franchise-identity / lib/admin-identity: turns the connected creator
// (Creator row, or the Operator fallback) into the minimal display shape the (client)
// CreatorShell needs. No PII beyond a display name + initials + optional public @slug.

export interface CreatorIdentity {
  /** Display name — the creator/operator name if set, else the email local-part. */
  name: string
  /** 1–2 letter avatar initials. */
  initials: string
  /** Public page slug (referralLinkSlug) → "@slug" chip + « Ma page publique » link, or null. */
  slug: string | null
}

function initialsOf(source: string): string {
  const parts = source.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? (parts[0][0] ?? '') + (parts[1][0] ?? '')
      : (source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'C')
  return letters.toUpperCase()
}

export function buildCreatorIdentity(source: {
  name?: string | null
  email: string
  slug?: string | null
}): CreatorIdentity {
  const raw = (source.name && source.name.trim()) || source.email.split('@')[0] || 'Créateur'
  return { name: raw, initials: initialsOf(raw), slug: source.slug ?? null }
}
