'use client'

import { useState } from 'react'
import { Award, Gift, Check, Lock, Sparkles, Loader2, UserPlus } from 'lucide-react'

const BRANDS = ['Gnocchi Bar', 'Le Riz Gourmand', 'Pasta Fresca', 'Rollix']

const TIER_THRESHOLDS = [
  { tier: 'bronze',  min: 0,   label: 'Bronze',  next: 'Silver',  reward: 'Boisson offerte' },
  { tier: 'silver',  min: 100, label: 'Silver',  next: 'Gold',    reward: 'Dessert offert' },
  { tier: 'gold',    min: 200, label: 'Gold',    next: 'Platine', reward: 'Plat offert' },
  { tier: 'platine', min: 400, label: 'Platine', next: null,      reward: 'Repas complet' },
]

const REWARDS = [
  { name: 'Boisson offerte',   cost: 50,   tier: 'bronze' },
  { name: 'Dessert offert',    cost: 100,  tier: 'silver' },
  { name: 'Plat offert',       cost: 200,  tier: 'gold' },
  { name: 'Repas complet',     cost: 400,  tier: 'platine' },
]

type Tab = 'validate' | 'register'

export default function LoyaltyPage() {
  const [tab, setTab] = useState<Tab>('validate')

  /* ── Validate order ───────────────────────────────────────────────── */
  const [valForm, setValForm] = useState({ email: '', uberOrderNumber: '', amount: '', brandName: BRANDS[0] })
  const [valState, setValState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [valResult, setValResult] = useState<{ pointsEarned: number; newBalance: number; tier: string } | null>(null)
  const [valError, setValError] = useState('')

  async function handleValidate(e: React.FormEvent) {
    e.preventDefault(); setValState('loading'); setValError('')
    const res = await fetch('/api/loyalty/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...valForm, amount: parseFloat(valForm.amount) }) })
    const data = await res.json()
    if (res.ok) { setValResult(data); setValState('ok'); setValForm({ email: '', uberOrderNumber: '', amount: '', brandName: BRANDS[0] }) }
    else { setValError(data.error ?? 'Erreur inconnue.'); setValState('err') }
  }

  /* ── Register ─────────────────────────────────────────────────────── */
  const [regForm, setRegForm] = useState({ name: '', email: '', phone: '' })
  const [regState, setRegState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [regResult, setRegResult] = useState<{ name: string; email: string; tier: string; pointsBalance: number; referralCode: string } | null>(null)
  const [regError, setRegError] = useState('')

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); setRegState('loading'); setRegError('')
    const res = await fetch('/api/loyalty/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(regForm) })
    const data = await res.json()
    if (res.ok) { setRegResult(data.customer); setRegState('ok'); setRegForm({ name: '', email: '', phone: '' }) }
    else { setRegError(data.error ?? 'Erreur inconnue.'); setRegState('err') }
  }

  const tierInfo = TIER_THRESHOLDS.find(t => t.tier === (valResult?.tier ?? 'bronze')) ?? TIER_THRESHOLDS[0]
  const balance  = valResult?.newBalance ?? 0
  const progress = valResult ? Math.min(100, (balance / (tierInfo.min + 100)) * 100) : 0

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">

      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Programme Fidélité</h1>
      <p className="mb-5 text-sm text-muted-foreground">1 point = 1 € · Bronze → Platine</p>

      {/* Wallet card */}
      {valResult && (
        <section className="relative overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground shadow-xl mb-5">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/30 blur-3xl" />
          <div className="absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-primary/20 blur-2xl" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Award size={17} /></div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-navy-foreground/60">Points wallet</p>
                  <p className="text-xs font-semibold">{valForm.email || 'Client'}</p>
                </div>
              </div>
              <span className="rounded-full bg-primary/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">{tierInfo.label}</span>
            </div>
            <p className="mt-5 text-4xl font-bold tracking-tight">{balance.toLocaleString()} <span className="text-base font-medium text-navy-foreground/60">pts</span></p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-navy-foreground/60">
              {TIER_THRESHOLDS.map(t => <span key={t.tier} className={t.tier === tierInfo.tier ? 'text-primary' : ''}>{t.label}</span>)}
            </div>
          </div>
        </section>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-1 rounded-xl bg-muted p-1 w-fit">
        {([['validate', 'Valider une commande'], ['register', 'Inscrire un client']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === k ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Validate order ── */}
      {tab === 'validate' && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles size={15} className="text-primary" />
            <h2 className="text-sm font-bold">Valider une commande UberEats</h2>
          </div>

          {valState === 'ok' && valResult && (
            <div className="mb-4 rounded-2xl bg-success/10 border border-success/20 p-4">
              <p className="text-sm font-bold text-success mb-1">✅ Commande validée !</p>
              <p className="text-[12px] text-success/80">+{valResult.pointsEarned} points · Solde : {valResult.newBalance} pts · Tier : {tierInfo.label}</p>
              <button onClick={() => { setValState('idle'); setValResult(null) }} className="mt-2 text-xs text-success underline">Valider une autre</button>
            </div>
          )}
          {valState === 'err' && (
            <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive font-medium">{valError}</div>
          )}

          {valState !== 'ok' && (
            <form onSubmit={handleValidate} className="space-y-3">
              {[
                { key: 'email', label: 'Email du client', type: 'email', placeholder: 'client@email.com' },
                { key: 'uberOrderNumber', label: 'N° commande UberEats', type: 'text', placeholder: '#UE-58291' },
                { key: 'amount', label: 'Montant (€)', type: 'number', placeholder: '24.90' },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
                  <input type={type} required value={valForm[key as keyof typeof valForm]}
                    onChange={e => setValForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Marque</label>
                <select value={valForm.brandName} onChange={e => setValForm(f => ({ ...f, brandName: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  {BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <button type="submit" disabled={valState === 'loading'}
                className="w-full rounded-xl bg-primary py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
                {valState === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Valider & créditer
              </button>
            </form>
          )}
        </section>
      )}

      {/* ── Register ── */}
      {tab === 'register' && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <UserPlus size={15} className="text-primary" />
            <h2 className="text-sm font-bold">Inscrire un nouveau client</h2>
          </div>

          {regState === 'ok' && regResult && (
            <div className="mb-4 rounded-2xl bg-success/10 border border-success/20 p-4">
              <p className="text-sm font-bold text-success mb-1">✅ {regResult.name} inscrit !</p>
              <p className="text-[12px] text-success/80">{regResult.pointsBalance} pts de bienvenue · Code : <code className="font-mono">{regResult.referralCode.slice(0, 8)}</code></p>
              <button onClick={() => { setRegState('idle'); setRegResult(null) }} className="mt-2 text-xs text-success underline">Inscrire un autre</button>
            </div>
          )}
          {regState === 'err' && (
            <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive font-medium">{regError}</div>
          )}

          {regState !== 'ok' && (
            <form onSubmit={handleRegister} className="space-y-3">
              {[
                { key: 'name', label: 'Nom complet', type: 'text', placeholder: 'Mohammed Maazouz' },
                { key: 'email', label: 'Email', type: 'email', placeholder: 'client@email.com' },
                { key: 'phone', label: 'Téléphone (optionnel)', type: 'tel', placeholder: '+33 6 12 34 56 78' },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
                  <input type={type} required={key !== 'phone'} value={regForm[key as keyof typeof regForm]}
                    onChange={e => setRegForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              ))}
              <button type="submit" disabled={regState === 'loading'}
                className="w-full rounded-xl bg-primary py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
                {regState === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Inscrire au programme
              </button>
            </form>
          )}
        </section>
      )}

      {/* Rewards grid */}
      <h2 className="mb-3 mt-6 text-sm font-bold">Récompenses</h2>
      <div className="space-y-2">
        {REWARDS.map((r) => {
          const unlocked = balance >= r.cost
          return (
            <div key={r.name} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div className={`grid h-10 w-10 place-items-center rounded-xl ${unlocked ? 'bg-accent text-primary' : 'bg-muted text-muted-foreground'}`}>
                {unlocked ? <Gift size={16} /> : <Lock size={14} />}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">{r.cost} pts</p>
              </div>
              {unlocked
                ? <button className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground"><Check size={12} /> Utiliser</button>
                : <span className="text-[11px] font-semibold text-muted-foreground">Verrouillé</span>
              }
            </div>
          )
        })}
      </div>
    </div>
  )
}
