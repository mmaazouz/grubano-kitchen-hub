import { prisma } from '@/lib/prisma'

// ── Account-level company identity (B1.1, Agent 29) ───────────────────────────
//
// SERVER-ONLY read/write of the company-identity anchor on Operator (siren,
// officialName, legalForm, kybStatus, kybVerifiedAt). This is the future
// "collect once" home for business identity, to be populated by the verification
// flows of B1.3 / Phase 4.
//
// SECURITY: this helper writes ONLY the five company-identity columns — never
// role / status / email / password / financial fields — via a field-by-field
// whitelist, so it cannot be used to escalate an account. It is NOT a
// user-editable surface: there is no route or UI that calls it, and the
// company-identity fields are deliberately ABSENT from the P5 profile whitelists.
// `kybStatus` is set by trusted server verification flows, never by user input.
//
// INERT in this brick: nothing calls these functions yet (B1.3 will). Keeping it
// here + tested means the model foundation is ready and proven before it is wired.

export interface OperatorCompanyIdentity {
  siren:         string | null
  officialName:  string | null
  legalForm:     string | null
  kybStatus:     string | null
  kybVerifiedAt: Date | null
}

/** Fields a server-side verification flow may record. Intentionally limited to
 *  the company-identity columns; passing anything else has no effect. */
export interface SetCompanyIdentityInput {
  siren?:         string | null
  officialName?:  string | null
  legalForm?:     string | null
  kybStatus?:     string | null
  kybVerifiedAt?: Date | null
}

const IDENTITY_SELECT = {
  siren:         true,
  officialName:  true,
  legalForm:     true,
  kybStatus:     true,
  kybVerifiedAt: true,
} as const

function toIdentity(row: OperatorCompanyIdentity): OperatorCompanyIdentity {
  return {
    siren:         row.siren ?? null,
    officialName:  row.officialName ?? null,
    legalForm:     row.legalForm ?? null,
    kybStatus:     row.kybStatus ?? null,
    kybVerifiedAt: row.kybVerifiedAt ?? null,
  }
}

/**
 * Read the account-level company identity for an operator (owner-scoped: the
 * caller passes the resolved operator id, never a client-supplied one). Returns
 * null if the operator does not exist; absent columns come back as null.
 */
export async function getOperatorCompanyIdentity(
  operatorId: string,
): Promise<OperatorCompanyIdentity | null> {
  if (!operatorId) return null
  const row = await prisma.operator.findUnique({
    where:  { id: operatorId },
    select: IDENTITY_SELECT,
  })
  return row ? toIdentity(row) : null
}

/**
 * Record a verified company identity on an account. WHITELISTED: only the five
 * identity columns are ever written — no role/status/email/password/financial
 * escalation is possible, even if a caller passes extra keys. Intended for
 * trusted SERVER-side KYB flows only (B1.3 / Phase 4), never a user input path.
 */
export async function setVerifiedCompanyIdentity(
  operatorId: string,
  input: SetCompanyIdentityInput,
): Promise<OperatorCompanyIdentity> {
  if (!operatorId) throw new Error('setVerifiedCompanyIdentity: operatorId is required')

  // Build the update payload field-by-field so ONLY company-identity columns can
  // ever reach prisma.operator.update — the security boundary of this helper.
  const data: SetCompanyIdentityInput = {}
  if (input.siren !== undefined)         data.siren = input.siren
  if (input.officialName !== undefined)  data.officialName = input.officialName
  if (input.legalForm !== undefined)     data.legalForm = input.legalForm
  if (input.kybStatus !== undefined)     data.kybStatus = input.kybStatus
  if (input.kybVerifiedAt !== undefined) data.kybVerifiedAt = input.kybVerifiedAt

  const row = await prisma.operator.update({
    where:  { id: operatorId },
    data,
    select: IDENTITY_SELECT,
  })
  return toIdentity(row)
}
