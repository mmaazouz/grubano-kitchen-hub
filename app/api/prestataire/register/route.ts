import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import {
  ensurePrestataireOperator, decidePrestataireOutcome, combineVettingDecision, isPrestataireEnabled,
} from '@/lib/prestataire-account'
import { verifyBusiness } from '@/lib/business-verification'
import { vetPrestataire } from '@/lib/prestataire-vetting'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/prestataire/register — services marketplace signup (P1, Agent 74) ─
// A 1:1 CLONE of POST /api/supplier/register, adapted to SERVICES. Self-serve,
// PASSWORDLESS (magic-link). Creates a `PrestataireProfile` (status pending) + a
// passwordless Operator (role='prestataire', pending) via the prestataire auth bridge.
// The 'prestataire' role enters the role SET only at APPROVAL — never here. NO services
// list / quotes / missions / PAYMENT (P2+). The WHOLE role is gated by PRESTATAIRE_ENABLED
// (default OFF): when OFF this route 404s, so the role is byte-identical to non-existent.

// Service categories — kept in sync with the i18n `prestataire.svc*` keys + the form.
const SERVICE_CATEGORIES = [
  'electricity', 'plumbing', 'haccp', 'cleaning', 'pest_control',
  'fridge_repair', 'kitchen_maintenance', 'accounting', 'training', 'other',
] as const
const MODALITIES = ['on_site', 'remote', 'both'] as const

const registerSchema = z.object({
  companyName:  z.string().min(2, 'Nom commercial trop court').max(120),
  contactName:  z.string().min(2, 'Nom du contact trop court').max(80),
  email:        z.string().email('Email invalide'),
  // SIREN (9) or SIRET (14) — spaces tolerated; verified against the official registry.
  siren:        z.string()
                  .transform((s) => s.replace(/\s+/g, ''))
                  .refine((s) => /^\d{9}$/.test(s) || /^\d{14}$/.test(s), 'SIREN (9 chiffres) ou SIRET (14 chiffres) requis'),
  phone:        z.string().max(40).optional(),
  city:         z.string().max(80).optional(),
  serviceCategories: z.array(z.enum(SERVICE_CATEGORIES)).max(SERVICE_CATEGORIES.length).default([]),
  coverageZones:     z.array(z.string().min(1).max(80)).max(50).default([]),
  modality:          z.enum(MODALITIES).default('on_site'),
  indicativeRate:    z.string().max(500).optional(),
  consent:      z.boolean().refine((v) => v === true, { message: 'Consentement requis' }),
  // Anti-bot traps (mirror the supplier flow): a filled honeypot or an impossibly fast
  // submit → silent generic OK (no signal to the bot).
  website:       z.string().optional(),
  formStartedAt: z.number().int().optional(),
})

// Uniform success shape `{ ok, outcome }` for EVERY accepted submission so a bot or a
// duplicate cannot fingerprint its path. 'pending' is the neutral default (anti-bot
// honeypot, too-fast submit, duplicate email); only a FRESH registration returns its real
// vetting outcome ('active' | 'pending' | 'rejected').
type Outcome = 'active' | 'pending' | 'rejected'
function ok(outcome: Outcome) {
  return NextResponse.json({ ok: true, outcome })
}

export async function POST(req: Request) {
  // FLAG GATE — the whole prestataire role is OFF by default. When OFF the role does not
  // exist: a 404 (never reveal the endpoint shape). No prestataire can be created.
  if (!isPrestataireEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
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

    // Anti-bot: honeypot filled or submitted in < 2 s → behave like a normal (neutral
    // 'pending') success, never vet, never write.
    if (data.website && data.website.trim() !== '') return ok('pending')
    if (typeof data.formStartedAt === 'number' && Date.now() - data.formStartedAt < 2000) {
      return ok('pending')
    }

    const email = data.email.trim().toLowerCase()

    // CREATE-IF-ABSENT (never overwrite): a PUBLIC endpoint must not let anyone clobber —
    // or re-vet — an existing prestataire by re-posting their email. A duplicate just gets
    // the neutral 'pending' response (no state is leaked).
    const existingProfile = await prisma.prestataireProfile.findUnique({
      where:  { email },
      select: { id: true },
    })
    if (existingProfile) {
      await ensurePrestataireOperator(email, data.contactName || data.companyName, { activate: false })
      return ok('pending')
    }

    // FRESH registration → AUTOMATIC BUSINESS-IDENTITY verification (REUSED, UNMODIFIED).
    // The official registry decides existence + active state; the LLM only fuzzy-matches
    // the name. CONSERVATIVE (decidePrestataireOutcome): a name-only mismatch on a confirmed
    // company → human-review 'pending'; only not-found / ceased → rejected; any incident →
    // 'pending' (fail-safe). Pre-account → NO operatorId → never quota-blocked.
    const siren = data.siren.slice(0, 9) // SIREN = first 9 digits of a SIREN or SIRET
    const verification = await verifyBusiness({
      siren,
      declaredName: data.companyName,
      categories:   data.serviceCategories,
    })
    const registryDecision = decidePrestataireOutcome(verification)

    // LLM TRUST-&-SAFETY VETTING (lib/prestataire-vetting) — DEFENCE IN DEPTH, ADDITIVE.
    // Capped LLM gateway (task 'prestataire_vetting'; no operatorId pre-account → never
    // quota-blocked). FAIL-SAFE: any failure returns 'doubt' (never throws, never 'legit').
    // The verdict can ONLY HARDEN the registry decision (combineVettingDecision): it never
    // auto-approves a refusal and never auto-rejects a registry-confirmed company. ZERO
    // money effect — gates ONBOARDING VISIBILITY only.
    const vet = await vetPrestataire({
      companyName:       data.companyName,
      contactName:       data.contactName,
      city:              data.city,
      serviceCategories: data.serviceCategories,
      coverageZones:     data.coverageZones,
      indicativeRate:    data.indicativeRate,
    }).catch(() => ({ verdict: 'doubt' as const, reason: 'vérification auto indisponible' }))
    const decision = combineVettingDecision(registryDecision, vet.verdict, vet.reason)
    const status: Outcome = decision.status

    await prisma.prestataireProfile.create({
      data: {
        email,
        companyName:        data.companyName,
        contactName:        data.contactName,
        phone:              data.phone,
        city:               data.city,
        serviceCategories:  data.serviceCategories,
        coverageZones:      data.coverageZones,
        modality:           data.modality,
        indicativeRate:     data.indicativeRate,
        status,
        siren,
        officialName:       verification.officialName,
        // REGISTRY identity result — UNCHANGED by the vetting (a separate signal); its own
        // verifiedAt logic is tied to the registry decision, not the vetting-hardened gate.
        verificationStatus: registryDecision.verificationStatus,
        verifiedAt:         registryDecision.status === 'active' ? new Date() : null,
        vettingVerdict:     vet.verdict,     // the LLM trust-&-safety verdict (admin signal)
        vettingReason:      decision.reason, // explains the FINAL gate (registry OR vetting reason)
        vettingAt:          new Date(),
      },
    })

    // Provision the passwordless login. ACTIVATE (+ graft the 'prestataire' role) ONLY when
    // auto-approved; a 'pending' account is created un-activated (admin review activates it
    // later). A 'rejected' submission provisions NO login. Best-effort — a bridge failure
    // never breaks the registration.
    if (status !== 'rejected') {
      await ensurePrestataireOperator(email, data.contactName || data.companyName, { activate: status === 'active' })
      // "collect once": copy the VERIFIED company identity to the shared account anchor
      // (best-effort; no-op unless verificationStatus==='verified'). verifyBusiness untouched.
      await propagateVerifiedCompanyIdentity({
        email,
        siren,
        officialName:       verification.officialName,
        verificationStatus: decision.verificationStatus,
      })
    }

    return ok(status)
  } catch (err) {
    console.error('[POST /api/prestataire/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
