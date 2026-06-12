import { vetDish, type VetDishInput } from '@/lib/creator-vetting'

// ── Recipe submission verdict mapper (Mission 3 Creator Studio) ────────────────
//
// One shared mapping for every path that submits recipe CONTENT to vetting
// (create-and-submit, PATCH on an approved recipe, explicit submit):
//   pass   → 'approved'  (published to the adoption catalogue)
//   flag   → 'pending'   (manual review — the UI says « En cours de review »)
//   reject → 'rejected'  (+ reason surfaced to the UI; not persisted — no
//                          schema field fits without a migration, choice noted)
// vetDish never throws (technical failure → 'flag' → 'pending'): a vetting
// outage NEVER blocks the creator.

export type DishVetOutcome = {
  status: 'approved' | 'pending' | 'rejected'
  reason: string
}

export async function runDishVetting(content: VetDishInput): Promise<DishVetOutcome> {
  const v = await vetDish(content)
  return {
    status: v.verdict === 'pass' ? 'approved' : v.verdict === 'reject' ? 'rejected' : 'pending',
    reason: v.reason,
  }
}
