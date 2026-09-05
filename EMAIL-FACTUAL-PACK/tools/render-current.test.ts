// EMAIL FACTUAL PACK — deterministic render harness (READ-ONLY on the product).
// Mocks the SMTP transport + the DB, calls every reachable sender with FIXED fixtures,
// and writes the captured {from,to,subject,html,text} to EMAIL-FACTUAL-PACK/current-renders/.
// Nothing is sent. No real address is used (all recipients are *.example.invalid).
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import IntlMessageFormat from 'intl-messageformat'

const OUT = 'EMAIL-FACTUAL-PACK/current-renders'
mkdirSync(OUT, { recursive: true })

// ── captured sends ────────────────────────────────────────────────────────────
type Captured = { from?: string; to: string; subject: string; html?: string; text?: string }
const { sent, db, session, otp, magic, verif, emailChange, llm, scope } = vi.hoisted(() => {
  const sent: Array<Record<string, unknown>> = []
  // permissive DB proxy: every model.method resolves to a configurable value
  const handlers: Record<string, (args: unknown) => unknown> = {}
  const model = (name: string) => new Proxy({}, {
    get: (_t, method: string) => async (args: unknown) => {
      const h = handlers[`${name}.${method}`]
      return h ? h(args) : {}
    },
  })
  const db = new Proxy({ __handlers: handlers }, {
    get: (t, name: string) => (name === '__handlers' ? handlers : model(name)),
  }) as Record<string, Record<string, (a: unknown) => Promise<unknown>>> & { __handlers: typeof handlers }
  return {
    sent, db,
    session: { fn: async () => ({ user: { id: 'op_fixture01', email: 'lea.martin@example.invalid' } }) },
    otp: { code: '424242' },
    magic: {},
    verif: {},
    emailChange: {},
    llm: {},
    scope: {},
  }
})
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: async (m: Captured) => { sent.push({ ...m }) } }) } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: () => session.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/i18n', () => ({ locales: ['fr', 'en', 'es', 'it', 'ar'], defaultLocale: 'fr', rtlLocales: ['ar'] }))
vi.mock('@/lib/email-otp', () => ({
  issueEmailOtp: async () => ({ ok: true, code: otp.code }),
  verifyEmailOtp: async () => true,
  isEmailOtpEnabled: () => process.env.AUTH_EMAIL_OTP_ENABLED === 'true',
  isMoneyStepUpEnabled: () => true,
}))
vi.mock('@/lib/magic-link', () => ({
  createMagicLinkToken: () => ({ token: 'op_fixture01.0123456789abcdef0123456789abcdef', hash: 'h', expiry: new Date('2026-09-12T17:45:00Z') }),
}))
vi.mock('@/lib/partner-verification', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createVerificationToken: () => ({ token: 'op_fixture02.fedcba9876543210fedcba9876543210', hash: 'h', expiry: new Date('2026-09-13T17:30:00Z') }),
}))
vi.mock('@/lib/email-change', () => ({
  isEmailChangeEnabled: () => true,
  checkEmailChangeEligibility: async () => ({ ok: true, email: 'lea.martin@example.invalid' }),
}))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: async () => ({ ok: true, ownedIds: ['resto_fixture01'] }) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: async () => {}, CRON_ACTOR_ID: 'cron' }))
vi.mock('dns', () => ({ promises: { resolveMx: async () => [{ exchange: 'mx.example.invalid', priority: 10 }], resolve: async () => ['192.0.2.1'] } }))

// real message catalogs through intl-messageformat (ICU plural supported)
const MSG: Record<string, Record<string, unknown>> = {}
for (const l of ['fr', 'en', 'es', 'it', 'ar']) MSG[l] = JSON.parse(readFileSync(`messages/${l}.json`, 'utf8'))
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    (key: string, vars?: Record<string, unknown>) => {
      const path = `${namespace}.${key}`.split('.')
      let cur: unknown = MSG[locale] ?? MSG.fr
      for (const p of path) cur = (cur as Record<string, unknown>)?.[p]
      if (typeof cur !== 'string') throw new Error(`missing i18n key ${locale}:${namespace}.${key}`)
      return new IntlMessageFormat(cur, locale).format(vars as never) as string
    },
}))

// ── fixtures ──────────────────────────────────────────────────────────────────
const DATE   = new Date('2026-09-12T17:30:00Z') // 19:30 Europe/Paris
const ORDER  = { id: 'clx0fixtureabc123', consumerId: 'op_fixture01' } // orderRef → GR-ABC123
const CLAIM  = 'clm_fixture0001'
const RESV   = 'rsv_fixture0001'
const CONSUMER = { to: 'lea.martin@example.invalid', name: 'Léa Martin' }
const OWNER    = 'gnocchi.bar@example.invalid'
const RESTO    = 'Gnocchi Bar'
const ITEMS    = [{ name: 'Gnocchi 4 fromages', qty: 2 }, { name: 'Tiramisu maison', qty: 1 }]
let consumerLocale: string | null = null

function take(id: string, extra: Record<string, unknown> = {}) {
  const m = sent.pop() as Captured | undefined
  expect(m, `no send captured for ${id}`).toBeTruthy()
  const html = m!.html ?? ''
  writeFileSync(join(OUT, `${id}.html`), html)
  if (m!.text) writeFileSync(join(OUT, `${id}.txt`), m!.text)
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify({
    id, from: m!.from ?? '(rail FROM)', to: m!.to, subject: m!.subject,
    hasText: !!m!.text, hasImages: /<img\b/i.test(html), hasTable: /<table\b/i.test(html),
    ...extra,
  }, null, 2))
  return m!
}

beforeAll(() => {
  process.env.SMTP_PASS      = 'fixture'
  process.env.SMTP_HOST      = 'mail.grubano.com'
  process.env.NEXTAUTH_URL   = 'https://app.grubano.com'
  process.env.ALERT_EMAIL    = 'admin-alerts@example.invalid'
  process.env.INTERNAL_CRON_TOKEN = 'cron-fixture'
  delete process.env.RATE_LIMIT_ENABLED
  const h = db.__handlers
  h['operator.findUnique'] = () => ({ id: 'op_fixture01', email: CONSUMER.to, name: CONSUMER.name, locale: consumerLocale, status: 'active', role: 'consumer' })
  h['operator.create']     = () => ({ id: 'op_fixture02', email: 'marco@example.invalid', role: 'consumer' })
  h['emailDispatch.create'] = () => ({ id: 'd' })
  h['emailLog.create']     = () => ({ id: 'l' })
  h['supplier.findUnique'] = () => ({ id: 'sup_fixture01', name: 'Primeurs de Lyon', email: 'commandes@primeurs.example.invalid', leadTime: '48 h' })
  h['supplierOrder.create'] = () => ({ id: 'so_fixture0001' })
})

// ── A. lib/transactional-emails ───────────────────────────────────────────────
describe('render — transactional-emails', () => {
  it('order lifecycle', async () => {
    const T = await import('@/lib/transactional-emails')
    await T.sendOrderConfirmation({ ...CONSUMER, customerName: CONSUMER.name, restaurantName: RESTO, orderRef: 'GR-ABC123', fulfillmentType: 'pickup', items: ITEMS, paidCents: 2550, dedupeKey: 'order:x' })
    take('CONSUMER_ORDER_CONFIRMATION_PICKUP')
    await T.sendOrderConfirmation({ ...CONSUMER, customerName: CONSUMER.name, restaurantName: RESTO, orderRef: 'GR-ABC123', fulfillmentType: 'delivery', items: ITEMS, paidCents: 2850, dedupeKey: 'order:x' })
    take('CONSUMER_ORDER_CONFIRMATION_DELIVERY')
    const base = { orderId: ORDER.id, to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, orderRef: 'GR-ABC123' }
    await T.sendOrderStatusEmail({ ...base, status: 'preparing', fulfillmentType: 'pickup' }); take('CONSUMER_ORDER_ACCEPTED')
    await T.sendOrderStatusEmail({ ...base, status: 'ready', fulfillmentType: 'pickup' }); take('CONSUMER_ORDER_READY_PICKUP')
    await T.sendOrderStatusEmail({ ...base, status: 'ready', fulfillmentType: 'delivery' }); take('CONSUMER_ORDER_READY_DELIVERY')
    await T.sendOrderStatusEmail({ ...base, status: 'picked_up', fulfillmentType: 'delivery' }); take('CONSUMER_ORDER_ENROUTE')
    await T.sendOrderStatusEmail({ ...base, status: 'delivered', fulfillmentType: 'pickup' }); take('CONSUMER_ORDER_COMPLETED_PICKUP')
    await T.sendOrderStatusEmail({ ...base, status: 'delivered', fulfillmentType: 'delivery' }); take('CONSUMER_ORDER_DELIVERED')
    await T.sendOrderStatusEmail({ ...base, status: 'cancelled', fulfillmentType: 'pickup' }); take('CONSUMER_ORDER_CANCELLED_GENERIC')
    await T.sendRestaurantNewOrderEmail({ orderId: ORDER.id, to: OWNER, restaurantName: RESTO, orderRef: 'GR-ABC123', fulfillmentType: 'pickup', items: ITEMS, totalCents: 2550 })
    take('PARTNER_NEW_ORDER')
  })
  it('reservations', async () => {
    const T = await import('@/lib/transactional-emails')
    await T.sendReservationConfirmation({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, date: DATE, guests: 4, code: '#K7Q2', depositEur: 0, dedupeKey: 'r' }); take('CONSUMER_RESERVATION_CONFIRMED')
    await T.sendReservationConfirmation({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, date: DATE, guests: 4, code: '#K7Q2', depositEur: 40, dedupeKey: 'r' }); take('CONSUMER_RESERVATION_CONFIRMED_DEPOSIT')
    await T.sendRestaurantNewReservationEmail({ reservationId: RESV, to: OWNER, restaurantName: RESTO, customerName: 'Léa M.', date: DATE, guests: 4, code: '#K7Q2' }); take('PARTNER_NEW_RESERVATION')
    await T.sendReservationCancelledByClientToClient({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, date: DATE }); take('CONSUMER_RESERVATION_CANCELLED_BY_CLIENT')
    await T.sendReservationCancelledByClientToOwner({ to: OWNER, customerName: 'Léa M.', restaurantName: RESTO, date: DATE, guests: 4 }); take('PARTNER_RESERVATION_CANCELLED_BY_CLIENT')
    await T.sendReservationCancelledByOwner({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, date: DATE, closureReason: null }); take('CONSUMER_RESERVATION_CANCELLED_BY_OWNER')
    await T.sendReservationCancelledByClosure({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, date: DATE, closureReason: 'Travaux en cuisine' }); take('CONSUMER_RESERVATION_CANCELLED_BY_CLOSURE')
    await T.sendNoShowPenaltyCharged({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, capturedCents: 4000, date: DATE }); take('CONSUMER_NOSHOW_PENALTY_CHARGED')
  })
  it('refund / password / partner / admin / courier / email-change / creator', async () => {
    const T = await import('@/lib/transactional-emails')
    await T.sendRefundConfirmation({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, refundedCents: 2550, partial: false }); take('REFUND_SUCCEEDED_FULL')
    await T.sendRefundConfirmation({ to: CONSUMER.to, customerName: CONSUMER.name, restaurantName: RESTO, refundedCents: 500, partial: true }); take('REFUND_SUCCEEDED_PARTIAL')
    await T.sendPasswordResetEmail({ to: CONSUMER.to, name: CONSUMER.name, resetUrl: 'https://app.grubano.com/fr/eat/reset-password?token=0123456789abcdef&email=lea.martin%40example.invalid&space=eat' }); take('AUTH_PASSWORD_RESET')
    await T.sendPasswordChangedEmail({ to: CONSUMER.to, name: CONSUMER.name }); take('AUTH_PASSWORD_CHANGED')
    await T.sendPartnerStatusEmail({ role: 'restaurant', status: 'validated', to: OWNER, partnerName: 'Marco Rossi', dedupeScope: 'resto:x' }); take('PARTNER_ACCOUNT_VALIDATED')
    await T.sendPartnerStatusEmail({ role: 'supplier', status: 'rejected', to: OWNER, partnerName: 'Primeurs de Lyon', dedupeScope: 'supplier:x', reason: 'SIREN non vérifiable', occurrence: '2026-09-12' }); take('PARTNER_ACCOUNT_REJECTED')
    await T.sendPartnerStatusEmail({ role: 'influencer', status: 'docs_needed', to: OWNER, partnerName: 'Camille', dedupeScope: 'affiliate:x', reason: 'Justificatif d’audience manquant', occurrence: '2026-09-12' }); take('PARTNER_DOCS_NEEDED_UNWIRED')
    await T.sendAdminNewPartnerEmail({ role: 'restaurant', partnerName: 'Marco Pizzeria', dedupeScope: 'restaurant:x' }); take('ADMIN_PARTNER_PENDING')
    await T.sendCourierWaitlistConfirmation({ to: 'sami.courier@example.invalid', contactName: 'Sami', dedupeKey: 'logistics:x' }); take('COURIER_WAITLIST_CONFIRMATION')
    await T.sendEmailChangeLink({ to: 'lea.new@example.invalid', link: 'https://app.grubano.com/eat/account/email/confirm?token=op_fixture01.0123456789abcdef', dedupeKey: 'k' }); take('ACCOUNT_EMAIL_CHANGE_LINK')
    await T.sendEmailChangedAlert({ to: CONSUMER.to, newEmailMasked: 'l***@e***', dedupeKey: 'k' }); take('ACCOUNT_EMAIL_CHANGED_ALERT')
    await T.sendEmailChangeConfirm({ to: 'lea.new@example.invalid', dedupeKey: 'k' }); take('ACCOUNT_EMAIL_CHANGE_CONFIRM')
    await T.sendEmailAlreadyUsedNotice({ to: 'lea.new@example.invalid' }); take('ACCOUNT_EMAIL_ALREADY_USED')
    await T.sendDishAdoptedToCreator({ to: 'chef@example.invalid', creatorName: 'Chef Nadia', restaurantName: RESTO, city: 'Lyon', dishName: 'Gnocchi au pesto rosso', priceEur: 13.5, royaltyPct: 0.02 }); take('CREATOR_DISH_ADOPTED')
    await T.sendWaitlistOfferToRestaurant({ to: OWNER, restaurantName: RESTO, dishName: 'Gnocchi au pesto rosso', city: 'Lyon', hours: 48 }); take('PARTNER_WAITLIST_OFFER')
  })
})

// ── B. lib/claim-emails (localized) ───────────────────────────────────────────
describe('render — claim-emails', () => {
  it('fr + locale variants', async () => {
    const C = await import('@/lib/claim-emails')
    consumerLocale = null
    await C.sendClaimAckEmail({ claimId: CLAIM, consumerId: ORDER.consumerId, orderId: ORDER.id, requestedAmountCents: 1250 }); take('CLAIM_RECEIVED')
    for (const d of ['accepted', 'refused', 'refunded', 'approved', 'refused_final'] as const) {
      await C.sendClaimDecisionEmail({ claimId: CLAIM, consumerId: ORDER.consumerId, orderId: ORDER.id, decision: d, reason: d === 'refused' ? 'Photo non concluante' : null, restaurantName: d.startsWith('ref') || d === 'accepted' ? RESTO : null, refundedCents: d === 'refunded' ? 1250 : null })
      take(`CLAIM_DECISION_${d.toUpperCase()}`)
    }
    await C.sendOrderCancelledPaidEmail({ orderId: ORDER.id, consumerId: ORDER.consumerId, restaurantName: RESTO }); take('CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON')
    await C.sendOrderCancelledPaidEmail({ orderId: ORDER.id, consumerId: ORDER.consumerId, restaurantName: RESTO, existingClaim: true }); take('CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON_EXISTING')
    await C.sendOrderCancelledPaidOffEmail({ orderId: ORDER.id, consumerId: ORDER.consumerId, restaurantName: RESTO }); take('CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF')
    consumerLocale = 'ar'
    await C.sendClaimAckEmail({ claimId: CLAIM, consumerId: ORDER.consumerId, orderId: ORDER.id, requestedAmountCents: 1250 }); take('CLAIM_RECEIVED__ar')
    consumerLocale = 'en'
    await C.sendClaimDecisionEmail({ claimId: CLAIM, consumerId: ORDER.consumerId, orderId: ORDER.id, decision: 'refunded', refundedCents: 1250 }); take('CLAIM_DECISION_REFUNDED__en')
    consumerLocale = null
  })
})

// ── C. lib/admin-alerts ───────────────────────────────────────────────────────
describe('render — admin-alerts', () => {
  it('all kinds', async () => {
    const A = await import('@/lib/admin-alerts')
    await A.sendAdminGhostOrderAlert({ orderId: ORDER.id, paymentIntentId: 'pi_3FIXTURE0000000001', amountCents: 2550, refundsOn: false }); take('ADMIN_GHOST_ORDER')
    await A.sendAdminStalePiAlert({ kind: 'order', entityId: ORDER.id, paymentIntentId: 'pi_3FIXTURE0000000002', currentPiId: 'pi_3FIXTURE0000000003', amountCents: 2550 }); take('ADMIN_STALE_PI')
    await A.sendAdminPaidCancellationAlert({ orderId: ORDER.id, paymentIntentId: 'pi_3FIXTURE0000000001', amountCents: 2550, restaurantName: RESTO }); take('ADMIN_PAID_CANCELLATION')
    await A.sendAdminStaleClaimAlert({ claimId: CLAIM, orderId: ORDER.id, requestedAmountCents: 1250, ageHours: 31.5 }); take('ADMIN_STALE_CLAIM')
    await A.sendAdminReconcileDigest({ count: 2, sampleOrderIds: [ORDER.id, 'clx0fixturedef456'], dayKey: '2026-09-12' }); take('ADMIN_RECONCILE_DIGEST')
    await A.sendAdminMoneyReviewAlert({ kind: 'refund_failed', dedupeKey: 'refund:re_FIXTURE01', title: 'Remboursement Stripe en échec — commande verrouillée', facts: { orderId: ORDER.id, stripeRefundId: 're_FIXTURE01', amountCents: 500, stripeStatus: 'failed', failureReason: 'expired_or_canceled_card', action: 'humain : re-transférer le net au restaurant puis rembourser sans reverse_transfer' } }); take('ADMIN_MONEY_REVIEW')
  })
})

// ── D. inline-transport routes ────────────────────────────────────────────────
describe('render — inline routes', () => {
  it('magic link (with and without OTP code)', async () => {
    const { POST } = await import('@/app/api/auth/magic-link/route')
    const req = (body: unknown) => new Request('https://app.grubano.com/api/auth/magic-link', { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.grubano.com' }, body: JSON.stringify(body) })
    delete process.env.AUTH_EMAIL_OTP_ENABLED
    await POST(req({ email: CONSUMER.to, locale: 'fr', space: 'eat' }) as never); take('AUTH_MAGIC_LINK')
    process.env.AUTH_EMAIL_OTP_ENABLED = 'true'
    await POST(req({ email: CONSUMER.to, locale: 'fr', space: 'eat' }) as never); take('AUTH_MAGIC_LINK_WITH_OTP')
    delete process.env.AUTH_EMAIL_OTP_ENABLED
  })
  it('consumer welcome', async () => {
    db.__handlers['operator.findUnique'] = () => null
    const { POST } = await import('@/app/api/auth/register/route')
    await POST(new Request('https://app.grubano.com/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Léa Martin', email: CONSUMER.to, password: 'Fixture-Passw0rd!' }) }) as never)
    take('CONSUMER_WELCOME')
    db.__handlers['operator.findUnique'] = () => ({ id: 'op_fixture01', email: CONSUMER.to, name: CONSUMER.name, locale: consumerLocale, status: 'active', role: 'consumer' })
  })
  it('step-up code + email-change code', async () => {
    process.env.AUTH_MONEY_STEPUP_ENABLED = 'true'
    const { POST } = await import('@/app/api/auth/step-up/request/route')
    await POST(new Request('https://app.grubano.com/api/auth/step-up/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose: 'stepup:withdraw' }) }))
    take('AUTH_STEPUP_CODE')
    process.env.AUTH_EMAIL_CHANGE_ENABLED = 'true'
    const rc = await import('@/app/api/account/email-change/request-code/route')
    await rc.POST(); take('ACCOUNT_EMAIL_CHANGE_CODE')
  })
  it('partner verify (+ admin pending alert through the rail)', async () => {
    db.__handlers['operator.findUnique'] = () => null
    const { POST } = await import('@/app/api/partners/register/route')
    const res = await POST(new Request('http://business.grubano.com/api/partners/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-host': 'business.grubano.com', 'x-forwarded-for': '10.9.0.7' }, body: JSON.stringify({ name: 'Marco Pizzeria', email: 'marco@example.invalid', consent: true, formStartedAt: 0 }) }) as never)
    expect(res.status).toBe(200)
    take('ADMIN_PARTNER_PENDING__from_route')
    take('PARTNER_EMAIL_VERIFY')
    db.__handlers['operator.findUnique'] = () => ({ id: 'op_fixture01', email: CONSUMER.to, name: CONSUMER.name, locale: consumerLocale, status: 'active', role: 'consumer' })
  })
  it('supplier purchase order', async () => {
    const { POST } = await import('@/app/api/suppliers/orders/route')
    await POST(new Request('https://app.grubano.com/api/suppliers/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supplierId: 'sup_fixture01', items: [{ name: 'Tomates San Marzano', quantity: 12, unit: 'kg', price: 3.2 }, { name: 'Basilic frais', quantity: 2, unit: 'bottes', price: 1.5 }], total: 41.4 }) }))
    take('OPERATOR_SUPPLIER_PURCHASE_ORDER')
  })
  it('onboarding nudge (restaurant + generic)', async () => {
    process.env.ONBOARDING_NUDGE_ENABLED = 'true'
    const DAY = 86400000
    const h = db.__handlers
    const op = { id: 'op_fixture01', email: OWNER, name: 'Marco', locale: 'fr', createdAt: new Date(Date.now() - 2 * DAY), status: 'active', emailVerifiedAt: new Date(), affiliatePayoutStatus: null, registeredAddress: null, taxId: null, taxIdCountry: null, sellerType: null, dateOfBirth: null }
    h['operator.findMany'] = (a: unknown) => {
      const w = (a as { where: { role?: string; id?: { in: string[] } } }).where
      if (w?.role === 'restaurant') return [op]
      if (w?.id) return [op]
      return []
    }
    h['brand.findFirst'] = () => null; h['brand.count'] = () => 0; h['restaurant.findFirst'] = () => null; h['menuItem.count'] = () => 0
    h['onboardingNudge.findMany'] = () => []; h['onboardingNudge.create'] = () => ({ id: 'n' })
    h['affiliate.findMany'] = () => [{ operatorId: 'op_fixture01', createdAt: new Date(Date.now() - 2 * DAY), status: 'pending' }]
    h['creator.findMany'] = () => []; h['supplierProfile.findMany'] = () => []; h['prestataireProfile.findMany'] = () => []
    const { POST } = await import('@/app/api/admin/onboarding-nudges/run/route')
    const res = await POST(new Request('http://x/api/admin/onboarding-nudges/run', { method: 'POST', headers: { 'x-internal-token': 'cron-fixture' } }))
    expect((await res.json()).sent).toBe(2)
    take('ONBOARDING_NUDGE_GENERIC')
    take('ONBOARDING_NUDGE_RESTAURANT')
  })
  it('no stray sends', () => { expect(sent.length).toBe(0) })
})
