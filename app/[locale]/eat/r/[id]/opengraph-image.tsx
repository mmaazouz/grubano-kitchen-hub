import { ImageResponse } from 'next/og'
import { BRAND_NAME, getRestaurantSeo, cuisineList, toAbsolute } from '@/lib/seo'

// Prisma can't run on the edge → force the Node runtime for this OG route.
// Text uses @vercel/og's bundled Noto Sans (Latin), auto-traced into standalone.
export const runtime = 'nodejs'
export const alt = 'Grubano — restaurant'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const ORANGE = '#F97316'
const INK = '#1a1a2e'

/** Fetch the cover as a data URI so a broken/relative photo can't 500 the route. */
async function coverDataUri(url?: string | null): Promise<string | null> {
  const abs = toAbsolute(url)
  if (!abs) return null
  try {
    const res = await fetch(abs)
    if (!res.ok) return null
    const type = res.headers.get('content-type') || ''
    if (!type.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

export default async function Image({ params: { id } }: { params: { id: string } }) {
  const resto = await getRestaurantSeo(id)
  const name = resto?.name ?? BRAND_NAME
  const city = resto?.city ?? ''
  const cuisines = resto ? cuisineList(resto.cuisine).slice(0, 3).join(' · ') : ''
  const rating = resto && resto.reviewCount > 0 ? resto.rating.toFixed(1) : null
  const cover = await coverDataUri(resto?.coverPhoto)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backgroundColor: INK,
          backgroundImage: cover
            ? `url(${cover})`
            : `linear-gradient(135deg, ${ORANGE} 0%, ${INK} 100%)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand chip, top-left */}
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: 56,
            display: 'flex',
            alignItems: 'center',
            padding: '12px 24px',
            backgroundColor: ORANGE,
            borderRadius: 9999,
            fontSize: 30,
            fontWeight: 800,
            color: 'white',
            letterSpacing: -0.5,
          }}
        >
          {BRAND_NAME}
        </div>

        {/* Readability scrim + text block */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '64px 56px 56px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {rating && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 18px',
                  backgroundColor: 'white',
                  borderRadius: 9999,
                  fontSize: 28,
                  fontWeight: 800,
                  color: INK,
                }}
              >
                <span style={{ color: ORANGE }}>★</span> {rating}
              </div>
            )}
            {cuisines && (
              <div style={{ fontSize: 28, fontWeight: 600, color: '#FFD9C7' }}>{cuisines}</div>
            )}
          </div>
          <div style={{ fontSize: 72, fontWeight: 800, color: 'white', lineHeight: 1.05 }}>
            {name}
          </div>
          {city && (
            <div style={{ fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.92)' }}>
              {city} · Commander & réserver
            </div>
          )}
        </div>
      </div>
    ),
    size,
  )
}
