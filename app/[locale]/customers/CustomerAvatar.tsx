'use client'

// ── Shared customer avatar (list + profile) — arbitrage Design 2026-08-19 ─────
// Initials by GRAPHEMES with deterministic fallback (lib/customer-initials),
// color derived from LoyaltyCustomer.id only (lib/customer-avatar, unchanged),
// text containment by adaptive reduction + floor (lib/avatar-fit) with the
// circular clip as final net (CSS overflow:hidden on .lc__av / .hero__av).
// Ink is measured with the REAL font via canvas measureText; re-measured once
// document.fonts.ready resolves so the self-hosted Gabarito (not the fallback)
// drives the fit. SSR renders at nominal size; the reduction applies on mount.

import { useEffect, useState } from 'react'
import { customerAvatarGradient } from '@/lib/customer-avatar'
import { customerInitials } from '@/lib/customer-initials'
import { AVATAR_FIT, fitAvatarText } from '@/lib/avatar-fit'

const AVATAR_FONT_STACK = "Gabarito, system-ui, sans-serif"

export default function CustomerAvatar({
  customerId,
  name,
  variant,
  className,
}: {
  customerId: string
  name: string
  variant: 'list' | 'profile'
  className: string
}) {
  const initials = customerInitials(name)
  const spec = AVATAR_FIT[variant]
  const [fontPx, setFontPx] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const run = () => {
      if (!alive) return
      const cx = document.createElement('canvas').getContext('2d')
      if (!cx) return
      const px = fitAvatarText((size) => {
        cx.font = `800 ${size}px ${AVATAR_FONT_STACK}`
        const m = cx.measureText(initials)
        return {
          w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
          h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
        }
      }, spec)
      setFontPx(px === spec.nominal ? null : px)
    }
    run()
    document.fonts?.ready?.then(run).catch(() => {})
    return () => {
      alive = false
    }
  }, [initials, spec])

  return (
    <span
      className={className}
      style={{
        background: customerAvatarGradient(customerId),
        ...(fontPx !== null ? { fontSize: `${fontPx}px` } : {}),
      }}
    >
      {initials}
    </span>
  )
}
