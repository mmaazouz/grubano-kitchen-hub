// ── Logistics identity — shared helper for the LogisticsShell top bar (LO0) ──────
// Calque of lib/affiliate-identity: turns the connected courier (LogisticsProfile 1:1
// Operator, keyed by the SHARED EMAIL) into the minimal display shape the (client)
// LogisticsShell needs. No PII beyond a display name + initials. The name is the REAL
// courier name (contactName / officialName / operator name) — never a hardcoded
// "Karim Diallo". DISTINCT from the affiliate identity — the courier is keyed by email.

export interface LogisticsIdentity {
  /** Display name — the courier's contact/official name, else the operator name or email local-part. */
  name: string
  /** 1–2 letter avatar initials. */
  initials: string
}

function initialsOf(source: string): string {
  const parts = source.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? (parts[0][0] ?? '') + (parts[1][0] ?? '')
      : (source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || 'L')
  return letters.toUpperCase()
}

export function buildLogisticsIdentity(source: {
  name?: string | null
  email: string
}): LogisticsIdentity {
  const raw = (source.name && source.name.trim()) || source.email.split('@')[0] || 'Livreur'
  return { name: raw, initials: initialsOf(raw) }
}
