import { createSharedPathnamesNavigation } from 'next-intl/navigation'
import { locales } from './i18n'

// Locale is always present in the URL (e.g. /fr/eat, /ar/dashboard).
export const localePrefix = 'always'

// Locale-aware drop-in replacements for next/link + next/navigation.
// Importing Link / useRouter / usePathname / redirect from here keeps the
// active locale in the URL during in-app navigation automatically.
export const { Link, redirect, usePathname, useRouter } =
  createSharedPathnamesNavigation({ locales, localePrefix })
