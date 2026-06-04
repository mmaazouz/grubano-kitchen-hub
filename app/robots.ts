import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// Private areas are blocked for every bot. Everything is under a /{locale}
// prefix, so the patterns use a leading /*/ wildcard (supported by Googlebot
// and Bingbot) to cover all 5 languages. The public consumer surface
// (/{locale}/eat*, the /franchise + /creators landing pages and their /apply
// forms) stays crawlable. Note: /*/franchise/dashboard and
// /*/creators/dashboard block only the authenticated dashboards, not the
// public portals one level up.
const DISALLOW = [
  '/api/',
  '/*/dashboard',
  '/*/franchise/dashboard',
  '/*/creators/dashboard',
  '/*/analytics',
  '/*/brands',
  '/*/briefing',
  '/*/cashflow',
  '/*/customers',
  '/*/dinein',
  '/*/finance',
  '/*/loyalty',
  '/*/marketplace',
  '/*/menu',
  '/*/more',
  '/*/notifications',
  '/*/onboarding',
  '/*/orders',
  '/*/premium',
  '/*/prep',
  '/*/pricing',
  '/*/reviews',
  '/*/stocks',
  '/*/suppliers',
  '/*/tables',
  '/*/wallet',
  '/*/account',
  '/*/design',
  '/*/login',
  '/*/eat/account',
  '/*/eat/auth',
  '/*/eat/cart',
  '/*/eat/track',
  '/*/eat/favorites',
  '/*/eat/splash',
  '/*/ref/',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      { userAgent: 'Googlebot', allow: '/', disallow: DISALLOW },
      { userAgent: 'Bingbot', allow: '/', disallow: DISALLOW },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
