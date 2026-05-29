'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  User, MapPin, CreditCard, Tag, Bell, Settings, LogOut, ChevronRight,
  Star, Package, Heart, MessageCircle, Shield, CircleHelp,
} from 'lucide-react'
import { showToast } from '@/lib/eat-cart'

// Loyalty tiers per CLAUDE.md: Bronze 50 → Silver 100 → Gold 200 → Platine 400
function tierFor(points: number) {
  if (points >= 400) return { label: 'Platine', next: 400, floor: 400 }
  if (points >= 200) return { label: 'Or', next: 400, floor: 200 }
  if (points >= 100) return { label: 'Argent', next: 200, floor: 100 }
  if (points >= 50) return { label: 'Bronze', next: 100, floor: 50 }
  return { label: 'Membre', next: 50, floor: 0 }
}

interface Order {
  id: string
  status: string
  total: number
}

export default function ProfileScreen() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [points, setPoints] = useState(0)
  const [orders, setOrders] = useState<Order[]>([])
  const [notif, setNotif] = useState(true)

  const loggedIn = status === 'authenticated'

  useEffect(() => {
    if (status !== 'authenticated') return
    Promise.all([
      fetch('/api/loyalty/wallet').then((r) => r.json()).catch(() => ({ pointsBalance: 0 })),
      fetch('/api/orders?take=50').then((r) => r.json()).catch(() => ({ orders: [] })),
    ]).then(([wallet, ord]) => {
      setPoints(wallet.pointsBalance ?? 0)
      setOrders(ord.orders ?? [])
    })
  }, [status])

  const MENU_ITEMS = [
    { icon: Package, label: 'Mes Commandes', route: '/eat/account', color: '#F97316' },
    { icon: Heart, label: 'Mes Favoris', route: '/eat/favorites', color: '#EF4444' },
    { icon: MapPin, label: 'Mes Adresses', route: null, color: '#3B82F6' },
    { icon: CreditCard, label: 'Paiement', route: null, color: '#22C55E' },
    { icon: Tag, label: 'Promotions', route: '/eat/promos', color: '#F59E0B' },
    { icon: Bell, label: 'Notifications', route: null, color: '#8B5CF6' },
    { icon: MessageCircle, label: 'Support Chat', route: null, color: '#06B6D4' },
    { icon: Shield, label: 'Confidentialité', route: null, color: '#64748B' },
    { icon: CircleHelp, label: 'Aide & FAQ', route: null, color: '#94A3B8' },
    { icon: Settings, label: 'Paramètres', route: null, color: '#6B7280' },
  ]

  // Guest
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#f5f5f5]">
        <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3"><div className="h-6 w-1/3 animate-pulse rounded bg-gray-200" /></div>
        <div className="space-y-3 p-4"><div className="h-24 animate-pulse rounded-2xl bg-white" /><div className="h-24 animate-pulse rounded-2xl bg-white" /></div>
      </div>
    )
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-[#f5f5f5]">
        <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
          <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">Mon Profil</h1>
        </div>
        <div className="flex flex-col items-center px-10 pt-20 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#FFF3ED]"><User size={48} className="text-[#F97316]" /></div>
          <p className="mt-5 text-[22px] font-extrabold text-[#1a1a1a]">Connectez-vous</p>
          <p className="mt-2 text-sm leading-relaxed text-[#888]">Accédez à votre profil, commandes et favoris</p>
          <button onClick={() => router.push('/eat/auth')} className="mt-8 w-full rounded-[30px] bg-[#F97316] py-4 text-base font-bold text-white active:scale-95">Se connecter</button>
          <button onClick={() => router.push('/eat/auth')} className="mt-3 w-full rounded-[30px] border-2 border-[#F97316] py-3.5 text-base font-bold text-[#F97316] active:scale-95">Créer un compte</button>
        </div>
      </div>
    )
  }

  const tier = tierFor(points)
  const span = tier.next - tier.floor
  const progress = tier.label === 'Platine' ? 100 : Math.min(100, ((points - tier.floor) / span) * 100)
  const nextLabel = tierFor(tier.next).label
  const name = session?.user?.name ?? 'Utilisateur'
  const email = session?.user?.email ?? ''

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <h1 className="font-sans text-[22px] font-extrabold text-[#1a1a1a]">Mon Profil</h1>
      </div>

      <div className="px-4 pb-6">
        {/* User card */}
        <div className="mt-3 flex items-center gap-3.5 rounded-[20px] bg-white p-4 shadow-bolt-card">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#F97316] bg-[#FFF3ED] text-2xl">🧑</div>
            <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#22C55E]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-extrabold text-[#1a1a1a]">{name}</p>
            <p className="truncate text-[13px] text-[#888]">{email}</p>
            <div className="mt-0.5 flex items-center gap-1">
              <Star size={13} className="fill-[#F97316] text-[#F97316]" />
              <span className="text-xs text-[#888]">Client fidèle</span>
            </div>
          </div>
          <button onClick={() => showToast('Édition du profil bientôt disponible')} className="rounded-[20px] bg-[#FFF3ED] px-3.5 py-[7px] text-[13px] font-bold text-[#F97316] active:scale-95">Modifier</button>
        </div>

        {/* Loyalty card */}
        <div className="mt-3 flex items-center gap-4 rounded-[20px] bg-[#F97316] p-5">
          <div className="flex-1">
            <p className="text-xs font-semibold text-white/80">Points Fidélité</p>
            <p className="mt-1 text-[28px] font-extrabold leading-none text-white">{points.toLocaleString('fr-FR')} pts</p>
            <p className="mt-1 text-[11px] text-white/80">
              {tier.label === 'Platine' ? 'Niveau maximum 🎉' : `${tier.next - points} pts avant le niveau ${nextLabel}`}
            </p>
          </div>
          <div className="flex flex-1 flex-col items-end gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/30">
              <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-white/90">{tier.label} → {nextLabel}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 flex rounded-[20px] bg-white py-5 shadow-bolt-card">
          <div className="flex flex-1 flex-col items-center gap-1"><span className="text-[22px] font-extrabold text-[#1a1a1a]">{orders.length}</span><span className="text-xs text-[#888]">Commandes</span></div>
          <div className="w-px bg-[#f0f0f0]" />
          <div className="flex flex-1 flex-col items-center gap-1"><span className="text-[22px] font-extrabold text-[#1a1a1a]">{orders.filter((o) => o.status === 'delivered').length}</span><span className="text-xs text-[#888]">Livrées</span></div>
          <div className="w-px bg-[#f0f0f0]" />
          <div className="flex flex-1 flex-col items-center gap-1"><span className="text-[22px] font-extrabold text-[#1a1a1a]">{points >= 50 ? tier.label : '–'}</span><span className="text-xs text-[#888]">Niveau</span></div>
        </div>

        {/* Notif toggle */}
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-bolt-soft">
          <Bell size={20} className="text-[#F97316]" />
          <span className="text-[15px] font-semibold text-[#1a1a1a]">Notifications push</span>
          <button
            onClick={() => setNotif((v) => !v)}
            className={`ml-auto flex h-7 w-12 items-center rounded-full px-0.5 transition-colors ${notif ? 'justify-end bg-[#F97316]' : 'justify-start bg-[#ddd]'}`}
          >
            <span className="h-6 w-6 rounded-full bg-white shadow" />
          </button>
        </div>

        {/* Menu */}
        <div className="mt-3 overflow-hidden rounded-[20px] bg-white shadow-bolt-card">
          {MENU_ITEMS.map((item, idx) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                onClick={() => (item.route ? router.push(item.route) : showToast('Bientôt disponible'))}
                className={`flex w-full items-center gap-3.5 px-4 py-3.5 active:bg-[#fafafa] ${idx === MENU_ITEMS.length - 1 ? '' : 'border-b border-[#f8f8f8]'}`}
              >
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl" style={{ backgroundColor: item.color + '18' }}>
                  <Icon size={18} style={{ color: item.color }} />
                </span>
                <span className="text-[15px] font-semibold text-[#1a1a1a]">{item.label}</span>
                <ChevronRight size={16} className="ml-auto text-[#ccc]" />
              </button>
            )
          })}
        </div>

        {/* Logout */}
        <button
          onClick={() => signOut({ callbackUrl: '/eat/auth' })}
          className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-[#FEE2E2] bg-white py-4 active:scale-[0.99]"
        >
          <LogOut size={18} className="text-[#EF4444]" />
          <span className="text-[15px] font-bold text-[#EF4444]">Se déconnecter</span>
        </button>

        <p className="mt-5 text-center text-xs text-[#ccc]">Grubano v1.0.0</p>
      </div>
    </div>
  )
}
