'use client'

import { useState, useEffect } from 'react'
import { useRouter } from '@/navigation'
import { useSession } from 'next-auth/react'
import { Mail, ArrowLeft, ShieldCheck } from 'lucide-react'

// Minimal, functional FR UI for the account email change (Agent 147). FR sober, plain Tailwind
// (no design system / Stellar) — will be restyled at the design pass. Flag-gated server-side:
// when AUTH_EMAIL_CHANGE_ENABLED is OFF every call 404s and the screen surfaces a neutral notice.
// Strings live in this const (JS literals) so apostrophes never trip react/no-unescaped-entities.
const T = {
  back:        'Retour',
  title:       "Changer d'e-mail",
  intro:       "Votre e-mail sert d'identifiant de connexion. Pour le changer en toute sécurité : confirmez votre identité avec un code envoyé à votre adresse actuelle, puis validez la nouvelle adresse via le lien qu'elle recevra.",
  newEmail:    'Nouvelle adresse e-mail',
  newEmailPh:  'nouvelle@adresse.com',
  sendCode:    "M'envoyer un code de confirmation",
  codeSent:    "Un code vient d'être envoyé à votre adresse e-mail actuelle. Saisissez-le ci-dessous.",
  code:        'Code reçu sur votre adresse actuelle',
  codePh:      '123456',
  submit:      'Confirmer le changement',
  working:     'Patientez…',
  doneTitle:   'Vérifiez votre nouvelle boîte mail',
  doneBody:    "Si tout est correct, un e-mail de confirmation vient d'être envoyé à votre nouvelle adresse. Cliquez le lien qu'il contient pour finaliser le changement. Tant que vous ne l'avez pas fait, vous restez connecté avec votre adresse actuelle.",
  errGeneric:  'Une erreur est survenue. Réessayez.',
  errThrottle: 'Trop de demandes. Réessayez dans quelques minutes.',
  errUnavail:  "Le changement d'e-mail n'est pas disponible pour ce compte.",
  errCode:     'Code invalide ou expiré.',
  needNew:     'Saisissez une nouvelle adresse e-mail.',
}

export default function ChangeEmailScreen() {
  const router = useRouter()
  const { status } = useSession()

  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/eat/auth')
  }, [status, router])

  async function requestCode() {
    setError('')
    if (!newEmail.trim()) { setError(T.needNew); return }
    setBusy(true)
    try {
      const res = await fetch('/api/account/email-change/request-code', { method: 'POST' })
      if (res.status === 404) { setError(T.errUnavail); return }
      if (res.status === 403) { setError(T.errUnavail); return }
      if (res.status === 429) { setError(T.errThrottle); return }
      if (!res.ok) { setError(T.errGeneric); return }
      setCodeRequested(true)
    } catch {
      setError(T.errGeneric)
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/account/email-change/request', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ newEmail: newEmail.trim(), currentEmailCode: code.trim() }),
      })
      if (res.status === 404 || res.status === 403) { setError(T.errUnavail); return }
      if (res.status === 400) { setError(T.errCode); return }
      if (!res.ok) { setError(T.errGeneric); return }
      setDone(true) // generic success — whether the new address was free or already in use
    } catch {
      setError(T.errGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="flex items-center gap-2 border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <button onClick={() => router.push('/eat/account')} aria-label={T.back} className="active:opacity-60">
          <ArrowLeft size={22} className="text-[#1a1a1a]" />
        </button>
        <h1 className="font-sans text-[20px] font-extrabold text-[#1a1a1a]">{T.title}</h1>
      </div>

      <div className="px-4 pb-10 pt-4">
        {done ? (
          <div className="rounded-[20px] bg-white p-5 text-center shadow-bolt-card">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#FFF3ED]">
              <Mail size={32} className="text-[#F97316]" />
            </div>
            <p className="mt-4 text-[18px] font-extrabold text-[#1a1a1a]">{T.doneTitle}</p>
            <p className="mt-2 text-sm leading-relaxed text-[#888]">{T.doneBody}</p>
            <button
              onClick={() => router.push('/eat/account')}
              className="mt-6 w-full rounded-[30px] bg-[#F97316] py-3.5 text-base font-bold text-white active:scale-95"
            >
              {T.back}
            </button>
          </div>
        ) : (
          <div className="rounded-[20px] bg-white p-5 shadow-bolt-card">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[#F97316]" />
              <p className="text-[13px] leading-relaxed text-[#666]">{T.intro}</p>
            </div>

            <label className="mt-5 block text-[13px] font-bold text-[#1a1a1a]">{T.newEmail}</label>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={T.newEmailPh}
              className="mt-1.5 w-full rounded-xl border border-[#e5e5e5] bg-white px-4 py-3 text-[15px] text-[#1a1a1a] outline-none focus:border-[#F97316]"
            />

            <button
              onClick={requestCode}
              disabled={busy}
              className="mt-3 w-full rounded-[30px] border-2 border-[#F97316] py-3 text-[15px] font-bold text-[#F97316] active:scale-95 disabled:opacity-50"
            >
              {busy && !codeRequested ? T.working : T.sendCode}
            </button>

            {codeRequested && (
              <>
                <p className="mt-4 rounded-xl bg-[#FFF3ED] px-3 py-2.5 text-[13px] leading-relaxed text-[#B45309]">{T.codeSent}</p>
                <label className="mt-4 block text-[13px] font-bold text-[#1a1a1a]">{T.code}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={T.codePh}
                  className="mt-1.5 w-full rounded-xl border border-[#e5e5e5] bg-white px-4 py-3 text-[15px] tracking-widest text-[#1a1a1a] outline-none focus:border-[#F97316]"
                />
                <button
                  onClick={submit}
                  disabled={busy || !code.trim()}
                  className="mt-3 w-full rounded-[30px] bg-[#F97316] py-3.5 text-base font-bold text-white active:scale-95 disabled:opacity-50"
                >
                  {busy ? T.working : T.submit}
                </button>
              </>
            )}

            {error && <p className="mt-4 text-center text-[13px] font-semibold text-[#DC2626]">{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
