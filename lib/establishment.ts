// Shared (isomorphic) helpers for the operator's "currently-selected
// establishment".
//
// Option B (commit 5A): an operator can own several Restaurant rows. The UI lets
// them pick which establishment drives the dashboard / orders / settings. The
// choice is persisted in a durable, non-HttpOnly preference cookie so server
// components can read it on every request.
//
// This module is intentionally FREE of any server-only import (no next/headers),
// so it is safe to import from BOTH:
//   • server components — which read the cookie via next/headers and pass the
//     value into pickEstablishment(), and
//   • the client switcher — which only needs the cookie name + max-age.
// Keeping next/headers out of here avoids dragging a server-only module into the
// client bundle (which would break the build).

/** Non-HttpOnly preference cookie holding the selected establishment id. */
export const ESTABLISHMENT_COOKIE = 'grubano_estab'

/** One year — this is a durable UI preference, not a security token. */
export const ESTABLISHMENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Pick the active establishment from the operator's list.
 *
 * The caller MUST pass the restaurants ordered by createdAt asc, so index 0 is
 * the historical mono-establishment default (the oldest restaurant). `wantedId`
 * is the cookie value (or null/undefined when absent).
 *
 * Falls back to the oldest when the cookie is missing or points at an id that
 * is not in the list. Because the list is ALWAYS owner-scoped, a stale or
 * foreign id simply doesn't match and we degrade safely to the default — a
 * cookie can never select another operator's establishment. Returns null only
 * when the operator has no establishment at all.
 */
export function pickEstablishment<T extends { id: string }>(
  restaurants: T[],
  wantedId: string | null | undefined,
): T | null {
  if (restaurants.length === 0) return null
  if (wantedId) {
    const match = restaurants.find((r) => r.id === wantedId)
    if (match) return match
  }
  return restaurants[0]
}
