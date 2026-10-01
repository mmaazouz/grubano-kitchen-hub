import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ── /api/eat/account (P1-PROFILE) — consumer profile (name + phone) ───────────────
// Session-gated + owner-scoped: every query keys on the logged-in Operator's own id, so
// a user only ever reads/writes their own row. GET returns the current name/phone, PATCH
// updates them. This is NOT an auth surface — email changes go through the dedicated
// /api/account/email-change flow and the password through the reset flow; this route
// never touches password/email/role. NO money. The Operator row is the model every role
// shares; this only ever mutates the caller's own name/phone.

async function ownerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return (session?.user as { id?: string } | undefined)?.id ?? null
}

export async function GET() {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const op = await prisma.operator.findUnique({
    where: { id: userId },
    select: { name: true, phone: true, notifPrefs: true },
  })
  if (!op) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ name: op.name, phone: op.phone ?? '', notifPrefs: op.notifPrefs ?? {} })
}

// Notification preferences (P1-NOTIFPREF) — the /eat/account/notifications toggles,
// persisted as a JSON blob on Operator. Delivery (sending) is Wave 5; this stores choices.
const NotifPrefs = z.object({
  channels: z.object({ push: z.boolean(), email: z.boolean(), sms: z.boolean() }),
  rows: z.object({
    status: z.boolean(), courier: z.boolean(), reviews: z.boolean(),
    offers: z.boolean(), newResto: z.boolean(), rewards: z.boolean(),
  }),
  quiet: z.boolean(),
})

// name is required-non-empty WHEN provided (Operator.name is non-null); phone is free-form
// and an empty string CLEARS it. notifPrefs replaces the whole blob. An absent field is
// left untouched.
const ProfilePatch = z.object({
  name:       z.string().trim().min(1).max(80).optional(),
  phone:      z.string().trim().max(30).optional(),
  notifPrefs: NotifPrefs.optional(),
})

export async function PATCH(req: Request) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = ProfilePatch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const data: { name?: string; phone?: string | null; notifPrefs?: typeof parsed.data.notifPrefs } = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone === '' ? null : parsed.data.phone
  if (parsed.data.notifPrefs !== undefined) data.notifPrefs = parsed.data.notifPrefs
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'empty' }, { status: 400 })

  const op = await prisma.operator.update({
    where: { id: userId },
    data,
    select: { name: true, phone: true, notifPrefs: true },
  })
  return NextResponse.json({ name: op.name, phone: op.phone ?? '', notifPrefs: op.notifPrefs ?? {} })
}
