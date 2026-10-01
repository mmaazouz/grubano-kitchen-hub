'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Megaphone, Loader2, CheckCircle2, ArrowRight } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button } from '@/components/design-system'
import { buildAffiliateLink } from '@/lib/affiliate-link'
import AffiliateLinkCard from './AffiliateLinkCard'

// ── AffiliateJoinClient — the INSTANT self-serve affiliate onboarding (Brique A) ────────
// Reachable by ANY authenticated user (middleware: /affiliate/join is session-only). On
// mount it asks GET /api/affiliate/join whether the caller is already an affiliate; if so
// it shows their link. Otherwise a single button POSTs the instant grant (no verification)
// and reveals the freshly-minted referral link. Auth/flag are enforced server-side (the
// API 404s when AFFILIATE_ENABLED is OFF, 401 without a session).

type Affiliate = { referralCode: string; referralLinkSlug: string }

export default function AffiliateJoinClient() {
  const t = useTranslations('affiliate')
  const [loading, setLoading]   = useState(true)
  const [joining, setJoining]   = useState(false)
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null)
  const [error, setError]       = useState('')

  useEffect(() => {
    fetch('/api/affiliate/join')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.affiliate) setAffiliate(d.affiliate) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function join() {
    setJoining(true); setError('')
    try {
      const res = await fetch('/api/affiliate/join', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? t('errorGeneric')); return }
      setAffiliate(d.affiliate)
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-grubano-ink-muted">
        <Loader2 size={22} className="animate-spin" />
      </div>
    )
  }

  // Already an affiliate (or just joined) → show the link + a CTA to the dashboard.
  if (affiliate) {
    const link = buildAffiliateLink(affiliate.referralLinkSlug) ?? ''
    return (
      <div className="w-full max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={20} className="text-grubano-success" />
          <h1 className="font-display text-xl font-extrabold text-grubano-ink">{t('joinedTitle')}</h1>
        </div>
        <p className="text-sm text-grubano-ink-muted">{t('joinedBody')}</p>
        <AffiliateLinkCard link={link} code={affiliate.referralCode} />
        <Link href="/affiliate/dashboard" className="block">
          <Button variant="primary" size="md" fullWidth rightIcon={<ArrowRight size={16} className="rtl:rotate-180" />}>
            {t('goToDashboard')}
          </Button>
        </Link>
      </div>
    )
  }

  // Not yet an affiliate → the instant-join CTA.
  return (
    <div className="w-full max-w-lg">
      <Card elevation="sm" padding="lg" className="text-center">
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-grubano-lg bg-grubano-tint text-grubano-primary">
          <Megaphone size={26} />
        </span>
        <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('joinTitle')}</h1>
        <p className="mt-2 text-sm text-grubano-ink-muted">{t('joinSubtitle')}</p>
        <ul className="mx-auto mt-4 max-w-sm space-y-1.5 text-left text-sm text-grubano-ink-muted">
          <li>• {t('joinPoint1')}</li>
          <li>• {t('joinPoint2')}</li>
          <li>• {t('joinPoint3')}</li>
        </ul>
        {error && (
          <p className="mt-4 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error}</p>
        )}
        <Button
          variant="primary" size="md" fullWidth className="mt-5"
          onClick={join} disabled={joining}
          leftIcon={joining ? <Loader2 size={16} className="animate-spin" /> : <Megaphone size={16} />}
        >
          {joining ? t('joining') : t('joinCta')}
        </Button>
        <p className="mt-3 text-[11px] text-grubano-ink-faint">{t('joinNoVerif')}</p>
      </Card>
    </div>
  )
}
