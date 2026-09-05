// Next.js instrumentation hook (experimental.instrumentationHook in next.config.js).
// `register()` runs ONCE per server process at startup, in EVERY runtime — so the
// Node-only work is behind the NEXT_RUNTIME guard and lazily imported (the module
// pulls Prisma + Nodemailer, which must never be bundled for the edge runtime).
//
// Purpose (P0 OPERATIONAL, 2026-09-05): start the in-process order-notification
// scheduler so a PAID order reaches the restaurant without any browser tab open.
// See lib/order-notification-scheduler.ts for the contract, gates and kill-switch.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startOrderNotificationScheduler } = await import('./lib/order-notification-scheduler')
    startOrderNotificationScheduler()
  } catch (e) {
    // Never let a scheduler problem break server startup.
    console.error('[order-notify] instrumentation register failed (non-fatal):', e instanceof Error ? e.message : e)
  }
}
