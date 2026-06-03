/**
 * Deterministic, stateless creator-ownership verification code.
 *
 * A creator proves they own the YouTube channel they declared by pasting this
 * code into their channel description. We re-derive the SAME code on demand from
 * the application id — nothing is stored — using an HMAC keyed with the server
 * secret so the code cannot be forged or guessed from the id alone.
 *
 * Format: "GRUBANO-XXXXXX" (6 uppercase base32 chars). Same id + same secret
 * always yields the same code (idempotent verification).
 */

import { createHmac } from 'crypto'

// RFC 4648 base32 alphabet (no padding) — unambiguous uppercase + digits.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const CODE_LEN = 6

/**
 * Build the verification code for an application.
 * Total function: never throws. If NEXTAUTH_SECRET is somehow unset the HMAC
 * uses an empty key (still deterministic) rather than crashing the pipeline.
 */
export function makeVerifyCode(applicationId: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? ''
  const digest = createHmac('sha256', secret).update(String(applicationId)).digest()

  let code = ''
  for (let i = 0; i < CODE_LEN; i++) {
    code += ALPHABET[digest[i] % ALPHABET.length]
  }
  return `GRUBANO-${code}`
}
