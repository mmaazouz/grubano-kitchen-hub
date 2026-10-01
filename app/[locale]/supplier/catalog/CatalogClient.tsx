'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import { CATALOG_UNITS } from '@/lib/supplier-catalog'
import { INCO_ALLERGENS } from '@/lib/dish-sheet'
import './supplier-catalog.css'

// ── CatalogClient — CD v1 Lot 2 catalogue (list ↔ detail). Wired to the REAL API
// (/api/supplier/catalog, owner-scoped server-side): GET reload, POST/PUT save,
// DELETE remove, inline availability toggle (PUT partial), CSV import. Prices are
// EUR in the form → CENTS server-side; displayed via formatMoney. No money is moved.
// HONEST omissions vs the CD mockup (no backing column, no migration): the SKU /
// Référence field and the product photo upload are NOT rendered.

export interface CatalogItem {
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

const THUMB_GRADS = [
  'linear-gradient(135deg,#FFC24A,#F0A63A)',
  'linear-gradient(135deg,#E8735E,#C94F3A)',
  'linear-gradient(135deg,#8A2C3B,#5E1A24)',
  'linear-gradient(135deg,#6FB6F5,#2E78F0)',
  'linear-gradient(135deg,#41BD78,#1E9E57)',
  'linear-gradient(135deg,#8992A3,#5B6472)',
]
function gradFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return THUMB_GRADS[h % THUMB_GRADS.length]
}

export default function CatalogClient({ initialItems }: { initialItems: CatalogItem[] }) {
  const t  = useTranslations('supplierCat')
  const tu = useTranslations('supplier')            // unit labels (uKg…) + allergen namespace lives elsewhere
  const ta = useTranslations('creators.allergens')
  const locale = useLocale()

  const [items, setItems]   = useState<CatalogItem[]>(initialItems)
  const [view, setView]     = useState<'list' | 'detail'>('list')
  const [form, setForm]     = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [catFilter, setCatFilter] = useState('__all')
  const [query, setQuery]   = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items],
  )
  const outCount = items.filter((i) => !i.available).length
  const filtered = items.filter((i) =>
    (catFilter === '__all' || i.category === catFilter) &&
    (!query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase())),
  )

  const unitLabel = (u: string) => tu(`u${u.charAt(0).toUpperCase()}${u.slice(1)}` as 'uKg')

  function openAdd()  { setFormError(''); setForm({ ...EMPTY_FORM }); setView('detail') }
  function openEdit(it: CatalogItem) {
    setFormError('')
    setForm({
      id: it.id, name: it.name, category: it.category, priceEur: (it.priceCents / 100).toString(),
      unit: it.unit, packSize: it.packSize ?? '', description: it.description ?? '',
      available: it.available, allergens: Array.isArray(it.allergens) ? it.allergens : [],
    })
    setView('detail')
  }
  function closeDetail() { setForm(null); setView('list') }
  function toggleAllergen(a: string) {
    setForm((f) => f && ({ ...f, allergens: f.allergens.includes(a) ? f.allergens.filter((x) => x !== a) : [...f.allergens, a] }))
  }

  async function reload() {
    const r = await fetch('/api/supplier/catalog', { cache: 'no-store' })
    if (r.ok) { const d = await r.json().catch(() => null); if (d && Array.isArray(d.items)) setItems(d.items) }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || saving) return
    setSaving(true); setFormError('')
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
      if (!res.ok) { const d = await res.json().catch(() => null); setFormError(d?.error || t('errSave')); return }
      await reload()
      closeDetail()
    } catch { setFormError(t('errSave')) }
    finally { setSaving(false) }
  }

  async function remove(it: CatalogItem) {
    if (!confirm(t('confirmDelete', { name: it.name }))) return
    const res = await fetch(`/api/supplier/catalog?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' })
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== it.id))
  }

  async function toggleAvail(it: CatalogItem) {
    const next = !it.available
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, available: next } : x)) // optimistic
    const res = await fetch('/api/supplier/catalog', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id, available: next }),
    })
    if (!res.ok) setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, available: it.available } : x)) // rollback
  }

  // ── DETAIL (add / edit) ─────────────────────────────────────────────────────
  if (view === 'detail' && form) {
    return (
      <section className="sup-cat">
        <button className="back-link" onClick={closeDetail}><span className="ms flip-rtl">arrow_back</span>{t('title')}</button>
        <form className="op-card prod-form" onSubmit={save}>
          <h2>{form.id ? t('editTitle') : t('addTitle')}</h2>
          <div className="field-stack">
            {formError && <div className="form-err">{formError}</div>}

            <div className="op-field">
              <label htmlFor="fName">{t('fName')}</label>
              <input id="fName" className="op-input" type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            <div className="op-field-row">
              <div className="op-field">
                <label htmlFor="fCat">{t('fCategory')}</label>
                <input id="fCat" className="op-input" type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t('catPlaceholder')} />
              </div>
              <div className="op-field">
                <label htmlFor="fPack">{t('fPackSize')}</label>
                <input id="fPack" className="op-input" type="text" value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })} placeholder={t('packPlaceholder')} />
              </div>
            </div>

            <div className="op-field-row">
              <div className="op-field">
                <label htmlFor="fPrice">{t('fPrice')}</label>
                <input id="fPrice" className="op-input mono" type="text" inputMode="decimal" required value={form.priceEur} onChange={(e) => setForm({ ...form, priceEur: e.target.value })} placeholder="12,50" />
              </div>
              <div className="op-field">
                <label htmlFor="fUnit">{t('fUnit')}</label>
                <select id="fUnit" className="op-select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {CATALOG_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>
              </div>
            </div>

            <div className="op-field">
              <label htmlFor="fDesc">{t('fDescription')}</label>
              <textarea id="fDesc" className="op-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="op-field">
              <label>{t('fAllergens')}</label>
              <div className="alrg-chips">
                {INCO_ALLERGENS.map((a) => (
                  <button key={a} type="button" className={`alrg-chip${form.allergens.includes(a) ? ' is-on' : ''}`} onClick={() => toggleAllergen(a)}>{ta(a)}</button>
                ))}
              </div>
            </div>

            <div className="avail-row">
              <div><b>{t('availTitle')}</b><span>{t('availSub')}</span></div>
              <label className="op-switch">
                <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} />
                <span className="track" />
              </label>
            </div>
          </div>

          <div className="form-foot">
            <button type="button" className="op-btn-ghost" onClick={closeDetail}>{t('cancel')}</button>
            <button type="submit" className="op-btn-primary" disabled={saving}><span className="ms">check</span>{saving ? t('saving') : t('save')}</button>
          </div>
        </form>
      </section>
    )
  }

  // ── LIST ────────────────────────────────────────────────────────────────────
  return (
    <section className="sup-cat">
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('summary', { count: items.length, out: outCount })}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="op-btn-ghost" onClick={() => setImportOpen(true)}><span className="ms">upload</span>{t('importCsv')}</button>
          <button className="op-btn-add" onClick={openAdd}><span className="ms">add</span>{t('addProduct')}</button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms">inventory_2</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
          <button className="op-btn-primary" onClick={openAdd} style={{ marginTop: 18 }}><span className="ms">add</span>{t('addFirst')}</button>
        </div></div>
      ) : (
        <>
          <div className="cat-filters">
            <div className="cat-chips">
              <button className={`cat-chip${catFilter === '__all' ? ' is-active' : ''}`} onClick={() => setCatFilter('__all')}>{t('filterAll')}</button>
              {categories.map((c) => (
                <button key={c} className={`cat-chip${catFilter === c ? ' is-active' : ''}`} onClick={() => setCatFilter(c)}>{c}</button>
              ))}
            </div>
            <div className="cat-search"><span className="ms">search</span>
              <input type="text" placeholder={t('searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          <div className="op-card">
            {filtered.length === 0 ? (
              <div className="op-emptyline"><span className="ms">search_off</span><b>{t('noMatch')}</b></div>
            ) : filtered.map((it) => (
              <div key={it.id} className="prod-row" onClick={() => openEdit(it)}>
                <span className="prod-thumb" style={{ background: gradFor(it.category || it.name) }}><span className="ms">inventory_2</span></span>
                <div className="prod-m">
                  <b>{it.name}</b>
                  <div className="prod-meta">
                    {it.packSize && <span className="prod-pack">{it.packSize}</span>}
                    {it.category && <span className="prod-cat-tag">{it.category}</span>}
                  </div>
                </div>
                <span className="prod-price">{formatMoney(it.priceCents, locale)}</span>
                <div className="prod-avail" onClick={(e) => e.stopPropagation()}>
                  <span className={`prod-avail-label ${it.available ? 'instock' : 'out'}`}><i className="dot" />{it.available ? t('inStock') : t('outStock')}</span>
                  <label className="op-switch">
                    <input type="checkbox" checked={it.available} onChange={() => toggleAvail(it)} aria-label={t('toggleAvail')} />
                    <span className="track" />
                  </label>
                </div>
                <div className="prod-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn-sm" onClick={() => openEdit(it)} title={t('edit')} aria-label={t('edit')}><span className="ms">edit</span></button>
                  <button className="icon-btn-sm danger" onClick={() => remove(it)} title={t('delete')} aria-label={t('delete')}><span className="ms">delete</span></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {importOpen && <ImportPanel onClose={() => setImportOpen(false)} onDone={reload} />}
    </section>
  )
}

// ── CSV import — compact op-styled modal (real: POST /api/supplier/catalog/import) ─
function ImportPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations('supplierCat')
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
      setResult(d); onDone()
    } catch { setError(t('errSave')) }
    finally { setBusy(false) }
  }

  return (
    <div className="sup-cat-modal" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)', padding: 16 }}>
      <div className="op-card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--op-font-display)', fontWeight: 800, fontSize: 17 }}>{t('importTitle')}</h2>
          <button className="icon-btn-sm" onClick={onClose} aria-label={t('close')}><span className="ms">close</span></button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--op-muted)', margin: '0 0 8px' }}>{t('importHint')}</p>
        <p className="mono" style={{ fontSize: 11, color: 'var(--op-muted-2)', background: 'var(--op-surface-2)', borderRadius: 8, padding: '8px 10px' }}>{t('importColumns')}</p>
        {!result && (
          <label className="op-btn-ghost" style={{ marginTop: 14, width: '100%', cursor: 'pointer', borderStyle: 'dashed' }}>
            <span className="ms">upload</span>{busy ? t('importing') : t('importPick')}
            <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={onFile} />
          </label>
        )}
        {error && <div className="form-err" style={{ marginTop: 12 }}>{error}</div>}
        {result && (
          <div style={{ marginTop: 14 }}>
            <div style={{ background: 'var(--op-success-bg)', color: 'var(--op-success)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, fontWeight: 700 }}>
              {t('importDone', { created: result.created, skipped: result.skipped, invalid: result.invalid })}
            </div>
            <button className="op-btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={onClose}>{t('close')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
