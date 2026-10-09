// ── Growth / merchant — company-level deduplication keys ──────────────────────────────
//
// PURE. The B2B pipeline is useless if two rows for the same company live side-by-side
// (double outreach, double counting in forecast, inconsistent stage). Just as damaging is
// the inverse mistake: merging two legitimately-independent franchises because they share
// a trade name. This module declares the ONE rule the whole pipeline uses to answer "are
// these two prospects the same company?".
//
// Rule, in order of precedence:
//   1. If both rows have a validated SIREN → equal iff SIRENs equal.
//   2. Else if both rows have a canonical bare domain → equal iff domains equal, BUT only
//      if neither domain is a known personal-mailbox / shared-tenant provider (gmail.com
//      etc.). We will NEVER merge "two restaurants whose owners happen to use the same
//      personal gmail".
//   3. Else → NOT the same. Trade name alone is not enough. Franchises share trade names.
//
// A row with no SIREN and no company domain yields a NULL dedupKey — meaning: queue for
// manual review before any outreach. Downstream dedupe code uses `dedupKey === other.dedupKey`;
// a null key must therefore not equal a null key.

import { normalizeDomain, normalizeSiren, isPersonalMailboxDomain } from './normalize'
import type { MerchantProspect } from '../types'

export type DedupKey = string | null

/**
 * Known chain-brand domains in the FR footprint. Two franchisees of the same chain are
 * legally INDEPENDENT companies that both legitimately point mail from the chain's brand
 * domain. Without a SIREN we cannot prove any two such rows describe the SAME entity, so
 * the only safe behaviour is to refuse a shared dedupe key and route each franchisee to
 * review. Fail-closed: a shared chain-brand domain alone must NEVER produce a merge.
 *
 * This list is intentionally small; it covers the chains most likely to appear in a
 * dry-run import. Adding a brand here is a conservative decision — a false positive only
 * forces one more review step, a false negative merges two legally-distinct companies.
 */
export const CHAIN_BRAND_DOMAINS: ReadonlySet<string> = new Set([
  "mcdonalds.fr",
  "burgerking.fr",
  "subway.fr",
  "kfc.fr",
  "quick.fr",
  "dominospizza.fr",
  "pizzahut.fr",
  "starbucks.fr",
  "paulboulangerie.com",
  "brioche-doree.fr",
])

export function isChainBrandDomain(canonical: string): boolean {
  return CHAIN_BRAND_DOMAINS.has(canonical)
}

/**
 * Compute the single canonical dedupe key for a prospect. SIREN wins over domain. Personal
 * mailbox domains never produce a key.
 *
 * The returned string is NAMESPACED (`siren:...` / `domain:...`) so two rows cannot collide
 * across namespaces: a company whose domain happens to be "123456782" (unlikely but we are
 * paranoid) does not match a company whose SIREN is 123456782.
 */
export function dedupKeyForProspect(
  p: Pick<MerchantProspect, 'siren' | 'domain'>,
): DedupKey {
  const siren = normalizeSiren(p.siren)
  if (siren) return `siren:${siren}`
  const dom = normalizeDomain(p.domain)
  if (!dom.ok) return null
  if (isPersonalMailboxDomain(dom.canonical)) return null
  // Chain-brand domain without a SIREN: cannot prove franchisees are the same company.
  // Fail-closed → null key → review bucket, never a merge.
  if (isChainBrandDomain(dom.canonical)) return null
  return `domain:${dom.canonical}`
}

/**
 * Return true iff two prospects are the same company. False means EITHER they are
 * demonstrably different OR we cannot prove they are the same — the caller must treat the
 * latter as "manual review", not as "merge".
 */
export function isSameCompany(
  a: Pick<MerchantProspect, 'siren' | 'domain'>,
  b: Pick<MerchantProspect, 'siren' | 'domain'>,
): boolean {
  const ka = dedupKeyForProspect(a)
  const kb = dedupKeyForProspect(b)
  if (ka === null || kb === null) return false
  return ka === kb
}

/**
 * Group a list of prospects by their canonical dedupe key. Prospects with a null key land
 * in the special bucket `review:<index>` with a unique key per row, so they never
 * accidentally merge. Order of input is preserved within each bucket.
 */
export function groupByCompany<T extends Pick<MerchantProspect, 'siren' | 'domain' | 'id'>>(
  prospects: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  prospects.forEach((p, i) => {
    const k = dedupKeyForProspect(p)
    const key = k ?? `review:${p.id || i}`
    const bucket = out.get(key)
    if (bucket) bucket.push(p)
    else out.set(key, [p])
  })
  return out
}

/**
 * Report a dedupe reason code for a pair of prospects. Useful for the pipeline's audit
 * trail: the dashboard shows WHY two rows merged (or didn't).
 */
export type DedupReason =
  | 'merge_siren'
  | 'merge_domain'
  | 'no_merge_different_siren'
  | 'no_merge_different_domain'
  | 'no_merge_mixed_siren_vs_domain'
  | 'no_merge_personal_mailbox'
  | 'no_merge_chain_brand_without_siren'
  | 'no_merge_missing_identifier'

export function explainDedup(
  a: Pick<MerchantProspect, 'siren' | 'domain'>,
  b: Pick<MerchantProspect, 'siren' | 'domain'>,
): { same: boolean; reason: DedupReason } {
  const sa = normalizeSiren(a.siren)
  const sb = normalizeSiren(b.siren)
  if (sa && sb) {
    return sa === sb
      ? { same: true,  reason: 'merge_siren' }
      : { same: false, reason: 'no_merge_different_siren' }
  }
  const da = normalizeDomain(a.domain)
  const db = normalizeDomain(b.domain)
  const daOk = da.ok ? da.canonical : null
  const dbOk = db.ok ? db.canonical : null
  // Mixed: one side has SIREN, the other only domain. We cannot prove they are the same.
  if ((sa && !sb) || (!sa && sb)) {
    return { same: false, reason: 'no_merge_mixed_siren_vs_domain' }
  }
  if (daOk && dbOk) {
    if (isPersonalMailboxDomain(daOk) || isPersonalMailboxDomain(dbOk)) {
      return { same: false, reason: 'no_merge_personal_mailbox' }
    }
    // Franchise safety: shared chain-brand domain WITHOUT SIREN never merges.
    // We already know neither side has SIREN (we fell past the sa/sb branches).
    if (isChainBrandDomain(daOk) || isChainBrandDomain(dbOk)) {
      return { same: false, reason: 'no_merge_chain_brand_without_siren' }
    }
    return daOk === dbOk
      ? { same: true,  reason: 'merge_domain' }
      : { same: false, reason: 'no_merge_different_domain' }
  }
  return { same: false, reason: 'no_merge_missing_identifier' }
}
