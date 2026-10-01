import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── POST /api/eat-next/consumer-provision (Agent 132, brick 2c) ────────────────
// Gated (CONSUMER_REDESIGN_ENABLED OFF → 404), anti-enumeration (generic {ok:true} for any valid
// email regardless of provisioning outcome), rate-limited per-IP and per-email.

const { ensureConsumerByEmail } = vi.hoisted(() => ({ ensureConsumerByEmail: vi.fn() }))
vi.mock('@/lib/consumer-signup', () => ({ ensureConsumerByEmail }))
const { isEnabled } = vi.hoisted(() => ({ isEnabled: vi.fn() }))
vi.mock('@/lib/consumer-redesign', () => ({ isConsumerRedesignEnabled: isEnabled }))

import { POST } from '@/app/api/eat-next/consumer-provision/route'

function post(body: unknown, ip: string) {
  return new Request('http://localhost/api/eat-next/consumer-provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureConsumerByEmail.mockResolvedValue({ ok: true })
  isEnabled.mockReturnValue(true)
})

describe('POST /api/eat-next/consumer-provision', () => {
  it('404s when CONSUMER_REDESIGN_ENABLED is OFF (whole surface invisible)', async () => {
    isEnabled.mockReturnValue(false)
    const res = await POST(post({ email: 'a@b.com' }, '1.1.1.1'))
    expect(res.status).toBe(404)
    expect(ensureConsumerByEmail).not.toHaveBeenCalled()
  })

  it('provisions + returns a generic {ok:true} (200) for a valid email', async () => {
    const res = await POST(post({ email: 'Buyer@Email.com' }, '2.2.2.2'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(ensureConsumerByEmail).toHaveBeenCalledWith('buyer@email.com')
  })

  it('stays generic {ok:true} even when provisioning fails (no enumeration leak)', async () => {
    ensureConsumerByEmail.mockResolvedValueOnce({ ok: false, reason: 'error' })
    const res = await POST(post({ email: 'whoknows@email.com' }, '3.3.3.3'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects a malformed email with 400 (input validation, not enumeration)', async () => {
    const res = await POST(post({ email: 'not-an-email' }, '4.4.4.4'))
    expect(res.status).toBe(400)
    expect(ensureConsumerByEmail).not.toHaveBeenCalled()
  })

  it('rate-limits per-email beyond the threshold (429)', async () => {
    const ip = '5.5.5.5'
    const email = 'ratelimit@email.com'
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) {
      const res = await POST(post({ email }, ip))
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]) // EMAIL_MAX = 5
    expect(statuses[5]).toBe(429)
    expect(statuses[6]).toBe(429)
  })
})
