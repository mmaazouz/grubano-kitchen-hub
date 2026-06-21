import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken, resolveNudgeLocale } from '@/lib/onboarding-nudge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/onboarding/unsubscribe?token=… — one-click nudge unsubscribe (Agent 95) ──
// PUBLIC (no login): the SIGNED token IS the authorization. The token is a stateless HMAC
// bound to the operator id (lib/onboarding-nudge.verifyUnsubscribeToken) — unguessable,
// non-enumerable, and impossible to forge without the server secret. A valid token sets
// Operator.onboardingNudgeUnsub=true → the nudge cron skips this account forever (idempotent:
// clicking again is a no-op). A bad/forged token changes NOTHING and shows the SAME neutral
// page (no oracle, no IDOR). ZERO money. Reads only its own account; writes only the flag.

function page(title: string, body: string, rtl: boolean): Response {
  const dir = rtl ? 'rtl' : 'ltr'
  const html =
    `<!doctype html><html dir="${dir}" lang="${rtl ? 'ar' : 'fr'}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title></head>` +
    `<body style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;max-width:480px;margin:48px auto;padding:0 20px;text-align:center">` +
    `<h1 style="color:#F97316;font-size:20px">${title}</h1>` +
    `<p style="color:#6b7280;font-size:14px">${body}</p>` +
    `</body></html>`
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: Request) {
  const token      = new URL(req.url).searchParams.get('token') ?? ''
  const operatorId = verifyUnsubscribeToken(token)

  let locale = 'fr'
  if (operatorId) {
    try {
      const op = await prisma.operator
        .update({ where: { id: operatorId }, data: { onboardingNudgeUnsub: true }, select: { locale: true } })
        .catch(() => null)
      if (op) locale = resolveNudgeLocale(op.locale)
    } catch { /* best-effort — still show the neutral confirmation */ }
  }

  // The SAME neutral confirmation in both cases (valid → flag set; invalid → nothing) so the
  // response never reveals whether the token matched an account.
  const t = await getTranslations({ locale, namespace: 'onboardingNudge' })
  return page(t('unsubDoneTitle'), t('unsubDoneBody'), locale === 'ar')
}
