import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { readOperatorRoles } from '@/lib/operator-roles'
import { resolveFranchiseRate } from '@/lib/franchise-royalty'

export const dynamic = 'force-dynamic'

// ── /api/franchise/profile — self-service edit of the OWN franchise account (P5c) ─
//
// DISCOVERY: the franchise has NO dedicated profile model. A franchisee IS an
// `Operator` (role 'franchise'); its data is PointOfSale (establishments — a SEPARATE
// surface) + royalties (finances). The ONLY editable, non-finance, non-establishment
// surface that genuinely exists is the Operator ACCOUNT's contact / display fields
// (name, phone, city). This route edits exactly those, following the P5a/P5b pattern.
//
// SECURITY:
//   • OWNER-ONLY: the row is resolved from the SESSION operator id (session.user.id)
//     — NEVER a client-supplied id. update targets where:{ id } (the session id) →
//     no IDOR.
//   • ROLE: 401 if unauthenticated; 403 if the session operator does NOT hold the
//     'franchise' role (readOperatorRoles — primary role ∪ OperatorRole set).
//   • WHITELIST: the Zod schema lists ONLY { name, phone, city }; zod strips unknown
//     keys and the Prisma `data` is built field-by-field, so email (login), role,
//     status, password, verification, and ALL finance/establishment data are IGNORED
//     and never written.
//   • VALIDATION mirrors the franchise apply route (name ≥ 2). NO finances / NO
//     establishments / NO schema change here.

const patchSchema = z.object({
  name:  z.string().min(2, 'Nom trop court').max(80),
  phone: z.string().max(40).optional(),
  city:  z.string().max(80).optional(),
})

type Gate =
  | { ok: false; status: 401 | 403 }
  | { ok: true; id: string; name: string; phone: string | null; city: string | null; email: string; status: string; officialName: string | null; siren: string | null }

/** Resolve the signed-in operator from the SESSION (session.user.id — never a
 *  client value) and require the 'franchise' role. Discriminated union so callers
 *  narrow cleanly. */
async function gate(): Promise<Gate> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as { id?: string } | undefined)?.id
  if (!id) return { ok: false, status: 401 }
  const op = await prisma.operator.findUnique({
    where:  { id },
    select: { id: true, role: true, name: true, phone: true, city: true, email: true, status: true, officialName: true, siren: true },
  })
  if (!op) return { ok: false, status: 403 }
  const roles = await readOperatorRoles(op.id, op.role)
  if (!roles.includes('franchise')) return { ok: false, status: 403 }
  return { ok: true, id: op.id, name: op.name, phone: op.phone, city: op.city, email: op.email, status: op.status, officialName: op.officialName, siren: op.siren }
}

function deny(status: 401 | 403) {
  return NextResponse.json(
    { ok: false, error: status === 401 ? 'Non autorisé' : 'Profil franchise introuvable' },
    { status },
  )
}

export async function GET() {
  try {
    const g = await gate()
    if (!g.ok) return deny(g.status)

    // FR6 additive READ-ONLY context: the real royalty rate (single Brand.royaltyPct or null,
    // NEVER hardcoded — the franchisor does not set its own rate) + the KYB legal identity
    // (admin-set, display-only here). Owner-scoped by the session operator.
    const brands = await prisma.brand.findMany({
      where: { operatorId: g.id, openToFranchise: true }, select: { royaltyPct: true },
    })
    const rates = Array.from(new Set(brands.map((b) => resolveFranchiseRate(b))))
    const ratePct = rates.length === 1 ? Math.round(rates[0] * 100) : null

    return NextResponse.json({
      ok: true,
      profile: {
        // editable (whitelist — name/phone/city only)
        name:  g.name,
        phone: g.phone ?? '',
        city:  g.city ?? '',
        // locked (display only — never editable here)
        email:  g.email,
        status: g.status,
        // FR6 read-only context
        ratePct,
        officialName: g.officialName,
        siren:        g.siren,
      },
    })
  } catch (err) {
    console.error('[GET /api/franchise/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const g = await gate()
    if (!g.ok) return deny(g.status)

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // WHITELISTED account contact/display fields ONLY. email / role / status /
    // password / verification / finance / establishment data are never referenced.
    await prisma.operator.update({
      where: { id: g.id },
      data: {
        name:  d.name.trim(),
        phone: d.phone?.trim() || null,
        city:  d.city?.trim() || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/franchise/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
