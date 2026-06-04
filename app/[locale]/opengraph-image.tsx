import { ImageResponse } from 'next/og'
import { getTranslations } from 'next-intl/server'
import { BRAND_NAME } from '@/lib/seo'

// Default branded OG card for every public page that doesn't ship its own
// (home, franchise, creators, …). Per-restaurant pages override this with
// app/[locale]/eat/r/[id]/opengraph-image.tsx.
// Node runtime: ImageResponse + getTranslations. Text uses @vercel/og's bundled
// Noto Sans (Latin) font, which Next auto-traces into the standalone output.
export const runtime = 'nodejs'
export const alt = 'Grubano — Commander, réserver & découvrir le food local'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const ORANGE = '#F97316'
const INK = '#1a1a2e'

export default async function Image({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'seo' })
  const tagline = t('ogTagline')
  const cta = t('ogCta')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 32,
          padding: '0 96px',
          backgroundImage: `linear-gradient(135deg, ${ORANGE} 0%, ${INK} 100%)`,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 120, fontWeight: 800, color: 'white', letterSpacing: -2 }}>
          {BRAND_NAME}
        </div>
        <div style={{ fontSize: 44, fontWeight: 600, color: 'rgba(255,255,255,0.95)', lineHeight: 1.2 }}>
          {tagline}
        </div>
        <div
          style={{
            display: 'flex',
            alignSelf: 'flex-start',
            marginTop: 16,
            padding: '16px 36px',
            backgroundColor: 'white',
            borderRadius: 9999,
            fontSize: 34,
            fontWeight: 800,
            color: ORANGE,
          }}
        >
          {cta}
        </div>
      </div>
    ),
    size,
  )
}
