import type { Metadata } from 'next'
import './globals.css'
import AppChrome from '@/components/AppChrome'

export const metadata: Metadata = {
  title: 'Grubano — Commander local',
  description: 'Commandez vos plats préférés près de chez vous, livrés vite.',
  // Favicon files live in /public (placed by Mohammed).
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/site.webmanifest',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-background">
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  )
}
