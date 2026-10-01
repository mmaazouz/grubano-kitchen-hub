import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureLogisticsOperator, decideLogisticsOutcome, applyCourierActivationGate, isCourierActivationEnabled } from '@/lib/logistics-account'
import { verifyBusiness } from '@/lib/business-verification'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'
import { rateLimit } from '@/lib/rate-limit'
import { isLogisticsSignupEnabled } from '@/lib/logistics-account'
import { sendCourierWaitlistConfirmation, sendAdminNewPartnerEmail } from '@/lib/transactional-emails'

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
  // WAVE 3 — OPTIONNEL pour un 'independent' au stade LISTE D'ATTENTE (décision
  // fondateur : « informations minimales, pas de KYC ») ; toujours REQUIS pour une
  // 'company' (superRefine ci-dessous). Sans SIREN : AUCUN appel verifyBusiness
  // (tiers payant) — le profil part directement en 'pending'.
  siren:        z.string()
                  .transform((s) => s.replace(/\s+/g, ''))
                  .refine((s) => s === '' || /^\d{9}$/.test(s) || /^\d{14}$/.test(s), 'SIREN (9 chiffres) ou SIRET (14 chiffres) invalide')
                  .optional(),
  missionTypes: z.array(z.enum(MISSION_TYPES)).min(1, 'Choisissez au moins un type de mission').max(MISSION_TYPES.length),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1, 'Choisissez au moins un véhicule').max(VEHICLE_TYPES.length),
  zones:        z.array(z.string().min(1).max(80)).max(50).default([]),
  consent:      z.boolean().refine((v) => v === true, { message: 'Consentement requis' }),
  // Anti-bot traps (mirror the supplier register flow): a filled honeypot or an
  // impossibly fast submit → silent generic OK (no signal to the bot).
  website:       z.string().optional(),
  formStartedAt: z.number().int().optional(),
}).superRefine((d, ctx) => {
  // WAVE 3 — une société doit fournir son SIREN ; un indépendant peut s'inscrire
  // en liste d'attente sans (vérification d'identité reportée à l'activation).
  if (d.partnerType === 'company' && (!d.siren || d.siren === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['siren'], message: 'SIREN (9 chiffres) ou SIRET (14 chiffres) requis pour une société' })
  }
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
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture.
  // WAVE 3 — gate INSCRIPTION (LOGISTICS_SIGNUP_ENABLED) : la waitlist s'ouvre sans
  // rien rouvrir d'opérationnel (second verrou d'activation intact).
  if (!isLogisticsSignupEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // S2 (abuse/cost) — this PUBLIC endpoint triggers a paid verifyBusiness call (LLM + official
  // registry) on a fresh SIREN, so throttle it per-IP (in addition to the honeypot + 2 s delay
  // below, which are preserved). Flag-gated by RATE_LIMIT_ENABLED (default OFF) → NO-OP / byte-
  // identical today; generous 10/min never hit by a real human (who registers once). Runs BEFORE
  // body parse (headers only) — the honeypot / too-fast short-circuits stay intact.
  const limited = rateLimit(req, 'logistics_register', { limitDefault: 10, windowDefault: 60 })
  if (limited) return limited
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

    // FRESH registration → AUTOMATIC BUSINESS-IDENTITY verification (REUSED, UNMODIFIED)
    // quand un SIREN est fourni. WAVE 3 : SANS SIREN (indépendant, stade intérêt),
    // AUCUN appel verifyBusiness (tiers PAYANT) — le profil part directement en
    // 'pending' waitlist ; la vérification d'identité se fera à l'ACTIVATION.
    const siren = data.siren ? data.siren.slice(0, 9) : null // SIREN = first 9 digits of a SIREN or SIRET
    let officialName: string | null = null
    let decision: { status: 'active' | 'pending' | 'rejected'; verificationStatus: string | null; reason: string | null }
    if (siren) {
      const verification = await verifyBusiness({
        siren,
        declaredName: data.contactName,
        categories:   data.missionTypes,
      })
      officialName = verification.officialName ?? null
      // Apply the ACTIVATION GATE: while courier activation is OFF (default), a would-be
      // 'active' outcome (incl. the name-tolerant auto-activation) is demoted to the
      // non-active 'pending' WAITLIST. The registry verification fact (verificationStatus /
      // officialName) is preserved; only the activation status moves.
      decision = applyCourierActivationGate(decideLogisticsOutcome(verification), activationEnabled)
    } else {
      decision = { status: 'pending', verificationStatus: null, reason: 'Intérêt enregistré sans SIREN — identité à vérifier avant activation' }
    }
    const status = decision.status

    const profile = await prisma.logisticsProfile.create({
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
        officialName,
        verificationStatus: decision.verificationStatus,
        verifiedAt:         status === 'active' ? new Date() : null,
        vettingReason:      decision.reason,
        vettingAt:          new Date(),
      },
      select: { id: true },
    })

    // WAVE 3 — confirmations HONNÊTES, best-effort et idempotentes (sendOnce), sur le
    // chemin FRESH uniquement (jamais sur honeypot/doublon : anti-énumération intacte).
    // L'UI a DÉJÀ répondu vrai (écriture DB réussie) — un échec SMTP ne perd rien.
    if (status !== 'rejected') {
      await sendCourierWaitlistConfirmation({ to: email, contactName: data.contactName, dedupeKey: `logistics:${profile.id}` })
      await sendAdminNewPartnerEmail({ role: 'logistics', partnerName: data.contactName, dedupeScope: `logistics:${profile.id}` })
    }

    // Provision the passwordless login. ACTIVATE (+ graft the 'logistics' role) ONLY
    // when auto-verified; a 'pending' account is created un-activated (review activates
    // it later). A 'rejected' submission provisions NO login at all. Best-effort — a
    // bridge failure never breaks the registration.
    if (status !== 'rejected') {
      await ensureLogisticsOperator(email, data.contactName, { activate: status === 'active' })
      // B1.3-B "collect once": copy the VERIFIED company identity to the shared
      // account anchor (best-effort; no-op unless verificationStatus==='verified').
      // Reads the just-computed result only — verification logic is untouched.
      if (siren) {
        await propagateVerifiedCompanyIdentity({
          email,
          siren,
          officialName,
          verificationStatus: decision.verificationStatus,
        })
      }
    }

    return ok(status, officialName, waitlist)
  } catch (err) {
    console.error('[POST /api/logistics/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
