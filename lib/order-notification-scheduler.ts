// ── P0 OPERATIONAL (2026-09-05) — server-side order-notification scheduler ─────
//
// ROOT CAUSE it closes: the two payment-triggered emails (order_confirmation to the
// consumer, resto_order_received to the restaurant) were emitted ONLY by
// POST /api/orders/[id]/confirm — a route whose only callers are the checkout
// screens polling the server every 2 s. The server-side catch-up
// (lib/order-email-sweep via POST /api/admin/orders/confirm-sweep) existed but had
// NO ACTIVE SCHEDULER: GitHub `schedule` fires from the default branch only, and the
// remote `main` is a May Lovable tree without .github/workflows (measured 2026-09-05);
// the cPanel crontab carries no order job; an HTTP cron would also hit the
// INTERNAL_CRON_TOKEN provenance issue (.env.local ≠ runtime, 401 measured v3).
// Result: a customer who closed the tab before the Stripe webhook landed left a PAID
// order that no restaurant ever heard about.
//
// FIX: an IN-PROCESS timer started once per Next.js server process (instrumentation.ts
// → register()), calling `sweepUnconfirmedPaidOrders()` DIRECTLY (no HTTP, no token,
// no browser). Truth = Order.paymentStatus='paid' written by the Stripe webhook
// (server-authoritative); the webhook itself still imports NO sender (golden rule
// untouched). Idempotency = the existing EmailDispatch @@unique([trigger,dedupeKey])
// INSERT-claim inside sendOnce (race-safe across Passenger processes and against the
// browser poll). Retry = the sweep's bounded backoff on EmailLog failures (see
// lib/order-email-sweep). Liveness: Passenger spawns a process on ANY request — the
// webhook that recorded the payment IS such a request — and keeps it ≥ the idle
// timeout, so the first ticks always happen; the long tail resumes at the next request.
//
// SAFETY: production only (dev/test never sweep a DB unless ORDER_NOTIFY_SWEEP_FORCE),
// kill-switch ORDER_NOTIFY_SWEEP_DISABLED=true, single instance per process, no overlap
// (a slow tick is never doubled), unref'd timers (never keep a shutting-down process
// alive), never throws out of a tick. Money engine / webhook / routes: untouched.

export type SweepLike = () => Promise<{
  scanned: number; consumerSent: number; restoSent: number; alreadyDone: number
  skippedNoEmail: number; errors: number; backoffSkipped?: number; gaveUp?: number
}>

export type SchedulerOptions = {
  /** Interval between sweeps (ms). Default 60 s. */
  intervalMs?: number
  /** Delay before the first sweep after process start (ms). Default 10 s. */
  initialDelayMs?: number
  /** Injectable sweep (tests). Default = lib/order-email-sweep (lazy import). */
  sweep?: SweepLike
  /** Injectable heartbeat sink (tests). Default = ~/.grubano/order-notify-heartbeat.json. */
  heartbeat?: (h: Heartbeat) => void
  /** Injectable env (tests). Default process.env. */
  env?: NodeJS.ProcessEnv
  /** Injectable timers (tests use vi.useFakeTimers so the globals are fine). */
  now?: () => number
}

export type Heartbeat = {
  pid: number
  startedAt: string
  lastTickAt: string
  ticks: number
  lastResult: Awaited<ReturnType<SweepLike>> | null
  lastError: string | null
}

export type SchedulerHandle = {
  stop: () => void
  /** Run one sweep now (awaits; used by tests + the operator check). */
  tick: () => Promise<void>
  readonly heartbeat: Heartbeat
}

export const DEFAULT_INTERVAL_MS      = 60_000
export const DEFAULT_INITIAL_DELAY_MS = 10_000

const G = globalThis as unknown as { __grubanoOrderNotifyScheduler?: SchedulerHandle | null }

/** Decide whether this process should run the scheduler (pure, unit-tested). */
export function shouldRunScheduler(env: NodeJS.ProcessEnv = process.env): { run: boolean; reason: string } {
  if (env.ORDER_NOTIFY_SWEEP_DISABLED === 'true') return { run: false, reason: 'ORDER_NOTIFY_SWEEP_DISABLED=true (kill-switch)' }
  if (env.ORDER_NOTIFY_SWEEP_FORCE === 'true')    return { run: true,  reason: 'ORDER_NOTIFY_SWEEP_FORCE=true' }
  if (env.NODE_ENV !== 'production')              return { run: false, reason: `NODE_ENV=${env.NODE_ENV ?? '(unset)'} (production only)` }
  if (env.NEXT_PHASE === 'phase-production-build') return { run: false, reason: 'build phase' }
  return { run: true, reason: 'production' }
}

function defaultHeartbeatSink(): (h: Heartbeat) => void {
  // Written OUTSIDE the web root (the app root is the Apache DocumentRoot on this host —
  // same precaution as the env-provenance file). Counts only — no ids, no PII.
  let dir: string | null = null
  return (h) => {
    try {
      // Lazy requires keep this module import-safe in every runtime (edge builds get the stub).
      const req = (typeof require === 'function' ? require : null) as ((id: string) => unknown) | null
      if (!req) return
      const fs   = req('node:fs')   as typeof import('node:fs')
      const os   = req('node:os')   as typeof import('node:os')
      const path = req('node:path') as typeof import('node:path')
      if (!dir) { dir = path.join(os.homedir(), '.grubano'); fs.mkdirSync(dir, { recursive: true }) }
      fs.writeFileSync(path.join(dir, 'order-notify-heartbeat.json'), JSON.stringify(h, null, 2))
    } catch { /* heartbeat is best-effort visibility, never load-bearing */ }
  }
}

/**
 * Start the scheduler for THIS process. Returns the handle (or the already-running one).
 * Returns null when the environment says not to run (reason logged once).
 */
export function startOrderNotificationScheduler(opts: SchedulerOptions = {}): SchedulerHandle | null {
  const env = opts.env ?? process.env
  const decision = shouldRunScheduler(env)
  if (!decision.run) {
    console.log(`[order-notify] scheduler NOT started — ${decision.reason}`)
    return null
  }
  if (G.__grubanoOrderNotifyScheduler) return G.__grubanoOrderNotifyScheduler

  const intervalMs      = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const initialDelayMs  = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const now             = opts.now ?? (() => Date.now())
  const sink            = opts.heartbeat ?? defaultHeartbeatSink()
  const sweep: SweepLike = opts.sweep ?? (async () => {
    const m = await import('@/lib/order-email-sweep')
    return m.sweepUnconfirmedPaidOrders()
  })

  const heartbeat: Heartbeat = {
    pid: typeof process !== 'undefined' ? process.pid : 0,
    startedAt: new Date(now()).toISOString(),
    lastTickAt: '',
    ticks: 0,
    lastResult: null,
    lastError: null,
  }

  let running = false
  const tick = async () => {
    if (running) return // no overlap: a slow SMTP tick is never doubled inside one process
    running = true
    try {
      const r = await sweep()
      heartbeat.lastResult = r
      heartbeat.lastError  = null
      if (r.consumerSent || r.restoSent || r.errors || r.gaveUp) {
        console.log('[order-notify] sweep', JSON.stringify(r))
      }
    } catch (e) {
      heartbeat.lastError = e instanceof Error ? e.message : String(e)
      console.error('[order-notify] sweep tick failed (non-fatal):', heartbeat.lastError)
    } finally {
      heartbeat.ticks += 1
      heartbeat.lastTickAt = new Date(now()).toISOString()
      running = false
      sink(heartbeat)
    }
  }

  const first = setTimeout(() => { void tick() }, initialDelayMs)
  const every = setInterval(() => { void tick() }, intervalMs)
  ;(first as unknown as { unref?: () => void }).unref?.()
  ;(every as unknown as { unref?: () => void }).unref?.()

  const handle: SchedulerHandle = {
    stop: () => { clearTimeout(first); clearInterval(every); G.__grubanoOrderNotifyScheduler = null },
    tick,
    heartbeat,
  }
  G.__grubanoOrderNotifyScheduler = handle
  console.log(`[order-notify] scheduler started (every ${Math.round(intervalMs / 1000)} s, first in ${Math.round(initialDelayMs / 1000)} s) — ${decision.reason}`)
  return handle
}

/** Test/ops helper: the running handle of this process, if any. */
export function currentOrderNotificationScheduler(): SchedulerHandle | null {
  return G.__grubanoOrderNotifyScheduler ?? null
}
