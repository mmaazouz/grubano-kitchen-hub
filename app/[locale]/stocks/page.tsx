'use client'

// ─────────────────────────────────────────────────────────────────────────────
// /stocks — operator STOCK (inventaire) — VERBATIM CD v1 (Notion 390fd2c9-…-1128).
// 🔒 Presentation-only re-skin to the --op- operator design (navy shell + Material
// Symbols, no lucide). EVERY data handler is byte-identical: GET /api/stocks
// (fetchItems), POST /api/stocks upsert (createItem / the add-item modal), and the
// AIChatModal → POST /api/stocks/update-ai (NL parsing via Claude). The shell
// (components/operator/OperatorShell) already provides .gb-op + .op-content — this
// page renders ONLY the content <section>.
//
// ⚠️ ARGENT : StockItem has NO price/value field. quantity & minThreshold are Float
// (kg / g / L / pcs) → displayed AS-IS with className="mono" (RTL-safe), NEVER as
// cents, NEVER €. The CD "Valeur totale du stock €" stat is NOT backed by any data
// → rendered as an honest « bientôt » preview, zero fabricated euro. DLC (a real
// column) drives the honest forecast line — no invented depletion estimate.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import './stocks.css'

type StockItem = { id: string; brandId: string; name: string; quantity: number; unit: string; minThreshold: number; dlc: string | null; lastUpdated: string }
type StatusType = 'ok' | 'soon' | 'urgent'

function statusOf(i: StockItem): StatusType {
  if (i.quantity <= i.minThreshold * 0.4) return 'urgent'
  if (i.quantity < i.minThreshold) return 'soon'
  return 'ok'
}

// CD status pill mapping: urgent → out (Rupture), soon → low (Bas), ok → ok (OK)
const PILL_CLASS: Record<StatusType, string> = { urgent: 'out', soon: 'low', ok: 'ok' }

export default function StocksPage() {
  const t = useTranslations('operator.stocks')
  const [chat, setChat] = useState(false)
  const [items, setItems]     = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  const fetchItems = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const r = await fetch('/api/stocks')
      if (r.ok) setItems(await r.json())
      else setError(true)
    } catch { setError(true) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  // ── loading ──
  if (loading) return (
    <section className="op-stock">
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
      </div>
      <div className="op-card stat-strip" style={{ marginBottom: 18 }}>
        {[0, 1, 2, 3].map(i => (
          <div className="stat" key={i}><span className="op-sk" style={{ width: 90, height: 34 }} /></div>
        ))}
      </div>
      <span className="op-sk" style={{ width: '100%', height: 56, borderRadius: 12, marginBottom: 18, display: 'block' }} />
      <div className="op-card"><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2, 3].map(i => <span className="op-sk" key={i} style={{ width: '100%', height: 48 }} />)}
      </div></div>
    </section>
  )

  // ── error ──
  if (error) return (
    <section className="op-stock">
      <div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorBody')}</p>
          <button className="op-btn-primary" onClick={fetchItems}>
            <span className="ms" aria-hidden="true">refresh</span>{t('retry')}
          </button>
        </div>
      </div>
    </section>
  )

  return (
    <StockLoaded items={items} onRefresh={fetchItems} onAI={() => setChat(true)}>
      {chat && <AIChatModal onClose={() => { setChat(false); fetchItems() }} />}
    </StockLoaded>
  )
}

// ── Loaded / empty view ───────────────────────────────────────────────────────
function StockLoaded({ items, onRefresh, onAI, children }: {
  items: StockItem[]; onRefresh: () => void; onAI: () => void; children: React.ReactNode
}) {
  const t = useTranslations('operator.stocks')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [modalMode, setModalMode] = useState<'add' | 'adjust' | null>(null)
  const [form, setForm] = useState({ brandId: 'Gnocchi Bar', name: '', quantity: '', unit: 'kg', minThreshold: '', dlc: '' })
  const [saving, setSaving] = useState(false)

  const counts = useMemo(() => {
    let low = 0, out = 0
    for (const i of items) {
      const s = statusOf(i)
      if (s === 'soon') low++
      else if (s === 'urgent') out++
    }
    return { total: items.length, low, out }
  }, [items])

  const filtered = useMemo(() => items.filter(i => {
    const s = statusOf(i)
    if (filter === 'low') return s === 'soon'
    if (filter === 'out') return s === 'urgent'
    return true
  }), [items, filter])

  function openAdd() {
    setForm({ brandId: 'Gnocchi Bar', name: '', quantity: '', unit: 'kg', minThreshold: '', dlc: '' })
    setModalMode('add')
  }
  function openAdjust(i: StockItem) {
    setForm({ brandId: i.brandId, name: i.name, quantity: String(i.quantity), unit: i.unit, minThreshold: String(i.minThreshold), dlc: i.dlc ? i.dlc.slice(0, 10) : '' })
    setModalMode('adjust')
  }

  // 🔒 byte-identical POST /api/stocks upsert — same payload as before.
  async function saveItem(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await fetch('/api/stocks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        quantity: parseFloat(form.quantity) || 0,
        minThreshold: parseFloat(form.minThreshold) || 0,
        dlc: form.dlc ? new Date(form.dlc).toISOString() : null,
      }),
    })
    setSaving(false); setModalMode(null); onRefresh()
  }

  // ── onboarding / empty (N=0 articles) ──
  if (items.length === 0) {
    return (
      <section className="op-stock">
        <div className="op-dash__head">
          <div><h1 className="op-dash__title">{t('title')}</h1></div>
        </div>
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">inventory_2</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
          <button className="op-btn-primary" onClick={openAdd}>
            <span className="ms" aria-hidden="true">add</span>{t('addItem')}
          </button>
        </div></div>
        {modalMode && (
          <StockModal
            mode={modalMode} form={form} setForm={setForm} saving={saving}
            onSubmit={saveItem} onClose={() => setModalMode(null)} t={t}
          />
        )}
        {children}
      </section>
    )
  }

  return (
    <section className="op-stock">
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
      </div>

      {/* Stat strip — real counts. Value-€ stat is honest « bientôt » (no price data). */}
      <div className="op-card stat-strip">
        <div className="stat"><span className="lbl">{t('statTracked')}</span><b className="mono">{counts.total}</b></div>
        <div className="stat"><span className="lbl">{t('statLow')}</span><b className="mono warn">{counts.low}</b></div>
        <div className="stat"><span className="lbl">{t('statOut')}</span><b className="mono danger">{counts.out}</b></div>
        <div className="stat">
          <span className="lbl">{t('statValue')}</span>
          <span className="soon-val"><span className="ms" aria-hidden="true">schedule</span>{t('soon')}</span>
        </div>
      </div>

      {/* AI Copilote bar — opens the existing AIChatModal (POST /api/stocks/update-ai) */}
      <button type="button" className="ai-bar" onClick={onAI}>
        <span className="ic"><span className="ms" aria-hidden="true">auto_awesome</span></span>
        <span className="ai-placeholder">{t('aiPlaceholder')}</span>
        <span className="ai-tag">{t('aiTag')}</span>
        <span className="ai-send"><span className="ms" aria-hidden="true">arrow_upward</span></span>
      </button>

      {/* Filters + add */}
      <div className="head-row">
        <div className="stock-filters" role="group" aria-label={t('filtersAria')}>
          {([['all', t('filterAll'), counts.total], ['low', t('filterLow'), counts.low], ['out', t('filterOut'), counts.out]] as const).map(([k, label, n]) => (
            <button key={k} type="button" aria-pressed={filter === k}
              className={filter === k ? 'is-active' : undefined}
              onClick={() => setFilter(k as typeof filter)}>
              {label} <span className="cnt">{n}</span>
            </button>
          ))}
        </div>
        <button className="op-btn-add" onClick={openAdd}>
          <span className="ms" aria-hidden="true">add</span>{t('addItem')}
        </button>
      </div>

      {/* Table (desktop) */}
      <div className="op-card stock-table">
        <div className="st-head-row">
          <span>{t('colItem')}</span><span>{t('colQty')}</span><span>{t('colThreshold')}</span><span>{t('colStatus')}</span><span />
        </div>
        {filtered.length === 0 ? (
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">filter_alt_off</span>
            <b>{t('noneInFilter')}</b>
          </div>
        ) : filtered.map(i => <StockRow key={i.id} item={i} t={t} onAdjust={() => openAdjust(i)} />)}
      </div>

      {/* Cards (mobile) */}
      <div className="stock-cards">
        {filtered.length === 0 ? (
          <div className="op-card"><div className="op-emptyline">
            <span className="ms" aria-hidden="true">filter_alt_off</span>
            <b>{t('noneInFilter')}</b>
          </div></div>
        ) : filtered.map(i => <StockCard key={i.id} item={i} t={t} onAdjust={() => openAdjust(i)} />)}
      </div>

      {modalMode && (
        <StockModal
          mode={modalMode} form={form} setForm={setForm} saving={saving}
          onSubmit={saveItem} onClose={() => setModalMode(null)} t={t}
        />
      )}
      {children}
    </section>
  )
}

// ── forecast / DLC line (honest — driven by the real dlc column, never invented) ──
function ForecastLine({ item, t }: { item: StockItem; t: ReturnType<typeof useTranslations> }) {
  if (!item.dlc) return null
  const d = new Date(item.dlc)
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000)
  const cls = days <= 2 ? 'st-forecast danger' : 'st-forecast'
  return <span className={cls}>{t('dlcOn', { date: d.toLocaleDateString('fr-FR') })}</span>
}

function StockRow({ item, t, onAdjust }: { item: StockItem; t: ReturnType<typeof useTranslations>; onAdjust: () => void }) {
  const s = statusOf(item)
  const isOut = s === 'urgent'
  return (
    <div className="st-row">
      <div className="st-name"><b>{item.name}</b><span>{item.brandId}</span></div>
      <span className="st-qty mono">{item.quantity}<span className="unit">{item.unit}</span></span>
      <span className="st-threshold mono">{item.minThreshold}<span className="unit">{item.unit}</span></span>
      <div>
        <span className={`st-pill ${PILL_CLASS[s]}`}><i className="dot" />{t(`status.${s}`)}</span>
        <ForecastLine item={item} t={t} />
      </div>
      <div className="actioncell">
        <button className="st-action" onClick={onAdjust}>
          <span className="ms" aria-hidden="true">{isOut ? 'add_shopping_cart' : 'edit'}</span>
          {isOut ? t('reorder') : t('adjust')}
        </button>
      </div>
    </div>
  )
}

function StockCard({ item, t, onAdjust }: { item: StockItem; t: ReturnType<typeof useTranslations>; onAdjust: () => void }) {
  const s = statusOf(item)
  const isOut = s === 'urgent'
  return (
    <div className="st-card">
      <div className="st-card__top">
        <div className="st-name"><b>{item.name}</b><span>{item.brandId}</span></div>
        <span className={`st-pill ${PILL_CLASS[s]}`}><i className="dot" />{t(`status.${s}`)}</span>
      </div>
      <div className="st-card__meta">
        <span>{t('colQty')} <b className="mono">{item.quantity} {item.unit}</b></span>
        <span>{t('colThreshold')} <b className="mono">{item.minThreshold} {item.unit}</b></span>
      </div>
      <ForecastLine item={item} t={t} />
      <button className="st-action" onClick={onAdjust}>
        <span className="ms" aria-hidden="true">{isOut ? 'add_shopping_cart' : 'edit'}</span>
        {isOut ? t('reorderFull') : t('adjust')}
      </button>
    </div>
  )
}

// ── Add / Adjust item modal (🔒 same POST /api/stocks upsert as before) ────────
function StockModal({ mode, form, setForm, saving, onSubmit, onClose, t }: {
  mode: 'add' | 'adjust'
  form: { brandId: string; name: string; quantity: string; unit: string; minThreshold: string; dlc: string }
  setForm: React.Dispatch<React.SetStateAction<{ brandId: string; name: string; quantity: string; unit: string; minThreshold: string; dlc: string }>>
  saving: boolean
  onSubmit: (e: React.FormEvent) => void
  onClose: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="op-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="op-modal" onSubmit={onSubmit}>
        <div className="op-modal__head">
          <h3>{mode === 'add' ? t('modalAddTitle') : t('modalAdjustTitle', { name: form.name })}</h3>
          <button type="button" className="op-modal__close" onClick={onClose} aria-label={t('cancel')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>
        <div className="op-modal__body">
          <div className="op-field">
            <label htmlFor="stkName">{t('fieldName')}</label>
            <input id="stkName" className="op-input" type="text" placeholder={t('fieldNamePh')}
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="op-field">
            <label htmlFor="stkBrand">{t('fieldBrand')}</label>
            <input id="stkBrand" className="op-input" type="text" placeholder={t('fieldBrandPh')}
              value={form.brandId} onChange={e => setForm(f => ({ ...f, brandId: e.target.value }))} />
          </div>
          <div className="op-field-row">
            <div className="op-field">
              <label htmlFor="stkQty">{t('fieldQty')}</label>
              <input id="stkQty" className="op-input mono" type="number" step="any" placeholder="0"
                value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className="op-field">
              <label htmlFor="stkUnit">{t('fieldUnit')}</label>
              <select id="stkUnit" className="op-select"
                value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                <option value="kg">kg</option><option value="g">g</option>
                <option value="L">L</option><option value="mL">mL</option><option value="u">u</option>
              </select>
            </div>
          </div>
          <div className="op-field-row">
            <div className="op-field">
              <label htmlFor="stkThreshold">{t('fieldThreshold')}</label>
              <input id="stkThreshold" className="op-input mono" type="number" step="any" placeholder="5"
                value={form.minThreshold} onChange={e => setForm(f => ({ ...f, minThreshold: e.target.value }))} />
            </div>
            <div className="op-field">
              <label htmlFor="stkDlc">{t('fieldDlc')}</label>
              <input id="stkDlc" className="op-input" type="date"
                value={form.dlc} onChange={e => setForm(f => ({ ...f, dlc: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="op-modal__foot">
          <button type="button" className="op-btn-ghost" onClick={onClose}>{t('cancel')}</button>
          <button type="submit" className="op-btn-primary" disabled={saving}>
            <span className="ms" aria-hidden="true">check</span>
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── AI Chat Modal ─────────────────────────────────────────────────────────────
// 🔒 Logic byte-identical: same message state machine + POST /api/stocks/update-ai
// (text → { updated_items, forecast_next_7_days, message }). Markup re-skinned to op-.
function AIChatModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('operator.stocks')
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { role: 'ai', text: t('aiGreeting') },
  ])
  const [input, setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  async function send() {
    if (!input.trim()) return
    const userMsg = input.trim()
    setMessages(m => [...m, { role: 'user', text: userMsg }])
    setInput(''); setLoading(true)
    try {
      const res = await fetch('/api/stocks/update-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: userMsg }) })
      const data = await res.json()
      if (res.ok && data.updated_items?.length > 0) {
        const summary = data.updated_items.map((i: { name: string; quantity: number; unit: string }) => `${i.name} : ${i.quantity} ${i.unit}`).join(', ')
        setMessages(m => [...m, { role: 'ai', text: `${t('aiUpdated', { summary })} ${data.forecast_next_7_days ?? ''}` }])
        setConfirmed(true)
      } else {
        setMessages(m => [...m, { role: 'ai', text: data.message ?? t('aiParseFail') }])
      }
    } catch {
      setMessages(m => [...m, { role: 'ai', text: t('aiConnError') }])
    }
    setLoading(false)
  }

  return (
    <div className="op-modal-backdrop ai-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="op-modal">
        <div className="op-modal__head">
          <span className="ic" aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg,var(--op-ai),var(--op-ai-2))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="ms" style={{ fontSize: 19, color: '#fff' }}>auto_awesome</span>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 15 }}>{t('aiTitle')}</h3>
            <span style={{ fontSize: 11, color: 'var(--op-muted)', display: 'block' }}>{t('aiSubtitle')}</span>
          </div>
          <button type="button" className="op-modal__close" onClick={onClose} aria-label={t('close')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="op-modal__body" style={{ minHeight: 260, maxHeight: '52vh', overflowY: 'auto' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', borderRadius: 14, padding: '8px 12px', fontSize: 13, lineHeight: 1.4,
                background: m.role === 'user' ? 'var(--op-zest)' : 'var(--op-surface-2)',
                color: m.role === 'user' ? '#fff' : 'var(--op-text)',
              }}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ borderRadius: 14, background: 'var(--op-surface-2)', padding: '8px 14px', fontSize: 13, color: 'var(--op-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="ms" style={{ fontSize: 15 }} aria-hidden="true">hourglass_empty</span>{t('aiAnalyzing')}
              </div>
            </div>
          )}
          {confirmed && (
            <div style={{ borderRadius: 10, border: '1px solid var(--op-success-bd)', background: 'var(--op-success-bg)', padding: 12 }}>
              <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: 'var(--op-success)' }}>{t('aiConfirmed')}</p>
            </div>
          )}
        </div>

        <div className="op-modal__foot" style={{ gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder={t('aiInputPh')} className="op-input" style={{ flex: 1 }} />
          <button type="button" className="op-btn-primary" onClick={send} disabled={loading} aria-label={t('aiSend')}>
            <span className="ms" aria-hidden="true">arrow_upward</span>
          </button>
        </div>
      </div>
    </div>
  )
}
