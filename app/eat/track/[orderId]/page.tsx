'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Clock, MapPin, Phone, Home, ChevronRight, Check } from 'lucide-react'

const STEPS = [
  { key: 'received', label: 'Reçu', emoji: '✅', desc: 'Commande confirmée' },
  { key: 'preparing', label: 'En préparation', emoji: '🍳', desc: 'Le restaurant cuisine pour vous' },
  { key: 'picked_up', label: 'En route', emoji: '🛵', desc: 'Le livreur arrive vers vous' },
  { key: 'delivered', label: 'Livré', emoji: '🏠', desc: 'Bon appétit !' },
] as const

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

  useEffect(() => {
    fetchOrder()
    const poll = setInterval(fetchOrder, 15_000)
    return () => clearInterval(poll)
  }, [fetchOrder])

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
    if (secondsLeft <= 0) return 'Bientôt'
    const m = Math.ceil(secondsLeft / 60)
    return `~${m} min`
  }

  if (loading) {
    return (
      <div className="space-y-4 p-5">
        <div className="h-36 animate-pulse rounded-[24px] bg-gray-200" />
        <div className="h-32 animate-pulse rounded-[20px] bg-gray-100" />
        <div className="h-40 animate-pulse rounded-[20px] bg-gray-100" />
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
    <div className="bg-[#FAFAFA] p-5 pb-8">
      {/* Hero ETA */}
      <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#1a1a2e] to-[#2D3561] p-6 text-white shadow-[0_8px_32px_rgba(26,26,46,0.25)]">
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #E8593C, transparent 65%)' }}
        />
        <div className="relative z-10">
          <p className="text-sm text-white/60">
            {isCancelled ? 'Commande annulée' : isDelivered ? 'Commande livrée' : 'Arrivée estimée'}
          </p>
          <div className="mt-1.5 flex items-center gap-2.5">
            <Clock size={28} className="text-[#E8593C]" />
            <span className="text-[34px] font-bold leading-none tracking-tight">{etaText()}</span>
          </div>
          <p className="mt-2 text-xs text-white/40">Commande #{order.id.slice(-8).toUpperCase()}</p>
        </div>
        <div className="absolute -bottom-3 right-3 text-7xl">
          <span className="inline-block animate-bounce">{STEPS[currentStep]?.emoji}</span>
        </div>
      </div>

      {/* Step progress */}
      <div className="mt-5 rounded-[20px] bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
        <div className="flex items-start justify-between">
          {STEPS.map((step, i) => {
            const done = i < currentStep || isDelivered
            const active = i === currentStep && !isDelivered
            return (
              <div key={step.key} className="flex flex-1 flex-col items-center">
                <div className="relative flex w-full items-center justify-center">
                  {i > 0 && (
                    <div
                      className={`absolute right-1/2 top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full ${
                        i <= currentStep || isDelivered ? 'bg-[#E8593C]' : 'bg-gray-100'
                      }`}
                    />
                  )}
                  <div
                    className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-full text-lg transition-all duration-300 ${
                      done
                        ? 'bg-[#E8593C] text-white shadow-[0_4px_16px_rgba(232,89,60,0.4)]'
                        : active
                          ? 'bg-[#FFF7F3] ring-2 ring-[#E8593C]'
                          : 'bg-gray-50'
                    } ${active ? 'animate-pulse' : ''}`}
                  >
                    {done ? <Check size={21} strokeWidth={3} /> : step.emoji}
                  </div>
                </div>
                <p className={`mt-2.5 text-center text-[11px] font-semibold leading-tight ${done || active ? 'text-[#1a1a2e]' : 'text-gray-300'}`}>
                  {step.label}
                </p>
              </div>
            )
          })}
        </div>
        <p className="mt-5 text-center text-sm font-medium text-gray-500">
          {isCancelled ? 'Cette commande a été annulée.' : STEPS[currentStep]?.desc}
        </p>
      </div>

      {/* Delivered celebration */}
      {isDelivered && (
        <div className="mt-4 rounded-[20px] border border-green-100 bg-green-50 p-5 text-center">
          <p className="text-3xl">🎉</p>
          <p className="mt-1 font-bold text-green-700">Régalez-vous bien !</p>
          <p className="mt-0.5 text-xs text-green-600">+{order.pointsEarned} points fidélité crédités</p>
        </div>
      )}

      {/* Order summary */}
      <div className="mt-4 space-y-3 rounded-[20px] bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
        <h2 className="text-base font-bold tracking-tight text-[#1a1a2e]">{order.restaurant.name}</h2>
        <div className="flex items-start gap-2 text-xs text-gray-500">
          <MapPin size={14} className="mt-0.5 shrink-0 text-[#E8593C]" />
          <span>{order.deliveryAddress}</span>
        </div>
        <div className="divide-y divide-gray-50 border-t border-gray-100 pt-1">
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between py-2 text-sm">
              <span className="text-gray-600">
                <span className="font-semibold text-[#1a1a2e]">{item.qty}×</span> {item.name}
              </span>
              <span className="font-medium text-[#1a1a2e]">{(item.price * item.qty).toFixed(2)}€</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-gray-100 pt-3 text-sm font-bold">
          <span>Total payé</span>
          <span className="text-[#E8593C]">{order.total.toFixed(2)}€</span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 space-y-2.5">
        <button className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#E8593C] bg-white py-3.5 text-sm font-bold text-[#E8593C] transition active:scale-[0.98]">
          <Phone size={16} /> Contacter le restaurant
        </button>
        {(isDelivered || isCancelled) && (
          <button
            onClick={() => router.push('/eat')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E8593C] py-3.5 text-sm font-bold text-white shadow-[0_4px_24px_rgba(232,89,60,0.35)] transition active:scale-[0.98]"
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
