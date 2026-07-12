import { prisma } from '@/lib/prisma'

// ── Creator role flags — tolerant reader (Mission 2 Creator Studio) ───────────
//
// isChef / isInfluencer are ADDITIVE columns (default true/true). EVERY caller
// must survive the pre-db-push window: a missing column makes the select throw
// → we fall back to BOTH ROLES ACTIVE (the exact deploy-time default, so
// behaviour is identical before and after the migration).

export type CreatorRoles = { isChef: boolean; isInfluencer: boolean }

export const DEFAULT_ROLES: CreatorRoles = { isChef: true, isInfluencer: true }

/** Read a creator's role flags; missing column / missing row → both true. */
export async function readCreatorRoles(creatorId: string): Promise<CreatorRoles> {
  try {
    const row = await prisma.creator.findUnique({
      where:  { id: creatorId },
      select: { isChef: true, isInfluencer: true },
    })
    if (!row) return { ...DEFAULT_ROLES }
    return { isChef: row.isChef ?? true, isInfluencer: row.isInfluencer ?? true }
  } catch {
    // Column not migrated yet → deploy-time default.
    return { ...DEFAULT_ROLES }
  }
}
