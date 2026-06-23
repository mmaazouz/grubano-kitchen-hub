import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isMissionsEnabled, createMission } from '@/lib/missions'
import { serializeMission } from '@/lib/mission-serialize'

export const dynamic = 'force-dynamic'

// ── /api/logistics/missions/request — a business operator (resto / supplier / franchise)
// REQUESTS a delivery → it becomes an OFFERED mission (brick 3, Agent 124). Gated → 404 when
// OFF. The requester is the connected operator (session id); the mission is stamped with that
// id in its snapshot (brick-1 createMission accepts snapshot as-is — NO schema change, NO
// brick-1 fork). A requester only ever creates/reads their OWN missions (no IDOR). priceCents
// is an INERT proposed amount (data only) — NO commission/ledger/payout is computed.

// Who may request a delivery — business operators only (a consumer/creator/courier may not).
const REQUESTER_ROLES = ['restaurant', 'supplier', 'franchise', 'admin'] as const
const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const

const createSchema = z.object({
  type:           z.enum(MISSION_TYPES),
  pickupAddress:  z.string().trim().min(3, 'Adresse d’enlèvement trop courte').max(200),
  dropoffAddress: z.string().trim().min(3, 'Adresse de dépôt trop courte').max(200),
  zone:           z.string().trim().max(80).optional(),
  // Proposed amount in CENTS — INERT DATA shown to couriers; never charged here.
  priceCents:     z.number().int().min(0).max(100000).optional(),
})

function asRoles(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

async function requester(): Promise<{ id: string; roles: string[] } | null> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as { id?: string } | undefined)?.id
  if (!id) return null
  const single = (session?.user as { role?: string } | undefined)?.role
  const roles = asRoles((session?.user as { roles?: unknown } | undefined)?.roles)
  return { id, roles: roles.length ? roles : (single ? [single] : []) }
}

export async function POST(req: Request) {
  if (!isMissionsEnabled()) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  try {
    const who = await requester()
    if (!who) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })
    if (!who.roles.some((r) => (REQUESTER_ROLES as readonly string[]).includes(r))) {
      return NextResponse.json({ ok: false, error: 'Accès réservé aux partenaires' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // Reuse brick-1 createMission (gated, persists an 'offered' mission, NO courier, NO money).
    // Requester linkage lives in the snapshot → no schema change, no forced assignment.
    const mission = await createMission({
      type:           d.type,
      pickupAddress:  d.pickupAddress,
      dropoffAddress: d.dropoffAddress,
      zone:           d.zone || null,
      priceCents:     d.priceCents ?? 0,
      snapshot:       { requestedByOperatorId: who.id },
    })
    if (!mission) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

    return NextResponse.json({ ok: true, mission: serializeMission(mission) })
  } catch (err) {
    console.error('[POST /api/logistics/missions/request]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  if (!isMissionsEnabled()) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  try {
    const who = await requester()
    if (!who) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    // Owner-scoped: ONLY the missions this operator requested (snapshot.requestedByOperatorId).
    const missions = await prisma.mission.findMany({
      where: { snapshot: { path: '$.requestedByOperatorId', equals: who.id } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({ ok: true, missions: missions.map(serializeMission) })
  } catch (err) {
    console.error('[GET /api/logistics/missions/request]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
