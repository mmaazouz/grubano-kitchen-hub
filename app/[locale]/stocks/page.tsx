'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Package, AlertTriangle, Check, Clock, Sparkles, Send, Mic, Filter, X, RefreshCw, Plus } from 'lucide-react'

type StockItem = { id: string; brandId: string; name: string; quantity: number; unit: string; minThreshold: number; dlc: string | null; lastUpdated: string }
type StatusType = 'ok' | 'soon' | 'urgent'

function statusOf(i: StockItem): StatusType {
  if (i.quantity <= i.minThreshold * 0.4) return 'urgent'
  if (i.quantity < i.minThreshold) return 'soon'
  return 'ok'
}

const CATS = ['Tout', 'Frais', 'Sec', 'Sauce', 'Packaging'] as const
const STATUS_FILTERS = [['all', 'Tous'], ['low', 'Bas/Critique'], ['ok', 'OK']] as const

export default function StocksPage() {
  const [tab, setTab]   = useState<'inventory' | 'history'>('inventory')
  const [chat, setChat] = useState(false)
  const [items, setItems]     = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/stocks'); if (r.ok) setItems(await r.json()) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchItems() }, [fetchItems])

  const lowItems = items.filter(i => statusOf(i) !== 'ok')

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-4xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Stocks</h1>
      <p className="mb-4 text-sm text-muted-foreground">Inventaire, IA & historique</p>

      {/* AI update CTA */}
      <button onClick={() => setChat(true)} className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-navy p-4 text-navy-foreground">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles size={18} /></div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold">Mettre à jour mes stocks</p>
          <p className="mt-0.5 text-[11px] text-navy-foreground/70">Parlez ou écrivez à l&apos;IA · fin de service</p>
        </div>
        <Mic size={18} className="text-primary" />
      </button>

      {/* Low stock alert */}
      {lowItems.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground"><AlertTriangle size={15} /></div>
          <div className="flex-1">
            <p className="text-xs font-semibold">{lowItems.length} article{lowItems.length > 1 ? 's' : ''} sous le seuil</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Pensez à passer commande auprès de vos fournisseurs.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
        {([['inventory', 'Mes stocks'], ['history', 'Historique']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-xl py-2 text-[11px] font-semibold transition ${tab === k ? 'bg-card text-foreground shadow' : 'text-muted-foreground'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'inventory' && <InventoryView items={items} loading={loading} onRefresh={fetchItems} />}
      {tab === 'history' && <HistoryView />}

      {chat && <AIChatModal onClose={() => { setChat(false); fetchItems() }} />}
    </div>
  )
}

// ── Inventory ─────────────────────────────────────────────────────────────────
function InventoryView({ items, loading, onRefresh }: { items: StockItem[]; loading: boolean; onRefresh: () => void }) {
  const [filter, setFilter] = useState<'all' | 'low' | 'ok'>('all')
  const [cat, setCat]       = useState<string>('Tout')
  const [adding, setAdding] = useState(false)
  const [newItem, setNewItem] = useState({ brandId: 'Gnocchi Bar', name: '', quantity: '', unit: 'kg', minThreshold: '', dlc: '' })
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => items.filter(i => {
    const s = statusOf(i)
    if (filter === 'low' && s === 'ok') return false
    if (filter === 'ok' && s !== 'ok') return false
    return true
  }), [items, filter])

  async function createItem(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await fetch('/api/stocks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, quantity: parseFloat(newItem.quantity) || 0, minThreshold: parseFloat(newItem.minThreshold) || 0, dlc: newItem.dlc ? new Date(newItem.dlc).toISOString() : null }) })
    setSaving(false); setAdding(false); setNewItem({ brandId: 'Gnocchi Bar', name: '', quantity: '', unit: 'kg', minThreshold: '', dlc: '' }); onRefresh()
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <RefreshCw size={16} className="animate-spin" /> Chargement…
    </div>
  )

  return (
    <>
      {/* Filters */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-muted-foreground" />
        {STATUS_FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k as typeof filter)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${filter === k ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'}`}>
            {l}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        {CATS.map(c => (
          <button key={c} onClick={() => setCat(c)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${cat === c ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'}`}>
            {c}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-12 text-center">
          <Package size={32} className="mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Aucun article trouvé</p>
          <button onClick={() => setAdding(true)} className="mt-3 text-xs text-primary font-semibold underline">Ajouter le premier</button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(i => {
            const s = statusOf(i)
            return (
              <div key={i.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className={`grid h-9 w-9 place-items-center rounded-lg ${s === 'urgent' ? 'bg-destructive/15 text-destructive' : s === 'soon' ? 'bg-warning/20 text-warning' : 'bg-success/15 text-success'}`}>
                  <Package size={14} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{i.name}</p>
                    <span className="text-[10px] text-muted-foreground">min {i.minThreshold} {i.unit}</span>
                  </div>
                  {i.dlc && <p className="text-[11px] text-muted-foreground">DLC · {new Date(i.dlc).toLocaleDateString('fr-FR')}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{i.quantity} <span className="text-[10px] text-muted-foreground">{i.unit}</span></p>
                  <span className={`text-[10px] font-semibold uppercase ${s === 'urgent' ? 'text-destructive' : s === 'soon' ? 'text-warning' : 'text-success'}`}>
                    {s === 'urgent' ? 'Critique' : s === 'soon' ? 'Bas' : 'OK'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add item */}
      <button onClick={() => setAdding(!adding)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-muted-foreground hover:text-foreground transition">
        <Plus size={15} /> Ajouter un article
      </button>

      {adding && (
        <form onSubmit={createItem} className="mt-3 rounded-2xl border border-border bg-card p-4 grid grid-cols-2 gap-3">
          {([
            { key: 'name', label: 'Nom', placeholder: 'Sauce bolognaise', full: true },
            { key: 'quantity', label: 'Quantité', placeholder: '1.5', type: 'number' },
            { key: 'unit', label: 'Unité', placeholder: 'kg' },
            { key: 'minThreshold', label: 'Seuil min', placeholder: '0.5', type: 'number' },
            { key: 'dlc', label: 'DLC', type: 'date' },
          ] as { key: keyof typeof newItem; label: string; placeholder?: string; full?: boolean; type?: string }[]).map(({ key, label, placeholder, full, type }) => (
            <div key={key} className={full ? 'col-span-2' : ''}>
              <label className="block text-[10px] text-muted-foreground mb-1">{label}</label>
              <input type={type ?? 'text'} value={newItem[key]}
                onChange={e => setNewItem(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          ))}
          <div className="col-span-2 flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium">Annuler</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">
              {saving ? 'Enregistrement…' : 'Ajouter'}
            </button>
          </div>
        </form>
      )}
    </>
  )
}

// ── History (mock — replaced when supplier orders table exists) ───────────────
function HistoryView() {
  const history = [
    { supplier: 'Metro Pro',      date: 'Aujourd\'hui 06:12', total: 187, status: 'Confirmée' },
    { supplier: 'Halal Premium',  date: 'Hier 07:40',         total: 412, status: 'Livrée' },
    { supplier: 'Frais Direct',   date: 'Lun 06:00',          total: 156, status: 'Livrée' },
  ]
  return (
    <div className="space-y-2">
      {history.map(o => (
        <div key={o.date} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary"><Clock size={14} /></div>
            <div>
              <p className="text-sm font-semibold">{o.supplier}</p>
              <p className="text-[11px] text-muted-foreground">{o.date}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold">€{o.total}</p>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success"><Check size={10} /> {o.status}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── AI Chat Modal ─────────────────────────────────────────────────────────────
function AIChatModal({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    { role: 'ai', text: 'Bonsoir 👋 Comment se sont passés les stocks ce soir ? Décrivez en langage naturel.' },
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
        setMessages(m => [...m, { role: 'ai', text: `Compris. Mis à jour : ${summary}. ${data.forecast_next_7_days ?? ''}` }])
        setConfirmed(true)
      } else {
        setMessages(m => [...m, { role: 'ai', text: data.message ?? 'Je n\'ai pas pu interpréter les quantités. Reformulez.' }])
      }
    } catch {
      setMessages(m => [...m, { role: 'ai', text: 'Erreur de connexion. Réessayez.' }])
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4 pt-16">
      <div className="flex h-full max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border bg-navy px-4 py-3 text-navy-foreground">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles size={15} /></div>
          <div className="flex-1">
            <p className="text-sm font-bold">Assistant Stocks</p>
            <p className="text-[10px] text-navy-foreground/70">Langage naturel · ex: &quot;2 kg poulet, plus de carbonara&quot;</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-navy-foreground/10"><X size={14} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin" /> Analyse en cours…
              </div>
            </div>
          )}
          {confirmed && (
            <div className="rounded-2xl border border-primary/30 bg-accent p-3">
              <p className="text-[11px] font-bold text-foreground">Stocks mis à jour</p>
              <button onClick={onClose} className="mt-2 w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground">Fermer</button>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <button className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-foreground"><Mic size={16} /></button>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="2 kg poulet, sauce carbonara vide…"
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-[13px] focus:border-primary focus:outline-none" />
            <button onClick={send} disabled={loading} className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-60">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
