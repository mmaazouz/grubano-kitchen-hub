'use client'

/**
 * AffiliateShareCard — Studio de contenu 2b (Agent 14). A templated, screenshot-
 * friendly SHARE CARD (inline SVG, 540×675 — IG 4:5): dish image + name + price +
 * affiliate QR + tagline, with a "download .svg" action (serialises the live SVG).
 *
 * v1 templated SVG on purpose — full image export / Canva integration is a future
 * slice (a remote dish <image href> resolves online; offline it shows the panel).
 * Reuses the app design tokens (hex mirrors of grubano-* — SVG needs literal colors).
 */

import { useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Download } from 'lucide-react'
import { useTranslations } from 'next-intl'

const W = 540, H = 675, IMG_H = 360

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

export default function AffiliateShareCard({
  photo, title, subtitle, price, tagline, link,
}: {
  photo:    string | null
  title:    string
  subtitle: string | null
  price:    string | null
  tagline:  string
  link:     string
}) {
  const t = useTranslations('creators.affiliate')
  const svgRef = useRef<SVGSVGElement | null>(null)

  function download() {
    const node = svgRef.current
    if (!node) return
    try {
      const xml = new XMLSerializer().serializeToString(node)
      const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `grubano-${(title || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.svg`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* download unavailable — the card stays screenshot-friendly */ }
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-grubano-lg border border-grubano-border bg-white">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg"
          className="block h-auto w-full" role="img" aria-label={title}>
          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
          {/* Dish image (or a branded fallback panel). */}
          {photo
            ? <image href={photo} x="0" y="0" width={W} height={IMG_H} preserveAspectRatio="xMidYMid slice" />
            : <rect x="0" y="0" width={W} height={IMG_H} fill="#FFF3ED" />}
          {!photo && <text x={W / 2} y={IMG_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize="64">🍽️</text>}

          {/* Bottom panel */}
          <text x="32" y={IMG_H + 64} fill="#1a1a2e" fontSize="38" fontWeight="800" fontFamily="Inter, system-ui, sans-serif">
            {truncate(title, 22)}
          </text>
          {subtitle && (
            <text x="32" y={IMG_H + 98} fill="#6b7280" fontSize="20" fontFamily="Inter, system-ui, sans-serif">
              {truncate(subtitle, 34)}
            </text>
          )}
          {price && (
            <text x="32" y={IMG_H + 150} fill="#F97316" fontSize="40" fontWeight="800" fontFamily="Inter, system-ui, sans-serif">
              {price}
            </text>
          )}
          <text x="32" y={H - 84} fill="#1a1a2e" fontSize="19" fontFamily="Inter, system-ui, sans-serif">
            {truncate(tagline, 40)}
          </text>
          <text x="32" y={H - 28} fill="#9ca3af" fontSize="16" fontWeight="700" fontFamily="Inter, system-ui, sans-serif">
            grubano.com
          </text>

          {/* Affiliate QR (bottom-right). Wrapped in a translated <g> so the
              nested QR svg is positioned reliably across qrcode.react versions. */}
          <g transform={`translate(${W - 152}, ${H - 152})`}>
            <rect x="-8" y="-8" width="136" height="136" rx="12" fill="#ffffff" stroke="#eee" />
            <QRCodeSVG value={link || 'https://grubano.com'} size={120} includeMargin={false} />
          </g>
        </svg>
      </div>
      <button type="button" onClick={download}
        className="inline-flex items-center gap-1.5 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-[12px] font-bold text-grubano-ink active:scale-[0.99]">
        <Download size={13} /> {t('studioDownloadCard')}
      </button>
    </div>
  )
}
