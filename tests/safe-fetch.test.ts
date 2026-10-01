import { describe, it, expect } from 'vitest'
import {
  validateRequestUrl, isBlockedIp, ipv4ToBytes, ipv6ToBytes, htmlToText,
  fetchSiteText, SafeFetchError, MAX_TEXT_CHARS,
  sniffImageType, fetchSiteImage, ALLOWED_IMAGE_MEDIA,
} from '@/lib/safe-fetch'

// ── SSRF-safe outbound fetch — security core (Agent 91) ───────────────────────────────
// The PURE validators are the security guarantee and are tested exhaustively here without
// the network: scheme/port/userinfo allow-list, the private/reserved IP block matrix
// (incl. IPv4-mapped + NAT64 + encoded literals), and the bounded text extraction.

describe('validateRequestUrl — scheme / port / userinfo / encoded-IP allow-list', () => {
  it('accepts normal http/https public URLs', () => {
    for (const u of [
      'http://example.com',
      'https://example.com/menu',
      'https://sub.example.co.uk/x?y=1',
      'http://example.com:80',
      'https://example.com:443/path',
      'http://1.2.3.4/',            // canonical IP literal — the IP block runs at connect
    ]) {
      expect(validateRequestUrl(u), u).not.toBeNull()
    }
  })

  it('rejects non-http(s) schemes', () => {
    for (const u of ['ftp://example.com', 'file:///etc/passwd', 'gopher://x', 'data:text/html,x', 'javascript:alert(1)', 'blob:http://x']) {
      expect(validateRequestUrl(u), u).toBeNull()
    }
  })

  it('rejects non-80/443 ports and embedded credentials', () => {
    expect(validateRequestUrl('http://example.com:8080')).toBeNull()
    expect(validateRequestUrl('https://example.com:22')).toBeNull()
    expect(validateRequestUrl('http://user:pass@example.com')).toBeNull()
    expect(validateRequestUrl('http://admin@example.com')).toBeNull()
  })

  it('⚠️ numeric/hex IP encodings are canonicalized by URL parsing, then IP-blocked', () => {
    // new URL() normalizes decimal/octal/hex IPv4 encodings to canonical dotted-quad; the
    // SSRF guarantee is then isBlockedIp on that canonical IP (run at connect time).
    expect(new URL('http://2130706433').hostname).toBe('127.0.0.1')
    expect(isBlockedIp(new URL('http://2130706433').hostname)).toBe(true)  // 127.0.0.1 → blocked
    expect(isBlockedIp(new URL('http://3232235521').hostname)).toBe(true)  // 192.168.0.1 → blocked
    expect(isBlockedIp(new URL('http://0x7f.0.0.1').hostname)).toBe(true)  // 127.0.0.1 → blocked
    expect(isBlockedIp(new URL('http://0xdeadbeef').hostname)).toBe(false) // 222.173.190.239 → genuinely public
    // malformed multi-part numeric hosts are rejected at URL validation
    expect(validateRequestUrl('http://1.2.3.4.5')).toBeNull()
    expect(validateRequestUrl('http://999.999.999.999')).toBeNull()
  })

  it('returns null on garbage input', () => {
    expect(validateRequestUrl('not a url')).toBeNull()
    expect(validateRequestUrl('')).toBeNull()
  })
})

describe('isBlockedIp — IPv4 private / reserved / metadata matrix', () => {
  it('blocks every private / reserved / loopback / metadata range', () => {
    for (const ip of [
      '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.0.5',
      '169.254.169.254',            // cloud metadata
      '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.1.1',
      '198.18.0.1', '198.51.100.5', '203.0.113.7', '224.0.0.1', '239.0.0.1', '240.0.0.1', '255.255.255.255',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows genuinely public IPs (incl. just-outside-range boundaries)', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '169.253.0.1', '192.169.0.1', '198.20.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it('blocks invalid / malformed addresses (defensive)', () => {
    for (const ip of ['not-an-ip', '', '999.1.1.1', '1.2.3', '1.2.3.4.5']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })
})

describe('isBlockedIp — IPv6 incl. IPv4-mapped + NAT64', () => {
  it('blocks loopback / unspecified / ULA / link-local / multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('⚠️ blocks IPv4-mapped + NAT64 wrapping a PRIVATE/metadata IPv4 (embedded check)', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '64:ff9b::169.254.169.254', '64:ff9b::127.0.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6 and public-embedded mapped/NAT64', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })
})

describe('ipv4ToBytes / ipv6ToBytes — strict parsing', () => {
  it('ipv4ToBytes parses dotted-quad, rejects out-of-range / non-decimal', () => {
    expect(ipv4ToBytes('1.2.3.4')).toEqual([1, 2, 3, 4])
    expect(ipv4ToBytes('256.0.0.1')).toBeNull()
    expect(ipv4ToBytes('1.2.3')).toBeNull()
    expect(ipv4ToBytes('0x7f.0.0.1')).toBeNull()
  })
  it('ipv6ToBytes expands :: and embedded IPv4 tail to 16 bytes', () => {
    expect(ipv6ToBytes('::1')?.length).toBe(16)
    expect(ipv6ToBytes('::')?.every((b) => b === 0)).toBe(true)
    const mapped = ipv6ToBytes('::ffff:127.0.0.1')
    expect(mapped?.slice(12)).toEqual([127, 0, 0, 1])
    expect(ipv6ToBytes('nonsense')).toBeNull()
  })
})

describe('htmlToText — strips scripts/styles/tags, bounds size', () => {
  it('removes script/style content and tags, keeps visible text', () => {
    const html = '<html><head><style>.x{color:red}</style></head><body><h1>Chez Luigi</h1><script>steal()</script><p>Pizza &amp; pasta</p></body></html>'
    const text = htmlToText(html)
    expect(text).toContain('Chez Luigi')
    expect(text).toContain('Pizza & pasta')
    expect(text).not.toContain('steal')
    expect(text).not.toContain('color:red')
  })
  it('caps the output length', () => {
    expect(htmlToText('a'.repeat(MAX_TEXT_CHARS + 5000)).length).toBe(MAX_TEXT_CHARS)
  })
})

describe('fetchSiteText — rejects unsafe schemes synchronously (no socket)', () => {
  it('throws SafeFetchError(invalid_url) on a non-http(s) scheme', async () => {
    await expect(fetchSiteText('ftp://example.com')).rejects.toBeInstanceOf(SafeFetchError)
    await expect(fetchSiteText('ftp://example.com')).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(fetchSiteText('file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(fetchSiteText('http://example.com:8080')).rejects.toMatchObject({ code: 'invalid_url' })
  })
})

// ── Image voie (Agent 92, brique 3) — ADDITIVE; reuses the SAME SSRF guards ──────────────
describe('sniffImageType — magic bytes are authoritative (raster jpeg/png/webp only)', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3, 4])
  const PNG  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([0, 0, 0, 0])])

  it('recognises real JPEG/PNG/WEBP by content', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(WEBP)).toBe('image/webp')
  })

  it('⚠️ rejects SVG, GIF, HTML, and a fake .jpg that is not really an image', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'))).toBeNull()
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull()              // GIF excluded
    expect(sniffImageType(Buffer.from('<!DOCTYPE html><html></html>'))).toBeNull()
    expect(sniffImageType(Buffer.from('this is not an image at all'))).toBeNull()
    expect(sniffImageType(Buffer.alloc(0))).toBeNull()
  })

  it('the allow-list is raster-only (no svg, no gif) — matches the Cloudinary uploader', () => {
    expect([...ALLOWED_IMAGE_MEDIA]).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })
})

describe('fetchSiteImage — same SSRF guards as the text path (scheme rejected synchronously)', () => {
  it('throws SafeFetchError(invalid_url) on a non-http(s) scheme / encoded-IP literal', async () => {
    await expect(fetchSiteImage('ftp://example.com/logo.png')).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(fetchSiteImage('file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(fetchSiteImage('http://example.com:8080/logo.png')).rejects.toMatchObject({ code: 'invalid_url' })
  })
})
