import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/operator/vat-number (P4.4-A) ─────────────────────────────────────────────
// The partner sets/reads THEIR OWN intra-community VAT number (shown on Grubano's
// commission invoice to them). OWNER-SCOPED: the operator is resolved from the SESSION
// email — never a client-supplied id (no IDOR). zod whitelist = the single field; an
// empty value clears it (back to blank). Additive, money-neutral (display only).

async function sessionOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, vatNumber: true, country: true } })
}

export async function GET() {
  const operator = await sessionOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  return NextResponse.json({ vatNumber: operator.vatNumber ?? '', country: operator.country })
}

// VAT number: optional, alphanumeric (letters/digits/spaces), ≤ 20 chars; empty → cleared.
const bodySchema = z.object({ vatNumber: z.string().trim().max(20).regex(/^[A-Za-z0-9 ]*$/).optional() })

export async function POST(req: Request) {
  const operator = await sessionOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'N° de TVA invalide.' }, { status: 400 })

  const value = (parsed.data.vatNumber ?? '').trim()
  const updated = await prisma.operator.update({
    where: { id: operator.id }, // OWNER-SCOPED — the session operator only
    data:  { vatNumber: value.length > 0 ? value : null },
    select: { vatNumber: true },
  })
  return NextResponse.json({ vatNumber: updated.vatNumber ?? '' })
}
