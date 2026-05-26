'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Eye, EyeOff, Loader2, ChevronRight } from 'lucide-react'

type Tab = 'login' | 'register'

export default function AuthPage() {
  const router = useRouter()
  const [tab, setTab]         = useState<Tab>('login')
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (tab === 'register') {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role: 'consumer' }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Erreur lors de la création du compte'); setLoading(false); return }
      } catch {
        setError('Erreur réseau')
        setLoading(false)
        return
      }
    }

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError('Email ou mot de passe incorrect')
      return
    }

    router.push('/eat/account')
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-orange-500 to-orange-700 px-6 pt-12 pb-8 text-white text-center">
        <div className="text-4xl mb-2">🍽️</div>
        <h1 className="text-xl font-bold">Grubano</h1>
        <p className="text-orange-100 text-sm mt-1">Commander n&apos;a jamais été aussi simple</p>
      </div>

      <div className="flex-1 bg-gray-50 px-5 pt-6 pb-8">
        {/* Tabs */}
        <div className="flex bg-white rounded-2xl p-1 mb-6 border border-gray-100 shadow-sm">
          {(['login', 'register'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === t
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'login' ? 'Connexion' : 'Inscription'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Prénom & nom</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="Jean Dupont"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-transparent transition"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Adresse email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="jean@example.com"
              autoComplete={tab === 'login' ? 'email' : 'new-email'}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Mot de passe</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={tab === 'register' ? 8 : 1}
                placeholder={tab === 'register' ? 'Min. 8 caractères' : '••••••••'}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-transparent transition pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base transition-colors mt-2"
          >
            {loading ? (
              <><Loader2 size={18} className="animate-spin" /> Chargement…</>
            ) : (
              <>{tab === 'login' ? 'Se connecter' : 'Créer mon compte'} <ChevronRight size={18} /></>
            )}
          </button>
        </form>

        {/* Switch tab link */}
        <p className="text-center text-sm text-gray-500 mt-5">
          {tab === 'login' ? (
            <>Pas encore de compte ?{' '}
              <button onClick={() => setTab('register')} className="text-orange-500 font-semibold">S&apos;inscrire</button>
            </>
          ) : (
            <>Déjà un compte ?{' '}
              <button onClick={() => setTab('login')} className="text-orange-500 font-semibold">Se connecter</button>
            </>
          )}
        </p>

        {/* Terms */}
        {tab === 'register' && (
          <p className="text-center text-[10px] text-gray-400 mt-4 leading-relaxed">
            En créant un compte vous acceptez nos conditions d&apos;utilisation et notre politique de confidentialité.
          </p>
        )}
      </div>
    </div>
  )
}
