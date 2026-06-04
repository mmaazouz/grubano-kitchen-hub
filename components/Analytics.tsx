// Privacy-friendly analytics receptacle (Agent 11 — SEO/Growth).
//
// This is an intentionally empty scaffold. It reads NEXT_PUBLIC_ANALYTICS_ID
// and renders NOTHING when it's absent — no tracker is chosen, no key is set,
// and no network call or cookie is made here.
//
// ⚠️ RGPD / consent (Agent 12 territory): the real tracker script must be
// injected below ONLY AFTER cookie consent has been granted. Do not load any
// analytics before consent. Keep this component server-safe (no client hooks)
// until the consent gate exists.
export default function Analytics() {
  const id = process.env.NEXT_PUBLIC_ANALYTICS_ID
  if (!id) return null

  // Receptacle ready. Agent 12 wires the consent-gated <Script> here once the
  // cookie-consent mechanism lands. Until then we deliberately load nothing.
  return null
}
