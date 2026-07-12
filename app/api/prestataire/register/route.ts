import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import {
  ensurePrestataireOperator, decidePrestataireOutcome, isPrestataireEnabled,
} from '@/lib/prestataire-account'
import { verifyBusiness } from '@/lib/business-verification'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/prestataire/register — services marketplace signup (P1, Agent 74) ─
// A 1:1 CLONE of POST /api/supplier/register, adapted to SERVICES. Self-serve,
// PASSWORDLESS (magic-link). Creates a `PrestataireProfile` (status pending) + a
// passwordless Operator (role='prestataire', pending) via the prestataire auth bridge.
// The 'prestataire' role enters the role SET only at APPROVAL — never here. NO services
// list / quotes / missions / PAYMENT (P2+). The WHOLE role is gated by PRESTATAIRE_ENABLED
// (default OFF): when OFF this route 404s, so the role is byte-identical to non-existent.

const registerSchema = z.object({
  companyName:  z.string().min(2, 'Nom commercial trop court').max(120),
  contactName:  z.string().min(2, 'Nom du contact trop court').max(80),
  email:        z.string().email('Email invalide'),
  // SIREN (9) or SIRET (14) — spaces tolerated; verified against the official registry.
  siren:        z.string()
                  .transform((s) => s.replace(/\s+/g, ''))
                  .refine((s) => /^\d{9}$/.test(s) || /^\d{14}$/.test(s), 'SIREN (9 chiffres) ou SIRET (14 chiffres) requis'),
  // Agent 112 — lean signup: the OPERATIONAL/offer fields (phone, city, serviceCategories,
  // coverageZones, modality, indicativeRate) are DEFERRED to the prestataire profile (PATCH
  // /api/prestataire/profile) — no longer collected at signup. The registration now collects ONLY
  // the IDENTITY: companyName + contactName + email + SIREN + consent. The SIREN registry
  // verification (verifyBusiness/lookupRegistry — the authoritative gate) is UNCHANGED; the LLM
  // COHERENCE check (vetPrestataire) is MOVED to the service-publication trigger
  // (lib/prestataire-coherence), judged on the prestataire's REAL offer + services. zod
  // (non-strict) silently strips any deferred key still posted by a stale client.
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
      // serviceCategories DEFERRED (lean signup) — the authoritative gate (lookupRegistry) uses
      // ONLY the SIREN, so the SIREN verification is BYTE-IDENTICAL; the optional declared
      // categories were only auxiliary context for the name match. Category coherence is now
      // judged later, on the REAL offer + services, by the publication coherence trigger.
    })
    const registryDecision = decidePrestataireOutcome(verification)
    // Lean signup étape 2 (Agent 112): the status is decided by the SIREN registry ALONE
    // (verifyBusiness → decidePrestataireOutcome). The LLM COHERENCE check (vetPrestataire) no
    // longer runs at signup — it is DEPLACED to the service-publication trigger
    // (lib/prestataire-coherence), which judges the prestataire's REAL offer + services BEFORE they
    // become visible to restaurants. The anti-abuse is PRESERVED (moved, never removed): a fresh
    // SIREN-verified prestataire is created status='active' (can log in + list services) but
    // marketplaceCoherencePending=true (HIDDEN from the directory) until that check clears it.
    const status: Outcome = registryDecision.status

    await prisma.prestataireProfile.create({
      data: {
        email,
        companyName:        data.companyName,
        contactName:        data.contactName,
        // OPERATIONAL/offer fields DEFERRED to the profile: phone / city / serviceCategories /
        // coverageZones / modality / indicativeRate all fall back to their schema defaults
        // (serviceCategories/coverageZones @default([]); modality @default('on_site');
        // phone/city/indicativeRate nullable → null). Edited later via PATCH /api/prestataire/profile
        // and read by the publication coherence trigger.
        status,
        // Lean signup: HIDDEN from the directory until the publication coherence check clears it.
        // A SIREN-verified prestataire is status='active' (can log in + list services) but
        // marketplaceCoherencePending=true (invisible) — the anti-abuse is moved, not removed.
        marketplaceCoherencePending: true,
        siren,
        officialName:       verification.officialName,
        // REGISTRY identity result (a separate signal); its own verifiedAt logic is preserved.
        verificationStatus: registryDecision.verificationStatus,
        verifiedAt:         registryDecision.status === 'active' ? new Date() : null,
        // The coherence VERDICT is no longer produced at signup → null (= "not yet auto-vetted",
        // the idempotence marker the publication trigger keys on). vettingReason keeps the
        // registry's own reason for the admin console; vettingAt stays null until the trigger runs.
        vettingVerdict:     null,
        vettingReason:      registryDecision.reason,
        vettingAt:          null,
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
        verificationStatus: registryDecision.verificationStatus,
      })
    }

    return ok(status)
  } catch (err) {
    console.error('[POST /api/prestataire/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
