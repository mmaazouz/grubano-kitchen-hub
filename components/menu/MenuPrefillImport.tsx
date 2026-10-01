'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, Upload, Trash2, Check, Loader2, RotateCcw } from 'lucide-react'
import { Card, Button, Input } from '@/components/design-system'
import { ALLOWED_MENU_MEDIA, MAX_MENU_FILE_BYTES, type DraftDish } from '@/lib/menu-extract'

// ── MenuPrefillImport — AI menu prefill (onboarding copilot brique 1, Agent 89) ───
// SELF-GATING: probes GET /api/menu/scan-card; renders NOTHING when the feature flag
// is OFF (or no brand selected) → the menu builder stays byte-identical. When ON:
// upload a photo/PDF → POST /api/menu/scan-card extracts a DRAFT → the user edits/
// deletes each row → CONFIRM creates the dishes via the EXISTING POST /api/menu (same
// validation, owner-scoped). NOTHING is saved before the user clicks Confirm.

type Row = DraftDish & { _key: string }
type Phase = 'idle' | 'extracting' | 'review' | 'confirming'

export default function MenuPrefillImport({ brandId, onConfirmed }: { brandId: string; onConfirmed: () => void }) {
  const t = useTranslations('menu.aiCard')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [phase, setPhase]     = useState<Phase>('idle')
  const [rows, setRows]       = useState<Row[]>([])
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/menu/scan-card', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => { if (!cancelled) setEnabled(!!d?.enabled) })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [])

  // Flag OFF / unknown / no brand → render nothing (byte-identical menu builder).
  if (!enabled || !brandId) return null

  async function onFile(file: File) {
    setError(null); setDone(null)
    if (!(ALLOWED_MENU_MEDIA as readonly string[]).includes(file.type)) { setError(t('errorFile')); return }
    if (file.size > MAX_MENU_FILE_BYTES) { setError(t('errorTooLarge')); return }
    setPhase('extracting')
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(new Error('read'))
        fr.readAsDataURL(file)
      })
      const fileBase64 = dataUrl.split(',')[1] ?? ''
      const res = await fetch('/api/menu/scan-card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, mediaType: file.type }),
      })
      if (res.status === 429) { setError(t('errorQuota')); setPhase('idle'); return }
      if (!res.ok) { setError(t('errorGeneric')); setPhase('idle'); return }
      const data = (await res.json()) as { draft?: DraftDish[] }
      const draft = Array.isArray(data.draft) ? data.draft : []
      setRows(draft.map((d, i) => ({ ...d, _key: `${i}-${d.name}` })))
      setPhase('review')
    } catch {
      setError(t('errorGeneric')); setPhase('idle')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function patch(key: string, p: Partial<DraftDish>) {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...p } : r)))
  }
  function remove(key: string) {
    setRows((rs) => rs.filter((r) => r._key !== key))
  }

  async function confirm() {
    setPhase('confirming'); setError(null)
    let ok = 0, failed = 0
    // Reuse the EXISTING dish-creation route per item (same validation, owner-scoped).
    for (const r of rows) {
      try {
        const res = await fetch('/api/menu', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId, name: r.name, description: r.description || null, price: r.price, category: r.category }),
        })
        if (res.ok) ok++; else failed++
      } catch { failed++ }
    }
    setDone(failed === 0 ? t('added', { count: ok }) : t('partial', { ok, failed }))
    setRows([]); setPhase('idle')
    onConfirmed()
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
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
          <Button variant="secondary" size="sm" leftIcon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            {t('choose')}
          </Button>
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

          {rows.length === 0 ? (
            <p className="rounded-grubano-md bg-grubano-bg px-3 py-2 text-[12px] text-grubano-ink-muted">{t('empty')}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r._key} className="rounded-grubano-md border border-grubano-border p-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Input label={t('colName')} value={r.name} onChange={(e) => patch(r._key, { name: e.target.value })} />
                      <Input
                        label={t('colPrice')} type="number" inputMode="decimal" min="0" step="0.01"
                        value={String(r.price)}
                        onChange={(e) => patch(r._key, { price: Math.max(0, parseFloat(e.target.value) || 0) })}
                      />
                      <Input label={t('colDesc')} value={r.description} onChange={(e) => patch(r._key, { description: e.target.value })} />
                    </div>
                    <button type="button" onClick={() => remove(r._key)} aria-label={t('remove')}
                      className="mt-6 shrink-0 rounded-grubano-md p-1.5 text-grubano-ink-muted hover:text-grubano-danger">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            {rows.length > 0 && (
              <Button variant="primary" size="sm" leftIcon={<Check size={15} />} loading={phase === 'confirming'} onClick={confirm}>
                {phase === 'confirming' ? t('confirming') : t('confirm')}
              </Button>
            )}
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={15} />} disabled={phase === 'confirming'}
              onClick={() => { setRows([]); setPhase('idle'); setError(null) }}>
              {t('restart')}
            </Button>
          </div>
          {error && <p className="text-[12px] text-grubano-danger">{error}</p>}
        </div>
      )}
    </Card>
  )
}
