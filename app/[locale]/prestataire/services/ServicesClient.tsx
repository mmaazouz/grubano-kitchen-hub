'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Pencil, Trash2, Wrench, ArrowLeft, X, Check, Loader2, EyeOff } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input, Badge, EmptyState } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import { SERVICE_CATEGORIES, SERVICE_MODALITIES } from '@/lib/service-offering'

// ── /prestataire/services — the prestataire's OWN service listings (P2, Agent 75) ──
// A CLONE of /supplier/catalog, adapted to SERVICES. List + add/edit/delete, all scoped
// server-side to the connected prestataire (/api/prestataire/services). NO money: a
// service has NO price / stock — it is « sur devis » (title + description + category +
// modality + optional free-text indicative rate). Rendered by the SERVER page.tsx, which
// 404s when PRESTATAIRE_ENABLED is OFF.

interface ServiceItem {
  id: string
  title: string
  description: string | null
  category: string
  modality: string
  indicativeRate: string | null
  active: boolean
}
type FormState = {
  id?: string
  title: string
  category: string
  modality: string
  description: string
  indicativeRate: string
  active: boolean
}
const EMPTY_FORM: FormState = {
  title: '', category: 'other', modality: 'on_site', description: '', indicativeRate: '', active: true,
}

// category / modality → prestataire.* i18n keys (shared with the P1 register form + dashboard).
const SVC_LABEL: Record<string, string> = {
  electricity: 'svcElectricity', plumbing: 'svcPlumbing', haccp: 'svcHaccp', cleaning: 'svcCleaning',
  pest_control: 'svcPestControl', fridge_repair: 'svcFridgeRepair', kitchen_maintenance: 'svcKitchenMaintenance',
  accounting: 'svcAccounting', training: 'svcTraining', other: 'svcOther',
}
const MOD_LABEL: Record<string, string> = { on_site: 'modalityOnSite', remote: 'modalityRemote', both: 'modalityBoth' }

export default function ServicesClient() {
  const t  = useTranslations('prestataire')          // shared svc* + modality* labels
  const ts = useTranslations('prestataire.services') // page-specific copy

  const [items, setItems]       = useState<ServiceItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')

  const [form, setForm]         = useState<FormState | null>(null) // null = editor closed
  const [saving, setSaving]     = useState(false)
  const [formError, setFormError] = useState('')

  function load() {
    setLoading(true)
    fetch('/api/prestataire/services', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setLoadError(ts('errLoad')))
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() { setFormError(''); setForm({ ...EMPTY_FORM }) }
  function openEdit(it: ServiceItem) {
    setFormError('')
    setForm({
      id: it.id, title: it.title, category: it.category, modality: it.modality,
      description: it.description ?? '', indicativeRate: it.indicativeRate ?? '', active: it.active,
    })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || saving) return
    setSaving(true); setFormError('')
    const payload = {
      title:          form.title.trim(),
      category:       form.category,
      modality:       form.modality,
      description:    form.description.trim() || null,
      indicativeRate: form.indicativeRate.trim() || null,
      active:         form.active,
    }
    try {
      const res = await fetch('/api/prestataire/services', {
        method:  form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form.id ? { id: form.id, ...payload } : payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setFormError(d?.error || ts('errSave'))
        return
      }
      setForm(null); load()
    } catch {
      setFormError(ts('errSave'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(it: ServiceItem) {
    if (!confirm(ts('confirmDelete', { title: it.title }))) return
    const res = await fetch(`/api/prestataire/services?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' })
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== it.id))
  }

  const svcLabel = (c: string) => (c in SVC_LABEL ? t(SVC_LABEL[c] as 'svcOther') : c)
  const modLabel = (m: string) => t((MOD_LABEL[m] ?? 'modalityOnSite') as 'modalityOnSite')

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-4xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Wrench size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{ts('title')}</h1>
          </div>
          <Link href="/prestataire/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-white/70 hover:text-white">
            <ArrowLeft size={15} /> {ts('back')}
          </Link>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-4xl px-5 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-grubano-ink-muted">{ts('subtitle')}</p>
          <Button variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={openAdd}>
            {ts('add')}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
        ) : loadError ? (
          <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{loadError}</p></Card>
        ) : items.length === 0 ? (
          <Card elevation="sm" padding="lg">
            <EmptyState
              emoji="🛠️"
              title={ts('emptyTitle')}
              description={ts('emptyDesc')}
              action={
                <Button variant="primary" size="md" leftIcon={<Plus size={16} />} onClick={openAdd}>
                  {ts('addFirst')}
                </Button>
              }
            />
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id}>
                <Card elevation="sm" padding="md">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-grubano-ink truncate">{it.title}</h3>
                        <Badge tone="neutral" size="sm">{svcLabel(it.category)}</Badge>
                        {!it.active && (
                          <Badge tone="neutral" size="sm">
                            <span className="inline-flex items-center gap-1"><EyeOff size={11} /> {ts('hidden')}</span>
                          </Badge>
                        )}
                      </div>
                      {it.description && <p className="mt-0.5 text-xs text-grubano-ink-muted line-clamp-2">{it.description}</p>}
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-grubano-ink-faint">
                        <span>{modLabel(it.modality)}</span>
                        <span>{it.indicativeRate?.trim() || ts('onQuote')}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => openEdit(it)} aria-label={ts('edit')} className="grid h-8 w-8 place-items-center rounded-grubano-md text-grubano-ink-muted hover:bg-grubano-surface-muted">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => remove(it)} aria-label={ts('delete')} className="grid h-8 w-8 place-items-center rounded-grubano-md text-grubano-danger hover:bg-grubano-danger-tint">
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
              <h2 className="font-display text-lg font-bold text-grubano-ink">{form.id ? ts('editTitle') : ts('addTitle')}</h2>
              <button onClick={() => !saving && setForm(null)} aria-label={ts('cancel')}><X size={18} className="text-grubano-ink-muted" /></button>
            </div>
            <form onSubmit={save} className="space-y-3">
              {formError && <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{formError}</p>}
              <Input label={ts('fTitle')} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={ts('fTitlePlaceholder')} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{ts('fCategory')}</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none"
                  >
                    {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{svcLabel(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{ts('fModality')}</label>
                  <select
                    value={form.modality}
                    onChange={(e) => setForm({ ...form, modality: e.target.value })}
                    className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none"
                  >
                    {SERVICE_MODALITIES.map((m) => <option key={m} value={m}>{modLabel(m)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{ts('fDescription')}</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20"
                />
              </div>
              <div>
                <Input label={ts('fRate')} value={form.indicativeRate} onChange={(e) => setForm({ ...form, indicativeRate: e.target.value })} placeholder={ts('fRatePlaceholder')} />
                <p className="mt-1 text-[11px] text-grubano-ink-faint">{ts('fRateHint')}</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-grubano-ink-muted">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-grubano-primary" />
                {ts('fActive')}
              </label>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" size="md" fullWidth onClick={() => setForm(null)}>{ts('cancel')}</Button>
                <Button type="submit" variant="primary" size="md" fullWidth loading={saving} leftIcon={saving ? undefined : <Check size={16} />}>
                  {saving ? ts('saving') : ts('save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
