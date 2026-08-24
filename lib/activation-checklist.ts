// ── Activation checklist engine (B1.2, Agent 28) ──────────────────────────────
//
// A GENERIC, PURE derivation of a partner's "activation journey" from signals
// that are ALREADY loaded by the caller. No I/O, no DB, no schema: every state
// is computed in memory from existing fields, so this module is fully unit-
// testable in a node-only env and never touches a forbidden zone (payments,
// magic-link, KYB, LLM).
//
// The engine itself is role-agnostic: it derives progress / current-step /
// discovery-flag from an ordered list of steps. The PER-ROLE step logic lives in
// a registry (DEFINITIONS) so other roles (supplier, logistics, creator,
// franchise) can plug in later WITHOUT touching the generic core. v1 ships ONE
// concrete definition: 'restaurant'.
//
// PRESENTATION ONLY: the checklist REFLECTS the real server behaviour, it never
// drives it. In particular it mirrors the SEC1 publication lock — going live
// (Restaurant.isActive → true) is admin-only, so the restaurateur definition
// NEVER exposes a "publish" CTA to the owner; an otherwise-complete-but-unpublished
// establishment surfaces as a read-only "awaiting Grubano validation" state.

/** Activation gate the step belongs to (palier 0→4). */
export type Gate = 0 | 1 | 2 | 3 | 4

/**
 * - done    : satisfied.
 * - current : the single active frontier the partner should act on next (or is
 *             waiting on, e.g. admin approval).
 * - todo    : not done yet, actionable, but not the immediate frontier.
 * - locked  : cannot start until an earlier step is done (carries a blockedReasonKey).
 */
export type StepState = 'done' | 'current' | 'todo' | 'locked'

export interface ChecklistStep {
  id:                string
  gate:              Gate
  titleKey:          string
  descriptionKey:    string
  state:             StepState
  /** i18n key for the just-in-time CTA label (omitted when there is no action). */
  ctaKey?:           string
  /** Locale-less href to an EXISTING page (next-intl adds the locale). */
  ctaHref?:          string
  /** i18n key explaining why a step is locked or waiting (no action available). */
  blockedReasonKey?: string
}

// NOTE: all *Key fields are RELATIVE to the shared `activation` i18n namespace
// (e.g. 'steps.account.title' → messages.activation.steps.account.title). The
// consumer calls useTranslations('activation'). Every role's checklist copy
// lives under this single namespace.

// ── Contract v1.1 named outputs (mission CA) ─────────────────────────────────
// D26 separates STATE / REASON / PRESENTATION: a capacity carries its value AND
// the reason it is false, never a rendered sentence. `reason` is null when the
// capacity holds.
// These are STABLE CODES, NOT i18n keys: no translation was added on purpose —
// naming a label would presume a display surface, and no screen is in scope for
// this mission. Whoever renders the capacity maps these codes to its own copy.
export type CardReadyReason =
  | 'no_establishment'   // no establishment to carry a menu
  | 'no_attached_brand'  // establishment exists, no brand attached to IT (D11)
  | 'no_available_dish'  // attached brand(s), zero AVAILABLE dish

/**
 * CARTE PRÊTE (contract §3) — « il existe des plats publiables réellement
 * rattachés à l'établissement ». D11 makes the attachment CONSTITUTIVE: a dish
 * on an orphan brand does NOT count. Scope decided by the founder (mission CA):
 * PER ESTABLISHMENT.
 * B1: value AND reason are exposed. The engine never decides where to show it.
 */
export interface CardReady {
  value:  boolean
  reason: CardReadyReason | null
}

export interface ActivationChecklist {
  role:          string
  steps:         ChecklistStep[]
  /** Share of steps in state 'done', 0–100 (rounded). */
  progressPct:   number
  /** The step the partner is on (first 'current', else first 'todo'/'locked'). */
  currentStepId: string | null
  /** True while at least one step is not done → UI shows the discovery banner. */
  isDiscovery:   boolean
  /**
   * PRÉPARÉ (contract v1.1 §2) — « Condition · l'établissement est créé ».
   * Founder arbitration B2: the existence of a BRAND is NOT part of this
   * definition and must not be added to it.
   * Undefined for roles whose definition does not carry this state.
   */
  prepared?:     boolean
  /**
   * CARTE PRÊTE — value + reason (B1). Undefined when the caller did not supply
   * the per-establishment signals, and for roles that do not carry it.
   */
  cardReady?:    CardReady
}

/**
 * Signals are FACTS the caller has already read from the DB (existing fields
 * only). Optional/forward-looking fields stay undefined until a future brick
 * provides them; the restaurateur definition only relies on what exists today.
 */
export interface ChecklistSignals {
  /** Operator.status === 'active'. */
  accountActive:  boolean
  /** Operator.emailVerifiedAt != null (kept for description nuance). */
  emailVerified?: boolean
  /** A Brand row exists for the operator. */
  hasBrand:       boolean
  /** A non-archived Restaurant row exists for the operator. */
  hasRestaurant:  boolean
  /** Count of menu items across the operator's brands. */
  menuItemCount:  number
  /** Restaurant.isActive — published & visible on /eat (admin-gated, SEC1). */
  isActive:       boolean
  /** Restaurant.stripeAccountStatus === 'active' (read-only mirror, no logic). */
  stripeConnected: boolean
  /** Raw Restaurant.stripeAccountStatus for sub-labelling ('pending'|'active'|'restricted'|null). */
  stripeStatus?:  string | null
  // ── CARTE PRÊTE, per-establishment signals (mission CA) ────────────────────
  // OPTIONAL by design: adding a REQUIRED field would break 19 annotated
  // literals (13 of them in production code) at build time. Undefined here means
  // "the caller did not measure it" → no cardReady output, never a false value.
  /** Count of brands whose Brand.restaurantId === the scoped establishment id. */
  attachedBrandCount?:     number
  /** Count of AVAILABLE MenuItem carried by those attached brands only (D11). */
  availableDishCount?:     number

  // ── Affiliate signals (Agent 98) — read-only, derived from the EXISTING Affiliate entity
  //    + the operator's stored payout/fiscal fields. OPTIONAL by design: ONLY the 'affiliate'
  //    definition reads them; the 'restaurant' definition and its required fields above are
  //    untouched (strict equivalence). The guide never moves money — these mirror state only.
  /** Affiliate row exists and is active (the referral link is live). */
  affiliateActive?:       boolean
  /** Payout Connect 'active' AND the DAC7 fiscal self-declaration is complete (read-only
   *  mirror of stored fields; the actual withdrawal stays /api/affiliate/withdraw). */
  affiliateWithdrawReady?: boolean

  // ── Creator signals (Agent 100) — read-only, derived from the EXISTING Creator entity.
  //    OPTIONAL by design: ONLY the 'creator' definition reads them; the 'restaurant' and
  //    'affiliate' definitions and their required fields above are untouched (equivalence).
  /** Creator public profile complete (name is mandatory at signup; a bio is filled). */
  creatorProfileComplete?: boolean
  /** Creator payout Connect 'active' (identity + bank done) — read-only mirror of the stored
   *  Creator.payoutStatus; the guide moves no money and the creator-payout rail is untouched. */
  creatorPayoutReady?: boolean

  // ── Supplier signals (Agent 103) — read-only, derived from the EXISTING SupplierProfile.
  //    OPTIONAL by design: ONLY the 'supplier' definition reads them; the restaurant/affiliate/
  //    creator definitions and their required fields above are untouched (equivalence ×3).
  /** SupplierProfile.verificationStatus === 'verified' (SIREN/KYB checked against the registry). */
  supplierCompanyVerified?: boolean
  /** At least one SupplierCatalogItem exists (the catalogue has a product). */
  supplierCatalogueReady?: boolean
  /** Supplier payout Connect 'active' (identity + bank done) — read-only mirror of the stored
   *  SupplierProfile.payoutStatus; the guide moves no money and the supplier rail is untouched. */
  supplierPayoutReady?: boolean

  // ── Prestataire signals (Agent 104) — read-only, derived from the EXISTING PrestataireProfile.
  //    OPTIONAL by design: ONLY the 'prestataire' definition reads them; the 4 other definitions
  //    and their required fields above are untouched (equivalence ×4).
  /** At least one service category is declared (the service profile is filled). */
  prestataireProfileComplete?: boolean
  /** PrestataireProfile.verificationStatus === 'verified' (SIREN/KYB checked against the registry). */
  prestataireCompanyVerified?: boolean
  /** Prestataire payout Connect 'active' (identity + bank done) — read-only mirror of the stored
   *  PrestataireProfile.payoutStatus; the guide moves no money and the prestataire rail is untouched. */
  prestatairePayoutReady?: boolean

  // ── Franchisor signals (Agent 105) — read-only, derived from the EXISTING franchise state on the
  //    Operator (account-level KYB) + the operator's franchisable Brand(s). OPTIONAL by design: ONLY
  //    the 'franchisor' definition reads them; the 5 other definitions and their required fields above
  //    are untouched (equivalence ×5). MONEY-ADJACENT role: these mirror state only — never a royalty
  //    amount/rate, never a write, and the franchise money rail (settlement/royalty/refund) is untouched.
  /** Operator.kybStatus === 'verified' (account-level SIREN/KYB checked — Grubano/server-side). */
  franchisorCompanyVerified?: boolean
  /** At least one Brand owned by the operator is opened to franchising (Brand.openToFranchise) —
   *  the franchise model (brand + royalty terms) is configured. NO royalty amount is read. */
  franchisorFranchiseConfigured?: boolean
  /** Franchise payout Connect 'active' (identity + bank done) — read-only mirror of the stored
   *  Operator.franchisePayoutStatus; the guide moves no money and the franchise rail is untouched. */
  franchisorPayoutReady?: boolean
}

// ── Restaurateur definition (the 6 steps, mapped to the 4 gates) ──────────────
// NB: the restaurateur has NO company (SIREN) verification today → there is NO
// SIREN step here (that lands in B1.1). The "publish" gate is completeness
// (menu) + admin approval, exactly as the server enforces it.
function restaurantSteps(s: ChecklistSignals): ChecklistStep[] {
  const establishmentDone = s.hasBrand && s.hasRestaurant
  const menuDone          = establishmentDone && s.menuItemCount >= 1
  const published         = s.isActive

  // 1 — Compte créé (P0). Owner-only endpoint ⇒ the account exists; 'active'
  // is required to sign in at all, so this is normally done.
  const account: ChecklistStep = {
    id: 'account', gate: 0,
    titleKey: 'steps.account.title',
    descriptionKey: 'steps.account.desc',
    state: s.accountActive ? 'done' : 'current',
  }

  // 2 — Créer votre établissement (P1).
  const establishment: ChecklistStep = {
    id: 'establishment', gate: 1,
    titleKey: 'steps.establishment.title',
    descriptionKey: 'steps.establishment.desc',
    state: establishmentDone ? 'done' : 'current',
    ...(establishmentDone
      ? {}
      : { ctaKey: 'steps.establishment.cta', ctaHref: '/business/onboarding' }),
  }

  // 3 — Composer le menu & compléter l'établissement (P1→P2).
  const menu: ChecklistStep = {
    id: 'menu', gate: 1,
    titleKey: 'steps.menu.title',
    descriptionKey: 'steps.menu.desc',
    state: !establishmentDone ? 'locked' : menuDone ? 'done' : 'current',
    ...(!establishmentDone
      ? { blockedReasonKey: 'blocked.needEstablishment' }
      : menuDone
        ? {}
        : { ctaKey: 'steps.menu.cta', ctaHref: '/menu' }),
  }

  // 4 — Mise en ligne (P2). ADMIN-ONLY publication (SEC1): never a publish CTA
  // for the owner. Complete-but-unpublished → read-only "awaiting validation".
  let publishStep: ChecklistStep
  if (published) {
    publishStep = {
      id: 'publish', gate: 2,
      titleKey: 'steps.publish.title',
      descriptionKey: 'steps.publish.descOnline',
      state: 'done',
    }
  } else if (menuDone) {
    publishStep = {
      id: 'publish', gate: 2,
      titleKey: 'steps.publish.title',
      descriptionKey: 'steps.publish.descAwaiting',
      state: 'current',
      blockedReasonKey: 'blocked.awaitingApproval',
    }
  } else {
    publishStep = {
      id: 'publish', gate: 2,
      titleKey: 'steps.publish.title',
      descriptionKey: 'steps.publish.descLocked',
      state: 'locked',
      blockedReasonKey: 'blocked.completeMenuFirst',
    }
  }

  // 5 — Activer les paiements (P3). Read-only mirror of stripeAccountStatus;
  // the CTA opens the EXISTING finance/connect page (no payment logic here).
  const payments: ChecklistStep = {
    id: 'payments', gate: 3,
    titleKey: 'steps.payments.title',
    descriptionKey: 'steps.payments.desc',
    state: s.stripeConnected ? 'done' : published ? 'current' : 'todo',
    ...(s.stripeConnected
      ? {}
      : { ctaKey: 'steps.payments.cta', ctaHref: '/finance' }),
  }

  // 6 — Recevoir vos virements (P4). Derived from the SAME Stripe status (no new
  // field invented): an active Connect account has Stripe's automatic payouts on.
  // Manual IBAN / withdrawal UI is a future brick (Phase 4) — not promised here.
  const payouts: ChecklistStep = s.stripeConnected
    ? {
        id: 'payouts', gate: 4,
        titleKey: 'steps.payouts.title',
        descriptionKey: 'steps.payouts.descActive',
        state: 'done',
      }
    : {
        id: 'payouts', gate: 4,
        titleKey: 'steps.payouts.title',
        descriptionKey: 'steps.payouts.descLocked',
        state: 'locked',
        blockedReasonKey: 'blocked.activatePaymentsFirst',
      }

  return [account, establishment, menu, publishStep, payments, payouts]
}

// ── Affiliate definition (Agent 98) — 3 steps, per « Informations par partenaire » ───
// Doctrine "lien instantané" : signup = name+email (done) ; the referral link is INSTANT
// (nothing to do to start earning) ; identity + bank + fiscal are DEFERRED, required ONLY at
// the 1st withdrawal (threshold). So earning starts at 0€ and the "prepare your withdrawals"
// step is a NON-BLOCKING 'todo' (never gates the start). READ-ONLY: every state is derived
// from the EXISTING Affiliate entity + the operator's stored payout/fiscal fields — never a
// recomputed money value, never a write, and the affiliate withdrawal rail is untouched.
function affiliateSteps(s: ChecklistSignals): ChecklistStep[] {
  // 1 — Compte créé (P0). The affiliate is granted at signup; an active session ⇒ done.
  const account: ChecklistStep = {
    id: 'account', gate: 0,
    titleKey: 'steps.affiliateAccount.title',
    descriptionKey: 'steps.affiliateAccount.desc',
    state: s.accountActive ? 'done' : 'current',
  }

  // 2 — Lien d'affiliation actif (P1). Instant at signup → normally done. If the row is
  //     somehow inactive, point back to the dashboard (no money action).
  const link: ChecklistStep = {
    id: 'affiliateLink', gate: 1,
    titleKey: 'steps.affiliateLink.title',
    descriptionKey: 'steps.affiliateLink.desc',
    state: s.affiliateActive ? 'done' : 'current',
    ...(s.affiliateActive ? {} : { ctaKey: 'steps.affiliateLink.cta', ctaHref: '/affiliate/dashboard' }),
  }

  // 3 — Préparer ses retraits (P2). DEFERRED + NON-BLOCKING: identity + bank + fiscal are
  //     needed ONLY to withdraw, never to earn. So this is a 'todo' with a CTA (never
  //     'locked'/'current') until the affiliate is withdraw-ready. The CTA opens the EXISTING
  //     dashboard withdrawal section — the guide itself moves no money.
  const withdraw: ChecklistStep = s.affiliateWithdrawReady
    ? {
        id: 'affiliateWithdraw', gate: 2,
        titleKey: 'steps.affiliateWithdraw.title',
        descriptionKey: 'steps.affiliateWithdraw.descReady',
        state: 'done',
      }
    : {
        id: 'affiliateWithdraw', gate: 2,
        titleKey: 'steps.affiliateWithdraw.title',
        descriptionKey: 'steps.affiliateWithdraw.descTodo',
        state: 'todo',
        ctaKey: 'steps.affiliateWithdraw.cta',
        ctaHref: '/affiliate/dashboard',
      }

  return [account, link, withdraw]
}

// ── Creator definition (Agent 100) — 3 steps, per « Informations par partenaire » ────
// Calque of the affiliate journey: signup = name+email (done); the PUBLIC PROFILE (name +
// bio) comes before publishing; identity + bank are DEFERRED, required ONLY to be PAID (before
// earnings/withdrawal). So the "get paid" step is a NON-BLOCKING 'todo' (never gates the start).
// READ-ONLY: every state is derived from the EXISTING Creator entity (bio filled? payout Connect
// active?) — never a recomputed money value, never a write, and the creator-payout rail is
// untouched. Mirrors restaurantSteps/affiliateSteps; adds 'creator' WITHOUT touching them.
function creatorSteps(s: ChecklistSignals): ChecklistStep[] {
  // 1 — Compte créé (P0). An active session ⇒ done.
  const account: ChecklistStep = {
    id: 'account', gate: 0,
    titleKey: 'steps.creatorAccount.title',
    descriptionKey: 'steps.creatorAccount.desc',
    state: s.accountActive ? 'done' : 'current',
  }

  // 2 — Compléter le profil public (nom, bio) (P1). The active frontier until the bio is set.
  const profile: ChecklistStep = {
    id: 'creatorProfile', gate: 1,
    titleKey: 'steps.creatorProfile.title',
    descriptionKey: 'steps.creatorProfile.desc',
    state: s.creatorProfileComplete ? 'done' : 'current',
    ...(s.creatorProfileComplete
      ? {}
      : { ctaKey: 'steps.creatorProfile.cta', ctaHref: '/creators/dashboard/parametres' }),
  }

  // 3 — Être payé : identité + banque (P2). DEFERRED + NON-BLOCKING: needed ONLY to be paid,
  //     never to start. So a 'todo' with a CTA (never 'locked'/'current') until payout-ready.
  //     The CTA opens the EXISTING revenue/Connect page — the guide itself moves no money.
  const payout: ChecklistStep = s.creatorPayoutReady
    ? {
        id: 'creatorPayout', gate: 2,
        titleKey: 'steps.creatorPayout.title',
        descriptionKey: 'steps.creatorPayout.descReady',
        state: 'done',
      }
    : {
        id: 'creatorPayout', gate: 2,
        titleKey: 'steps.creatorPayout.title',
        descriptionKey: 'steps.creatorPayout.descTodo',
        state: 'todo',
        ctaKey: 'steps.creatorPayout.cta',
        ctaHref: '/creators/dashboard/revenus',
      }

  return [account, profile, payout]
}

// ── Supplier definition (Agent 103) — 4 steps, per « Informations par partenaire » ───
// Doctrine: signup = name+email (done) ; the COMPANY is verified first (SIREN/KYB, instant
// against the official registry) ; THEN the catalogue (gated behind verification, mirroring the
// restaurateur's menu-after-establishment) ; identity + bank are DEFERRED, required ONLY to be
// PAID. So the "get paid" step is a NON-BLOCKING 'todo'. READ-ONLY: every state is derived from
// the EXISTING SupplierProfile (verificationStatus / catalogue count / payoutStatus) — never a
// recomputed money value, never a write, and the supplier payment rail is untouched.
function supplierSteps(s: ChecklistSignals): ChecklistStep[] {
  // 1 — Compte créé (P0). An active session ⇒ done.
  const account: ChecklistStep = {
    id: 'account', gate: 0,
    titleKey: 'steps.supplierAccount.title',
    descriptionKey: 'steps.supplierAccount.desc',
    state: s.accountActive ? 'done' : 'current',
  }

  // 2 — Vérifier l'entreprise (SIREN) (P1). The active frontier until the registry check passes.
  const company: ChecklistStep = {
    id: 'supplierCompany', gate: 1,
    titleKey: 'steps.supplierCompany.title',
    descriptionKey: 'steps.supplierCompany.desc',
    state: s.supplierCompanyVerified ? 'done' : 'current',
    ...(s.supplierCompanyVerified
      ? {}
      : { ctaKey: 'steps.supplierCompany.cta', ctaHref: '/supplier/dashboard/profil' }),
  }

  // 3 — Créer le catalogue (P2). LOCKED until the company is verified (SIREN d'abord, puis
  //     catalogue), mirroring the restaurateur's menu-locked-until-establishment.
  const catalogue: ChecklistStep = {
    id: 'supplierCatalogue', gate: 2,
    titleKey: 'steps.supplierCatalogue.title',
    descriptionKey: 'steps.supplierCatalogue.desc',
    state: !s.supplierCompanyVerified
      ? 'locked'
      : s.supplierCatalogueReady ? 'done' : 'current',
    ...(!s.supplierCompanyVerified
      ? { blockedReasonKey: 'blocked.supplierVerifyCompanyFirst' }
      : s.supplierCatalogueReady
        ? {}
        : { ctaKey: 'steps.supplierCatalogue.cta', ctaHref: '/supplier/catalog' }),
  }

  // 4 — Être payé : identité + banque (P3). DEFERRED + NON-BLOCKING: needed ONLY to be paid,
  //     never to start selling. A 'todo' with a CTA (never 'locked'/'current') until payout-ready.
  //     The CTA opens the EXISTING supplier dashboard (Connect card) — the guide moves no money.
  const payout: ChecklistStep = s.supplierPayoutReady
    ? {
        id: 'supplierPayout', gate: 3,
        titleKey: 'steps.supplierPayout.title',
        descriptionKey: 'steps.supplierPayout.descReady',
        state: 'done',
      }
    : {
        id: 'supplierPayout', gate: 3,
        titleKey: 'steps.supplierPayout.title',
        descriptionKey: 'steps.supplierPayout.descTodo',
        state: 'todo',
        ctaKey: 'steps.supplierPayout.cta',
        ctaHref: '/supplier/dashboard',
      }

  return [account, company, catalogue, payout]
}

// ── Prestataire definition (Agent 104) — 4 steps, per « Informations par partenaire » ──
// Doctrine: signup = name+email (done) ; complete the SERVICE PROFILE (category) ; verify the
// COMPANY (SIREN/KYB, instant against the registry — usually already done at registration) ;
// identity + bank are DEFERRED, required ONLY to be PAID. The company step is a 'todo' until the
// profile is filled (the service profile is the first frontier), then 'current'; it is NEVER
// locked (verification is independent and often already passed). The "get paid" step is a
// NON-BLOCKING 'todo'. READ-ONLY: every state is derived from the EXISTING PrestataireProfile
// (serviceCategories / verificationStatus / payoutStatus) — never a recomputed money value, never
// a write, and the prestataire payment rail is untouched.
function prestataireSteps(s: ChecklistSignals): ChecklistStep[] {
  // 1 — Compte créé (P0). An active session ⇒ done.
  const account: ChecklistStep = {
    id: 'account', gate: 0,
    titleKey: 'steps.prestataireAccount.title',
    descriptionKey: 'steps.prestataireAccount.desc',
    state: s.accountActive ? 'done' : 'current',
  }

  // 2 — Compléter le profil de service (catégorie) (P1). The first active frontier.
  const profile: ChecklistStep = {
    id: 'prestataireProfile', gate: 1,
    titleKey: 'steps.prestataireProfile.title',
    descriptionKey: 'steps.prestataireProfile.desc',
    state: s.prestataireProfileComplete ? 'done' : 'current',
    ...(s.prestataireProfileComplete
      ? {}
      : { ctaKey: 'steps.prestataireProfile.cta', ctaHref: '/prestataire/dashboard/profil' }),
  }

  // 3 — Vérifier l'entreprise (SIREN/KYB) (P2). Done once the registry check passes (usually at
  //     registration). NOT locked — independent of the profile; it is a 'todo' until the profile
  //     is filled (so the profile is the single frontier first), then 'current'.
  const company: ChecklistStep = {
    id: 'prestataireCompany', gate: 2,
    titleKey: 'steps.prestataireCompany.title',
    descriptionKey: 'steps.prestataireCompany.desc',
    state: s.prestataireCompanyVerified
      ? 'done'
      : s.prestataireProfileComplete ? 'current' : 'todo',
    ...(s.prestataireCompanyVerified
      ? {}
      : { ctaKey: 'steps.prestataireCompany.cta', ctaHref: '/prestataire/dashboard/profil' }),
  }

  // 4 — Être payé : identité + banque (P3). DEFERRED + NON-BLOCKING: needed ONLY to be paid, never
  //     to start. A 'todo' with a CTA (never 'locked'/'current') until payout-ready. The CTA opens
  //     the EXISTING prestataire dashboard (Connect card) — the guide moves no money.
  const payout: ChecklistStep = s.prestatairePayoutReady
    ? {
        id: 'prestatairePayout', gate: 3,
        titleKey: 'steps.prestatairePayout.title',
        descriptionKey: 'steps.prestatairePayout.descReady',
        state: 'done',
      }
    : {
        id: 'prestatairePayout', gate: 3,
        titleKey: 'steps.prestatairePayout.title',
        descriptionKey: 'steps.prestatairePayout.descTodo',
        state: 'todo',
        ctaKey: 'steps.prestatairePayout.cta',
        ctaHref: '/prestataire/dashboard',
      }

  return [account, profile, company, payout]
}

// ── Franchisor definition (Agent 105) — 4 steps, per « Informations par partenaire » ──
// The franchisor is the brand owner who franchises their concept. Doctrine: signup = name+email
// (done) ; the COMPANY (SIREN/KYB) is verified Grubano/server-side ; CONFIGURE the franchise (open a
// brand to franchising = brand + royalty model + standards) ; identity + bank are DEFERRED, required
// ONLY to RECEIVE royalties. MONEY-ADJACENT role, but this is READ-ONLY: every state is derived from
// the EXISTING franchise state (Operator.kybStatus, a franchisable Brand, Operator.franchisePayoutStatus)
// — never a recomputed royalty value, never a write, and the franchise money rail (settlement / royalty
// / refund) is untouched. The company step is Grubano-side → it carries NO CTA (it mirrors the
// restaurant "awaiting validation" pattern); the "receive royalties" step is a NON-BLOCKING 'todo'.
function franchisorSteps(s: ChecklistSignals): ChecklistStep[] {
  // 1 — Compte créé (P0). An active session ⇒ done.
  const account: ChecklistStep = {
    id: 'account', gate: 0,
    titleKey: 'steps.franchisorAccount.title',
    descriptionKey: 'steps.franchisorAccount.desc',
    state: s.accountActive ? 'done' : 'current',
  }

  // 2 — Vérifier l'entreprise (SIREN/KYB) (P1). Grubano/server-side verification (no self-service
  //     KYB page today) → NO CTA: shown as an in-progress frontier until verified, exactly like the
  //     restaurant "publish — awaiting validation" step. deriveOnboardingProgress skips CTA-less
  //     steps for "Reprendre", so the resume button points at the next ACTIONABLE step.
  const company: ChecklistStep = s.franchisorCompanyVerified
    ? {
        id: 'franchisorCompany', gate: 1,
        titleKey: 'steps.franchisorCompany.title',
        descriptionKey: 'steps.franchisorCompany.descVerified',
        state: 'done',
      }
    : {
        id: 'franchisorCompany', gate: 1,
        titleKey: 'steps.franchisorCompany.title',
        descriptionKey: 'steps.franchisorCompany.descReview',
        state: 'current',
      }

  // 3 — Configurer la franchise : marque + modèle de royalties + standards (P2). The actionable
  //     frontier. Done once at least one brand is opened to franchising. CTA opens the EXISTING
  //     franchisor establishments screen — the guide configures nothing and reads no royalty value.
  const franchise: ChecklistStep = {
    id: 'franchisorFranchise', gate: 2,
    titleKey: 'steps.franchisorFranchise.title',
    descriptionKey: s.franchisorFranchiseConfigured
      ? 'steps.franchisorFranchise.descDone'
      : 'steps.franchisorFranchise.descTodo',
    state: s.franchisorFranchiseConfigured ? 'done' : 'current',
    ...(s.franchisorFranchiseConfigured
      ? {}
      : { ctaKey: 'steps.franchisorFranchise.cta', ctaHref: '/franchise/dashboard/etablissements' }),
  }

  // 4 — Pour recevoir vos royalties : identité + banque (P3). DEFERRED + NON-BLOCKING: needed ONLY
  //     to be paid, never to operate. A 'todo' with a CTA (never 'locked'/'current') until payout-ready.
  //     The CTA opens the EXISTING franchise finances page — the guide moves no money.
  const payout: ChecklistStep = s.franchisorPayoutReady
    ? {
        id: 'franchisorPayout', gate: 3,
        titleKey: 'steps.franchisorPayout.title',
        descriptionKey: 'steps.franchisorPayout.descReady',
        state: 'done',
      }
    : {
        id: 'franchisorPayout', gate: 3,
        titleKey: 'steps.franchisorPayout.title',
        descriptionKey: 'steps.franchisorPayout.descTodo',
        state: 'todo',
        ctaKey: 'steps.franchisorPayout.cta',
        ctaHref: '/franchise/dashboard/finances',
      }

  return [account, company, franchise, payout]
}

/** Per-role step builders. Add other roles here without touching the core. */
const DEFINITIONS: Record<string, (s: ChecklistSignals) => ChecklistStep[]> = {
  restaurant:  restaurantSteps,
  affiliate:   affiliateSteps,
  creator:     creatorSteps,
  supplier:    supplierSteps,
  prestataire: prestataireSteps,
  franchisor:  franchisorSteps,
}

/** Roles that currently have a checklist definition. */
export function hasChecklistDefinition(role: string): boolean {
  return role in DEFINITIONS
}

/**
 * Build the activation checklist for a role from already-loaded signals.
 * PURE: no I/O. An unknown role yields an empty, non-discovery checklist
 * (safe default — nothing to nag about).
 */
export function buildActivationChecklist(role: string, signals: ChecklistSignals): ActivationChecklist {
  const def = DEFINITIONS[role]
  if (!def) {
    return { role, steps: [], progressPct: 100, currentStepId: null, isDiscovery: false }
  }

  const steps = def(signals)
  const total = steps.length
  const done  = steps.filter((st) => st.state === 'done').length
  const progressPct = total === 0 ? 100 : Math.round((done / total) * 100)

  const current =
    steps.find((st) => st.state === 'current') ??
    steps.find((st) => st.state === 'todo') ??
    steps.find((st) => st.state === 'locked') ??
    null

  const isDiscovery = steps.some((st) => st.state !== 'done')

  return {
    role, steps, progressPct, currentStepId: current?.id ?? null, isDiscovery,
    ...namedOutputs(role, signals),
  }
}

/**
 * Contract v1.1 NAMED OUTPUTS (mission CA) — computed OUTSIDE the step list so
 * the six steps, their order, their gates and progressPct are byte-identical to
 * before. Only roles whose contract carries a state/capacity get a value; every
 * other role gets `undefined` (the key is absent from the object).
 *
 * ⚠️ ONLY the two outputs authorised by mission CA are produced here:
 *   • prepared  — PRÉPARÉ, condition « l'établissement est créé » (B2).
 *   • cardReady — CARTE PRÊTE, value + reason (B1), per establishment (D11).
 * Opérationnel, Approuvé, Publié, Demande de publication, Encaissement and
 * Retrait are NOT produced: their conditions are either arbitrated away
 * (B3/B4), ambiguous, or deferred to the financial model. A capacity that
 * cannot be computed is not emitted — never approximated (authority ④).
 */
function namedOutputs(role: string, s: ChecklistSignals): Partial<ActivationChecklist> {
  if (role !== 'restaurant') return {}

  // PRÉPARÉ — the establishment exists. The brand is deliberately NOT a
  // condition here (founder arbitration B2, Contract v1.1 §2).
  const prepared = s.hasRestaurant

  // CARTE PRÊTE — emitted ONLY when the caller measured the per-establishment
  // signals. Undefined signals mean "not measured", never "false".
  const measured =
    typeof s.attachedBrandCount === 'number' && typeof s.availableDishCount === 'number'
  if (!measured) return { prepared }

  const reason: CardReadyReason | null =
    !s.hasRestaurant            ? 'no_establishment'
      : s.attachedBrandCount === 0 ? 'no_attached_brand'
        : s.availableDishCount === 0 ? 'no_available_dish'
          : null

  return { prepared, cardReady: { value: reason === null, reason } }
}
