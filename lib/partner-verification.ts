import crypto from 'crypto'

// ── Partner email-verification tokens (Agent 12, brique 1) ─────────────────────
// A verification token is `${operatorId}.${secret}` where `secret` is 32 random
// bytes (256 bits of entropy). ONLY the SHA-256 of the secret is persisted on the
// Operator row (verifyTokenHash), so a database leak never reveals a usable link.
// Embedding the operatorId in the token lets verify-email look the row up without
// exposing it as a separate query param. SHA-256 (not bcrypt) is correct here:
// the secret is already high-entropy, so a fast cryptographic hash is the
// textbook choice for verification/reset tokens.

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const SECRET_BYTES = 32

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/** Constant-time comparison of two equal-length hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Mint a fresh verification token for an operator. Returns the clear token to
 * email out, the hash to store, and the absolute expiry (now + 24h).
 */
export function createVerificationToken(operatorId: string): {
  token: string
  hash: string
  expiry: Date
} {
  const secret = crypto.randomBytes(SECRET_BYTES).toString('hex')
  return {
    token:  `${operatorId}.${secret}`,
    hash:   sha256(secret),
    expiry: new Date(Date.now() + TOKEN_TTL_MS),
  }
}

/** Split a `${operatorId}.${secret}` token. Returns null when malformed. */
export function parseVerificationToken(
  token: string,
): { operatorId: string; secret: string } | null {
  const i = token.indexOf('.')
  if (i <= 0 || i >= token.length - 1) return null
  return { operatorId: token.slice(0, i), secret: token.slice(i + 1) }
}
