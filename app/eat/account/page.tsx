'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'
import { Clock, ChevronRight, Package, LogOut, User, RotateCcw } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  received: { label: 'Reçu', color: 'bg-blue-100 text-blue-600' },
  preparing: { label: 'Préparation', color: 'bg-amber-100 text-amber-600' },
  ready: { label: 'Prêt', color: 'bg-teal-100 text-teal-600' },
  picked_up: { label: 'En route', color: 'bg-purple-100 text-purple-600' },
  delivered: { label: 'Livré', color: 'bg-green-100 text-green-600' },
  cancelled: { label: 'Annulé', color: 'bg-red-100 text-red-600' },
}

// Loyalty tiers per CLAUDE.md: Bronze 50 → Silver 100 → Gold 200 → Platine 400
function tierFor(points: number) {
  if (points >= 400) return { label: 'Platine', emoji: '💎', next: 400, floor: 400 }
  if (points >= 200) return { label: 'Gold', emoji: '🏆', next: 400, floor: 200 }
  if (points >= 100) return { label: 'Silver', emoji: '🥈', next: 200, floor: 100 }
  if (points >= 50) return { label: 'Bronze', emoji: '🥉', next: 100, floor: 50 }
  return { label: 'Membre', emoji: '✨', next: 50, floor: 0 }
}

interface Order {
  id: string
  status: string
  total: number
  createdAt: string
  pointsEarned: number
  estimatedTime: number
  restaurant: { id?: string; name: string; logo?: string }
}

export default function AccountPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [points, setPoints] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/eat/auth')
      return
    }
    if (status !== 'authenticated') return
    Promise.all([
      fetch('/api/orders?take=10').then((r) => r.json()),
      fetch('/api/loyalty/wallet')
        .then((r) => r.json())
        .catch(() => ({ pointsBalance: 0 })),
    ])
      .then(([ordersData, walletData]) => {
        setOrders(ordersData.orders ?? [])
        setPoints(walletData.pointsBalance ?? 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [status, router])

  const activeOrders = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status))
  const historyOrders = orders.filter((o) => ['delivered', 'cancelled'].includes(o.status)).slice(0, 5)

  const tier = tierFor(points)
  const span = tier.next - tier.floor
  const progress = tier.label === 'Platine' ? 100 : Math.min(100, ((points - tier.floor) / span) * 100)
  const firstName = session?.user?.name?.split(' ')[0] ?? 'gourmand'

  if (loading || status === 'loading') {
    return (
      <div className="space-y-4 p-5">
        <div className="h-44 animate-pulse rounded-[24px] bg-gray-200" />
        <div className="h-20 animate-pulse rounded-[20px] bg-gray-100" />
        <div className="h-20 animate-pulse rounded-[20px] bg-gray-100" />
      </div>
    )
  }

  if (status === 'unauthenticated') return null

  return (
    <div className="bg-[#FAFAFA] pb-4">
      {/* Wallet card */}
      <div className="px-5 pt-5">
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#1a1a2e] to-[#2D3561] p-6 text-white shadow-[0_8px_32px_rgba(26,26,46,0.25)]">
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #E8593C, transparent 65%)' }}
          />
          <div className="relative z-10 flex items-start justify-between">
            <div>
              <p className="text-xs text-white/60">Bonjour {firstName} 👋</p>
              <p className="mt-2 text-[40px] font-bold leading-none tracking-tight">
                {points}
                <span className="ml-1.5 text-base font-normal text-white/70">pts</span>
              </p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold backdrop-blur">
              {tier.emoji} {tier.label}
            </span>
          </div>
          <div className="relative z-10 mt-6">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#E8593C] to-[#FF8A3D] transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-white/60">
              {tier.label === 'Platine' ? 'Niveau maximum atteint 🎉' : `Plus que ${tier.next - points} pts pour le niveau suivant`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-5">
        {/* Active orders */}
        {activeOrders.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold tracking-tight text-[#1a1a2e]">
              <Clock size={16} className="text-[#E8593C]" />
              En cours
            </h2>
            <div className="space-y-2.5">
              {activeOrders.map((order) => {
                const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-gray-100 text-gray-600' }
                return (
                  <Link
                    key={order.id}
                    href={`/eat/track/${order.id}`}
                    className="flex items-center gap-3 rounded-[20px] bg-white p-3.5 shadow-[0_4px_24px_rgba(0,0,0,0.05)] transition active:scale-[0.98]"
                  >
                    <FoodImage name={order.restaurant.name} src={order.restaurant.logo} className="h-12 w-12 shrink-0 rounded-2xl" glyphClassName="text-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#1a1a2e]">{order.restaurant.name}</p>
                      <p className="text-xs text-gray-400">{order.total.toFixed(2)}€</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${st.color}`}>{st.label}</span>
                    <ChevronRight size={16} className="text-gray-300" />
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* History */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold tracking-tight text-[#1a1a2e]">
            <Package size={16} className="text-gray-400" />
            Historique
          </h2>
          {historyOrders.length === 0 ? (
            <div className="rounded-[20px] bg-white py-12 text-center shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
              <div className="mb-2 text-4xl">🍜</div>
              <p className="text-sm font-semibold text-[#1a1a2e]">Vous nous manquez !</p>
              <p className="mt-0.5 text-sm text-gray-400">Passez votre première commande.</p>
              <button onClick={() => router.push('/eat')} className="mt-3 text-sm font-semibold text-[#E8593C] active:scale-95">
                Découvrir les restos →
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {historyOrders.map((order) => {
                const date = new Date(order.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                return (
                  <div key={order.id} className="flex items-center gap-3 rounded-[20px] bg-white p-3.5 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
                    <FoodImage name={order.restaurant.name} src={order.restaurant.logo} className="h-12 w-12 shrink-0 rounded-2xl" glyphClassName="text-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#1a1a2e]">{order.restaurant.name}</p>
                      <p className="text-xs text-gray-400">
                        {date} · {order.total.toFixed(2)}€
                        {order.pointsEarned > 0 && <span className="text-amber-600"> · +{order.pointsEarned} pts</span>}
                      </p>
                    </div>
                    {order.restaurant.id && (
                      <Link
                        href={`/eat/r/${order.restaurant.id}`}
                        className="flex items-center gap-1 rounded-full bg-[#FFF7F3] px-3 py-1.5 text-[11px] font-bold text-[#E8593C] transition active:scale-95"
                      >
                        <RotateCcw size={11} /> Recommander
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Profile */}
        <section className="overflow-hidden rounded-[20px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-3 border-b border-gray-50 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF7F3]">
              <User size={21} className="text-[#E8593C]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[#1a1a2e]">{session?.user?.name ?? '—'}</p>
              <p className="truncate text-xs text-gray-400">{session?.user?.email ?? '—'}</p>
            </div>
            <button className="text-xs font-bold text-[#E8593C] active:scale-95">Modifier</button>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/eat/auth' })}
            className="flex w-full items-center justify-between px-4 py-4 text-sm font-medium text-red-500 transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <LogOut size={16} /> Déconnexion
            </span>
            <ChevronRight size={16} />
          </button>
        </section>
      </div>
    </div>
  )
}
