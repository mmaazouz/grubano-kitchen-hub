import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

// ── SSRF-SAFE outbound fetch (onboarding copilot, brique 2 — Agent 91) ────────────────
//
// The restaurateur supplies an arbitrary URL and the SERVER fetches it. That is a classic
// SSRF surface, so EVERY hop is locked down:
//   • SCHEME  — http/https ONLY (file:, ftp:, gopher:, data:, blob:… rejected).
//   • PORT    — 80/443 ONLY.
//   • NO userinfo (http://user:pass@host bypass tricks rejected).
//   • HOST    — a numeric/encoded IP literal that is NOT a canonical IP (decimal
//               2130706433, octal 0177.0.0.1, hex 0x7f.0.0.1) is rejected outright:
//               a real website hostname always contains a letter.
//   • IP BLOCK — the host is resolved and EVERY resolved IP must be PUBLIC. Private /
//               loopback / link-local / cloud-metadata / reserved ranges are blocked,
//               incl. IPv4-mapped + NAT64 IPv6 (the embedded IPv4 is checked).
//   • ANTI-REBINDING — the socket is pinned to a VALIDATED IP via a custom `lookup` that
//               re-resolves AND re-validates AT CONNECT TIME (no TOCTOU gap).
//   • REDIRECTS — followed manually, at most MAX_REDIRECTS, RE-VALIDATING the URL (and,
//               via the guarded lookup, the IP) on EVERY hop. A 30x to 169.254.169.254
//               is therefore blocked.
//   • TIMEOUT + BYTE CAP — short socket timeout; the body is truncated past MAX_SITE_BYTES.
//   • CONTENT — only text/html|text|xhtml is accepted; the text is extracted (scripts/
//               styles stripped) and bounded before it ever reaches the LLM.
//   • NO ORACLE — every failure throws a generic SafeFetchError(code); the caller maps it
//               to a generic user message and NEVER leaks the IP, status, or body.
//
// PURE, exhaustively-testable helpers (validateRequestUrl, isBlockedIp, ipv4/ipv6 parsing)
// are exported so the SSRF matrix is unit-tested without the network. ZERO money surface.

export const MAX_SITE_BYTES   = 2 * 1024 * 1024 // 2 MB hard cap on the fetched body
export const FETCH_TIMEOUT_MS = 8000            // per-socket timeout
export const MAX_REDIRECTS    = 3               // small redirect cap, each hop re-validated
export const MAX_TEXT_CHARS   = 50_000          // text handed to the LLM (gateway caps again)

export type SafeFetchCode =
  | 'invalid_url' | 'blocked' | 'too_large' | 'timeout' | 'bad_content' | 'fetch_failed'

/** Generic SSRF error — the `code` is for internal logging ONLY, never shown to the user. */
export class SafeFetchError extends Error {
  constructor(public code: SafeFetchCode) {
    super(code)
    this.name = 'SafeFetchError'
  }
}

// ── URL validation (PURE) ─────────────────────────────────────────────────────────────

function stripBrackets(h: string): string {
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
}

/**
 * Validate a user-supplied URL string. Returns the parsed URL or null. Enforces:
 * http/https scheme, port ∈ {default, 80, 443}, no userinfo, a host that is either a
 * canonical IP or a real DNS name (contains a letter — kills decimal/octal/hex IP
 * literals). It does NOT resolve DNS — that (and the IP block) happens at fetch time.
 */
export function validateRequestUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return null
  if (url.username || url.password) return null
  const host = stripBrackets(url.hostname)
  if (!host) return null
  // A canonical IP literal is fine here (the IP block runs at connect). But reject any
  // NON-canonical numeric/encoded IP literal deterministically: a genuine website hostname
  // is never made of purely numeric/hex labels. This kills decimal (2130706433), octal
  // (017.0.0.1) and 0x-hex (0x7f.0.0.1 / 0xdeadbeef) encodings BEFORE any DNS resolution.
  if (net.isIP(host) === 0) {
    const numericish = host.split('.').every((l) => /^(0x[0-9a-f]+|\d+)$/i.test(l))
    if (numericish || !/[a-z]/i.test(host)) return null
  }
  return url
}

// ── IPv4 / IPv6 parsing (PURE) ──────────────────────────────────────────────────────────

/** Parse a strict dotted-quad into 4 octets, or null. Rejects octal/hex/short forms. */
export function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n < 0 || n > 255) return null
    out.push(n)
  }
  return out
}

/** Parse an IPv6 (incl. an embedded dotted-quad tail) into 16 bytes, or null. */
export function ipv6ToBytes(ipRaw: string): number[] | null {
  let s = ipRaw
  const pct = s.indexOf('%')
  if (pct >= 0) s = s.slice(0, pct) // drop a zone id

  // Convert an embedded IPv4 tail (::ffff:1.2.3.4) into two hextets.
  const lastColon = s.lastIndexOf(':')
  if (lastColon >= 0 && s.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToBytes(s.slice(lastColon + 1))
    if (!v4) return null
    const h1 = ((v4[0] << 8) | v4[1]).toString(16)
    const h2 = ((v4[2] << 8) | v4[3]).toString(16)
    s = s.slice(0, lastColon + 1) + h1 + ':' + h2
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 0) return null
    groups = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    const v = parseInt(g, 16)
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

function v4BlockedFromBytes(a: number, b: number, c: number, d: number): boolean {
  const n = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d
  const inRange = (net: number, bits: number) => (n >>> (32 - bits)) === (net >>> (32 - bits))
  return (
    a === 0 ||                               // 0.0.0.0/8 (this network)
    a === 10 ||                              // 10/8 private
    inRange(0x64400000, 10) ||               // 100.64/10 CGNAT
    a === 127 ||                             // 127/8 loopback
    (a === 169 && b === 254) ||              // 169.254/16 link-local (+ 169.254.169.254 metadata)
    (a === 172 && b >= 16 && b <= 31) ||     // 172.16/12 private
    (a === 192 && b === 0 && c === 0) ||     // 192.0.0/24 IETF
    (a === 192 && b === 0 && c === 2) ||     // 192.0.2/24 TEST-NET-1
    (a === 192 && b === 168) ||              // 192.168/16 private
    (a === 198 && (b === 18 || b === 19)) || // 198.18/15 benchmarking
    (a === 198 && b === 51 && c === 100) ||  // 198.51.100/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||   // 203.0.113/24 TEST-NET-3
    a >= 224                                 // 224/4 multicast + 240/4 reserved + 255.255.255.255
  )
}

/** Is this IP (v4 or v6) in a private / reserved / loopback / metadata range? Invalid → blocked. */
export function isBlockedIp(ipRaw: string): boolean {
  const ip = ipRaw.trim()
  const fam = net.isIP(ip)
  if (fam === 4) {
    const b = ipv4ToBytes(ip)
    return b ? v4BlockedFromBytes(b[0], b[1], b[2], b[3]) : true
  }
  if (fam === 6) {
    const b = ipv6ToBytes(ip)
    if (!b) return true
    if (b.every((x) => x === 0)) return true                                  // :: unspecified
    if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true       // ::1 loopback
    if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
      return v4BlockedFromBytes(b[12], b[13], b[14], b[15])                    // ::ffff:0:0/96 IPv4-mapped
    }
    if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
      return v4BlockedFromBytes(b[12], b[13], b[14], b[15])                    // 64:ff9b::/96 NAT64
    }
    if ((b[0] & 0xfe) === 0xfc) return true                                    // fc00::/7 ULA
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true                   // fe80::/10 link-local
    if (b[0] === 0xff) return true                                            // ff00::/8 multicast
    return false
  }
  return true // not a valid IP → block (defensive)
}

// ── Connection guard (anti-rebinding) ───────────────────────────────────────────────────

// A custom DNS lookup for the http(s) agent: it re-resolves at CONNECT time, validates
// EVERY resolved address, and pins the socket to a validated public IP. Because the
// validation happens at the moment of connection, there is no TOCTOU/rebinding window.
function guardedLookup(
  hostname: string,
  _options: unknown,
  callback: (err: Error | null, address?: string, family?: number) => void,
): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(new SafeFetchError('fetch_failed'))
    const list = Array.isArray(addresses) ? addresses : [addresses]
    if (list.length === 0) return callback(new SafeFetchError('blocked'))
    for (const a of list) {
      if (isBlockedIp(a.address)) return callback(new SafeFetchError('blocked'))
    }
    callback(null, list[0].address, list[0].family)
  })
}

// ── Text extraction (PURE) ──────────────────────────────────────────────────────────────

/** Strip scripts/styles/tags/comments from HTML and collapse to bounded plain text. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6]|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text
}

// ── The guarded request (one hop) ────────────────────────────────────────────────────────

interface HopResult {
  status:   number
  location: string | null
  body:     string | null
}

function requestOnce(url: URL): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const lib = isHttps ? https : http
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: stripBrackets(url.hostname),
        port:     url.port || (isHttps ? 443 : 80),
        path:     url.pathname + url.search,
        method:   'GET',
        lookup:   guardedLookup as unknown as undefined, // pin to a validated public IP
        headers:  { 'User-Agent': 'GrubanoBot/1.0 (+onboarding)', Accept: 'text/html' },
        timeout:  FETCH_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0
        // Redirect: capture Location, DON'T read the body — the caller re-validates the hop.
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ status, location: res.headers.location ?? null, body: null })
        }
        const ct = String(res.headers['content-type'] ?? '')
        if (!/text\/html|application\/xhtml|^text\//i.test(ct)) {
          res.destroy()
          return reject(new SafeFetchError('bad_content'))
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_SITE_BYTES) {
            res.destroy()
            return reject(new SafeFetchError('too_large'))
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status, location: null, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', () => reject(new SafeFetchError('fetch_failed')))
      },
    )
    req.on('timeout', () => { req.destroy(new SafeFetchError('timeout')) })
    req.on('error', (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError('fetch_failed')))
    req.end()
  })
}

/**
 * Fetch a user-supplied URL SAFELY and return its bounded plain text. Validates the URL,
 * follows up to MAX_REDIRECTS redirects (re-validating each hop), pins every connection to
 * a validated public IP, caps time + bytes, and accepts only text/html. Throws a generic
 * SafeFetchError on any failure (no SSRF oracle).
 */
export async function fetchSiteText(rawUrl: string): Promise<string> {
  let url = validateRequestUrl(rawUrl)
  if (!url) throw new SafeFetchError('invalid_url')

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url)
    if (res.status >= 300 && res.status < 400) {
      if (!res.location || hop === MAX_REDIRECTS) throw new SafeFetchError('fetch_failed')
      let next: URL | null
      try {
        next = validateRequestUrl(new URL(res.location, url).toString())
      } catch {
        next = null
      }
      if (!next) throw new SafeFetchError('blocked') // a redirect to a non-public/invalid target
      url = next
      continue
    }
    if (res.status < 200 || res.status >= 300 || res.body == null) {
      throw new SafeFetchError('fetch_failed')
    }
    return htmlToText(res.body)
  }
  throw new SafeFetchError('fetch_failed')
}
