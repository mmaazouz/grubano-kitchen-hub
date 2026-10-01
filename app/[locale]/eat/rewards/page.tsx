'use client'

import './rewards.css'
// gb-* design FOUNDATION (Agent 168, extended with the Rewards `.rw-*` components).
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import { useEffect, useState } from 'react'
import { useRouter } from '@/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { formatAmount } from '@/lib/format-money'

// ── /eat/rewards — CONSUMER loyalty rewards screen (gated /eat, DISPLAY-ONLY) ───
//
// Reproduces the FROZEN CD ref (Notion 38cfd2c9-8146-8198) with the gb-* foundation,
// BOUND to the REAL loyalty (read-only): the points balance + euro-credit come from
// /api/loyalty/wallet; the tier ladder uses the REAL thresholds (Bronze 50 / Argent 100
// / Or 200 / Platine 400 — same as /eat/account); the "rewards" grid is the REAL
// euro-credit scale (L2 replaced the named-reward catalogue). NO new money flow: the
// grid is informational and "Utiliser" routes to the cart, where points are actually
// applied at checkout (lib/loyalty.resolveLoyaltyCredit). The CD streak (no backing in
// the loyalty system) is a COMING-SOON placeholder; the AI insight is "AI — soon".

// REAL consumer tiers (mirrors app/[locale]/eat/account tierFor — kept in sync; the
// loyalty engine is byte-identical, so the thresholds are read here, not invented).
function tierFor(points: number): { key: string; next: number; floor: number } {
  if (points >= 400) return { key: 'platine', next: 400, floor: 400 }
  if (points >= 200) return { key: 'gold', next: 400, floor: 200 }
  if (points >= 100) return { key: 'silver', next: 200, floor: 100 }
  if (points >= 50) return { key: 'bronze', next: 100, floor: 50 }
  return { key: 'member', next: 50, floor: 0 }
}
const LADDER = [
  { key: 'bronze', pts: 50, color: 'var(--gb-bronze)', icon: 'workspace_premium' },
  { key: 'silver', pts: 100, color: 'var(--gb-silver)', icon: 'workspace_premium' },
  { key: 'gold', pts: 200, color: 'var(--gb-gold)', icon: 'workspace_premium' },
  { key: 'platine', pts: 400, color: 'var(--gb-platinum)', icon: 'diamond' },
]
const LADDER_ORDER = ['member', 'bronze', 'silver', 'gold', 'platine']
// rotating tints for the euro-credit cards (visual only — the data is the real scale)
const CREDIT_TINTS = [
  { bg: '#EAF7EF', color: 'var(--gb-basil-600)', icon: 'savings' },
  { bg: '#E7F0FE', color: 'var(--gb-info)', icon: 'redeem' },
  { bg: '#FCF0D9', color: '#EA9410', icon: 'local_activity' },
]

interface CreditStep { points: number; euros: number }

export default function RewardsScreen() {
  const t = useTranslations('eat.rewards')
  const ta = useTranslations('eat.account') // tier labels (shared with the account screen)
  const locale = useLocale()
  const router = useRouter()
  const { status } = useSession()

  const [loading, setLoading] = useState(true)
  const [points, setPoints] = useState(0)
  const [credit, setCredit] = useState<CreditStep[]>([])

  useEffect(() => {
    if (status === 'loading') return
    if (status !== 'authenticated') { setLoading(false); return }
    fetch('/api/loyalty/wallet')
      .then((r) => r.json())
      .then((w) => {
        setPoints(typeof w.pointsBalance === 'number' ? w.pointsBalance : 0)
        setCredit(Array.isArray(w.creditScale) ? w.creditScale : [])
      })
      .catch(() => { /* keep zeros */ })
      .finally(() => setLoading(false))
  }, [status])

  const tierKey = tierFor(points).key
  const tier = tierFor(points)
  const isMax = tier.key === 'platine'
  const progress = isMax ? 100 : Math.max(0, Math.min(100, ((points - tier.floor) / (tier.next - tier.floor)) * 100))
  const ptsToNext = isMax ? 0 : Math.max(0, tier.next - points)
  const nextLabelKey = LADDER.find((l) => l.pts === tier.next)?.key ?? 'platine'
  const tierLabel = (k: string) => ({ bronze: ta('tierBronze'), silver: ta('tierSilver'), gold: ta('tierGold'), platine: ta('tierPlatinum'), member: ta('tierMember') } as Record<string, string>)[k] ?? k
  const curIdx = LADDER_ORDER.indexOf(tierKey)

  function useCredit() { router.push('/eat/cart') }

  // Not signed in → invite to sign in (the wallet needs a session).
  if (status === 'unauthenticated') {
    return (
      <div className="gb gb-rewards">
        <div className="rw-pageh">
          <h1>{t('title')}</h1>
        </div>
        <div className="rw-card" style={{ textAlign: 'center', marginTop: 0 }}>
          <h2 className="rw-card__h" style={{ marginBottom: 8 }}>{t('signInTitle')}</h2>
          <button className="btn btn--primary" type="button" style={{ width: 'auto', padding: '12px 22px' }} onClick={() => router.push('/eat/auth')}>{t('signInCta')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="gb gb-rewards">
      <div className="rw-pageh">
        <h1>{t('title')}</h1>
      </div>

      {loading ? (
        <div className="rw-layout">
          <div className="rw-skel" style={{ height: 150 }} />
          <div className="rw-skel" style={{ height: 150 }} />
        </div>
      ) : (
        <>
          <div className="rw-layout">
            {/* POINTS HERO */}
            <section className="rw-hero">
              <div className="rw-hero__top">
                <div>
                  <div className="rw-hero__label">{t('brand')}</div>
                  <div className="rw-hero__pts">{points.toLocaleString(locale)}</div>
                  <div className="rw-hero__sub">{t('pointsUnit')}{isMax ? ` · ${t('maxLevel')}` : ` · ${t('toNext', { count: ptsToNext, tier: tierLabel(nextLabelKey) })}`}</div>
                </div>
                {tierKey !== 'member' && (
                  <span className="rw-hero__chip"><span className="ms" style={{ fontSize: '15px', fontVariationSettings: "'FILL' 1" }} aria-hidden="true">workspace_premium</span>{tierLabel(tierKey).toUpperCase()}</span>
                )}
              </div>
              <div className="rw-hero__bar"><i style={{ width: `${progress}%` }} /></div>
            </section>

            {/* STREAK — coming soon (no streak feature in the loyalty system yet) */}
            <section className="rw-streak" style={{ opacity: 0.7 }}>
              <div className="rw-streak__top">
                <span className="rw-streak__ico"><span className="ms" aria-hidden="true">local_fire_department</span></span>
                <div><b>{t('streakTitle')}</b><span>{t('streakSoon')}</span></div>
              </div>
              <div className="rw-streak__week"><i /><i /><i /><i /><i /></div>
            </section>
          </div>

          {/* TIER LADDER */}
          <section className="rw-card">
            <h2 className="rw-card__h">{t('yourTier')}</h2>
            <div className="rw-ladder">
              {LADDER.map((l, i) => {
                const cur = l.key === tierKey
                return (
                  <div key={l.key} style={{ display: 'contents' }}>
                    {i > 0 && <div className={`rw-bridge${curIdx >= LADDER_ORDER.indexOf(l.key) ? ' done' : ''}`} />}
                    <div className={`rw-tier${cur ? ' cur' : ''}`}>
                      <span className="rw-tier__dot"><span className="ms" style={cur ? undefined : { color: l.color }} aria-hidden="true">{l.icon}</span></span>
                      <div className="rw-tier__name" style={cur ? undefined : { color: l.color }}>{tierLabel(l.key)}{cur ? ` · ${t('you')}` : ''}</div>
                      <div className="rw-tier__pts">{l.pts.toLocaleString(locale)} {t('ptsUnit')}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="rw-insight">
              <span className="ms" aria-hidden="true">auto_awesome</span>
              <p>{t('insight')}</p>
              <span className="ai-soon">{t('aiSoon')}</span>
            </div>
          </section>

          {/* EURO-CREDIT GRID (the real loyalty credit scale; DISPLAY-ONLY → cart) */}
          <h2 className="rw-sectionh">{t('redeemTitle')}</h2>
          <div className="rw-rgrid">
            {credit.map((step, i) => {
              const tint = CREDIT_TINTS[i % CREDIT_TINTS.length]
              const able = points >= step.points
              return (
                <div key={step.points} className={`rw-reward${able ? '' : ' locked'}`}>
                  {!able && <span className="ms rw-reward__lock" aria-hidden="true">lock</span>}
                  <span className="rw-reward__ico" style={{ background: tint.bg }}><span className="ms" style={{ color: tint.color }} aria-hidden="true">{tint.icon}</span></span>
                  <div className="rw-reward__name">{t('creditName', { amount: formatAmount(step.euros, locale) })}</div>
                  <div className="rw-reward__cost">{step.points.toLocaleString(locale)} {t('ptsUnit')}</div>
                  <button className={`rw-reward__cta ${able ? 'able' : 'unable'}`} type="button" disabled={!able} onClick={able ? useCredit : undefined}>
                    {able ? t('redeemCta') : t('redeemLocked', { count: step.points - points })}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
