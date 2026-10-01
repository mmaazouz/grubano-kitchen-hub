/**
 * docs-map — frozen snapshot of the App↔Docs link contract.
 *
 * Owned by Agent 6 (Design System) on the app side. Source of truth lives at
 *   https://docs.grubano.com/docs-map.json
 * (published & versioned by the docs repo). We embed a TYPED snapshot here so
 * the app can resolve doc URLs at render time with:
 *   - zero network latency
 *   - zero CORS exposure
 *   - zero risk of a 3rd-party outage breaking the help links
 *
 * ── How to re-sync the snapshot ────────────────────────────────────────────
 * When the docs team bumps a topic or adds one:
 *   node scripts/sync-docs-map.js
 * The script fetches the live JSON, runs schema sanity checks, and rewrites
 * the constants below in place. Run check:i18n + npm run build afterwards.
 *
 * ── How the URL is built ───────────────────────────────────────────────────
 *   ${base}/${resolvedLocale}${topic.doc}
 * `resolvedLocale` = user locale if the docs site supports it, otherwise the
 * first locale listed in DOCS_MAP.locales (the docs primary, today: "fr").
 * Always returns a usable URL — if the topic key is unknown, we point at the
 * docs home (no broken links).
 */

// Keep in sync with snapshot below; bumped when source changes.
export const DOCS_MAP_VERSION = 1 as const

/** Locales the docs SITE supports (NOT the app's full locale set). */
export const DOCS_LOCALES = ['fr', 'en'] as const
export type DocsLocale = (typeof DOCS_LOCALES)[number]

/** Base origin for the docs site (no trailing slash). */
export const DOCS_BASE = 'https://docs.grubano.com'

/**
 * Every topic key & its frozen locale-relative path.
 * NEVER add a key the source doesn't have — sync via scripts/sync-docs-map.js.
 *
 * `app` is unused today (will be wired once docs->app deep-links land).
 */
export const DOCS_TOPICS = {
  'intro'                  : { doc: '/getting-started'    , app: null },
  'restaurant.quick-start' : { doc: '/guides/quick-start' , app: null },
  'restaurant.dashboard'   : { doc: '/guides/restaurant'  , app: null },
  'restaurant.menu'        : { doc: '/guides/menu'        , app: null },
  'restaurant.stocks'      : { doc: '/guides/stocks'      , app: null },
  'restaurant.loyalty'     : { doc: '/guides/loyalty'     , app: null },
  'restaurant.reservations': { doc: '/guides/reservations', app: null },
  'restaurant.pro'         : { doc: '/guides/pro'         , app: null },
  'consumer.order'         : { doc: '/guides/consumer'    , app: null },
  'franchise'              : { doc: '/guides/franchise'   , app: null },
  'creators'               : { doc: '/guides/creators'    , app: null },
  'api'                    : { doc: '/api'                , app: null },
  'changelog'              : { doc: '/changelog'          , app: null },
} as const satisfies Record<string, { doc: string; app: string | null }>

/** Public type — what callers should pass to <DocsLink topic="..."/>. */
export type DocsTopic = keyof typeof DOCS_TOPICS

/** Full snapshot — useful for the showcase page & sync diff checks. */
export const DOCS_MAP = {
  version: DOCS_MAP_VERSION,
  base:    DOCS_BASE,
  locales: DOCS_LOCALES,
  topics:  DOCS_TOPICS,
} as const

// ── Resolution helpers ─────────────────────────────────────────────────────

/**
 * Pick the doc locale that best matches the user locale.
 * If the user locale isn't in DOCS_LOCALES, fall back to DOCS_LOCALES[0]
 * (today: "fr" — the docs primary & Grubano's source language).
 */
export function resolveDocsLocale(userLocale: string): DocsLocale {
  return (DOCS_LOCALES as readonly string[]).includes(userLocale)
    ? (userLocale as DocsLocale)
    : DOCS_LOCALES[0]
}

/**
 * Resolve a topic key + user locale to a full docs URL.
 *
 * Graceful fallback: if `topic` is unknown, returns the docs home for the
 * resolved locale. Never throws, never returns an invalid URL.
 *
 * @example
 *   resolveDocsUrl('restaurant.stocks', 'fr') → https://docs.grubano.com/fr/guides/stocks
 *   resolveDocsUrl('restaurant.stocks', 'ar') → https://docs.grubano.com/fr/guides/stocks (ar not in docs)
 *   resolveDocsUrl('not.a.real.topic',  'en') → https://docs.grubano.com/en
 */
export function resolveDocsUrl(topic: string, userLocale: string): string {
  const loc = resolveDocsLocale(userLocale)
  const entry = (DOCS_TOPICS as Record<string, { doc: string }>)[topic]
  if (!entry) return `${DOCS_BASE}/${loc}`
  return `${DOCS_BASE}/${loc}${entry.doc}`
}

/** True if the topic key exists in the embedded snapshot. */
export function isKnownDocsTopic(topic: string): topic is DocsTopic {
  return Object.prototype.hasOwnProperty.call(DOCS_TOPICS, topic)
}

/** All known topic keys — for the design showcase & tooling. */
export const ALL_DOCS_TOPICS: ReadonlyArray<DocsTopic> =
  Object.keys(DOCS_TOPICS) as DocsTopic[]
