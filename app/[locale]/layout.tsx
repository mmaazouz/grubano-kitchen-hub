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
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Material Symbols Rounded — loaded ROBUSTLY here so the consumer app's
            `.ms` ligature icons ALWAYS render, independent of per-route CSS bundle
            order. gb-tokens.css also `@import`s this font, but that @import is
            invalidated on any route whose page CSS is bundled before it (per the
            CSS spec @import must be first) — the icon ligatures then fall back to
            raw text. This <link> is the belt; the import reorder is the suspenders.
            Axes match the gb-tokens @import exactly. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&display=block"
        />
        {/* Theme init (P1-THEME) — apply the saved consumer theme BEFORE first paint so a
            dark preference never flashes. Default (no stored value) = light, unchanged. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('grubano_theme');var d=t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="bg-background">
        <ServiceWorkerRegister />
        <NextIntlClientProvider messages={messages}>
          <AppChrome>{children}</AppChrome>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
