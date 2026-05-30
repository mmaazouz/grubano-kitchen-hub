/**
 * Geocoding helper backed by the French Base Adresse Nationale (BAN).
 *
 *   https://api-adresse.data.gouv.fr/search/?q=...
 *
 * BAN is free, has no auth, and is rate-limited around 50 req/s. We add a
 * tiny `wait()` helper so batch scripts (e.g. scripts/geocode-restaurants.js)
 * can stay politely under that ceiling.
 *
 * Returns { latitude, longitude } on a hit, or `null` when:
 *   - the address can't be resolved
 *   - the API is unreachable
 *   - the response is malformed
 *
 * Callers must treat `null` as a soft failure: save the entity anyway with
 * null coords, then re-geocode later via the backfill script.
 */

const BAN_BASE = 'https://api-adresse.data.gouv.fr/search/'

export interface GeoCoords {
  latitude:  number
  longitude: number
}

/** Polite delay between batch geocode calls. */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Geocode a French address. Returns coords or null on miss/failure.
 *
 * @param address    Street line ("12 rue de la Paix")
 * @param city       Commune ("Paris")
 * @param postalCode Optional, sharpens BAN matching when supplied
 */
export async function geocodeAddress(
  address: string,
  city: string,
  postalCode?: string,
): Promise<GeoCoords | null> {
  const cleanedAddress = (address ?? '').trim()
  const cleanedCity    = (city ?? '').trim()
  if (!cleanedAddress && !cleanedCity) return null

  const parts = [cleanedAddress, postalCode?.trim(), cleanedCity].filter(Boolean)
  const query = parts.join(' ')
  if (!query) return null

  const url = `${BAN_BASE}?q=${encodeURIComponent(query)}&limit=1`

  try {
    // BAN sometimes hangs — guard with an AbortController timeout.
    const ctrl    = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 6_000)

    const res = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'grubano-geocoder/1.0' },
    }).finally(() => clearTimeout(timeout))

    if (!res.ok) return null

    const json = await res.json().catch(() => null) as
      | { features?: Array<{ geometry?: { coordinates?: [number, number] } }> }
      | null
    if (!json) return null

    const coords = json.features?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length !== 2) return null

    // BAN returns [longitude, latitude] (GeoJSON convention).
    const [lng, lat] = coords
    if (typeof lat !== 'number' || typeof lng !== 'number') return null
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

    return { latitude: lat, longitude: lng }
  } catch {
    return null
  }
}

/**
 * Haversine distance between two coordinates, in kilometres.
 * Re-exported here so callers don't need to pull in extra dependencies.
 */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371 // Earth radius (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude  - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}
