'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/design-system'
import { JoinStatusBadge } from './BrandJoinCTA'

// ── MyFranchiseeApplications — the restaurateur's own join candidacies (B7) ───────────
// Read-only at-a-glance status of MY candidacies (owner-scoped server-side). Renders
// nothing when the visitor is not authenticated (401) or has no candidacy — so the public
// vitrine is unchanged for anonymous visitors.

type App = {
  id:             string
  brandName:      string
  brandEmoji:     string
  restaurantName: string
  status:         string
}

export default function MyFranchiseeApplications() {
  const t = useTranslations('franchise.join')
  const [apps, setApps] = useState<App[] | null>(null)

  useEffect(() => {
    fetch('/api/franchisee/applications')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setApps(d?.applications ?? []))
      .catch(() => setApps([]))
  }, [])

  if (!apps || apps.length === 0) return null

  return (
    <Card elevation="sm" padding="md" className="mb-6">
      <p className="text-sm font-bold mb-2">{t('myApplicationsTitle')}</p>
      <div className="space-y-2">
        {apps.map(a => (
          <div key={a.id} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base">{a.brandEmoji}</span>
              <span className="text-sm truncate">
                <span className="font-semibold">{a.brandName}</span>
                {a.restaurantName ? <span className="text-grubano-ink-muted"> · {a.restaurantName}</span> : null}
              </span>
            </div>
            <JoinStatusBadge status={a.status} />
          </div>
        ))}
      </div>
    </Card>
  )
}
