import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { readOperatorRoles } from '@/lib/operator-roles'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import {
  buildActivationChecklist,
  hasChecklistDefinition,
  type ChecklistSignals,
} from '@/lib/activation-checklist'

export const dynamic = 'force-dynamic'

/**
 * GET /api/business/activation
 *   → 401 if not signed in
 *   → 200 { ok, role, checklist } where checklist = the derived activation
 *     journey for the connected operator.
 *
 * READ-ONLY + OWNER-ONLY: the operator is resolved from the SESSION (email →
 * Operator), never from a client-supplied id, so there is no IDOR. It loads only
 * EXISTING signals (brand/restaurant/menu/Stripe status), computes the checklist
 * in memory via the pure engine, and returns it. No write, no payment logic, no
 * schema dependency. The checklist mirrors the SEC1 publication lock (no owner
 * publish action).
 *
 * v1 ships the 'restaurant' definition. A connected partner without the
 * restaurant role gets an empty (non-discovery) checklist — nothing to nag.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })
    }

    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true, status: true, emailVerifiedAt: true },
    })
    if (!operator) {
      return NextResponse.json({ ok: false, error: 'Utilisateur introuvable' }, { status: 401 })
    }

    // Resolve which checklist to build. v1 = restaurateur: show it when the
    // operator actually holds the restaurant role (primary OR cumulative set),
    // mirroring /api/business/me which keys onboarding off the restaurant role.
    const roles = await readOperatorRoles(operator.id, operator.role)

    // ── Role-aware surface (Agent 98, ADDITIVE) — the guide on the affiliate dashboard
    //    requests ?role=affiliate. Served ONLY when the operator actually holds the
    //    affiliate role (owner-scoped) and AFFILIATE_ENABLED is on; otherwise an empty,
    //    non-discovery checklist (no guide). READ-ONLY: signals come from the EXISTING
    //    Affiliate entity + the operator's stored payout/fiscal fields (NO Stripe sync, NO
    //    money). When no ?role param is sent, the RESTAURANT path below runs UNCHANGED.
    if (new URL(req.url).searchParams.get('role') === 'affiliate') {
      return affiliateActivation(operator.id, operator.status === 'active', roles.includes('affiliate'))
    }

    // ── Creator surface (Agent 100, ADDITIVE — calque of the affiliate branch) — the guide on
    //    the creator dashboard requests ?role=creator. Served owner-scoped (Creator resolved by
    //    the SESSION email; a non-creator gets an empty, non-discovery checklist). READ-ONLY:
    //    signals come from the EXISTING Creator entity (no money, no write; the creator-payout
    //    rail is untouched). The affiliate branch above + the restaurant path below are UNCHANGED.
    if (new URL(req.url).searchParams.get('role') === 'creator') {
      return creatorActivation(session.user.email, operator.status === 'active')
    }

    // ── Supplier surface (Agent 103, ADDITIVE — calque of the creator branch) — the guide on
    //    the supplier dashboard requests ?role=supplier. Served owner-scoped (SupplierProfile
    //    resolved by the SESSION email; a non-supplier gets an empty, non-discovery checklist).
    //    READ-ONLY: signals come from the EXISTING SupplierProfile (no money, no write; the
    //    supplier payment rail is untouched). The branches above + the restaurant path below are UNCHANGED.
    if (new URL(req.url).searchParams.get('role') === 'supplier') {
      return supplierActivation(session.user.email, operator.status === 'active')
    }

    // ── Prestataire surface (Agent 104, ADDITIVE — calque of the supplier branch) — the guide on
    //    the prestataire dashboard requests ?role=prestataire. Served owner-scoped (PrestataireProfile
    //    resolved by the SESSION email; a non-prestataire gets an empty, non-discovery checklist).
    //    READ-ONLY: signals come from the EXISTING PrestataireProfile (no money, no write; the
    //    prestataire payment rail is untouched). The branches above + the restaurant path below are UNCHANGED.
    if (new URL(req.url).searchParams.get('role') === 'prestataire') {
      return prestataireActivation(session.user.email, operator.status === 'active')
    }

    // ── Franchisor surface (Agent 105, ADDITIVE — calque of the prestataire branch) — the guide on
    //    the franchisor dashboard requests ?role=franchisor. The franchisor is operator-keyed (the
    //    role STRING is 'franchise'); served ONLY when the operator actually holds that role
    //    (owner-scoped, like the affiliate branch); otherwise an empty, non-discovery checklist (no
    //    guide). READ-ONLY + MONEY-ADJACENT: signals come from the EXISTING franchise state (Operator
    //    KYB + a franchisable Brand + stored franchise payout status) — NO royalty amount, NO Stripe
    //    sync, NO write; the franchise money rail (settlement/royalty/refund) is untouched. The
    //    branches above + the restaurant path below are UNCHANGED.
    if (new URL(req.url).searchParams.get('role') === 'franchisor') {
      return franchisorActivation(operator.id, operator.status === 'active', roles.includes('franchise'))
    }

    const role  = roles.includes('restaurant') ? 'restaurant' : operator.role

    // No definition for this role yet (e.g. a pure creator/supplier on the
    // dashboard) → empty, non-discovery checklist. Skip the resto-scoped reads.
    if (!hasChecklistDefinition(role)) {
      return NextResponse.json({
        ok: true,
        role,
        checklist: buildActivationChecklist(role, {
          accountActive: operator.status === 'active',
          hasBrand: false, hasRestaurant: false, menuItemCount: 0,
          isActive: false, stripeConnected: false, stripeStatus: null,
        }),
      })
    }

    // Restaurateur signals — existing fields only, owner-scoped.
    const [brand, restaurant, menuItemCount] = await Promise.all([
      prisma.brand.findFirst({ where: { operatorId: operator.id }, select: { id: true } }),
      prisma.restaurant.findFirst({
        where:  { operatorId: operator.id, archivedAt: null },
        select: { id: true, isActive: true, stripeAccountStatus: true },
      }),
      prisma.menuItem.count({ where: { brand: { operatorId: operator.id } } }),
    ])

    const signals: ChecklistSignals = {
      accountActive:   operator.status === 'active',
      emailVerified:   operator.emailVerifiedAt !== null,
      hasBrand:        brand !== null,
      hasRestaurant:   restaurant !== null,
      menuItemCount,
      isActive:        restaurant?.isActive ?? false,
      stripeConnected: restaurant?.stripeAccountStatus === 'active',
      stripeStatus:    restaurant?.stripeAccountStatus ?? null,
    }

    return NextResponse.json({
      ok: true,
      role,
      checklist: buildActivationChecklist(role, signals),
    })
  } catch (err) {
    console.error('[GET /api/business/activation]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── Affiliate activation (Agent 98) — owner-scoped, READ-ONLY ─────────────────────────
// The empty (non-discovery) checklist is returned when the affiliate surface is off or the
// operator is not an affiliate → the guide renders nothing. Otherwise signals are derived
// from the EXISTING Affiliate entity + the operator's STORED payout/fiscal fields (no Stripe
// sync, no money movement; the withdrawal rail /api/affiliate/withdraw is never touched).
const EMPTY_AFFILIATE = {
  role: 'affiliate', steps: [] as never[], progressPct: 100, currentStepId: null, isDiscovery: false,
}

/** DAC7 self-declaration complete enough to withdraw (read-only mirror of the withdraw rail's
 *  own check — replicated here so that route stays byte-identical; no money, no Stripe). */
function affiliateFiscalComplete(op: {
  registeredAddress: string | null; taxId: string | null
  taxIdCountry: string | null; sellerType: string | null; dateOfBirth: Date | null
}): boolean {
  if (!op.registeredAddress || !op.taxId || !op.taxIdCountry || !op.sellerType) return false
  if (op.sellerType === 'individual' && !op.dateOfBirth) return false
  return true
}

async function affiliateActivation(operatorId: string, accountActive: boolean, hasAffiliateRole: boolean) {
  if (!isAffiliateEnabled() || !hasAffiliateRole) {
    return NextResponse.json({ ok: true, role: 'affiliate', checklist: EMPTY_AFFILIATE })
  }

  // Owner-scoped reads (operatorId from the SESSION, never a client value).
  const affiliate = await getAffiliateByOperator(operatorId)
  const payoutOp  = await prisma.operator.findUnique({
    where:  { id: operatorId },
    select: {
      affiliatePayoutStatus: true,
      registeredAddress: true, taxId: true, taxIdCountry: true, sellerType: true, dateOfBirth: true,
    },
  })

  const signals: ChecklistSignals = {
    accountActive,
    // Required restaurant fields are neutral placeholders — the 'affiliate' definition ignores them.
    hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
    affiliateActive:        affiliate?.status === 'active',
    affiliateWithdrawReady: payoutOp?.affiliatePayoutStatus === 'active' && affiliateFiscalComplete({
      registeredAddress: payoutOp?.registeredAddress ?? null,
      taxId:             payoutOp?.taxId ?? null,
      taxIdCountry:      payoutOp?.taxIdCountry ?? null,
      sellerType:        payoutOp?.sellerType ?? null,
      dateOfBirth:       payoutOp?.dateOfBirth ?? null,
    }),
  }

  return NextResponse.json({ ok: true, role: 'affiliate', checklist: buildActivationChecklist('affiliate', signals) })
}

// ── Creator activation (Agent 100) — owner-scoped, READ-ONLY (calque of affiliateActivation) ──
// The empty (non-discovery) checklist is returned when the session user is not a creator → the
// guide renders nothing. Otherwise signals are derived from the EXISTING Creator entity (public
// profile filled? payout Connect active?) — no money, no write, the creator-payout rail untouched.
const EMPTY_CREATOR = {
  role: 'creator', steps: [] as never[], progressPct: 100, currentStepId: null, isDiscovery: false,
}

async function creatorActivation(email: string, accountActive: boolean) {
  // Owner-scoped: the Creator is resolved from the SESSION email (never a client value), the
  // same way /api/creators/home does. No creator row → empty checklist (no cross-role leak).
  const creator = await prisma.creator.findUnique({
    where:  { email },
    select: { id: true, bio: true, payoutStatus: true },
  })
  if (!creator) {
    return NextResponse.json({ ok: true, role: 'creator', checklist: EMPTY_CREATOR })
  }

  const signals: ChecklistSignals = {
    accountActive,
    // Required restaurant fields are neutral placeholders — the 'creator' definition ignores them.
    hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
    creatorProfileComplete: !!creator.bio && creator.bio.trim().length > 0,
    creatorPayoutReady:     creator.payoutStatus === 'active',
  }

  return NextResponse.json({ ok: true, role: 'creator', checklist: buildActivationChecklist('creator', signals) })
}

// ── Supplier activation (Agent 103) — owner-scoped, READ-ONLY (calque of creatorActivation) ──
// Empty (non-discovery) checklist when the session user is not a supplier → the guide renders
// nothing. Otherwise signals come from the EXISTING SupplierProfile (SIREN/KYB verified? catalogue
// has a product? payout Connect active?) — no money, no write; the supplier payment rail untouched.
const EMPTY_SUPPLIER = {
  role: 'supplier', steps: [] as never[], progressPct: 100, currentStepId: null, isDiscovery: false,
}

async function supplierActivation(email: string, accountActive: boolean) {
  // Owner-scoped: the SupplierProfile is resolved from the SESSION email (never a client value),
  // the same way /supplier/dashboard does. No profile → empty checklist (no cross-role leak).
  const profile = await prisma.supplierProfile.findUnique({
    where:  { email },
    select: { id: true, verificationStatus: true, payoutStatus: true, _count: { select: { catalogItems: true } } },
  })
  if (!profile) {
    return NextResponse.json({ ok: true, role: 'supplier', checklist: EMPTY_SUPPLIER })
  }

  const signals: ChecklistSignals = {
    accountActive,
    // Required restaurant fields are neutral placeholders — the 'supplier' definition ignores them.
    hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
    supplierCompanyVerified: profile.verificationStatus === 'verified',
    supplierCatalogueReady:  (profile._count?.catalogItems ?? 0) >= 1,
    supplierPayoutReady:     profile.payoutStatus === 'active',
  }

  return NextResponse.json({ ok: true, role: 'supplier', checklist: buildActivationChecklist('supplier', signals) })
}

// ── Prestataire activation (Agent 104) — owner-scoped, READ-ONLY (calque of supplierActivation) ──
// Empty (non-discovery) checklist when the session user is not a prestataire → the guide renders
// nothing. Otherwise signals come from the EXISTING PrestataireProfile (service profile filled?
// company verified? payout active?) — no money, no write; the prestataire payment rail untouched.
const EMPTY_PRESTATAIRE = {
  role: 'prestataire', steps: [] as never[], progressPct: 100, currentStepId: null, isDiscovery: false,
}

async function prestataireActivation(email: string, accountActive: boolean) {
  // Owner-scoped: the PrestataireProfile is resolved from the SESSION email (never a client value),
  // the same way /prestataire/dashboard does. No profile → empty checklist (no cross-role leak).
  const profile = await prisma.prestataireProfile.findUnique({
    where:  { email },
    select: { id: true, serviceCategories: true, verificationStatus: true, payoutStatus: true },
  })
  if (!profile) {
    return NextResponse.json({ ok: true, role: 'prestataire', checklist: EMPTY_PRESTATAIRE })
  }

  const categories = Array.isArray(profile.serviceCategories) ? profile.serviceCategories : []

  const signals: ChecklistSignals = {
    accountActive,
    // Required restaurant fields are neutral placeholders — the 'prestataire' definition ignores them.
    hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
    prestataireProfileComplete: categories.length > 0,
    prestataireCompanyVerified: profile.verificationStatus === 'verified',
    prestatairePayoutReady:     profile.payoutStatus === 'active',
  }

  return NextResponse.json({ ok: true, role: 'prestataire', checklist: buildActivationChecklist('prestataire', signals) })
}

// ── Franchisor activation (Agent 105) — owner-scoped, READ-ONLY (calque of affiliateActivation) ──
// Empty (non-discovery) checklist when the operator does not hold the 'franchise' role → the guide
// renders nothing. Otherwise signals come from the EXISTING franchise state on the Operator
// (account-level KYB + a franchisable Brand + the stored franchise payout status) — NO royalty amount
// is read or computed, no Stripe call, no write; the franchise money rail (settlement/royalty/refund)
// is untouched. The franchisor is OPERATOR-keyed (the role string is 'franchise'); operatorId comes
// from the SESSION (never a client value) → no IDOR.
const EMPTY_FRANCHISOR = {
  role: 'franchisor', steps: [] as never[], progressPct: 100, currentStepId: null, isDiscovery: false,
}

async function franchisorActivation(operatorId: string, accountActive: boolean, hasFranchiseRole: boolean) {
  if (!hasFranchiseRole) {
    return NextResponse.json({ ok: true, role: 'franchisor', checklist: EMPTY_FRANCHISOR })
  }

  // Owner-scoped reads (operatorId from the SESSION). Only status mirrors + a membership COUNT —
  // never a royalty amount, never a money-rail call.
  const [op, openBrandCount] = await Promise.all([
    prisma.operator.findUnique({
      where:  { id: operatorId },
      select: { kybStatus: true, franchisePayoutStatus: true },
    }),
    prisma.brand.count({ where: { operatorId, openToFranchise: true } }),
  ])

  const signals: ChecklistSignals = {
    accountActive,
    // Required restaurant fields are neutral placeholders — the 'franchisor' definition ignores them.
    hasBrand: false, hasRestaurant: false, menuItemCount: 0, isActive: false, stripeConnected: false,
    franchisorCompanyVerified:     op?.kybStatus === 'verified',
    franchisorFranchiseConfigured: openBrandCount >= 1,
    franchisorPayoutReady:         op?.franchisePayoutStatus === 'active',
  }

  return NextResponse.json({ ok: true, role: 'franchisor', checklist: buildActivationChecklist('franchisor', signals) })
}
