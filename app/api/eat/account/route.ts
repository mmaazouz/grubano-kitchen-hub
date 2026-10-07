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
// shares; this only ever mutates the caller's own name/phone — and, since the notification
// preferences lot, `notifPrefs`, which carries an extra guarantee: a PATCH that includes
// notifPrefs must also name the identity it was prepared for, and is refused with 409
// `owner_changed` when that is not the identity it authenticated as. See the check in PATCH
// for why the client cannot make that guarantee by itself.
//
// BOTH DIRECTIONS ARE NAMED. Owner-scoping the queries is not enough on its own: it makes
// every response CORRECT for whoever was authenticated, and says nothing about who that
// was. A client whose belief about the session lags behind the cookie therefore cannot tell
// one account's correct response from another's. So the GET also returns `ownerId`, and the
// PATCH requires `expectedUserId` — read side and write side, the same raw Operator id.

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
  // THE RESPONSE NAMES THE IDENTITY IT WAS PRODUCED FOR — the mirror image of the PATCH
  // guard below, and necessary for the same reason. The browser attaches the cookie at SEND
  // time, so a GET issued while the client still believes A can be authenticated as B; the
  // client would then stamp B's row with A's owner and render it as A's own. It cannot
  // detect that by itself, because nothing in the response said whose it was. Now it does:
  // `ownerId` is the AUTHENTICATED Operator id — the session's, never the request's — and a
  // client that captured a different id refuses the whole response. Additive: existing
  // callers read `name`/`phone` and ignore the rest.
  return NextResponse.json({
    ownerId: userId,
    name: op.name,
    phone: op.phone ?? '',
    notifPrefs: op.notifPrefs ?? {},
  })
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
  // THE IDENTITY THE CLIENT PREPARED THIS MUTATION FOR. Not a new notion of owner — the raw
  // Operator id, the same value the session carries; the client keeps using sessionCartStamp
  // for its own rendering and sends the plain id here. Declared in the schema because zod
  // STRIPS unknown keys rather than rejecting them, so an undeclared field would arrive as
  // `undefined` and the check below would silently compare nothing.
  expectedUserId: z.string().min(1).optional(),
})

export async function PATCH(req: Request) {
  const userId = await ownerId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = ProfilePatch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  // ── THE OWNER CHECK — BEFORE ANY WRITE IS EVEN ASSEMBLED ────────────────────────
  // A debounced save prepared under account A can leave after the browser has started
  // attaching B's cookie: the client cannot see that gap, because the cookie is chosen at
  // send time and the client's own belief lags behind by a broadcast. The server sees both
  // at once, so it is the only party that can refuse — and it refuses by comparing the
  // identity the client PREPARED the mutation for with the identity it actually
  // AUTHENTICATED as. No new owner format: both sides are the raw Operator id.
  //
  // Scoped to `notifPrefs` ON PURPOSE for now: /eat/account/edit still sends name/phone
  // without the field and is corrected in its own lot. Making it mandatory for those today
  // would break that screen rather than protect it.
  if (parsed.data.notifPrefs !== undefined) {
    if (parsed.data.expectedUserId === undefined) {
      // A client that cannot say who it is writing for has no business writing.
      return NextResponse.json({ error: 'expected_user_id_required' }, { status: 400 })
    }
    if (parsed.data.expectedUserId !== userId) {
      // The identity moved between preparing this mutation and sending it. The mutation is
      // stale, not retryable as-is, and NOTHING is written. `owner_changed` is a stable
      // code the client keys on to stay silent rather than claim a save that never happened.
      return NextResponse.json({ error: 'owner_changed' }, { status: 409 })
    }
  }

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
