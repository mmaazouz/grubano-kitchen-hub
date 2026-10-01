'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, Badge } from '@/components/design-system'
import { Sparkles, BadgeCheck, Clock, ArrowDown } from 'lucide-react'
import { deriveInfluencerUpgrade, type InfluencerUpgradeInput } from '@/lib/influencer-onboarding'

// ── OnboardingInfluencerUpgrade — optional "become an influencer" upgrade (Agent 99) ────────
// An OPTIONAL upgrade element in the affiliate onboarding experience, shown OUTSIDE the 3-step
// affiliate checklist (Agent 98) so a normal affiliate is NEVER marked incomplete by it. It is
// READ-ONLY: it reuses the EXISTING owner-scoped verification state (GET /api/affiliate/
// verify-request) and the EXISTING request action (AffiliateVerifyCard, anchored at
// #influencer-verify) — it adds NO new endpoint, NO write, and never flips audienceVerified
// (admin-only approval unchanged). SELF-GATING: the endpoint 404s when INFLUENCER_ENABLED is OFF
// (or the user is not an affiliate) → renders nothing → the dashboard stays byte-identical to
// after Agent 98. NON-money: it carries no rate/amount; the 40% line stays the Agent 90 display.

type State = InfluencerUpgradeInput & {
  request: { status: string } | null
}

export default function OnboardingInfluencerUpgrade() {
  const t = useTranslations('affiliate')
  const [state, setState]   = useState<State | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/affiliate/verify-request', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (!cancelled) setState({ verified: !!d?.verified, request: d?.request ?? null }) })
      .catch(() => { if (!cancelled) setHidden(true) })   // 404 (flag OFF) / 401 → hide → byte-identical
    return () => { cancelled = true }
  }, [])

  if (hidden || !state) return null

  const { variant } = deriveInfluencerUpgrade(state)

  if (variant === 'verified') {
    return (
      <Card elevation="sm" padding="md" className="mb-4 border border-grubano-primary/30 bg-grubano-tint/40">
        <div className="flex items-center gap-2">
          <BadgeCheck size={18} className="shrink-0 text-grubano-primary" />
          <p className="text-sm font-bold text-grubano-primary">{t('upgradeVerifiedTitle')}</p>
          <Badge tone="primary" size="sm">{t('verifiedBadge')}</Badge>
        </div>
        <p className="mt-1 text-[12px] text-grubano-ink-muted">{t('upgradeVerifiedBody')}</p>
      </Card>
    )
  }

  if (variant === 'pending') {
    return (
      <Card elevation="sm" padding="md" className="mb-4 border border-grubano-warning/30 bg-grubano-warning-tint/40">
        <div className="flex items-center gap-2">
          <Clock size={16} className="shrink-0 text-grubano-warning" />
          <p className="text-sm font-bold text-grubano-ink">{t('upgradePendingTitle')}</p>
        </div>
        <p className="mt-1 text-[12px] text-grubano-ink-muted">{t('upgradePendingBody')}</p>
      </Card>
    )
  }

  // invite — motivate + point to the EXISTING request form (AffiliateVerifyCard) below.
  return (
    <Card elevation="sm" padding="md" className="mb-4 border border-grubano-primary/25 bg-gradient-to-br from-grubano-tint/40 to-white">
      <div className="flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary text-white">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-grubano-ink">{t('upgradeTitle')}</p>
          <p className="mt-0.5 text-[12px] text-grubano-ink-muted">{t('upgradeBody')}</p>
          <a
            href="#influencer-verify"
            className="mt-2 inline-flex items-center gap-1.5 rounded-grubano-md bg-grubano-primary px-3 py-1.5 text-[13px] font-bold text-white shadow-grubano-sm transition-colors hover:bg-grubano-primaryHover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30"
          >
            {t('upgradeCta')}
            <ArrowDown size={14} className="shrink-0" />
          </a>
        </div>
      </div>
    </Card>
  )
}
