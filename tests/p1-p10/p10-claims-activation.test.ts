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
//    nominal POST flow WORKS: 201, claim created, C2 auto-resolution of small claims
//    included. So the route logic itself does NOT crash on activation.
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

const req = (body?: unknown, url = 'https://app.grubano.com/api/claims') =>
  ({ url, json: async () => body ?? {} }) as never

const paidOrder = (o: Record<string, unknown> = {}) => ({
  id: 'o1', consumerId: 'c1', restaurantId: 'r1', paymentStatus: 'paid', total: 50, updatedAt: new Date(), ...o,
})

// Stripe TEST keys are absent in CI — presence check ONLY, the value is never read.
const hasStripe = !!process.env.STRIPE_SECRET_KEY

beforeEach(() => {
  vi.clearAllMocks()
  tokenMock.mockResolvedValue({ sub: 'c1' })
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
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality' }))
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
  beforeEach(() => { vi.stubEnv('CLAIMS_ENABLED', 'true') })

  it('[PASS-ACTUEL] flag ON sans session → 401 (le canal devient réel mais reste derrière auth)', async () => {
    tokenMock.mockResolvedValue(null)
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality' }))
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
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality' }))
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

  it("[PASS-ACTUEL P0-27] petite réclamation (5 €) SANS config auto-résolution → PLUS d'auto_small : la réclamation reste en revue restaurant (fail-safe, validation humaine)", async () => {
    // Ré-photographié en vague 1 (P0-27) : l'ancien défaut permissif (plafond 1000
    // implicite → auto-remboursement ACTIF sans config) est supprimé. Sans
    // CLAIM_AUTO_RESOLVE_ENABLED + CLAIM_AUTO_APPROVE_MAX_CENTS explicites,
    // une petite réclamation suit le flux C1 normal.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 5 })) // 500 cents — sous l'ANCIEN plafond
    const res = await CREATE(req({ orderId: 'o1', reason: 'missing_item' }))
    expect(res.status).toBe(201)
    // AUCUNE approbation machine : pas d'updateMany 'approved', moteur jamais appelé.
    const approved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'approved')
    expect(approved).toBeUndefined()
    expect(execMock).not.toHaveBeenCalled()
    // Le non-déclenchement est TRACÉ (jamais silencieux) et la claim reste C1.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CLAIM_AUTO_RESOLVE_ENABLED'))
    expect((await res.json()).claim).toMatchObject({ status: 'restaurant_review' })
    warnSpy.mockRestore()
  })

  it("[PASS-ACTUEL P0-27] config post-pilote EXPLICITE (flag + plafond) → l'auto_small refonctionne ; REFUNDS off → remboursement PENDING, jamais le moteur", async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 8 })) // 800 cents ≤ 1000 ceiling
    const res = await CREATE(req({ orderId: 'o1', reason: 'missing_item' }))
    expect(res.status).toBe(201)
    // C2 kicked in post-create: restaurant_review → approved, decided by auto_small.
    const approved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'approved')
    expect(approved?.[0].data).toMatchObject({ status: 'approved', restaurantResponse: 'accepted', decidedBy: 'auto_small' })
    // REFUNDS_ENABLED off → refund rests PENDING; the money engine is never called.
    expect(execMock).not.toHaveBeenCalled()
    // The 201 body still carries the pre-approval snapshot (the client refetches
    // eligibility right after — documented behaviour of the route).
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
describe("P10 — activation : le crash (aucune frontière d'erreur dans la route)", () => {
  beforeEach(() => { vi.stubEnv('CLAIMS_ENABLED', 'true') })

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
    await expect(CREATE(req({ orderId: 'o1', reason: 'quality' }))).rejects.toHaveProperty('code', 'P2021')
  })

  it("[PASS-ACTUEL P0-27] défaut fail-safe : l'anti-abus n'est PLUS ATTEINT (gate flag AVANT) → une erreur DB dans claim.count ne crashe plus le handler, 201 propre", async () => {
    // Ré-photographié en vague 1 (P0-27) : le verrou CLAIM_AUTO_RESOLVE_ENABLED
    // (défaut OFF) court-circuite autoResolveSmallClaim AVANT isConsumerAbuseFlagged
    // → le vecteur de crash « erreur DB dans l'anti-abus » est fermé en config bêta.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 8 }))
    db.claim.count.mockRejectedValue(new Error('db_down'))
    const res = await CREATE(req({ orderId: 'o1', reason: 'missing_item' }))
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it("[FAIL-ATTENDU: crash APRÈS création via C2 — SUBSISTE en config post-pilote] flag+plafond explicites + erreur DB dans l'anti-abus → le handler rejette alors que la claim EST déjà persistée", async () => {
    // AUDIT (toujours vrai une fois l'auto-résolution ACTIVÉE explicitement) :
    // autoResolveSmallClaim runs AFTER prisma.claim.create with no error boundary —
    // a DB failure in isConsumerAbuseFlagged (claim.count) makes the request 500
    // although the claim row exists: the consumer sees a crash and may resubmit
    // (blocked only by the activeOrderKey unique). After fix, INVERT: the 201 must
    // survive a post-create C2 failure (best-effort auto-resolution).
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
    db.order.findUnique.mockResolvedValue(paidOrder({ total: 8 })) // C2-eligible amount
    db.claim.count.mockRejectedValue(new Error('db_down'))
    await expect(CREATE(req({ orderId: 'o1', reason: 'missing_item' }))).rejects.toThrow('db_down')
    expect(db.claim.create).toHaveBeenCalledTimes(1) // the claim WAS created before the crash
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
