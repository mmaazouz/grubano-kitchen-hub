import { prisma } from '@/lib/prisma'
import {
  vetDish, VET_REASON_LABELS,
  type VetDishInput, type VetDishResult, type VetReasonCode,
} from '@/lib/creator-vetting'

// ── Recipe submission vetting orchestrator (Mission 3 → hardened Mission 7) ────
//
// One shared path for every submission of recipe CONTENT (create-and-submit,
// PATCH on an approved recipe, explicit submit). M7 order of operations:
//   1. FREE pre-Claude checks (no API cost):
//      a. anti-pub regex (1.2)            → reject advertising
//      b. minimum quality bounds (1.7)    → flag   low_quality
//      c. internal duplicate vs OTHER creators' approved/pending dishes (1.6a)
//                                         → reject duplicate_internal
//   2. Claude vetDish v2 (authenticity, appropriateness, IP, photo coherence,
//      signatureScore) — structured verdict.
// Mapping kept: pass → 'approved' · flag → 'pending' · reject → 'rejected'.
// vetDish never throws (technical failure → 'flag' → 'pending'): a vetting
// outage NEVER blocks the creator, and NEVER auto-approves.
// The reason is still NOT persisted (M3 choice) — it travels in the response.

export type DishVetOutcome = {
  status:          'approved' | 'pending' | 'rejected'
  /** Human-readable French line for the existing toast (label — detail). */
  reason:          string
  /** Structured code (M7) — the UI/i18n can map it; absent on plain pass. */
  reasonCode?:     VetReasonCode
  detail?:         string
  /** 0-100 générique↔signature — shown soberly to the creator. */
  signatureScore?: number
}

// ── Env-overridable sanity bounds (1.7) ────────────────────────────────────────
export const DISH_PRICE_MIN_EUR = Number(process.env.DISH_PRICE_MIN_EUR) || 3
export const DISH_PRICE_MAX_EUR = Number(process.env.DISH_PRICE_MAX_EUR) || 200
const MIN_DESCRIPTION_CHARS = 30
const MIN_INGREDIENTS       = 2

// ── 1.2 anti-pub — FREE regex check BEFORE Claude (the prompt judges too) ──────
// Reasonable catch-net: external links, bare domains, FR phone numbers,
// third-party promo codes, « visitez mon site » style CTAs.
const AD_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /https?:\/\/\S+/i,                                   what: 'lien externe' },
  { re: /\bwww\.\S+/i,                                       what: 'lien externe' },
  { re: /\b[\w-]+\.(?:com|fr|net|org|io|shop|store|link)\b/i, what: 'lien externe' },
  { re: /(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/,             what: 'numéro de téléphone' },
  { re: /\bcode\s*promo\b/i,                                 what: 'code promo tiers' },
  { re: /visite[zr]\s+(?:mon|notre|ma)\s+\w+/i,              what: 'appel à visiter un site' },
  { re: /\babonne[z]?[\s-]*(?:vous|toi)\b/i,                 what: 'appel à s’abonner' },
]

/** Returns what was detected (French), or null when the texts are clean. */
export function detectAdvertising(texts: Array<string | undefined>): string | null {
  const joined = texts.filter(Boolean).join('\n')
  if (!joined) return null
  for (const { re, what } of AD_PATTERNS) {
    const m = joined.match(re)
    if (m) return `${what} (« ${m[0].slice(0, 60)} »)`
  }
  return null
}

// ── 1.7 minimum quality — FREE bounds check BEFORE Claude ──────────────────────

/** Returns a precise French detail, or null when the minimum bar is met. */
export function checkQualityMin(input: Pick<VetDishInput, 'description' | 'ingredients' | 'suggestedPrice'>): string | null {
  const desc = (input.description ?? '').trim()
  if (desc.length < MIN_DESCRIPTION_CHARS) {
    return `description trop courte (${desc.length} caractères, minimum ${MIN_DESCRIPTION_CHARS})`
  }
  const ings = (input.ingredients ?? []).filter(Boolean)
  if (ings.length < MIN_INGREDIENTS) {
    return `${ings.length} ingrédient${ings.length > 1 ? 's' : ''} seulement (minimum ${MIN_INGREDIENTS})`
  }
  const price = input.suggestedPrice
  if (!Number.isFinite(price) || price < DISH_PRICE_MIN_EUR || price > DISH_PRICE_MAX_EUR) {
    return `prix conseillé hors bornes (${price} € — attendu entre ${DISH_PRICE_MIN_EUR} € et ${DISH_PRICE_MAX_EUR} €)`
  }
  return null
}

// ── 1.6a internal duplicate — FREE heuristic BEFORE Claude ─────────────────────
// Simple, commented heuristic:
//   • same NORMALIZED name (lowercase, accents stripped, non-alphanumeric
//     collapsed) → duplicate;
//   • OR strong combined similarity: name-token Jaccard ≥ 0.6 AND
//     ingredient-token Jaccard ≥ 0.6 — BOTH axes must agree (a near-identical
//     name with a near-identical ingredient list is a copy; a single shared
//     name word — « Burger truffe » vs « Salade truffe », 0.33 — is not).

export function normalizeName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  a.forEach((x) => { if (b.has(x)) inter++ })
  return inter / (a.size + b.size - inter)
}

const tokens = (s: string) => new Set(normalizeName(s).split(' ').filter(Boolean))
const ingTokens = (ings: string[]) =>
  new Set((ings ?? []).flatMap(i => normalizeName(i).split(' ')).filter(Boolean))

export function isDuplicateOf(
  candidate: { name: string; ingredients: string[] },
  other:     { name: string; ingredients: string[] },
): boolean {
  const nameA = normalizeName(candidate.name)
  const nameB = normalizeName(other.name)
  if (nameA && nameA === nameB) return true
  const nameSim = jaccard(tokens(candidate.name), tokens(other.name))
  const ingSim  = jaccard(ingTokens(candidate.ingredients), ingTokens(other.ingredients))
  return nameSim >= 0.6 && ingSim >= 0.6
}

// ── Outcome composition ─────────────────────────────────────────────────────────

function composeReason(code: VetReasonCode | undefined, detail: string | undefined): string {
  if (!code) return detail ?? 'ok'
  const label = VET_REASON_LABELS[code]
  return detail ? `${label} — ${detail}` : label
}

function fromVerdict(v: VetDishResult): DishVetOutcome {
  return {
    status: v.verdict === 'pass' ? 'approved' : v.verdict === 'reject' ? 'rejected' : 'pending',
    reason: composeReason(v.reasonCode, v.detail),
    reasonCode:     v.reasonCode,
    detail:         v.detail,
    signatureScore: v.signatureScore,
  }
}

/**
 * Full vetting pipeline. `opts.creatorId` enables the internal-duplicate check
 * (compared against OTHER creators' approved/pending dishes, the dish itself
 * excluded via `opts.excludeDishId`). Both optional → the check is skipped
 * (defensive: a DB error also skips it — Claude still judges everything else).
 */
export async function runDishVetting(
  content: VetDishInput,
  opts: { creatorId?: string; excludeDishId?: string } = {},
): Promise<DishVetOutcome> {
  // 1.2 — anti-pub regex (free, before any API cost).
  const ad = detectAdvertising([
    content.name, content.description, content.story, content.platingNotes,
    ...(content.ingredients ?? []),
  ])
  if (ad) {
    return {
      status: 'rejected',
      reason: composeReason('advertising', ad),
      reasonCode: 'advertising',
      detail: ad,
    }
  }

  // 1.7 — minimum quality bounds (free).
  const quality = checkQualityMin(content)
  if (quality) {
    return {
      status: 'pending',
      reason: composeReason('low_quality', quality),
      reasonCode: 'low_quality',
      detail: quality,
    }
  }

  // 1.6a — internal duplicate vs OTHER creators (free, best-effort on DB error).
  if (opts.creatorId) {
    try {
      const others = await prisma.creatorDish.findMany({
        where: {
          status:    { in: ['approved', 'pending'] },
          creatorId: { not: opts.creatorId },
          ...(opts.excludeDishId ? { id: { not: opts.excludeDishId } } : {}),
        },
        select: { name: true, ingredients: true },
      })
      for (const o of others) {
        const oIngs = (Array.isArray(o.ingredients) ? o.ingredients : []) as string[]
        if (isDuplicateOf({ name: content.name, ingredients: content.ingredients }, { name: o.name, ingredients: oIngs })) {
          const detail = `très proche de « ${o.name} » déjà au catalogue`
          return {
            status: 'rejected',
            reason: composeReason('duplicate_internal', detail),
            reasonCode: 'duplicate_internal',
            detail,
          }
        }
      }
    } catch (err) {
      // The duplicate check is an extra net — never a blocker on DB hiccup.
      console.error('[dish-submit] duplicate check skipped', err instanceof Error ? err.message : err)
    }
  }

  // 2 — Claude v2 (authenticity, appropriateness, IP, photo, signature).
  return fromVerdict(await vetDish(content))
}
