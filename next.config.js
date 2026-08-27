const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./i18n.ts')

// ── Content-Security-Policy (go-live hardening) — REPORT-ONLY, blocks NOTHING ─────────────────
// Sent as `Content-Security-Policy-Report-Only` so it OBSERVES what the app loads without
// breaking anything. Directives already allow every legitimate source we enumerated, so once we
// switch this to enforce (`Content-Security-Policy`, a LATER deliberate decision) connect-src /
// img-src / font-src are locked down without breaking the app. Violations are POSTed to the
// self-hosted /api/csp-report collector (no external host). Documented legitimate sources:
//   • self-hosted fonts (Material Symbols + text fonts, public/fonts) → font-src 'self'
//     (Lot 7 : les @import fonts.googleapis.com morts ont été supprimés → plus AUCUNE
//     source Google Fonts dans la CSP)
//   • Stripe payments → script-src/frame-src js.stripe.com + connect-src api.stripe.com
//   • images → 'self' + /images mirror; data:/blob: (upload previews); images.unsplash.com (fallback)
// EXPECTED report-only violations to review before enforce: any inline <script> without
// 'unsafe-inline' (kept permissive here — Next hydration + the theme-init inline script need it;
// a nonce refactor is a future step), plus any host we missed (that is exactly what report-only
// surfaces). script-src/style-src stay 'unsafe-inline' by necessity; the LOCK targets connect/img/font.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "font-src 'self'",
  "connect-src 'self' https://api.stripe.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'report-uri /api/csp-report',
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
    // NOTE: outputFileTracingRoot is intentionally NOT set here.
    // Setting it to a Linux path on a Windows build machine causes Next.js
    // to skip generating .next/standalone entirely.
    // Instead, scripts/fix-server.js patches the Windows path in server.js
    // after `npm run build` completes.
  },

  assetPrefix: '',
  basePath: '',

  // Smaller bundles — no source maps in prod
  productionBrowserSourceMaps: false,

  // ── Headers HTTP pour Phusion Passenger / o2switch ─────────────────────────
  // Passenger strips some headers; forcing them here ensures /_next/static/
  // bundles are served with the correct Content-Type and are cached properly.
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        source: '/public/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
      // CSP in REPORT-ONLY mode on all document routes (API excluded — CSP only applies to
      // documents/workers anyway, and the report collector lives under /api). Blocks NOTHING.
      {
        source: '/((?!api/).*)',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
        ],
      },
    ]
  },
}

module.exports = withNextIntl(nextConfig)
