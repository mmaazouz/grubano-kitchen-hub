import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Wallet 1-tap (Apple/Google Pay) in the LIVE /eat checkout — Agent 139 ──────
// CALQUE of components/eat-next/WalletPaymentButton (Agent 137) with /eat styling (NO Stellar). The
// wallet CONFIRMS THE SAME PaymentIntent as the card (same clientSecret from /pay); the sheet shows the
// SERVER amount (payInit.amount). Success runs the SAME onPaid the card uses — () => setStage('paid') —
// which drives the existing confirm-poll + tracking. Source-scan style (Stripe browser APIs are
// impractical to exercise in node — same house style as eat-next-wallet.test.ts).

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const WALLET = 'components/eat/WalletPaymentButton.tsx'
const CHECKOUT = 'app/[locale]/eat/checkout/[orderId]/page.tsx'
const TICKET = 'components/payments/StripeTicketPayment.tsx'

describe('(1) server amount — wallet reflects the server total, never a client calc', () => {
  const code = stripComments(read(WALLET))

  it('builds the PaymentRequest total from the server `amount` prop (display only)', () => {
    expect(/stripe\.paymentRequest\(\{/.test(code)).toBe(true)
    expect(/total:\s*\{\s*label,\s*amount\s*\}/.test(code)).toBe(true)
  })

  it('confirms the SAME PaymentIntent via clientSecret, attaching ONLY the wallet payment method', () => {
    expect(/confirmCardPayment\(\s*clientSecret/.test(code)).toBe(true)
    expect(/payment_method:\s*ev\.paymentMethod\.id/.test(code)).toBe(true)
    expect(/handleActions:\s*false/.test(code)).toBe(true)
  })

  it('does NO client-side amount math and imports no cart/pricing layer', () => {
    expect(/subtotal|cart-store|eat-cart|reduce\(|\*\s*100|\/\s*100|formatEuros|priceEur|computeApplicationFee/i.test(code)).toBe(false)
  })

  it('the checkout feeds the wallet the SERVER payInit.amount (same as the card)', () => {
    const co = read(CHECKOUT)
    // both the wallet and the card receive amount={payInit.amount} (server, from /pay)
    expect((co.match(/amount=\{payInit\.amount\}/g) || []).length).toBeGreaterThanOrEqual(2)
    // the wallet's displayed total label is the existing translated key, not a computed number
    expect(/label=\{t\('total'\)\}/.test(co)).toBe(true)
  })
})

describe('(2) availability — canMakePayment() gates the button', () => {
  const code = stripComments(read(WALLET))
  it('asks canMakePayment() and keeps the request only when a wallet is available', () => {
    expect(/canMakePayment\(\)/.test(code)).toBe(true)
    expect(/result\s*\?\s*pr\s*:\s*null/.test(code)).toBe(true)
  })
  it('renders NOTHING when no wallet is available (button masqué → card-only)', () => {
    expect(/if\s*\(\s*!paymentRequest\s*\)\s*return null/.test(code)).toBe(true)
  })
})

describe('(3) success = the SAME path as the card in /eat', () => {
  const code = stripComments(read(WALLET))
  const co = stripComments(read(CHECKOUT))

  it('the wallet gets the SAME onPaid as the card — () => setStage(paid)', () => {
    // both StripeTicketPayment and WalletPaymentButton receive onPaid={() => setStage('paid')}
    expect((co.match(/onPaid=\{\(\)\s*=>\s*setStage\('paid'\)\}/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('setStage(paid) drives the EXISTING confirm-poll + tracking nav (unchanged behaviour)', () => {
    expect(/stage !== 'paid'/.test(co)).toBe(true) // confirm-poll fires on the paid stage
    expect(/fetch\(`\/api\/orders\/\$\{orderId\}\/confirm`,\s*\{\s*method:\s*'POST'\s*\}\)/.test(co)).toBe(true)
    expect(/router\.push\(`\/eat\/track\//.test(co)).toBe(true)
  })

  it('the wallet fires onPaid ONLY after a successful confirmation (never on fail / 3DS-fail)', () => {
    const idxConfirm = code.indexOf('confirmCardPayment')
    const idxFail = code.indexOf("ev.complete('fail')")
    const idxSuccess = code.indexOf("ev.complete('success')")
    const idxOnPaid = code.indexOf('onPaidRef.current()')
    expect(idxConfirm).toBeGreaterThan(-1)
    expect(idxFail).toBeGreaterThan(-1)
    expect(idxSuccess).toBeGreaterThan(-1)
    expect(idxOnPaid).toBeGreaterThan(-1)
    expect(idxFail).toBeLessThan(idxSuccess)
    expect(idxConfirm).toBeLessThan(idxOnPaid)
    expect(idxSuccess).toBeLessThan(idxOnPaid)
    // decline path returns before the success path
    const idxReturnAfterFail = code.indexOf('return', idxFail)
    expect(idxReturnAfterFail).toBeGreaterThan(idxFail)
    expect(idxReturnAfterFail).toBeLessThan(idxSuccess)
    // 3DS-failure branch returns before onPaid (no false success)
    const idxNextError = code.indexOf('next.error')
    expect(idxNextError).toBeGreaterThan(idxSuccess)
    const idxReturnAfterNextError = code.indexOf('return', idxNextError)
    expect(idxReturnAfterNextError).toBeGreaterThan(idxNextError)
    expect(idxReturnAfterNextError).toBeLessThan(idxOnPaid)
  })
})

describe('(4) StripeTicketPayment unchanged + (5) no Stellar / no money lib', () => {
  it('StripeTicketPayment was NOT modified to add a wallet (no PaymentRequest)', () => {
    const ticket = read(TICKET)
    expect(/PaymentRequestButton|paymentRequest\(/.test(ticket)).toBe(false)
  })

  it('the /eat wallet applies NO Stellar / design system (current /eat look only)', () => {
    // strip comments — the header prose says "NOT Stellar"; we test the actual code/classes/imports
    const code = stripComments(read(WALLET))
    expect(/stellar|grubano-v2|components\/stellar/i.test(code)).toBe(false)
  })

  it('the /eat wallet imports no money lib and re-implements no fee math', () => {
    const code = stripComments(read(WALLET))
    expect(/webhooks\/stripe|lib\/commission|lib\/ledger|lib\/pricing|lib\/loyalty|lib\/promotions|createTicketPayment|computeApplicationFee|recordLedgerEntry/.test(code)).toBe(false)
  })
})
