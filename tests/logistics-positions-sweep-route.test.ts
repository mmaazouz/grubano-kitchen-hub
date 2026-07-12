import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Géoloc ÉTAPE 5 — POST /api/logistics/positions/sweep (CRON_SECRET-protected retention sweep) ─
// Constant-time bearer check (real safe-compare), fail-closed when the secret is unset.

const { sweep } = vi.hoisted(() => ({ sweep: { runGeolocRetentionSweep: vi.fn() } }))
vi.mock('@/lib/courier-position-sweep', () => ({ runGeolocRetentionSweep: sweep.runGeolocRetentionSweep }))
// REAL: @/lib/safe-compare (constant-time compare).

import { POST } from '@/app/api/logistics/positions/sweep/route'

const post = (auth?: string) => POST(new NextRequest('http://x/api/logistics/positions/sweep', {
  method: 'POST', headers: auth !== undefined ? { authorization: auth } : {},
}))

const OLD = process.env.CRON_SECRET
beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 's3cret'
  sweep.runGeolocRetentionSweep.mockResolvedValue({ positionsDeleted: 1, orderCoordsPurged: 2 })
})
afterEach(() => { if (OLD === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = OLD })

describe('auth', () => {
  it('401 with no / a wrong bearer — the sweep never runs', async () => {
    expect((await post()).status).toBe(401)
    expect((await post('Bearer wrong')).status).toBe(401)
    expect(sweep.runGeolocRetentionSweep).not.toHaveBeenCalled()
  })
  it('401 fail-closed when CRON_SECRET is unset (even a "Bearer " header must not authorise)', async () => {
    delete process.env.CRON_SECRET
    expect((await post('Bearer ')).status).toBe(401)
    expect(sweep.runGeolocRetentionSweep).not.toHaveBeenCalled()
  })
})

describe('authorized', () => {
  it('200 + counts with the correct bearer secret', async () => {
    const res = await post('Bearer s3cret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, positionsDeleted: 1, orderCoordsPurged: 2 })
  })
})
