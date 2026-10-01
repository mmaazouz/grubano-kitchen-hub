// ── D5 (closed beta) — CONNECT-READY GATE ─────────────────────────────────────
// Un restaurant sans compte Stripe Connect ACTIF ne doit pas pouvoir encaisser
// une vraie commande : le fallback plateforme (PI nu, application_fee 0) laisse
// 100 % de l'argent — part restaurant comprise — sur le compte Grubano, sans
// AUCUN rail de reversement (la table Payout n'a pas de rôle 'restaurant' et
// aucun payouts.create n'existe). Le refus vit au POINT D'ÉTRANGLEMENT ARGENT
// (routes /pay), pas seulement à l'approbation : un compte qui passe
// active→restricted APRÈS approbation doit être refusé lui aussi.
//
// ALLOW_PLATFORM_FALLBACK est un DANGER-FLAG D'OUVERTURE (défaut absent =
// BLOQUANT) : le côté sûr est le refus. C'est l'inverse volontaire d'un flag de
// protection type RATE_LIMIT_ENABLED, dont l'oubli laisserait le trou ouvert.
// Ne le poser à 'true' que sur un environnement de QA/harnais — jamais en
// production (documenté docs/ops/flags.md).

export function isPlatformFallbackAllowed(): boolean {
  return process.env.ALLOW_PLATFORM_FALLBACK === 'true'
}

/** Vrai quand le restaurant peut réellement encaisser (destination charge). */
export function isConnectReady(r: { stripeAccountId?: string | null; stripeAccountStatus?: string | null } | null | undefined): boolean {
  return !!(r?.stripeAccountId && r.stripeAccountStatus === 'active')
}
