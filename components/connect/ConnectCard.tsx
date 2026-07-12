'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Landmark, Loader2, AlertCircle, ChevronRight } from 'lucide-react'

// ── <ConnectCard /> — « Encaissements / Compte Stripe » (Agent 13, contrat A1
// section 6) ───────────────────────────────────────────────────────────────────
//
// Establishment-settings card over Agent 14's A1 endpoints (consumed as-is):
//   GET  /api/restaurants/[id]/connect → { status:'none'|'pending'|'active'|
//        'restricted', chargesEnabled, payoutsEnabled, detailsSubmitted }
//   POST /api/restaurants/[id]/connect → { url, accountId } — url = the
//        Stripe-HOSTED onboarding page (Account Link) → window.location.
//
// 4 states:
//   none       → invitation card (benefit pitch + « Configurer »)
//   pending    → orange badge « Onboarding à terminer » + « Reprendre »
//   active     → green badge « Compte actif — reversements quotidiens », sober,
//                no intrusive CTA
//   restricted → red badge « Action requise » + « Reprendre »
//
// DEFENSIVE: while loading or when the GET fails → the card renders NOTHING
// (never a false alert). Commission fields are NOT exposed (A7).

type ConnectStatus = 'none' | 'pending' | 'active' | 'restricted'

export default function ConnectCard({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('connect')

  const [status,   setStatus]   = useState<ConnectStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [error,    setError]    = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/connect`, { cache: 'no-store' })
      if (!r.ok) return // defensive: no card on failure
      const d = await r.json() as { status?: string }
      if (d.status === 'none' || d.status === 'pending' || d.status === 'active' || d.status === 'restricted') {
        setStatus(d.status)
      }
    } catch { /* defensive: no card */ }
  }, [restaurantId])

  useEffect(() => { loadStatus() }, [loadStatus])

  // CTA — generate a fresh Account Link (idempotent server-side: never a
  // second account) and hand over to the Stripe-hosted page.
  async function startOnboarding() {
    if (starting) return
    setStarting(true)
    setError('')
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/connect`, { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (!r.ok || typeof d?.url !== 'string') {
        setError(t('errStart'))
        return
      }
      window.location.href = d.url
      // keep `starting` true — we're navigating away
      return
    } catch {
      setError(t('errStart'))
    } finally {
      setStarting(false)
    }
  }

  // Loading / failed GET → nothing (never a false alert).
  if (status === null) return null

  const cta = (label: string) => (
    <button
      type="button"
      onClick={startOnboarding}
      disabled={starting}
      className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-60"
    >
      {starting ? <Loader2 size={12} className="animate-spin" /> : null}
      {label}
      {!starting && <ChevronRight size={13} className="rtl:rotate-180" />}
    </button>
  )

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Landmark size={14} className="text-primary" />
        <h2 className="text-sm font-bold text-foreground">{t('title')}</h2>
        {status === 'active' && (
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-bold text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {t('statusActive')}
          </span>
        )}
        {status === 'pending' && (
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-bold text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            {t('statusPending')}
          </span>
        )}
        {status === 'restricted' && (
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-1 text-[10px] font-bold text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            {t('statusRestricted')}
          </span>
        )}
      </div>

      {/* none → invitation : pitch + Configurer */}
      {status === 'none' && (
        <div className="mt-2 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-foreground">{t('inviteTitle')}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('inviteDesc')}</p>
          </div>
          {cta(t('ctaConfigure'))}
        </div>
      )}

      {/* pending / restricted → one line + Reprendre */}
      {status === 'pending' && (
        <div className="mt-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t('pendingDesc')}</p>
          {cta(t('ctaResume'))}
        </div>
      )}
      {status === 'restricted' && (
        <div className="mt-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t('restrictedDesc')}</p>
          {cta(t('ctaResume'))}
        </div>
      )}

      {/* active → sober, the badge says it all. No intrusive CTA. */}

      {error && (
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
