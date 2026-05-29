'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Navigation, MessageCircle, Phone } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'
import { Button } from '@/components/design-system'
import { getFoodImage, inferCategory } from '@/lib/food-images'

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

const STATUS_TO_STEP: Record<string, number> = { received: 0, preparing: 1, ready: 1, picked_up: 2, delivered: 3 }
const STATUS_LABEL: Record<string, string> = {
  received: 'Commande reçue',
  preparing: 'En préparation',
  ready: 'Prête',
  picked_up: 'En route vers vous',
  delivered: 'Livrée',
  cancelled: 'Annulée',
}

export default function OrderTrackingScreen() {
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (res.status === 401) { router.push('/eat/auth'); return }
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

  function etaWindow() {
    if (!order) return ''
    const created = new Date(order.createdAt).getTime()
    const eta = new Date(created + order.estimatedTime * 60_000)
    const end = new Date(created + (order.estimatedTime + 5) * 60_000)
    const fmt = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    return `${fmt(eta)} - ${fmt(end)}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="h-[280px] w-full animate-pulse bg-gray-200" />
        <div className="space-y-3 p-5">
          <div className="mx-auto h-6 w-1/2 animate-pulse rounded bg-gray-200" />
          <div className="h-16 animate-pulse rounded-2xl bg-gray-100" />
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white text-[#888]">
        <div className="text-5xl">😕</div>
        <p>Commande introuvable</p>
        <button onClick={() => router.push('/eat')} className="text-sm font-bold text-[#F97316]">Retour à l&apos;accueil</button>
      </div>
    )
  }

  const step = STATUS_TO_STEP[order.status] ?? 0
  const isDelivered = order.status === 'delivered'

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="flex items-center border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f5] active:scale-90">
          <ArrowLeft size={20} className="text-[#1a1a1a]" />
        </button>
        <h1 className="flex-1 text-center font-sans text-[18px] font-extrabold text-[#1a1a1a]">Suivi en temps réel</h1>
        <div className="w-10" />
      </div>

      {/* Faux map */}
      <div className="relative h-[280px] overflow-hidden bg-gradient-to-br from-[#e9efe6] via-[#eef1ee] to-[#e6ebf0]">
        {/* grid lines */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(#d8ded6 1px, transparent 1px), linear-gradient(90deg, #d8ded6 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        {/* route line */}
        <div className="absolute left-1/2 top-[20%] h-[55%] w-[3px] -translate-x-1/2 rounded-full bg-[#1a1a1a]" />
        {/* restaurant pin */}
        <div className="absolute left-[46%] top-[12%]">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-[#F97316] text-base shadow-md">🏠</div>
        </div>
        {/* driver pin — sits along the route based on status */}
        <div
          className="absolute left-[44%] transition-all duration-700"
          style={{ top: step >= 3 ? '76%' : step >= 2 ? '44%' : '24%' }}
        >
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 border-[#F97316] bg-white text-base shadow">🛵</div>
        </div>
        {/* destination pin */}
        <div className="absolute bottom-[12%] left-[44%]">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-[#F97316] text-base shadow-md">📍</div>
        </div>
        {/* GPS button */}
        <button className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md active:scale-90">
          <Navigation size={18} className="text-[#F97316]" />
        </button>
      </div>

      {/* Bottom sheet */}
      <div className="px-5 pt-5">
        <p className="text-center text-[13px] text-[#888]">
          {isDelivered ? 'Votre commande est arrivée' : "Heure d'arrivée estimée"}
        </p>
        <p className="text-center text-xl font-extrabold text-[#1a1a1a]">{isDelivered ? 'Livré 🎉' : etaWindow()}</p>
        <div className="mt-2 flex justify-center">
          <span className="rounded-full bg-[#FFF3ED] px-3 py-1 text-xs font-bold text-[#F97316]">{STATUS_LABEL[order.status] ?? order.status}</span>
        </div>

        <div className="my-3.5 h-px bg-[#f0f0f0]" />

        {/* Driver */}
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#FFF3ED] text-xl">🧑‍✈️</div>
          <div className="flex-1">
            <p className="text-[15px] font-bold text-[#1a1a1a]">Charlotte Taylor</p>
            <p className="mt-0.5 text-xs text-[#888]">Partenaire de livraison</p>
          </div>
          <div className="flex gap-2.5">
            <button className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-[#f0f0f0] active:scale-90"><MessageCircle size={18} className="text-[#F97316]" /></button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-[#f0f0f0] active:scale-90"><Phone size={18} className="text-[#F97316]" /></button>
          </div>
        </div>

        <div className="my-3.5 h-px bg-[#f0f0f0]" />

        {/* Route */}
        <div>
          <div className="flex items-center gap-3">
            <span className="h-3.5 w-3.5 rounded-full border-[3px] border-[#FFF3ED] bg-[#F97316]" />
            <span className="text-sm font-medium text-[#444]">{order.restaurant.name}</span>
          </div>
          <div className="ml-[6px] h-[18px] w-0.5 bg-[#ddd]" />
          <div className="flex items-center gap-3">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-[#888] bg-white" />
            <span className="truncate text-sm font-medium text-[#444]">{order.deliveryAddress}</span>
          </div>
        </div>

        <div className="my-3.5 h-px bg-[#f0f0f0]" />

        {/* Items */}
        <p className="mb-3 text-base font-extrabold text-[#1a1a1a]">Articles</p>
        {order.items.map((item, i) => (
          <div key={i} className="mb-3.5 flex items-center gap-3 border-b border-[#f8f8f8] pb-3.5 last:border-0">
            <FoodImage
              name={item.name}
              src={getFoodImage(inferCategory(item.name), item.name)}
              className="h-14 w-14 shrink-0 rounded-[10px]"
              glyphClassName="text-xl"
            />
            <div className="flex-1">
              <p className="text-sm font-bold text-[#1a1a1a]">{item.name}</p>
              <p className="mt-0.5 text-xs text-[#888]">x{item.qty}</p>
            </div>
            <span className="text-sm font-bold text-[#1a1a1a]">{(item.price * item.qty).toFixed(2)} €</span>
          </div>
        ))}

        <div className="mb-4 flex justify-between border-t border-[#f0f0f0] pt-3">
          <span className="text-base font-extrabold text-[#1a1a1a]">Total payé</span>
          <span className="text-base font-extrabold text-[#F97316]">{order.total.toFixed(2)} €</span>
        </div>

        {isDelivered && (
          <div className="mb-4 rounded-2xl bg-[#F0FDF4] p-4 text-center">
            <p className="font-bold text-[#16A34A]">Régalez-vous bien ! 🎉</p>
            <p className="mt-0.5 text-xs text-[#22C55E]">+{order.pointsEarned} points fidélité crédités</p>
          </div>
        )}

        <div className="mb-6">
          <Button variant="primary" size="pill" fullWidth onClick={() => router.push('/eat')}>
            Retour à l&apos;accueil
          </Button>
        </div>
      </div>
    </div>
  )
}
