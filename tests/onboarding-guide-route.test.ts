import { describe, it, expect, afterEach } from 'vitest'
import { GET } from '@/app/api/onboarding/guide/route'

// ── GET /api/onboarding/guide — flag probe (Agent 93) ─────────────────────────────────
// Returns ONLY { enabled } (no user data → no IDOR surface). Reflects the flag exactly.
// The actual progress data is read from the EXISTING owner-scoped /api/business/activation.

afterEach(() => { delete process.env.ONBOARDING_GUIDE_ENABLED })

describe('flag probe', () => {
  it('enabled:false by default (OFF → guide byte-identical absent)', async () => {
    delete process.env.ONBOARDING_GUIDE_ENABLED
    const body = await (await GET()).json()
    expect(body).toEqual({ enabled: false })
  })

  it('enabled:true only when the flag is exactly "true"', async () => {
    process.env.ONBOARDING_GUIDE_ENABLED = 'true'
    expect(await (await GET()).json()).toEqual({ enabled: true })
    process.env.ONBOARDING_GUIDE_ENABLED = 'yes'
    expect(await (await GET()).json()).toEqual({ enabled: false })
  })

  it('exposes ONLY the enabled flag — no user/progress data leaked', async () => {
    process.env.ONBOARDING_GUIDE_ENABLED = 'true'
    const body = await (await GET()).json()
    expect(Object.keys(body)).toEqual(['enabled'])
  })
})
