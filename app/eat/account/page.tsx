'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { Star, Clock, ChevronRight, Package, LogOut, User } from 'lucide-react'
import Link from 'next/link'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  received:   { label: 'Reçu',        color: 'bg-blue-100 text-blue-600' },
  preparing:  { label: 'Préparation', color: 'bg-amber-100 text-amber-600' },
  ready:      { label: 'Prêt',        color: 'bg-teal-100 text-teal-600' },
  picked_up:  { label: 'En route',    color: 'bg-purple-100 text-purple-600' },
  delivered:  { label: 'Livré',       color: 'bg-green-100 text-green-600' },
  cancelled:  { label: 'Annulé',      color: 'bg-red-100 text-red-600' },
}

interface Order {
  id: string; status: string; total: number; createdAt: string
  pointsEarned: number; estimatedTime: number
  restaurant: { name: string; logo?: string }
}

export default function AccountPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [orders, setOrders]   = useState<Order[]>([])
  const [points, setPoints]   = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/eat/auth')
      return
    }
    if (status !== 'authenticated') return
    Promise.all([
      fetch('/api/orders?take=10').then(r => r.json()),
      fetch('/api/loyalty/wallet').then(r => r.json()).catch(() => ({ pointsBalance: 0 })),
    ]).then(([ordersData, walletData]) => {
      setOrders(ordersData.orders ?? [])
      setPoints(walletData.pointsBalance ?? 0)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [status, router])

  const activeOrders   = orders.filter(o => !['delivered', 'cancelled'].includes(o.status))
  const completedOrders = orders.filter(o => ['delivered', 'cancelled'].includes(o.status))

  const tierData = points >= 5000 ? { label: 'Gold', color: 'from-amber-400 to-yellow-500', emoji: '🏆' }
    : points >= 1000 ? { label: 'Silver', color: 'from-gray-400 to-gray-500', emoji: '🥈' }
    : { label: 'Bronze', color: 'from-orange-500 to-red-500', emoji: '🥉' }
  const nextTier  = points >= 5000 ? 5000 : points >= 1000 ? 5000 : 1000
  const progress  = Math.min(100, (points / nextTier) * 100)

  if (loading || status === 'loading') {
    return (
      <div className="p-4 space-y-4">
        <div className="h-36 bg-gray-100 animate-pulse rounded-2xl" />
        <div className="h-20 bg-gray-100 animate-pulse rounded-2xl" />
        <div className="h-20 bg-gray-100 animate-pulse rounded-2xl" />
      </div>
    )
  }

  if (status === 'unauthenticated') return null

  return (
    <div className="pb-4">
      {/* Points wallet card */}
      <div className={`bg-gradient-to-r ${tierData.color} p-5 text-white`}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-white/80">Fidélité Grubano</p>
            <p className="text-3xl font-bold mt-0.5">{points} <span className="text-lg font-normal">pts</span></p>
            <p className="text-sm text-white/80 mt-0.5">{tierData.emoji} Niveau {tierData.label}</p>
          </div>
          <div className="bg-white/20 rounded-2xl px-3 py-1 text-sm font-medium">
            {session?.user?.name?.split(' ')[0] ?? 'Vous'}
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-white/70 mb-1">
            <span>{points} pts</span>
            <span>{nextTier} pts</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-white/70 mt-1 text-center">
            {nextTier - points} pts pour le niveau suivant
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Active orders */}
        {activeOrders.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
              <Clock size={14} className="text-orange-500" />
              Commandes en cours
            </h2>
            <div className="space-y-2">
              {activeOrders.map(order => {
                const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-gray-100 text-gray-600' }
                return (
                  <Link
                    key={order.id}
                    href={`/eat/track/${order.id}`}
                    className="flex items-center gap-3 bg-white border border-orange-100 rounded-2xl p-3 shadow-sm"
                  >
                    <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-lg flex-shrink-0">
                      {order.restaurant.logo
                        ? <img src={order.restaurant.logo} alt="" className="w-full h-full object-cover rounded-xl" />
                        : '🍽️'
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{order.restaurant.name}</p>
                      <p className="text-xs text-gray-500">{order.total.toFixed(2)}€</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${st.color}`}>
                      {st.label}
                    </span>
                    <ChevronRight size={14} className="text-gray-400" />
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Order history */}
        <section>
          <h2 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
            <Package size={14} className="text-gray-500" />
            Historique
          </h2>
          {completedOrders.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-sm">Aucune commande passée</p>
              <button onClick={() => router.push('/eat')} className="mt-2 text-orange-500 text-sm font-medium">
                Commander maintenant →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {completedOrders.map(order => {
                const st    = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-gray-100 text-gray-600' }
                const date  = new Date(order.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                return (
                  <div key={order.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl p-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg flex-shrink-0">
                      {order.restaurant.logo
                        ? <img src={order.restaurant.logo} alt="" className="w-full h-full object-cover rounded-xl" />
                        : '🍽️'
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{order.restaurant.name}</p>
                      <p className="text-xs text-gray-400">{date} · {order.total.toFixed(2)}€</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${st.color}`}>
                        {st.label}
                      </span>
                      {order.pointsEarned > 0 && (
                        <p className="text-[10px] text-amber-600 mt-0.5">+{order.pointsEarned} pts</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Profile section */}
        <section className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-50">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
              <User size={18} className="text-orange-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{session?.user?.name ?? '—'}</p>
              <p className="text-xs text-gray-400">{session?.user?.email ?? '—'}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/eat/auth' })}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-red-500 font-medium"
          >
            <span className="flex items-center gap-2"><LogOut size={14} /> Déconnexion</span>
            <ChevronRight size={14} />
          </button>
        </section>
      </div>
    </div>
  )
}
