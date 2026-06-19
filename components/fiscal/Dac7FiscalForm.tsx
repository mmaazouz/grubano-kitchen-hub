'use client'

// P4.4-C — partner self-declaration of DAC7 fields (on /more). Owner-scoped server-side
// (/api/operator/dac7 reads the session operator). Money-neutral. Inline status (no toast
// context) so the static /more page prerenders without a ToastProvider.

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/design-system'

type Fields = { registeredAddress: string; taxId: string; taxIdCountry: string; dateOfBirth: string; sellerType: string }
const EMPTY: Fields = { registeredAddress: '', taxId: '', taxIdCountry: '', dateOfBirth: '', sellerType: '' }

export default function Dac7FiscalForm() {
  const t = useTranslations('dac7')
  const [f, setF] = useState<Fields>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    let alive = true
    fetch('/api/operator/dac7')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setF({ ...EMPTY, ...d }) })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  if (!loaded) return null

  const set = (k: keyof Fields) => (e: { target: { value: string } }) => { setF((p) => ({ ...p, [k]: e.target.value })); setStatus('idle') }

  const save = async () => {
    setSaving(true); setStatus('idle')
    try {
      const res = await fetch('/api/operator/dac7', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setStatus('error'); return }
      setF({ ...EMPTY, ...d })
      setStatus('saved')
    } catch { setStatus('error') } finally { setSaving(false) }
  }

  const fieldClass = 'w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px]'
  const labelClass = 'mb-1 block text-[13px] font-semibold text-foreground'

  return (
    <div className="mb-5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('title')}</p>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>

        <div>
          <label className={labelClass}>{t('sellerType')}</label>
          <select value={f.sellerType} onChange={set('sellerType')} className={fieldClass}>
            <option value="">{t('unspecified')}</option>
            <option value="entity">{t('entity')}</option>
            <option value="individual">{t('individual')}</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('registeredAddress')}</label>
          <input value={f.registeredAddress} onChange={set('registeredAddress')} maxLength={300} className={fieldClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>{t('taxId')}</label>
            <input value={f.taxId} onChange={set('taxId')} maxLength={40} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{t('taxIdCountry')}</label>
            <input value={f.taxIdCountry} onChange={set('taxIdCountry')} maxLength={2} className={fieldClass} />
          </div>
        </div>
        {f.sellerType === 'individual' && (
          <div>
            <label className={labelClass}>{t('dateOfBirth')}</label>
            <input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} className={fieldClass} />
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className={`text-[13px] ${status === 'error' ? 'text-grubano-danger' : 'text-grubano-primary'}`}>
            {status === 'saved' ? t('saved') : status === 'error' ? t('error') : ''}
          </span>
          <Button size="sm" variant="primary" loading={saving} onClick={save}>{t('save')}</Button>
        </div>
      </div>
    </div>
  )
}
