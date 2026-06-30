'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { getFoodImage, inferCategory } from '@/lib/food-images'
import { formatEuros } from '@/lib/format-money'
import { showToast } from '@/lib/eat-cart'
import './chef.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/c/[slug] — « Page chef » (consumer creator storefront) ───────────────
//
// VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-81dd « Page chef
// complète + fiche plat desktop »): cover (sunrise) + back → avatar (verified
// badge) + Suivre → name + place → stats (recettes / note / abonnés) → bio →
// « Ses recettes » grid. Renders INSIDE the EatShell nav shell (page content
// only — never duplicates the rail / top-bar / bottom-nav).
//
// REAL DATA (unchanged source): GET /api/creators/public/[slug] (the same
// payload the legacy /chef island consumes) — chef name / verified / followers /
// stars / bio / recipes (name, price, photo, cuisine, servedAt). NOTHING is
// hardcoded; the CD mock's « Lucia Moretti / 18 € / 2,1k abonnés » placeholders
// are bound to the live profile. A recipe tile links to the restaurant serving it
// via the CONTRIBUTION rail (/api/chef-visit — pure stat, NEVER /ref / money).
//
// INERT (IA — « chantier backend après Wave 5 » per the CD note): the « Suivre »
// button (no follow backend yet) is a local visual toggle only. Empty / missing
// → the CD empty state.

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
  id:          string
  name:        string
  description: string
  photo:       string | null
  cuisineType: string
  servedAt:    ServedAt[]
  salesCount:       number
  restaurantsCount: number
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
  roles?:           { isChef: boolean; isInfluencer: boolean }
}

// Compact follower count (2 100 → « 2,1k »), locale-neutral comma like the CD ref.
function formatFollowers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

// Photo fallback: EVERY CreatorDish currently has photo=null → the DS food
// catalogue (getFoodImage keyed by category + stable id) is the nominal source.
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

export default function ChefStorefrontPage({
  params,
}: {
  params: { slug: string }
}) {
  const slug = params.slug
  const t = useTranslations('eat.chef')
  const locale = useLocale()
  const router = useRouter()

  const { status: authStatus } = useSession()
  const [profile, setProfile] = useState<ChefProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [following, setFollowing] = useState(false)
  const [followDelta, setFollowDelta] = useState(0) // optimistic ±1 on the displayed count
  const [followBusy, setFollowBusy] = useState(false)

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

  // Real follow state (P1-CHEF-FOLLOW) — does the session user follow this chef?
  useEffect(() => {
    let cancelled = false
    fetch(`/api/creators/${encodeURIComponent(slug)}/follow`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.following === 'boolean') setFollowing(d.following) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [slug])

  // Toggle follow — optimistic, reverts on error. A guest is sent to sign in.
  const toggleFollow = async () => {
    if (followBusy) return
    if (authStatus !== 'authenticated') { showToast(t('loginToFollow')); return }
    const next = !following
    setFollowing(next)
    setFollowDelta((d) => d + (next ? 1 : -1))
    setFollowBusy(true)
    try {
      const res = await fetch(`/api/creators/${encodeURIComponent(slug)}/follow`, { method: next ? 'POST' : 'DELETE' })
      if (!res.ok) throw new Error('follow_failed')
    } catch {
      setFollowing(!next)
      setFollowDelta((d) => d - (next ? 1 : -1))
    } finally {
      setFollowBusy(false)
    }
  }

  // Contribution rail — a recipe tile funnels to the restaurant serving it via
  // /api/chef-visit (grubano_chef cookie, pure stat). Plain href: a full
  // navigation is required for the Set-Cookie + redirect chain. NEVER /ref.
  const chefSlug = profile?.slug ?? slug
  const orderHref = (restaurantId: string) =>
    `/api/chef-visit/${encodeURIComponent(chefSlug)}?to=${encodeURIComponent(`/${locale}/eat/r/${restaurantId}`)}`

  // Place line — derived from the cities the chef's recipes are served in (real
  // data); omitted when none (never a hardcoded « Bologne, Italie »).
  const place = useMemo(() => {
    if (!profile) return ''
    const cities = Array.from(
      new Set(profile.recipes.flatMap((r) => r.servedAt.map((s) => s.city)).filter(Boolean)),
    )
    return cities.slice(0, 2).join(' · ')
  }, [profile])

  const initials = useMemo(() => {
    const n = profile?.name ?? ''
    return n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '🍽️'
  }, [profile])

  // ── loading skeleton — real layout, zero shift (foundation `.sk` primitive) ──
  if (loading) {
    return (
      <div className="gb gb-chef" aria-busy="true">
        <div className="sk ch-sk-cover" />
        <div className="ch-id">
          <div className="ch-idhead">
            <span className="sk ch-sk-av" />
          </div>
          <div className="ch-meta">
            <span className="sk sk-line lg" style={{ width: '55%' }} />
            <span className="sk sk-line sm" style={{ width: '40%', marginTop: 8 }} />
            <span className="sk sk-line" style={{ width: '85%', marginTop: 16 }} />
          </div>
        </div>
        <div className="ch-seclabel">{t('recipesTitle')}</div>
        <div className="ch-grid">
          {[0, 1, 2, 3].map((i) => <span key={i} className="sk" style={{ height: 150, borderRadius: 16 }} />)}
        </div>
      </div>
    )
  }

  // ── not found → CD empty state ───────────────────────────────────────────────
  if (notFound || !profile) {
    return (
      <div className="gb gb-chef">
        <div className="ch-empty" style={{ marginTop: 40 }}>
          <span className="ms" aria-hidden="true">person_search</span>
          <h2>{t('notFoundTitle')}</h2>
          <p>{t('notFoundBody')}</p>
          <Link href="/eat" className="ch-cta">
            <span className="ms" aria-hidden="true">restaurant</span>{t('backToBrowse')}
          </Link>
        </div>
      </div>
    )
  }

  const note = profile.stars && profile.stars > 0 ? profile.stars : null
  const showProof = profile.totalSales > 0 || profile.totalRestaurants > 0
  const THUMBS = ['t1', 't2', 't3']

  return (
    <div className="gb gb-chef">
      {/* ── cover (sunrise) + back ────────────────────────────────────────────── */}
      <div className="ch-cover">
        <button type="button" className="ch-back" onClick={() => router.back()} aria-label={t('back')}>
          <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
        </button>
      </div>

      {/* ── identity ──────────────────────────────────────────────────────────── */}
      <div className="ch-id">
        <div className="ch-idhead">
          <span className="chef__av">
            {initials}
            {profile.verified && (
              <span className="vrf" aria-label={t('verifiedBadge')}>
                <span className="ms" aria-hidden="true">check</span>
              </span>
            )}
          </span>
          <button
            type="button"
            className={`chef__follow${following ? ' is-following' : ''}`}
            aria-pressed={following}
            disabled={followBusy}
            onClick={toggleFollow}
          >
            {following && <span className="ms" aria-hidden="true">check</span>}
            {following ? t('following') : t('follow')}
          </button>
        </div>

        <div className="ch-meta">
          <p className="ch-tagline">{t('heroTagline')}</p>
          <h1 className="ch-name">{profile.name}</h1>
          {place && <div className="ch-place">{place}</div>}

          <div className="ch-stats">
            <div className="ch-stat">
              <b>{profile.recipes.length}</b> <span>{t('statRecipes')}</span>
            </div>
            {note && (
              <div className="ch-stat">
                <b>{note.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b>{' '}
                <span>{t('statNote')}</span>
              </div>
            )}
            <div className="ch-stat">
              <b><bdi>{formatFollowers(Math.max(0, profile.followers + followDelta))}</bdi></b> <span>{t('statFollowers')}</span>
            </div>
          </div>

          {profile.bio && <p className="ch-bio">{profile.bio}</p>}

          {/* social proof — volumes only, hidden at zero (never « 0 vente ») */}
          {showProof && (
            <div className="ch-proof">
              <span className="ms" aria-hidden="true">local_fire_department</span>
              {t('proofBanner', { sales: profile.totalSales, restaurants: profile.totalRestaurants })}
            </div>
          )}

          {/* socials */}
          {(profile.instagram || profile.tiktok || profile.youtube) && (
            <div className="ch-socials">
              {profile.instagram && (
                <a className="ch-soc" href={socialUrl('instagram', profile.instagram)} target="_blank" rel="noopener noreferrer">
                  <span className="ms" aria-hidden="true">photo_camera</span>Instagram
                </a>
              )}
              {profile.tiktok && (
                <a className="ch-soc" href={socialUrl('tiktok', profile.tiktok)} target="_blank" rel="noopener noreferrer">
                  <span className="ms" aria-hidden="true">music_note</span>TikTok
                </a>
              )}
              {profile.youtube && (
                <a className="ch-soc" href={socialUrl('youtube', profile.youtube)} target="_blank" rel="noopener noreferrer">
                  <span className="ms" aria-hidden="true">smart_display</span>YouTube
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── « Ses recettes » ──────────────────────────────────────────────────── */}
      <div className="ch-seclabel">{t('recipesTitle')}</div>
      {profile.recipes.length === 0 ? (
        <div className="ch-empty">
          <span className="ms" aria-hidden="true">restaurant_menu</span>
          <h2>{t('noRecipesTitle')}</h2>
          <p>{t('noRecipesBody')}</p>
        </div>
      ) : (
        <div className="ch-grid">
          {profile.recipes.map((r, i) => {
            const served = r.servedAt[0]
            const price = served ? formatEuros(served.sellingPrice, locale) : null
            const inner = (
              <>
                <div
                  className={`img ${r.photo ? 'has-photo' : THUMBS[i % 3]}`}
                  style={r.photo ? { backgroundImage: `url(${recipePhoto(r)})` } : undefined}
                />
                <b>{r.name}</b>
                {r.cuisineType && <span className="ct">{r.cuisineType}</span>}
                {price ? <span><bdi>{price}</bdi></span> : <span className="ct">{t('soonNearYou')}</span>}
              </>
            )
            // Served → contribution rail (full navigation). Not served → inert tile.
            return served ? (
              <a key={r.id} className="dchip" href={orderHref(served.id)}>{inner}</a>
            ) : (
              <div key={r.id} className="dchip">{inner}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}
