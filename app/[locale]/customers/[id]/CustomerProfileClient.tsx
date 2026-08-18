'use client'

/**
 * <CustomerProfileClient/> — operator FICHE CLIENT (CD « Fiche client », detail).
 *
 * 🔒 Receives a MASKED, CONTACT-FREE profile (no email/phone/address). Renders the
 * CD: hero + privacy banner + relation KPIs + preferences + loyalty ladder + recent
 * history with a PER-ORDER allergen banner (food safety — never a stored health
 * profile) + an internal team note. The « Offrir des points » and « Message via
 * Grubano » actions are inactive (feature not built) with a "bientôt" tooltip.
 */

import { useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import type { CustomerProfile } from '@/lib/customer-scope'
import { customerAvatarGradient } from '@/lib/customer-avatar'

const TIER_CLASS: Record<string, string> = {
  bronze: 'bronze', silver: 'silver', gold: 'gold', platine: 'plat', platinum: 'plat',
}
const LADDER = [
  { key: 'bronze', min: 0 },
  { key: 'silver', min: 100 },
  { key: 'gold', min: 200 },
  { key: 'platine', min: 400 },
] as const

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
}

export default function CustomerProfileClient({ profile }: { profile: CustomerProfile }) {
  const t = useTranslations('operator')
  const locale = useLocale()

  const eur = (cents: number) => (cents / 100).toLocaleString(locale, { style: 'currency', currency: 'EUR' })
  const monthYear = (iso: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(iso))
  const dayMonth = (iso: string) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(iso))
  const fullDate = (iso: string) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))

  // Relative "last visit" (days) — Intl, no fabricated string.
  const relDays = (iso: string | null): string => {
    if (!iso) return '—'
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (days <= 0) return rtf.format(0, 'day')
    return rtf.format(-days, 'day')
  }
  const monthsSince = (iso: string): number =>
    Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / (30 * 86_400_000)))

  const tierClass = TIER_CLASS[profile.tier] ?? 'bronze'
  const tierName = t(`customers.tier.${tierClass === 'plat' ? 'platinum' : tierClass}`)
  const isLoyal = ['gold', 'plat'].includes(tierClass) || profile.ordersCount >= 10

  // Loyalty ladder — real thresholds. Progress toward the next tier.
  const ladder = useMemo(() => {
    const pts = profile.pointsBalance
    const nextIdx = LADDER.findIndex((l) => l.min > pts)
    if (nextIdx === -1) return { pct: 100, toNext: 0, nextKey: null as string | null }
    const prevMin = LADDER[nextIdx - 1]?.min ?? 0
    const nextMin = LADDER[nextIdx]!.min
    const pct = Math.max(4, Math.min(100, Math.round(((pts - prevMin) / (nextMin - prevMin)) * 100)))
    return { pct, toNext: nextMin - pts, nextKey: LADDER[nextIdx]!.key }
  }, [profile.pointsBalance])

  const modeLabel = (m: string | null) =>
    m === 'pickup' ? t('customerProfile.modePickup') : t('customerProfile.modeDelivery')
  const modeIcon = (m: string | null) => (m === 'pickup' ? 'shopping_bag' : 'local_shipping')

  // The most recent order carrying a dietary note → the per-order allergen banner.
  const allergenOrder = profile.recent.find((r) => r.dietaryNote.length > 0)

  return (
    <section className="cp-root">
      <nav className="crumb">
        <Link href="/customers">{t('customers.title')}</Link>
        <span className="ms flip-rtl" aria-hidden="true">chevron_right</span>
        <span className="cur">{profile.name}</span>
      </nav>

      {/* ── Hero / identity ── */}
      <div className="card hero">
        {/* color per CLIENT from LoyaltyCustomer.id — same derivation as the list
            (decision F): same id → same color on both screens. */}
        <span className="hero__av" style={{ background: customerAvatarGradient(profile.id) }}>{initials(profile.name)}</span>
        <div className="hero__m">
          <div className="hero__name">
            <h1>{profile.name}</h1>
            <span className={`tier ${tierClass}`}>
              {tierClass === 'gold' ? <span className="ms" aria-hidden="true">workspace_premium</span> : null}
              {tierName}
            </span>
            {isLoyal && (
              <span className="loyal-badge"><span className="ms" aria-hidden="true">favorite</span>{t('customerProfile.loyalCustomer')}</span>
            )}
          </div>
          <div className="hero__sub">
            <span>{t('customers.since', { date: monthYear(profile.memberSince) })}</span>
            <span className="dot" />
            <span>{t('customerProfile.ordersHere', { count: profile.ordersCount })}</span>
            {profile.lastOrderAt && (<><span className="dot" /><span>{t('customerProfile.lastInline', { rel: relDays(profile.lastOrderAt) })}</span></>)}
          </div>
        </div>
        <div className="hero__actions">
          <button type="button" className="btn-primary" disabled title={t('customerProfile.soon')} aria-disabled="true">
            <span className="ms" aria-hidden="true">card_giftcard</span>{t('customerProfile.offerPoints')}
          </button>
          <button type="button" className="btn-ghost" disabled title={t('customerProfile.soon')} aria-disabled="true">
            <span className="ms" aria-hidden="true">sms</span>{t('customerProfile.message')}
          </button>
        </div>
      </div>

      {/* ── Privacy reassurance ── */}
      <div className="privacy">
        <span className="ms" aria-hidden="true">verified_user</span>
        <div><b>{t('customerProfile.privacyTitle')}</b> {t('customerProfile.privacyBody')}</div>
      </div>

      <div className="grid">
        {/* ── Left: relation + preferences ── */}
        <div>
          <div className="sec-t"><span className="ms" aria-hidden="true">insights</span>{t('customerProfile.relation')}</div>
          <div className="kpis">
            <div className="kpi"><div className="l"><span className="ms" aria-hidden="true">receipt_long</span>{t('customerProfile.kOrders')}</div><div className="v">{profile.ordersCount.toLocaleString(locale)}</div><div className="s">{t('customerProfile.kOrdersSub')}</div></div>
            <div className="kpi"><div className="l"><span className="ms" aria-hidden="true">euro</span>{t('customerProfile.kAvg')}</div><div className="v">{profile.ordersCount > 0 ? eur(profile.avgBasketCents) : '—'}</div><div className="s">{t('customerProfile.kAvgSub')}</div></div>
            <div className="kpi"><div className="l"><span className="ms" aria-hidden="true">calendar_month</span>{t('customerProfile.kSince')}</div><div className="v sm">{monthYear(profile.memberSince)}</div><div className="s">{t('customerProfile.monthsSub', { n: monthsSince(profile.memberSince) })}</div></div>
            <div className="kpi"><div className="l"><span className="ms" aria-hidden="true">schedule</span>{t('customerProfile.kLast')}</div><div className="v sm">{profile.lastOrderAt ? relDays(profile.lastOrderAt) : '—'}</div><div className="s">{profile.lastOrderAt ? fullDate(profile.lastOrderAt) : ''}</div></div>
          </div>

          <div className="sec-t mt"><span className="ms" aria-hidden="true">tune</span>{t('customerProfile.preferences')}</div>
          <div className="card pad">
            {profile.favorites.length > 0 ? (
              <div className="chips">
                {profile.favorites.map((f) => (
                  <span key={f.name} className="chip"><span className="ms" aria-hidden="true">restaurant</span>{f.name}<span className="ct">×{f.count}</span></span>
                ))}
              </div>
            ) : (
              <p className="muted-line">{t('customerProfile.noFavorites')}</p>
            )}
            {profile.usualMode && (
              <div className="mode-row">
                <span className="ic"><span className="ms" aria-hidden="true">{modeIcon(profile.usualMode)}</span></span>
                <div><b>{modeLabel(profile.usualMode)}</b><span>{t('customerProfile.usualModeSub')}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: loyalty + history ── */}
        <div>
          <div className="sec-t"><span className="ms" aria-hidden="true">workspace_premium</span>{t('customerProfile.loyalty')}</div>
          <div className="card pad">
            <div className="loy__top">
              <div className="loy__pts">{profile.pointsBalance.toLocaleString(locale)} <small>{t('customerProfile.points')}</small></div>
              <span className={`tier ${tierClass}`}>{tierClass === 'gold' ? <span className="ms" aria-hidden="true">workspace_premium</span> : null}{tierName}</span>
            </div>
            <div className="loy__bar"><i style={{ width: `${ladder.pct}%` }} /></div>
            <div className="loy__scale">
              {LADDER.map((l) => (
                <span key={l.key} className={TIER_CLASS[profile.tier] === (TIER_CLASS[l.key] ?? l.key) ? 'now' : undefined}>
                  {t(`customers.tier.${l.key === 'platine' ? 'platinum' : l.key}`)}
                </span>
              ))}
            </div>
            <div className="loy__next">
              <span className="ms" aria-hidden="true">arrow_circle_up</span>
              {ladder.nextKey
                ? t('customerProfile.toNext', { pts: ladder.toNext, tier: t(`customers.tier.${ladder.nextKey === 'platine' ? 'platinum' : ladder.nextKey}`) })
                : t('customerProfile.maxTier')}
            </div>
          </div>

          <div className="sec-t mt"><span className="ms" aria-hidden="true">history</span>{t('customerProfile.history')}</div>
          <div className="card pad">
            {profile.recent.length > 0 ? (
              profile.recent.map((o, i) => (
                <div className="oh-row" key={i}>
                  <span className="oh-date">{dayMonth(o.at)}</span>
                  <div className="oh-m">
                    <b>{o.itemsPreview}</b>
                    <span className="oh-mode"><span className="ms" aria-hidden="true">{modeIcon(o.mode)}</span>{modeLabel(o.mode)}</span>
                  </div>
                  <span className="oh-amt">{eur(o.amountCents)}</span>
                </div>
              ))
            ) : (
              <p className="muted-line">{t('customerProfile.historyEmpty')}</p>
            )}

            {allergenOrder && (
              <div className="allergen">
                <span className="ms" aria-hidden="true">warning</span>
                <div className="allergen__m">
                  <b>{t('customerProfile.allergenTitle', { date: dayMonth(allergenOrder.at) })}</b>
                  <span>{allergenOrder.dietaryNote.join(', ')}</span>
                  <span className="allergen__scope"><span className="ms" aria-hidden="true">info</span>{t('customerProfile.allergenScope')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Internal team note — feature not built yet (honest « bientôt »). ── */}
      <div className="sec-t mt">
        <span className="ms" aria-hidden="true">sticky_note_2</span>{t('customerProfile.note')}
        <span className="sec-t__soft">· {t('customerProfile.noteScope')}</span>
      </div>
      <div className="note-box note-box--soon">
        <span className="ms" aria-hidden="true">schedule</span>{t('customerProfile.noteSoon')}
      </div>
    </section>
  )
}
