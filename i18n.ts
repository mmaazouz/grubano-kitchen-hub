import { notFound } from 'next/navigation'
import { getRequestConfig } from 'next-intl/server'

export const locales = ['fr', 'en', 'es', 'ar', 'it'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'fr'

// RTL languages — Arabic is the only one in our set.
export const rtlLocales: Locale[] = ['ar']

export default getRequestConfig(async ({ locale }) => {
  if (!locales.includes(locale as Locale)) notFound()
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
