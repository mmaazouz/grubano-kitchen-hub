// EDGE-RUNTIME STUB. Next.js compiles instrumentation.ts for BOTH runtimes and webpack
// resolves the import chain even inside the dead `NEXT_RUNTIME === 'nodejs'` branch; the
// real module reaches Nodemailer → Node builtins (crypto, fs) that the edge bundle cannot
// resolve. next.config.js swaps this stub in for the edge build only
// (NormalModuleReplacementPlugin) — the nodejs runtime gets the real scheduler.
export function startOrderNotificationScheduler(): null { return null }
export function currentOrderNotificationScheduler(): null { return null }
export function shouldRunScheduler(): { run: false; reason: string } { return { run: false, reason: 'edge runtime stub' } }
