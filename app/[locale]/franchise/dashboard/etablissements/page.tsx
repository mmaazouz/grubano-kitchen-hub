'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, Plus, Pencil, Trash2, Store, Loader2, Tag } from 'lucide-react'
import { Card, Button, Input, Badge, EmptyState, Modal } from '@/components/design-system'

// ── /franchise/dashboard/etablissements — franchisor points-of-sale management (B3) ─
// Lists the franchisor's OWN points of sale and lets them create / edit / delete one,
// each linked to ONE of the operator's OWN restaurants (1:1) + optionally a brand.
// Reads/writes /api/franchise/pos (owner-scoped, no IDOR). Renders inside the franchise
// dashboard layout (sidebar + mobile header). STRUCTURE-only — changes nothing about
// orders, payment, royalties or the dashboard (those stay inert until B5 tags orders).

type POS = {
  id: string; name: string; address: string | null; city: string | null
  isActive: boolean; brandId: string | null
  restaurant: { id: string; name: string; city: string } | null
  brand_ref:  { id: string; name: string; emoji: string } | null
}
type Resto = { id: string; name: string; city: string; pointOfSaleId: string | null }
type BrandLite = { id: string; name: string; emoji: string }

const selectClass =
  'w-full rounded-grubano-lg border border-grubano-line bg-white px-3 py-2.5 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none disabled:bg-grubano-surface-muted disabled:text-grubano-ink-faint'

export default function FranchiseEtablissementsPage() {
  const t = useTranslations('franchise.locations')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [list, setList] = useState<POS[]>([])
  const [restaurants, setRestaurants] = useState<Resto[]>([])
  const [brands, setBrands] = useState<BrandLite[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<POS | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [restaurantId, setRestaurantId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/franchise/pos', { cache: 'no-store' })
      if (!res.ok) { setLoadError(true); return }
      const j = await res.json()
      setList(j.pointsOfSale ?? [])
      setRestaurants(j.restaurants ?? [])
      setBrands(j.brands ?? [])
    } catch { setLoadError(true) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Restaurants selectable for the link: those not yet linked + (when editing) the one
  // already linked to THIS POS (so it stays visible/selectable).
  const linkable = restaurants.filter((r) => !r.pointOfSaleId || r.id === editing?.restaurant?.id)

  function openCreate() {
    setEditing(null); setName(''); setAddress(''); setCity(''); setRestaurantId(''); setBrandId(''); setFormError('')
    setModalOpen(true)
  }
  function openEdit(p: POS) {
    setEditing(p)
    setName(p.name); setAddress(p.address ?? ''); setCity(p.city ?? '')
    setRestaurantId(p.restaurant?.id ?? ''); setBrandId(p.brandId ?? ''); setFormError('')
    setModalOpen(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setFormError('')
    try {
      const isEdit = !!editing
      // CREATE: omit empty optional links (POST schema rejects null). EDIT: send null to
      // explicitly unset/unlink (PATCH schema is nullable).
      const body = isEdit
        ? { name, address: address || null, city: city || null, restaurantId: restaurantId || null, brandId: brandId || null }
        : {
            name,
            ...(address ? { address } : {}),
            ...(city ? { city } : {}),
            ...(restaurantId ? { restaurantId } : {}),
            ...(brandId ? { brandId } : {}),
          }
      const res = await fetch(isEdit ? `/api/franchise/pos/${editing!.id}` : '/api/franchise/pos', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setFormError(data?.error || t('errorGeneric')); return }
      setModalOpen(false)
      setLoading(true)
      await load()
    } catch { setFormError(t('errorGeneric')) }
    finally { setSaving(false) }
  }

  async function remove(p: POS) {
    if (!window.confirm(t('deleteConfirm'))) return
    try {
      const res = await fetch(`/api/franchise/pos/${p.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        window.alert(data?.error || t('errorGeneric'))
        return
      }
      setLoading(true)
      await load()
    } catch { window.alert(t('errorGeneric')) }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('title')}</h1>
          <p className="mt-1 text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
        {!loading && !loadError && (
          <Button variant="primary" size="sm" onClick={openCreate}>
            <Plus size={16} className="mr-1.5" /> {t('addCta')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-grubano-ink-muted"><Loader2 className="animate-spin" size={22} /></div>
      ) : loadError ? (
        <Card elevation="sm" padding="lg" className="mt-6 text-center text-sm text-grubano-ink-muted">{t('loadError')}</Card>
      ) : list.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            emoji={<MapPin size={32} className="text-grubano-primary" />}
            title={t('empty')}
            description={t('emptyDesc')}
            action={<Button variant="primary" size="sm" onClick={openCreate}><Plus size={16} className="mr-1.5" />{t('addCta')}</Button>}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {list.map((p) => (
            <Card key={p.id} elevation="sm" padding="md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-grubano-ink">{p.name}</h2>
                    <Badge tone={p.isActive ? 'success' : 'neutral'} size="sm">
                      {p.isActive ? t('statusActive') : t('statusInactive')}
                    </Badge>
                  </div>
                  <dl className="mt-2 space-y-1 text-sm text-grubano-ink-muted">
                    {p.city && <dd className="flex items-center gap-1.5"><MapPin size={14} className="shrink-0 text-grubano-ink-faint" />{p.city}</dd>}
                    <dd className="flex items-center gap-1.5">
                      <Store size={14} className="shrink-0 text-grubano-ink-faint" />
                      <span className="font-medium text-grubano-ink">{t('colRestaurant')}:</span>{' '}
                      {p.restaurant ? p.restaurant.name : <span className="text-grubano-ink-faint">{t('linkNone')}</span>}
                    </dd>
                    <dd className="flex items-center gap-1.5">
                      <Tag size={14} className="shrink-0 text-grubano-ink-faint" />
                      <span className="font-medium text-grubano-ink">{t('colBrand')}:</span>{' '}
                      {p.brand_ref ? `${p.brand_ref.emoji} ${p.brand_ref.name}` : <span className="text-grubano-ink-faint">{t('brandNone')}</span>}
                    </dd>
                  </dl>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)} aria-label={t('edit')}><Pencil size={15} /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(p)} aria-label={t('delete')}><Trash2 size={15} className="text-grubano-danger" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => !saving && setModalOpen(false)} title={editing ? t('editTitle') : t('createTitle')} size="md">
        <form onSubmit={save} className="space-y-4 pb-2">
          {formError && (
            <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">{formError}</p>
          )}

          <Input label={t('fieldName')} required value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label={t('fieldAddress')} value={address} onChange={(e) => setAddress(e.target.value)} />
            <Input label={t('fieldCity')} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>

          <div>
            <label htmlFor="pos-restaurant" className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('fieldRestaurant')}</label>
            {linkable.length === 0 && !restaurantId ? (
              <p className="rounded-grubano-lg bg-grubano-surface-muted px-3 py-2.5 text-xs text-grubano-ink-muted">{t('noLinkable')}</p>
            ) : (
              <>
                <select id="pos-restaurant" className={selectClass} value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
                  <option value="">{t('optionNoRestaurant')}</option>
                  {linkable.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}{r.city ? ` — ${r.city}` : ''}</option>
                  ))}
                </select>
                <p className="mt-1 text-grubano-xs text-grubano-ink-faint">{t('restaurantHint')}</p>
              </>
            )}
          </div>

          <div>
            <label htmlFor="pos-brand" className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('fieldBrand')}</label>
            <select id="pos-brand" className={selectClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">{t('optionNoBrand')}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="ghost" size="md" fullWidth onClick={() => setModalOpen(false)} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" fullWidth loading={saving}>
              {saving ? (editing ? t('saving') : t('creating')) : (editing ? t('save') : t('create'))}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
