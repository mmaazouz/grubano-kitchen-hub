'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, Globe, Check, Loader2, RotateCcw } from 'lucide-react'
import { Card, Button, Input } from '@/components/design-system'
import type { SiteProfileDraft } from '@/lib/site-extract'

// ── SitePrefillImport — AI profile prefill from a website (onboarding copilot brique 2,
//    Agent 91). SELF-GATING: probes GET /api/restaurants/prefill-site; renders NOTHING
//    when the flag is OFF (or no restaurant) → the profile screen stays byte-identical.
//    When ON: paste the site URL → POST extracts a NON-LEGAL DRAFT (name/description/
//    cuisine) the user edits/clears → CONFIRM updates the profile via the EXISTING
//    PATCH /api/restaurants/[id] (same validation, owner-scoped). NOTHING is saved before
//    the user clicks Confirm. The server fetches the URL SSRF-safely.

type Phase = 'idle' | 'extracting' | 'review' | 'confirming'

export default function SitePrefillImport({ restaurantId, onConfirmed }: { restaurantId: string; onConfirmed?: () => void }) {
  const t = useTranslations('restaurant.siteImport')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [phase, setPhase]     = useState<Phase>('idle')
  const [url, setUrl]         = useState('')
  const [draft, setDraft]     = useState<SiteProfileDraft>({ name: '', description: '', cuisine: [] })
  const [cuisineText, setCuisineText] = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/restaurants/prefill-site', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (!cancelled) setEnabled(!!d?.enabled) })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [])

  // Flag OFF / unknown / no restaurant → render nothing (byte-identical profile screen).
  if (!enabled || !restaurantId) return null

  async function extract() {
    setError(null); setDone(null)
    if (!url.trim()) { setError(t('errorUrl')); return }
    setPhase('extracting')
    try {
      const res = await fetch('/api/restaurants/prefill-site', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (res.status === 429) { setError(t('errorQuota')); setPhase('idle'); return }
      if (res.status === 504) { setError(t('errorTimeout')); setPhase('idle'); return }
      if (res.status === 400) { setError(t('errorUrl')); setPhase('idle'); return }
      if (!res.ok) { setError(t('errorGeneric')); setPhase('idle'); return }
      const data = (await res.json()) as { draft?: SiteProfileDraft }
      const d = data.draft ?? { name: '', description: '', cuisine: [] }
      setDraft({ name: d.name || '', description: d.description || '', cuisine: Array.isArray(d.cuisine) ? d.cuisine : [] })
      setCuisineText((Array.isArray(d.cuisine) ? d.cuisine : []).join(', '))
      setPhase('review')
    } catch {
      setError(t('errorGeneric')); setPhase('idle')
    }
  }

  async function confirm() {
    setPhase('confirming'); setError(null)
    // Build the PATCH body from ONLY the non-empty fields the user kept. Reuses the
    // EXISTING profile-update route (same PatchInput validation, owner-scoped).
    const body: Record<string, unknown> = {}
    if (draft.name.trim())        body.name = draft.name.trim()
    if (draft.description.trim()) body.description = draft.description.trim()
    const cuisine = cuisineText.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 6)
    if (cuisine.length)           body.cuisine = cuisine

    if (Object.keys(body).length === 0) { setError(t('errorEmpty')); setPhase('review'); return }

    try {
      const res = await fetch(`/api/restaurants/${restaurantId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setError(t('errorGeneric')); setPhase('review'); return }
      setDone(t('saved'))
      setPhase('idle'); setUrl('')
      onConfirmed?.()
    } catch {
      setError(t('errorGeneric')); setPhase('review')
    }
  }

  function reset() {
    setPhase('idle'); setError(null); setDraft({ name: '', description: '', cuisine: [] }); setCuisineText('')
  }

  return (
    <Card elevation="sm" padding="md" className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={16} className="text-grubano-primary" />
        <p className="text-sm font-bold text-grubano-ink">{t('title')}</p>
      </div>

      {phase === 'idle' && (
        <>
          <p className="mb-3 text-[13px] text-grubano-ink-muted">{t('subtitle')}</p>
          <Input
            label={t('urlLabel')}
            placeholder="https://mon-restaurant.fr"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') extract() }}
          />
          <div className="mt-2">
            <Button variant="secondary" size="sm" leftIcon={<Globe size={15} />} onClick={extract}>
              {t('import')}
            </Button>
          </div>
          {done && <p className="mt-2 text-[12px] font-semibold text-grubano-success">{done}</p>}
          {error && <p className="mt-2 text-[12px] text-grubano-danger">{error}</p>}
        </>
      )}

      {phase === 'extracting' && (
        <div className="flex items-center gap-2 py-3 text-[13px] text-grubano-ink-muted">
          <Loader2 size={16} className="animate-spin text-grubano-primary" /> {t('extracting')}
        </div>
      )}

      {(phase === 'review' || phase === 'confirming') && (
        <div className="space-y-3">
          <div>
            <p className="text-[13px] font-semibold text-grubano-ink">{t('reviewTitle')}</p>
            <p className="text-[11px] text-grubano-ink-muted">{t('reviewHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Input label={t('fieldName')} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <Input label={t('fieldDescription')} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
            <Input label={t('fieldCuisine')} placeholder={t('fieldCuisineHint')} value={cuisineText} onChange={(e) => setCuisineText(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <Button variant="primary" size="sm" leftIcon={<Check size={15} />} loading={phase === 'confirming'} onClick={confirm}>
              {phase === 'confirming' ? t('confirming') : t('confirm')}
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={15} />} disabled={phase === 'confirming'} onClick={reset}>
              {t('restart')}
            </Button>
          </div>
          {error && <p className="text-[12px] text-grubano-danger">{error}</p>}
        </div>
      )}
    </Card>
  )
}
