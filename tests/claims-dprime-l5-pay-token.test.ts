// tests/claims-dprime-l5-pay-token.test.ts — D′ lot L5 (spec v2 §8.2), the dryRun → PAYER token.
//
// WHAT IS AT STAKE. The token is the ONLY thing that carries a batch of money decisions from the
// dryRun an admin READ back to the PAYER call that PAYS it — across a browser nobody controls. If a
// forged or altered token could be believed, the rail would pay claims and amounts no admin ever saw,
// with a named admin's identity on the audit row. So every refusal below is a money refusal, and every
// acceptance is an authorisation to move money: the two must never be one byte apart.
//
// The facts this file pins, each with a NEGATIVE CONTROL proving the same call succeeds when the one
// thing under test is correct — a refusal that also refuses the good case proves nothing:
//   A. a fresh token verifies for the same admin, the same build, inside the window ;
//   B. the SIGNATURE is the authority: an altered byte, a payload that was never signed, another
//      secret, or the raw secret instead of the derived key are all refused — and a payload claiming
//      another version or another admin is refused on the SIGNATURE, before the field is read ;
//   C. 10 minutes, at both ends: exp − 1 ms passes, exp does not, and a token that claims a longer
//      life is refused even when it is correctly signed ;
//   D. a token is not transferable: another admin, another deployed build ;
//   E. no secret ⇒ nothing is signed and nothing is verified ;
//   F. the batch size the rail compiled: 0 refused, 20 accepted, 21 refused ;
//   G. a malformed string is refused as malformed, never parsed into authority ;
//   H. the token carries the batch and NEVER the secret ;
//   I. deployedSha() reads the build id once and caches it.
//
// No mock of the library, no mock of crypto: the real HMAC, the real derivation, the real verdicts.
// Forged tokens are built by hand with node:crypto so each test exercises the branch it names.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  signPayToken, verifyPayToken, deployedSha, __resetDeployedShaCache, PayTokenSecretMissing, PayTokenInvalidBatch,
  PAY_TOKEN_TTL_MS, PAY_TOKEN_VERSION, PAY_TOKEN_CONTEXT, CLOCK_SKEW_MS,
  type PayTokenItem, type PayTokenPayload, type PayTokenVerdict,
} from '@/lib/claims-pay-token'
import { MAX_BATCH } from '@/lib/claims-payable-core'

// ── the fixed world ───────────────────────────────────────────────────────────────────────────────

const SECRET = 'l5-pay-token-secret'
const ADMIN = 'admin_1'
const SHA = 'c0ffee1'
const T0 = Date.UTC(2026, 8, 23, 9, 0, 0)
const ARBITRATED = '2026-09-23T08:00:00.000Z'

const ITEM: PayTokenItem = { claimId: 'cl_1', approvedAmountCents: 500, arbitratedAt: ARBITRATED }
const items = (n: number): PayTokenItem[] =>
  Array.from({ length: n }, (_, i) => ({ claimId: `cl_${i + 1}`, approvedAmountCents: 100 + i, arbitratedAt: ARBITRATED }))

/** The arguments of a dryRun that just selected one payable claim. */
const mint = (over: Partial<Parameters<typeof signPayToken>[0]> = {}) =>
  signPayToken({ adminId: ADMIN, items: [ITEM], lease: null, nowMs: T0, sha: SHA, ...over })

/** The verification context of the PAYER call that follows it. */
const ctx = (over: Partial<{ adminId: string; nowMs: number; sha: string }> = {}) =>
  ({ adminId: ADMIN, nowMs: T0, sha: SHA, ...over })

// ── forging, by hand, exactly the way an attacker (or a bug) would ────────────────────────────────

const b64 = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const encode = (payload: unknown) => b64(Buffer.from(JSON.stringify(payload), 'utf8'))
const derivedKey = (secret: string) => createHmac('sha256', secret).update(PAY_TOKEN_CONTEXT).digest()
const macOf = (key: Buffer | string, body: string) => b64(createHmac('sha256', key).update(body).digest())
/** A token over ANY payload, signed with ANY key — the derived key of SECRET by default. */
const forge = (payload: unknown, key: Buffer | string = derivedKey(SECRET)) => {
  const body = encode(payload)
  return `${body}.${macOf(key, body)}`
}
const payloadAt = (over: Partial<Record<keyof PayTokenPayload, unknown>> = {}) => ({
  v: PAY_TOKEN_VERSION, adminId: ADMIN, sha: SHA, iat: T0, exp: T0 + PAY_TOKEN_TTL_MS, lease: null, items: [ITEM], ...over,
})
/** Swap one character of a base64url segment for another valid one: altered, still well-formed. */
const flip = (s: string, i: number) => `${s.slice(0, i)}${s[i] === 'A' ? 'B' : 'A'}${s.slice(i + 1)}`
const bodyOf = (token: string) => token.slice(0, token.indexOf('.'))
const macPart = (token: string) => token.slice(token.indexOf('.') + 1)
const decode = (token: string) => JSON.parse(Buffer.from(bodyOf(token), 'base64url').toString('utf8')) as PayTokenPayload

/** What happened, in one readable word, so a failing assertion states the fact rather than `false`. */
const verdictOf = (v: PayTokenVerdict) => (v.ok ? 'ACCEPTED' : v.reason)
const accepted = (v: PayTokenVerdict): PayTokenPayload => {
  if (!v.ok) throw new Error(`the control token was refused: ${v.reason}`)
  return v.payload
}

let savedSecret: string | undefined
beforeEach(() => {
  savedSecret = process.env.NEXTAUTH_SECRET
  process.env.NEXTAUTH_SECRET = SECRET
})
afterEach(() => {
  if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = savedSecret
  vi.restoreAllMocks()
})

// ── A. the batch the admin simulated comes back intact ────────────────────────────────────────────

describe('a batch signed by a dryRun is the batch PAYER receives', () => {
  it('a freshly signed token verifies for the same admin, the same build, inside the window — and returns the very items that were signed', () => {
    const batch: PayTokenItem[] = [
      { claimId: 'cl_a', approvedAmountCents: 500, arbitratedAt: ARBITRATED },
      { claimId: 'cl_b', approvedAmountCents: 1234, arbitratedAt: null },
    ]
    const token = mint({ items: batch, lease: '2026-09-23T09:20:00.000Z' })
    const payload = accepted(verifyPayToken(token, ctx()))
    expect(payload.v).toBe(PAY_TOKEN_VERSION)
    expect(payload.adminId).toBe(ADMIN)
    expect(payload.sha).toBe(SHA)
    expect(payload.iat).toBe(T0)
    expect(payload.exp).toBe(T0 + PAY_TOKEN_TTL_MS)
    expect(payload.lease).toBe('2026-09-23T09:20:00.000Z')
    // the claim, the amount and the instant, in order: what the rail re-checks per item (§8.2)
    expect(payload.items).toEqual(batch)
  })

  it('the token is two base64url segments joined by a dot — nothing else travels', () => {
    const token = mint()
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(token.split('.')).toHaveLength(2)
  })

  it('replaying the same token a second time is still accepted — the token is not the safety, the re-read is', () => {
    const token = mint()
    expect(verdictOf(verifyPayToken(token, ctx()))).toBe('ACCEPTED')
    expect(verdictOf(verifyPayToken(token, ctx({ nowMs: T0 + 1000 })))).toBe('ACCEPTED')
  })
})

// ── B. the signature is the authority ─────────────────────────────────────────────────────────────

describe('the signature is checked before anything in the payload is believed', () => {
  it('one altered byte of the payload is refused as bad_signature — the untouched token verifies', () => {
    const token = mint()
    expect(verdictOf(verifyPayToken(token, ctx()))).toBe('ACCEPTED')          // negative control
    const altered = `${flip(bodyOf(token), 5)}.${macPart(token)}`
    expect(altered).not.toBe(token)
    expect(verdictOf(verifyPayToken(altered, ctx()))).toBe('bad_signature')
  })

  it('one altered byte of the signature is refused as bad_signature — the untouched token verifies', () => {
    const token = mint()
    expect(verdictOf(verifyPayToken(token, ctx()))).toBe('ACCEPTED')          // negative control
    const altered = `${bodyOf(token)}.${flip(macPart(token), 3)}`
    expect(altered).not.toBe(token)
    expect(verdictOf(verifyPayToken(altered, ctx()))).toBe('bad_signature')
  })

  it('the signature of another batch cannot be moved onto this one', () => {
    const mine = mint()
    const other = mint({ items: [{ claimId: 'cl_other', approvedAmountCents: 9_999, arbitratedAt: ARBITRATED }] })
    expect(verdictOf(verifyPayToken(mine, ctx()))).toBe('ACCEPTED')           // negative control
    expect(verdictOf(verifyPayToken(`${bodyOf(mine)}.${macPart(other)}`, ctx()))).toBe('bad_signature')
  })

  it('an UNSIGNED payload claiming another token version is refused on the SIGNATURE, never on the version', () => {
    const unsigned = `${encode(payloadAt({ v: 2 }))}.${macPart(mint())}`
    expect(verdictOf(verifyPayToken(unsigned, ctx()))).toBe('bad_signature')
    // negative control: the SAME payload, correctly signed, then — and only then — fails on the field
    expect(verdictOf(verifyPayToken(forge(payloadAt({ v: 2 })), ctx()))).toBe('wrong_version')
    expect(verdictOf(verifyPayToken(forge(payloadAt()), ctx()))).toBe('ACCEPTED')
  })

  it('an UNSIGNED payload claiming another admin is refused on the SIGNATURE, never on the admin', () => {
    const unsigned = `${encode(payloadAt({ adminId: 'admin_2' }))}.${macPart(mint())}`
    expect(verdictOf(verifyPayToken(unsigned, ctx({ adminId: 'admin_2' })))).toBe('bad_signature')
    // negative control: correctly signed, the same payload is read — and refused for the right reason
    expect(verdictOf(verifyPayToken(forge(payloadAt({ adminId: 'admin_2' })), ctx()))).toBe('wrong_admin')
    expect(verdictOf(verifyPayToken(forge(payloadAt({ adminId: 'admin_2' })), ctx({ adminId: 'admin_2' })))).toBe('ACCEPTED')
  })

  it('a token signed with a DIFFERENT NEXTAUTH_SECRET is refused — the same payload signed with ours verifies', () => {
    const foreign = forge(payloadAt(), derivedKey('another-deployment-secret'))
    expect(verdictOf(verifyPayToken(foreign, ctx()))).toBe('bad_signature')
    expect(verdictOf(verifyPayToken(forge(payloadAt()), ctx()))).toBe('ACCEPTED')   // negative control
  })

  it('a token signed with the RAW secret instead of the derived key is refused: the derivation context is load-bearing', () => {
    const body = encode(payloadAt())
    const raw = `${body}.${macOf(SECRET, body)}`                     // HMAC(secret, body) — no context
    const derived = `${body}.${macOf(derivedKey(SECRET), body)}`     // HMAC(HMAC(secret, context), body)
    expect(raw).not.toBe(derived)
    expect(verdictOf(verifyPayToken(raw, ctx()))).toBe('bad_signature')
    expect(verdictOf(verifyPayToken(derived, ctx()))).toBe('ACCEPTED')              // negative control
  })

  it('a token signed under a DIFFERENT derivation context is refused: no other rail can mint one here', () => {
    const otherContext = createHmac('sha256', SECRET).update('magic-link-v1').digest()
    expect(verdictOf(verifyPayToken(forge(payloadAt(), otherContext), ctx()))).toBe('bad_signature')
    expect(verdictOf(verifyPayToken(forge(payloadAt()), ctx()))).toBe('ACCEPTED')   // negative control
  })
})

// ── C. the window, at both ends ───────────────────────────────────────────────────────────────────

describe('the 10-minute window, measured at the boundary', () => {
  it('at exp − 1 ms the token still verifies; at exp exactly it is expired', () => {
    const token = mint()
    const exp = accepted(verifyPayToken(token, ctx())).exp
    expect(exp).toBe(T0 + PAY_TOKEN_TTL_MS)
    expect(verdictOf(verifyPayToken(token, ctx({ nowMs: exp - 1 })))).toBe('ACCEPTED')
    expect(verdictOf(verifyPayToken(token, ctx({ nowMs: exp })))).toBe('expired')
    expect(verdictOf(verifyPayToken(token, ctx({ nowMs: exp + 1 })))).toBe('expired')
  })

  it('a correctly signed token claiming a life longer than 10 minutes is refused as ttl_too_long', () => {
    const tooLong = forge(payloadAt({ exp: T0 + PAY_TOKEN_TTL_MS + 1 }))
    expect(verdictOf(verifyPayToken(tooLong, ctx()))).toBe('ttl_too_long')
    const anHour = forge(payloadAt({ exp: T0 + 60 * 60 * 1000 }))
    expect(verdictOf(verifyPayToken(anHour, ctx()))).toBe('ttl_too_long')
    // negative control: exactly 10 minutes, and anything shorter, are legitimate
    expect(verdictOf(verifyPayToken(forge(payloadAt({ exp: T0 + PAY_TOKEN_TTL_MS })), ctx()))).toBe('ACCEPTED')
    expect(verdictOf(verifyPayToken(forge(payloadAt({ exp: T0 + 1_000 })), ctx()))).toBe('ACCEPTED')
  })

  it('a life longer than 10 minutes is refused before the window is consulted — such a token is never merely « expired »', () => {
    const tooLong = forge(payloadAt({ exp: T0 + 60 * 60 * 1000 }))
    expect(verdictOf(verifyPayToken(tooLong, ctx({ nowMs: T0 + 30 * 60 * 1000 })))).toBe('ttl_too_long')
  })
})

// ── D. a token is not transferable ────────────────────────────────────────────────────────────────

describe('a token names the admin who saw the numbers and the build that computed them', () => {
  it("another admin's token is refused as wrong_admin — the admin who minted it is served", () => {
    const token = mint({ adminId: 'admin_2' })
    expect(verdictOf(verifyPayToken(token, ctx({ adminId: ADMIN })))).toBe('wrong_admin')
    expect(verdictOf(verifyPayToken(token, ctx({ adminId: 'admin_2' })))).toBe('ACCEPTED')   // negative control
  })

  it('an admin id that merely starts the same is not the same admin', () => {
    const token = mint({ adminId: 'admin_1' })
    expect(verdictOf(verifyPayToken(token, ctx({ adminId: 'admin_10' })))).toBe('wrong_admin')
    expect(verdictOf(verifyPayToken(token, ctx({ adminId: 'admin_' })))).toBe('wrong_admin')
    expect(verdictOf(verifyPayToken(token, ctx({ adminId: 'admin_1' })))).toBe('ACCEPTED')   // negative control
  })

  it("another build's token is refused as wrong_build — the build that minted it is served", () => {
    const token = mint({ sha: 'deadbee' })
    expect(verdictOf(verifyPayToken(token, ctx({ sha: SHA })))).toBe('wrong_build')
    expect(verdictOf(verifyPayToken(token, ctx({ sha: 'deadbee' })))).toBe('ACCEPTED')       // negative control
  })
})

// ── E. no secret, no authority ────────────────────────────────────────────────────────────────────

describe('an absent, empty or whitespace NEXTAUTH_SECRET is never an authority', () => {
  it('signing THROWS PayTokenSecretMissing and produces no string at all — with the secret set, the same call mints a token', () => {
    expect(mint()).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)                                // negative control
    for (const blank of ['', '   ', '\t\n']) {
      process.env.NEXTAUTH_SECRET = blank
      let produced: string | undefined
      expect(() => { produced = mint() }).toThrow(PayTokenSecretMissing)
      expect(produced, `a token was produced with the secret set to ${JSON.stringify(blank)}`).toBeUndefined()
    }
    delete process.env.NEXTAUTH_SECRET
    let produced: string | undefined
    expect(() => { produced = mint() }).toThrow(PayTokenSecretMissing)
    expect(produced).toBeUndefined()
  })

  it('verification answers no_secret — a token that IS valid under the secret is refused once the secret is gone', () => {
    const token = mint()
    expect(verdictOf(verifyPayToken(token, ctx()))).toBe('ACCEPTED')                          // negative control
    for (const blank of ['', '   ']) {
      process.env.NEXTAUTH_SECRET = blank
      expect(verifyPayToken(token, ctx())).toEqual({ ok: false, reason: 'no_secret' })
    }
    delete process.env.NEXTAUTH_SECRET
    expect(verifyPayToken(token, ctx())).toEqual({ ok: false, reason: 'no_secret' })
  })

  it('a token minted with an EMPTY key is authority nowhere: no_secret without a secret, bad_signature with one', () => {
    const emptyKeyToken = forge(payloadAt(), '')
    process.env.NEXTAUTH_SECRET = ''
    expect(verdictOf(verifyPayToken(emptyKeyToken, ctx()))).toBe('no_secret')
    process.env.NEXTAUTH_SECRET = SECRET
    expect(verdictOf(verifyPayToken(emptyKeyToken, ctx()))).toBe('bad_signature')
    expect(verdictOf(verifyPayToken(forge(payloadAt()), ctx()))).toBe('ACCEPTED')             // negative control
  })

  it('no token at all is « missing », before the secret is even read', () => {
    for (const nothing of [null, undefined, '', '   ']) {
      expect(verifyPayToken(nothing, ctx())).toEqual({ ok: false, reason: 'missing' })
    }
    expect(verdictOf(verifyPayToken(mint(), ctx()))).toBe('ACCEPTED')                         // negative control
  })
})

// ── F. the compiled batch size ────────────────────────────────────────────────────────────────────

describe('the batch size the rail compiled', () => {
  it('0 items is refused as no_items, 21 as too_many_items, and 20 — the compiled maximum — is accepted', () => {
    expect(MAX_BATCH).toBe(20)
    // The MINT refuses both ends too, so a batch the verifier would reject wholesale is never handed to an
    // admin in the first place (reported by this file's first round and fixed in the library): the verifier
    // is therefore exercised on HAND-SIGNED tokens, which is the only way to reach these two branches now.
    expect(() => mint({ items: items(0) })).toThrow(/no items/)
    expect(() => mint({ items: items(MAX_BATCH + 1) })).toThrow(/exceeds the batch cap/)
    expect(verdictOf(verifyPayToken(forge(payloadAt({ items: items(0) })), ctx()))).toBe('no_items')
    expect(verdictOf(verifyPayToken(forge(payloadAt({ items: items(MAX_BATCH + 1) })), ctx()))).toBe('too_many_items')
    const full = accepted(verifyPayToken(mint({ items: items(MAX_BATCH) }), ctx()))            // negative control
    expect(full.items).toHaveLength(MAX_BATCH)
    expect(full.items[MAX_BATCH - 1].claimId).toBe(`cl_${MAX_BATCH}`)
    expect(verdictOf(verifyPayToken(mint({ items: items(1) }), ctx()))).toBe('ACCEPTED')
  })
})

// ── G. malformed strings are refused, never parsed into authority ─────────────────────────────────

describe('a malformed token is refused as malformed, never read as authority', () => {
  it('a string that is not payload.signature is malformed — a well-formed one verifies', () => {
    const valid = mint()
    expect(verdictOf(verifyPayToken(valid, ctx()))).toBe('ACCEPTED')                           // negative control
    const broken: Record<string, string> = {
      'no dot':                bodyOf(valid) + macPart(valid),
      'leading dot':           `.${macPart(valid)}`,
      'trailing dot':          `${bodyOf(valid)}.`,
      'dot only':              '.',
      'a second dot':          `${bodyOf(valid)}.${macPart(valid)}.${macPart(valid)}`,
      'non-base64url payload': `${bodyOf(valid)}+x.${macPart(valid)}`,
      'non-base64url mac':     `${bodyOf(valid)}.${macPart(valid)}=`,
      'padded mac':            `${bodyOf(valid)}.${macPart(valid)}==`,
      'a space':               `${bodyOf(valid)} .${macPart(valid)}`,
    }
    for (const [name, token] of Object.entries(broken)) {
      expect(verdictOf(verifyPayToken(token, ctx())), name).toBe('malformed')
    }
  })

  it('a correctly signed body that is not JSON is malformed — a signature alone is never enough', () => {
    const body = b64(Buffer.from('hello world', 'utf8'))
    const token = `${body}.${macOf(derivedKey(SECRET), body)}`
    expect(verdictOf(verifyPayToken(token, ctx()))).toBe('malformed')
    expect(verdictOf(verifyPayToken(forge(payloadAt()), ctx()))).toBe('ACCEPTED')              // negative control
  })

  it('correctly signed JSON that is not an object is malformed', () => {
    for (const notAnObject of [123, 'a string', null, true]) {
      expect(verdictOf(verifyPayToken(forge(notAnObject), ctx())), JSON.stringify(notAnObject)).toBe('malformed')
    }
    expect(verdictOf(verifyPayToken(forge(payloadAt()), ctx()))).toBe('ACCEPTED')              // negative control
  })

  it('a payload missing the fields the rail reads is malformed', () => {
    const cases: Record<string, unknown> = {
      'adminId not a string': payloadAt({ adminId: 42 }),
      'sha not a string':     payloadAt({ sha: null }),
      'iat not finite':       payloadAt({ iat: 'yesterday' }),
      'exp not finite':       payloadAt({ exp: Number.NaN }),
      'exp infinite':         payloadAt({ exp: Number.POSITIVE_INFINITY }),
      'items not an array':   payloadAt({ items: { cl_1: 500 } }),
      'items null':           payloadAt({ items: null }),
    }
    for (const [name, payload] of Object.entries(cases)) {
      expect(verdictOf(verifyPayToken(forge(payload), ctx())), name).toBe('malformed')
    }
    expect(verdictOf(verifyPayToken(forge(payloadAt()), ctx()))).toBe('ACCEPTED')              // negative control
  })

  it('an item whose amount is not a positive integer is malformed — a money field is never approximate', () => {
    const bad: Record<string, unknown> = {
      'a fraction of a cent': 12.5,
      'negative':             -500,
      'zero':                 0,
      'a string':             '500',
      'null':                 null,
      'NaN':                  Number.NaN,
      'infinite':             Number.POSITIVE_INFINITY,
    }
    for (const [name, approvedAmountCents] of Object.entries(bad)) {
      const token = forge(payloadAt({ items: [{ ...ITEM, approvedAmountCents }] }))
      expect(verdictOf(verifyPayToken(token, ctx())), name).toBe('malformed')
    }
    // an amount that is not there at all (JSON.stringify drops `undefined`) is refused too
    expect(verdictOf(verifyPayToken(forge(payloadAt({ items: [{ claimId: 'cl_1', arbitratedAt: ARBITRATED }] })), ctx()))).toBe('malformed')
    // negative control: one cent, an integer, is a perfectly good amount
    expect(verdictOf(verifyPayToken(forge(payloadAt({ items: [{ ...ITEM, approvedAmountCents: 1 }] })), ctx()))).toBe('ACCEPTED')
  })

  it('an item without a claim, or with a decision instant that is not a string, is malformed', () => {
    const bad: Record<string, unknown> = {
      'no claimId':          { approvedAmountCents: 500, arbitratedAt: ARBITRATED },
      'empty claimId':       { claimId: '', approvedAmountCents: 500, arbitratedAt: ARBITRATED },
      'claimId not string':  { claimId: 7, approvedAmountCents: 500, arbitratedAt: ARBITRATED },
      'instant as a number': { claimId: 'cl_1', approvedAmountCents: 500, arbitratedAt: 1_758_614_400_000 },
      'item is null':        null,
      'item is a string':    'cl_1',
    }
    for (const [name, item] of Object.entries(bad)) {
      expect(verdictOf(verifyPayToken(forge(payloadAt({ items: [item] })), ctx())), name).toBe('malformed')
    }
    // negative control: an instant may legitimately be absent — that is `null`, and the rail signs it
    expect(verdictOf(verifyPayToken(forge(payloadAt({ items: [{ ...ITEM, arbitratedAt: null }] })), ctx()))).toBe('ACCEPTED')
  })

  it('one bad item among twenty good ones refuses the whole batch', () => {
    const batch = [...items(19), { ...ITEM, claimId: 'cl_20', approvedAmountCents: -1 }]
    expect(verdictOf(verifyPayToken(forge(payloadAt({ items: batch })), ctx()))).toBe('malformed')
    expect(verdictOf(verifyPayToken(forge(payloadAt({ items: items(20) })), ctx()))).toBe('ACCEPTED')  // negative control
  })
})

// ── H. the token carries the batch, never the secret ──────────────────────────────────────────────

describe('the token carries the batch and nothing of the secret', () => {
  it('neither the secret nor the derived key appears anywhere in the token', () => {
    const token = mint({ items: items(3) })
    const key = derivedKey(SECRET)
    expect(token).not.toContain(SECRET)
    expect(token).not.toContain(PAY_TOKEN_CONTEXT)
    expect(token).not.toContain(key.toString('hex'))
    expect(token).not.toContain(b64(key))
    // and the decoded payload carries exactly the seven documented fields, no eighth
    // `explicit` joined the payload when the L5 review found that S-14b was not re-enforced at PAYER:
    // whether an admin NAMED the batch decides there whether a v13 proof is acceptable, so it is signed.
    expect(Object.keys(decode(token)).sort()).toEqual(['adminId', 'exp', 'explicit', 'iat', 'items', 'lease', 'sha', 'v'])
    expect(JSON.stringify(decode(token))).not.toContain(SECRET)
  })

  it('signing neither mutates the secret nor logs anything', () => {
    const logged: unknown[][] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args) })
    }
    const batch = items(2)
    const snapshot = JSON.stringify(batch)
    const token = mint({ items: batch })
    expect(verdictOf(verifyPayToken(token, ctx()))).toBe('ACCEPTED')
    expect(process.env.NEXTAUTH_SECRET).toBe(SECRET)     // the env value is read, never rewritten
    expect(JSON.stringify(batch)).toBe(snapshot)         // the caller's items are not touched
    expect(logged).toEqual([])
  })

  it('a refusal says why and nothing else — no secret, no key, no payload it did not authenticate', () => {
    const refused = verifyPayToken(forge(payloadAt(), derivedKey('other')), ctx())
    expect(refused).toEqual({ ok: false, reason: 'bad_signature' })
    expect(Object.keys(refused).sort()).toEqual(['ok', 'reason'])
    expect(JSON.stringify(refused)).not.toContain(SECRET)
  })

  it('the same batch signed twice at the same instant is byte-identical — the signature carries no randomness to leak', () => {
    expect(mint()).toBe(mint())
    expect(mint({ nowMs: T0 + 1 })).not.toBe(mint())     // negative control: the instant IS bound
  })
})

// ── I. the deployed build id ──────────────────────────────────────────────────────────────────────

describe('deployedSha() — the build id is read once per process', () => {
  let dir: string
  const versionFile = () => join(dir, 'public', 'version.json')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grubano-l5-pay-token-'))
    mkdirSync(join(dir, 'public'))
    writeFileSync(versionFile(), JSON.stringify({ commit: 'sha_first' }), 'utf8')
    vi.spyOn(process, 'cwd').mockReturnValue(dir)
    __resetDeployedShaCache()
  })
  afterEach(() => {
    __resetDeployedShaCache()
    rmSync(dir, { recursive: true, force: true })
  })

  it('the commit the deploy wrote into public/version.json is the build id', () => {
    expect(deployedSha()).toBe('sha_first')
  })

  it('a second call does not re-read the file — and __resetDeployedShaCache() makes it re-read', () => {
    expect(deployedSha()).toBe('sha_first')
    writeFileSync(versionFile(), JSON.stringify({ commit: 'sha_second' }), 'utf8')
    expect(deployedSha()).toBe('sha_first')     // cached: the new file on disk was never opened
    expect(deployedSha()).toBe('sha_first')
    __resetDeployedShaCache()
    expect(deployedSha()).toBe('sha_second')    // negative control: the file IS re-read once cleared
  })

  it('an absent, unreadable or empty version.json answers « unknown » — a value like any other', () => {
    const cases: Array<[string, () => void]> = [
      ['absent',          () => rmSync(versionFile(), { force: true })],
      ['not JSON',        () => writeFileSync(versionFile(), 'not json at all', 'utf8')],
      ['no commit',       () => writeFileSync(versionFile(), JSON.stringify({ built: '2026-09-23' }), 'utf8')],
      ['commit not text', () => writeFileSync(versionFile(), JSON.stringify({ commit: 42 }), 'utf8')],
      ['commit empty',    () => writeFileSync(versionFile(), JSON.stringify({ commit: '   ' }), 'utf8')],
    ]
    for (const [name, arrange] of cases) {
      arrange()
      __resetDeployedShaCache()
      expect(deployedSha(), name).toBe('unknown')
    }
    // negative control: a real commit is still read, and surrounding whitespace is trimmed
    writeFileSync(versionFile(), JSON.stringify({ commit: '  sha_third \n' }), 'utf8')
    __resetDeployedShaCache()
    expect(deployedSha()).toBe('sha_third')
  })

  it('the build id is the default on both sides: a token minted on this build verifies here and nowhere else', () => {
    expect(deployedSha()).toBe('sha_first')
    const token = signPayToken({ adminId: ADMIN, items: [ITEM], lease: null, nowMs: T0 })   // no sha ⇒ deployedSha()
    expect(decode(token).sha).toBe('sha_first')
    expect(verdictOf(verifyPayToken(token, { adminId: ADMIN, nowMs: T0 }))).toBe('ACCEPTED')
    expect(verdictOf(verifyPayToken(token, { adminId: ADMIN, nowMs: T0, sha: 'sha_second' }))).toBe('wrong_build')
  })

  it('a token minted by a process that reads « unknown » verifies only against « unknown »', () => {
    rmSync(versionFile(), { force: true })
    __resetDeployedShaCache()
    const token = signPayToken({ adminId: ADMIN, items: [ITEM], lease: null, nowMs: T0 })
    expect(decode(token).sha).toBe('unknown')
    expect(verdictOf(verifyPayToken(token, { adminId: ADMIN, nowMs: T0 }))).toBe('ACCEPTED')
    expect(verdictOf(verifyPayToken(token, { adminId: ADMIN, nowMs: T0, sha: 'sha_first' }))).toBe('wrong_build')
  })
})

  it('⭐ `explicit` is SIGNED and defaults to false: a token that does not claim it was named is not', () => {
    expect(accepted(verifyPayToken(mint(), ctx())).explicit).toBe(false)
    expect(accepted(verifyPayToken(mint({ explicit: true }), ctx())).explicit).toBe(true)
    // A payload with `explicit` removed, or with a non-boolean, verifies as NOT explicit — the stricter
    // reading — and an ALTERED one does not verify at all, because the field is under the signature.
    const noField = payloadAt()
    delete (noField as Record<string, unknown>).explicit
    expect(accepted(verifyPayToken(forge(noField), ctx())).explicit).toBe(false)
    expect(accepted(verifyPayToken(forge(payloadAt({ explicit: 'yes' })), ctx())).explicit).toBe(false)
    // Flipping the bit on a token signed as automatic breaks the signature: it cannot be upgraded.
    const auto = mint()
    const upgraded = encode({ ...decode(auto), explicit: true }) + '.' + macPart(auto)
    expect(verdictOf(verifyPayToken(upgraded, ctx()))).toBe('bad_signature')
  })

// ── H. THE MINT REFUSES WHAT THE VERIFIER WOULD REJECT (round-1 findings of this file, fixed) ──────

describe('the two halves of the token cannot disagree: a batch the verifier would reject is never minted', () => {
  it('⭐ the mint refuses an empty batch, an oversized one, and an item with no claim or no positive integer amount', () => {
    expect(() => mint({ items: [] })).toThrow(PayTokenInvalidBatch)
    expect(() => mint({ items: items(MAX_BATCH + 1) })).toThrow(PayTokenInvalidBatch)
    expect(() => mint({ items: [{ claimId: '', approvedAmountCents: 500, arbitratedAt: null }] as PayTokenItem[] })).toThrow(/without a claim/)
    expect(() => mint({ items: [{ claimId: 'cl1', approvedAmountCents: 0, arbitratedAt: null }] as PayTokenItem[] })).toThrow(/positive integer/)
    expect(() => mint({ items: [{ claimId: 'cl1', approvedAmountCents: -500, arbitratedAt: null }] as PayTokenItem[] })).toThrow(/positive integer/)
    expect(() => mint({ items: [{ claimId: 'cl1', approvedAmountCents: 12.5, arbitratedAt: null }] as PayTokenItem[] })).toThrow(/positive integer/)
    expect(() => mint({ items: [{ claimId: 'cl1', approvedAmountCents: 500, arbitratedAt: 1 as unknown as null }] as PayTokenItem[] })).toThrow(/decision instant/)
    // NEGATIVE CONTROL — a well-formed batch of exactly the cap is minted, so the guard is not a blanket refusal.
    expect(verdictOf(verifyPayToken(mint({ items: items(MAX_BATCH) }), ctx()))).toBe('ACCEPTED')
  })

  it('⭐ a token dated in the FUTURE is refused: a clock jump must not extend the ten minutes', () => {
    const early = forge(payloadAt({ iat: T0 + CLOCK_SKEW_MS + 1, exp: T0 + CLOCK_SKEW_MS + 1 + PAY_TOKEN_TTL_MS }))
    expect(verdictOf(verifyPayToken(early, ctx()))).toBe('not_yet_valid')
    // NEGATIVE CONTROL — inside the tolerated skew it is accepted, and the same token is accepted once now catches up.
    const skewed = forge(payloadAt({ iat: T0 + CLOCK_SKEW_MS, exp: T0 + CLOCK_SKEW_MS + PAY_TOKEN_TTL_MS }))
    expect(verdictOf(verifyPayToken(skewed, ctx()))).toBe('ACCEPTED')
    expect(verdictOf(verifyPayToken(early, { adminId: ADMIN, sha: SHA, nowMs: T0 + CLOCK_SKEW_MS + 1 }))).toBe('ACCEPTED')
  })

  it('the missing-secret error names itself, so a log or an alert cannot mislabel it', () => {
    delete process.env.NEXTAUTH_SECRET
    let caught: unknown
    try { mint() } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PayTokenSecretMissing)
    expect((caught as Error).name).toBe('PayTokenSecretMissing')
    expect((caught as Error).message).not.toContain(SECRET)
  })

  it('a correctly signed JSON ARRAY payload is malformed, not a version mismatch', () => {
    expect(verdictOf(verifyPayToken(forge([1, 2, 3]), ctx()))).toBe('malformed')
    expect(verdictOf(verifyPayToken(forge([]), ctx()))).toBe('malformed')
  })
})
