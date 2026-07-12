// ── Franchise identity — shared helper for the FranchiseShell top bar (FR1) ──────
// Mirrors lib/admin-identity: turns the connected franchisor Operator into the minimal
// display shape the (client) FranchiseShell needs. No PII beyond a display name + initials.

export interface FranchiseIdentity {
  /** Display name — the operator's name if set, else the email local-part. */
  name: string
  /** 1–2 letter avatar initials. */
  initials: string
}

function initialsOf(source: string): string {
  const parts = source.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? (parts[0][0] ?? '') + (parts[1][0] ?? '')
      : (source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'F')
  return letters.toUpperCase()
}

export function buildFranchiseIdentity(operator: { name?: string | null; email: string }): FranchiseIdentity {
  const raw = (operator.name && operator.name.trim()) || operator.email.split('@')[0] || 'Franchise'
  return { name: raw, initials: initialsOf(raw) }
}
