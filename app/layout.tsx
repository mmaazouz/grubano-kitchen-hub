import type { Metadata } from 'next'
import './globals.css'
import AppChrome from '@/components/AppChrome'

export const metadata: Metadata = {
  title: 'Grubano — Dark Kitchen OS',
  description: 'Gestion opérationnelle de dark kitchens multi-marques',
  // Favicons — drop the matching files into /public (see names below).
  // Files are served gracefully (browser ignores any that are missing).
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
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
