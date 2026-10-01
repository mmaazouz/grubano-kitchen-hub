// tests/claims-dprime-l4-withdraw-route.test.ts — D′ lot L4 (spec v2 T-09, §4), the ROUTE.
//
// The library function is proven elsewhere (tests/claims-dprime-l4-approved-amount.test.ts). This file
// pins the HTTP surface: the gate, the admin guard, the schema guard, the shapes it answers, and the
// customer notice it sends. A withdrawal is the reversal of a money decision — every refusal here must
// leave the claim exactly as it was, and the route must never look like a refusal of the claim itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { withdrawMock, adminMock, emailMock, schemaMock } = vi.hoisted(() => ({
  withdrawMock: vi.fn(), adminMock: vi.fn(), emailMock: vi.fn(), schemaMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimDecisionEmail: emailMock }))
vi.mock('@/lib/schema-ready', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/schema-ready')>()
  return { ...real, schemaReady: () => schemaMock() }
})
vi.mock('@/lib/claims', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/claims')>()
  return { ...real, withdrawClaimApproval: (...a: unknown[]) => withdrawMock(...a) }
})

import { POST as withdraw } from '@/app/api/admin/claims/[id]/withdraw-approval/route'
import { WITHDRAW_CONFIRM_WORD, WITHDRAW_AUDIT_DISABLED } from '@/lib/claim-action-rules'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

const STAMP = new Date('2026-09-23T08:00:00.000Z')
const OK = {
  ok: true as const,
  claim: { id: 'cl1', consumerId: 'c1', orderId: 'o1', status: 'arbitration' },
  previous: { arbitratedAt: STAMP, approvedAmountCents: 500 },
}
const BODY = { reason: 'décision reprise après vérification', confirm: WITHDRAW_CONFIRM_WORD }
const post = (body: unknown, id = 'cl1') =>
  withdraw(new Request(`https://app.grubano.com/api/admin/claims/${id}/withdraw-approval`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: { id } })

beforeEach(() => {
  vi.clearAllMocks()
  openClaimsWindow()
  adminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test' })
  emailMock.mockResolvedValue({ status: 'sent' })
  schemaMock.mockResolvedValue({ ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], probedAt: '', why: null })
  withdrawMock.mockResolvedValue(OK)
})
afterEach(() => { closeClaimsWindow() })

describe('POST …/withdraw-approval — the gates, in order, before anything is reversed', () => {
  it('surface closed → 403 gated: no admin lookup, no schema probe, no reversal', async () => {
    closeClaimsWindow()
    const res = await post(BODY)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    expect(adminMock).not.toHaveBeenCalled()
    expect(schemaMock).not.toHaveBeenCalled()
    expect(withdrawMock).not.toHaveBeenCalled()
  })

  it('a non-admin session → 403, still nothing reversed', async () => {
    adminMock.mockResolvedValue(null)
    expect((await post(BODY)).status).toBe(403)
    expect(withdrawMock).not.toHaveBeenCalled()
  })

  it('an invalid body → 400 without reaching the library (an empty reason is not a withdrawal)', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ reason: '' })).status).toBe(400)
    expect(withdrawMock).not.toHaveBeenCalled()
  })

  it('S-27 — the schema not ready → 503 schema_not_ready, and nothing is reversed', async () => {
    schemaMock.mockResolvedValue({ ready: false, clientReady: false, dbReady: null, missingClient: ['Claim.approvedAmountCents'], missingDb: [], probedAt: '', why: 'stale client' })
    const res = await post(BODY)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ reason: 'schema_not_ready', schemaReady: false })
    expect(withdrawMock).not.toHaveBeenCalled()
  })
})

describe('POST …/withdraw-approval — what it answers and what it tells the customer', () => {
  it('the nominal reversal: 200, moneyMoved false, and the library receives the admin identity and the motive', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ moneyMoved: false })
    expect(body.claim).toMatchObject({ status: 'arbitration' })
    expect(body).not.toHaveProperty('refund')
    expect(withdrawMock).toHaveBeenCalledWith(expect.objectContaining({
      claimId: 'cl1', adminId: 'admin1', adminEmail: 'admin@grubano.test',
      reason: BODY.reason, confirm: WITHDRAW_CONFIRM_WORD,
    }))
  })

  it('the customer notice is the pre-money withdrawal one, stamped with the decision it reverses — and carries no amount', async () => {
    await post(BODY)
    expect(emailMock).toHaveBeenCalledTimes(1)
    const p = emailMock.mock.calls[0][0] as Record<string, unknown>
    expect(p).toMatchObject({ decision: 'approval_withdrawn', refundedCents: null, decisionStamp: STAMP, claimsOpen: true })
    // the admin's motive is audit material: it is never sent to the customer
    expect(p.reason).toBeNull()
    expect(p).not.toHaveProperty('approvedCents')
  })

  it('an e-mail failure never undoes the reversal (the reversal is already recorded)', async () => {
    emailMock.mockRejectedValue(new Error('smtp down'))
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ customerEmail: { status: 'failed', why: 'sender_error' } })
  })

  it('every library refusal is surfaced verbatim with its status — and audit_disabled carries its reason', async () => {
    withdrawMock.mockResolvedValue({ ok: false, status: 409, error: WITHDRAW_AUDIT_DISABLED, reason: 'audit_disabled' })
    const a = await post(BODY)
    expect(a.status).toBe(409)
    expect(await a.json()).toEqual({ error: WITHDRAW_AUDIT_DISABLED, reason: 'audit_disabled' })
    expect(emailMock).not.toHaveBeenCalled() // nothing was reversed, so nothing is announced

    withdrawMock.mockResolvedValue({ ok: false, status: 404, error: 'Réclamation introuvable.' })
    const b = await post(BODY)
    expect(b.status).toBe(404)
    expect(await b.json()).toEqual({ error: 'Réclamation introuvable.' })
  })

  it('STATIC — the route never refuses the claim, never touches money, and never writes its own audit row', () => {
    const s = readFileSync('app/api/admin/claims/[id]/withdraw-approval/route.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(s).not.toMatch(/refused_final/)
    expect(s).not.toMatch(/triggerClaimRefund|executeRefund|@\/lib\/refund|refunds\.create|getStripe/)
    // the audit belongs to the transaction inside lib/claims — a second, best-effort row here would be a lie
    expect(s).not.toMatch(/recordAdminAudit/)
    expect(s).toMatch(/claimsSurfaceOpen\(\)/)
    expect(s).toMatch(/resolveAdmin\(\)/)
    expect(s).toMatch(/schemaReady\(\)/)
    expect(s).toMatch(/moneyMoved: false/)
  })
})
