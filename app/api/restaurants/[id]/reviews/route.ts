import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ── /api/restaurants/[id]/reviews (P0-DATA-2) — consumer reviews ──────────────────
// GET is PUBLIC (published reviews + a per-star distribution). POST is session-gated and
// UPSERTS the caller's single review for this restaurant (1 editable review per user per
// resto, @@unique([userId,restaurantId])). The Restaurant.rating / reviewCount HEADLINE
// aggregate is intentionally left untouched (merging on-platform reviews into it is a
// later product decision), so this route never changes any existing aggregate or money
// path. The author is exposed as a FIRST NAME only (privacy).

type ReviewRow = {
  id: string
  rating: number
  text: string | null
  tags: unknown
  createdAt: Date
  operator: { name: string | null }
}

function publicReview(r: ReviewRow) {
  const first = (r.operator?.name ?? '').trim().split(/\s+/)[0] || null
  return {
    id: r.id,
    rating: r.rating,
    text: r.text ?? '',
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    authorName: first,
    createdAt: r.createdAt.toISOString(),
  }
}

const SELECT = {
  id: true, rating: true, text: true, tags: true, createdAt: true,
  operator: { select: { name: true } },
} as const

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const restaurantId = params.id
  const rows = await prisma.review.findMany({
    where: { restaurantId, status: 'published' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: SELECT,
  })
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  for (const r of rows) {
    const k = String(Math.min(5, Math.max(1, r.rating)))
    distribution[k] += 1
  }
  return NextResponse.json({ reviews: rows.map(publicReview), distribution, count: rows.length })
}

const ReviewInput = z.object({
  rating:  z.number().int().min(1).max(5),
  text:    z.string().trim().max(1000).optional(),
  tags:    z.array(z.string().max(40)).max(8).optional(),
  orderId: z.string().max(60).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const restaurantId = params.id
  const parsed = ReviewInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const { rating, text, tags, orderId } = parsed.data

  // The restaurant must exist (avoid an FK error / orphan review).
  const resto = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } })
  if (!resto) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const data = {
    rating,
    text: text && text.length ? text : null,
    tags: tags ?? [],
    orderId: orderId ?? null,
    status: 'published',
  }
  const review = await prisma.review.upsert({
    where: { userId_restaurantId: { userId, restaurantId } },
    update: data,
    create: { ...data, userId, restaurantId },
    select: SELECT,
  })
  return NextResponse.json({ review: publicReview(review) }, { status: 201 })
}
