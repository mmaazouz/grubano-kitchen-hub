import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/operator/dac7 (P4.4-C) ───────────────────────────────────────────────────
// The partner sets/reads THEIR OWN self-declared DAC7 fields (registered address, TIN +
// its issuing country, date of birth for individuals, entity/individual type). OWNER-
// SCOPED: the operator is resolved from the SESSION email — never a client id (no IDOR).
// zod whitelist = exactly these fields; an empty value clears it. Additive, money-neutral.

async function sessionOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, registeredAddress: true, taxId: true, taxIdCountry: true, dateOfBirth: true, sellerType: true },
  })
}

export async function GET() {
  const op = await sessionOperator()
  if (!op) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  return NextResponse.json({
    registeredAddress: op.registeredAddress ?? '',
    taxId:             op.taxId ?? '',
    taxIdCountry:      op.taxIdCountry ?? '',
    dateOfBirth:       op.dateOfBirth ? op.dateOfBirth.toISOString().slice(0, 10) : '',
    sellerType:        op.sellerType ?? '',
  })
}

const bodySchema = z.object({
  registeredAddress: z.string().trim().max(300).optional(),
  taxId:             z.string().trim().max(40).regex(/^[A-Za-z0-9 -]*$/).optional(),
  taxIdCountry:      z.string().trim().max(2).regex(/^[A-Za-z]*$/).optional(), // ISO alpha-2 or empty
  dateOfBirth:       z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(), // yyyy-mm-dd or empty
  sellerType:        z.enum(['entity', 'individual', '']).optional(),
})

export async function POST(req: Request) {
  const op = await sessionOperator()
  if (!op) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Informations fiscales invalides.' }, { status: 400 })
  const b = parsed.data

  const blank = (s?: string) => (s && s.trim().length > 0 ? s.trim() : null)
  const dob = b.dateOfBirth && b.dateOfBirth.length === 10 ? new Date(`${b.dateOfBirth}T00:00:00.000Z`) : null
  if (b.dateOfBirth && b.dateOfBirth.length === 10 && Number.isNaN(dob!.getTime())) {
    return NextResponse.json({ error: 'Date de naissance invalide.' }, { status: 400 })
  }

  const updated = await prisma.operator.update({
    where: { id: op.id }, // OWNER-SCOPED — the session operator only
    data:  {
      registeredAddress: blank(b.registeredAddress),
      taxId:             blank(b.taxId),
      taxIdCountry:      b.taxIdCountry ? b.taxIdCountry.trim().toUpperCase() || null : null,
      dateOfBirth:       dob,
      sellerType:        b.sellerType && b.sellerType.length > 0 ? b.sellerType : null,
    },
    select: { registeredAddress: true, taxId: true, taxIdCountry: true, dateOfBirth: true, sellerType: true },
  })
  return NextResponse.json({
    registeredAddress: updated.registeredAddress ?? '',
    taxId:             updated.taxId ?? '',
    taxIdCountry:      updated.taxIdCountry ?? '',
    dateOfBirth:       updated.dateOfBirth ? updated.dateOfBirth.toISOString().slice(0, 10) : '',
    sellerType:        updated.sellerType ?? '',
  })
}
