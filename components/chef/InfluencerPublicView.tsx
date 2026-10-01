'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { BadgeCheck, Instagram, Youtube, Utensils, ChevronRight } from 'lucide-react'
import { StarBadge } from '@/components/creators/StarBadge'

// ── <InfluencerPublicView /> — Mission 14B ────────────────────────────────────
//
// The PUBLIC page for a PURE influencer (isInfluencer && !isChef). An influencer
// does NOT create recipes — their value is their AUDIENCE. So we drop every chef
// section (partner restaurants, recipe portfolio, "adopt my recipes" CTA) and
// the "Chef créateur" label, and present an honest AMBASSADOR profile: identity
// + socials + a single CTA to discover the restaurants on Grubano. A chef or a
// chef+influencer keeps the full <ChefPublicPage /> (unchanged).
//
// Recommended-restaurants list (from the influencer's ReferralOrder history) is
// a noted follow-up — kept out here to avoid reading affiliation data; the CTA
// is a generic "discover the restaurants" funnel for now.

export interface InfluencerProfile {
  name:      string
  bio:       string | null
  followers: number
  verified:  boolean
  stars?:    number
  instagram: string | null
  tiktok:    string | null
  youtube:   string | null
}

function socialUrl(kind: 'instagram' | 'tiktok' | 'youtube', handle: string): string {
  if (/^https?:\/\//i.test(handle)) return handle
  const h = handle.replace(/^@/, '').trim()
  if (kind === 'instagram') return `https://instagram.com/${h}`
  if (kind === 'tiktok') return `https://tiktok.com/@${h}`
  return `https://youtube.com/@${h}`
}

function formatFollowers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

function TikTokIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.6 6.7a5.4 5.4 0 0 1-3.2-1.1A5.4 5.4 0 0 1 14.6 2H11v13.7a2.5 2.5 0 1 1-1.8-2.4V9.5a6.2 6.2 0 1 0 5.4 6.1V9.4a8.8 8.8 0 0 0 5 1.5V6.7z" />
    </svg>
  )
}

export default function InfluencerPublicView({ profile }: { profile: InfluencerProfile }) {
  const t  = useTranslations('chef')
  const tc = useTranslations('eat.creator')
  // "Corrige le compteur abonnés vide" — only show the count when it is real.
  const showFollowers = Number.isFinite(profile.followers) && profile.followers > 0

  return (
    <div className="min-h-screen bg-grubano-bg pb-16">
      {/* ── IDENTITÉ ────────────────────────────────────────────────────────── */}
      <div className="relative">
        <div className="h-44 w-full bg-gradient-to-br from-grubano-primary/80 to-grubano-primary/40" />
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute -bottom-8 start-5 grid h-16 w-16 place-items-center rounded-2xl border-4 border-grubano-bg bg-grubano-primary text-2xl font-extrabold text-white shadow-md">
          {profile.name.charAt(0).toUpperCase()}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-11">
        {/* Influencer label — NOT "Chef créateur". */}
        <p className="text-[11px] font-bold uppercase tracking-wider text-grubano-primary">{t('influencerTagline')}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{profile.name}</h1>
          {profile.verified && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-grubano-primary">
              <BadgeCheck size={15} /> {tc('verifiedBadge')}
            </span>
          )}
          <StarBadge stars={profile.stars ?? 0} size={15} />
        </div>
        {showFollowers && (
          <p className="mt-0.5 text-[12px] text-grubano-ink-muted">
            {tc('followers', { count: formatFollowers(profile.followers) })}
          </p>
        )}
        {profile.bio && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-grubano-ink-muted">{profile.bio}</p>
        )}

        {/* Socials — the influencer's reach (no referral code, no recipes). */}
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

        {/* ── AMBASSADEUR — honest framing + a single discovery CTA ──────────── */}
        <section className="mt-7">
          <div className="rounded-grubano-xl border border-grubano-border bg-white p-5 shadow-grubano-sm">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-grubano-tint text-grubano-primary">
              <Utensils size={18} />
            </span>
            <h2 className="mt-2 font-display text-base font-extrabold text-grubano-ink">{t('influencerPitchTitle')}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-grubano-ink-muted">{t('influencerPitchBody')}</p>
            <Link
              href="/eat"
              className="mt-4 inline-flex items-center gap-1.5 rounded-grubano-lg bg-grubano-primary px-4 py-2.5 text-sm font-bold text-white active:scale-95"
            >
              {t('influencerCtaBtn')} <ChevronRight size={15} className="rtl:rotate-180" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
