// ── ATTRIBUTION_COOKIES_ENABLED — Lot 7 closed beta (legal + privacy) ─────────
//
// Règle mission bêta : un traqueur NON essentiel est coupé (OFF) plutôt que
// d'introduire une CMP. Les deux cookies d'ATTRIBUTION du repo :
//   • grubano_ref  (90 j, first-touch créateur/affilié — /api/ref/[code])
//   • grubano_chef (24 h, last-touch page chef — /api/chef-visit/[slug])
// ne sont posés que si ce flag est ON. Le flag gate UNIQUEMENT le
// res.cookies.set des deux routes — la redirection, la validation du code, le
// click-tracking affilié et tout le reste restent byte-identical.
//
// Convention repo (docs/ops/flags.md) : actif si la variable vaut EXACTEMENT la
// chaîne 'true' — tout le reste (absent, vide, '1', 'TRUE') = OFF par défaut.

/** Attribution cookies kill-switch — default OFF. Only the exact string 'true' enables it. */
export function isAttributionCookiesEnabled(): boolean {
  return process.env.ATTRIBUTION_COOKIES_ENABLED === 'true'
}
