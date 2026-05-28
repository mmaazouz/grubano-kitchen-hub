'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Clock, MapPin, Phone, Home, ChevronRight, Check } from 'lucide-react'

const STEPS = [
  { key: 'received', label: 'Reçu', emoji: '✅', desc: 'Commande confirmée' },
  { key: 'preparing', label: 'En préparation', emoji: '🍳', desc: 'Le restaurant cuisine' },
  { key: 'picked_up', label: 'En route', emoji: '🛵', desc: 'Le livreur arrive' },
  { key: 'delivered', label: 'Livré', emoji: '🏠', desc: 'Bon appétit !' },
] as const

// Map raw statuses → index in the 4-step display.
const STATUS_TO_STEP: Record<string, number> = {
  received: 0,
  preparing: 1,
  ready: 1,
  picked_up: 2,
  delivered: 3,
}

interface Order {
  id: string
  status: string
  total: number
  estimatedTime: number
  items: { name: string; qty: number; price: number }[]
  restaurant: { name: string; address: string; logo?: string }
  pointsEarned: number
  createdAt: string
  deliveryAddress: string
}

export default function TrackPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (res.status === 401) {
        router.push('/eat/auth')
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setOrder(data.order)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [orderId, router])

  // Initial fetch + poll every 15s
  useEffect(() => {
    fetchOrder()
    const poll = setInterval(fetchOrder, 15_000)
    return () => clearInterval(poll)
  }, [fetchOrder])

  // ETA countdown
  useEffect(() => {
    if (!order) return
    const created = new Date(order.createdAt).getTime()
    const eta = created + order.estimatedTime * 60_000
    const update = () => setSecondsLeft(Math.max(0, Math.floor((eta - Date.now()) / 1000)))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [order])

  const currentStep = order ? STATUS_TO_STEP[order.status] ?? 0 : 0
  const isDelivered = order?.status === 'delivered'
  const isCancelled = order?.status === 'cancelled'

  function etaText() {
    if (isDelivered) return 'Livré'
    if (secondsLeft <= 0) return 'Arrivée imminente'
    const m = Math.ceil(secondsLeft / 60)
    return `~${m} min`
  }

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-8 w-1/2 animate-pulse rounded bg-gray-200" />
        <div className="h-40 animate-pulse rounded-2xl bg-gray-200" />
        <div className="h-32 animate-pulse rounded-2xl bg-gray-100" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">😕</div>
        <p className="font-semibold text-gray-600">Commande introuvable</p>
        <button onClick={() => router.push('/eat')} className="text-sm font-semibold text-[#E8593C] active:scale-95">
          Retour à l&apos;accueil
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-8">
      {/* Hero ETA */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1a1a2e] to-[#252547] p-6 text-white">
        <div className="relative z-10">
          <p className="text-sm text-white/70">
            {isCancelled ? 'Commande annulée' : isDelivered ? 'Commande livrée' : 'Arrivée estimée'}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Clock size={26} className="text-[#E8593C]" />
            <span className="text-3xl font-bold">{etaText()}</span>
          </div>
          <p className="mt-1 text-xs text-white/50">Commande #{order.id.slice(-8).toUpperCase()}</p>
        </div>
        {/* Animated emoji */}
        <div className="absolute -bottom-2 right-2 text-7xl opacity-90">
          <span className="inline-block animate-bounce">{STEPS[currentStep]?.emoji}</span>
        </div>
      </div>

      {/* Step progress */}
      <div className="mt-5 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="flex items-start justify-between">
          {STEPS.map((step, i) => {
            const done = i < currentStep || isDelivered
            const active = i === currentStep && !isDelivered
            return (
              <div key={step.key} className="flex flex-1 flex-col items-center">
                <div className="relative flex w-full items-center justify-center">
                  {/* connector left */}
                  {i > 0 && (
                    <div
                      className={`absolute right-1/2 top-1/2 h-0.5 w-full -translate-y-1/2 ${
                        i <= currentStep || isDelivered ? 'bg-[#E8593C]' : 'bg-gray-200'
                      }`}
                    />
                  )}
                  <div
                    className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full text-lg transition-all duration-300 ${
                      done
                        ? 'bg-[#E8593C] text-white shadow-[0_2px_8px_rgba(232,89,60,0.4)]'
                        : active
                          ? 'bg-orange-100 ring-2 ring-[#E8593C]'
                          : 'bg-gray-100'
                    } ${active ? 'animate-pulse' : ''}`}
                  >
                    {done ? <Check size={20} strokeWidth={3} /> : step.emoji}
                  </div>
                </div>
                <p
                  className={`mt-2 text-center text-[11px] font-semibold leading-tight ${
                    done || active ? 'text-[#1a1a2e]' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </p>
              </div>
            )
          })}
        </div>
        <p className="mt-4 text-center text-sm font-medium text-gray-500">
          {isCancelled ? 'Cette commande a été annulée.' : STEPS[currentStep]?.desc}
        </p>
      </div>

      {/* Delivered celebration */}
      {isDelivered && (
        <div className="mt-4 rounded-2xl border border-green-100 bg-green-50 p-4 text-center">
          <p className="text-2xl">🎉</p>
          <p className="font-bold text-green-700">Commande livrée !</p>
          <p className="mt-0.5 text-xs text-green-600">+{order.pointsEarned} points fidélité crédités</p>
        </div>
      )}

      {/* Order summary */}
      <div className="mt-4 space-y-3 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-[#1a1a2e]">{order.restaurant.name}</h2>
        </div>
        <div className="flex items-start gap-2 text-xs text-gray-500">
          <MapPin size={13} className="mt-0.5 flex-shrink-0 text-[#E8593C]" />
          <span>{order.deliveryAddress}</span>
        </div>
        <div className="divide-y divide-gray-50 border-t border-gray-100 pt-1">
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between py-1.5 text-sm">
              <span className="text-gray-700">
                {item.qty}× {item.name}
              </span>
              <span className="font-medium text-[#1a1a2e]">{(item.price * item.qty).toFixed(2)}€</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-bold">
          <span>Total payé</span>
          <span className="text-[#E8593C]">{order.total.toFixed(2)}€</span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 space-y-2">
        <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#E8593C] bg-white py-3.5 text-sm font-bold text-[#E8593C] transition active:scale-[0.98]">
          <Phone size={16} /> Contacter le restaurant
        </button>
        {(isDelivered || isCancelled) && (
          <button
            onClick={() => router.push('/eat')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E8593C] py-3.5 text-sm font-bold text-white shadow-[0_4px_16px_rgba(232,89,60,0.35)] transition active:scale-[0.98]"
          >
            <Home size={16} /> Commander à nouveau
          </button>
        )}
        <button
          onClick={() => router.push('/eat/account')}
          className="flex w-full items-center justify-center gap-1 py-2 text-sm font-medium text-gray-500"
        >
          Voir mes commandes <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}
