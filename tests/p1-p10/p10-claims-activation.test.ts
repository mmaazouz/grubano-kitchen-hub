import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P10 — CLAIMS : photographie de l'ACTIVATION (Sprint 0, characterization) ────────
//
// Audit verdict: "claims = crash à l'activation". Reality check performed while
// writing this file (the tests encode the CODE, not the verdict blindly):
//
//  • Flag OFF (production default): POST /api/claims → 403 { gated:true } BEFORE any
//    auth/DB access. NOTE — the audit brief mentioned a "404" gate; the actual code
//    gate is 403 (POST) / { enabled:false } (GET). Encoded as-is.
//  • Flag ON, at ROUTE level with leaf deps mocked (prisma/refund/dish-photo), the
//    nominal POST flow WORKS: 201, claim created. So the route logic itself does NOT
//    crash on activation. D′ L2 (spec v2 S-13): the C2 auto-resolution the route still
//    consults is INERT BY CONSTRUCTION — whatever CLAIM_AUTO_RESOLVE_ENABLED /
//    CLAIM_AUTO_APPROVE_MAX_CENTS say, no small claim is ever machine-approved, nothing
//    is read (not even the anti-abuse count) and no decision e-mail leaves this route.
//  • The REAL crash surface: lib/claims re-throws every non-P2002 DB error
//    (lib/claims.ts createClaim `throw err`) and app/api/claims/route.ts has NO
//    try/catch — so flipping CLAIMS_ENABLED=true WITHOUT having pushed the Claim
//    table (prisma db push) makes the FIRST request throw P2021 out of the handler
//    (raw Next 500). That unhandled-throw behaviour is characterized below as
//    FAIL-ATTENDU — the most plausible source of the "crash à l'activation" observed
//    on staging (the alternative being a UI-level crash → NON-TESTABLE todos).
//
// Angle: activation photograph of the consumer POST /api/claims (+ GET eligibility).
// tests/claims.test.ts (lib workflow) and tests/claims-routes.test.ts (routes with
// lib/claims fully mocked) are NOT duplicated: here lib/claims stays REAL so the
// env-driven gate and the error propagation are the genuine ones — only LEAF deps
// are mocked (prisma, refund engine, photo chain, next-auth/jwt).
//
// Statuses (encoded in each test title):
//  [PASS-ACTUEL]   current behaviour is the wanted behaviour.
//  [FAIL-ATTENDU]  test asserts the CURRENT (broken) behaviour so it is GREEN today;
//                  after the post-arbitrage fix the assertion must be INVERTED.
//  [NON-TESTABLE]  Stripe-keyed (skipIf) or browser/staging-only (todo).

// ── Leaf mocks — lib/claims stays REAL (genuine gate + genuine error propagation) ──
const { db } = vi.hoisted(() => ({
  db: {
    order: { findUnique: vi.fn() },
    claim: {
      create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(), count: vi.fn(),
    },
    // Claims batch 1: the claim amount is now DERIVED server-side, which reads the order's
    // succeeded refunds to compute the remaining ceiling.
    refund: { aggregate: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

const { photoMock } = vi.hoisted(() => ({ photoMock: vi.fn() }))
vi.mock('@/lib/dish-photo', () => ({
  processDishImage: photoMock,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
}))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

import { POST as CREATE, GET as LIST } from '@/app/api/claims/route'
import { isConsumerAbuseFlagged } from '@/lib/claims'

const req = (body?: unknown, url = 'https://app.grubano.com/api/claims') =>
  ({ url, json: async () => body ?? {} }) as never

// D′ L6 (spec v2 §7.1 E3/E4/E5) — LIVRÉE SEULEMENT, ancre `deliveredAt`. La photographie de
// l'activation porte sur une réclamation d'une commande RÉELLEMENT LIVRÉE : sans `status:'delivered'`
// ni ancre fraîche, chaque POST ci-dessous s'arrête à E3 (not_delivered) et le cliché serait celui du
// refus, pas celui du chemin d'activation. Le drapeau n'est pas décoratif — le bloc D′ L6
// ci-dessous échoue s'il disparaît, ou si la fenêtre est datée depuis `updatedAt`.
const paidOrder = (o: Record<string, unknown> = {}) => ({
  id: 'o1', consumerId: 'c1', restaurantId: 'r1', paymentStatus: 'paid', status: 'delivered', total: 50,
  deliveredAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ...o,
})

// Stripe TEST keys are absent in CI — presence check ONLY, the value is never read.
const hasStripe = !!process.env.STRIPE_SECRET_KEY

beforeEach(() => {
  vi.clearAllMocks()
  tokenMock.mockResolvedValue({ sub: 'c1' })
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.order.findUnique.mockResolvedValue(paidOrder())
  db.claim.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cl1', ...data }))
  db.claim.findUnique.mockResolvedValue(null)
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.findMany.mockResolvedValue([])
  db.claim.update.mockResolvedValue({})
  db.claim.updateMany.mockResolvedValue({ count: 1 })
  db.claim.count.mockResolvedValue(0)
  photoMock.mockResolvedValue({ ok: true, url: 'https://cdn/x.jpg', warnings: [] })
  // Production reality today: REFUNDS_ENABLED is OFF → an approved claim rests at
  // 'approved'/refund PENDING. The engine itself is P5's territory, not P10's.
  refundsFlag.mockReturnValue(false)
  execMock.mockResolvedValue({ ok: true, refundId: 'rf1' })
})
afterEach(() => { vi.unstubAllEnvs() })

// ════════════════════════════════════════════════════════════════════════════════════
describe('P10 — flag OFF (défaut production) : le gate', () => {
  it("[PASS-ACTUEL] POST /api/claims flag OFF → 403 { gated:true }, sans consulter ni l'auth ni la DB (écart audit : 403, pas 404)", async () => {
    vi.stubEnv('CLAIMS_ENABLED', '')
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    // Gate first: neither the session nor the DB is ever touched when OFF.
    expect(tokenMock).not.toHaveBeenCalled()
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
describe('P10 — activation (CLAIMS_ENABLED=true) : la route tient, contrairement au verdict brut', () => {
  beforeEach(() => { vi.stubEnv('CLAIMS_ENABLED', 'true'); vi.stubEnv('CLAIMS_WINDOW_UNTIL', new Date(Date.now() + 15 * 60 * 1000).toISOString()) })

  it('[PASS-ACTUEL] flag ON sans session → 401 (le canal devient réel mais reste derrière auth)', async () => {
    tokenMock.mockResolvedValue(null)
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' }))
    expect(res.status).toBe(401)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] flag ON, body invalide (motif inconnu) → 400 zod, aucun accès DB', async () => {
    const res = await CREATE(req({ orderId: 'o1', reason: 'nonsense' }))
    expect(res.status).toBe(400)
    expect(db.order.findUnique).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] flag ON, commande payée du client dans la fenêtre → 201, claim restaurant_review créée (PAS de crash au niveau route)', async () => {
    // Deviation from the raw audit verdict, encoded honestly: with the DB reachable
    // (mocked here) the activation path completes. The observed staging crash was
    // therefore NOT in the route logic — see the FAIL-ATTENDU block below.
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' }))
    expect(res.status).toBe(201)
    const data = db.claim.create.mock.calls[0][0].data
    // total 50 € → whole-order default 5000 cents, above the 1000-cent C2 ceiling
    // → auto-resolution is a NO-OP (exact C1 flow, no claim.count / updateMany).
    expect(data).toMatchObject({
      orderId: 'o1', consumerId: 'c1', restaurantId: 'r1', reason: 'quality',
      requestedAmountCents: 5000, status: 'restaurant_review', activeOrderKey: 'o1',
    })
    expect((await res.json()).claim).toMatchObject({ id: 'cl1', status: 'restaurant_review' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it("[PASS-ACTUEL D′ L2] petite réclamation (5 €) SANS config auto-résolution → PLUS d'auto_small : la réclamation reste en revue restaurant (inerte par construction — plus rien à tracer, plus rien n'est lu)", async () => {
    // Ré-photographié en vague 1 (P0-27) : l'ancien défaut permissif (plafond 1000
    // implicite → auto-remboursement ACTIF sans config) était supprimé par un verrou de
    // config TRACÉ. D′ L2 va plus loin : la config n'est plus consultée du tout —
    // autoResolveSmallClaim rend not_eligible par construction. Stub '' DÉTERMINISTE (revue) :
    // le test ne doit pas dépendre de l'absence AMBIANTE des variables en CI.
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', '')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 5 })) // 500 cents — sous l'ANCIEN plafond
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' })) // batch 2: ITEM_REQUIRED reasons need a selection; this case is about the ceiling
    expect(res.status).toBe(201)
    // AUCUNE approbation machine : aucun updateMany du tout, moteur jamais appelé, anti-abus jamais lu.
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(db.claim.count).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(refundsFlag).not.toHaveBeenCalled()
    // Plus de verrou de config à tracer : le refus n'est plus une décision de config (inversion du pin P0-27).
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('CLAIM_AUTO_RESOLVE_ENABLED'))
    expect((await res.json()).claim).toMatchObject({ status: 'restaurant_review' })
    warnSpy.mockRestore()
  })

  it("[PASS-ACTUEL D′ L2] config post-pilote EXPLICITE (flag + plafond) → l'auto_small ne refonctionne PAS : aucune approbation machine, aucune écriture, jamais le moteur (S-13)", async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 8 })) // 800 cents ≤ 1000 ceiling — the OLD trigger condition
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' })) // batch 2: ITEM_REQUIRED reasons need a selection; this case is about the ceiling
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
    expect(db.claim.create.mock.calls[0][0].data).toMatchObject({ requestedAmountCents: 800, status: 'restaurant_review' })
    // No C2 post-create: no restaurant_review → approved, no decidedBy 'auto_small', no read of anything.
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(db.claim.update).not.toHaveBeenCalled()
    expect(db.claim.count).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(refundsFlag).not.toHaveBeenCalled()
    expect((await res.json()).claim).toMatchObject({ status: 'restaurant_review' })
  })

  it('[PASS-ACTUEL] GET /api/claims?orderId flag ON → { enabled:true, eligibility.canClaim:true } (lib réelle, bouton client alimenté)', async () => {
    const res = await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      enabled: true,
      eligibility: { canClaim: true, maxRefundableCents: 5000, windowHours: 48, existingClaim: null },
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
// D′ L6 (spec v2 §7.1 E3/E4) — CONTRÔLES NÉGATIFS de l'ancre de livraison, côté GET.
// Ils tiennent ici parce que ce fichier interroge la lib RÉELLE : seul le GET rend le CODE de refus
// (le POST ne rend qu'un statut + une phrase). Ils prouvent aussi que le drapeau `delivered` du
// fixture ci-dessus porte quelque chose : sans lui, ces trois cas ne pourraient pas échouer.
describe("P10 — D′ L6 : l'ancre de livraison décide, jamais updatedAt", () => {
  beforeEach(() => { vi.stubEnv('CLAIMS_ENABLED', 'true'); vi.stubEnv('CLAIMS_WINDOW_UNTIL', new Date(Date.now() + 15 * 60 * 1000).toISOString()) })

  it("[PASS-ACTUEL D′ L6] commande NON livrée → canClaim:false, reason:'not_delivered' (E3 : rien n'est arrivé à juger ; une annulation payée relève de la réclamation SYSTÈME)", async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ status: 'preparing', deliveredAt: null }))
    const body = await (await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))).json()
    expect(body).toMatchObject({ enabled: true, eligibility: { canClaim: false, reason: 'not_delivered' } })
  })

  it("[PASS-ACTUEL D′ L6] livrée SANS ancre (deliveredAt null) → canClaim:false, reason:'window_expired' : aucun repli sur createdAt ni updatedAt, le support prend la main (D-1)", async () => {
    db.order.findUnique.mockResolvedValue(paidOrder({ status: 'delivered', deliveredAt: null }))
    const body = await (await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))).json()
    expect(body.eligibility).toMatchObject({ canClaim: false, reason: 'window_expired' })
  })

  it("[PASS-ACTUEL D′ L6] updatedAt remis à MAINTENANT sur une commande livrée il y a 3 jours → toujours window_expired ; la même commande avec une ancre fraîche → canClaim:true", async () => {
    const troisJours = new Date(Date.now() - 72 * 3600 * 1000)
    db.order.findUnique.mockResolvedValue(paidOrder({ deliveredAt: troisJours, createdAt: troisJours, updatedAt: new Date() }))
    const perime = await (await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))).json()
    expect(perime.eligibility).toMatchObject({ canClaim: false, reason: 'window_expired' })
    // Même ligne, même updatedAt ancien : seule l'ancre bouge → le refus ci-dessus est bien son âge.
    db.order.findUnique.mockResolvedValue(paidOrder({ deliveredAt: new Date(Date.now() - 3600 * 1000), createdAt: troisJours, updatedAt: troisJours }))
    const frais = await (await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))).json()
    expect(frais.eligibility).toMatchObject({ canClaim: true, maxRefundableCents: 5000 })
    expect(frais.eligibility.reason).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
describe("P10 — activation : le crash (aucune frontière d'erreur dans la route)", () => {
  beforeEach(() => { vi.stubEnv('CLAIMS_ENABLED', 'true'); vi.stubEnv('CLAIMS_WINDOW_UNTIL', new Date(Date.now() + 15 * 60 * 1000).toISOString()) })

  it('[FAIL-ATTENDU: activation sans migration → crash 500 brut] table Claim absente (P2021) → le handler POST REJETTE au lieu de répondre un JSON propre', async () => {
    // AUDIT: the most plausible "crash à l'activation": CLAIMS_ENABLED flipped ON
    // without `prisma db push` → the first POST hits a missing Claim table. lib/claims
    // re-throws every non-P2002 error and the route has NO try/catch, so the handler
    // itself rejects → raw Next 500 for the consumer. After the post-arbitrage fix
    // (error boundary in the route), INVERT: expect a clean JSON 500/503 Response
    // instead of a rejected promise.
    db.claim.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('table `Claim` does not exist', { code: 'P2021', clientVersion: 'x' }),
    )
    await expect(CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' }))).rejects.toHaveProperty('code', 'P2021')
  })

  it("[PASS-ACTUEL P0-27] défaut fail-safe : l'anti-abus n'est PLUS ATTEINT (gate flag AVANT) → une erreur DB dans claim.count ne crashe plus le handler, 201 propre", async () => {
    // Ré-photographié en vague 1 (P0-27) : le verrou CLAIM_AUTO_RESOLVE_ENABLED
    // (défaut OFF) court-circuite autoResolveSmallClaim AVANT isConsumerAbuseFlagged
    // → le vecteur de crash « erreur DB dans l'anti-abus » est fermé en config bêta.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 8 }))
    db.claim.count.mockRejectedValue(new Error('db_down'))
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' })) // batch 2: ITEM_REQUIRED reasons need a selection; this case is about the ceiling
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it("[PASS-ACTUEL D′ L2 — INVERSÉ] flag+plafond explicites + erreur DB dans l'anti-abus → 201 propre : l'anti-abus n'est plus atteint QUELLE QUE SOIT la config (le vecteur « crash après création via C2 » est fermé par construction)", async () => {
    // AUDIT (vrai tant que l'auto-résolution pouvait être ACTIVÉE explicitement) :
    // autoResolveSmallClaim ran AFTER prisma.claim.create with no error boundary —
    // a DB failure in isConsumerAbuseFlagged (claim.count) made the request 500
    // although the claim row existed. D′ L2 INVERTS this pin: the function is inert by
    // construction, so the anti-abuse read is never reached and the 201 survives.
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 8 })) // the OLD C2-eligible amount
    db.claim.count.mockRejectedValue(new Error('db_down'))
    // NEGATIVE CONTROL — the failure IS armed: the real anti-abuse read would throw if anything reached it.
    await expect(isConsumerAbuseFlagged('c1')).rejects.toThrow('db_down')
    db.claim.count.mockClear()
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', scope: 'whole' })) // batch 2: order-level reason — this case is about the post-create path, not item authority
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
    expect(db.claim.count).not.toHaveBeenCalled()      // the armed failure was never reached
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect((await res.json()).claim).toMatchObject({ id: 'cl1', status: 'restaurant_review' })
  })

  it('[FAIL-ATTENDU: GET aussi sans frontière] flag ON + session, table Claim absente → GET /api/claims rejette brut (listConsumerClaims sans catch)', async () => {
    // AUDIT: same missing error boundary on the read side — the "my claims" list
    // throws out of the handler. After fix, INVERT to a clean JSON error Response.
    db.claim.findMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('table `Claim` does not exist', { code: 'P2021', clientVersion: 'x' }),
    )
    await expect(LIST(req())).rejects.toHaveProperty('code', 'P2021')
  })
})

// ════════════════════════════════════════════════════════════════════════════════════
describe('P10 — non testable ici', () => {
  it.skipIf(!hasStripe)(
    "[NON-TESTABLE: clés Stripe TEST absentes en CI] la jambe argent (executeRefund réel derrière une claim approuvée) — smoke : Stripe se configure",
    async () => {
      // Only runs when STRIPE_SECRET_KEY is present (P1-P10 env). The full money leg
      // (claim accept → executeRefund → Stripe prorata) additionally needs a real DB
      // and belongs to the P5 refund characterization, not here.
      const { getStripe } = await import('@/lib/stripe')
      expect(() => getStripe()).not.toThrow()
    },
  )

  it.todo("[NON-TESTABLE: UI navigateur] vue remboursement de /eat/order/[orderId]/help flag ON — le crash observé à l'activation était peut-être côté UI (hydratation/staging), reproduction navigateur requise")
  it.todo('[NON-TESTABLE: staging/DB réelle] reproduction complète du crash d\'activation : CLAIMS_ENABLED=true sur une base SANS la table Claim (prisma db push manquant) → P2021 réel')
})
