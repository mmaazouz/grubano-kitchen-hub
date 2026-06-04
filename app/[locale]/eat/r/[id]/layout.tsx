import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n'
import {
  BRAND_NAME,
  absoluteUrl,
  buildAlternates,
  ogBase,
  twitterBase,
  getRestaurantSeo,
  cuisineList,
  toAbsolute,
  clamp,
} from '@/lib/seo'

interface Params {
  locale: string
  id: string
}

// The page itself is a client component, so its metadata + JSON-LD live here in
// a server layout sibling. getRestaurantSeo is React.cache()d, so the Prisma
// lookup is shared between generateMetadata, this render and the OG image route
// within a single request.
export async function generateMetadata({
  params: { locale, id },
}: {
  params: Params
}): Promise<Metadata> {
  const [t, resto] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getRestaurantSeo(id),
  ])

  // Unknown / inactive restaurant → don't index a thin "not found" screen.
  if (!resto) {
    return { title: t('defaultTitle'), robots: { index: false, follow: true } }
  }

  const title = t('restaurantTitle', { name: resto.name, city: resto.city })
  const description = clamp(
    t('restaurantDescription', { name: resto.name, city: resto.city }),
  )
  const path = `/eat/r/${id}`

  return {
    title,
    description,
    alternates: buildAlternates(locale as Locale, path),
    openGraph: ogBase(locale as Locale, { title, description, path }),
    twitter: twitterBase({ title, description }),
  }
}

export default async function RestaurantLayout({
  children,
  params: { locale, id },
}: {
  children: React.ReactNode
  params: Params
}) {
  const resto = await getRestaurantSeo(id)

  // schema.org Restaurant. Every field is real data from the DB — geo and
  // aggregateRating are emitted ONLY when present, never fabricated (Google
  // penalizes invented structured data). priceRange and openingHours are
  // omitted because we don't store them.
  const jsonLd = resto
    ? {
        '@context': 'https://schema.org',
        '@type': 'Restaurant',
        '@id': absoluteUrl(locale as Locale, `/eat/r/${id}`),
        name: resto.name,
        url: absoluteUrl(locale as Locale, `/eat/r/${id}`),
        ...(resto.description ? { description: resto.description } : {}),
        ...(toAbsolute(resto.coverPhoto) ? { image: toAbsolute(resto.coverPhoto) } : {}),
        ...(cuisineList(resto.cuisine).length
          ? { servesCuisine: cuisineList(resto.cuisine) }
          : {}),
        address: {
          '@type': 'PostalAddress',
          streetAddress: resto.address,
          addressLocality: resto.city,
          addressCountry: 'FR',
        },
        ...(resto.lat != null && resto.lng != null
          ? {
              geo: {
                '@type': 'GeoCoordinates',
                latitude: resto.lat,
                longitude: resto.lng,
              },
            }
          : {}),
        ...(resto.reviewCount > 0
          ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: resto.rating,
                reviewCount: resto.reviewCount,
              },
            }
          : {}),
        brand: { '@type': 'Brand', name: BRAND_NAME },
      }
    : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  )
}
