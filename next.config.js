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
    ]
  },
}

module.exports = nextConfig
