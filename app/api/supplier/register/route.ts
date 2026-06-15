import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureSupplierOperator } from '@/lib/supplier-account'
import { verifyBusiness } from '@/lib/business-verification'

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

// Supply categories — kept in sync with the i18n `supplier.cat*` keys + the form.
const CATEGORIES = ['fresh', 'meat', 'fish', 'dairy', 'drinks', 'grocery', 'packaging'] as const

const registerSchema = z.object({
  companyName:     z.string().min(2, 'Nom commercial trop court').max(120),
  contactName:     z.string().min(2, 'Nom du contact trop court').max(80),
  email:           z.string().email('Email invalide'),
  // SIREN (9) or SIRET (14) — spaces tolerated; verified against the official registry.
  siren:           z.string()
                     .transform((s) => s.replace(/\s+/g, ''))
                     .refine((s) => /^\d{9}$/.test(s) || /^\d{14}$/.test(s), 'SIREN (9 chiffres) ou SIRET (14 chiffres) requis'),
  phone:           z.string().max(40).optional(),
  city:            z.string().max(80).optional(),
  categories:      z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).default([]),
  deliveryZones:   z.array(z.string().min(1).max(80)).max(50).default([]),
  // Euros in (the form field is in €); stored as integer CENTS (display via format-money).
  minimumOrderEur: z.number().min(0).max(100000).default(0),
  leadTimeDays:    z.number().int().min(0).max(60).default(1),
  paymentTerms:    z.string().max(500).optional(),
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
    const minimumOrderCents = Math.round(data.minimumOrderEur * 100)

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
      categories:   data.categories,
    })
    const status: Outcome =
      verification.outcome === 'verified' ? 'active'
      : verification.outcome === 'rejected' ? 'rejected'
      : 'pending'

    await prisma.supplierProfile.create({
      data: {
        email,
        companyName:        data.companyName,
        contactName:        data.contactName,
        phone:              data.phone,
        city:               data.city,
        categories:         data.categories,
        deliveryZones:      data.deliveryZones,
        minimumOrderCents,
        leadTimeDays:       data.leadTimeDays,
        paymentTerms:       data.paymentTerms,
        status,
        siren,
        officialName:       verification.officialName,
        verificationStatus: verification.outcome,
        verifiedAt:         verification.outcome === 'verified' ? new Date() : null,
        vettingReason:      verification.reason,
        vettingAt:          new Date(),
      },
    })

    // Provision the passwordless login. ACTIVATE (+ graft the 'supplier' role) ONLY
    // when auto-approved; a 'pending' account is created un-activated (admin review
    // activates it later). A 'rejected' (spam/fake) submission provisions NO login at
    // all. Best-effort — a bridge failure never breaks the registration.
    if (status !== 'rejected') {
      await ensureSupplierOperator(email, data.contactName || data.companyName, { activate: status === 'active' })
    }

    return ok(status)
  } catch (err) {
    console.error('[POST /api/supplier/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
