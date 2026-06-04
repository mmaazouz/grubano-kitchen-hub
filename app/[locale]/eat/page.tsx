import type { Metadata } from 'next'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n'
import {
  SITE_URL,
  BRAND_NAME,
  absoluteUrl,
  buildAlternates,
  ogBase,
  twitterBase,
  defaultOgImage,
} from '@/lib/seo'
import HomeClient from './HomeClient'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'seo' })
  const title = t('homeTitle')
  const description = t('homeDescription')

  return {
    title,
    description,
    alternates: buildAlternates(locale as Locale, '/eat'),
    openGraph: ogBase(locale as Locale, {
      title,
      description,
      path: '/eat',
      image: defaultOgImage(locale as Locale),
    }),
    twitter: twitterBase({ title, description, image: defaultOgImage(locale as Locale) }),
  }
}

export default async function HomePage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'seo' })

  // Organization + WebSite are emitted on the consumer home only. The WebSite
  // SearchAction maps to /{locale}/eat/search?q=… (the param the search page reads).
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/web-app-manifest-512x512.png`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: BRAND_NAME,
      url: absoluteUrl(locale as Locale, '/eat'),
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${absoluteUrl(locale as Locale, '/eat/search')}?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Visually-hidden page heading — the client home is a visual grid with no
          single descriptive <h1>; this gives crawlers + screen readers one. */}
      <h1 className="sr-only">{t('homeH1')}</h1>
      <HomeClient />
    </>
  )
}
