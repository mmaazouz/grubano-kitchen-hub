import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ── /api/eat/addresses (P0-DATA-1) — consumer delivery address book ───────────────
// Server backend for what used to live only in localStorage (lib/eat-addresses). All
// methods are SESSION-GATED + OWNER-SCOPED (every query is `where: { userId }`), so a
// user only ever reads/writes their own rows. Guests (no session) get 401 → the client
// store stays localStorage-only (unchanged behaviour). The DB Address shape mirrors the
// client EatAddress 1:1, so the rewrite is transparent. The single-default invariant
// (exactly one isDefault while ≥1 address exists) is enforced here inside a transaction,
// matching the client store's rule. NO money: the order still stores the FORMATTED
// address string (placeOrder byte-identical) — this is only the reusable address book.

type Row = {
  id: string; label: string; kind: string; street: string; complement: string | null
  postalCode: string; city: string; country: string; note: string | null; isDefault: boolean
}

// DB row → the client EatAddress shape (null → undefined for the optional fields).
function toEatAddress(a: Row) {
  return {
    id: a.id, label: a.label, kind: a.kind, street: a.street,
    complement: a.complement ?? undefined, postalCode: a.postalCode, city: a.city,
    country: a.country, note: a.note ?? undefined, isDefault: a.isDefault,
  }
}

const AddressInput = z.object({
  label:      z.string().trim().min(1).max(60),
  kind:       z.enum(['home', 'work', 'other']).default('other'),
  street:     z.string().trim().min(1).max(180),
  complement: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().min(1).max(16),
  city:       z.string().trim().min(1).max(80),
  country:    z.string().trim().min(1).max(60).default('France'),
  note:       z.string().trim().max(240).optional(),
  isDefault:  z.boolean().optional(),
})

// PATCH schema — every field optional, NO defaults (so an absent field is never coerced
// to a concrete value that would overwrite the stored column; Prisma ignores undefined).
const AddressPatch = z.object({
  label:      z.string().trim().min(1).max(60).optional(),
  kind:       z.enum(['home', 'work', 'other']).optional(),
  street:     z.string().trim().min(1).max(180).optional(),
  complement: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().min(1).max(16).optional(),
  city:       z.string().trim().min(1).max(80).optional(),
  country:    z.string().trim().min(1).max(60).optional(),
  note:       z.string().trim().max(240).optional(),
  isDefault:  z.boolean().optional(),
})

async function ownerId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return (session?.user as { id?: string } | undefined)?.id ?? null
}

/**
 * FAIL CLOSED. Every request must DECLARE the identity it believes it is acting for, and
 * it must be the one the session resolved. Absent header → 409. Different → 409.
 *
 * The owner is always the cookie's — this header grants nothing and is never trusted as
 * identity. It exists because the client cache is keyed by the identity the BROWSER TAB
 * believes it has, and that belief goes stale: after a sign-in in another tab the cookie
 * is already the new account's while the tab still holds the old session object. A
 * mutation sent in that window created the previous account's address INSIDE the new
 * account — the production incident.
 *
 * WHY ABSENT IS REFUSED, not accepted. Accepting it kept the whole hole open for exactly
 * the population that matters: a tab loaded BEFORE the deploy runs the OLD bundle, which
 * knows nothing about this header, may still hold account A's global cache, and now
 * carries account B's cookie. It would have sent header-less POSTs that the server
 * accepted — A's rows created inside B, the incident, through the "fixed" route. The same
 * applies on the read path: an old bundle ignores the `owner` field this route returns
 * and would display the cookie-holder's rows in a tab that still believes it is A.
 * So a pre-deploy tab can no longer read or write until the page is refreshed. That is
 * the intended cost, and it is bounded: `lib/eat-addresses.ts` is the ONLY client of this
 * private internal route (verified by grep over the whole repository — the other mentions
 * are documentation), so no legitimate external caller is being locked out.
 */
function ownerMismatch(req: Request, userId: string): NextResponse | null {
  const claimed = req.headers.get('x-address-owner')
  if (claimed === userId) return null
  // No addresses in the body: a refusal must not leak the very rows it is protecting.
  return NextResponse.json({ error: 'owner_mismatch' }, { status: 409 })
}

const SELECT = {
  id: true, label: true, kind: true, street: true, complement: true,
  postalCode: true, city: true, country: true, note: true, isDefault: true,
} as const

// GET — list the user's addresses (default first, then oldest first).
//
// The response NAMES THE OWNER the server resolved from the session cookie. The client
// cache is keyed and stamped by the identity the CLIENT believes it has; those two can
// diverge (a tab left open across a sign-out/sign-in in another tab still holds the old
// session object while the cookie is already the new account's). Without this field the
// client would mirror the new account's rows into the old account's bucket and stamp them
// as the old account's — defeating both of its locks from the inside, which is the
// production leak re-entering through the fixed path. lib/eat-addresses discards any
// response whose `owner` is not the identity it asked for. Purely additive.
export async function GET(req: Request) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // The READ path is gated too: a caller that cannot name the identity it is reading for
  // gets nothing. Echoing the owner only helps a client that checks it; a pre-deploy
  // bundle does not, so it must not receive rows at all.
  const mism = ownerMismatch(req, userId)
  if (mism) return mism
  const rows = await prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: SELECT,
  })
  return NextResponse.json({ owner: userId, addresses: rows.map(toEatAddress) })
}

// POST — create. Becomes the default if flagged OR if it's the first address.
export async function POST(req: Request) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const mism = ownerMismatch(req, userId)
  if (mism) return mism
  const parsed = AddressInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const { isDefault, ...data } = parsed.data

  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { userId } })
    const makeDefault = isDefault === true || count === 0
    if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } })
    return tx.address.create({ data: { ...data, isDefault: makeDefault, userId }, select: SELECT })
  })
  return NextResponse.json({ address: toEatAddress(created) }, { status: 201 })
}

// PATCH — update one owned address. Setting isDefault unsets the others (transaction).
export async function PATCH(req: Request) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const mism = ownerMismatch(req, userId)
  if (mism) return mism
  const parsed = z.object({ id: z.string().min(1) }).and(AddressPatch).safeParse(
    await req.json().catch(() => null),
  )
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const { id, ...patch } = parsed.data

  const owned = await prisma.address.findFirst({ where: { id, userId }, select: { id: true } })
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const updated = await prisma.$transaction(async (tx) => {
    if (patch.isDefault === true) {
      await tx.address.updateMany({ where: { userId, NOT: { id } }, data: { isDefault: false } })
    }
    const u = await tx.address.update({ where: { id }, data: patch, select: SELECT })
    // Never leave the list without a default while it has entries.
    const anyDefault = await tx.address.findFirst({ where: { userId, isDefault: true }, select: { id: true } })
    if (!anyDefault) {
      const first = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true } })
      if (first) await tx.address.update({ where: { id: first.id }, data: { isDefault: true } })
    }
    return u
  })
  return NextResponse.json({ address: toEatAddress(updated) })
}

// DELETE — remove one owned address (id in the JSON body). Promotes a new default if
// the removed one was the default and others remain.
export async function DELETE(req: Request) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const mism = ownerMismatch(req, userId)
  if (mism) return mism
  const parsed = z.object({ id: z.string().min(1) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const { id } = parsed.data

  const owned = await prisma.address.findFirst({ where: { id, userId }, select: { id: true, isDefault: true } })
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } })
    if (owned.isDefault) {
      const first = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true } })
      if (first) await tx.address.update({ where: { id: first.id }, data: { isDefault: true } })
    }
  })
  return NextResponse.json({ ok: true })
}
