'use client'

import { useEffect, useState, useRef } from 'react'
import { TOAST_EVENT } from '@/lib/eat-cart'

interface ToastMsg {
  id: number
  text: string
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const counter = useRef(0)

  useEffect(() => {
    function onToast(e: Event) {
      const text = (e as CustomEvent<string>).detail
      if (!text) return
      const id = ++counter.current
      setToasts((prev) => [...prev, { id, text }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2500)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => window.removeEventListener(TOAST_EVENT, onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[100] flex w-full max-w-[480px] -translate-x-1/2 flex-col items-center gap-2 px-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-[slide-up_0.25s_ease-out] rounded-2xl bg-[#1a1a1a] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
