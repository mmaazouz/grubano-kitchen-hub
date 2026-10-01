// ── Stellar logo (consumer redesign, Agent 128) ───────────────────────────────
// The "orbital" mark — a ring whose continuity is broken by a node — recoloured in
// Stellar green (var(--st-primary)). Theme-aware (the var resolves light/dark inside
// `.grubano-v2`); also accepts an explicit `color` for use on coloured backgrounds.
// Variants: 'mark' (orbit only), 'full' (mark + "grubano." wordmark), 'favicon'
// (thicker, legible at 16px). Pure SVG — no money, no data.

export type StellarLogoVariant = 'mark' | 'full' | 'favicon'

function OrbitMark({ size, color, strokeWidth, nodeR }: { size: number; color: string; strokeWidth: number; nodeR: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label="Grubano">
      <g transform="rotate(-55 16 16)">
        {/* Orbit ring with a gap (background-independent — no mask). */}
        <circle cx="16" cy="16" r="11" fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray="59.5 9.6" strokeLinecap="round" />
        {/* The node that breaks the orbit's continuity. */}
        <circle cx="27" cy="16" r={nodeR} fill={color} />
      </g>
    </svg>
  )
}

export interface StellarLogoProps {
  variant?: StellarLogoVariant
  /** Pixel height of the mark. Default 32 (24 for favicon). */
  size?: number
  /** Override the mark colour (defaults to the Stellar primary token). */
  color?: string
  className?: string
}

export function StellarLogo({ variant = 'full', size, color = 'var(--st-primary)', className }: StellarLogoProps) {
  if (variant === 'favicon') {
    return (
      <span className={className}>
        <OrbitMark size={size ?? 24} color={color} strokeWidth={4.2} nodeR={4.2} />
      </span>
    )
  }
  if (variant === 'mark') {
    return (
      <span className={className}>
        <OrbitMark size={size ?? 32} color={color} strokeWidth={3.2} nodeR={3.4} />
      </span>
    )
  }
  // full — mark + wordmark
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <OrbitMark size={size ?? 32} color={color} strokeWidth={3.2} nodeR={3.4} />
      <span className="font-stellar-display text-2xl font-extrabold tracking-tight text-stellar-ink">
        grubano<span style={{ color: 'var(--st-primary)' }}>.</span>
      </span>
    </span>
  )
}

export default StellarLogo
