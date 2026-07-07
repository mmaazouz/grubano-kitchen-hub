'use client'

import './courier-map.css'

// ── CourierMap — Géoloc ÉTAPE 4 — SELF-HOSTED, CSP-safe courier position map. ──────────────────
// NO external tile provider / map library: the "map" is a self-contained SVG built purely from
// the coordinates (equirectangular projection to the viewBox), so it makes ZERO external request —
// safe under any CSP and privacy-superior (a courier's position never transits a third-party CDN).
// It shows the courier (for a client: the ALREADY-COARSENED point + an "approximate area" halo),
// the pickup (restaurant) and dropoff (the caller's own address), a dashed approach line, and an
// optional ETA. Purely presentational — it renders whatever the owner-scoped endpoint returns.

interface LatLng { lat: number; lng: number }

export interface CourierMapProps {
  courier: LatLng
  pickup?: LatLng | null
  dropoff?: LatLng | null
  /** Already-localized ETA text, e.g. "≈ 8 min". */
  etaText?: string | null
  /** Already-localized "approximate position" note (shown when the point is coarsened). */
  approxText?: string | null
  /** Accent colour (defaults to the consumer orange). */
  accent?: string
}

const W = 340
const H = 210
const PAD = 30
const MIN_SPAN = 0.002 // ~200 m — avoids over-zoom when the points are close together

export default function CourierMap({ courier, pickup, dropoff, etaText, approxText, accent = '#F2570E' }: CourierMapProps) {
  // Defensive: the courier point is required + finite (a MySQL Float can't be NaN); guard anyway so
  // the projection can never divide by an empty point set → no NaN coordinates.
  if (!courier || !Number.isFinite(courier.lat) || !Number.isFinite(courier.lng)) return null
  const pts = [courier, pickup, dropoff].filter((p): p is LatLng => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
  const lngCos = Math.cos((cLat * Math.PI) / 180) || 1
  const latSpan = Math.max(...pts.map((p) => Math.abs(p.lat - cLat))) * 2
  const lngSpan = Math.max(...pts.map((p) => Math.abs((p.lng - cLng) * lngCos))) * 2
  const span = Math.max(latSpan, lngSpan, MIN_SPAN)

  const proj = (p: LatLng) => ({
    x: PAD + (0.5 + ((p.lng - cLng) * lngCos) / span) * (W - 2 * PAD),
    y: PAD + (0.5 - (p.lat - cLat) / span) * (H - 2 * PAD),
  })
  const c = proj(courier)
  const pk = pickup ? proj(pickup) : null
  const dp = dropoff ? proj(dropoff) : null

  return (
    <div className="cmap" role="img" aria-label={approxText ?? 'Carte de suivi'}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        {/* Self-contained background + faint grid (no external tiles). */}
        <rect x="0" y="0" width={W} height={H} fill="#eef1f4" />
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`v${i}`} x1={(i * W) / 7} y1="0" x2={(i * W) / 7} y2={H} stroke="#e2e6ea" strokeWidth="1" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={(i * H) / 5} x2={W} y2={(i * H) / 5} stroke="#e2e6ea" strokeWidth="1" />
        ))}

        {/* Approach line: pickup → courier (faint) and courier → dropoff (dashed accent). */}
        {pk && <line x1={pk.x} y1={pk.y} x2={c.x} y2={c.y} stroke="#c3c9d0" strokeWidth="3" strokeLinecap="round" />}
        {dp && <line x1={c.x} y1={c.y} x2={dp.x} y2={dp.y} stroke={accent} strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />}

        {/* Pickup (restaurant). */}
        {pk && (
          <g>
            <circle cx={pk.x} cy={pk.y} r="11" fill="#fff" stroke="#c3c9d0" strokeWidth="2" />
            <text x={pk.x} y={pk.y + 4} textAnchor="middle" fontSize="12" fill="#6b7280" fontFamily="'Material Symbols Outlined'">store</text>
          </g>
        )}
        {/* Dropoff (the caller's own address). */}
        {dp && (
          <g>
            <circle cx={dp.x} cy={dp.y} r="11" fill="#fff" stroke={accent} strokeWidth="2" />
            <text x={dp.x} y={dp.y + 4} textAnchor="middle" fontSize="12" fill={accent} fontFamily="'Material Symbols Outlined'">home</text>
          </g>
        )}
        {/* Courier — a coarse "approximate area" halo (when approx) + the point. */}
        {approxText && <circle cx={c.x} cy={c.y} r="26" fill={accent} opacity="0.12" />}
        <circle className="cmap__dot" cx={c.x} cy={c.y} r="9" fill={accent} stroke="#fff" strokeWidth="3" />
        <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize="11" fill="#fff" fontFamily="'Material Symbols Outlined'">two_wheeler</text>
      </svg>

      {(etaText || approxText) && (
        <div className="cmap__foot">
          {etaText && <span className="cmap__eta"><span className="ms">schedule</span>{etaText}</span>}
          {approxText && <span className="cmap__approx"><span className="ms">my_location</span>{approxText}</span>}
        </div>
      )}
    </div>
  )
}
