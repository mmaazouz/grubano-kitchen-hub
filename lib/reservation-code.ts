// ── Reservation short-code utility (Agent 13 — brique A) ─────────────────────
//
// Derive a short, READABLE, DETERMINISTIC code from a reservation id (cuid).
// Same id → same code, always. The code is the "session anchor" Mohammed sees
// on the operator side AND the guest sees on /t and /eat/account — it's the
// thing they verbally cross-check ("you're #A3F2, right?").
//
// Algorithm:
//   1. djb2-style 32-bit hash over the FULL id (good distribution for cuids,
//      no dependency, deterministic, fast).
//   2. Encode into Crockford base32 (alphabet = 0-9 + uppercase letters minus
//      I/L/O/U, which are visually ambiguous with 1/1/0/V). 4 characters →
//      ~1M combinations, plenty for the population of CONCURRENT sessions a
//      restaurant has at any given moment (the codes only need to be
//      distinguishable WITHIN the current shift).
//   3. Prefix with '#'.
//
// Walk-in: `null` / empty input → empty string. The caller renders a sober
// "Walk-in" label via i18n instead of a code (see helpers below).
//
// Zero dependencies, pure functions — safe to import from server AND client.

/** Crockford base32 alphabet — drops I, L, O, U on purpose. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** djb2 hash, 32-bit unsigned. Stable across runtimes (no Math.random, no
 *  string coercion subtleties). The result feeds the base32 encoder. */
function djb2(input: string): number {
  let h = 5381 >>> 0
  for (let i = 0; i < input.length; i++) {
    // (h * 33) ^ c — kept in unsigned 32-bit via `>>> 0`.
    h = (((h << 5) + h) ^ input.charCodeAt(i)) >>> 0
  }
  return h >>> 0
}

/** Encode the 32-bit hash as a 4-char Crockford base32 string. */
function encode4(hash: number): string {
  let v = hash >>> 0
  let out = ''
  for (let i = 0; i < 4; i++) {
    const idx = v & 0x1f
    out = ALPHABET[idx] + out
    v = v >>> 5
  }
  return out
}

/**
 * Reservation short code (4 chars, Crockford base32, prefixed `#`).
 * Returns `''` when the id is null/empty/whitespace.
 *
 *   reservationCode('clx9zk3qa00012b3c4d5e6f7g')  // → '#A3F2'
 *   reservationCode(null)                          // → ''
 */
export function reservationCode(id: string | null | undefined): string {
  if (!id) return ''
  const trimmed = id.trim()
  if (!trimmed) return ''
  return '#' + encode4(djb2(trimmed))
}

/**
 * Convenience for UI: returns `{ kind: 'code', value }` for a real
 * reservation, or `{ kind: 'walkin' }` for a null/walk-in. Lets the caller
 * branch on `kind` to render either the code badge or a sober "Walk-in"
 * i18n label.
 */
export function reservationLabel(
  id: string | null | undefined,
): { kind: 'code'; value: string } | { kind: 'walkin' } {
  const code = reservationCode(id)
  return code ? { kind: 'code', value: code } : { kind: 'walkin' }
}
