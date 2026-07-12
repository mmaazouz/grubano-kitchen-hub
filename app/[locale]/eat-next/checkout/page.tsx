'use client'

import { useEffect, useState } from 'react'
import { signIn, getSession } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { StellarCard, StellarButton, StellarInput, StellarPriceTag } from '@/components/stellar'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'
import WalletPaymentButton from '@/components/eat-next/WalletPaymentButton'
import { formatEuros } from '@/lib/format-money'
import { useEatNextCart } from '../cart-store'
import { buildOrderBody } from '../checkout-order'

// SCREEN 6/7 — CHECKOUT, REAL order + payment (Agent 132 auth + 133 cart + 134 money). 🔴 MONEY ZONE.
// Flow once connected: address → POST /api/orders (REUSED byte-identical) → 201 {orderId, total
// (SERVER authority)} → POST /api/orders/[id]/pay (REUSED) → {clientSecret, publishableKey} →
// StripeTicketPayment (REUSED Elements) → onPaid → clear cart → /eat-next/track/[orderId] (real
// status). The client sends NO amount (server is the authority); consumerId is server-set. Anti-
// double-submit guard. Errors are graceful (cart never lost on failure; never double-charge). The
// money engine (orders/pay/webhook/commission/ledger/pricing/stripe) + StripeTicketPayment are
// REUSED byte-identical — NOT modified, NOT forked. Stellar tokens.
type AuthState = 'init' | 'email' | 'code' | 'linkSent' | 'connected'
type PayInit = { clientSecret: string; publishableKey: string; amount: number; currency: string }
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)

export default function EatNextCheckout() {
  const t = useTranslations('eatNext.checkout')
  const router = useRouter()
  const locale = useLocale()
  // Real cart (Agent 133). subtotalEur is a NAÏVE estimate; the SERVER total (from the 201) is the
  // authority once the order is created.
  const { cart, subtotalEur, clearCart } = useEatNextCart()

  // ── Auth (Agent 132, UNCHANGED) ──
  const [authState, setAuthState] = useState<AuthState>('init')
  const [email, setEmail] = useState('')
  const [connectedEmail, setConnectedEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // ── Order + payment (Agent 134) ──
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery')
  const [submitting, setSubmitting] = useState(false) // anti-double-submit guard
  const [orderId, setOrderId] = useState<string | null>(null)
  const [serverTotal, setServerTotal] = useState<number | null>(null)
  const [payInit, setPayInit] = useState<PayInit | null>(null)
  const [orderError, setOrderError] = useState<string | null>(null)

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

  // ── Auth handlers (Agent 132, UNCHANGED) ──
  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!isEmail(addr) || sending) return
    setSending(true)
    setAuthError(null)
    try {
      await fetch('/api/eat-next/consumer-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr }),
      }).catch(() => {})
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addr, locale }),
      })
      const data = await res.json().catch(() => null)
      setAuthState((data as { otpEnabled?: boolean } | null)?.otpEnabled ? 'code' : 'linkSent')
    } catch {
      setAuthState('linkSent')
    } finally {
      setSending(false)
    }
  }

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
        setAuthError(t('codeError'))
      }
    } catch {
      setAuthError(t('codeError'))
    } finally {
      setVerifying(false)
    }
  }

  // ── Order + pay (Agent 134) — REUSES the byte-identical money routes ──
  async function handlePay() {
    if (submitting || authState !== 'connected') return
    if (!cart || cart.items.length === 0) { setOrderError(t('cartEmpty')); return }
    if (deliveryAddress.trim().length < 5) { setOrderError(t('errAddress')); return }
    setSubmitting(true) // guard → no second POST /api/orders while in-flight
    setOrderError(null)
    try {
      // 1) Create the order ONCE (re-use the existing orderId on a payment retry → no double order).
      let oid = orderId
      if (!oid) {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildOrderBody(cart, { deliveryAddress: deliveryAddress.trim(), fulfillmentType })),
        })
        if (res.status === 401) { setAuthState('email'); setOrderError(t('errSessionExpiredKept')); return }
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.orderId) { setOrderError((data?.error as string) || t('errOrder')); return }
        oid = data.orderId as string
        setOrderId(oid)
        if (typeof data.total === 'number') setServerTotal(data.total) // SERVER total = authority
      }
      // 2) Init the payment (server reads order.total — client sends nothing).
      const payRes = await fetch(`/api/orders/${oid}/pay`, { method: 'POST' })
      if (payRes.status === 409) { clearCart(); router.push(`/eat-next/track/${oid}`); return } // already paid
      if (payRes.status === 401) { setAuthState('email'); setOrderError(t('errSessionExpired')); return }
      const payData = await payRes.json().catch(() => null)
      if (!payRes.ok || !payData?.clientSecret || !payData?.publishableKey) {
        setOrderError((payData?.error as string) || t('errPay'))
        return
      }
      setPayInit({ clientSecret: payData.clientSecret, publishableKey: payData.publishableKey, amount: payData.amount, currency: payData.currency })
    } catch {
      setOrderError(t('errNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  // Payment confirmed by Stripe → clear the cart (ONLY now) and go to the REAL tracking screen.
  function onPaid() {
    clearCart()
    if (orderId) router.push(`/eat-next/track/${orderId}`)
  }

  const displayTotal = serverTotal ?? subtotalEur
  const cartEmpty = !cart || cart.items.length === 0

  return (
    <div className="space-y-5 p-4">
      <h1 className="font-stellar-display text-xl font-extrabold text-stellar-fg">{t('title')}</h1>

      {/* Bataille 1 — account AT payment: email → code → connected, NO password ever (Agent 132). */}
      <StellarCard elevation="soft" padding="md" className="space-y-3">
        {authState === 'init' && <p className="text-sm text-stellar-muted-fg">{t('loading')}</p>}

        {authState === 'connected' && (
          <p className="flex items-center gap-2 font-stellar-display text-sm font-semibold text-stellar-fg">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-stellar-primary text-xs text-stellar-primary-fg">✓</span>
            {t('connectedAs')} <span className="font-bold">{connectedEmail}</span>
          </p>
        )}

        {authState === 'email' && (
          <form onSubmit={sendCode} className="space-y-3" noValidate>
            <StellarInput
              type="email"
              label={t('emailLabel')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              hint={t('emailHint')}
            />
            <StellarButton type="submit" variant="primary" fullWidth disabled={!isEmail(email.trim()) || sending}>
              {sending ? t('sending') : t('sendCode')}
            </StellarButton>
          </form>
        )}

        {authState === 'code' && (
          <form onSubmit={verifyCode} className="space-y-3" noValidate>
            <p className="text-sm text-stellar-muted-fg">{t('codeSent', { email: email.trim().toLowerCase() })}</p>
            {authError && <p className="rounded-stellar-md border border-stellar-border bg-stellar-surface-1 px-3 py-2 text-sm text-stellar-fg" role="alert">{authError}</p>}
            <StellarInput
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              label={t('codeLabel')}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
            />
            <StellarButton type="submit" variant="primary" fullWidth disabled={code.trim().length !== 6 || verifying}>
              {verifying ? t('verifying') : t('validateCode')}
            </StellarButton>
            <button type="button" onClick={() => setAuthState('email')} className="w-full text-center text-xs text-stellar-muted-fg underline">
              {t('changeEmail')}
            </button>
          </form>
        )}

        {authState === 'linkSent' && (
          <div className="space-y-1">
            <p className="font-stellar-display text-sm font-semibold text-stellar-fg">{t('linkSentTitle')}</p>
            <p className="text-sm text-stellar-muted-fg">{t('linkSentBody', { email: email.trim().toLowerCase() })}</p>
          </div>
        )}
      </StellarCard>

      {/* Empty-cart guard (connected but nothing to pay). */}
      {authState === 'connected' && cartEmpty && (
        <StellarCard elevation="soft" padding="md" className="space-y-3 text-center">
          <p className="text-sm text-stellar-muted-fg">{t('cartEmpty')}</p>
          <StellarButton variant="primary" onClick={() => router.push('/eat-next')}>{t('discover')}</StellarButton>
        </StellarCard>
      )}

      {/* PAY STAGE — Stripe Elements (REUSED byte-identical). The wallet 1-tap (Apple/Google Pay) and
          the card form CONFIRM THE SAME PaymentIntent (same payInit.clientSecret); the wallet sheet
          shows the SERVER amount (payInit.amount/currency). The wallet hides itself when no wallet is
          available on the device → card-only. Both share the SAME onPaid (clearCart → tracking). */}
      {authState === 'connected' && !cartEmpty && payInit && (
        <StellarCard elevation="soft" padding="md" className="space-y-3">
          <WalletPaymentButton
            clientSecret={payInit.clientSecret}
            publishableKey={payInit.publishableKey}
            amount={payInit.amount}
            currency={payInit.currency}
            label={t('totalToPay')}
            heading={t('oneTap')}
            errorLabel={t('errPay')}
            onPaid={onPaid}
          />
          <p className="font-stellar-display text-sm font-semibold text-stellar-fg">{t('cardPayment')}</p>
          <StripeTicketPayment
            clientSecret={payInit.clientSecret}
            publishableKey={payInit.publishableKey}
            amount={payInit.amount}
            currency={payInit.currency}
            onPaid={onPaid}
          />
        </StellarCard>
      )}

      {/* COLLECT STAGE — address + fulfillment + "Payer par carte". Hidden once the card form is up. */}
      {authState === 'connected' && !cartEmpty && !payInit && (
        <>
          <StellarCard elevation="soft" padding="md" className="space-y-3">
            <div className="flex gap-2">
              {(['delivery', 'pickup'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFulfillmentType(f)}
                  className={`flex-1 rounded-stellar-md border px-3 py-2 font-stellar-display text-sm ${fulfillmentType === f ? 'border-stellar-primary bg-stellar-primary text-stellar-primary-fg' : 'border-stellar-border bg-stellar-card text-stellar-fg'}`}
                >
                  {f === 'delivery' ? t('delivery') : t('pickup')}
                </button>
              ))}
            </div>
            <StellarInput
              type="text"
              label={fulfillmentType === 'delivery' ? t('addressDelivery') : t('addressPickup')}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder={t('addressPlaceholder')}
            />
          </StellarCard>

          {/* Wallet 1-tap (Apple/Google Pay) now lives in the PAY stage, where the SERVER amount is
              known (payInit). It can only reflect the server total — never the client estimate — so it
              appears after the order + PaymentIntent are created, alongside the card. */}
          <p className="text-center text-xs text-stellar-muted-fg">{t('oneTap')}</p>

          {orderError && <p className="rounded-stellar-md border border-stellar-border bg-stellar-surface-1 px-3 py-2 text-sm text-stellar-fg" role="alert">{orderError}</p>}

          <StellarButton variant="primary" fullWidth onClick={handlePay} disabled={submitting || deliveryAddress.trim().length < 5}>
            {submitting ? t('processing') : `${t('payCard')} · ${formatEuros(displayTotal, locale)}`}
          </StellarButton>
          <p className="text-center text-xs text-stellar-muted-fg">{t('payNote')}</p>
        </>
      )}

      {/* Recap (estimate until the order is created; then the SERVER total). */}
      {!cartEmpty && (
        <StellarCard elevation="soft" padding="md" className="space-y-1 text-sm">
          <div className="flex justify-between text-stellar-muted-fg"><span>{t('subtotal')}</span><StellarPriceTag amountEur={subtotalEur} size="sm" /></div>
          <div className="mt-1 flex items-center justify-between border-t border-stellar-border pt-2 font-stellar-display text-base font-bold text-stellar-fg">
            <span>{serverTotal !== null ? t('totalToPay') : t('totalEstimated')}</span><StellarPriceTag amountEur={displayTotal} size="lg" />
          </div>
        </StellarCard>
      )}

      {authState !== 'connected' && authState !== 'init' && (
        <p className="text-center text-xs text-stellar-muted-fg">{t('connectToPay')}</p>
      )}
    </div>
  )
}
