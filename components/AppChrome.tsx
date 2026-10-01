'use client'

import { usePathname } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import OperatorShell from '@/components/operator/OperatorShell'
import { isBarePathname } from '@/lib/app-chrome-rules'

// The chrome decision (which routes render WITHOUT the operator dashboard chrome)
// lives in lib/app-chrome-rules.ts — a PURE function of the pathname, unit-tested
// in tests/app-chrome-rules.test.ts. It is host-independent and effect-free on
// purpose: the first server render, the hydration render and every client
// navigation take the same decision, so a bare route can never flash the
// operator furniture. (The former client-side hostname rule for /auth/magic —
// commit 69f2424 — is gone: /auth/magic is now bare on every host, which makes
// that rule strictly redundant; the page still mounts its own partner chrome on
// the business host.)

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/'

  // Public / consumer / partner routes: render bare, no operator chrome.
  if (isBarePathname(pathname)) return <>{children}</>

  // Operator app (/dashboard, /menu, /stocks, /orders, … — all flat routes): wrap in
  // the CD v1 operator shell (OperatorShell — navy gb-foundation chrome, LOT 1).
  // SessionProvider is mounted here so the shell can read the user's role/name via
  // useSession() — the /eat consumer app has its own provider, bare auth pages don't.
  return (
    <SessionProvider>
      <OperatorShell>{children}</OperatorShell>
    </SessionProvider>
  )
}
