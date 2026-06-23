'use client'

import { useEffect, useState } from 'react'
import { signIn, getSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { StellarCard, StellarButton, StellarInput, StellarPriceTag } from '@/components/stellar'
import { WF_CART } from '../mock'

// SCREEN 6/7 — CHECKOUT, account-AT-payment AUTH part (Agent 132, brick 2c). Bataille 1 (kill the
// account wall): email only (NO password) → provisioning + mint (existing /api/auth/magic-link) →
// in-page 6-digit OTP → signIn → "Connecté ✓". Fallback magic-link when AUTH_EMAIL_OTP_ENABLED is
// OFF. ⚠️ STOPS AT "connected": the recap + "Confirmer" STILL navigate to /eat-next/track only —
// NO /api/orders, NO /pay, NO money route is called (the order/payment wiring is brick 2d). Uses the
// standalone next-auth/react signIn + getSession (no SessionProvider needed). Stellar tokens, mock cart.
type AuthState = 'init' | 'email' | 'code' | 'linkSent' | 'connected'
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)

export default function EatNextCheckout() {
  const router = useRouter()
  const locale = useLocale()
  const r = WF_CART.restaurant
  const subtotal = WF_CART.lines.reduce((s, l) => s + l.priceEur * l.qty, 0)
  const total = subtotal + r.deliveryFeeEur

  const [authState, setAuthState] = useState<AuthState>('init')
  const [email, setEmail] = useState('')
  const [connectedEmail, setConnectedEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [method, setMethod] = useState<'apple' | 'google' | 'card'>('apple')

  // Already signed in (e.g. returning consumer) → skip straight to "connected". Uses the
  // standalone getSession() (a fetch to /api/auth/session) so no SessionProvider is required.
  useEffect(() => {
    let cancelled = false
    getSession()
      .then((s) => {
        if (cancelled) return
        const e = (s?.user as { email?: string } | undefined)?.email
        if (e) { setConnectedEmail(e); setAuthState('connected') }
        else setAuthState('email')
      })
      .catch(() => { if (!cancelled) setAuthState('email') })
    return () => { cancelled = true }
  }, [])

  // ⚠️ MOCK — pure navigation. NO money route is ever called (brick 2d wires the real order/pay).
  const confirm = () => router.push('/eat-next/track')

  // Step 1: provision a passwordless consumer (generic) + trigger the EXISTING mint.
  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!isEmail(addr) || sending) return
    setSending(true)
    setAuthError(null)
    try {
      // Ensure the account exists so the (unchanged) mint can send a code/link. Generic — never
      // reveals whether the email already existed.
      await fetch('/api/eat-next/consumer-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      }).catch(() => {})
      // The EXISTING mint (byte-identical): sends code + link in one email and reports otpEnabled.
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr, locale }),
      })
      const data = await res.json().catch(() => null)
      setAuthState((data as { otpEnabled?: boolean } | null)?.otpEnabled ? 'code' : 'linkSent')
    } catch {
      setAuthState('linkSent') // generic by design — never reveal account state
    } finally {
      setSending(false)
    }
  }

  // Step 2: consume the 6-digit code via the EXISTING credentials provider → session posed.
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    const c = code.trim()
    if (!/^\d{6}$/.test(c) || verifying) return
    setVerifying(true)
    setAuthError(null)
    try {
      const res = await signIn('credentials', { email: email.trim().toLowerCase(), otp: c, redirect: false })
      if (res?.ok) {
        const s = await getSession().catch(() => null)
        setConnectedEmail((s?.user as { email?: string } | undefined)?.email ?? email.trim().toLowerCase())
        setAuthState('connected')
      } else {
        setAuthError('Code incorrect ou expiré. Réessayez.')
      }
    } catch {
      setAuthError('Code incorrect ou expiré. Réessayez.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-5 p-4">
      <h1 className="font-stellar-display text-xl font-extrabold text-stellar-fg">Paiement</h1>

      {/* Bataille 1 — account AT payment: email → code → connected, NO password ever. */}
      <StellarCard elevation="soft" padding="md" className="space-y-3">
        {authState === 'init' && <p className="text-sm text-stellar-muted-fg">Chargement…</p>}

        {authState === 'connected' && (
          <p className="flex items-center gap-2 font-stellar-display text-sm font-semibold text-stellar-fg">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-stellar-primary text-xs text-stellar-primary-fg">✓</span>
            Connecté en tant que <span className="font-bold">{connectedEmail}</span>
          </p>
        )}

        {authState === 'email' && (
          <form onSubmit={sendCode} className="space-y-3" noValidate>
            <StellarInput
              type="email"
              label="Votre email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@email.com"
              hint="Pas de mot de passe : on vous envoie un code à 6 chiffres (ou un lien). Votre compte se crée tout seul."
            />
            <StellarButton type="submit" variant="primary" fullWidth disabled={!isEmail(email.trim()) || sending}>
              {sending ? 'Envoi…' : 'Recevoir mon code'}
            </StellarButton>
          </form>
        )}

        {authState === 'code' && (
          <form onSubmit={verifyCode} className="space-y-3" noValidate>
            <p className="text-sm text-stellar-muted-fg">Un code à 6 chiffres a été envoyé à <span className="font-semibold text-stellar-fg">{email.trim().toLowerCase()}</span>. Saisissez-le ci-dessous.</p>
            {authError && <p className="rounded-stellar-md border border-stellar-border bg-stellar-surface-1 px-3 py-2 text-sm text-stellar-fg" role="alert">{authError}</p>}
            <StellarInput
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              label="Code de connexion"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
            />
            <StellarButton type="submit" variant="primary" fullWidth disabled={code.trim().length !== 6 || verifying}>
              {verifying ? 'Vérification…' : 'Valider le code'}
            </StellarButton>
            <button type="button" onClick={() => setAuthState('email')} className="w-full text-center text-xs text-stellar-muted-fg underline">
              Changer d’email
            </button>
          </form>
        )}

        {authState === 'linkSent' && (
          <div className="space-y-1">
            <p className="font-stellar-display text-sm font-semibold text-stellar-fg">Lien envoyé&nbsp;📬</p>
            <p className="text-sm text-stellar-muted-fg">Si un compte existe pour <span className="font-semibold text-stellar-fg">{email.trim().toLowerCase()}</span>, un lien de connexion vient d’être envoyé. Ouvrez-le pour vous connecter, puis revenez ici.</p>
          </div>
        )}
      </StellarCard>

      {/* Adresse + ETA (réassurance amont). */}
      <StellarCard elevation="soft" padding="md" className="space-y-1 text-sm text-stellar-fg">
        <div className="flex justify-between"><span>📍 Livraison</span><span className="font-medium">12 rue de la République</span></div>
        <div className="flex justify-between"><span>⏱ Estimation</span><span className="font-medium">{r.etaMin} min</span></div>
      </StellarCard>

      {/* Bataille 1 — 1-tap WALLET primary, card fallback. (Placeholders — no real SDK; brick 2d.) */}
      <section className="space-y-2">
        <p className="font-stellar-display text-sm font-semibold text-stellar-fg">Payer en 1 geste</p>
        <button onClick={() => setMethod('apple')} className={`flex w-full items-center justify-center gap-2 rounded-stellar-lg border py-3 font-stellar-display text-sm font-semibold ${method === 'apple' ? 'border-stellar-primary bg-stellar-primary text-stellar-primary-fg' : 'border-stellar-border bg-stellar-card text-stellar-fg'}`}>  Apple Pay <span className="text-xs font-normal opacity-70">(maquette)</span></button>
        <button onClick={() => setMethod('google')} className={`flex w-full items-center justify-center gap-2 rounded-stellar-lg border py-3 font-stellar-display text-sm font-semibold ${method === 'google' ? 'border-stellar-primary bg-stellar-primary text-stellar-primary-fg' : 'border-stellar-border bg-stellar-card text-stellar-fg'}`}>  G Pay <span className="text-xs font-normal opacity-70">(maquette)</span></button>
        <button onClick={() => setMethod('card')} className={`w-full rounded-stellar-lg border py-2.5 font-stellar-display text-sm ${method === 'card' ? 'border-stellar-primary bg-stellar-primary-soft text-stellar-accent-fg' : 'border-stellar-border bg-stellar-card text-stellar-muted-fg'}`}>  Payer par carte (repli)</button>
      </section>

      {/* Bataille 2 — transparent FINAL recap. */}
      <StellarCard elevation="soft" padding="md" className="space-y-1 text-sm">
        <div className="flex justify-between text-stellar-muted-fg"><span>Sous-total</span><StellarPriceTag amountEur={subtotal} size="sm" /></div>
        <div className="flex justify-between text-stellar-muted-fg"><span>Frais de livraison</span><span>{r.deliveryFeeEur === 0 ? 'Offerts' : <StellarPriceTag amountEur={r.deliveryFeeEur} size="sm" />}</span></div>
        <div className="mt-1 flex items-center justify-between border-t border-stellar-border pt-2 font-stellar-display text-base font-bold text-stellar-fg"><span>Total à payer</span><StellarPriceTag amountEur={total} size="lg" /></div>
      </StellarCard>

      {/* STOPS AT "connected": Confirmer remains a MOCK → /eat-next/track. Enabled once connected. */}
      <StellarButton variant="primary" fullWidth onClick={confirm} disabled={authState !== 'connected'}>
        Confirmer la commande · {total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
      </StellarButton>
      <p className="text-center text-xs text-stellar-muted-fg">
        {authState === 'connected' ? 'Maquette — aucun paiement réel n’est effectué (branchement à venir).' : 'Connectez-vous par email pour continuer.'}
      </p>
    </div>
  )
}
