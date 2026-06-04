import type { MetadataRoute } from 'next'
import { locales, defaultLocale } from '@/i18n'
import { absoluteUrl } from '@/lib/seo'
import { prisma } from '@/lib/prisma'

// Built at request time so newly-published restaurants appear without a
// redeploy, and so a build machine without DB access never fails the build.
export const dynamic = 'force-dynamic'

// Locale-agnostic public routes. Each becomes one sitemap entry per locale,
// all sharing the same hreflang cluster. Private/operator routes and personal
// consumer pages (cart, account, tracking…) are intentionally excluded — see
// robots.ts for the matching crawl rules.
const STATIC_PATHS = [
  '/eat',
  '/eat/search',
  '/eat/promos',
  '/franchise',
  '/franchise/apply',
  '/creators',
  '/creators/apply',
]

/** hreflang map (fr/en/es/ar/it + x-default) for one locale-agnostic path. */
function languagesFor(path: string): Record<string, string> {
  const languages: Record<string, string> = {}
  for (const l of locales) languages[l] = absoluteUrl(l, path)
  languages['x-default'] = absoluteUrl(defaultLocale, path)
  return languages
}

/** One sitemap entry per locale for a given path, each carrying the cluster. */
function entriesFor(path: string, lastModified: Date): MetadataRoute.Sitemap {
  const languages = languagesFor(path)
  return locales.map((l) => ({
    url: absoluteUrl(l, path),
    lastModified,
    alternates: { languages },
  }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.flatMap((p) =>
    entriesFor(p, now),
  )

  let restaurants: { id: string; createdAt: Date }[] = []
  try {
    restaurants = await prisma.restaurant.findMany({
      where: { isActive: true },
      select: { id: true, createdAt: true },
    })
  } catch {
    // No DB at build/runtime → ship the static pages rather than 500 the route.
    restaurants = []
  }

  for (const r of restaurants) {
    entries.push(...entriesFor(`/eat/r/${r.id}`, r.createdAt))
  }

  return entries
}
