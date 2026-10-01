// lib/claim-selection.ts — L7 (T-50): WHAT THE CUSTOMER CHOSE, recorded and never re-derived.
//
// THE DEFECT THIS FILE CLOSES. Until L7 a claim kept only a number: `requestedAmountCents`. The
// scope the customer had in mind, the lines they pointed at, the quantities they disputed and the
// ceiling that was known when they filed were all computed, used once, and thrown away. Three
// consequences, all measured:
//   • a claim for ONE dish and a claim for the WHOLE order were indistinguishable afterwards — the
//     restaurant, the admin and the customer read the same bare figure and each supplied their own
//     story for it ;
//   • « whole order » was the SILENT default. `ClaimSection` opened with `wholeOrder = true` on an
//     ITEM_OPTIONAL reason, so a customer could claim an entire order without one deliberate
//     gesture, and the server accepted that silence as a choice ;
//   • a stale UI value survived a change of mind. Ticking two dishes, then switching to a reason
//     where items are not asked for, left the picked lines in React state — and the body still sent
//     them, silently suppressing the amount the customer had just typed.
//
// WHAT IS RECORDED, AND WHAT IS NOT. The snapshot is a FROZEN statement of the request, written once
// at creation and never rewritten (lib/claims: write-on-create, pinned by a test). It carries only
// what the SERVER derived: line names, unit prices and purchased quantities come from the stored
// order, whose prices were re-written from the database at order creation. It carries no Stripe id,
// no PaymentIntent id, no secret, and not one number the client sent — a client price is not merely
// ignored, it never reaches this module.
//
// WHAT IT IS NOT FOR. It is TRACEABILITY, not authority. It creates no new right and no new refusal:
// a quantity recorded in an earlier claim is never subtracted from a later one (invariant S-26 —
// founder decision, the ANTI-REPEAT ITEM CLAIM POLICY is post-beta debt). The financial ceiling and
// the eligibility rules are unchanged by anything in here.
//
// LEGACY. `selection = null` is the honest state of every claim filed before L7, and it means
// « not recorded ». It must be rendered as such and must NEVER be read as « the whole order »: that
// substitution would invent a scope for nine existing rows and change what they mean. `readClaimSelection`
// therefore returns null for anything it cannot fully trust, and no caller may fall back to a mode.

import type { ClaimScopeLine } from '@/lib/claim-scope'
import { scopeRequirement, CLAIM_SCOPE_MODES, type ScopeRequirement, type ClaimScopeMode } from '@/lib/claim-reasons'

// The mode itself is declared in lib/claim-reasons, beside the matrix that decides which reason may
// use which mode — so the module that PRICES a mode and the module that RECORDS one can both import
// it without importing each other. Re-exported here because this is where callers look for it.

/** Bumped only if the shape changes. A reader that does not know a version returns null, never a guess. */
export const CLAIM_SELECTION_VERSION = 1 as const

export type { ClaimScopeMode }
export { CLAIM_SCOPE_MODES }
/** Who decided the mode: the customer, the reason itself, or Grubano for a system claim. */
export type ClaimScopeModeSource = 'client' | 'derived' | 'system'

/** One disputed line, priced and named by the SERVER. */
export interface ClaimSelectionLine {
  /** Position in the order's own line list — the only handle the client is ever given. */
  index: number
  itemId: string | null
  /** The quantity actually disputed: 1 ≤ qty ≤ the quantity purchased. */
  qty: number
  unitCents: number
  name: string
}

export interface ClaimSelectionSnapshot {
  v: typeof CLAIM_SELECTION_VERSION
  mode: ClaimScopeMode
  modeSource: ClaimScopeModeSource
  /** Empty for 'amount' and 'whole' — a mode that names no line records none. */
  lines: ClaimSelectionLine[]
  /** What the claim asked for, as the SERVER resolved it. */
  requestedCents: number
  /** T-59: was the ceiling known at filing time PROVEN against live Stripe cash truth? */
  ceilingVerified: boolean
}

export type ScopeModeRefusalCode =
  /** The reason offers a genuine choice and the request made none. No default is invented. */
  | 'scope_required'
  /** The reason cannot be filed with that scope (an item-only reason asked for the whole order). */
  | 'scope_not_allowed'
  /** The customer may not file this reason at all (a paid cancellation is Grubano's own question). */
  | 'reason_not_selectable'
  /** The value is not one of the three modes. */
  | 'invalid_scope'

export type ScopeModeResolution =
  | { ok: true; mode: ClaimScopeMode; modeSource: Extract<ClaimScopeModeSource, 'client' | 'derived'> }
  | { ok: false; code: ScopeModeRefusalCode; error: string }

export const SCOPE_MODE_REFUSAL_TEXT: Record<ScopeModeRefusalCode, string> = {
  scope_required:        'Indiquez ce que vous réclamez : les articles concernés, un montant précis, ou toute la commande.',
  scope_not_allowed:     'Ce motif porte sur des articles précis : indiquez le ou les articles concernés.',
  reason_not_selectable: 'Ce motif n’est pas déposé par le client : une annulation payée est traitée par Grubano.',
  invalid_scope:         'Portée de réclamation invalide.',
}

/**
 * Turn a reason plus what the request said into a MODE, or refuse.
 *
 * The one place the founder's matrix becomes behaviour, so it cannot disagree with itself:
 *   items_only    → 'items', whatever the request claims. Asking for 'whole' or 'amount' is refused
 *                   rather than silently narrowed: the customer is told which gesture is missing.
 *   explicit      → the request MUST name a mode. Silence is refused; no mode is preselected.
 *   whole_derived → a named mode is honoured; silence derives 'whole' (modeSource 'derived').
 *   not_selectable→ refused.
 */
export function resolveScopeMode(input: { reason: string; scope?: string | null }): ScopeModeResolution {
  const requirement: ScopeRequirement | null = scopeRequirement(input.reason)
  if (!requirement) return { ok: false, code: 'invalid_scope', error: SCOPE_MODE_REFUSAL_TEXT.invalid_scope }
  if (requirement === 'not_selectable') {
    return { ok: false, code: 'reason_not_selectable', error: SCOPE_MODE_REFUSAL_TEXT.reason_not_selectable }
  }

  const asked = typeof input.scope === 'string' && input.scope !== '' ? input.scope : null
  if (asked !== null && !(CLAIM_SCOPE_MODES as readonly string[]).includes(asked)) {
    return { ok: false, code: 'invalid_scope', error: SCOPE_MODE_REFUSAL_TEXT.invalid_scope }
  }

  if (requirement === 'items_only') {
    // A request that names nothing is not refused here for lack of a scope — there is only one
    // possible scope, so nothing was left unsaid. What it must still carry is the LINES, and that is
    // checked where the lines are (the caller). A request that names a DIFFERENT scope is refused:
    // narrowing it silently would answer a question the customer did not ask.
    if (asked !== null && asked !== 'items') {
      return { ok: false, code: 'scope_not_allowed', error: SCOPE_MODE_REFUSAL_TEXT.scope_not_allowed }
    }
    return { ok: true, mode: 'items', modeSource: asked === 'items' ? 'client' : 'derived' }
  }

  if (requirement === 'whole_derived') {
    if (asked === null) return { ok: true, mode: 'whole', modeSource: 'derived' }
    return { ok: true, mode: asked as ClaimScopeMode, modeSource: 'client' }
  }

  // 'explicit': silence is the one thing that is not an answer.
  if (asked === null) return { ok: false, code: 'scope_required', error: SCOPE_MODE_REFUSAL_TEXT.scope_required }
  return { ok: true, mode: asked as ClaimScopeMode, modeSource: 'client' }
}

/**
 * Build the frozen snapshot. Every field of every line is taken from `scopeLines` — the server's own
 * list — and only the INDEX and the QUANTITY come from the request. A caller that has not already
 * validated the selection cannot produce a wrong snapshot here either: an index with no line is
 * dropped rather than invented, and the quantity is clamped to what was purchased.
 */
export function buildClaimSelection(input: {
  mode: ClaimScopeMode
  modeSource: ClaimScopeModeSource
  /** Validated { index, qty } pairs. Ignored unless the mode is 'items'. */
  selection?: Array<{ index: number; qty: number }> | null
  scopeLines: readonly ClaimScopeLine[]
  requestedCents: number
  ceilingVerified: boolean
}): ClaimSelectionSnapshot {
  const lines: ClaimSelectionLine[] = []
  if (input.mode === 'items') {
    for (const sel of input.selection ?? []) {
      const line = input.scopeLines.find((l) => l.index === sel.index)
      if (!line) continue // never invent a line the order does not have
      // A quantity below 1 is DROPPED, not raised to 1. Clamping upward would invent a disputed portion
      // the customer never claimed — in a record whose whole purpose is to say what they did claim. It
      // cannot happen through the route (resolveClaimAmount refuses qty ≤ 0 before this runs), and that is
      // exactly why it is worth handling here: this function is exported, and the next caller may not.
      const asked = Math.floor(Number(sel.qty) || 0)
      if (asked < 1) continue
      const qty = Math.min(asked, Math.max(1, Math.floor(line.maxQty)))
      lines.push({
        index:     line.index,
        itemId:    line.itemId,
        qty,
        unitCents: Math.max(0, Math.floor(line.unitCents)),
        name:      String(line.name),
      })
    }
  }
  return {
    v:               CLAIM_SELECTION_VERSION,
    mode:            input.mode,
    modeSource:      input.modeSource,
    lines,
    requestedCents:  Math.max(0, Math.floor(Number(input.requestedCents) || 0)),
    ceilingVerified: input.ceilingVerified === true,
  }
}

/** The snapshot a SYSTEM claim records: Grubano's own question about a paid cancellation. */
export function systemClaimSelection(requestedCents: number): ClaimSelectionSnapshot {
  return buildClaimSelection({
    mode: 'whole', modeSource: 'system', selection: null, scopeLines: [],
    requestedCents, ceilingVerified: false,
  })
}

/**
 * Read a persisted snapshot back, or return NULL.
 *
 * Null means « not recorded » and nothing else. It is returned for a legacy row, for a version this
 * build does not know, and for anything malformed — and every caller must render it as not recorded.
 * Returning a default mode here (or anywhere) would silently give nine existing claims a scope they
 * were never filed with.
 */
export function readClaimSelection(value: unknown): ClaimSelectionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.v !== CLAIM_SELECTION_VERSION) return null
  if (typeof raw.mode !== 'string' || !(CLAIM_SCOPE_MODES as readonly string[]).includes(raw.mode)) return null
  if (raw.modeSource !== 'client' && raw.modeSource !== 'derived' && raw.modeSource !== 'system') return null

  const lines: ClaimSelectionLine[] = []
  if (Array.isArray(raw.lines)) {
    for (const l of raw.lines) {
      if (!l || typeof l !== 'object') continue
      const o = l as Record<string, unknown>
      const index = Math.floor(Number(o.index))
      const qty = Math.floor(Number(o.qty))
      const unitCents = Math.floor(Number(o.unitCents))
      if (!Number.isFinite(index) || index < 0 || !Number.isFinite(qty) || qty <= 0) continue
      lines.push({
        index,
        itemId:    typeof o.itemId === 'string' ? o.itemId : null,
        qty,
        unitCents: Number.isFinite(unitCents) && unitCents >= 0 ? unitCents : 0,
        name:      typeof o.name === 'string' ? o.name : '',
      })
    }
  }
  const requestedCents = Math.floor(Number(raw.requestedCents))
  return {
    v:               CLAIM_SELECTION_VERSION,
    mode:            raw.mode as ClaimScopeMode,
    modeSource:      raw.modeSource,
    lines,
    requestedCents:  Number.isFinite(requestedCents) && requestedCents >= 0 ? requestedCents : 0,
    ceilingVerified: raw.ceilingVerified === true,
  }
}

/**
 * One line per disputed article, as « 2 × Gnocchi ». Locale-free on purpose: it is a quantity and a
 * name the server already holds, so it reads the same in every language and carries no price — a
 * figure beside an article would invite reading it as the amount that will be refunded.
 */
export function selectionLineSummary(snapshot: ClaimSelectionSnapshot | null): string[] {
  if (!snapshot || snapshot.mode !== 'items') return []
  return snapshot.lines.map((l) => `${l.qty} × ${l.name}`.trim())
}

/** Total quantity disputed across the lines — for a trail, never for an authority. */
export function selectionTotalQty(snapshot: ClaimSelectionSnapshot | null): number {
  if (!snapshot) return 0
  return snapshot.lines.reduce((a, l) => a + Math.max(0, Math.floor(l.qty)), 0)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// previouslyClaimed — A VISUAL SIGNAL, AND NOTHING ELSE (spec v2 §5, invariant S-26)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// What it is for: an admin looking at « 1 × Gnocchi » wants to know whether that same dish was already
// the subject of an earlier claim on the same order. That is a question about ATTENTION, not about
// entitlement. The founder's decision is explicit: in beta, no historical quantity is an authority for
// an automatic refusal. So this function returns a description of the past and no budget.
//
// Why it is a pure function of rows the caller already read: the moment a quantity like this is computed
// inside the pricing path, someone will subtract it « because it is right there ». Keeping it here, with
// no access to the order and no maxQty in its output, makes that harder to do by accident — and
// tests/claims-dprime-l7-selection.test.ts pins that lib/claim-scope.ts neither imports nor mentions it.
//
// Why the unattributable list exists: nine claims predate L7 and recorded no selection, and a claim filed
// in mode 'amount' or 'whole' names no line by construction. Returning only `byLine` would let a surface
// display « no previous claim on this dish » when in truth an earlier claim exists whose scope is unknown
// or order-wide. That is a silent loss, and it is exactly the case the post-beta policy still has to
// decide (backlog item (b)). So the past that CANNOT be attributed to a line is reported as such.

export interface PreviouslyClaimedEntry {
  claimId: string
  /** The claim's status, verbatim — this module does not judge which statuses « count ». */
  status: string
  /** The quantity that earlier claim recorded on this line. Informational. */
  qty: number
}

/** Why an earlier claim could not be attributed to any line. */
export type UnattributableReason =
  /** Filed before L7, or with a snapshot this build cannot trust: the scope is genuinely unknown. */
  | 'not_recorded'
  /** Mode 'amount': a figure that names no line (backlog item (b)). */
  | 'mode_amount'
  /** Mode 'whole': it covered every line, so attributing it to one would be arbitrary. */
  | 'mode_whole'
  /** Mode 'items' but the snapshot holds no line — an empty selection cannot be attributed either. */
  | 'no_lines'

export interface PreviouslyClaimedReport {
  /** line index → the earlier claims that named it, in the order the caller supplied them. */
  byLine: Record<number, PreviouslyClaimedEntry[]>
  /** Earlier claims that exist but name no line. NEVER to be rendered as « nothing was claimed ». */
  unattributable: Array<{ claimId: string; status: string; reason: UnattributableReason }>
}

/**
 * Describe what earlier claims on the SAME order already named.
 *
 * Informational by construction: the output carries no ceiling, no remaining quantity and no verdict.
 * The caller passes the prior claims it already read (the current claim excluded — this function does
 * not know which one is current and will happily report a claim against itself if handed it).
 */
export function previouslyClaimedByLine(
  priorClaims: ReadonlyArray<{ id: string; status: string; selection?: unknown }>,
): PreviouslyClaimedReport {
  const byLine: Record<number, PreviouslyClaimedEntry[]> = {}
  const unattributable: PreviouslyClaimedReport['unattributable'] = []
  for (const c of priorClaims) {
    const snap = readClaimSelection(c.selection)
    if (!snap) { unattributable.push({ claimId: c.id, status: c.status, reason: 'not_recorded' }); continue }
    if (snap.mode === 'amount') { unattributable.push({ claimId: c.id, status: c.status, reason: 'mode_amount' }); continue }
    if (snap.mode === 'whole') { unattributable.push({ claimId: c.id, status: c.status, reason: 'mode_whole' }); continue }
    if (snap.lines.length === 0) { unattributable.push({ claimId: c.id, status: c.status, reason: 'no_lines' }); continue }
    for (const l of snap.lines) {
      const bucket = byLine[l.index] ?? (byLine[l.index] = [])
      bucket.push({ claimId: c.id, status: c.status, qty: Math.max(0, Math.floor(l.qty)) })
    }
  }
  return { byLine, unattributable }
}
