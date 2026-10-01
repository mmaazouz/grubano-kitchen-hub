// lib/claims-pay-token.ts — the dryRun → PAYER token of the claims financial rail (D′ L5, spec v2 §8.2).
//
// WHAT IT IS FOR. PAYER never re-selects the queue. It pays exactly the claims a dryRun showed an
// admin, at exactly the amounts that dryRun showed, and nothing else. The list therefore has to
// travel from the dryRun response back into the PAYER request — through the browser, which is not
// trusted. The token is that list, signed: the server can prove the batch it is being asked to pay
// is the batch it itself computed, for this admin, on this build, minutes ago.
//
// STATELESS ON PURPOSE. No table, no cache, no cleanup job, and nothing to get out of sync with a
// restart: the signature IS the state. A consumed token is not revoked — replaying one is harmless
// because every item is re-read and re-checked against its signed identity before anything is
// attempted (`skipped:stale_dryrun`), and a claim the rail already paid no longer matches.
//
// WHAT THE SIGNATURE BINDS, and why each field is load-bearing:
//   v       — the token format. A future format never validates under this one.
//   adminId — the human who ran the dryRun. Another admin's token is refused: an approval to pay is
//             not transferable, and the audit trail must name the person who saw the numbers.
//   sha     — the deployed build (public/version.json). A deploy restarts the process; a token
//             minted by the previous build is refused rather than replayed against different code.
//   iat/exp — 10 minutes, checked both ways: expired, and « a TTL longer than the compiled maximum »
//             (a token that claims a longer life is a forgery attempt or a bug, never authority).
//   lease   — the REFUNDS window deadline as the dryRun read it, carried for the console and the
//             report. It is NEVER authority: the rail re-reads refundGateState() before each claim.
//   items   — {claimId, approvedAmountCents, arbitratedAt} per claim: WHICH claim, at WHICH amount,
//             decided at WHICH instant. If any of the three moved, that item is skipped.
//
// THE KEY IS DERIVED, NEVER THE RAW SECRET. HMAC(NEXTAUTH_SECRET, 'claims-pay-approved-v1') is the
// signing key: a token of this rail can never be replayed as a magic link, a verification code or an
// unsubscribe link, and none of those can be replayed here. The secret and the derived key are never
// logged, never returned, and never part of an error message.
import { createHmac } from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeEqual } from '@/lib/safe-compare'
import { MAX_BATCH } from '@/lib/claims-payable-core'

export const PAY_TOKEN_VERSION = 1 as const
/** Spec v2 §8.2: « validité 10 min ». Compiled: a token cannot ask for longer. */
export const PAY_TOKEN_TTL_MS = 10 * 60 * 1000
/** The derivation context. Changing it invalidates every outstanding token by construction. */
export const PAY_TOKEN_CONTEXT = 'claims-pay-approved-v1'
/** Tolerated forward clock skew between the signing and the verifying read of the same clock. */
export const CLOCK_SKEW_MS = 60_000

export interface PayTokenItem {
  claimId: string
  approvedAmountCents: number
  /** ISO instant of the decision, or null when the claim carries none. */
  arbitratedAt: string | null
}

export interface PayTokenPayload {
  v: typeof PAY_TOKEN_VERSION
  adminId: string
  sha: string
  iat: number
  exp: number
  lease: string | null
  /**
   * S-14b: true when an ADMIN NAMED the claims of this batch. It is signed because it decides, at PAYER,
   * whether a v13 payable proof is acceptable — a claim that acquired such a proof between the dryRun and
   * the payment must not be paid by a batch nobody named claim by claim.
   */
  explicit: boolean
  items: PayTokenItem[]
}

export type PayTokenVerdict =
  | { ok: true; payload: PayTokenPayload }
  | {
      ok: false
      reason:
        | 'missing'          // no token in the request
        | 'no_secret'        // NEXTAUTH_SECRET unset/empty — nothing can be trusted, refuse
        | 'malformed'        // not payload.signature, not base64url, not the expected JSON shape
        | 'bad_signature'    // the payload was altered, or signed with another key
        | 'wrong_version'
        | 'expired'
        | 'ttl_too_long'     // exp − iat beyond the compiled maximum
        | 'not_yet_valid'    // minted in the future: a clock jump must not extend the usable window
        | 'wrong_admin'      // minted for another admin
        | 'wrong_build'      // minted by another deployed build
        | 'no_items'
        | 'too_many_items'
    }

/** Empty ⇒ nothing may be signed or verified: an empty key authorises everyone. */
function signingKey(): Buffer | null {
  const secret = (process.env.NEXTAUTH_SECRET ?? '').trim()
  if (!secret) return null
  return createHmac('sha256', secret).update(PAY_TOKEN_CONTEXT).digest()
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let shaCache: string | null = null
/**
 * The commit this process is serving, from public/version.json (written by the deploy, never by the
 * repo). Unreadable — a dev tree, a local run — answers 'unknown', which is a VALUE like any other:
 * a token minted by a process that reads 'unknown' verifies only in a process that also reads
 * 'unknown'. Cached: the file cannot change without a restart.
 */
export function deployedSha(): string {
  if (shaCache !== null) return shaCache
  try {
    const raw = readFileSync(join(process.cwd(), 'public', 'version.json'), 'utf8')
    const commit = (JSON.parse(raw) as { commit?: unknown }).commit
    shaCache = typeof commit === 'string' && commit.trim() ? commit.trim() : 'unknown'
  } catch {
    shaCache = 'unknown'
  }
  return shaCache
}

/** Tests only: forget the cached build id so a fixture can change it. */
export function __resetDeployedShaCache(): void {
  shaCache = null
}

export class PayTokenSecretMissing extends Error {
  constructor() {
    super('NEXTAUTH_SECRET is not set: the pay-approved token cannot be signed.')
    this.name = 'PayTokenSecretMissing'
  }
}

/** A batch the verifier would refuse wholesale. Minting it would hand an admin a list that cannot be paid. */
export class PayTokenInvalidBatch extends Error {
  constructor(readonly why: string) {
    super(`the pay-approved batch cannot be signed: ${why}`)
    this.name = 'PayTokenInvalidBatch'
  }
}

/**
 * Mint the token for a dryRun result. Throws rather than returning an unsigned or unusable string: a
 * rail that hands out unsigned authority is worse than one that refuses, and a token the verifier will
 * reject wholesale is worse still — the admin would be told « nothing is payable » about a batch that
 * mostly was. The mint therefore asserts exactly what `verifyPayToken` requires of the items, so the
 * two halves of this file cannot disagree with each other.
 */
export function signPayToken(input: {
  adminId: string
  items: PayTokenItem[]
  lease: string | null
  nowMs: number
  explicit?: boolean
  sha?: string
}): string {
  const key = signingKey()
  if (!key) throw new PayTokenSecretMissing()
  if (!Array.isArray(input.items) || input.items.length === 0) throw new PayTokenInvalidBatch('no items')
  if (input.items.length > MAX_BATCH) throw new PayTokenInvalidBatch(`${input.items.length} items exceeds the batch cap`)
  for (const it of input.items) {
    if (!it || typeof it.claimId !== 'string' || !it.claimId) throw new PayTokenInvalidBatch('an item without a claim')
    if (!Number.isInteger(it.approvedAmountCents) || it.approvedAmountCents <= 0) throw new PayTokenInvalidBatch('an item without a positive integer amount')
    if (it.arbitratedAt !== null && typeof it.arbitratedAt !== 'string') throw new PayTokenInvalidBatch('an item with an unreadable decision instant')
  }
  const payload: PayTokenPayload = {
    v:       PAY_TOKEN_VERSION,
    adminId: input.adminId,
    sha:     input.sha ?? deployedSha(),
    iat:     input.nowMs,
    exp:     input.nowMs + PAY_TOKEN_TTL_MS,
    lease:   input.lease,
    explicit: input.explicit === true,
    items:   input.items,
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const mac = b64url(createHmac('sha256', key).update(body).digest())
  return `${body}.${mac}`
}

/**
 * Verify a token against THIS admin, THIS build and THIS instant. Order matters: the signature is
 * checked before anything inside the payload is believed, so no claim of the payload — not even its
 * version — can steer the verification of an unsigned string.
 */
export function verifyPayToken(
  token: string | null | undefined,
  ctx: { adminId: string; nowMs: number; sha?: string },
): PayTokenVerdict {
  if (typeof token !== 'string' || !token.trim()) return { ok: false, reason: 'missing' }
  const key = signingKey()
  if (!key) return { ok: false, reason: 'no_secret' }

  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' }
  const body = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(mac)) return { ok: false, reason: 'malformed' }

  const expected = b64url(createHmac('sha256', key).update(body).digest())
  if (!safeEqual(mac, expected)) return { ok: false, reason: 'bad_signature' }

  let payload: PayTokenPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PayTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'malformed' }
  if (payload.v !== PAY_TOKEN_VERSION) return { ok: false, reason: 'wrong_version' }
  if (typeof payload.adminId !== 'string' || typeof payload.sha !== 'string') return { ok: false, reason: 'malformed' }
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return { ok: false, reason: 'malformed' }
  // Absent or non-boolean ⇒ NOT explicit: a token that does not say it was named claim by claim is treated
  // as the automatic batch, which is the stricter reading (S-14b).
  if (typeof payload.explicit !== 'boolean') payload.explicit = false
  if (!Array.isArray(payload.items)) return { ok: false, reason: 'malformed' }
  for (const it of payload.items) {
    if (!it || typeof it.claimId !== 'string' || !it.claimId) return { ok: false, reason: 'malformed' }
    if (!Number.isInteger(it.approvedAmountCents) || it.approvedAmountCents <= 0) return { ok: false, reason: 'malformed' }
    if (it.arbitratedAt !== null && typeof it.arbitratedAt !== 'string') return { ok: false, reason: 'malformed' }
  }

  if (payload.exp - payload.iat > PAY_TOKEN_TTL_MS) return { ok: false, reason: 'ttl_too_long' }
  // A token minted in the future would be usable for more than ten real minutes: a clock that jumped
  // forward on the signing process must not extend the window. One minute of tolerated skew, no more.
  if (payload.iat > ctx.nowMs + CLOCK_SKEW_MS) return { ok: false, reason: 'not_yet_valid' }
  if (ctx.nowMs >= payload.exp) return { ok: false, reason: 'expired' }
  if (!safeEqual(payload.adminId, ctx.adminId)) return { ok: false, reason: 'wrong_admin' }
  if (!safeEqual(payload.sha, ctx.sha ?? deployedSha())) return { ok: false, reason: 'wrong_build' }
  if (payload.items.length === 0) return { ok: false, reason: 'no_items' }
  if (payload.items.length > MAX_BATCH) return { ok: false, reason: 'too_many_items' }

  return { ok: true, payload }
}
