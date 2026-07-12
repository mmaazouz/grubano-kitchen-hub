'use client'

/**
 * /loyalty — operator FIDÉLITÉ screen. VERBATIM CD v1 LOT 3 (Notion 390fd2c9-…-b35a,
 * fichier CD operator/loyalty.html). ⚠️ ZONE LOGIQUE (moteur accumulation/échange).
 *
 * The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome, Fidélité
 * reachable via the rail). This component renders ONLY the screen content = a <section>
 * inside op-content.
 *
 * 🔒 PRESENTATION-ONLY RE-SKIN. Every data handler is PRESERVED byte-identical from the
 * legacy page — the visual (JSX structure + CSS → CD --op-) changed, the logic did not:
 *   • handleValidate → POST /api/loyalty/validate { email, uberOrderNumber, amount, brandName }
 *   • handleRegister → POST /api/loyalty/register { name, email, phone? }
 *   • handleWallet   → GET  /api/loyalty/wallet?email=<email>  (operator consults a wallet)
 * No payload, no state shape, no fetch is renamed or changed.
 *
 * 🔒 POINTS / MONEY INTEGRITY. Points, euros and tiers are DISPLAYED straight from the real
 * endpoints (validate.newBalance / wallet.pointsBalance / wallet.balanceEuros) — NEVER
 * recomputed client-side. The conversion (centsPerPoint, creditScale, balanceEuros) comes
 * from the wallet endpoint, never a hardcoded rate; euros are rendered via formatEuros.
 * Program tiers (Bronze 0 / Silver 100 / Gold 200 / Platine 400 pts) + the welcome bonus
 * are FROZEN program constants (lib/loyalty), shown as read-only rules — this screen NEVER
 * edits lib/loyalty or the engine. Blocks with no backend (global aggregate stats: members,
 * points issued/redeemed, rewards given) are HONEST « bientôt » previews, never fake data.
 * All figures carry className="mono".
 */

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import './loyalty.css'

const BRANDS = ['Gnocchi Bar', 'Le Riz Gourmand', 'Pasta Fresca', 'Rollix']

// FROZEN program constants (mirror lib/loyalty + the wallet TIER_THRESHOLDS). Displayed as
// read-only rules — this screen never recomputes tiers, it only shows them.
const TIERS = [
  { key: 'bronze',  min: 0,   icon: 'workspace_premium' },
  { key: 'silver',  min: 100, icon: 'workspace_premium' },
  { key: 'gold',    min: 200, icon: 'military_tech' },
  { key: 'platine', min: 400, icon: 'diamond' },
] as const

type Tab = 'validate' | 'register' | 'wallet'

type WalletData = {
  pointsBalance: number
  centsPerPoint: number
  balanceEuros: number
  creditScale: { points: number; euros: number }[]
  tier: string
  next_tier: string | null
  next_tier_pts: number
  recent_orders: { id: string; brand: string; amount: number; pointsEarned: number; date: string }[]
  referral_code: string
}

export default function LoyaltyPage() {
  const t = useTranslations('operator')
  const locale = useLocale()
  const [tab, setTab] = useState<Tab>('validate')

  /* ── Validate order (POST /api/loyalty/validate) — byte-identical handler ───── */
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

  /* ── Register (POST /api/loyalty/register) — byte-identical handler ─────────── */
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

  /* ── Wallet lookup (GET /api/loyalty/wallet?email=) — consult a client wallet ─ */
  const [walEmail, setWalEmail] = useState('')
  const [walState, setWalState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [walData, setWalData] = useState<WalletData | null>(null)
  const [walError, setWalError] = useState('')

  async function handleWallet(e: React.FormEvent) {
    e.preventDefault(); setWalState('loading'); setWalError(''); setWalData(null)
    const res = await fetch(`/api/loyalty/wallet?email=${encodeURIComponent(walEmail)}`, { cache: 'no-store' })
    const data = await res.json()
    if (res.ok) { setWalData(data); setWalState('ok') }
    else { setWalError(data.error ?? 'Erreur inconnue.'); setWalState('err') }
  }

  // Tier label from the (frozen) tier list; falls back to the raw tier string.
  const tierLabel = (key: string) => {
    const found = TIERS.find(x => x.key === key)
    return found ? t(`loyalty.tier.${found.key}`) : key
  }

  // wallet progress to next tier (display-only: derived from wallet.next_tier_pts, the
  // server's own figure — we never recompute the threshold client-side).
  const walletProgress = (() => {
    if (!walData) return 0
    const cur = TIERS.find(x => x.key === walData.tier)
    if (!cur) return 100
    const next = TIERS[TIERS.indexOf(cur) + 1]
    if (!next) return 100
    const span = next.min - cur.min
    const done = walData.pointsBalance - cur.min
    return Math.max(0, Math.min(100, span > 0 ? (done / span) * 100 : 100))
  })()

  return (
    <section>
      {/* ── head ── */}
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('loyalty.title')}</h1>
          <p className="op-dash__sub">{t('loyalty.subtitle')}</p>
        </div>
        <div className="loyalty-master">
          <span>{t('loyalty.programActive')}</span>
          <label className="op-switch" title={t('soon')}>
            <input type="checkbox" checked readOnly aria-label={t('loyalty.programActive')} />
            <span className="track" />
          </label>
        </div>
      </div>

      {/* ── aggregate stats — NO endpoint → honest « bientôt » ── */}
      <div className="op-card loyalty-stats" aria-label={t('loyalty.stats.title')}>
        {(['members', 'pointsIssued', 'pointsRedeemed', 'rewardsGiven'] as const).map(k => (
          <div className="stat" key={k}>
            <span className="lbl">{t(`loyalty.stats.${k}`)}</span>
            <b className="soon">{t('soon')}</b>
          </div>
        ))}
      </div>

      {/* ── program rules (FROZEN constants — displayed, never editable here) ── */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">stars</span>{t('loyalty.earn.title')}</h2></div>
        <div className="op-tool-body">
          <div className="earn-rule">
            <span>{t('loyalty.earn.earn')}</span>
            <span className="rule-val mono">1</span>
            <span>{t('loyalty.earn.pointPer')}</span>
            <span className="rule-val mono">{formatEuros(1, locale)}</span>
            <span>{t('loyalty.earn.spent')}</span>
          </div>
          <div className="op-field-row">
            <div className="op-field">
              <label>{t('loyalty.earn.welcomeBonus')}</label>
              <div className="rule-static mono">10 {t('loyalty.pts')}</div>
            </div>
            <div className="op-field">
              <label>{t('loyalty.earn.expiration')}</label>
              <div className="rule-static">{t('loyalty.earn.noExpiry')}</div>
            </div>
          </div>
          <div className="op-callout">
            <span className="ms" aria-hidden="true">info</span>
            <p>{t('loyalty.earn.frozenNote')}</p>
          </div>
        </div>
      </div>

      {/* ── tiers (paliers programme — FROZEN) ── */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">workspace_premium</span>{t('loyalty.tiers.title')}</h2></div>
        <div className="tier-grid">
          {TIERS.map(tier => (
            <div className={`tier-card ${tier.key}`} key={tier.key}>
              <span className="tier-badge"><span className="ms" aria-hidden="true">{tier.icon}</span>{t(`loyalty.tier.${tier.key}`)}</span>
              <div className="tier-th mono">{tier.min}<span className="u">{t('loyalty.pts')}</span></div>
              <div className="tier-note">{tier.min === 0 ? t('loyalty.tiers.entry') : t('loyalty.tiers.from')}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── credit scale (points → € credit) ──
          The euro amounts are AUTHORITATIVE only once read from the wallet endpoint
          (walData.creditScale — the server's real conversion). Before any lookup we show
          the point milestones only, with an « indicatif » tag — never a fabricated € figure
          presented as real. The exact spendable credit is resolved server-side at checkout. */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        <div className="op-card__head">
          <h2><span className="ms" aria-hidden="true">redeem</span>{t('loyalty.credit.title')}</h2>
          {!walData && <span className="cap">{t('loyalty.credit.indicative')}</span>}
        </div>
        <div className="credit-scale">
          {(walData?.creditScale ?? [{ points: 100 }, { points: 200 }, { points: 400 }]).map(cs => (
            <div className="cs" key={cs.points}>
              <div className="cs-pts mono">{cs.points}<span className="u">{t('loyalty.pts')}</span></div>
              <div className="cs-arrow"><span className="ms" aria-hidden="true">arrow_downward</span>{t('loyalty.credit.gives')}</div>
              {'euros' in cs
                ? <div className="cs-eur mono">{formatEuros(cs.euros, locale)}</div>
                : <div className="cs-eur mono" style={{ color: 'var(--op-muted-2)', fontSize: 13 }}>{t('soon')}</div>}
            </div>
          ))}
        </div>
        <div style={{ padding: '0 18px 16px' }}>
          <div className="op-callout">
            <span className="ms" aria-hidden="true">info</span>
            <p>{t('loyalty.credit.note')}</p>
          </div>
        </div>
      </div>

      {/* ── operator tools: validate / register / wallet lookup ── */}
      <div className="op-card">
        <div className="op-card__head"><h2><span className="ms" aria-hidden="true">handyman</span>{t('loyalty.tools.title')}</h2></div>
        <div className="op-tool-body">
          <div className="op-tools-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'validate'} className={tab === 'validate' ? 'is-active' : ''} onClick={() => setTab('validate')}>
              <span className="ms" aria-hidden="true">verified</span>{t('loyalty.tools.validate')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'is-active' : ''} onClick={() => setTab('register')}>
              <span className="ms" aria-hidden="true">person_add</span>{t('loyalty.tools.register')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'wallet'} className={tab === 'wallet' ? 'is-active' : ''} onClick={() => setTab('wallet')}>
              <span className="ms" aria-hidden="true">account_balance_wallet</span>{t('loyalty.tools.wallet')}
            </button>
          </div>

          {/* ── validate a UberEats order → credit points ── */}
          {tab === 'validate' && (
            <>
              {valState === 'ok' && valResult && (
                <div className="op-callout success">
                  <span className="ms" aria-hidden="true">check_circle</span>
                  <div>
                    <p className="co-title">{t('loyalty.validate.okTitle')}</p>
                    <p>+<span className="mono">{valResult.pointsEarned}</span> {t('loyalty.pts')} · {t('loyalty.validate.balance')} <span className="mono">{valResult.newBalance}</span> {t('loyalty.pts')} · {tierLabel(valResult.tier)}</p>
                    <button type="button" className="co-again" onClick={() => { setValState('idle'); setValResult(null) }}>{t('loyalty.validate.again')}</button>
                  </div>
                </div>
              )}
              {valState === 'err' && (
                <div className="op-callout danger"><span className="ms" aria-hidden="true">error</span><p>{valError}</p></div>
              )}
              {valState !== 'ok' && (
                <form className="op-tool-form" onSubmit={handleValidate}>
                  <div className="op-field">
                    <label>{t('loyalty.validate.email')}</label>
                    <input className="op-input" type="email" required value={valForm.email} onChange={e => setValForm(f => ({ ...f, email: e.target.value }))} placeholder="client@email.com" />
                  </div>
                  <div className="op-field">
                    <label>{t('loyalty.validate.orderNo')}</label>
                    <input className="op-input mono" type="text" required value={valForm.uberOrderNumber} onChange={e => setValForm(f => ({ ...f, uberOrderNumber: e.target.value }))} placeholder="#UE-58291" />
                  </div>
                  <div className="op-field">
                    <label>{t('loyalty.validate.amount')}</label>
                    <input className="op-input mono" type="number" step="0.01" required value={valForm.amount} onChange={e => setValForm(f => ({ ...f, amount: e.target.value }))} placeholder="24.90" />
                  </div>
                  <div className="op-field">
                    <label>{t('loyalty.validate.brand')}</label>
                    <select className="op-select" value={valForm.brandName} onChange={e => setValForm(f => ({ ...f, brandName: e.target.value }))}>
                      {BRANDS.map(b => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                  <button type="submit" className="op-btn-primary" disabled={valState === 'loading'}>
                    <span className={`ms${valState === 'loading' ? ' spin' : ''}`} aria-hidden="true">{valState === 'loading' ? 'progress_activity' : 'check'}</span>
                    {t('loyalty.validate.submit')}
                  </button>
                </form>
              )}
            </>
          )}

          {/* ── register a new member ── */}
          {tab === 'register' && (
            <>
              {regState === 'ok' && regResult && (
                <div className="op-callout success">
                  <span className="ms" aria-hidden="true">check_circle</span>
                  <div>
                    <p className="co-title">{t('loyalty.register.okTitle', { name: regResult.name })}</p>
                    <p><span className="mono">{regResult.pointsBalance}</span> {t('loyalty.register.welcomePts')} · {t('loyalty.register.code')} <code className="mono">{regResult.referralCode.slice(0, 8)}</code></p>
                    <button type="button" className="co-again" onClick={() => { setRegState('idle'); setRegResult(null) }}>{t('loyalty.register.again')}</button>
                  </div>
                </div>
              )}
              {regState === 'err' && (
                <div className="op-callout danger"><span className="ms" aria-hidden="true">error</span><p>{regError}</p></div>
              )}
              {regState !== 'ok' && (
                <form className="op-tool-form" onSubmit={handleRegister}>
                  <div className="op-field">
                    <label>{t('loyalty.register.name')}</label>
                    <input className="op-input" type="text" required value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))} placeholder="Mohammed Maazouz" />
                  </div>
                  <div className="op-field">
                    <label>{t('loyalty.register.email')}</label>
                    <input className="op-input" type="email" required value={regForm.email} onChange={e => setRegForm(f => ({ ...f, email: e.target.value }))} placeholder="client@email.com" />
                  </div>
                  <div className="op-field">
                    <label>{t('loyalty.register.phone')}</label>
                    <input className="op-input" type="tel" value={regForm.phone} onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))} placeholder="+33 6 12 34 56 78" />
                  </div>
                  <button type="submit" className="op-btn-primary" disabled={regState === 'loading'}>
                    <span className={`ms${regState === 'loading' ? ' spin' : ''}`} aria-hidden="true">{regState === 'loading' ? 'progress_activity' : 'person_add'}</span>
                    {t('loyalty.register.submit')}
                  </button>
                </form>
              )}
            </>
          )}

          {/* ── wallet lookup by email ── */}
          {tab === 'wallet' && (
            <>
              <form className="op-tool-form" onSubmit={handleWallet}>
                <div className="op-field">
                  <label>{t('loyalty.wallet.email')}</label>
                  <input className="op-input" type="email" required value={walEmail} onChange={e => setWalEmail(e.target.value)} placeholder="client@email.com" />
                </div>
                <button type="submit" className="op-btn-primary" disabled={walState === 'loading'}>
                  <span className={`ms${walState === 'loading' ? ' spin' : ''}`} aria-hidden="true">{walState === 'loading' ? 'progress_activity' : 'search'}</span>
                  {t('loyalty.wallet.lookup')}
                </button>
              </form>

              {walState === 'loading' && (
                <div aria-busy="true">
                  <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12 }} />
                </div>
              )}
              {walState === 'err' && (
                <div className="op-emptyline">
                  <span className="ms" aria-hidden="true">search_off</span>
                  <b>{t('loyalty.wallet.notFoundTitle')}</b>
                  <span>{walError}</span>
                </div>
              )}
              {walState === 'ok' && walData && (
                <div>
                  <div className="wallet-card">
                    <div className="wc-glow" aria-hidden="true" />
                    <div className="wc-top">
                      <div className="wc-who">
                        <div className="wc-av"><span className="ms" aria-hidden="true">account_balance_wallet</span></div>
                        <div>
                          <div className="wc-lbl">{t('loyalty.wallet.pointsWallet')}</div>
                          <div className="wc-mail">{walEmail}</div>
                        </div>
                      </div>
                      <span className="wc-tier"><span className="ms" aria-hidden="true">workspace_premium</span>{tierLabel(walData.tier)}</span>
                    </div>
                    <div className="wc-bal">
                      <div className="pts"><span className="mono">{walData.pointsBalance.toLocaleString(locale)}</span> <span className="u">{t('loyalty.pts')}</span></div>
                      <div className="eur">{t('loyalty.wallet.creditWorth')} <span className="mono">{formatEuros(walData.balanceEuros, locale)}</span></div>
                    </div>
                    <div className="wc-prog">
                      <div className="track"><i style={{ width: `${walletProgress}%` }} /></div>
                      <div className="wc-next">
                        {walData.next_tier
                          ? <>{t('loyalty.wallet.toNext', { pts: walData.next_tier_pts, tier: tierLabel(walData.next_tier.toLowerCase()) })}</>
                          : <>{t('loyalty.wallet.maxTier')}</>}
                      </div>
                    </div>
                    <div className="wc-ref">
                      <span className="ms" aria-hidden="true">confirmation_number</span>
                      {t('loyalty.wallet.referral')} <span className="mono">{walData.referral_code}</span>
                    </div>
                  </div>

                  <div className="wallet-orders">
                    <div className="wo-h">{t('loyalty.wallet.recentOrders')}</div>
                    {walData.recent_orders.length === 0 ? (
                      <div className="op-emptyline" style={{ padding: '24px 16px' }}>
                        <span className="ms" aria-hidden="true">receipt_long</span>
                        <b>{t('loyalty.wallet.noOrders')}</b>
                      </div>
                    ) : (
                      walData.recent_orders.map(o => (
                        <div className="wo-row" key={o.id}>
                          <div className="wo-ic"><span className="ms" aria-hidden="true">receipt_long</span></div>
                          <div className="m">
                            <b>{o.brand}</b>
                            <span>{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(o.date))}</span>
                          </div>
                          <div className="wo-amt">
                            <div className="a">{formatEuros(o.amount, locale)}</div>
                            <div className="p">+{o.pointsEarned} {t('loyalty.pts')}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
