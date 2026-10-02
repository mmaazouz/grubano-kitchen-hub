import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPasswordChangedEmail } from '@/lib/transactional-emails'
import { rateLimit } from '@/lib/rate-limit'

// ── POST /api/account/password — in-account « current → new » password change ───
//
// WHY THIS ROUTE EXISTS. /{locale}/eat/account/password drew three fields and a
// « Mettre à jour » button, but no endpoint accepted a current→new change: both
// buttons posted to /api/auth/forgot-password, so the screen mailed a reset link
// and called it an update. This is the missing write path. The two existing
// reset-by-email routes (/api/auth/forgot-password, /api/auth/reset-password) are
// NOT touched by this lot — « Mot de passe oublié ? » keeps its exact contract.
//
// AUTHENTICATED, SELF-ONLY. The account changed is ALWAYS the session's own
// operator: `session.user.id`. No identifier is read from the body — a client-sent
// id would turn this into "change anyone's password". ⭐ The stored hash and the
// account status are read from the DB, never from the JWT (a JWT is issued once and
// keeps asserting what was true at sign-in).
//
// NO FEATURE FLAG, deliberately. Unlike the /api/account/email-change routes this
// is not a new commercial surface that may ship dark: it is the repair of a control
// the UI already offered. A flag here would re-create the gap it closes.
// (No glob in that path on purpose: a "slash-star" inside a line comment opens a
// block comment for every naive source scanner in this repo — including the one in
// tests/account-password-change.test.ts, which it silently blinded once.)
//
// NOT GATED BY middleware.ts: its matcher excludes `api`, so this handler's own
// session check is the only gate. Nothing upstream authenticates it.
//
// ORDER IS LOAD-BEARING (session → limiter → validation → DB → verify → write):
// the limiter is keyed on the authenticated operator id, so it has to come after
// the session. Everything expensive (DB read, bcrypt.compare, bcrypt.hash cost 12)
// stays behind it. An UNAUTHENTICATED flood is answered 401 before the limiter —
// that path costs one JWT decode and no DB access, so it is not the hot surface.
//
// ATOMIC. The new hash and the purge of every pending `pwreset:<email>` token are
// ONE transaction: a change that left a pre-change reset link alive would hand its
// holder the power to overwrite the password the owner just chose, so the purge is
// a security property and may not fail silently. Either both writes commit, or
// neither does and the caller gets a 500 with no security e-mail. The bcrypt hash
// and the e-mail stay OUTSIDE it (slow work, and un-rollbackable work).
//
// WHAT THE TRANSACTION DOES *NOT* BUY — stated so the guarantee is not read wider
// than it is:
//   • It cannot revoke a reset that is ALREADY IN FLIGHT. /api/auth/reset-password
//     validates the token and then spends a cost-12 hash before writing, all
//     outside any transaction, so a consumption that passed validation microseconds
//     before this commit still lands afterwards. Closing that needs a change to
//     that route, which this lot is forbidden to touch.
//   • It assumes both tables are transactional (InnoDB). Nothing in this repository
//     proves the engine — there is no migrations directory and the datasource
//     declares none — so that remains an unverified production fact.
//   • A rejection raised AT COMMIT (connection dropped mid-COMMIT) is reported as a
//     failure although the write may have landed. The founder's rule for this route
//     is explicit — on 500 the password is "not considered changed" — so the handler
//     does NOT try to re-read and re-interpret; it reports the failure it saw.
//   • Only `pwreset:` rows are purged. Magic-link credentials on the Operator row
//     are untouched by a password change (a separate, recorded follow-up).
//
// SESSIONS ARE NOT REVOKED. lib/auth.ts uses `session: { strategy: 'jwt' }`: no
// server-side session row exists to delete, so a token already issued stays valid
// until it expires. The response says so, and the screen repeats it — the one thing
// this endpoint must not do is imply other devices were signed out.
//
// 🔒 NEVER LOG the current password, the new password, the bcrypt hash or a reset
// token — not even inside an error. That includes NOT logging `err.message`: a
// Prisma validation error embeds the failing invocation's arguments, which on this
// route is `data: { password: <hash> }`. Only the error's class/code is logged.
// SCOPE OF THAT RULE: it binds THIS handler. The Prisma client is separately built
// with `log: ['error']` (lib/prisma.ts), so the engine may print its own full error
// — including those arguments — to the process log. Narrowing that is a change to a
// shared file and belongs to its own lot; it is recorded, not silently assumed away.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  // min(1): an empty current password can never be the right one. max(200) bounds
  // the body (bcrypt only reads the first 72 bytes anyway); it is deliberately
  // LOOSER than the new-password policy so an older/longer stored password can
  // still be presented and verified.
  currentPassword: z.string().min(1, 'current_required').max(200, 'current_required'),
  // EXACTLY the app-wide policy, unchanged: register/route.ts and
  // auth/reset-password/route.ts both use z.string().min(8).max(100). This route
  // does not invent a stricter rule — a third, divergent policy is how "8+ with a
  // digit and a symbol" came to be displayed while nothing enforced it.
  newPassword: z.string().min(8, 'weak_new').max(100, 'weak_new'),
})

/** Machine-readable refusals. The screen maps `code` to a localised message; the
 *  French `error` is the fallback for any other caller. No enumeration concern:
 *  the caller is already authenticated AS the account being judged, so a precise
 *  code tells them only about themselves. */
const refuse = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status })

export async function POST(req: Request) {
  // (1) WHO — the session, and only the session.
  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  // (2) An authenticated id is mandatory. No id ⇒ nothing to change.
  if (!operatorId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // (3) Throttle, keyed on the AUTHENTICATED operator (+ client IP, inside the
  // limiter). 5 attempts / 15 min caps current-password guessing from a stolen
  // session cookie, and caps the bcrypt cost of each attempt. Gated by
  // RATE_LIMIT_ENABLED and fail-open by design (lib/rate-limit.ts).
  const limited = rateLimit(req, 'account_password_change', {
    limitDefault:  5,
    windowDefault: 900,
    extraKey:      operatorId,
  })
  if (limited) return limited

  try {
    // (4) Shape + policy.
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      // The FIELD decides the code, not the message: a missing field yields zod's
      // own "Required" text, so reading the message would mislabel an absent
      // currentPassword as a weak new password.
      const onCurrent = parsed.error.errors[0]?.path?.[0] === 'currentPassword'
      return onCurrent
        ? refuse(400, 'current_required', 'Mot de passe actuel requis.')
        : refuse(400, 'weak_new', 'Le nouveau mot de passe doit contenir entre 8 et 100 caractères.')
    }
    const { currentPassword, newPassword } = parsed.data

    // (5) Re-read the account from the DB — the JWT is not evidence of the current
    // hash or of the current status.
    const operator = await prisma.operator.findUnique({
      where:  { id: operatorId },
      select: { id: true, email: true, name: true, password: true, status: true },
    })
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    // (6) Same gate as sign-in (lib/auth.ts): 'pending' and 'suspended' only —
    // deliberately NOT a broader list, so an account that can still sign in can
    // still change its password.
    if (operator.status === 'pending' || operator.status === 'suspended') {
      return refuse(403, 'account_locked', "Ce compte n'est pas actif — contactez le support.")
    }

    // (7) No password at all (SSO / seed / sign-in-by-link accounts). Distinct and
    // HONEST: there is nothing to verify and nothing to replace, and the reset-email
    // flow cannot help either — /api/auth/forgot-password mails a link only when
    // `operator.password` is non-null, so pointing the user at it would promise an
    // email that is never sent.
    if (operator.password === null) {
      return refuse(
        403,
        'no_password',
        "Ce compte n'utilise pas de mot de passe (connexion par lien e-mail ou via un service externe) : il n'y a pas de mot de passe à changer ici.",
      )
    }

    // (8) PROOF OF IDENTITY — the current password. try/catch because a malformed
    // stored hash makes bcrypt throw, and a throw must read as "not verified",
    // never as "verified" (the same defensive shape as lib/auth.ts:88-95).
    let currentOk = false
    try {
      currentOk = await bcrypt.compare(currentPassword, operator.password)
    } catch {
      currentOk = false
    }
    // (9) Wrong (or unverifiable) current password → refuse. Nothing is written.
    if (!currentOk) {
      return refuse(400, 'invalid_current', 'Mot de passe actuel incorrect.')
    }

    // (10) A "change" that changes nothing is refused — it would send a security
    // e-mail about an event that did not happen. Checked on the plaintext, after
    // (9), so a wrong current password never reveals this.
    if (newPassword === currentPassword) {
      return refuse(400, 'same_as_current', "Le nouveau mot de passe doit être différent de l'actuel.")
    }

    // (11) Hash at the app-wide cost (12). Only the hash is ever stored. Computed
    // BEFORE the transaction on purpose: bcrypt at cost 12 takes ~0.3 s and a
    // transaction must not be held open for work that does not need to be in it.
    const hashed = await bcrypt.hash(newPassword, 12)

    // (12) + (13) ONE ATOMIC WRITE. The new hash and the destruction of every
    // pending `pwreset:<email>` token are a single security fact, so they commit
    // together or not at all.
    //
    // The purge used to be best-effort (`.catch(() => {})`) and that was WRONG: a
    // reset link issued BEFORE the change would have survived it, and its holder
    // could then overwrite the password the owner had just chosen. A silent failure
    // of a security property is not a tolerable failure. If either statement fails,
    // Prisma rolls BOTH back, the catch below answers 500, and no security e-mail is
    // sent — so nothing is reported as changed that did not change. The generic
    // « Impossible de mettre à jour le mot de passe — réessayez. » the screen shows
    // on a 500 is therefore true, which it would not have been before.
    //
    // ⭐ The identifier is NORMALISED exactly as the routes that MINT the token do
    // (`/api/auth/forgot-password` and `/api/auth/reset-password` both key it on
    // `email.trim().toLowerCase()`), NOT on the raw DB column. Nothing lowercases
    // `Operator.email` at registration, so an account stored as `Alex@Example.com`
    // has its tokens under `pwreset:alex@example.com`: purging the raw value would
    // match zero rows, NOT throw, and still commit and answer 200 — a silent purge
    // failure of exactly the kind this transaction exists to prevent. Whether that
    // bite is real depends on the column collation, which this repository cannot
    // settle; normalising is correct under either collation.
    const resetIdentifier = `pwreset:${operator.email.trim().toLowerCase()}`
    await prisma.$transaction(async (tx) => {
      await tx.operator.update({ where: { id: operator.id }, data: { password: hashed } })
      await tx.verificationToken.deleteMany({ where: { identifier: resetIdentifier } })
    })

    // (14) Security notice — BEST-EFFORT, OUTSIDE the transaction, and NOT AWAITED.
    // The change is committed, so nothing here may turn it into an error the user
    // would retry; an e-mail cannot be rolled back either.
    //   • not awaited: the SMTP transport declares no connection/greeting/socket
    //     timeout (lib/transactional-emails.ts), so a relay that accepts the socket
    //     and then stalls would block this handler AFTER the commit until the
    //     request is cut — reporting a committed change as a failure, which is the
    //     very misreport this lot exists to remove, just in the other direction.
    //     A `.catch` survives a rejection; it does not survive a hang.
    //   • wrapped in try/catch as well: `.catch` is only reachable if the sender
    //     returns a thenable. Were it ever to stop being `async` (a file this lot
    //     must not touch), a synchronous throw — or a non-thenable return, which
    //     makes `.catch` itself a TypeError — would land in the handler's catch and
    //     answer 500 on EVERY successful password change.
    // The send still starts before the response, and the sender records its own
    // outcome in EmailLog (trigger `password_changed`), which is where a missing
    // notice has to be looked for. (operator.name is non-null but may be empty.)
    try {
      void sendPasswordChangedEmail({ to: operator.email, name: operator.name || 'client' })
        .catch(() => {})
    } catch {
      /* swallowed on purpose: the password IS changed */
    }

    // (15) Done. `sessionsRevoked: false` is the honest machine form of what the
    // screen tells the user: this build cannot sign other devices out.
    return NextResponse.json({ ok: true, sessionsRevoked: false })
  } catch (err) {
    // Class/code ONLY — never the message (see the logging rule in the header).
    const name = err instanceof Error ? err.name : typeof err
    const code = (err as { code?: unknown })?.code
    console.error('[POST /api/account/password] failed', name, typeof code === 'string' ? code : '')
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
