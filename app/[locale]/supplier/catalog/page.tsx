'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, Upload, Pencil, Trash2, Package, ArrowLeft, X, Check, Loader2 } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input, Badge, EmptyState } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import { formatMoney } from '@/lib/format-money'
import { CATALOG_UNITS } from '@/lib/supplier-catalog'
import { INCO_ALLERGENS } from '@/lib/dish-sheet'

// ── /supplier/catalog — the supplier's own catalogue management (Slice 1) ─────
// Gated supplier/admin by middleware. List + add/edit/delete + CSV import, all
// scoped server-side to the connected supplier (/api/supplier/catalog). Prices in
// euros in the form → cents server-side; displayed via format-money.

interface CatalogItem {
  id: string
  name: string
  description: string | null
  category: string
  priceCents: number
  unit: string
  packSize: string | null
  available: boolean
  allergens: string[]
}

type FormState = {
  id?: string
  name: string
  category: string
  priceEur: string
  unit: string
  packSize: string
  description: string
  available: boolean
  allergens: string[]
}

const EMPTY_FORM: FormState = {
  name: '', category: '', priceEur: '', unit: 'piece', packSize: '', description: '', available: true, allergens: [],
}

export default function SupplierCatalogPage() {
  const t  = useTranslations('supplier')
  const ta = useTranslations('creators.allergens')
  const locale = useLocale()

  const [items, setItems]     = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [form, setForm]       = useState<FormState | null>(null) // null = editor closed
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState('')

  const [importOpen, setImportOpen] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/supplier/catalog', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setLoadError(t('errLoad')))
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd()  { setFormError(''); setForm({ ...EMPTY_FORM }) }
  function openEdit(it: CatalogItem) {
    setFormError('')
    setForm({
      id: it.id, name: it.name, category: it.category, priceEur: (it.priceCents / 100).toString(),
      unit: it.unit, packSize: it.packSize ?? '', description: it.description ?? '',
      available: it.available, allergens: Array.isArray(it.allergens) ? it.allergens : [],
    })
  }

  function toggleAllergen(a: string) {
    setForm((f) => f && ({ ...f, allergens: f.allergens.includes(a) ? f.allergens.filter((x) => x !== a) : [...f.allergens, a] }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || saving) return
    setSaving(true)
    setFormError('')
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || 'autre',
      priceEur: Number(form.priceEur.replace(',', '.')) || 0,
      unit: form.unit,
      packSize: form.packSize.trim() || null,
      description: form.description.trim() || null,
      available: form.available,
      allergens: form.allergens,
    }
    try {
      const res = await fetch('/api/supplier/catalog', {
        method:  form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form.id ? { id: form.id, ...payload } : payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setFormError(d?.error || t('errSave'))
        return
      }
      setForm(null)
      load()
    } catch {
      setFormError(t('errSave'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(it: CatalogItem) {
    if (!confirm(t('confirmDelete', { name: it.name }))) return
    const res = await fetch(`/api/supplier/catalog?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' })
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== it.id))
  }

  const unitLabel = (u: string) => t(`u${u.charAt(0).toUpperCase()}${u.slice(1)}` as 'uKg')

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-4xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Package size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{t('catalogTitle')}</h1>
          </div>
          <Link href="/supplier/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-white/70 hover:text-white">
            <ArrowLeft size={15} /> {t('catalogBack')}
          </Link>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-4xl px-5 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-grubano-ink-muted">{t('catalogSubtitle')}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Upload size={15} />} onClick={() => setImportOpen(true)}>
              {t('importCsv')}
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={openAdd}>
              {t('addProduct')}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
        ) : loadError ? (
          <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{loadError}</p></Card>
        ) : items.length === 0 ? (
          <Card elevation="sm" padding="lg">
            <EmptyState
              emoji="📦"
              title={t('catalogEmptyTitle')}
              description={t('catalogEmptyDesc')}
              action={
                <Button variant="primary" size="md" leftIcon={<Plus size={16} />} onClick={openAdd}>
                  {t('addFirstProduct')}
                </Button>
              }
            />
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id}>
                <Card elevation="sm" padding="md">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-grubano-ink truncate">{it.name}</h3>
                        {!it.available && <Badge tone="neutral" size="sm">{t('outStock')}</Badge>}
                      </div>
                      <p className="text-xs text-grubano-ink-muted truncate">
                        {it.category}{it.packSize ? ` · ${it.packSize}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold text-grubano-ink">{formatMoney(it.priceCents, locale)}</p>
                      <p className="text-[11px] text-grubano-ink-faint">/ {unitLabel(it.unit)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => openEdit(it)} aria-label={t('edit')} className="grid h-8 w-8 place-items-center rounded-grubano-md text-grubano-ink-muted hover:bg-grubano-surface-muted">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => remove(it)} aria-label={t('delete')} className="grid h-8 w-8 place-items-center rounded-grubano-md text-grubano-danger hover:bg-grubano-danger-tint">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* ── Add / Edit editor ── */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !saving && setForm(null)}>
          <div className="w-full max-w-lg rounded-t-grubano-2xl bg-grubano-surface p-5 sm:rounded-grubano-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-grubano-ink">{form.id ? t('editTitle') : t('addTitle')}</h2>
              <button onClick={() => !saving && setForm(null)} aria-label={t('cancel')}><X size={18} className="text-grubano-ink-muted" /></button>
            </div>
            <form onSubmit={save} className="space-y-3">
              {formError && <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{formError}</p>}
              <Input label={t('fName')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('fCategory')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Viande, Crémerie…" />
                <Input label={t('fPackSize')} value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })} placeholder="carton de 6" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('fPrice')} type="number" inputMode="decimal" min={0} step="0.01" required value={form.priceEur} onChange={(e) => setForm({ ...form, priceEur: e.target.value })} placeholder="12.50" />
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('fUnit')}</label>
                  <select
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none"
                  >
                    {CATALOG_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('fDescription')}</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20"
                />
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium text-grubano-ink">{t('fAllergens')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {INCO_ALLERGENS.map((a) => {
                    const on = form.allergens.includes(a)
                    return (
                      <button key={a} type="button" onClick={() => toggleAllergen(a)}
                        className={`rounded-grubano-pill px-2.5 py-1 text-[11px] font-semibold ${on ? 'bg-grubano-ink text-white' : 'border border-grubano-border text-grubano-ink-muted'}`}>
                        {ta(a)}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1 text-[10px] text-grubano-ink-faint">{t('fAllergensHint')}</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-grubano-ink-muted">
                <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} className="h-4 w-4 accent-grubano-primary" />
                {t('fAvailable')}
              </label>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" size="md" fullWidth onClick={() => setForm(null)}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" size="md" fullWidth loading={saving} leftIcon={saving ? undefined : <Check size={16} />}>
                  {saving ? t('saving') : t('save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {importOpen && <ImportPanel onClose={() => setImportOpen(false)} onDone={load} />}
    </div>
  )
}

// ── CSV import sub-panel ──
function ImportPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations('supplier')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number; invalid: number; errors: { line: number; message: string }[] } | null>(null)
  const [error, setError] = useState('')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(''); setResult(null)
    try {
      const csv = await file.text()
      const res = await fetch('/api/supplier/catalog/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setError(d?.error || t('errSave')); return }
      setResult(d)
      onDone()
    } catch {
      setError(t('errSave'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-grubano-2xl bg-grubano-surface p-5 sm:rounded-grubano-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-grubano-ink">{t('importTitle')}</h2>
          <button onClick={onClose} aria-label={t('close')}><X size={18} className="text-grubano-ink-muted" /></button>
        </div>
        <p className="text-sm text-grubano-ink-muted">{t('importHint')}</p>
        <p className="mt-1 rounded-grubano-md bg-grubano-surface-muted px-3 py-2 font-mono text-[11px] text-grubano-ink-muted">{t('importColumns')}</p>

        {!result && (
          <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-grubano-lg border-2 border-dashed border-grubano-border px-4 py-6 text-sm font-medium text-grubano-ink-muted hover:border-grubano-primary/50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {busy ? t('importing') : t('importPick')}
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy} onChange={onFile} />
          </label>
        )}

        {error && <p className="mt-3 rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error}</p>}

        {result && (
          <div className="mt-4 space-y-3">
            <p className="rounded-grubano-lg bg-grubano-success-tint px-3 py-2.5 text-sm font-semibold text-grubano-ink">
              {t('importDone', { created: result.created, skipped: result.skipped, invalid: result.invalid })}
            </p>
            {result.errors.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-grubano-ink-faint">{t('importErrors')}</p>
                <ul className="max-h-40 space-y-0.5 overflow-auto text-[12px] text-grubano-ink-muted">
                  {result.errors.map((er, i) => <li key={i}>L{er.line} — {er.message}</li>)}
                </ul>
              </div>
            )}
            <Button variant="primary" size="md" fullWidth onClick={onClose}>{t('close')}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
