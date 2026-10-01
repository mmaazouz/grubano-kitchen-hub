import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ── /api/restaurants/[id]/waitlist (P2-WAITLIST) — consumer real waitlist queue ──────
// Server backend for the consumer « Liste d'attente » screen (/eat/r/[id]/waitlist).
// All methods are SESSION-GATED + OWNER-SCOPED: a caller only ever reads/writes their
// OWN entry for this restaurant (the @@unique([restaurantId, userId]) guarantees ONE
// active row per user per resto). Guests (no session) get 401 → the client falls back
// to the inert "login to join" toast. NO money — this is just a real position queue.
//
// position = 1-based rank of MY 'waiting' entry among all 'waiting' entries for this
//            resto, ordered by createdAt (FIFO) → count of 'waiting' rows with
//            createdAt <= mine.
// total    = count of ALL 'waiting' entries for this resto.
//
// KEPT INERT on the client: the AI nearby-table alternatives + the 3-step progress
// visual (no re-ranking backend). The notify flag is PERSISTED only — sending the
// SMS/notification is a later chantier (Wave 5).

type Entry = {
  id: string
  restaurantId: string
  partySize: number
  notify: boolean
  status: string
  createdAt: Date
  updatedAt: Date
}

function toEntry(e: Entry) {
  return {
    id: e.id,
    restaurantId: e.restaurantId,
    partySize: e.partySize,
    notify: e.notify,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }
}

const SELECT = {
  id: true, restaurantId: true, partySize: true,
  notify: true, status: true, createdAt: true, updatedAt: true,
} as const

const JoinInput = z.object({
  partySize: z.number().int().min(1).max(20),
  notify: z.boolean(),
})

async function ownerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return (session?.user as { id?: string } | undefined)?.id ?? null
}

// Resolve the live queue numbers for one restaurant. If `entry` is given, also returns
// its 1-based FIFO position (count of 'waiting' rows created no later than it).
async function queueStats(restaurantId: string, entry: { createdAt: Date } | null) {
  const total = await prisma.waitlist.count({
    where: { restaurantId, status: 'waiting' },
  })
  let position = 0
  if (entry) {
    position = await prisma.waitlist.count({
      where: { restaurantId, status: 'waiting', createdAt: { lte: entry.createdAt } },
    })
  }
  return { total, position }
}

// GET — the caller's ACTIVE ('waiting') entry for this resto, with live position + total.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id }, select: { id: true },
  })
  if (!restaurant) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const row = await prisma.waitlist.findFirst({
    where: { restaurantId: params.id, userId, status: 'waiting' },
    select: SELECT,
  })
  const { total, position } = await queueStats(params.id, row)
  if (!row) return NextResponse.json({ entry: null, total })
  return NextResponse.json({ entry: toEntry(row), position, total })
}

// POST — join (or re-join / update) the queue. UPSERTs the caller's single row for this
// resto (via @@unique([restaurantId, userId])) back to status 'waiting'. Returns the
// entry + its live position + total.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id }, select: { id: true },
  })
  if (!restaurant) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const parsed = JoinInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const { partySize, notify } = parsed.data

  // Re-joining a previously-cancelled entry must move it to the back of the queue, so we
  // refresh createdAt on UPDATE (a stale createdAt would jump the queue). New rows get
  // createdAt = now() naturally.
  const now = new Date()
  const row = await prisma.waitlist.upsert({
    where: { restaurantId_userId: { restaurantId: params.id, userId } },
    create: { restaurantId: params.id, userId, partySize, notify, status: 'waiting' },
    update: { partySize, notify, status: 'waiting', createdAt: now },
    select: SELECT,
  })
  const { total, position } = await queueStats(params.id, row)
  return NextResponse.json({ entry: toEntry(row), position, total })
}

// DELETE — leave the queue. Marks the caller's entry 'cancelled' (kept for audit; the
// @@unique slot is freed for a future re-join via the upsert above). Returns { ok }.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.id }, select: { id: true },
  })
  if (!restaurant) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await prisma.waitlist.updateMany({
    where: { restaurantId: params.id, userId },
    data: { status: 'cancelled' },
  })
  return NextResponse.json({ ok: true })
}
