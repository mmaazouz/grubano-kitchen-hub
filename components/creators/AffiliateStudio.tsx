'use client'

/**
 * AffiliateStudio — Studio de contenu IA (Slice 2b, Agent 14). Pick a target
 * (restaurant + optional dish) → « Générer » → 2-3 AI caption variants (tones,
 * affiliate link embedded) + a shareable card. Consumes POST
 * /api/creator/affiliate-content (session-aware, isInfluencer-gated, rate-limited,
 * READ-ONLY). Clean idle / loading / error / rate-limited states.
 */

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Wand2, Loader2, Copy, Check, AlertCircle } from 'lucide-react'
import { Card } from '@/components/design-system'
import AffiliateShareCard from '@/components/creators/AffiliateShareCard'

interface Caption { tone: string; text: string }
interface GenResult {
  captions: Caption[]
  link:     string
  code:     string | null
  target:   { restaurantName: string; dishName: string | null; dishPrice: number | null; photo: string | null }
}

export default function AffiliateStudio({ restos }: { restos: { id: string; name: string }[] }) {
  const t = useTranslations('creators.affiliate')
  const locale = useLocale()

  const [restoId, setRestoId] = useState('')
  const [dishId, setDishId]   = useState('')
  const [dishes, setDishes]   = useState<{ id: string; name: string; price: number }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [result, setResult]   = useState<GenResult | null>(null)
  const [copied, setCopied]   = useState<number | null>(null)

  // Load the chosen restaurant's dishes (optional finer target). Read-only.
  useEffect(() => {
    setDishId(''); setDishes([])
    if (!restoId) return
    let cancelled = false
    fetch(`/api/restaurants/${restoId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.menu)) return
        const items = d.menu.flatMap((c: { items?: { id: string; name: string; price: number }[] }) => c.items ?? [])
        setDishes(items.filter((x: { id?: string }) => x && x.id).map((x: { id: string; name: string; price: number }) => ({ id: x.id, name: x.name, price: x.price })))
      })
      .catch(() => { /* dish picker stays empty */ })
    return () => { cancelled = true }
  }, [restoId])

  async function generate() {
    if (!restoId || loading) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/creator/affiliate-content', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ restaurantId: restoId, dishId: dishId || undefined, locale }),
      })
      if (res.status === 429) { setError(t('studioRateLimited')); return }
      if (!res.ok) { setError(t('studioErr')); return }
      setResult(await res.json() as GenResult)
    } catch {
      setError(t('studioErr'))
    } finally {
      setLoading(false)
    }
  }

  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i); setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const toneLabel = (tone: string) =>
    tone === 'enthusiastic' ? t('toneEnthusiastic')
      : tone === 'punchy' ? t('tonePunchy')
        : tone === 'storytelling' ? t('toneStorytelling') : tone

  return (
    <Card elevation="sm" padding="md">
      <div className="mb-2 flex items-center gap-2">
        <Wand2 size={14} className="text-grubano-primary" />
        <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('studioTitle')}</h2>
      </div>
      <p className="mb-3 text-[12px] text-grubano-ink-muted">{t('studioDesc')}</p>

      {/* Target picker */}
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={restoId} onChange={(e) => setRestoId(e.target.value)}
          className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface-muted px-2.5 py-2 text-[12px] text-grubano-ink">
          <option value="">{t('studioPickResto')}</option>
          {restos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={dishId} onChange={(e) => setDishId(e.target.value)} disabled={!restoId || dishes.length === 0}
          className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface-muted px-2.5 py-2 text-[12px] text-grubano-ink disabled:opacity-50">
          <option value="">{t('studioDishAll')}</option>
          {dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <button type="button" onClick={generate} disabled={!restoId || loading}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary py-2.5 text-sm font-bold text-white disabled:opacity-50 active:scale-[0.99]">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
        {loading ? t('studioGenerating') : t('studioGenerate')}
      </button>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-grubano-md bg-grubano-danger-tint px-3 py-2 text-[12px] text-grubano-danger">
          <AlertCircle size={13} className="mt-0.5 shrink-0" /><span>{error}</span>
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          {/* Captions */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-grubano-ink-faint">{t('studioCaptionsTitle')}</h3>
            {result.captions.map((c, i) => (
              <div key={i} className="rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-grubano-tint px-2 py-0.5 text-[10px] font-bold text-grubano-primary">{toneLabel(c.tone)}</span>
                  <button type="button" onClick={() => copy(i, c.text)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-grubano-primary">
                    {copied === i ? <Check size={12} /> : <Copy size={12} />}{copied === i ? t('copied') : t('copyCaption')}
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-grubano-ink">{c.text}</p>
              </div>
            ))}
          </div>

          {/* Shareable card */}
          <div>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-grubano-ink-faint">{t('studioCardTitle')}</h3>
            <div className="max-w-[280px]">
              <AffiliateShareCard
                photo={result.target.photo}
                title={result.target.dishName ?? result.target.restaurantName}
                subtitle={result.target.dishName ? result.target.restaurantName : null}
                price={typeof result.target.dishPrice === 'number' ? `${result.target.dishPrice.toFixed(2)} €` : null}
                tagline={t('studioCardCta')}
                link={result.link}
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
