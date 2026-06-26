import EatSessionProvider from '@/components/EatSessionProvider'
import EatShell from '@/components/eat/EatShell'
import ToastBridge from '@/components/eat/ToastBridge'
import { ToastProvider } from '@/components/design-system'

// Note: the LanguageSwitcher used to be an absolute overlay at end-3/top-3
// here, but it collided with every page's own top-right buttons (most visibly
// the heart + share on the restaurant detail hero). The switcher now lives in
// the profile menu (app/[locale]/eat/account/page.tsx) where it has its own
// dedicated row and can't overlap anything.
//
// The app FRAME (mobile 480 column + desktop 240px left rail) lives in <EatShell/>,
// which renders it for every /eat route EXCEPT /eat/auth (full-screen pixel blueprint).
// ToastBridge is hoisted to the provider level so toasts (e.g. the OAuth "soon" toast)
// keep working on the auth screen too, where there is no shell.
export default function EatLayout({ children }: { children: React.ReactNode }) {
  return (
    <EatSessionProvider>
      <ToastProvider>
        <EatShell>{children}</EatShell>
        <ToastBridge />
      </ToastProvider>
    </EatSessionProvider>
  )
}
