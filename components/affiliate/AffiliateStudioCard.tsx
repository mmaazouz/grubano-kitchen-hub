'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Lock, BadgeCheck } from 'lucide-react'
import { Card, Badge } from '@/components/design-system'
import AffiliateStudio from '@/components/creators/AffiliateStudio'

// ── AffiliateStudioCard — content studio for the VERIFIED affiliate (INF-2, Agent 67) ──
// Reuses the existing AffiliateStudio component, pointed at the operator-keyed twin
// /api/affiliate/content (verified-gated server-side) with the affiliate.* (vouvoiement)
// namespace. The studio is an advantage of the VERIFIED influencer:
//   - flag OFF / not an affiliate (verify-request 404/401) → render NOTHING (dashboard
//     byte-identical);
//   - affiliate NOT verified → a muted "réservé aux vérifiés" card (the AffiliateVerifyCard
//     above invites them to get verified);
//   - verified → a "Influenceur vérifié" badge + the studio.
// NO money: the studio only generates captions via the capped LLM gateway.

export default function AffiliateStudioCard() {
  const t = useTranslations('affiliate')
  const [verified, setVerified] = useState<boolean | null>(null)
  const [hidden, setHidden]     = useState(false)
  const [restos, setRestos]     = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/api/affiliate/verify-request')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { verified: boolean }) => setVerified(!!d.verified))
      .catch(() => setHidden(true))   // 404 (flag OFF) / 401 → hide → byte-identical
  }, [])

  // Load the public restaurant list only once we know the affiliate is verified.
  useEffect(() => {
    if (verified !== true) return
    let cancelled = false
    fetch('/api/restaurants?take=50', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        const list = Array.isArray(d) ? d : (d.restaurants ?? d.items ?? [])
        if (Array.isArray(list)) setRestos(list.filter((x: { id?: string }) => x && x.id).map((x: { id: string; name: string }) => ({ id: String(x.id), name: String(x.name) })))
      })
      .catch(() => { /* picker stays empty */ })
    return () => { cancelled = true }
  }, [verified])

  if (hidden) return null
  if (verified === null) {
    return <Card elevation="sm" padding="md"><div className="flex justify-center py-2 text-grubano-ink-muted"><Loader2 size={18} className="animate-spin" /></div></Card>
  }

  // Not verified → reserved-to-verified hint (the verification form lives in AffiliateVerifyCard).
  if (!verified) {
    return (
      <Card elevation="sm" padding="md" className="border-dashed">
        <div className="flex items-center gap-2 mb-1 text-grubano-ink-muted">
          <Lock size={15} />
          <p className="text-sm font-bold">{t('studioLockedTitle')}</p>
        </div>
        <p className="text-[12px] text-grubano-ink-faint">{t('studioLockedBody')}</p>
      </Card>
    )
  }

  // Verified → badge + the reused studio (affiliate endpoint + vouvoiement namespace).
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <BadgeCheck size={16} className="text-grubano-primary" />
        <Badge tone="primary" size="sm">{t('verifiedBadge')}</Badge>
      </div>
      <AffiliateStudio restos={restos} endpoint="/api/affiliate/content" tNamespace="affiliate" />
    </div>
  )
}
