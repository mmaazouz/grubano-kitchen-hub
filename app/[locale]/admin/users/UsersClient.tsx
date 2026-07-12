'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import type { AdminUsersList } from '@/lib/admin-users'

// ── Users list — search + role filter (CD ADM4). ─────────────────────────────────
// CLIENT half of /admin/users. Read-only. Roles are the REAL SET (a multi-role account
// shows every chip). NO suspension pill/chip (no mechanism); « Suspendre » is a disabled
// « bientôt ». Dates use an explicit timezone so SSR + hydration match.

const GRADIENTS = [
  'linear-gradient(135deg,#5B6EE1,#33409E)', 'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#0E9384,#0A6B60)', 'linear-gradient(135deg,#2E78F0,#1B5AC0)',
  'linear-gradient(135deg,#8A2C3B,#5E1A24)', 'linear-gradient(135deg,#8992A3,#5B6472)',
]
function avatarFor(name: string): { initials: string; gradient: string } {
  const clean = (name || '?').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase() || '?'
  let h = 0
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0
  return { initials, gradient: GRADIENTS[h % GRADIENTS.length] }
}

// role → { css class, Material icon, i18n key }. Unknown roles fall back to « other ».
const ROLE_META: Record<string, { cls: string; icon: string; key: string }> = {
  consumer:    { cls: 'client',  icon: 'person',        key: 'roleClient' },
  restaurant:  { cls: 'resto',   icon: 'storefront',    key: 'roleResto' },
  supplier:    { cls: 'supp',    icon: 'local_shipping', key: 'roleSupplier' },
  logistics:   { cls: 'driver',  icon: 'two_wheeler',   key: 'roleDriver' },
  admin:       { cls: 'other',   icon: 'shield_person', key: 'roleAdmin' },
  franchise:   { cls: 'other',   icon: 'store',         key: 'roleFranchise' },
  creator:     { cls: 'other',   icon: 'auto_awesome',  key: 'roleCreator' },
  affiliate:   { cls: 'other',   icon: 'campaign',      key: 'roleAffiliate' },
  prestataire: { cls: 'other',   icon: 'handyman',      key: 'rolePrestataire' },
}

type Chip = 'all' | 'consumer' | 'restaurant' | 'supplier' | 'logistics'

export default function UsersClient({ data }: { data: AdminUsersList }) {
  const t = useTranslations('adminUsers')
  const locale = useLocale()
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState<Chip>('all')

  const fmtDate = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }), [locale])
  const roleLabel = (role: string) => {
    const meta = ROLE_META[role]
    if (!meta) return role
    const label = t(meta.key as 'roleClient')
    return label === meta.key ? role : label
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.rows.filter((u) => {
      const matchChip = chip === 'all' || u.roles.includes(chip)
      const matchQ = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      return matchChip && matchQ
    })
  }, [data.rows, search, chip])

  if (data.rows.length === 0) {
    return (
      <section>
        <div className="op-dash__head ov-head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card"><div className="op-empty">
          <span className="ms" aria-hidden="true">group_off</span>
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
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">group</span>{t('statTotal')}</div><div className="v">{data.stats.total}</div></div>
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">person_add</span>{t('statNew')}</div><div className="v">{data.stats.new30}</div></div>
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">restaurant</span>{t('statRestaurateurs')}</div><div className="v">{data.stats.restaurateurs}</div></div>
        <div className="op-card stat"><div className="l"><span className="ms" aria-hidden="true">local_shipping</span>{t('statSuppliers')}</div><div className="v">{data.stats.suppliers}</div></div>
      </div>

      <div className="es-toolbar">
        <div className="es-search">
          <span className="ms" aria-hidden="true">search</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
        </div>
      </div>
      <div className="es-chips">
        {(['all', 'consumer', 'restaurant', 'supplier', 'logistics'] as Chip[]).map((c) => (
          <button key={c} type="button" className={`es-chip${chip === c ? ' is-active' : ''}`} onClick={() => setChip(c)}>
            {c === 'all' ? t('chipAll') : c === 'consumer' ? t('chipClients') : c === 'restaurant' ? t('chipRestaurateurs') : c === 'supplier' ? t('chipSuppliers') : t('chipDrivers')}
          </button>
        ))}
      </div>

      <div className="op-card">
        <div className="us-thead">
          <span>{t('colUser')}</span><span>{t('colRole')}</span><span>{t('colRegistered')}</span><span>{t('colStatus')}</span><span />
        </div>
        {rows.length === 0 ? (
          <div className="op-empty" style={{ padding: '48px 20px' }}>
            <span className="ms" aria-hidden="true">search_off</span>
            <b>{t('noMatch')}</b>
          </div>
        ) : (
          rows.map((u) => {
            const av = avatarFor(u.name)
            return (
              <div className="us-row" key={u.id}>
                <div className="us-usr">
                  <span className="us-av" style={{ background: av.gradient }}>{av.initials}</span>
                  <div className="us-usr__t"><b>{u.name}</b><span>{u.email}</span></div>
                </div>
                <div className="us-roles">
                  {u.roles.map((r) => {
                    const meta = ROLE_META[r] ?? { cls: 'other', icon: 'person', key: r }
                    return <span key={r} className={`role ${meta.cls}`}><span className="ms" aria-hidden="true">{meta.icon}</span>{roleLabel(r)}</span>
                  })}
                </div>
                <span className="us-date">{fmtDate.format(new Date(u.createdAt))}</span>
                <div className="us-status-cell"><span className={`pill ${u.status}`}><i className="dot" />{u.status === 'pending' ? t('stPending') : t('stActive')}</span></div>
                <div className="us-act"><div className="act-soon"><span className="ms" aria-hidden="true">block</span>{t('suspend')}<span className="soon">{t('soon')}</span></div></div>
                <div className="us-mini">
                  {u.roles.slice(0, 1).map((r) => {
                    const meta = ROLE_META[r] ?? { cls: 'other', icon: 'person', key: r }
                    return <span key={r} className={`role ${meta.cls}`}><span className="ms" aria-hidden="true">{meta.icon}</span>{roleLabel(r)}</span>
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      {data.capped && <p className="op-dash__sub" style={{ marginTop: 12 }}>{t('cappedNote')}</p>}
    </section>
  )
}
