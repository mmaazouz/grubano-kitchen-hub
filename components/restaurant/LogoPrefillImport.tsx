'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, Globe, Check, Loader2, RotateCcw } from 'lucide-react'
import { Card, Button, Input } from '@/components/design-system'

// ── LogoPrefillImport — AI logo prefill from a website (onboarding copilot brique 3,
//    Agent 92). SELF-GATING: probes GET /api/restaurants/logo-prefill; renders NOTHING when
//    the flag is OFF (or no restaurant) → the establishment screen stays byte-identical.
//    When ON: paste the site URL → the SERVER detects + fetches a candidate logo SSRF-SAFELY
//    → PREVIEW. On CONFIRM the bytes are uploaded to OUR storage (/apply) and the logo is set
//    via the EXISTING PATCH /api/restaurants/[id]. NOTHING changes before the user confirms.

type Phase = 'idle' | 'detecting' | 'review' | 'applying'
type Preview = { imageBase64: string; mediaType: string }

export default function LogoPrefillImport({ restaurantId, onConfirmed }: { restaurantId: string; onConfirmed?: () => void }) {
  const t = useTranslations('restaurant.logoImport')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [phase, setPhase]     = useState<Phase>('idle')
  const [url, setUrl]         = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/restaurants/logo-prefill', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (!cancelled) setEnabled(!!d?.enabled) })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [])

  if (!enabled || !restaurantId) return null

  async function detect() {
    setError(null); setDone(null); setPreview(null)
    if (!url.trim()) { setError(t('errorUrl')); return }
    setPhase('detecting')
    try {
      const res = await fetch('/api/restaurants/logo-prefill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (res.status === 504) { setError(t('errorTimeout')); setPhase('idle'); return }
      if (res.status === 413) { setError(t('errorTooLarge')); setPhase('idle'); return }
      if (res.status === 400) { setError(t('errorUrl')); setPhase('idle'); return }
      if (!res.ok) { setError(t('errorGeneric')); setPhase('idle'); return }
      const data = (await res.json()) as { preview?: Preview | null }
      if (!data.preview) { setError(t('notFound')); setPhase('idle'); return }
      setPreview(data.preview)
      setPhase('review')
    } catch {
      setError(t('errorGeneric')); setPhase('idle')
    }
  }

  async function confirm() {
    if (!preview) return
    setPhase('applying'); setError(null)
    try {
      // 1) Upload the validated BYTES to OUR storage (never an external URL).
      const up = await fetch('/api/restaurants/logo-prefill/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: preview.imageBase64, mediaType: preview.mediaType }),
      })
      if (!up.ok) { setError(t('errorGeneric')); setPhase('review'); return }
      const { url: assetUrl } = (await up.json()) as { url: string }

      // 2) Apply via the EXISTING profile-update route (logo = OUR asset URL).
      const patch = await fetch(`/api/restaurants/${restaurantId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo: assetUrl }),
      })
      if (!patch.ok) { setError(t('errorGeneric')); setPhase('review'); return }

      setDone(t('saved')); setPhase('idle'); setUrl(''); setPreview(null)
      onConfirmed?.()
    } catch {
      setError(t('errorGeneric')); setPhase('review')
    }
  }

  function reset() {
    setPhase('idle'); setError(null); setPreview(null)
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
            onKeyDown={(e) => { if (e.key === 'Enter') detect() }}
          />
          <div className="mt-2">
            <Button variant="secondary" size="sm" leftIcon={<Globe size={15} />} onClick={detect}>
              {t('detect')}
            </Button>
          </div>
          {done && <p className="mt-2 text-[12px] font-semibold text-grubano-success">{done}</p>}
          {error && <p className="mt-2 text-[12px] text-grubano-danger">{error}</p>}
        </>
      )}

      {phase === 'detecting' && (
        <div className="flex items-center gap-2 py-3 text-[13px] text-grubano-ink-muted">
          <Loader2 size={16} className="animate-spin text-grubano-primary" /> {t('detecting')}
        </div>
      )}

      {(phase === 'review' || phase === 'applying') && preview && (
        <div className="space-y-3">
          <div>
            <p className="text-[13px] font-semibold text-grubano-ink">{t('reviewTitle')}</p>
            <p className="text-[11px] text-grubano-ink-muted">{t('reviewHint')}</p>
          </div>
          <div className="flex items-center justify-center rounded-grubano-md bg-grubano-bg p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- ephemeral data-URI preview, not a stored asset */}
            <img
              src={`data:${preview.mediaType};base64,${preview.imageBase64}`}
              alt={t('previewAlt')}
              className="h-24 w-24 rounded-grubano-md object-contain"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" leftIcon={<Check size={15} />} loading={phase === 'applying'} onClick={confirm}>
              {phase === 'applying' ? t('applying') : t('confirm')}
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={15} />} disabled={phase === 'applying'} onClick={reset}>
              {t('restart')}
            </Button>
          </div>
          {error && <p className="text-[12px] text-grubano-danger">{error}</p>}
        </div>
      )}
    </Card>
  )
}
