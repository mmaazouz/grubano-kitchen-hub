import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureLogisticsOperator, decideLogisticsOutcome, applyCourierActivationGate, isCourierActivationEnabled } from '@/lib/logistics-account'
import { verifyBusiness } from '@/lib/business-verification'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/logistics/register ──────────────────────────────────────────────
// Self-serve LOGISTICS / courier partner registration (Slice 1, Agent 15). Calqued
// on /api/supplier/register: same anti-enumeration + anti-bot, PASSWORDLESS sign-in
// (magic-link). It creates a `LogisticsProfile` and, when auto-verified, provisions
// a passwordless Operator and grafts the 'logistics' role onto its SET (multi-role
// cumul). NO catalogue / dispatch / payment (later slices). The verification reuses
// lib/business-verification UNMODIFIED, with NAME-TOLERANT gating: a declared name
// that differs from the official registry name is NOT a rejection (see
// decideLogisticsOutcome) — only a not-found / ceased SIREN is.

// Mission + vehicle taxonomies — kept in sync with the i18n `business.logistics.*`
// keys + the registration form.
const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const VEHICLE_TYPES = ['velo', 'scooter', 'voiture', 'camionnette', 'frigorifique'] as const

const registerSchema = z.object({
  partnerType:  z.enum(['independent', 'company']),
  contactName:  z.string().min(2, 'Nom du contact trop court').max(80),
  contactEmail: z.string().email('Email invalide'),
  contactPhone: z.string().max(40).optional(),
  // SIREN (9) or SIRET (14) — spaces tolerated; verified against the official registry.
  siren:        z.string()
                  .transform((s) => s.replace(/\s+/g, ''))
                  .refine((s) => /^\d{9}$/.test(s) || /^\d{14}$/.test(s), 'SIREN (9 chiffres) ou SIRET (14 chiffres) requis'),
  missionTypes: z.array(z.enum(MISSION_TYPES)).min(1, 'Choisissez au moins un type de mission').max(MISSION_TYPES.length),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1, 'Choisissez au moins un véhicule').max(VEHICLE_TYPES.length),
  zones:        z.array(z.string().min(1).max(80)).max(50).default([]),
  consent:      z.boolean().refine((v) => v === true, { message: 'Consentement requis' }),
  // Anti-bot traps (mirror the supplier register flow): a filled honeypot or an
  // impossibly fast submit → silent generic OK (no signal to the bot).
  website:       z.string().optional(),
  formStartedAt: z.number().int().optional(),
})

// Uniform success shape `{ ok, outcome }` for EVERY accepted submission so a bot or
// a duplicate cannot fingerprint its path. 'pending' is the neutral default (anti-bot
// honeypot, too-fast submit, duplicate email); only a FRESH registration returns its
// real vetting outcome ('active' | 'pending' | 'rejected').
type Outcome = 'active' | 'pending' | 'rejected'
// The official registry name (public data) is surfaced ONLY on the genuine 'active'
// success the applicant reached with their own valid SIREN — so the confirmation can
// greet them by their official name. The neutral 'pending' / 'rejected' paths never
// echo it (anti-enumeration: a bot / duplicate must learn nothing).
// `waitlist` is a CONSTANT per request (= courier activation is OFF) attached UNIFORMLY
// to every accepted response, so it cannot fingerprint a path (honeypot / too-fast /
// duplicate / fresh all carry the same value). It tells the page to show the waitlist
// messaging. officialName stays 'active'-only (anti-enumeration) — and under the waitlist
// regime no response is ever 'active', so it is never echoed.
function ok(outcome: Outcome, officialName?: string | null, waitlist = false) {
  return NextResponse.json({
    ok: true,
    outcome,
    officialName: outcome === 'active' ? officialName ?? null : undefined,
    waitlist,
  })
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

    // Courier activation is gated (LA, Agent 72): while OFF (default, pending the legal
    // decision) the registration page stays OPEN but every applicant lands on a non-active
    // WAITLIST. `waitlist` is a constant attached uniformly to every response below.
    const activationEnabled = isCourierActivationEnabled()
    const waitlist = !activationEnabled

    // Anti-bot: honeypot filled or submitted in < 2 s → behave like a normal
    // (neutral 'pending') success, never vet, never write.
    if (data.website && data.website.trim() !== '') return ok('pending', null, waitlist)
    if (typeof data.formStartedAt === 'number' && Date.now() - data.formStartedAt < 2000) {
      return ok('pending', null, waitlist)
    }

    const email = data.contactEmail.trim().toLowerCase()

    // CREATE-IF-ABSENT (never overwrite): a PUBLIC endpoint must not let anyone
    // clobber — or re-vet — an existing profile by re-posting their email. A
    // duplicate just gets the neutral 'pending' response (no state is leaked).
    const existingProfile = await prisma.logisticsProfile.findUnique({
      where:  { email },
      select: { id: true },
    })
    if (existingProfile) {
      await ensureLogisticsOperator(email, data.contactName, { activate: false })
      return ok('pending', null, waitlist)
    }

    // FRESH registration → AUTOMATIC BUSINESS-IDENTITY verification (REUSED, UNMODIFIED).
    // The official registry decides existence + active state; the LLM only fuzzy-matches
    // the name. decideLogisticsOutcome then applies NAME-TOLERANT gating: a name-only
    // mismatch (registry confirmed the company) ACTIVATES; only not-found / ceased
    // rejects; any incident (registry/LLM down) → 'pending' (FAIL-SAFE, never auto-reject).
    const siren = data.siren.slice(0, 9) // SIREN = first 9 digits of a SIREN or SIRET
    const verification = await verifyBusiness({
      siren,
      declaredName: data.contactName,
      categories:   data.missionTypes,
    })
    // Apply the ACTIVATION GATE: while courier activation is OFF (default), a would-be
    // 'active' outcome (incl. the name-tolerant auto-activation) is demoted to the
    // non-active 'pending' WAITLIST. The registry verification fact (verificationStatus /
    // officialName) is preserved; only the activation status moves.
    const decision = applyCourierActivationGate(decideLogisticsOutcome(verification), activationEnabled)
    const status = decision.status

    await prisma.logisticsProfile.create({
      data: {
        email,
        partnerType:        data.partnerType,
        contactName:        data.contactName,
        contactPhone:       data.contactPhone,
        missionTypes:       data.missionTypes,
        vehicleTypes:       data.vehicleTypes,
        zones:              data.zones,
        status,
        siren,
        officialName:       verification.officialName,
        verificationStatus: decision.verificationStatus,
        verifiedAt:         status === 'active' ? new Date() : null,
        vettingReason:      decision.reason,
        vettingAt:          new Date(),
      },
    })

    // Provision the passwordless login. ACTIVATE (+ graft the 'logistics' role) ONLY
    // when auto-verified; a 'pending' account is created un-activated (review activates
    // it later). A 'rejected' submission provisions NO login at all. Best-effort — a
    // bridge failure never breaks the registration.
    if (status !== 'rejected') {
      await ensureLogisticsOperator(email, data.contactName, { activate: status === 'active' })
      // B1.3-B "collect once": copy the VERIFIED company identity to the shared
      // account anchor (best-effort; no-op unless verificationStatus==='verified').
      // Reads the just-computed result only — verification logic is untouched.
      await propagateVerifiedCompanyIdentity({
        email,
        siren,
        officialName:       verification.officialName,
        verificationStatus: decision.verificationStatus,
      })
    }

    return ok(status, verification.officialName, waitlist)
  } catch (err) {
    console.error('[POST /api/logistics/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
