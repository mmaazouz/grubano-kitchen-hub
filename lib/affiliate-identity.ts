// ── Affiliate identity — shared helper for the AffiliateShell top bar (AF0) ──────
// Calque of lib/creator-identity / lib/franchise-identity: turns the connected
// affiliate (Affiliate row 1:1 Operator + the Operator name) into the minimal display
// shape the (client) AffiliateShell needs. No PII beyond a display name + initials +
// optional public @slug (referralLinkSlug). DISTINCT from the creator identity — the
// affiliate is keyed by operatorId, never by email.

export interface AffiliateIdentity {
  /** Display name — the operator name if set, else the email local-part. */
  name: string
  /** 1–2 letter avatar initials. */
  initials: string
  /** Referral slug (referralLinkSlug) → "@slug" chip in the profile menu, or null. */
  slug: string | null
}

function initialsOf(source: string): string {
  const parts = source.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? (parts[0][0] ?? '') + (parts[1][0] ?? '')
      : (source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'A')
  return letters.toUpperCase()
}

export function buildAffiliateIdentity(source: {
  name?: string | null
  email: string
  slug?: string | null
}): AffiliateIdentity {
  const raw = (source.name && source.name.trim()) || source.email.split('@')[0] || 'Affilié'
  return { name: raw, initials: initialsOf(raw), slug: source.slug ?? null }
}
