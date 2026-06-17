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

export interface ActivationChecklist {
  role:          string
  steps:         ChecklistStep[]
  /** Share of steps in state 'done', 0–100 (rounded). */
  progressPct:   number
  /** The step the partner is on (first 'current', else first 'todo'/'locked'). */
  currentStepId: string | null
  /** True while at least one step is not done → UI shows the discovery banner. */
  isDiscovery:   boolean
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

/** Per-role step builders. Add other roles here without touching the core. */
const DEFINITIONS: Record<string, (s: ChecklistSignals) => ChecklistStep[]> = {
  restaurant: restaurantSteps,
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

  return { role, steps, progressPct, currentStepId: current?.id ?? null, isDiscovery }
}
