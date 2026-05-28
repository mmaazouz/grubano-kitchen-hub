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

  if (loading || status === 'loading') {
    return (
      <div className="space-y-4 p-4">
        <div className="h-40 animate-pulse rounded-3xl bg-gray-200" />
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100" />
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100" />
      </div>
    )
  }

  if (status === 'unauthenticated') return null

  return (
    <div className="pb-4">
      {/* Wallet card */}
      <div className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1a1a2e] to-[#252547] p-5 text-white shadow-[0_8px_24px_rgba(26,26,46,0.25)]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-white/60">Fidélité Grubano</p>
              <p className="mt-1 text-4xl font-bold leading-none">
                {points}
                <span className="ml-1 text-base font-normal text-white/70">pts</span>
              </p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold backdrop-blur">
              {tier.emoji} {tier.label}
            </span>
          </div>

          {/* Progress */}
          <div className="mt-5">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#E8593C] to-[#F7971E] transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-white/60">
              {tier.label === 'Platine'
                ? 'Niveau maximum atteint 🎉'
                : `${tier.next - points} pts pour le niveau suivant`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {/* Active orders */}
        {activeOrders.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#1a1a2e]">
              <Clock size={15} className="text-[#E8593C]" />
              Commandes en cours
            </h2>
            <div className="space-y-2">
              {activeOrders.map((order) => {
                const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-gray-100 text-gray-600' }
                return (
                  <Link
                    key={order.id}
                    href={`/eat/track/${order.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition active:scale-[0.98]"
                  >
                    <FoodImage
                      name={order.restaurant.name}
                      src={order.restaurant.logo}
                      className="h-11 w-11 flex-shrink-0 rounded-xl"
                      glyphClassName="text-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#1a1a2e]">{order.restaurant.name}</p>
                      <p className="text-xs text-gray-500">{order.total.toFixed(2)}€</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${st.color}`}>
                      {st.label}
                    </span>
                    <ChevronRight size={15} className="text-gray-300" />
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* History */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#1a1a2e]">
            <Package size={15} className="text-gray-500" />
            Historique
          </h2>
          {historyOrders.length === 0 ? (
            <div className="rounded-2xl border border-black/[0.06] bg-white py-10 text-center">
              <div className="mb-2 text-4xl">🍽️</div>
              <p className="text-sm text-gray-500">Aucune commande passée</p>
              <button
                onClick={() => router.push('/eat')}
                className="mt-2 text-sm font-semibold text-[#E8593C] active:scale-95"
              >
                Commander maintenant →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {historyOrders.map((order) => {
                const st = STATUS_LABELS[order.status] ?? { label: order.status, color: 'bg-gray-100 text-gray-600' }
                const date = new Date(order.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                return (
                  <div
                    key={order.id}
                    className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                  >
                    <FoodImage
                      name={order.restaurant.name}
                      src={order.restaurant.logo}
                      className="h-11 w-11 flex-shrink-0 rounded-xl"
                      glyphClassName="text-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#1a1a2e]">{order.restaurant.name}</p>
                      <p className="text-xs text-gray-400">
                        {date} · {order.total.toFixed(2)}€
                        {order.pointsEarned > 0 && <span className="text-amber-600"> · +{order.pointsEarned} pts</span>}
                      </p>
                    </div>
                    {order.restaurant.id ? (
                      <Link
                        href={`/eat/r/${order.restaurant.id}`}
                        className="flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1.5 text-[11px] font-semibold text-[#E8593C] transition active:scale-95"
                      >
                        <RotateCcw size={11} /> Recommander
                      </Link>
                    ) : (
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${st.color}`}>{st.label}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Profile */}
        <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 border-b border-gray-50 p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100">
              <User size={20} className="text-[#E8593C]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[#1a1a2e]">{session?.user?.name ?? '—'}</p>
              <p className="truncate text-xs text-gray-400">{session?.user?.email ?? '—'}</p>
            </div>
            <button className="text-xs font-semibold text-[#E8593C] active:scale-95">Modifier</button>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/eat/auth' })}
            className="flex w-full items-center justify-between px-4 py-3.5 text-sm font-medium text-red-500 transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <LogOut size={15} /> Déconnexion
            </span>
            <ChevronRight size={15} />
          </button>
        </section>
      </div>
    </div>
  )
}
