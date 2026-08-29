/**
 * Geocoding helper backed by the French Base Adresse Nationale (BAN).
 *
 * WAVE 2 (2026-08-29) — MIGRATION Géoplateforme IGN : l'API historique
 * api-adresse.data.gouv.fr est officiellement décommissionnée depuis fin
 * janvier 2026 (transfert à l'IGN) ; elle répond encore via un proxy, mais
 * sans engagement. Endpoints courants (vérifiés en live, réponses identiques) :
 *
 *   forward : https://data.geopf.fr/geocodage/search/?q=...
 *   reverse : https://data.geopf.fr/geocodage/reverse/?lat=..&lon=..   (⚠ `lon`)
 *
 * Gratuit, sans clé, licence etalab-2.0, rate-limit officiel 50 req/s/IP
 * (dépassement → 429 + blocage 5 s). Le `wait()` ci-dessous garde les scripts
 * batch poliment sous ce plafond.
 *
 * DONNÉES ENVOYÉES au service (IGN / Géoplateforme) : forward = l'adresse
 * texte à résoudre ; reverse = un couple lat/lng (position utilisateur au
 * moment où il ACTIVE la géoloc — finalité : afficher une localisation lisible
 * et trier par proximité). À tracer dans le runbook privacy.
 *
 * Callers must treat misses as soft failures: save the entity anyway with
 * null coords, then re-geocode later via the backfill script.
 */

const GEOCODE_BASE = 'https://data.geopf.fr/geocodage'
const BAN_BASE = `${GEOCODE_BASE}/search/`

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
  // Thin wrapper over the detailed geocoder — preserves the original contract
  // (coords on a hit, null on any miss) for existing callers / backfill scripts.
  const result = await geocodeAddressDetailed(address, city, postalCode)
  return result.status === 'ok' ? result.coords : null
}

/**
 * Detailed geocode — same lookup as geocodeAddress, but it DISTINGUISHES the two
 * kinds of miss so callers can react differently:
 *
 *   'ok'          → a match (coords attached)
 *   'not_found'   → BAN answered but has no result for this query (likely a typo
 *                   / non-existent address) → callers should WARN the user.
 *   'unavailable' → BAN is unreachable, timed out, errored, or returned garbage
 *                   → a third-party outage, NOT the user's fault → callers should
 *                   degrade gracefully (save anyway, do NOT warn / block).
 */
export type GeocodeStatus = 'ok' | 'not_found' | 'unavailable'
export type GeocodeResult =
  | { status: 'ok'; coords: GeoCoords }
  | { status: 'not_found' }
  | { status: 'unavailable' }

export async function geocodeAddressDetailed(
  address: string,
  city: string,
  postalCode?: string,
): Promise<GeocodeResult> {
  const cleanedAddress = (address ?? '').trim()
  const cleanedCity    = (city ?? '').trim()
  const parts = [cleanedAddress, postalCode?.trim(), cleanedCity].filter(Boolean)
  const query = parts.join(' ')
  // Nothing to look up — treat as "not found" (the field validation upstream
  // already rejects empty/implausible input before we get here).
  if (!query) return { status: 'not_found' }

  const url = `${BAN_BASE}?q=${encodeURIComponent(query)}&limit=1`

  try {
    const ctrl    = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 6_000)

    const res = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'grubano-geocoder/1.0' },
    }).finally(() => clearTimeout(timeout))

    // Non-2xx (incl. 429 rate-limit / 5xx) → the SERVICE is the problem.
    if (!res.ok) return { status: 'unavailable' }

    const json = await res.json().catch(() => null) as
      | { features?: Array<{ geometry?: { coordinates?: [number, number] } }> }
      | null
    // Malformed body → can't trust the service → treat as unavailable.
    if (!json || !Array.isArray(json.features)) return { status: 'unavailable' }

    const coords = json.features[0]?.geometry?.coordinates
    // BAN answered cleanly but had no hit → genuine "not found".
    if (json.features.length === 0 || !Array.isArray(coords) || coords.length !== 2) {
      return { status: 'not_found' }
    }

    // BAN returns [longitude, latitude] (GeoJSON convention).
    const [lng, lat] = coords
    if (typeof lat !== 'number' || typeof lng !== 'number') return { status: 'not_found' }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'not_found' }

    return { status: 'ok', coords: { latitude: lat, longitude: lng } }
  } catch {
    // Abort / network error → service unreachable, not the user's fault.
    return { status: 'unavailable' }
  }
}

/**
 * Reverse geocoding — coords → localisation LISIBLE (WAVE 2).
 *
 * Utilisé pour afficher au consommateur où sa position a été comprise
 * (« 8 Place de l'Hôtel de Ville 75004 Paris » / « Paris 4e »). Mêmes
 * conventions d'échec que le forward : 'not_found' = réponse propre sans
 * résultat ; 'unavailable' = panne/timeout/réponse malformée (ne jamais
 * bloquer l'UX là-dessus — la position reste utilisable pour le tri).
 */
export type ReverseGeocodeResult =
  | { status: 'ok'; label: string; city: string | null; postcode: string | null; district: string | null }
  | { status: 'not_found' }
  | { status: 'unavailable' }

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'not_found' }
  // ⚠ l'API attend `lon`, pas `lng`
  const url = `${GEOCODE_BASE}/reverse/?lat=${lat}&lon=${lng}&limit=1`
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 6_000)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'grubano-geocoder/1.0' },
    }).finally(() => clearTimeout(timeout))
    if (!res.ok) return { status: 'unavailable' }
    const json = await res.json().catch(() => null) as
      | { features?: Array<{ properties?: { label?: string; city?: string; postcode?: string; district?: string } }> }
      | null
    if (!json || !Array.isArray(json.features)) return { status: 'unavailable' }
    const props = json.features[0]?.properties
    if (!props || typeof props.label !== 'string' || !props.label) return { status: 'not_found' }
    return {
      status: 'ok',
      label: props.label,
      city: typeof props.city === 'string' ? props.city : null,
      postcode: typeof props.postcode === 'string' ? props.postcode : null,
      district: typeof props.district === 'string' ? props.district : null,
    }
  } catch {
    return { status: 'unavailable' }
  }
}

/**
 * Lightweight plausibility check for a street address — a sanity gate run BEFORE
 * geocoding so obviously-bogus input (e.g. "gogo") is refused outright, while the
 * geocode handles the gray zone (plausible but unfindable → warn).
 *
 * Deliberately permissive to avoid blocking valid addresses: it only requires a
 * minimum length, at least one letter, and EITHER a digit (street number) OR a
 * separator (space / hyphen / comma / apostrophe → a multi-word place name like
 * "Place de la République" or "Grand-Rue"). Single gibberish tokens ("gogo",
 * "blablabla") fail; real addresses pass.
 */
export function isPlausibleAddress(value: string): boolean {
  const t = (value ?? '').trim()
  if (t.length < 5) return false
  if (!/[a-zA-ZÀ-ɏ]/.test(t)) return false        // must contain a letter (accents incl.)
  const hasDigit     = /\d/.test(t)
  const hasSeparator = /[\s,.\-']/.test(t)
  return hasDigit || hasSeparator
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
