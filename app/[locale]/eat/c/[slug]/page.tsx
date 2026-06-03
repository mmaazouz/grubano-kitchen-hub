'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useRouter, Link } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowLeft,
  BadgeCheck,
  Instagram,
  Youtube,
  Copy,
  Check,
  Store,
  ChevronRight,
  Utensils,
} from 'lucide-react'
import { Button, EmptyState, Badge, Skeleton } from '@/components/design-system'
import FoodImage from '@/components/eat/FoodImage'
import { showToast } from '@/lib/eat-cart'

// ── Types matching GET /api/creators/public/[slug] ────────────────────────────

interface ServedAt {
  id: string
  name: string
  city: string
  sellingPrice: number
  menuItemId: string | null
}

interface CreatorRecipe {
  id: string
  name: string
  description: string
  photo: string | null
  cuisineType: string
  servedAt: ServedAt[]
}

interface CreatorProfile {
  name: string
  bio: string | null
  followers: number
  verified: boolean
  instagram: string | null
  tiktok: string | null
  youtube: string | null
  referralCode: string | null
  slug: string | null
  recipes: CreatorRecipe[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFollowers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

function socialUrl(kind: 'instagram' | 'tiktok' | 'youtube', handle: string): string {
  // Already-absolute URLs pass through; bare handles get the canonical host.
  if (/^https?:\/\//i.test(handle)) return handle
  const h = handle.replace(/^@/, '').trim()
  if (kind === 'instagram') return `https://instagram.com/${h}`
  if (kind === 'tiktok') return `https://tiktok.com/@${h}`
  return `https://youtube.com/@${h}`
}

/**
 * TikTok glyph — lucide-react doesn't ship one, this minimal SVG is enough at
 * 16px for the social row. Inherits currentColor so it matches the link tint.
 */
function TikTokIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.6 6.7a5.4 5.4 0 0 1-3.2-1.1A5.4 5.4 0 0 1 14.6 2H11v13.7a2.5 2.5 0 1 1-1.8-2.4V9.5a6.2 6.2 0 1 0 5.4 6.1V9.4a8.8 8.8 0 0 0 5 1.5V6.7z" />
    </svg>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PublicCreatorPage() {
  const t = useTranslations('eat.creator')
  const locale = useLocale()
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  const [data, setData] = useState<CreatorProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    fetch(`/api/creators/public/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 404) {
          setNotFound(true)
          return
        }
        if (!r.ok) {
          setNotFound(true)
          return
        }
        const json = (await r.json()) as CreatorProfile
        setData(json)
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const copyCode = useCallback(() => {
    if (!data?.referralCode) return
    try {
      navigator.clipboard?.writeText(data.referralCode)
    } catch {
      /* ignore */
    }
    setCopied(true)
    showToast(t('codeCopied'))
    window.setTimeout(() => setCopied(false), 1800)
  }, [data, t])

  // ── Loading / not-found ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="border-b border-grubano-border bg-white px-4 pb-4 pt-3">
          <Skeleton className="h-6 w-1/3" />
        </div>
        <div className="space-y-4 p-5">
          <Skeleton className="h-40 w-full rounded-grubano-xl" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-28 w-full rounded-grubano-lg" />
          <Skeleton className="h-28 w-full rounded-grubano-lg" />
        </div>
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-white">
        <PageHeader title={t('title')} onBack={() => router.push('/eat')} />
        <EmptyState
          emoji="🥢"
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
          action={
            <Button variant="primary" size="pill" onClick={() => router.push('/eat')}>
              {t('backToBrowse')}
            </Button>
          }
        />
      </div>
    )
  }

  const heroPhoto = data.recipes.find((r) => r.photo)?.photo ?? null
  const initial = data.name.trim()[0]?.toUpperCase() ?? '?'

  return (
    <div className="min-h-screen bg-white">
      <PageHeader title={t('title')} onBack={() => router.push('/eat')} />

      {/* ── Profile hero ──────────────────────────────────────────────────── */}
      <div className="relative">
        {/* Cover (gradient or first recipe photo) */}
        <FoodImage name={data.name} src={heroPhoto} className="h-44 w-full" glyphClassName="text-6xl" hideGlyph />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />

        {/* Avatar overlapping the cover */}
        <div className="relative -mt-12 px-5">
          <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border-[4px] border-white bg-grubano-tint text-3xl font-extrabold text-grubano-primary shadow-grubano-md">
            {initial}
          </div>
        </div>
      </div>

      {/* ── Identity block ────────────────────────────────────────────────── */}
      <div className="px-5 pt-3">
        <div className="flex items-center gap-1.5">
          <h1 className="font-display text-[24px] font-extrabold text-grubano-ink">{data.name}</h1>
          {data.verified && <BadgeCheck size={20} className="text-grubano-primary" strokeWidth={2.4} />}
        </div>
        <p className="mt-1 text-grubano-sm text-grubano-ink-muted">
          <span className="font-bold text-grubano-ink">{formatFollowers(data.followers)}</span> {t('followers')}
          {data.verified && <span className="ml-2 inline-flex items-center gap-1 text-grubano-primary font-medium">· {t('verifiedBadge')}</span>}
        </p>

        {data.bio && <p className="mt-2.5 whitespace-pre-line text-grubano-sm leading-relaxed text-grubano-ink-muted">{data.bio}</p>}

        {/* Socials */}
        {(data.instagram || data.tiktok || data.youtube) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.instagram && (
              <a
                href={socialUrl('instagram', data.instagram)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-grubano-pill border border-grubano-border bg-white px-3 py-1.5 text-xs font-semibold text-grubano-ink-muted hover:bg-grubano-surface-muted"
              >
                <Instagram size={14} /> Instagram
              </a>
            )}
            {data.tiktok && (
              <a
                href={socialUrl('tiktok', data.tiktok)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-grubano-pill border border-grubano-border bg-white px-3 py-1.5 text-xs font-semibold text-grubano-ink-muted hover:bg-grubano-surface-muted"
              >
                <TikTokIcon size={14} /> TikTok
              </a>
            )}
            {data.youtube && (
              <a
                href={socialUrl('youtube', data.youtube)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-grubano-pill border border-grubano-border bg-white px-3 py-1.5 text-xs font-semibold text-grubano-ink-muted hover:bg-grubano-surface-muted"
              >
                <Youtube size={14} /> YouTube
              </a>
            )}
          </div>
        )}

        {/* Referral code chip */}
        {data.referralCode && (
          <button
            onClick={copyCode}
            className="mt-3 inline-flex items-center gap-2 rounded-grubano-pill border-[1.5px] border-dashed border-grubano-primary bg-grubano-tint px-3 py-1.5 text-grubano-sm font-bold text-grubano-primary active:scale-95"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {t('copyCode', { code: data.referralCode })}
          </button>
        )}
      </div>

      {/* ── Recipes section ──────────────────────────────────────────────── */}
      <div className="px-5 pb-8 pt-6">
        <h2 className="mb-4 font-display text-[20px] font-extrabold text-grubano-ink">{t('recipesTitle')}</h2>

        {data.recipes.length === 0 ? (
          <EmptyState compact emoji="🍳" title={t('noRecipesTitle')} description={t('noRecipesDescription')} />
        ) : (
          <div className="space-y-4">
            {data.recipes.map((recipe) => (
              <RecipeBlock
                key={recipe.id}
                recipe={recipe}
                locale={locale}
                referralCode={data.referralCode}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center border-b border-grubano-border bg-white/95 px-4 pb-3 pt-3 backdrop-blur">
      <button
        onClick={onBack}
        aria-label="Retour"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-grubano-surface-muted active:scale-90"
      >
        <ArrowLeft size={20} className="text-grubano-ink" />
      </button>
      <h1 className="flex-1 text-center font-display text-[16px] font-extrabold text-grubano-ink">{title}</h1>
      <div className="w-10" />
    </div>
  )
}

function RecipeBlock({
  recipe,
  locale,
  referralCode,
}: {
  recipe: CreatorRecipe
  locale: string
  referralCode: string | null
}) {
  const t = useTranslations('eat.creator')

  /**
   * CTA target: anti-cannibalisation funnel — go through /ref/{code} (5A) so
   * the attribution cookie is dropped, then land on the adopting restaurant.
   * 5A whitelists the ?to= path; we pass a same-origin relative URL.
   */
  function ctaHref(restaurantId: string): string {
    const to = `/${locale}/eat/r/${restaurantId}`
    if (!referralCode) return to
    return `/${locale}/ref/${encodeURIComponent(referralCode)}?to=${encodeURIComponent(to)}`
  }

  return (
    <div className="overflow-hidden rounded-grubano-xl border border-grubano-border bg-white shadow-grubano-sm">
      {/* Recipe photo */}
      <FoodImage name={recipe.name} src={recipe.photo} className="h-44 w-full" glyphClassName="text-6xl" />

      {/* Recipe info */}
      <div className="space-y-2 px-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg font-extrabold text-grubano-ink">{recipe.name}</h3>
          {recipe.cuisineType && (
            <Badge tone="neutral" size="sm">
              {recipe.cuisineType}
            </Badge>
          )}
        </div>
        {recipe.description && (
          <p className="line-clamp-3 text-grubano-sm leading-relaxed text-grubano-ink-muted">{recipe.description}</p>
        )}
      </div>

      {/* Served-at CTAs (anti-cannibalisation: send to the adopting restaurant) */}
      <div className="space-y-2 p-4 pt-3">
        {recipe.servedAt.length === 0 ? (
          <p className="rounded-grubano-md bg-grubano-surface-muted px-3 py-2.5 text-center text-xs font-medium text-grubano-ink-muted">
            <Utensils size={13} className="mr-1 inline" />
            {t('soonNearYou')}
          </p>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-grubano-ink-faint">
              {t('orderFrom')}
            </p>
            {recipe.servedAt.map((r) => (
              <Link
                key={r.id}
                href={ctaHref(r.id)}
                className="flex items-center gap-3 rounded-grubano-md border border-grubano-border bg-white px-3.5 py-3 text-left transition-colors hover:bg-grubano-tint active:scale-[0.98]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-grubano-tint">
                  <Store size={18} className="text-grubano-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-grubano-sm font-bold text-grubano-ink">{r.name}</p>
                  <p className="truncate text-[11px] text-grubano-ink-muted">{r.city}</p>
                </div>
                <span className="text-grubano-sm font-extrabold text-grubano-primary">
                  {r.sellingPrice.toFixed(2)} €
                </span>
                <ChevronRight size={16} className="text-grubano-ink-faint" />
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
