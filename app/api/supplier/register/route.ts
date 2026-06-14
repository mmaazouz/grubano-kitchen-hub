import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureSupplierOperator } from '@/lib/supplier-account'

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

const GENERIC = {
  ok: true,
  message:
    "Si ces informations sont valides, ta demande d'inscription fournisseur a bien " +
    "été reçue. Notre équipe la validera avant l'activation de ton espace.",
}
function genericOk() {
  return NextResponse.json(GENERIC)
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

    // Anti-bot: honeypot filled or submitted in < 2 s → behave like success.
    if (data.website && data.website.trim() !== '') return genericOk()
    if (typeof data.formStartedAt === 'number' && Date.now() - data.formStartedAt < 2000) {
      return genericOk()
    }

    const email = data.email.trim().toLowerCase()
    const minimumOrderCents = Math.round(data.minimumOrderEur * 100)

    // CREATE-IF-ABSENT (never overwrite): this is a PUBLIC endpoint, so it must not
    // let anyone clobber an existing supplier's profile by re-posting their email.
    // A duplicate registration just returns the same generic response.
    const existingProfile = await prisma.supplierProfile.findUnique({
      where:  { email },
      select: { id: true },
    })
    if (!existingProfile) {
      await prisma.supplierProfile.create({
        data: {
          email,
          companyName:       data.companyName,
          contactName:       data.contactName,
          phone:             data.phone,
          city:              data.city,
          categories:        data.categories,
          deliveryZones:     data.deliveryZones,
          minimumOrderCents,
          leadTimeDays:      data.leadTimeDays,
          paymentTerms:      data.paymentTerms,
          status:            'pending',
        },
      })
    }

    // Provision the passwordless login account (pending). Fresh email → Operator
    // (role='supplier', pending). Existing account (any role) → untouched; the
    // 'supplier' role is ADDED only at approval (cumul). Best-effort — never blocks.
    await ensureSupplierOperator(email, data.contactName || data.companyName, { activate: false })

    return genericOk()
  } catch (err) {
    console.error('[POST /api/supplier/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
