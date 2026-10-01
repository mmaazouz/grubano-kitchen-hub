import { prisma } from '@/lib/prisma'
import { parseSheet, type DishSheet } from '@/lib/dish-sheet'

// ── Tolerant sheet readers (Mission 6 — SERVER ONLY) ───────────────────────────
// Exact M2 roles pattern: the sheet column lives behind a DEDICATED explicit
// select so the pre-db-push window degrades to « no sheet » instead of a 500.
// Kept out of lib/dish-sheet.ts so the (client) editor can import the pure
// score/type module without dragging prisma into the browser bundle.

/**
 * Read the sheet column for many dishes in ONE explicit select. Column not
 * migrated yet → the select throws → EMPTY map (callers treat a missing entry
 * as a null sheet — the legacy state). Never throws.
 */
export async function readDishSheets(dishIds: string[]): Promise<Map<string, DishSheet | null>> {
  const out = new Map<string, DishSheet | null>()
  const ids = Array.from(new Set(dishIds)).filter(Boolean)
  if (ids.length === 0) return out
  try {
    const rows = await prisma.creatorDish.findMany({
      where:  { id: { in: ids } },
      select: { id: true, sheet: true },
    })
    for (const r of rows) out.set(r.id, parseSheet(r.sheet))
    return out
  } catch {
    return out
  }
}

/** Single-dish variant of readDishSheets. */
export async function readDishSheet(dishId: string): Promise<DishSheet | null> {
  return (await readDishSheets([dishId])).get(dishId) ?? null
}
