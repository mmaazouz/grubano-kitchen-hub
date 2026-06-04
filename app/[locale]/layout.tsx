import type { Metadata } from 'next'
import '../globals.css'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import AppChrome from '@/components/AppChrome'
import Analytics from '@/components/Analytics'
import { locales, rtlLocales, type Locale } from '@/i18n'
import { SITE_URL, BRAND_NAME, ogBase, twitterBase, defaultOgImage } from '@/lib/seo'

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

// App-wide defaults. metadataBase makes relative OG/icon URLs absolute, and the
// default OG/Twitter cards are localized. Public pages override title +
// description + alternates. The default branded og:image is referenced
// explicitly because the opengraph-image file convention applies to its own
// segment only and does NOT cascade to child routes — the restaurant page is
// the exception (it ships its own colocated opengraph-image).
export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'seo' })
  const title = t('defaultTitle')
  const description = t('defaultDescription')

  return {
    metadataBase: new URL(SITE_URL),
    applicationName: BRAND_NAME,
    title,
    description,
    robots: { index: true, follow: true },
    openGraph: ogBase(locale as Locale, {
      title,
      description,
      image: defaultOgImage(locale as Locale),
    }),
    twitter: twitterBase({ title, description, image: defaultOgImage(locale as Locale) }),
    // Favicon files live in /public (placed by Mohammed).
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: '32x32' },
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
      ],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    },
    manifest: '/manifest.webmanifest',
  }
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!locales.includes(locale as Locale)) notFound()
  unstable_setRequestLocale(locale)

  const messages = await getMessages()
  const dir = rtlLocales.includes(locale as Locale) ? 'rtl' : 'ltr'

  return (
    <html lang={locale} dir={dir}>
      <body className="bg-background">
        <NextIntlClientProvider messages={messages}>
          <AppChrome>{children}</AppChrome>
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  )
}
