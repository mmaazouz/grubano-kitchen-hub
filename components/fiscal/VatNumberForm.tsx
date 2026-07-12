'use client'

// P4.4-A — minimal operator settings card: set your own VAT number (shown on Grubano's
// commission invoices to you). Owner-scoped server-side (/api/operator/vat-number reads
// the session operator). Money-neutral (display only). Uses an INLINE status (no toast
// context) so the static /more page prerenders without a ToastProvider.

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/design-system'

type Status = 'idle' | 'saved' | 'cleared' | 'error'

export default function VatNumberForm() {
  const t = useTranslations('fiscal')
  const [value, setValue] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    let alive = true
    fetch('/api/operator/vat-number')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setValue(d.vatNumber ?? '') })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  if (!loaded) return null

  const save = async () => {
    setSaving(true)
    setStatus('idle')
    try {
      const res = await fetch('/api/operator/vat-number', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vatNumber: value.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setStatus('error'); return }
      setValue(data.vatNumber ?? '')
      setStatus((data.vatNumber ?? '').length > 0 ? 'saved' : 'cleared')
    } catch {
      setStatus('error')
    } finally { setSaving(false) }
  }

  return (
    <div className="mb-5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('title')}</p>
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-sm text-muted-foreground">{t('subtitle')}</p>
        <label className="mb-1 block text-[13px] font-semibold text-foreground">{t('vatLabel')}</label>
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setStatus('idle') }}
          maxLength={20}
          placeholder={t('vatPlaceholder')}
          className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px]"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className={`text-[13px] ${status === 'error' ? 'text-grubano-danger' : 'text-grubano-primary'}`}>
            {status === 'saved' ? t('saved') : status === 'cleared' ? t('cleared') : status === 'error' ? t('error') : ''}
          </span>
          <Button size="sm" variant="primary" loading={saving} onClick={save}>{t('save')}</Button>
        </div>
      </div>
    </div>
  )
}
