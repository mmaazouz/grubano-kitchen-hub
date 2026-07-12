import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Wallet 1-tap (Apple/Google Pay) in /eat-next checkout — Agent 137 ──────────
// 🟠 money-adjacent (payment UI). The wallet button CONFIRMS THE SAME PaymentIntent as the card
// (same clientSecret from /pay); the wallet sheet shows the SERVER amount (payInit.amount/currency)
// and NEVER a client-computed total. It is a DEDICATED /eat-next component, so StripeTicketPayment
// (shared with /eat) stays byte-identical. canMakePayment() gates visibility; success runs the SAME
// onPaid as the card (clearCart → tracking); decline/cancel is graceful.
//
// These are source-scan assertions (the house style for this surface — see eat-next-wireframe.test):
// the Stripe browser APIs (loadStripe / PaymentRequestButtonElement) are impractical to exercise in
// node, so we assert the STRUCTURE that makes the money guarantees hold.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
// Strip comments so prose that deliberately MENTIONS amounts/routes can't trip a scan.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const WALLET = 'components/eat-next/WalletPaymentButton.tsx'
const CHECKOUT = 'app/[locale]/eat-next/checkout/page.tsx'
const TICKET = 'components/payments/StripeTicketPayment.tsx'
const EAT_CHECKOUT = 'app/[locale]/eat/checkout/[orderId]/page.tsx'

describe('(1) server amount — wallet reflects the server total, never a client calc', () => {
  const code = stripComments(read(WALLET))

  it('builds the PaymentRequest total from the server `amount` prop (display only)', () => {
    expect(/stripe\.paymentRequest\(\{/.test(code)).toBe(true)
    // total uses the prop named exactly `amount` (the SERVER cents passed in), and `label`.
    expect(/total:\s*\{\s*label,\s*amount\s*\}/.test(code)).toBe(true)
  })

  it('confirms the SAME PaymentIntent via clientSecret, attaching ONLY the wallet payment method', () => {
    // confirmCardPayment(clientSecret, { payment_method }) attaches the wallet PM; the amount is fixed
    // server-side by the PaymentIntent. Proven by the call shape: clientSecret + payment_method only.
    expect(/confirmCardPayment\(\s*clientSecret/.test(code)).toBe(true)
    expect(/payment_method:\s*ev\.paymentMethod\.id/.test(code)).toBe(true)
    expect(/handleActions:\s*false/.test(code)).toBe(true)
  })

  it('does NO client-side amount math and never imports the cart/pricing layer', () => {
    expect(/subtotal|cart-store|reduce\(|\*\s*100|\/\s*100|formatEuros|priceEur|computeApplicationFee/i.test(code)).toBe(false)
  })

  it('the checkout passes the SERVER payInit.amount to the wallet — not the client subtotal', () => {
    const co = read(CHECKOUT)
    // WalletPaymentButton receives amount={payInit.amount} (server). And no wallet/card amount is ever
    // wired from the naive client estimate subtotalEur.
    expect(/amount=\{payInit\.amount\}/.test(co)).toBe(true)
    expect(/amount=\{subtotalEur\}/.test(co)).toBe(false)
  })
})

describe('(2) availability — canMakePayment() gates the button', () => {
  const code = stripComments(read(WALLET))

  it('asks canMakePayment() and only keeps the request when a wallet is available', () => {
    expect(/canMakePayment\(\)/.test(code)).toBe(true)
    expect(/result\s*\?\s*pr\s*:\s*null/.test(code)).toBe(true)
  })

  it('renders NOTHING when no wallet is available (button masqué → card-only)', () => {
    expect(/if\s*\(\s*!paymentRequest\s*\)\s*return null/.test(code)).toBe(true)
  })
})

describe('(3) success = same path; cancel/decline is graceful', () => {
  const code = stripComments(read(WALLET))
  const co = stripComments(read(CHECKOUT))

  it('fires onPaid ONLY after a successful confirmation (never on fail)', () => {
    const idxConfirm = code.indexOf('confirmCardPayment')
    const idxFail = code.indexOf("ev.complete('fail')")
    const idxSuccess = code.indexOf("ev.complete('success')")
    const idxOnPaid = code.indexOf('onPaidRef.current()')
    expect(idxConfirm).toBeGreaterThan(-1)
    expect(idxFail).toBeGreaterThan(-1)
    expect(idxSuccess).toBeGreaterThan(-1)
    expect(idxOnPaid).toBeGreaterThan(-1)
    // fail branch is handled (and returns) before success; onPaid runs after confirm + success.
    expect(idxFail).toBeLessThan(idxSuccess)
    expect(idxConfirm).toBeLessThan(idxOnPaid)
    expect(idxSuccess).toBeLessThan(idxOnPaid)
    // the decline path returns (before the success path) without reaching onPaid
    const idxReturnAfterFail = code.indexOf('return', idxFail)
    expect(idxReturnAfterFail).toBeGreaterThan(idxFail)
    expect(idxReturnAfterFail).toBeLessThan(idxSuccess)
    // the 3-D Secure failure branch also returns BEFORE onPaid (no false success after a failed action)
    const idxNextError = code.indexOf('next.error')
    expect(idxNextError).toBeGreaterThan(idxSuccess)
    const idxReturnAfterNextError = code.indexOf('return', idxNextError)
    expect(idxReturnAfterNextError).toBeGreaterThan(idxNextError)
    expect(idxReturnAfterNextError).toBeLessThan(idxOnPaid)
  })

  it('checkout gives the wallet the SAME onPaid as the card', () => {
    // both the wallet and the card receive onPaid={onPaid}
    const occurrences = (co.match(/onPaid=\{onPaid\}/g) || []).length
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('onPaid clears the cart then navigates to the /eat-next tracking screen', () => {
    expect(/function onPaid\(\)\s*\{[\s\S]*?clearCart\(\)[\s\S]*?router\.push\(`\/eat-next\/track\//.test(co)).toBe(true)
  })
})

describe('(4) /eat byte-identical — shared StripeTicketPayment untouched, wallet is /eat-next only', () => {
  it('StripeTicketPayment was NOT modified to add a wallet (no PaymentRequest / WalletPaymentButton)', () => {
    const ticket = read(TICKET)
    expect(/PaymentRequestButton|paymentRequest\(|WalletPaymentButton/.test(ticket)).toBe(false)
  })

  it('the /eat consumer checkout does NOT import the EAT-NEXT wallet (it lives only in /eat-next)', () => {
    // Agent 139 added a SEPARATE dedicated /eat wallet (@/components/eat/WalletPaymentButton) to the live
    // /eat checkout — that is allowed. What must stay true is that the EAT-NEXT component never leaks into
    // /eat (each surface mounts its own; StripeTicketPayment stays shared + byte-identical).
    const eat = read(EAT_CHECKOUT)
    expect(/eat-next\/WalletPaymentButton/.test(eat)).toBe(false)
  })
})

describe('(5) isolation — the wallet component never touches the money engine', () => {
  const code = stripComments(read(WALLET))
  it('imports no money lib / webhook and re-implements no fee math', () => {
    expect(/webhooks\/stripe|lib\/commission|lib\/ledger|lib\/pricing|lib\/loyalty|lib\/promotions|createTicketPayment|computeApplicationFee|recordLedgerEntry/.test(code)).toBe(false)
  })
})
