import type { Metadata, Viewport } from 'next'
import '../globals.css'
// Grubano Design System v1 token layer (Agent 148) — ADDITIVE + namespaced. Loaded
// app-wide here, like stellar-theme.css; only `gb-*` Tailwind utilities + brand-new CSS
// vars are introduced, so non-migrated screens render byte-identical. See app/tokens.css.
import '../tokens.css'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, unstable_setRequestLocale } from 'next-intl/server'
import AppChrome from '@/components/AppChrome'
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister'
import { locales, rtlLocales, type Locale } from '@/i18n'

export const metadata: Metadata = {
  title: 'Grubano — Commander local',
  description: 'Commandez vos plats préférés près de chez vous, livrés vite.',
  // Favicon files live in /public (placed by Mohammed).
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  // PWA — installable web app (additive; no visual change). The service worker is
  // registered client-side by <ServiceWorkerRegister/> below.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Grubano',
    statusBarStyle: 'default',
  },
}

// theme-color for the browser/OS chrome (Next 14 puts this on the viewport export; the
// default width=device-width viewport is kept automatically — not duplicated).
export const viewport: Viewport = {
  themeColor: '#0F2742',
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
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
        <ServiceWorkerRegister />
        <NextIntlClientProvider messages={messages}>
          <AppChrome>{children}</AppChrome>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
