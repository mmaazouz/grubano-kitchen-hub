'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import type { AdminRestaurantsList, EstablishmentStatus } from '@/lib/admin-establishments'

// ── Establishments list — search + status filter (CD ADM2). ──────────────────────
// CLIENT half of /admin/establishments. The server passed the real list + stat counts;
// this component does client-side search + status-chip filtering and links each row to
// the read-only fiche. NO suspension chip (no column). Read-only throughout.

const GRADIENTS = [
  'linear-gradient(135deg,#FF8A3D,#F2570E)', 'linear-gradient(135deg,#8A2C3B,#5E1A24)',
  'linear-gradient(135deg,#3E7D5A,#1E5E3A)', 'linear-gradient(135deg,#5B6EE1,#33409E)',
  'linear-gradient(135deg,#B9740A,#8A5600)', 'linear-gradient(135deg,#2E78F0,#1E56B8)',
]
function avatarFor(name: string): { initials: string; gradient: string } {
  const clean = (name || '?').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase() || '?'
  let h = 0
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0
  return { initials, gradient: GRADIENTS[h % GRADIENTS.length] }
}

const PILL_CLASS: Record<EstablishmentStatus, string> = { active: 'open', pending: 'pending', paused: 'closed' }

type Chip = 'all' | EstablishmentStatus

export default function EstablishmentsClient({ data }: { data: AdminRestaurantsList }) {
  const t = useTranslations('adminEstablishments')
  const locale = useLocale()
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState<Chip>('all')

  const statusLabel = (s: EstablishmentStatus) =>
    s === 'active' ? t('stActive') : s === 'pending' ? t('stPending') : t('stPaused')
  const brandLabel = (b: string | null) => b ?? t('independent')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.rows.filter((r) => {
      const matchChip = chip === 'all' || r.status === chip
      const matchQ = !q || r.name.toLowerCase().includes(q) || r.city.toLowerCase().includes(q) || (r.brandName ?? '').toLowerCase().includes(q)
      return matchChip && matchQ
    })
  }, [data.rows, search, chip])

  if (data.rows.length === 0) {
    return (
      <section>
        <div className="op-dash__head ov-head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card"><div className="op-empty">
          <span className="ms" aria-hidden="true">storefront</span>
          <b>{t('emptyTitle')}</b><span>{t('emptyBody')}</span>
        </div></div>
      </section>
    )
  }

  return (
    <section>
      <div className="op-dash__head ov-head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
        <span className="ro-badge"><span className="ms" aria-hidden="true">visibility</span>{t('readOnly')}</span>
      </div>

      <div className="stat-strip">
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">storefront</span>{t('statTotal')}</div><div className="v">{data.stats.total}</div></div>
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">check_circle</span>{t('statActive')}</div><div className="v">{data.stats.active}</div></div>
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">schedule</span>{t('statPending')}</div><div className="v">{data.stats.pending}</div></div>
      </div>

      <div className="es-toolbar">
        <div className="es-search">
          <span className="ms" aria-hidden="true">search</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
        </div>
      </div>
      <div className="es-chips">
        {(['all', 'active', 'pending', 'paused'] as Chip[]).map((c) => (
          <button key={c} type="button" className={`es-chip${chip === c ? ' is-active' : ''}`} onClick={() => setChip(c)}>
            {c === 'all' ? t('chipAll') : c === 'active' ? t('chipActive') : c === 'pending' ? t('chipPending') : t('chipPaused')}
          </button>
        ))}
      </div>

      <div className="op-card">
        <div className="es-thead">
          <span>{t('colEstab')}</span><span>{t('colBrand')}</span><span>{t('colStatus')}</span><span />
        </div>
        {rows.length === 0 ? (
          <div className="op-empty" style={{ padding: '48px 20px' }}>
            <span className="ms" aria-hidden="true">search_off</span>
            <b>{t('noMatch')}</b>
          </div>
        ) : (
          rows.map((r) => {
            const av = avatarFor(r.name)
            return (
              <Link key={r.id} href={`/admin/establishments/${r.id}`} className="es-row">
                <div className="es-est">
                  <span className="es-logo" style={{ background: av.gradient }}>{av.initials}</span>
                  <div className="es-est__t"><b>{r.name}</b><span><span className="ms" aria-hidden="true">place</span>{r.city}</span></div>
                </div>
                <span className="es-brand"><span className="dotb" style={{ background: 'var(--op-admin)' }} />{brandLabel(r.brandName)}</span>
                <div className="es-status-cell"><span className={`pill ${PILL_CLASS[r.status]}`}><i className="dot" />{statusLabel(r.status)}</span></div>
                <div className="es-go"><span className="op-btn-ghost">{t('manage')}</span></div>
                <div className="es-mini"><span className="es-brand"><span className="dotb" style={{ background: 'var(--op-admin)' }} />{brandLabel(r.brandName)}</span></div>
              </Link>
            )
          })
        )}
      </div>

      {data.capped && <p className="op-dash__sub" style={{ marginTop: 12 }}>{t('cappedNote')}</p>}
    </section>
  )
}
