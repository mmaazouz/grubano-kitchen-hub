import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureSupplierOperator, decideSupplierOutcome } from '@/lib/supplier-account'
import { verifyBusiness } from '@/lib/business-verification'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/supplier/register ───────────────────────────────────────────────
// Self-serve B2B SUPPLIER registration (marketplace offer side, Slice 0). Calqued
// on the partner register flow's anti-enumeration + anti-bot, but PASSWORDLESS:
// the supplier signs in by magic-link (reuses /api/auth/magic-link). It creates a
// `SupplierProfile` (status pending) + provisions a passwordless Operator
// (role='supplier', pending) via the supplier auth bridge. The 'supplier' role
// enters the role SET only at APPROVAL (POST /api/supplier/approve, admin) — never
// here. NO catalogue / pricing (Slice 1+). Singular /api/supplier/* namespace,
// distinct from the operator's plural /api/suppliers (its private directory).

const registerSchema = z.object({
  companyName:     z.string().min(2, 'Nom commercial trop court').max(120),
  contactName:     z.string().min(2, 'Nom du contact trop court').max(80),
  email:           z.string().email('Email invalide'),
  // SIREN (9) or SIRET (14) — spaces tolerated; verified against the official registry.
  siren:           z.string()
                     .transform((s) => s.replace(/\s+/g, ''))
                     .refine((s) => /^\d{9}$/.test(s) || /^\d{14}$/.test(s), 'SIREN (9 chiffres) ou SIRET (14 chiffres) requis'),
  // Agent 111 — lean signup étape 2: the OPERATIONAL/offer fields (city, categories, deliveryZones,
  // paymentTerms) are DEFERRED to the supplier profile (PATCH /api/supplier/profile) — no longer
  // collected at signup. (Agent 109 already deferred phone / minimumOrderEur / leadTimeDays.) The
  // registration now collects ONLY the IDENTITY: companyName + contactName + email + SIREN + consent.
  // The SIREN registry verification (verifyBusiness/lookupRegistry — the authoritative gate) is
  // UNCHANGED; the LLM COHERENCE check (vetSupplier) is MOVED to the catalogue-publication trigger
  // (lib/supplier-coherence), judged on the supplier's REAL offer + catalogue. zod (non-strict)
  // silently strips any deferred key still posted by a stale client.
  consent:         z.boolean().refine((v) => v === true, { message: 'Consentement requis' }),
  // Anti-bot traps (mirror the partner register flow): a filled honeypot or an
  // impossibly fast submit → silent generic OK (no signal to the bot).
  website:         z.string().optional(),
  formStartedAt:   z.number().int().optional(),
})

// Uniform success shape `{ ok, outcome }` for EVERY accepted submission so a bot or
// a duplicate cannot fingerprint its path. 'pending' is the neutral default (anti-bot
// honeypot, too-fast submit, duplicate email); only a FRESH registration returns its
// real vetting outcome ('active' | 'pending' | 'rejected').
type Outcome = 'active' | 'pending' | 'rejected'
function ok(outcome: Outcome) {
  return NextResponse.json({ ok: true, outcome })
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    const data = parsed.data

    // Anti-bot: honeypot filled or submitted in < 2 s → behave like a normal
    // (neutral 'pending') success, never vet, never write.
    if (data.website && data.website.trim() !== '') return ok('pending')
    if (typeof data.formStartedAt === 'number' && Date.now() - data.formStartedAt < 2000) {
      return ok('pending')
    }

    const email = data.email.trim().toLowerCase()

    // CREATE-IF-ABSENT (never overwrite): a PUBLIC endpoint must not let anyone
    // clobber — or re-vet — an existing supplier by re-posting their email. A
    // duplicate just gets the neutral 'pending' response (no state is leaked).
    const existingProfile = await prisma.supplierProfile.findUnique({
      where:  { email },
      select: { id: true },
    })
    if (existingProfile) {
      await ensureSupplierOperator(email, data.contactName || data.companyName, { activate: false })
      return ok('pending')
    }

    // FRESH registration → AUTOMATIC BUSINESS-IDENTITY verification. The official
    // registry (recherche-entreprises.api.gouv.fr) is the authoritative judge of
    // existence + active state; the LLM only fuzzy-matches the declared vs official
    // name. Gates VISIBILITY only — money stays gated by Stripe Connect KYB. FAIL-SAFE:
    // registry unreachable / LLM down → 'review' → 'pending' (never auto-reject on an
    // incident, never auto-activate). Pre-account → NO operatorId → never quota-blocked.
    const siren = data.siren.slice(0, 9) // SIREN = first 9 digits of a SIREN or SIRET
    const verification = await verifyBusiness({
      siren,
      declaredName: data.companyName,
      // categories DEFERRED (lean signup) — the authoritative gate (lookupRegistry) uses ONLY the
      // SIREN, so the SIREN verification is BYTE-IDENTICAL; the optional declared categories were
      // only auxiliary context for the name match. Category coherence is now judged later, on the
      // REAL offer + catalogue, by the publication coherence trigger (lib/supplier-coherence).
    })
    // Re-interpret the verification result NAME-TOLERANTLY (decideSupplierOutcome,
    // like the courier flow). A clear name mismatch on an OTHERWISE-confirmed active
    // company (outcome 'rejected' WITH an officialName) is NOT an auto-reject — a
    // commercial name ≠ legal name is common — it routes into the EXISTING human-
    // review 'pending' path. Only a not-found / ceased SIREN (officialName=null)
    // stays a definitive 'rejected'. 'review' (incident) stays 'pending' (fail-safe).
    const registryDecision = decideSupplierOutcome(verification)
    // Lean signup étape 2 (Agent 111): the status is decided by the SIREN registry ALONE
    // (verifyBusiness → decideSupplierOutcome). The LLM COHERENCE check (vetSupplier) no longer
    // runs at signup — it is DEPLACED to the catalogue-publication trigger (lib/supplier-coherence),
    // which judges the supplier's REAL offer + catalogue BEFORE they become visible to restaurants.
    // The anti-abuse is PRESERVED (moved, never removed): a fresh SIREN-verified supplier is created
    // status='active' (can log in + build its catalogue) but marketplaceCoherencePending=true
    // (HIDDEN from the marketplace) until that coherence check clears it.
    const status: Outcome = registryDecision.status

    await prisma.supplierProfile.create({
      data: {
        email,
        companyName:        data.companyName,
        contactName:        data.contactName,
        // OPERATIONAL/offer fields DEFERRED to the profile: phone / minimumOrderCents / leadTimeDays
        // (Agent 109) + city / categories / deliveryZones / paymentTerms (Agent 111) all fall back to
        // their schema defaults (categories/deliveryZones @default([]); minimumOrderCents @default(0);
        // leadTimeDays @default(1); city/paymentTerms/phone nullable → null). Edited later via
        // PATCH /api/supplier/profile and read by the publication coherence trigger.
        status,
        // Lean signup: HIDDEN from the marketplace until the publication coherence check clears it.
        // A SIREN-verified supplier is status='active' (can log in + build its catalogue) but
        // marketplaceCoherencePending=true (invisible) — the anti-abuse is moved, not removed.
        marketplaceCoherencePending: true,
        siren,
        officialName:       verification.officialName,
        // REGISTRY identity result (a separate signal). The registry's own verifiedAt logic is
        // preserved byte-for-byte, so a registry-verified company keeps its verifiedAt.
        verificationStatus: registryDecision.verificationStatus,
        verifiedAt:         registryDecision.status === 'active' ? new Date() : null,
        // The coherence VERDICT is no longer produced at signup → null (= "not yet auto-vetted",
        // the idempotence marker the publication trigger keys on). vettingReason keeps the registry's
        // own reason for the admin console; vettingAt stays null until the coherence trigger runs.
        vettingVerdict:     null,
        vettingReason:      registryDecision.reason,
        vettingAt:          null,
      },
    })

    // Provision the passwordless login. ACTIVATE (+ graft the 'supplier' role) ONLY
    // when auto-approved; a 'pending' account is created un-activated (admin review
    // activates it later). A 'rejected' (spam/fake) submission provisions NO login at
    // all. Best-effort — a bridge failure never breaks the registration.
    if (status !== 'rejected') {
      await ensureSupplierOperator(email, data.contactName || data.companyName, { activate: status === 'active' })
      // B1.3-B "collect once": copy the VERIFIED company identity to the shared
      // account anchor (best-effort; no-op unless verificationStatus==='verified').
      // Reads the just-computed result only — verification logic is untouched.
      await propagateVerifiedCompanyIdentity({
        email,
        siren,
        officialName:       verification.officialName,
        verificationStatus: registryDecision.verificationStatus,
      })
    }

    return ok(status)
  } catch (err) {
    console.error('[POST /api/supplier/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
