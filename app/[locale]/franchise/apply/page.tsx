import { setRequestLocale } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import ApplyForm from './ApplyForm'
import './franchise-apply.css'

// ── FR8 · Formulaire de candidature public (CD marketing --gb-*) ─────────────────────
// PUBLIC route /franchise/apply (∈ BARE_PREFIXES). Server shell fetches the REAL open
// brands (name) + the REAL network royalty rate, then hands off to the client form island
// wired to POST /api/franchise/apply → FranchiseApplication (admin-approved). Only fields
// the route persists are collected (no false inputs); success state stays honest.

const DEFAULT_ROYALTY = 0.06

async function getOpenBrands(): Promise<string[]> {
  try {
    const rows = await prisma.brand.findMany({
      where:   { openToFranchise: true, NOT: { franchiseStatus: 'full' } },
      select:  { name: true },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(r => r.name).filter(Boolean)
  } catch {
    return []
  }
}

/** Real network royalty rate (integer %) — uniform Brand.royaltyPct across open brands, else
 *  the network default. NEVER a hardcoded marketing 5 %. */
async function getNetworkRatePct(): Promise<number> {
  try {
    const rows = await prisma.brand.findMany({
      where:  { openToFranchise: true, NOT: { franchiseStatus: 'full' } },
      select: { royaltyPct: true },
    })
    const rates = Array.from(new Set(rows.map(r => r.royaltyPct ?? DEFAULT_ROYALTY)))
    const rate = rates.length === 1 ? rates[0] : DEFAULT_ROYALTY
    return Math.round(rate * 100)
  } catch {
    return Math.round(DEFAULT_ROYALTY * 100)
  }
}

export default async function FranchiseApplyPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  const [brands, ratePct] = await Promise.all([getOpenBrands(), getNetworkRatePct()])
  return <ApplyForm brands={brands} ratePct={ratePct} />
}
