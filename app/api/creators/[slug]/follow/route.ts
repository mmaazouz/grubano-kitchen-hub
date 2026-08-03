import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCreatorEnabled } from '@/lib/creator-account'

export const dynamic = 'force-dynamic'

// ── /api/creators/[slug]/follow (P1-CHEF-FOLLOW) — consumer follow toggle ─────────
// The slug resolves to a Creator the SAME case-tolerant way as the public profile route
// (referralLinkSlug OR referralCode). GET is public (returns whether the session user
// follows + the real follow count). POST/DELETE are session-gated and idempotent (upsert
// / deleteMany). NO money; Creator.followers (the displayed headline stat) is never
// mutated here — this table is the real follow graph.

async function resolveCreatorId(slug: string): Promise<string | null> {
  const raw = decodeURIComponent(slug ?? '').trim()
  if (!raw) return null
  const candidates = Array.from(new Set([raw, raw.toUpperCase(), raw.toLowerCase()]))
  const creator = await prisma.creator.findFirst({
    where: { OR: [{ referralLinkSlug: { in: candidates } }, { referralCode: { in: candidates } }] },
    select: { id: true },
  })
  return creator?.id ?? null
}

async function sessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return (session?.user as { id?: string } | undefined)?.id ?? null
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const creatorId = await resolveCreatorId(params.slug)
  if (!creatorId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const userId = await sessionUserId()
  const [count, mine] = await Promise.all([
    prisma.creatorFollow.count({ where: { creatorId } }),
    userId
      ? prisma.creatorFollow.findUnique({ where: { userId_creatorId: { userId, creatorId } }, select: { id: true } })
      : Promise.resolve(null),
  ])
  return NextResponse.json({ following: !!mine, count })
}

export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const creatorId = await resolveCreatorId(params.slug)
  if (!creatorId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await prisma.creatorFollow.upsert({
    where: { userId_creatorId: { userId, creatorId } },
    update: {},
    create: { userId, creatorId },
  })
  const count = await prisma.creatorFollow.count({ where: { creatorId } })
  return NextResponse.json({ following: true, count })
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const creatorId = await resolveCreatorId(params.slug)
  if (!creatorId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await prisma.creatorFollow.deleteMany({ where: { userId, creatorId } })
  const count = await prisma.creatorFollow.count({ where: { creatorId } })
  return NextResponse.json({ following: false, count })
}
