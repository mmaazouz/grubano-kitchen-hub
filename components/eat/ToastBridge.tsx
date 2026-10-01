'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/design-system'
import { TOAST_EVENT } from '@/lib/eat-cart'

/**
 * Forwards the legacy `grubano:toast` custom-event API (used by all existing
 * `showToast(msg)` call-sites in /eat) to the design-system Toast provider.
 *
 * Lets us migrate the visual stack to the design system without rewriting
 * every page that already dispatches toasts via the helper in lib/eat-cart.ts.
 */
export default function ToastBridge() {
  const toast = useToast()
  useEffect(() => {
    function onToast(e: Event) {
      const text = (e as CustomEvent<string>).detail
      if (!text) return
      // The legacy helper sends free-form strings — surface them as info,
      // unless they obviously read as an error.
      const isError = /\b(erreur|impossible|invalide|échec)\b/i.test(text)
      if (isError) toast.error(text)
      else toast.info(text)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => window.removeEventListener(TOAST_EVENT, onToast)
  }, [toast])
  return null
}
