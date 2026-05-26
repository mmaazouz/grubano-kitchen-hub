'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ChefHat, Loader2, Eye, EyeOff } from 'lucide-react'

const ROLE_REDIRECTS: Record<string, string> = {
  restaurant: '/dashboard',
  admin:      '/dashboard',
  franchise:  '/franchise',
  creator:    '/creators',
  consumer:   '/account',
}

export default function LoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (res?.error) {
      setError('Email ou mot de passe incorrect')
      setLoading(false)
      return
    }

    // Fetch session to get role, then redirect
    const session = await fetch('/api/auth/session').then(r => r.json())
    const role    = session?.user?.role ?? 'consumer'
    router.push(ROLE_REDIRECTS[role] ?? '/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy via-navy to-[#0d1b2a] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center mb-3 shadow-lg shadow-primary/30">
            <ChefHat size={28} className="text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-display font-bold text-white tracking-tight">Grubano</h1>
          <p className="text-sm text-white/40 mt-1">Connectez-vous à votre portail</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/60 mb-1.5 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="vous@exemple.com"
              className="w-full rounded-xl bg-white/10 border border-white/10 text-white placeholder:text-white/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-white/60 mb-1.5 uppercase tracking-wider">
              Mot de passe
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-xl bg-white/10 border border-white/10 text-white placeholder:text-white/30 px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-destructive text-sm text-center bg-destructive/10 rounded-xl py-2 px-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" />Connexion...</> : 'Se connecter'}
          </button>
        </form>

        {/* Portal hints */}
        <div className="mt-8 grid grid-cols-2 gap-2">
          {[
            { role: 'Restaurant', color: 'bg-primary/20 text-primary' },
            { role: 'Franchise',  color: 'bg-success/20 text-success' },
            { role: 'Créateur',   color: 'bg-amber-500/20 text-amber-400' },
            { role: 'Client',     color: 'bg-white/10 text-white/60' },
          ].map(({ role, color }) => (
            <div key={role} className={`rounded-xl px-3 py-2 text-center text-[11px] font-semibold ${color}`}>
              {role}
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-white/30 mt-3">
          Un seul login pour tous les portails
        </p>
      </div>
    </div>
  )
}
