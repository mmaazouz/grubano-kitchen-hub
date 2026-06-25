'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from '@/navigation'
import { useSession } from 'next-auth/react'

const SPLASH_KEY = 'grubano_splash_seen'
const MIN_DURATION = 1900 // ms — total splash time

export default function SplashScreen() {
  const router = useRouter()
  const { status } = useSession()
  const startedAt = useRef(Date.now())
  const done = useRef(false)

  useEffect(() => {
    // Mark seen so we don't replay during the session.
    try {
      sessionStorage.setItem(SPLASH_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (status === 'loading' || done.current) return
    const elapsed = Date.now() - startedAt.current
    const wait = Math.max(0, MIN_DURATION - elapsed)
    const t = setTimeout(() => {
      done.current = true
      router.replace(status === 'authenticated' ? '/eat' : '/eat/auth')
    }, wait)
    return () => clearTimeout(t)
  }, [status, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gb-surface">
      <div className="relative flex h-[180px] w-[180px] items-center justify-center">
        {/* Radial glow halo — a SEPARATE blurred layer behind the mark (it never
            scales the logo itself). gb-logo-glow + reduced-motion are handled in
            app/tokens.css. */}
        <div
          aria-hidden
          className="gb-logo-glow pointer-events-none absolute inset-0 rounded-gb-full blur-2xl"
          style={{ background: 'radial-gradient(circle at 50% 46%, rgba(255,138,40,.55), rgba(255,106,31,.16) 46%, transparent 70%)' }}
        />
        {/* Logo — the canonical "g", gently floating (translateY on the whole mark) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/grubano-symbol-color.svg"
          alt="Grubano"
          className="gb-logo-float relative h-[116px] w-[116px]"
        />
      </div>
      <p className="splash-word mt-7 font-gb-display text-[28px] font-extrabold tracking-tight text-gb-content">Grubano</p>

      <style jsx>{`
        .splash-word {
          opacity: 0;
          transform: translateY(8px);
          animation: splash-fade-up 0.6s ease-out 0.15s forwards;
        }
        @keyframes splash-fade-up {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .splash-word {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </div>
  )
}
