// ── Admin identity — shared helper for the AdminShell top bar (ADM1) ─────────────
// Mirrors lib/supplier-identity: turns the connected admin Operator into the minimal
// display shape the (client) AdminShell needs. No PII beyond a display name + initials.

export interface AdminIdentity {
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
      : (source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'A')
  return letters.toUpperCase()
}

export function buildAdminIdentity(operator: { name?: string | null; email: string }): AdminIdentity {
  const raw = (operator.name && operator.name.trim()) || operator.email.split('@')[0] || 'Admin'
  return { name: raw, initials: initialsOf(raw) }
}
