'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X, Loader2, Printer, Clock, AlertTriangle, UtensilsCrossed, Sparkles } from 'lucide-react'
import { Badge, Button } from '@/components/design-system'
import {
  sheetCompleteness,
  type DishSheet, type AllergenChoice,
} from '@/lib/dish-sheet'

// ── <DishSheetModal /> — the resto-side TECHNICAL SHEET view (Mission 6) ──────
//
// Production view of the licensed asset, fetched from GET /api/dishes/[id]/sheet
// (the D1 server lock: only adopters/creator/admin ever get a 200 — this modal
// shows a clean not-available state on 404). Features:
//   • simple ×N servings scaling (client-side arithmetic on the base servings),
//   • numbered steps, prominent allergens (the resto's legal display duty),
//   • equipment + plating, sober PRINTABLE layout (basic print CSS).

type SheetPayload = {
  dish:  { id: string; name: string; photo: string | null; cuisineType: string; suggestedPrice: number }
  sheet: DishSheet | null
  completeness: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export default function DishSheetModal({
  dishId, onClose,
}: {
  dishId:  string
  onClose: () => void
}) {
  const t  = useTranslations('menu.sheet')
  const ta = useTranslations('creators.allergens')
  const td = useTranslations('creators.difficulty')

  const [data,    setData]    = useState<SheetPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [servings, setServings] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/dishes/${dishId}/sheet`, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!alive) return
        if (!r.ok) { setError((body?.error as string) || t('loadError')); return }
        setData(body as SheetPayload)
        const base = (body as SheetPayload).sheet?.baseServings
        setServings(base && base > 0 ? base : null)
      })
      .catch(() => { if (alive) setError(t('loadError')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dishId])

  const sheet = data?.sheet ?? null
  const base  = sheet?.baseServings && sheet.baseServings > 0 ? sheet.baseServings : null
  const factor = base && servings ? servings / base : 1

  const scaled = useMemo(() => (sheet?.ingredients ?? []).map((i) => ({
    ...i,
    qtyScaled: i.qty != null ? round2(i.qty * factor) : null,
  })), [sheet, factor])

  const allergens: AllergenChoice[] = sheet?.allergens ?? []
  const totalMinutes = (sheet?.prepMinutes ?? 0) + (sheet?.cookMinutes ?? 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      {/* Basic print CSS: only the sheet block is visible when printing. */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #dish-sheet-print, #dish-sheet-print * { visibility: visible !important; }
        #dish-sheet-print { position: absolute !important; inset: 0 !important; overflow: visible !important; max-height: none !important; }
        .no-print { display: none !important; }
      }`}</style>
      <div id="dish-sheet-print" className="flex max-h-[94vh] w-full max-w-lg flex-col rounded-t-3xl bg-white sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-grubano-border p-4">
          <p className="text-base font-bold text-grubano-ink">{t('title')}</p>
          <div className="flex items-center gap-1.5 no-print">
            <Button type="button" variant="secondary" size="sm" leftIcon={<Printer size={13} />}
              onClick={() => window.print()}>
              {t('print')}
            </Button>
            <button type="button" onClick={onClose} aria-label={t('close')}
              className="grid h-9 w-9 place-items-center rounded-xl bg-grubano-surface-muted">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loading ? (
            <p className="flex items-center gap-2 py-8 text-sm text-grubano-ink-muted">
              <Loader2 size={15} className="animate-spin" /> {t('loading')}
            </p>
          ) : error ? (
            <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2.5 text-[12px] text-grubano-danger">{error}</p>
          ) : !data ? null : (
            <>
              {/* Dish identity */}
              <div>
                <p className="text-lg font-bold text-grubano-ink">{data.dish.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-grubano-ink-muted">
                  <Badge size="sm">{data.dish.cuisineType}</Badge>
                  {sheet?.difficulty && <Badge size="sm">{td(sheet.difficulty)}</Badge>}
                  {totalMinutes > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} />
                      {t('timing', { prep: sheet?.prepMinutes ?? 0, cook: sheet?.cookMinutes ?? 0 })}
                    </span>
                  )}
                </div>
              </div>

              {!sheet ? (
                <p className="rounded-grubano-lg bg-grubano-surface px-3 py-2.5 text-[12px] text-grubano-ink-muted">
                  {t('noSheet')}
                </p>
              ) : (
                <>
                  {/* ALLERGENS — prominent (the resto MUST display them) */}
                  {allergens.length > 0 && (
                    <div className="rounded-grubano-lg border border-grubano-warning/40 bg-grubano-warning-tint px-3 py-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink">
                        <AlertTriangle size={12} className="text-grubano-warning" /> {t('allergensTitle')}
                      </p>
                      <p className="mt-1 text-[13px] font-semibold text-grubano-ink">
                        {allergens.map((a) => ta(a)).join(' · ')}
                      </p>
                    </div>
                  )}

                  {/* Servings scaling */}
                  {base && (
                    <div className="flex items-center gap-3 rounded-grubano-lg bg-grubano-surface px-3 py-2.5 no-print">
                      <label className="text-[11px] font-bold uppercase tracking-wide text-grubano-ink-muted">
                        {t('servingsLabel')}
                      </label>
                      <input
                        type="number" min="1" step="1" value={servings ?? base}
                        onChange={(e) => { const n = Number(e.target.value); setServings(Number.isFinite(n) && n >= 1 ? Math.floor(n) : base) }}
                        className="w-20 rounded-grubano-lg border border-grubano-border bg-white px-2 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-grubano-primary"
                      />
                      <span className="text-[11px] text-grubano-ink-faint">{t('servingsBase', { base })}</span>
                    </div>
                  )}

                  {/* Quantified ingredients (scaled) */}
                  {scaled.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-muted">
                        {t('ingredientsTitle', { servings: servings ?? base ?? 0 })}
                      </p>
                      <ul className="divide-y divide-grubano-border rounded-grubano-lg border border-grubano-border">
                        {scaled.map((i, idx) => (
                          <li key={idx} className="flex items-center justify-between px-3 py-2 text-[13px]">
                            <span className="text-grubano-ink">{i.name}</span>
                            <span className="font-semibold text-grubano-ink">
                              {i.qtyScaled != null ? `${i.qtyScaled} ${i.unit}`.trim() : i.unit || '—'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Numbered steps */}
                  {(sheet.steps?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-muted">
                        {t('stepsTitle')}
                      </p>
                      <ol className="space-y-2">
                        {sheet.steps!.map((s, i) => (
                          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-grubano-ink">
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-grubano-primary text-[10px] font-bold text-white">
                              {i + 1}
                            </span>
                            <span className="min-w-0">{s}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Equipment */}
                  {(sheet.equipment?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-muted">
                        <UtensilsCrossed size={12} /> {t('equipmentTitle')}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {sheet.equipment!.map((e) => <Badge key={e} size="sm">{e}</Badge>)}
                      </div>
                    </div>
                  )}

                  {/* Plating */}
                  {sheet.platingNotes && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-muted">
                        <Sparkles size={12} /> {t('platingTitle')}
                      </p>
                      <p className="rounded-grubano-lg bg-grubano-surface px-3 py-2.5 text-[13px] leading-relaxed text-grubano-ink">
                        {sheet.platingNotes}
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] text-grubano-ink-faint">
                    {t('completenessLine', { pct: sheetCompleteness(sheet) })}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
