// ── requestMagicLink() — wrapper client UNIQUE de POST /api/auth/magic-link ──
//
// Le principe anti-énumération de l'API (réponse 2xx générique, ne révèle jamais si le
// compte existe) avait été étendu à tort côté client en « ne jamais lire la réponse » :
// les trois appelants affichaient « e-mail envoyé » même sur 429 (rate-limit réel,
// 5 req/10 min) ou 5xx — faux succès prouvé au reality check du 2026-08-29.
//
// Ce wrapper garde l'anti-énumération (un 2xx reste générique) mais distingue les
// ÉCHECS DE TRANSPORT, qui eux ne divulguent rien sur le compte :
//   429            → 'rate_limited'  (message « trop de tentatives »)
//   autre non-2xx  → 'unavailable'
//   panne réseau   → 'unavailable'
export type MagicLinkFailure = 'rate_limited' | 'unavailable'
export type MagicLinkResult =
  | { ok: true; otpEnabled: boolean }
  | { ok: false; reason: MagicLinkFailure }

export async function requestMagicLink(
  email: string,
  opts?: { locale?: string; space?: string },
): Promise<MagicLinkResult> {
  try {
    const res = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ...(opts?.locale ? { locale: opts.locale } : {}), ...(opts?.space ? { space: opts.space } : {}) }),
    })
    if (res.status === 429) return { ok: false, reason: 'rate_limited' }
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    const data = (await res.json().catch(() => null)) as { otpEnabled?: boolean } | null
    return { ok: true, otpEnabled: data?.otpEnabled === true }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
