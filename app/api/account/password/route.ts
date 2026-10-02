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
// SESSIONS ARE NOT REVOKED. lib/auth.ts uses `session: { strategy: 'jwt' }`: no
// server-side session row exists to delete, so a token already issued stays valid
// until it expires. The response says so, and the screen repeats it — the one thing
// this endpoint must not do is imply other devices were signed out.
//
// 🔒 NEVER LOG the current password, the new password, the bcrypt hash or a reset
// token — not even inside an error. That includes NOT logging `err.message`: a
// Prisma validation error embeds the failing invocation's arguments, which on this
// route is `data: { password: <hash> }`. Only the error's class/code is logged.

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

    // (11) + (12) Hash at the app-wide cost (12) and write. Only the hash is stored.
    const hashed = await bcrypt.hash(newPassword, 12)
    await prisma.operator.update({ where: { id: operator.id }, data: { password: hashed } })

    // (13) Any pending reset link for this account is now stale: the holder of an
    // e-mail from before the change must not be able to overwrite the password the
    // owner just chose. Consume every token of the identifier, exactly as
    // /api/auth/reset-password does on success. Best-effort: the password IS already
    // changed, and failing the request here would misreport a completed change.
    await prisma.verificationToken
      .deleteMany({ where: { identifier: `pwreset:${operator.email}` } })
      .catch(() => {})

    // (14) Security notice — BEST-EFFORT. The change is committed; an SMTP fault
    // must not turn a successful change into an error the user would retry.
    // (operator.name is non-null in the schema but may be empty.)
    await sendPasswordChangedEmail({ to: operator.email, name: operator.name || 'client' })
      .catch(() => {})

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
