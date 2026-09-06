// ── Auth e-mail copy facts (email truthfulness hotfix, 2026-09-06) ────────────────────
// Validity sentences are DERIVED from the code contracts, never typed by hand:
//   • magic link  → lib/magic-link.ts  MAGIC_TTL_MS = 15 min
//   • 6-digit code → lib/email-otp.ts   OTP_TTL_MS   = 10 min
// The combined e-mail used to say « ce lien et ce code sont valables 15 minutes » (the code
// lives 10). The two mechanisms have DIFFERENT lifetimes and the sentence must say so.
import { OTP_TTL_MS } from '@/lib/email-otp'
import { MAGIC_TTL_MS } from '@/lib/magic-link'

export const MAGIC_LINK_MINUTES = Math.round(MAGIC_TTL_MS / 60_000)
export const OTP_CODE_MINUTES   = Math.round(OTP_TTL_MS / 60_000)

export function magicLinkValiditySentence(withCode: boolean): string {
  return withCode
    ? `Ce lien est valable ${MAGIC_LINK_MINUTES} minutes et ce code ${OTP_CODE_MINUTES} minutes ; chacun ne fonctionne qu'une seule fois.`
    : `Ce lien est valable ${MAGIC_LINK_MINUTES} minutes et ne fonctionne qu'une seule fois.`
}
