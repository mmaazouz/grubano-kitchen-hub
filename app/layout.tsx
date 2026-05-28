import type { Metadata } from 'next'
import './globals.css'
import AppChrome from '@/components/AppChrome'

export const metadata: Metadata = {
  title: 'Grubano — Dark Kitchen OS',
  description: 'Gestion opérationnelle de dark kitchens multi-marques',
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
