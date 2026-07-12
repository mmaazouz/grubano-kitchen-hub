import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// /design is an INTENTIONAL living style-guide (see DESIGN_SYSTEMS.md): it ships on
// purpose so contributors can exercise every design-system component in every variant.
// Because it is internal documentation (not a real consumer route), it must NOT be
// indexed by search engines. A server-component layout is the only place to set
// `robots` metadata, since the page itself is a client component.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function DesignLayout({ children }: { children: ReactNode }) {
  return children
}
