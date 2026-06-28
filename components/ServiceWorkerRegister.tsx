'use client'

import { useEffect } from 'react'

/**
 * Registers the Grubano PWA service worker (public/sw.js, scope "/") after the page load.
 * Renders NOTHING — purely additive, zero visual output, mounted once in the root layout.
 * Production-only so it never interferes with the dev HMR/runtime. Registration failures are
 * swallowed: the app works exactly the same without the SW (progressive enhancement).
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* non-fatal — the app runs without the SW */
      })
    }

    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
