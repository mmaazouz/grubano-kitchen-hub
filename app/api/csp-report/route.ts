import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/csp-report — self-hosted CSP violation collector (go-live hardening) ────────────
// The report-uri target of the REPORT-ONLY Content-Security-Policy (next.config.js). Browsers POST
// a JSON violation report here when a resource WOULD be blocked under the policy — while we are in
// report-only mode nothing is actually blocked, this just lets us OBSERVE (server logs) what the
// app loads so we can finalise the policy before ever switching to enforce. No external host, no
// storage, no PII kept — it logs a compact line and returns 204. Best-effort + always 204 so a
// malformed report never errors the browser.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    // Browsers send either { "csp-report": {...} } (report-uri) or an array (report-to).
    const r = (body && (body['csp-report'] ?? body)) as Record<string, unknown> | null
    if (r && typeof r === 'object') {
      const doc = r['document-uri'] ?? r['documentURL'] ?? '?'
      const directive = r['violated-directive'] ?? r['effectiveDirective'] ?? '?'
      const blocked = r['blocked-uri'] ?? r['blockedURL'] ?? '?'
      console.warn(`[CSP-REPORT] directive=${String(directive)} blocked=${String(blocked)} doc=${String(doc)}`)
    }
  } catch {
    /* ignore — a report must never error */
  }
  return new NextResponse(null, { status: 204 })
}
