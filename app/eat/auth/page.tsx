'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

type Tab = 'login' | 'register'

export default function AuthPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)

    if (tab === 'register') {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role: 'consumer' }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Erreur lors de la création du compte')
          setLoading(false)
          return
        }
      } catch {
        setError('Erreur réseau')
        setLoading(false)
        return
      }
    }

    const result = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)

    if (result?.error) {
      setError('Email ou mot de passe incorrect')
      return
    }
    router.push('/eat/account')
  }

  function handleGoogle() {
    setError('')
    setNotice('Connexion Google bientôt disponible. Utilisez votre email pour le moment.')
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAFA]">
      {/* Brand header */}
      <div className="relative overflow-hidden rounded-b-[28px] bg-gradient-to-br from-[#E8593C] to-[#B11E2F] px-6 pb-12 pt-16 text-center text-white">
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.6), transparent 60%)' }}
        />
        <div className="relative">
          <div className="mx-auto mb-3 flex h-[68px] w-[68px] items-center justify-center rounded-3xl bg-white/15 text-4xl backdrop-blur">
            🍽️
          </div>
          <h1 className="text-[26px] font-bold tracking-tight">Grubano</h1>
          <p className="mt-1 text-sm text-white/85">Vos restos préférés, livrés vite</p>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 px-5 pt-6">
        <div className="mx-auto max-w-sm rounded-[24px] bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
          {/* Tabs */}
          <div className="mb-5 flex rounded-2xl bg-gray-100 p-1">
            {(['login', 'register'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  setError('')
                  setNotice('')
                }}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all duration-200 ${
                  tab === t ? 'bg-white text-[#E8593C] shadow-sm' : 'text-gray-500'
                }`}
              >
                {t === 'login' ? 'Connexion' : 'Inscription'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {tab === 'register' && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-700">Prénom & nom</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Jean Dupont"
                  className="w-full rounded-2xl border border-black/[0.06] bg-[#FAFAFA] px-4 py-3 text-sm transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700">Adresse email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="jean@example.com"
                autoComplete="email"
                className="w-full rounded-2xl border border-black/[0.06] bg-[#FAFAFA] px-4 py-3 text-sm transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={tab === 'register' ? 8 : 1}
                  placeholder={tab === 'register' ? 'Min. 8 caractères' : '••••••••'}
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  className="w-full rounded-2xl border border-black/[0.06] bg-[#FAFAFA] px-4 py-3 pr-10 text-sm transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <p className="rounded-2xl bg-red-50 px-3 py-2.5 text-center text-sm text-red-600">{error}</p>}
            {notice && <p className="rounded-2xl bg-amber-50 px-3 py-2.5 text-center text-sm text-amber-700">{notice}</p>}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E8593C] py-3.5 text-base font-bold text-white shadow-[0_4px_24px_rgba(232,89,60,0.35)] transition active:scale-[0.98] disabled:bg-orange-300"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Chargement…
                </>
              ) : tab === 'login' ? (
                'Se connecter'
              ) : (
                'Créer mon compte'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-xs text-gray-400">ou</span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-black/[0.1] bg-white py-3 text-sm font-semibold text-gray-700 transition active:scale-[0.98]"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            Continuer avec Google
          </button>
        </div>

        <p className="mt-5 text-center text-sm text-gray-500">
          {tab === 'login' ? (
            <>
              Pas encore de compte ?{' '}
              <button onClick={() => setTab('register')} className="font-bold text-[#E8593C]">
                S&apos;inscrire
              </button>
            </>
          ) : (
            <>
              Déjà un compte ?{' '}
              <button onClick={() => setTab('login')} className="font-bold text-[#E8593C]">
                Se connecter
              </button>
            </>
          )}
        </p>

        {tab === 'register' && (
          <p className="mx-auto mt-4 max-w-sm pb-6 text-center text-[10px] leading-relaxed text-gray-400">
            En créant un compte vous acceptez nos conditions d&apos;utilisation et notre politique de confidentialité.
          </p>
        )}
      </div>
    </div>
  )
}
