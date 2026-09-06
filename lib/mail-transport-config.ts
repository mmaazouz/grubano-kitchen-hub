// ── Mail transport configuration truth (email truthfulness hotfix, 2026-09-06) ─────────
// Every sender in the app authenticates to the SMTP transport with SMTP_PASS; when it is
// absent NOTHING can be sent (the rail logs `skipped`, the inline senders log a miss).
// Routes whose user-facing contract is « un e-mail vient d'être envoyé » must not say so in
// that configuration. This is a GLOBAL config fact, independent of any account, so
// answering 503 leaks nothing about account existence (anti-enumeration preserved).
import { NextResponse } from 'next/server'

export function isMailTransportConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.SMTP_PASS === 'string' && env.SMTP_PASS.length > 0
}

export const MAIL_UNAVAILABLE_MESSAGE =
  "L'envoi d'e-mails est momentanément indisponible. Réessayez dans quelques instants."

/** Honest, account-independent refusal used BEFORE any lookup, mint or write. */
export function mailUnavailableResponse(): NextResponse {
  return NextResponse.json({ ok: false, error: MAIL_UNAVAILABLE_MESSAGE, reason: 'mail_unavailable' }, { status: 503 })
}
