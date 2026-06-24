'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

// Confirmation landing for the account email change (Agent 147). Opened from the link emailed to
// the NEW address (possibly in a different browser / not logged in). POSTs the token to the confirm
// route, which performs the atomic mutation. FR sober, plain Tailwind. useSearchParams → Suspense.
const T = {
  working: 'Validation en cours…',
  okTitle: 'E-mail mis à jour',
  okBody:  "Votre nouvelle adresse est désormais l'e-mail de connexion de votre compte. Reconnectez-vous avec cette adresse. Une alerte de sécurité a été envoyée à votre ancienne adresse.",
  koTitle: 'Lien invalide ou expiré',
  koBody:  "Ce lien de confirmation n'est plus valable (déjà utilisé ou expiré). Relancez un changement d'e-mail depuis votre compte.",
  takenTitle: 'Adresse indisponible',
  takenBody:  "Cette adresse vient d'être associée à un autre compte. Votre e-mail n'a pas été changé.",
  toAccount: 'Aller à mon compte',
  toAuth:    'Se connecter',
}

function ConfirmInner() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<'working' | 'ok' | 'invalid' | 'collision'>('working')

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!token) { setState('invalid'); return }
      try {
        const res = await fetch('/api/account/email-change/confirm', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token }),
        })
        if (cancelled) return
        if (res.ok) { setState('ok'); return }
        if (res.status === 409) { setState('collision'); return }
        setState('invalid')
      } catch {
        if (!cancelled) setState('invalid')
      }
    }
    run()
    return () => { cancelled = true }
  }, [token])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f5f5f5] px-8 text-center">
      {state === 'working' && (
        <>
          <Loader2 size={40} className="animate-spin text-[#F97316]" />
          <p className="mt-4 text-[15px] font-semibold text-[#666]">{T.working}</p>
        </>
      )}

      {state === 'ok' && (
        <>
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#DCFCE7]">
            <CheckCircle2 size={44} className="text-[#16A34A]" />
          </div>
          <p className="mt-5 text-[20px] font-extrabold text-[#1a1a1a]">{T.okTitle}</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#888]">{T.okBody}</p>
          <button onClick={() => router.push('/eat/auth')} className="mt-7 w-full max-w-xs rounded-[30px] bg-[#F97316] py-3.5 text-base font-bold text-white active:scale-95">{T.toAuth}</button>
        </>
      )}

      {(state === 'invalid' || state === 'collision') && (
        <>
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#FEE2E2]">
            <XCircle size={44} className="text-[#DC2626]" />
          </div>
          <p className="mt-5 text-[20px] font-extrabold text-[#1a1a1a]">{state === 'collision' ? T.takenTitle : T.koTitle}</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#888]">{state === 'collision' ? T.takenBody : T.koBody}</p>
          <button onClick={() => router.push('/eat/account')} className="mt-7 w-full max-w-xs rounded-[30px] border-2 border-[#F97316] py-3.5 text-base font-bold text-[#F97316] active:scale-95">{T.toAccount}</button>
        </>
      )}
    </div>
  )
}

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f5f5f5]" />}>
      <ConfirmInner />
    </Suspense>
  )
}
