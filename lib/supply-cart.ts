// ── Buyer-side supply cart — client localStorage bridge (flux acheteur, Lot D→E) ─
//
// One cart PER (buyer, supplier): a SupplyOrder is one supplier, and the buyer is the
// Operator whose session places it. The catalog screen (Lot D) writes the chosen
// quantities here; the cart screen (Lot E) reads them back after navigation. DISPLAY/UX
// ONLY — this holds quantities keyed by catalogItemId, never a price or a total: Lot E
// re-fetches the supplier's REAL priceCents server-side and POST /api/marketplace/orders
// re-snapshots + re-enforces the minimum. So a stale/forged value can never change what
// is charged — the server is the single source of truth for money. Client-only (uses
// localStorage); guarded for SSR so importing it in a client module never throws.
//
// ── CROSS-ACCOUNT LEAK (P0) ─────────────────────────────────────────────────────────
// The key used to be `grubano.supplyCart.<supplierId>`: partitioned by the SELLER and by
// nothing else. localStorage, so it survived a sign-out AND a browser restart. Operator A
// chose quantities at supplier S; A signed out; Operator B signed in on the same browser;
// B read the same bucket, opened the cart and could « Passer la commande » — and
// POST /api/marketplace/orders creates the SupplyOrder with `operatorId: operator.id`
// from B's SESSION, carrying the lines A had chosen. The server re-prices, so it was never
// a money fraud; it was a real order of B containing A's basket. And « Recommander » on
// the orders screen writes a PAST order's real lines into that same shared bucket, so what
// leaked was not only a draft but A's purchase history.
//
// The owner is the OPERATOR. Not the supplier, not a restaurant id, not an e-mail, not a
// role, not the browser. The supplier stays a SECOND axis of partition:
//     grubano.supplyCart.v2.u.<operatorId>.s.<supplierId>
// and the stored value repeats BOTH, so a bucket that landed under the wrong key — or was
// copied — reads EMPTY instead of reading as the current owner's. The owner must be
// DECLARED before anything is read or written: unknown identity ⇒ reads empty, writes
// refused. There is no guest here (the marketplace already requires a restaurant/admin
// Operator) and no fallback to a global bucket, ever.
//
// The legacy keys are UNATTRIBUTABLE by construction — they are the blob that leaked — so
// they are never read: they are deleted the first time an owner is declared. A pre-fix
// draft is lost once; that is the deliberate trade, security over convenience.

export interface SupplyCart {
  [catalogItemId: string]: number
}

const LEGACY_PREFIX = 'grubano.supplyCart.'
const PREFIX = 'grubano.supplyCart.v2.'

/** The (buyer, supplier) bucket. Both axes are in the key AND in the value. */
function keyFor(operatorId: string, supplierId: string): string {
  return `${PREFIX}u.${operatorId}.s.${supplierId}`
}
function stampFor(operatorId: string): string {
  return `u:${operatorId}`
}

/** null = the identity has NOT been declared ⇒ nothing is read and nothing is written. */
let owner: string | null = null

type Envelope = { owner: string; supplierId: string; cart: SupplyCart }

/**
 * Declare which Operator the supply carts belong to. Called by every marketplace client
 * component from the `operatorId` its SERVER page resolved with callerOperator() — the
 * authoritative source — never from a value the client invented.
 *
 * It MIGRATES NOTHING: no bucket is ever copied from one owner to another, and there is
 * deliberately no primitive that could. Returns true when the owner actually changed.
 */
export function setSupplyCartOwner(operatorId: string): boolean {
  // NEVER on the server: module state is shared by every concurrent request there, so
  // declaring an identity would leak one buyer's owner into another's render.
  if (typeof window === 'undefined' || !operatorId) return false
  const changed = owner !== operatorId
  const first = owner === null
  owner = operatorId
  if (first || changed) dropLegacyBuckets()
  return changed
}

/** Forget the identity: reads empty, writes refused, until a new owner is declared. */
export function clearSupplyCartOwner(): void {
  owner = null
}

/**
 * Undeclare, but ONLY if the declared owner is this caller's — a component must not
 * undeclare a declaration that is not its own.
 *
 * WHY THIS AND NOT THE UNCONDITIONAL CLEAR. The owner is module state, shared by every
 * mounted component, and during an App Router soft navigation the OUTGOING page is still
 * mounted while the incoming one renders. A stale page rendered for A and a fresh page
 * rendered for B therefore coexist, and if A's effect runs last an unconditional clear
 * would undeclare B's correct declaration. Nothing would leak — but B's screen would keep
 * believing it owns its basket while every write silently became a no-op, and its effect
 * deps never change again, so it would never re-declare. A basket that stops saving.
 *
 * The invariant is not "clear it on a mismatch", it is "the declared owner is the live
 * session's buyer". Refusing to touch someone else's declaration leaves that satisfied;
 * undeclaring it can break it. Returns true when it actually undeclared.
 */
export function clearSupplyCartOwnerIfMine(operatorId: string): boolean {
  if (!operatorId || owner === null || owner !== operatorId) return false
  owner = null
  return true
}

/** The declared owner, or null while the identity is unknown. */
export function getSupplyCartOwner(): string | null {
  return owner
}

/** The stamp the buckets currently in storage would be read under. */
export function currentSupplyCartStamp(): string | null {
  return owner ? stampFor(owner) : null
}

/**
 * The stamp a next-auth session implies — available in the SAME render as the new session.
 * THE FIRST-FRAME GUARD: the owner is declared in an effect, and effects run AFTER the
 * render that introduced a new session, so a component holding quantities in React state
 * would paint the previous buyer's for one committed frame.
 * FAIL CLOSED: null while loading, and null for an authenticated session with no usable id.
 * There is no guest branch — an anonymous visitor has no supply cart at all.
 */
export function sessionSupplyCartStamp(status: string, operatorId?: string | null): string | null {
  if (status === 'authenticated') return operatorId ? stampFor(operatorId) : null
  return null
}

export interface SupplyCartIdentity {
  /** The stamp the LIVE session implies, or null when no buyer can be named. */
  sessionStamp: string | null
  /** The live session IS the buyer the SERVER rendered this page for. */
  identityMatchesServer: boolean
}

/**
 * THE IDENTITY HANDSHAKE, in one place, pure.
 *
 * A marketplace page is server-rendered for the Operator callerOperator() resolved, and
 * that id is then FROZEN in the client bundle. The session is not frozen: it can become
 * someone else without this component ever remounting. So the server's id is authoritative
 * only while it still agrees with the live session, and two different mistakes follow from
 * forgetting that:
 *
 *   • gating only on the session STATUS — A then logout then B login puts status back to
 *     'authenticated' while the component still carries operatorId = A, so the effect
 *     declares the GLOBAL module owner as A during B's session. Nothing need leak visibly
 *     for the invariant the rest of this module rests on to be false.
 *   • gating only the RENDER — the rows stay mounted, so state hydrated for A stays
 *     mutable under B, and the write is merely DEFERRED until the session returns to A.
 *
 * Callers derive this during render (never in an effect — an effect runs after the frame
 * that already painted) and use identityMatchesServer to gate every read, every
 * mutation and every write. It is deliberately pure: declaring the owner is a side effect
 * and belongs in an effect, not in a render.
 */
export function supplyCartIdentity(
  status: string,
  liveOperatorId: string | null | undefined,
  serverOperatorId: string,
): SupplyCartIdentity {
  const sessionStamp = sessionSupplyCartStamp(status, liveOperatorId)
  const identityMatchesServer =
    sessionStamp !== null && !!serverOperatorId && sessionStamp === stampFor(serverOperatorId)
  return { sessionStamp, identityMatchesServer }
}

/** The unattributable pre-fix buckets, destroyed rather than adopted. */
function dropLegacyBuckets(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      // Everything under the old prefix EXCEPT the v2 namespace.
      if (k && k.startsWith(LEGACY_PREFIX) && !k.startsWith(PREFIX)) doomed.push(k)
    }
    for (const k of doomed) window.localStorage.removeItem(k)
  } catch {
    /* storage disabled — nothing to drop */
  }
}

function readFor(operatorId: string, supplierId: string): SupplyCart {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(keyFor(operatorId, supplierId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    // v2 envelope ONLY. A bare quantity map is the legacy shape or a hand-written value:
    // unattributable, so it reads as empty rather than as this buyer's.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const env = parsed as Partial<Envelope>
    // BOTH axes must agree with the bucket we asked for.
    if (env.owner !== stampFor(operatorId) || env.supplierId !== supplierId) return {}
    if (!env.cart || typeof env.cart !== 'object' || Array.isArray(env.cart)) return {}
    const out: SupplyCart = {}
    for (const [id, q] of Object.entries(env.cart as Record<string, unknown>)) {
      const n = Math.floor(Number(q))
      if (Number.isFinite(n) && n > 0) out[id] = n
    }
    return out
  } catch {
    return {}
  }
}

function writeFor(operatorId: string, supplierId: string, cart: SupplyCart): void {
  if (typeof window === 'undefined') return
  try {
    const clean: SupplyCart = {}
    for (const [id, q] of Object.entries(cart)) {
      const n = Math.floor(Number(q))
      if (Number.isFinite(n) && n > 0) clean[id] = n
    }
    const k = keyFor(operatorId, supplierId)
    if (Object.keys(clean).length === 0) window.localStorage.removeItem(k)
    else {
      const env: Envelope = { owner: stampFor(operatorId), supplierId, cart: clean }
      window.localStorage.setItem(k, JSON.stringify(env))
    }
  } catch {
    /* storage full / disabled — ignore, the cart is a UX convenience */
  }
}

/** Read the declared owner's quantities for a supplier. {} when no owner is declared. */
export function readSupplyCart(supplierId: string): SupplyCart {
  if (!owner || !supplierId) return {} // identity not declared ⇒ fail closed
  return readFor(owner, supplierId)
}

/** Persist the declared owner's quantities for a supplier. Refused when no owner. */
export function writeSupplyCart(supplierId: string, cart: SupplyCart): void {
  if (!owner || !supplierId) return // an unattributed write is how the leak started
  writeFor(owner, supplierId, cart)
}

/**
 * Empty ONE named (buyer, supplier) bucket, without consulting — or touching — the mutable
 * current owner. For the success path of an order: the order was placed for a PROVEN
 * buyer, so that is the bucket to clear.
 *
 * WHY, and this is the mistake the consumer-cart lot made first: a clear that resolves its
 * target from the current owner is correct when it is written and wrong when it runs. The
 * POST response can arrive late, and if the identity changed in the meantime the clear
 * would empty the NEW buyer's bucket — a cross-account destruction on the happy path.
 *
 * It verifies BOTH stamps before deleting, so it can only remove a value that really is
 * that pair's; it leaves the declared owner alone. Returns true when it removed (or found
 * nothing under) that exact bucket.
 */
export function clearSupplyCartForOwner(operatorId: string, supplierId: string): boolean {
  if (typeof window === 'undefined' || !operatorId || !supplierId) return false
  try {
    const k = keyFor(operatorId, supplierId)
    const raw = window.localStorage.getItem(k)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
      const env = parsed as Partial<Envelope>
      if (env.owner !== stampFor(operatorId) || env.supplierId !== supplierId) return false
    }
    window.localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

/** Total number of units across the cart. */
export function supplyCartCount(cart: SupplyCart): number {
  return Object.values(cart).reduce((s, q) => s + (q > 0 ? q : 0), 0)
}

/** Test-only: forget the declared identity between cases. */
export function __resetSupplyCartOwner(): void {
  owner = null
}
