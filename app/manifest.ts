import type { MetadataRoute } from 'next'
import { BRAND_NAME } from '@/lib/seo'

// Basic PWA manifest — improves mobile SEO and "Add to home screen". Served at
// /manifest.webmanifest (referenced from the root layout's metadata.manifest).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Grubano — Commander, réserver & découvrir le food local',
    short_name: BRAND_NAME,
    description:
      'Commandez en livraison, réservez une table et découvrez le food local sur Grubano.',
    start_url: '/fr/eat',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#F97316',
    icons: [
      {
        src: '/web-app-manifest-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/web-app-manifest-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
