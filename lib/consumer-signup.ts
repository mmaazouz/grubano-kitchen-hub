import { prisma } from '@/lib/prisma'

// ── Consumer PRE-LOGIN provisioning (Agent 132 — account-AT-payment, brick 2c) ──────
//
// Find-or-create a PASSWORDLESS, ACTIVE Operator with role 'consumer' for `email`, so the
// EXISTING passwordless rail (POST /api/auth/magic-link mint → in-page OTP / magic-link →
// signIn('credentials', …)) can authenticate a brand-NEW buyer AT checkout — WITHOUT touching
// the money route. Calqued on lib/affiliate-signup.ensureAffiliateApplicant, but writes EVEN LESS:
// an existing account is reused with NO mutation at all.
//
// SECURITY (non-negotiable — this provisions accounts pre-login):
//   • Role is ALWAYS 'consumer'. A fresh account is created with role:'consumer',
//     status:'active', NO password. NEVER any elevated role (admin/partner/logistics/affiliate…).
//   • SAFE ON COLLISION: an existing email (ANY role / ANY status) is REUSED AS-IS — NO write
//     whatsoever: password, status and role(s) are never touched (no clobber, no elevation, no
//     role addition). If the existing account is not 'active', the subsequent mint simply fails
//     gracefully (the magic-link route only mints for an active operator) → neutral UI, no leak.
//   • IDEMPOTENT + race-safe: a unique-constraint collision on create (two concurrent provisions
//     for the same fresh email) is caught and re-resolved by re-finding the row.
//   • Best-effort: NEVER throws — a failure degrades to { ok:false } so the caller stays generic
//     (anti-enumeration). Does NOT touch ensureLogisticsOperator / the courier waitlist guardrail.

export type EnsureConsumerResult = { ok: true } | { ok: false; reason: 'error' }

export async function ensureConsumerByEmail(emailRaw: string): Promise<EnsureConsumerResult> {
  const email = (emailRaw ?? '').trim().toLowerCase()
  if (!email) return { ok: false, reason: 'error' }

  try {
    const existing = await prisma.operator.findUnique({ where: { email }, select: { id: true } })
    // Existing account (consumer / restaurant / pending partner / …): REUSE it AS-IS. No write —
    // never clobber password/status/role(s), never elevate. The mint downstream handles the
    // status gate gracefully.
    if (existing) return { ok: true }

    // Fresh email → a PASSWORDLESS consumer login, ACTIVE so the passwordless mint can proceed.
    await prisma.operator.create({
      data: {
        name:   email.split('@')[0] || 'Client',
        email,
        role:   'consumer', // ⭐ consumer ONLY — never an elevated role
        status: 'active',
        // no password — sign-in is passwordless (email OTP / magic-link)
      },
      select: { id: true },
    })
    return { ok: true }
  } catch (err) {
    // A concurrent create for the SAME fresh email loses the unique race → re-resolve idempotently.
    try {
      const found = await prisma.operator.findUnique({ where: { email }, select: { id: true } })
      if (found) return { ok: true }
    } catch { /* fall through to error */ }
    console.error('[ensureConsumerByEmail] provisioning non-fatal:', email, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}
