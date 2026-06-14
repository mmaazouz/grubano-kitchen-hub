'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import {
  BadgeCheck, Instagram, Youtube, Store, MapPin, Crosshair, Loader2,
  ChevronRight, Utensils, ChefHat, Clock, ChevronDown, ChevronUp, BookOpen, Megaphone,
} from 'lucide-react'
import { EmptyState, Badge, Skeleton } from '@/components/design-system'
import { StarBadge } from '@/components/creators/StarBadge'
import InfluencerPublicView from '@/components/chef/InfluencerPublicView'
import FoodImage from '@/components/eat/FoodImage'
import { getFoodImage, inferCategory } from '@/lib/food-images'
import { useGeolocation } from '@/lib/use-geolocation'
import { haversineKm } from '@/lib/geocode'

// ── <ChefPublicPage /> — the public chef page island (Mission 1) ──────────────
//
// Consumes the EXTENDED GET /api/creators/public/[slug] (lat/lng + social
// proof volumes). KEY DIFFERENCES vs the legacy /eat/c page:
//   - NO referral code displayed (the affiliation code is the influencer's
//     tool — the chef's audience funnel is their partner restaurants),
//   - every "Commander" CTA goes through /api/chef-visit/{slug}?to=… (the
//     CONTRIBUTION cookie, 24 h last-touch, zero financial impact) — NEVER
//     through /ref (which would create a ReferralOrder),
//   - partner restaurants FIRST (the pivot's heart), with opt-in geolocation
//     proximity sort (useGeolocation pattern — button, never automatic).

interface ServedAt {
  id:           string
  name:         string
  city:         string
  lat:          number | null
  lng:          number | null
  sellingPrice: number
  menuItemId:   string | null
}
interface ChefRecipe {
  id:               string
  name:             string
  description:      string
  photo:            string | null
  cuisineType:      string
  servedAt:         ServedAt[]
  salesCount:       number
  restaurantsCount: number
  // Mission 6 — PUBLIC face of the sheet only (D1): story/diet/timing/level.
  publicSheet?: {
    story:       string | null
    dietTags:    string[]
    prepMinutes: number | null
    cookMinutes: number | null
    difficulty:  string | null
  } | null
  // Promo V2 Slice 2 — live demand-driver campaign (null = none).
  campaign?: {
    message: string
    suggestedDiscountPct: number
    endsAt: string
    participants: Array<{ id: string; name: string; city: string }>
  } | null
}
interface ChefProfile {
  name:             string
  bio:              string | null
  followers:        number
  verified:         boolean
  stars?:           number
  instagram:        string | null
  tiktok:           string | null
  youtube:          string | null
  slug:             string | null
  recipes:          ChefRecipe[]
  totalSales:       number
  totalRestaurants: number
  // Mission 14B — role flags (tolerant; absent → both true → chef view).
  roles?:           { isChef: boolean; isInfluencer: boolean }
}

interface PartnerRestaurant {
  id:      string
  name:    string
  city:    string
  lat:     number | null
  lng:     number | null
  recipes: Array<{ name: string; price: number }>
}

function formatFollowers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

/**
 * Photo fallback (complément M1): EVERY CreatorDish in the current dataset
 * has photo=null — the design-system food catalogue (Agent 6's 85 photos,
 * getFoodImage keyed by category + stable id) is the NOMINAL source, never a
 * grey card nor an empty hero. Used by the hero AND the recipe cards.
 */
function recipePhoto(r: ChefRecipe): string {
  return r.photo || getFoodImage(inferCategory(r.cuisineType || r.name), r.id)
}

function socialUrl(kind: 'instagram' | 'tiktok' | 'youtube', handle: string): string {
  if (/^https?:\/\//i.test(handle)) return handle
  const h = handle.replace(/^@/, '').trim()
  if (kind === 'instagram') return `https://instagram.com/${h}`
  if (kind === 'tiktok') return `https://tiktok.com/@${h}`
  return `https://youtube.com/@${h}`
}

function TikTokIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.6 6.7a5.4 5.4 0 0 1-3.2-1.1A5.4 5.4 0 0 1 14.6 2H11v13.7a2.5 2.5 0 1 1-1.8-2.4V9.5a6.2 6.2 0 1 0 5.4 6.1V9.4a8.8 8.8 0 0 0 5 1.5V6.7z" />
    </svg>
  )
}

/** Mission 6 — the PUBLIC face of a recipe (D1): diet tags, total time,
 *  difficulty, and the story behind a sober accordion. Strictly non-technical. */
function RecipePublicFace({
  face,
}: {
  face: { story: string | null; dietTags: string[]; prepMinutes: number | null; cookMinutes: number | null; difficulty: string | null }
}) {
  const t  = useTranslations('chef')
  const td = useTranslations('creators.difficulty')
  const [openStory, setOpenStory] = useState(false)
  const totalMin = (face.prepMinutes ?? 0) + (face.cookMinutes ?? 0)
  const hasMeta = face.dietTags.length > 0 || totalMin > 0 || Boolean(face.difficulty)
  if (!hasMeta && !face.story) return null
  return (
    <div className="mt-2 space-y-2">
      {hasMeta && (
        <div className="flex flex-wrap items-center gap-1.5">
          {face.difficulty && <Badge>{td(face.difficulty)}</Badge>}
          {totalMin > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-grubano-ink-muted">
              <Clock size={11} /> {t('recipeTime', { min: totalMin })}
            </span>
          )}
          {face.dietTags.map((d) => <Badge key={d}>{d}</Badge>)}
        </div>
      )}
      {face.story && (
        <div className="rounded-grubano-lg border border-grubano-border bg-grubano-surface">
          <button
            type="button"
            onClick={() => setOpenStory((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-grubano-ink-muted"
          >
            <BookOpen size={12} className="text-grubano-primary" /> {t('storyTitle')}
            {openStory ? <ChevronUp size={12} className="ms-auto" /> : <ChevronDown size={12} className="ms-auto" />}
          </button>
          {openStory && (
            <p className="whitespace-pre-line border-t border-grubano-border px-3 py-2.5 text-[12px] leading-relaxed text-grubano-ink-muted">
              {face.story}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChefPublicPage({ slug }: { slug: string }) {
  const t  = useTranslations('chef')
  const tc = useTranslations('eat.creator')
  const locale = useLocale()

  const [profile, setProfile] = useState<ChefProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Restaurateur CTA target — resolved from the session role (plain REST call,
  // no SessionProvider needed on this standalone public tree).
  const [isResto, setIsResto] = useState(false)

  const { coords, status: geoStatus, request: requestGeo } = useGeolocation()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/creators/public/${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) { if (!cancelled) setNotFound(true); return null }
        return r.json() as Promise<ChefProfile>
      })
      .then((d) => { if (!cancelled && d) setProfile(d) })
      .catch(() => { if (!cancelled) setNotFound(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled) return
        const role = (s?.user as { role?: string } | undefined)?.role
        setIsResto(role === 'restaurant' || role === 'admin')
      })
      .catch(() => { /* anonymous → partner space */ })
    return () => { cancelled = true }
  }, [])

  // ── The contribution CTA — every order funnel goes through /api/chef-visit
  // (grubano_chef cookie). Plain <a>: a full navigation is required for the
  // Set-Cookie + redirect chain.
  const chefSlug = profile?.slug ?? slug
  const orderHref = (restaurantId: string) =>
    `/api/chef-visit/${encodeURIComponent(chefSlug)}?to=${encodeURIComponent(`/${locale}/eat/r/${restaurantId}`)}`

  // ── Partner restaurants — deduped across every recipe (the pivot's heart) ──
  const partners = useMemo<PartnerRestaurant[]>(() => {
    if (!profile) return []
    const map = new Map<string, PartnerRestaurant>()
    for (const r of profile.recipes) {
      for (const s of r.servedAt) {
        const existing = map.get(s.id)
        if (existing) {
          existing.recipes.push({ name: r.name, price: s.sellingPrice })
        } else {
          map.set(s.id, {
            id: s.id, name: s.name, city: s.city, lat: s.lat, lng: s.lng,
            recipes: [{ name: r.name, price: s.sellingPrice }],
          })
        }
      }
    }
    return Array.from(map.values())
  }, [profile])

  // Proximity sort (opt-in geo): restos WITH coords by distance, the geo-less
  // tail by city; without geo → city sort. NOTE: ~50 % of the current adopter
  // restaurants have NO lat/lng (Resto Test included) — the city fallback is
  // the NOMINAL path of today's dataset, not an edge case (complément M1).
  const sortedPartners = useMemo(() => {
    const byCity = (a: PartnerRestaurant, b: PartnerRestaurant) =>
      (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name)
    if (!coords) return [...partners].sort(byCity)
    const withGeo = partners.filter((p) => p.lat != null && p.lng != null)
    const noGeo   = partners.filter((p) => p.lat == null || p.lng == null)
    const dist = (p: PartnerRestaurant) =>
      haversineKm({ latitude: coords.lat, longitude: coords.lng }, { latitude: p.lat as number, longitude: p.lng as number })
    withGeo.sort((a, b) => dist(a) - dist(b))
    noGeo.sort(byCity)
    return [...withGeo, ...noGeo]
  }, [partners, coords])

  const distanceLabel = (p: PartnerRestaurant): string | null => {
    if (!coords || p.lat == null || p.lng == null) return null
    const km = haversineKm({ latitude: coords.lat, longitude: coords.lng }, { latitude: p.lat, longitude: p.lng })
    return t('distanceKm', { km: km < 10 ? km.toFixed(1).replace('.', ',') : String(Math.round(km)) })
  }

  const specialties = useMemo(
    () => Array.from(new Set((profile?.recipes ?? []).map((r) => r.cuisineType).filter(Boolean))),
    [profile],
  )

  // ── Shells ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (notFound || !profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-12">
        <EmptyState
          emoji="🤔"
          title={tc('notFoundTitle')}
          description={tc('notFoundDescription')}
          action={
            <Link
              href="/eat"
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white"
            >
              {tc('backToBrowse')}
            </Link>
          }
        />
      </div>
    )
  }

  // Mission 14B — a PURE influencer (isInfluencer && !isChef) is NOT a "chef
  // créateur": render the honest ambassador profile (no recipe/partner sections,
  // no chef label). Missing roles (pre-db-push) → both true → the chef view below.
  if (profile.roles && profile.roles.isInfluencer && !profile.roles.isChef) {
    return <InfluencerPublicView profile={profile} />
  }

  const heroPhoto = profile.recipes[0] ? recipePhoto(profile.recipes[0]) : null
  const showProof = profile.totalSales > 0 || profile.totalRestaurants > 0

  return (
    <div className="min-h-screen bg-grubano-bg pb-16">
      {/* ── 1. IDENTITÉ ─────────────────────────────────────────────────────── */}
      <div className="relative">
        {heroPhoto ? (
          <FoodImage name={profile.name} src={heroPhoto} className="h-44 w-full" glyphClassName="text-6xl" />
        ) : (
          <div className="h-44 w-full bg-gradient-to-br from-grubano-primary/80 to-grubano-primary/40" />
        )}
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute -bottom-8 start-5 grid h-16 w-16 place-items-center rounded-2xl border-4 border-grubano-bg bg-grubano-primary text-2xl font-extrabold text-white shadow-md">
          {profile.name.charAt(0).toUpperCase()}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-11">
        <p className="text-[11px] font-bold uppercase tracking-wider text-grubano-primary">{t('heroTagline')}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{profile.name}</h1>
          {profile.verified && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-grubano-primary">
              <BadgeCheck size={15} /> {tc('verifiedBadge')}
            </span>
          )}
          {/* ⭐ Étoiles Grubano (Mission 4) — absent when 0 (absence = signal). */}
          <StarBadge stars={profile.stars ?? 0} size={15} />
        </div>
        <p className="mt-0.5 text-[12px] text-grubano-ink-muted">
          {tc('followers', { count: formatFollowers(profile.followers) })}
        </p>
        {profile.bio && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-grubano-ink-muted">{profile.bio}</p>
        )}

        {specialties.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">{t('specialties')}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {specialties.map((s) => <Badge key={s}>{s}</Badge>)}
            </div>
          </div>
        )}

        {/* Socials — NO referral code here (pivot: that's the influencer tool). */}
        {(profile.instagram || profile.tiktok || profile.youtube) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.instagram && (
              <a href={socialUrl('instagram', profile.instagram)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-grubano-border bg-white px-3 py-1.5 text-[11px] font-semibold text-grubano-ink-muted">
                <Instagram size={13} /> Instagram
              </a>
            )}
            {profile.tiktok && (
              <a href={socialUrl('tiktok', profile.tiktok)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-grubano-border bg-white px-3 py-1.5 text-[11px] font-semibold text-grubano-ink-muted">
                <TikTokIcon size={13} /> TikTok
              </a>
            )}
            {profile.youtube && (
              <a href={socialUrl('youtube', profile.youtube)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-grubano-border bg-white px-3 py-1.5 text-[11px] font-semibold text-grubano-ink-muted">
                <Youtube size={13} /> YouTube
              </a>
            )}
          </div>
        )}

        {/* ── 2. PREUVES SOCIALES — hidden at zero (never "0 vente") ─────────── */}
        {showProof && (
          <p className="mt-4 rounded-grubano-lg bg-grubano-tint px-3.5 py-2.5 text-[13px] font-bold text-grubano-primary">
            {t('proofBanner', { sales: profile.totalSales, restaurants: profile.totalRestaurants })}
          </p>
        )}

        {/* ── 3. SES RESTAURANTS PARTENAIRES (the pivot's heart) ─────────────── */}
        <section id="partenaires" className="mt-7 scroll-mt-16">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-extrabold text-grubano-ink">{t('partnersTitle')}</h2>
              <p className="text-[12px] text-grubano-ink-muted">{t('partnersSubtitle')}</p>
            </div>
            {partners.length > 1 && geoStatus !== 'granted' && (
              <button
                type="button"
                onClick={requestGeo}
                disabled={geoStatus === 'requesting'}
                className="inline-flex items-center gap-1.5 rounded-full border border-grubano-border bg-white px-3 py-1.5 text-[11px] font-bold text-grubano-primary disabled:opacity-60"
              >
                {geoStatus === 'requesting' ? <Loader2 size={12} className="animate-spin" /> : <Crosshair size={12} />}
                {t('sortGeoCta')}
              </button>
            )}
            {geoStatus === 'granted' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-grubano-success">
                <Crosshair size={11} /> {t('sortGeoActive')}
              </span>
            )}
          </div>
          {geoStatus === 'denied' && (
            <p className="mt-1 text-[11px] text-grubano-ink-faint">{t('sortGeoDenied')}</p>
          )}

          {sortedPartners.length === 0 ? (
            <p className="mt-3 rounded-grubano-lg border border-dashed border-grubano-border bg-white px-3 py-6 text-center text-[12px] text-grubano-ink-muted">
              {t('noPartnersYet')}
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {sortedPartners.map((p) => {
                const dist = distanceLabel(p)
                return (
                  <div key={p.id} className="rounded-grubano-xl border border-grubano-border bg-white p-4 shadow-grubano-sm">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-grubano-tint text-grubano-primary">
                        <Store size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-extrabold text-grubano-ink">{p.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-grubano-ink-muted">
                          <span className="inline-flex items-center gap-1"><MapPin size={11} /> {p.city}</span>
                          {dist && <span className="font-semibold text-grubano-primary">{dist}</span>}
                          <span>{t('servesRecipes', { count: p.recipes.length })}</span>
                        </p>
                        <p className="mt-1 truncate text-[11px] text-grubano-ink-faint">
                          {p.recipes.map((r) => r.name).join(' · ')}
                        </p>
                      </div>
                      <a
                        href={orderHref(p.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-grubano-lg bg-grubano-primary px-3.5 py-2 text-[12px] font-bold text-white active:scale-95"
                      >
                        {t('orderCta')} <ChevronRight size={13} className="rtl:rotate-180" />
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── 4. PORTFOLIO ───────────────────────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="font-display text-base font-extrabold text-grubano-ink">{t('portfolioTitle')}</h2>
          <div className="mt-3 space-y-4">
            {profile.recipes.map((r) => (
              <div key={r.id} className="overflow-hidden rounded-grubano-xl border border-grubano-border bg-white shadow-grubano-sm">
                <FoodImage name={r.name} src={recipePhoto(r)} className="h-40 w-full" glyphClassName="text-5xl" />
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-extrabold text-grubano-ink">{r.name}</h3>
                    <Badge>{r.cuisineType}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-grubano-ink-muted">{r.description}</p>

                  {/* Promo V2 Slice 2 — live campaign highlight (badge + chef
                      message + discount + participating restaurants). */}
                  {r.campaign && (
                    <div className="mt-2 rounded-grubano-lg border border-grubano-primary/40 bg-grubano-primary/5 p-3">
                      <div className="flex items-center gap-1.5">
                        <Megaphone size={13} className="text-grubano-primary" />
                        <span className="text-[12px] font-bold text-grubano-primary">
                          {t('campaignBadge', { pct: r.campaign.suggestedDiscountPct })}
                        </span>
                      </div>
                      {r.campaign.message && (
                        <p className="mt-1 text-[12px] italic text-grubano-ink-muted">« {r.campaign.message} »</p>
                      )}
                      {r.campaign.participants.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">
                            {t('campaignParticipants', { count: r.campaign.participants.length })}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {r.campaign.participants.map((p) => (
                              <Link key={p.id} href={`/eat/r/${p.id}`}
                                className="inline-flex items-center gap-1 rounded-grubano-pill border border-grubano-primary/30 bg-white px-2 py-0.5 text-[11px] font-semibold text-grubano-primary active:scale-95">
                                {p.name} <ChevronRight size={10} className="rtl:rotate-180" />
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Mission 6 — PUBLIC face only (D1): diet tags, timing,
                      difficulty + the story in a sober accordion. NOTHING
                      technical ever reaches this page. */}
                  {r.publicSheet && (
                    <RecipePublicFace face={r.publicSheet} />
                  )}

                  {r.servedAt.length === 0 ? (
                    <p className="mt-3 rounded-grubano-lg bg-grubano-surface-muted px-3 py-2 text-[12px] text-grubano-ink-muted">
                      {tc('soonNearYou')}
                    </p>
                  ) : (
                    <div className="mt-3 space-y-1.5">
                      {r.servedAt.map((s) => (
                        <a
                          key={s.id}
                          href={orderHref(s.id)}
                          className="flex items-center gap-2.5 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 active:scale-[0.99]"
                        >
                          <Utensils size={14} className="shrink-0 text-grubano-primary" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-grubano-ink">
                            {tc('orderFrom')} {s.name}
                            <span className="ms-1 text-[11px] font-normal text-grubano-ink-faint">· {s.city}</span>
                          </span>
                          <span className="shrink-0 text-[13px] font-extrabold text-grubano-primary">
                            {s.sellingPrice.toFixed(2).replace('.', ',')} €
                          </span>
                          <ChevronRight size={14} className="shrink-0 text-grubano-ink-faint rtl:rotate-180" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 5. DOUBLE CTA — selling dishes to guests, recipes to restaurateurs */}
        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <a
            href="#partenaires"
            className="rounded-grubano-xl border border-grubano-border bg-white p-4 shadow-grubano-sm transition-colors hover:border-grubano-primary"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-grubano-tint text-grubano-primary">
              <Utensils size={17} />
            </span>
            <p className="mt-2 text-[14px] font-extrabold text-grubano-ink">{t('ctaClientTitle')}</p>
            <p className="mt-0.5 text-[11px] text-grubano-ink-muted">{t('ctaClientBody')}</p>
            <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-grubano-primary">
              {t('ctaClientBtn')} <ChevronRight size={13} className="rtl:rotate-180" />
            </span>
          </a>
          <Link
            href={isResto ? '/menu?tab=adopt' : '/business/start'}
            className="rounded-grubano-xl border border-grubano-border bg-white p-4 shadow-grubano-sm transition-colors hover:border-grubano-primary"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-grubano-tint text-grubano-primary">
              <ChefHat size={17} />
            </span>
            <p className="mt-2 text-[14px] font-extrabold text-grubano-ink">{t('ctaRestoTitle')}</p>
            <p className="mt-0.5 text-[11px] text-grubano-ink-muted">{t('ctaRestoBody')}</p>
            <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-grubano-primary">
              {t('ctaRestoBtn')} <ChevronRight size={13} className="rtl:rotate-180" />
            </span>
          </Link>
        </section>
      </div>
    </div>
  )
}
