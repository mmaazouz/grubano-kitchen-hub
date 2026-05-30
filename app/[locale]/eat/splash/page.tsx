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
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="relative flex h-[140px] w-[140px] items-center justify-center">
        {/* Drawing ring (Stripe-style progressive draw) */}
        <svg className="splash-ring absolute inset-0" viewBox="0 0 140 140" fill="none">
          <circle
            cx="70"
            cy="70"
            r="64"
            stroke="#F97316"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="402"
            strokeDashoffset="402"
          />
        </svg>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicon.svg" alt="Grubano" className="splash-logo h-[84px] w-[84px]" />
      </div>
      <p className="splash-word mt-6 text-[26px] font-extrabold tracking-tight text-[#1a1a1a]">Grubano</p>

      <style jsx>{`
        .splash-logo {
          opacity: 0;
          transform: scale(0.8);
          animation: splash-pop 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .splash-ring circle {
          animation: splash-draw 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .splash-word {
          opacity: 0;
          transform: translateY(8px);
          animation: splash-fade-up 0.6s ease-out 0.6s forwards;
        }
        @keyframes splash-pop {
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes splash-draw {
          to {
            stroke-dashoffset: 0;
          }
        }
        @keyframes splash-fade-up {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
