import type { Metadata } from 'next'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n'

/**
 * Partner-space layout — sole purpose is to override the document title for
 * every page under /{locale}/business/* (the inner pages are 'use client' and
 * can't export `generateMetadata` themselves). All pages stay bare — the
 * AppChrome bare-list already includes `/business` (see components/AppChrome).
 */

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: Locale }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'business.metadata' })
  return {
    title: t('title'),
    description: t('description'),
  }
}

export default function BusinessLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: Locale }
}) {
  unstable_setRequestLocale(locale)
  return <>{children}</>
}
