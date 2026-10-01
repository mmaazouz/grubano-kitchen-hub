// ── P4.4-A — per-country VAT resolver (Agent 54) ─────────────────────────────────
//
// Replaces the former hardcoded mono-country rate (lib/invoice VAT_RATE = 0.20) with a
// resolver whose DEFAULT reproduces the existing France behaviour EXACTLY (FR → 0.20).
// The per-country capability is ADDITIVE + INERT: only France is active today (every
// establishment resolves to FR), so every existing amount is byte-identical.
//
// ⚠️ SCOPE: this rate applies ONLY to Grubano's COMMISSION SERVICE on the invoice — the
// already-levied commission (TTC) is split into HT + TVA for accounting/display. It NEVER
// changes the money charged to a customer or the application_fee taken at the source.
//
// ⚠️ The non-FR rates below are plausible standard rates but MUST BE VALIDATED BY THE
// ACCOUNTANT before any non-FR establishment is activated. None is active in this brick.

export const DEFAULT_VAT_COUNTRY = 'FR'

/** Standard VAT rate on B2B services, per ISO-3166 alpha-2 country code.
 *  FR is authoritative (0.20 — the legacy rate, byte-identical). All others are
 *  À VALIDER COMPTABLE and inactive (no establishment resolves to them yet). */
const VAT_RATES: Record<string, number> = {
  FR: 0.20, // authoritative — the former hardcoded rate
  // ── à valider comptable — INACTIFS (aucun établissement non-FR activé) ──
  BE: 0.21,
  DE: 0.19,
  ES: 0.21,
  IT: 0.22,
  LU: 0.17,
  NL: 0.21,
  PT: 0.23,
}

/**
 * Resolve the VAT rate (a fraction, e.g. 0.20 = 20%) for a country code. null/undefined/
 * empty or an UNKNOWN country falls back to the France default (documented) — so an
 * un-set country can never blow up an invoice and stays byte-identical to today.
 */
export function resolveVatRate(country?: string | null): number {
  const code = (country ?? DEFAULT_VAT_COUNTRY).trim().toUpperCase()
  return VAT_RATES[code] ?? VAT_RATES[DEFAULT_VAT_COUNTRY]
}
