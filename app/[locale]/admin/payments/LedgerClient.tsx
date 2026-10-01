'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import type { AdminLedger, LedgerRow } from '@/lib/admin-ledger'

// ── Ledger journal — decomposition banner + type tabs + period (CD ADM5 🔒). ──────
// CLIENT half of /admin/payments. 100% READ-ONLY — there is NO action of any kind here.
// The banner is the ACCURATE server decomposition (golden equation) for the period; the
// tabs filter the loaded rows by REAL type (commission is a COLUMN, never a fake line).
// Changing the period re-fetches GET /api/admin/ledger so the banner + rows stay
// consistent. All amounts are stored CENTS rendered via formatMoney (never recomputed).

const TYPE_META: Record<string, { cls: string; icon: string; key: string }> = {
  payment:         { cls: 'order',  icon: 'south_west', key: 'typeOrder' },
  deposit_capture: { cls: 'order',  icon: 'south_west', key: 'typeDeposit' },
  refund:          { cls: 'refund', icon: 'north_east', key: 'typeRefund' },
  adjustment:      { cls: 'adj',    icon: 'tune',       key: 'typeAdjustment' },
}

type Tab = 'all' | 'orders' | 'commissions' | 'refunds'

export default function LedgerClient({ initial }: { initial: AdminLedger }) {
  const t = useTranslations('adminLedger')
  const locale = useLocale()
  const [data, setData] = useState<AdminLedger>(initial)
  const [tab, setTab] = useState<Tab>('all')
  const [period, setPeriod] = useState(String(initial.days))
  const [loading, setLoading] = useState(false)

  const fmt = useMemo(() => ({
    day: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }),
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Paris' }),
  }), [locale])
  const dt = (iso: string) => { const d = new Date(iso); return `${fmt.day.format(d)} · ${fmt.time.format(d)}` }
  const typeLabel = (type: string) => {
    const meta = TYPE_META[type]
    if (!meta) return type
    const label = t(meta.key as 'typeOrder')
    return label === meta.key ? type : label
  }
  const channelLabel = (ch: string | null) => {
    if (!ch) return null
    const label = t(`channel.${ch}` as 'channel.delivery')
    return label === `channel.${ch}` ? null : label
  }

  async function changePeriod(days: string) {
    setPeriod(days); setLoading(true)
    try {
      const res = await fetch(`/api/admin/ledger?days=${days}`, { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } catch { /* keep prior data */ } finally { setLoading(false) }
  }

  const rows = useMemo(() => data.rows.filter((r) => {
    if (tab === 'all') return true
    if (tab === 'orders') return r.type === 'payment' || r.type === 'deposit_capture'
    if (tab === 'commissions') return r.feeCents !== 0
    return r.type === 'refund'
  }), [data.rows, tab])

  const hasData = data.rows.length > 0
  const d = data.decomp

  const amountCell = (r: LedgerRow) => {
    if (tab === 'commissions') return { cls: 'out', text: formatMoney(-r.feeCents, locale) }
    return { cls: r.grossCents >= 0 ? 'in' : 'out', text: (r.grossCents > 0 ? '+' : '') + formatMoney(r.grossCents, locale) }
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

      {hasData && (
        <div className="op-card led-decomp">
          <div className="led-cell brut">
            <div className="l"><span className="ms" aria-hidden="true">account_balance_wallet</span>{t('decompGross', { days: data.days })}</div>
            <div className="v">{formatMoney(d.grossCents, locale)}</div>
            <div className="s">{t('decompGrossSub')}</div>
          </div>
          <div className="led-op">=</div>
          <div className="led-cell comm">
            <div className="l"><span className="ms" aria-hidden="true">percent</span>{t('decompCommission')}</div>
            <div className="v">{formatMoney(d.feeCents, locale)}</div>
            {d.commissionPct != null && <div className="s">{t('decompCommissionSub', { pct: d.commissionPct })}</div>}
          </div>
          <div className="led-op">+</div>
          <div className="led-cell net">
            <div className="l"><span className="ms" aria-hidden="true">savings</span>{t('decompNet')}</div>
            <div className="v">{formatMoney(d.netCents, locale)}</div>
            <div className="s">{t('decompNetSub')}</div>
          </div>
        </div>
      )}

      <div className="led-toolbar">
        {hasData && (
          <div className="led-tabs">
            {(['all', 'orders', 'commissions', 'refunds'] as Tab[]).map((k) => (
              <button key={k} type="button" className={tab === k ? 'is-active' : undefined} onClick={() => setTab(k)}>
                {k === 'all' ? t('tabAll') : k === 'orders' ? t('tabOrders') : k === 'commissions' ? t('tabCommissions') : t('tabRefunds')}
              </button>
            ))}
          </div>
        )}
        <div className="led-period">
          <span className="ms" aria-hidden="true" style={{ fontSize: 16 }}>calendar_today</span>
          <select value={period} onChange={(e) => changePeriod(e.target.value)} aria-label={t('periodLabel')} disabled={loading}>
            <option value="30">{t('period30')}</option>
            <option value="7">{t('period7')}</option>
            <option value="90">{t('period90')}</option>
          </select>
        </div>
      </div>

      {!hasData ? (
        <div className="op-card"><div className="op-empty">
          <span className="ms" aria-hidden="true">receipt_long</span>
          <b>{t('emptyTitle')}</b><span>{t('emptyBody')}</span>
        </div></div>
      ) : (
        <>
          <div className="op-card" style={loading ? { opacity: 0.6 } : undefined} aria-busy={loading}>
            <div className="led-thead">
              <span>{t('colDate')}</span><span>{t('colRef')}</span><span>{t('colParty')}</span>
              <span>{t('colType')}</span><span style={{ textAlign: 'end' }}>{t('colAmount')}</span><span style={{ textAlign: 'end' }}>{t('colNet')}</span>
            </div>
            {rows.length === 0 ? (
              <div className="op-empty" style={{ padding: '48px 20px' }}>
                <span className="ms" aria-hidden="true">filter_list_off</span><b>{t('tabEmpty')}</b>
              </div>
            ) : (
              rows.map((r) => {
                const meta = TYPE_META[r.type] ?? { cls: 'adj', icon: 'tune', key: r.type }
                const amt = amountCell(r)
                const chLabel = channelLabel(r.channel)
                return (
                  <div className="led-row" key={r.id}>
                    <span className="led-dt led-dt-cell">{dt(r.createdAt)}</span>
                    <span className="led-ref led-ref-cell">{r.ref}</span>
                    <div className="led-party led-party-cell">{r.party ?? t('unknownParty')}{chLabel && <span>{chLabel}</span>}</div>
                    <span className="led-type-cell"><span className={`led-type ${meta.cls}`}><span className="ms" aria-hidden="true">{meta.icon}</span>{typeLabel(r.type)}</span></span>
                    <span className={`led-amt ${amt.cls}`}>{amt.text}</span>
                    <span className="led-net">{tab === 'commissions' ? '—' : formatMoney(r.netCents, locale)}</span>
                    <span className="led-mini"><span className={`led-type ${meta.cls}`}><span className="ms" aria-hidden="true">{meta.icon}</span>{typeLabel(r.type)}</span></span>
                  </div>
                )
              })
            )}
          </div>

          {data.capped && <p className="op-dash__sub" style={{ marginTop: 12 }}>{t('cappedNote')}</p>}

          <div className="led-note"><span className="ms" aria-hidden="true">info</span><span>{t('readOnlyNote')}</span></div>
        </>
      )}
    </section>
  )
}
