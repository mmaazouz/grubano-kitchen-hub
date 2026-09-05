import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  startOrderNotificationScheduler, shouldRunScheduler, currentOrderNotificationScheduler,
  DEFAULT_INTERVAL_MS, DEFAULT_INITIAL_DELAY_MS,
} from '@/lib/order-notification-scheduler'

// ── P0 OPERATIONAL — the in-process scheduler that replaces "browser polling" as the
// trigger of the paid-order emails. Deterministic: injected sweep + fake timers.

const ok = () => ({ scanned: 0, consumerSent: 0, restoSent: 0, alreadyDone: 0, skippedNoEmail: 0, errors: 0, backoffSkipped: 0, gaveUp: 0 })
const PROD = { NODE_ENV: 'production' } as NodeJS.ProcessEnv

beforeEach(() => { vi.useFakeTimers(); currentOrderNotificationScheduler()?.stop() })
afterEach(() => { currentOrderNotificationScheduler()?.stop(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('shouldRunScheduler — gates (pure)', () => {
  it('production → run', () => expect(shouldRunScheduler(PROD).run).toBe(true))
  it('kill-switch ORDER_NOTIFY_SWEEP_DISABLED=true → never runs, even in production', () =>
    expect(shouldRunScheduler({ ...PROD, ORDER_NOTIFY_SWEEP_DISABLED: 'true' }).run).toBe(false))
  it('dev / test → does not run (never sweeps a dev DB)', () => {
    expect(shouldRunScheduler({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).run).toBe(false)
    expect(shouldRunScheduler({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).run).toBe(false)
  })
  it('ORDER_NOTIFY_SWEEP_FORCE=true → runs outside production (ops check), unless the kill-switch is set', () => {
    expect(shouldRunScheduler({ NODE_ENV: 'development', ORDER_NOTIFY_SWEEP_FORCE: 'true' } as NodeJS.ProcessEnv).run).toBe(true)
    expect(shouldRunScheduler({ NODE_ENV: 'development', ORDER_NOTIFY_SWEEP_FORCE: 'true', ORDER_NOTIFY_SWEEP_DISABLED: 'true' } as NodeJS.ProcessEnv).run).toBe(false)
  })
  it('build phase → does not run', () => expect(shouldRunScheduler({ ...PROD, NEXT_PHASE: 'phase-production-build' }).run).toBe(false))
})

describe('startOrderNotificationScheduler — timer behaviour', () => {
  it('first sweep after the initial delay, then every interval; heartbeat records ticks', async () => {
    const sweep = vi.fn(async () => ({ ...ok(), restoSent: 1 }))
    const beats: unknown[] = []
    const h = startOrderNotificationScheduler({ env: PROD, sweep, intervalMs: 1000, initialDelayMs: 100, heartbeat: (b) => beats.push({ ...b }) })
    expect(h).not.toBeNull()
    expect(sweep).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(sweep).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(sweep).toHaveBeenCalledTimes(4)
    expect(h!.heartbeat.ticks).toBe(4)
    expect(h!.heartbeat.lastResult).toMatchObject({ restoSent: 1 })
    expect(beats.length).toBe(4)
  })

  it('no overlap: a slow sweep is never doubled inside one process', async () => {
    let resolveSlow: (() => void) | null = null
    const sweep = vi.fn(() => new Promise<ReturnType<typeof ok>>((res) => { resolveSlow = () => res(ok()) }))
    startOrderNotificationScheduler({ env: PROD, sweep, intervalMs: 100, initialDelayMs: 0, heartbeat: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(350) // 3 interval ticks while the first sweep is still running
    expect(sweep).toHaveBeenCalledTimes(1)
    resolveSlow!()
    await vi.advanceTimersByTimeAsync(100)
    expect(sweep).toHaveBeenCalledTimes(2)
  })

  it('a throwing sweep never escapes the tick; the error is recorded and the next tick still runs', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sweep = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(ok())
    const h = startOrderNotificationScheduler({ env: PROD, sweep, intervalMs: 100, initialDelayMs: 0, heartbeat: () => {} })!
    await vi.advanceTimersByTimeAsync(0)
    expect(h.heartbeat.lastError).toBe('db down')
    await vi.advanceTimersByTimeAsync(100)
    expect(sweep).toHaveBeenCalledTimes(2)
    expect(h.heartbeat.lastError).toBeNull()
    errSpy.mockRestore()
  })

  it('singleton per process: a second start returns the same handle (no double timers); stop() clears it', async () => {
    const sweep = vi.fn(async () => ok())
    const a = startOrderNotificationScheduler({ env: PROD, sweep, intervalMs: 100, initialDelayMs: 0, heartbeat: () => {} })
    const b = startOrderNotificationScheduler({ env: PROD, sweep, intervalMs: 100, initialDelayMs: 0, heartbeat: () => {} })
    expect(b).toBe(a)
    await vi.advanceTimersByTimeAsync(250)
    expect(sweep).toHaveBeenCalledTimes(3) // 0, 100, 200 — one timer chain only
    a!.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sweep).toHaveBeenCalledTimes(3)
    expect(currentOrderNotificationScheduler()).toBeNull()
  })

  it('gated environments return null and start no timer', async () => {
    const sweep = vi.fn(async () => ok())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const h = startOrderNotificationScheduler({ env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv, sweep, initialDelayMs: 0 })
    expect(h).toBeNull()
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS + DEFAULT_INITIAL_DELAY_MS)
    expect(sweep).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('NOT started'))
  })
})

describe('wiring (source-scan)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
  it('instrumentation.ts starts the scheduler in the nodejs runtime only, lazily', () => {
    const src = read('instrumentation.ts')
    expect(/NEXT_RUNTIME !== 'nodejs'/.test(src)).toBe(true)
    expect(/await import\('\.\/lib\/order-notification-scheduler'\)/.test(src)).toBe(true)
    expect(/startOrderNotificationScheduler\(\)/.test(src)).toBe(true)
  })
  it('next.config.js enables the instrumentation hook', () => {
    expect(/instrumentationHook:\s*true/.test(read('next.config.js'))).toBe(true)
  })
  it('GOLDEN RULE — the Stripe webhook still imports no sender and NOT the sweep/scheduler', () => {
    const wh = read('app/api/webhooks/stripe/route.ts')
    expect(/transactional-emails|sendOnce|order-email-sweep|order-notification-scheduler/.test(wh)).toBe(false)
  })
  it('the /confirm route (browser fast path) is untouched by the scheduler work', () => {
    expect(/order-email-sweep|order-notification-scheduler/.test(read('app/api/orders/[id]/confirm/route.ts'))).toBe(false)
  })
})
