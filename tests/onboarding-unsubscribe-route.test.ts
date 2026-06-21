import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/onboarding/unsubscribe — tokenised one-click unsubscribe (Agent 95) ──────
// A valid signed token sets Operator.onboardingNudgeUnsub=true; a forged/invalid token
// changes NOTHING and returns the SAME neutral page (no oracle, no enumeration, no login).

const { db } = vi.hoisted(() => ({ db: { operator: { update: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

import { GET } from '@/app/api/onboarding/unsubscribe/route'
import { mintUnsubscribeToken } from '@/lib/onboarding-nudge'

const call = (token: string) => GET(new Request(`http://x/api/onboarding/unsubscribe?token=${encodeURIComponent(token)}`))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'unsub-secret'
  db.operator.update.mockResolvedValue({ locale: 'fr' })
})
afterEach(() => { delete process.env.NEXTAUTH_SECRET })

describe('valid token', () => {
  it('sets onboardingNudgeUnsub=true for the bound operator + returns a neutral 200 page', async () => {
    const res = await call(mintUnsubscribeToken('op_42'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(db.operator.update).toHaveBeenCalledWith({
      where: { id: 'op_42' }, data: { onboardingNudgeUnsub: true }, select: { locale: true },
    })
    expect(await res.text()).toContain('unsubDoneTitle')
  })

  it('is idempotent — clicking again just re-sets the flag (no error)', async () => {
    await call(mintUnsubscribeToken('op_42'))
    const res = await call(mintUnsubscribeToken('op_42'))
    expect(res.status).toBe(200)
  })
})

describe('⚠️ forged / invalid token changes NOTHING (no oracle, no enumeration)', () => {
  it('a bad mac → NO update, same neutral 200 page', async () => {
    const tok = mintUnsubscribeToken('op_42')
    const [id, mac] = tok.split('.')
    const res = await call(`${id}.${mac.slice(0, -2)}zz`)
    expect(res.status).toBe(200)
    expect(db.operator.update).not.toHaveBeenCalled()
  })
  it('a swapped operator id → NO update', async () => {
    const tok = mintUnsubscribeToken('op_42')
    const mac = tok.split('.')[1]
    await call(`op_OTHER.${mac}`)
    expect(db.operator.update).not.toHaveBeenCalled()
  })
  it('garbage / empty token → NO update, still 200', async () => {
    expect((await call('garbage')).status).toBe(200)
    expect((await call('')).status).toBe(200)
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})
