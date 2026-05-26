'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle, Circle, Clock, ChevronRight, MapPin, Phone } from 'lucide-react'

const STEPS = [
  { key: 'received',   label: 'Reçu',       icon: '📋', desc: 'Commande confirmée' },
  { key: 'preparing',  label: 'Préparation', icon: '👨‍🍳', desc: 'Le restaurant prépare' },
  { key: 'picked_up',  label: 'En route',    icon: '🛵', desc: 'Le livreur arrive' },
  { key: 'delivered',  label: 'Livré',       icon: '✅', desc: 'Bon appétit !' },
]

const STATUS_ORDER = ['received', 'preparing', 'ready', 'picked_up', 'delivered']

interface Order {
  id: string; status: string; total: number; estimatedTime: number
  items: { name: string; qty: number; price: number }[]
  restaurant: { name: string; address: string }
  pointsEarned: number; createdAt: string; deliveryAddress: string
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
      if (!res.ok) return
      const data = await res.json()
      setOrder(data.order)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [orderId])

  // Initial fetch + polling every 15 s
  useEffect(() => {
    fetchOrder()
    const poll = setInterval(fetchOrder, 15_000)
    return () => clearInterval(poll)
  }, [fetchOrder])

  // ETA countdown
  useEffect(() => {
    if (!order) return
    const created = new Date(order.createdAt).getTime()
    const eta     = created + order.estimatedTime * 60_000
    const update  = () => setSecondsLeft(Math.max(0, Math.floor((eta - Date.now()) / 1000)))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [order])

  const currentIdx = order ? STATUS_ORDER.indexOf(order.status) : -1

  function stepState(stepKey: string): 'done' | 'active' | 'pending' {
    const stepIdx = STATUS_ORDER.indexOf(stepKey === 'picked_up' ? 'picked_up' : stepKey)
    if (currentIdx > stepIdx) return 'done'
    if (currentIdx === stepIdx) return 'active'
    return 'pending'
  }

  function formatEta() {
    if (order?.status === 'delivered') return null
    if (secondsLeft <= 0) return 'Arrivée imminente'
    const m = Math.floor(secondsLeft / 60)
    const s = secondsLeft % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 bg-gray-100 animate-pulse rounded-xl w-2/3" />
        <div className="h-32 bg-gray-100 animate-pulse rounded-2xl" />
        <div className="h-24 bg-gray-100 animate-pulse rounded-2xl" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 p-6">
        <p className="text-gray-500">Commande introuvable</p>
        <button onClick={() => router.push('/eat')} className="text-orange-500 font-medium text-sm">Retour à l&apos;accueil</button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Suivi de commande</h1>
          <p className="text-xs text-gray-400">#{order.id.slice(-8).toUpperCase()}</p>
        </div>
        {order.status !== 'delivered' && order.status !== 'cancelled' && formatEta() && (
          <div className="bg-orange-500 text-white px-3 py-2 rounded-2xl text-center">
            <div className="flex items-center gap-1 text-xs font-medium">
              <Clock size={12} />
              ETA
            </div>
            <p className="text-base font-bold leading-none mt-0.5">{formatEta()}</p>
          </div>
        )}
      </div>

      {/* Progress steps */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="relative">
          {/* Progress line */}
          <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-gray-100" />
          <div
            className="absolute left-5 top-5 w-0.5 bg-orange-500 transition-all duration-700"
            style={{ height: `${Math.min(100, (currentIdx / (STEPS.length - 1)) * 100)}%` }}
          />

          <div className="space-y-5 relative">
            {STEPS.map((step) => {
              const state = stepState(step.key)
              return (
                <div key={step.key} className="flex items-center gap-4">
                  {/* Icon circle */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-base flex-shrink-0 transition-all ${
                    state === 'done'   ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                    : state === 'active' ? 'bg-orange-100 ring-2 ring-orange-500 text-xl'
                    : 'bg-gray-100 text-gray-400'
                  }`}>
                    {state === 'done' ? <CheckCircle size={18} className="text-white" /> : step.icon}
                  </div>

                  {/* Label */}
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${state !== 'pending' ? 'text-gray-900' : 'text-gray-400'}`}>
                      {step.label}
                    </p>
                    <p className={`text-xs ${state === 'active' ? 'text-orange-500 font-medium' : 'text-gray-400'}`}>
                      {step.desc}
                    </p>
                  </div>

                  {state === 'active' && (
                    <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
                      En cours
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Delivered celebration */}
      {order.status === 'delivered' && (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4 text-center">
          <p className="text-2xl mb-1">🎉</p>
          <p className="font-bold text-green-700">Commande livrée !</p>
          <p className="text-xs text-green-600 mt-0.5">
            +{order.pointsEarned} points fidélité crédités
          </p>
        </div>
      )}

      {/* Order summary */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <h2 className="font-semibold text-sm text-gray-900">Récapitulatif</h2>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <MapPin size={13} className="text-orange-500 flex-shrink-0" />
          <span className="line-clamp-1">{order.deliveryAddress}</span>
        </div>

        <div className="divide-y divide-gray-50">
          {(order.items as { name: string; qty: number; price: number }[]).map((item, i) => (
            <div key={i} className="flex justify-between py-1.5 text-sm">
              <span className="text-gray-700">{item.qty}× {item.name}</span>
              <span className="font-medium text-gray-900">{(item.price * item.qty).toFixed(2)}€</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between font-bold text-sm pt-1 border-t border-gray-100">
          <span>Total payé</span>
          <span className="text-orange-600">{order.total.toFixed(2)}€</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={() => router.push('/eat')}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 text-sm transition-colors"
        >
          Commander à nouveau <ChevronRight size={16} />
        </button>
        <button
          onClick={() => router.push('/eat/account')}
          className="w-full text-gray-600 text-sm py-2 font-medium"
        >
          Voir mes commandes
        </button>
      </div>
    </div>
  )
}
